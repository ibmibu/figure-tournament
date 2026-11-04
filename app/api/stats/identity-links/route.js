import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { loadServerArchivedTournamentState } from '../../../../lib/tournament-archive-server';
import {
  buildStatsSnapshot, completedForStats, snapshotIsCurrent, snapshotToPublicResult,
  withStatsSnapshot,
} from '../../../../lib/stats-snapshot';

export const dynamic = 'force-dynamic';

// Tournament schedules are entered as Japan-local YYYY-MM-DDTHH:mm (no offset).
function toTime(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim().replace(' ', 'T');
  const local = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(normalized);
  const iso = local ? (normalized.includes('T') ? normalized : normalized + 'T00:00:00') + '+09:00' : normalized;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : null;
}
function compareByScheduledStart(a, b) {
  const startA = toTime(a.data?.date) ?? toTime(a.data?.createdAt) ?? toTime(a.created_at) ?? Number.MAX_SAFE_INTEGER;
  const startB = toTime(b.data?.date) ?? toTime(b.data?.createdAt) ?? toTime(b.created_at) ?? Number.MAX_SAFE_INTEGER;
  if (startA !== startB) return startA - startB;
  const createdA = toTime(a.created_at) ?? toTime(a.data?.createdAt) ?? Number.MAX_SAFE_INTEGER;
  const createdB = toTime(b.created_at) ?? toTime(b.data?.createdAt) ?? Number.MAX_SAFE_INTEGER;
  return createdA - createdB || String(a.id).localeCompare(String(b.id));
}

// Supabase defaults to 1000 rows; page even when the tournaments table grows.
async function readAllTournaments(db, select) {
  const result = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await db.from('tournaments').select(select)
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(start, start + 499);
    if (error) throw error;
    result.push(...(data || []));
    if (!data || data.length < 500) return result;
  }
}
async function readFullByIds(db, ids) {
  const rows = [];
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await db.from('tournaments').select('id,data,created_at')
      .in('id', ids.slice(index, index + 100));
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}
function positiveRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// One-time lazy migration of old finalized events. Optimistic revision checking
// prevents overwriting a concurrent report, reset, or match update.
async function backfillSnapshot(db, row) {
  if (!completedForStats(row.data)) return;
  const prev = positiveRevision(row.data.stageActionRevision);
  const updated = withStatsSnapshot({ ...row.data, stageActionRevision: (prev ?? 0) + 1 });
  let query = db.from('tournaments').update({ data: updated }).eq('id', row.id);
  query = prev === null ? query.is('data->>stageActionRevision', null)
    : query.eq('data->>stageActionRevision', String(prev));
  const { error } = await query.select('id');
  if (error) throw error;
}

// Only expose results of completed tournaments, not private bracket data.
// The small projection avoids downloading full brackets for cached tournaments.
export async function GET(request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase is not configured');
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: rows, error } = await db.from('legacy_player_links').select('legacy_player_id,user_id');
    if (error) throw error;
    const linkMap = new Map((rows || []).map(row => [String(row.user_id), String(row.legacy_player_id)]));

    // The public GitHub JSON is the primary source of completed result
    // snapshots. Keep the old DB projection below as a safe fallback until
    // archive backfill catches up or if CDN export is unavailable.
    try {
      const state = await loadServerArchivedTournamentState(request);
      const results = state.records.filter(row => row.statsSnapshot?.version === 1)
        .map(row => ({
          id: row.id, created_at: row.createdAt,
          data: row.statsSnapshot,
        }));
      const tournaments = results.sort(compareByScheduledStart)
        .map(row => snapshotToPublicResult(row.id, row.data, linkMap));
      // All viewers receive the same public finished results. The browser has a
      // longer local cache; this short CDN cache also prevents a burst of
      // anonymous visitors from rerunning Vercel's CPU-intensive rating map.
      return NextResponse.json({
        tournaments,
        archiveRevision: state.revision,
        identityRevision: state.identityRevision,
      }, { headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300',
      } });
    } catch (archiveError) {
      console.warn('GitHub stats archive unavailable; using compact Supabase snapshot fallback:', archiveError.message);
    }
    const entries = [];
    const needsBackfill = [];
    let compactRows = null;
    try {
      compactRows = await readAllTournaments(db,
        'id,created_at,stats_snapshot:data->statsSnapshot,revision:data->>stageActionRevision,completed:data->bracket->>complete');
    } catch (projectionError) {
      // Older PostgREST versions may not support JSON projections. Keep the
      // original full-data read as a fully functional fallback.
      console.warn('Compact stats projection unavailable; using full rows:', projectionError.message);
    }

    if (compactRows) {
      const finished = compactRows.filter(row => row.completed === 'true' || row.completed === true);
      const missing = finished.filter(row => !snapshotIsCurrent(row.stats_snapshot, row.revision));
      const originals = new Map((await readFullByIds(db, missing.map(row => row.id)))
        .map(row => [String(row.id), row]));
      for (const row of finished) {
        if (snapshotIsCurrent(row.stats_snapshot, row.revision)) {
          entries.push({ id: row.id, created_at: row.created_at, data: row.stats_snapshot });
          continue;
        }
        const original = originals.get(String(row.id));
        if (!original || !completedForStats(original.data)) continue;
        const snapshot = buildStatsSnapshot(original.data);
        if (!snapshot) continue;
        entries.push({ id: row.id, created_at: row.created_at, data: snapshot });
        needsBackfill.push(original);
      }
    } else {
      const originals = await readAllTournaments(db, 'id,data,created_at');
      for (const original of originals) {
        if (!completedForStats(original.data)) continue;
        const snapshot = buildStatsSnapshot(original.data);
        if (!snapshot) continue;
        entries.push({ id: original.id, created_at: original.created_at, data: snapshot });
        if (!snapshotIsCurrent(original.data.statsSnapshot, original.data.stageActionRevision)) needsBackfill.push(original);
      }
    }

    // Work in bounded batches: this runs only for old/missing snapshots, never
    // for a live tournament, and a failed write doesn't prevent stats rendering.
    await Promise.all(needsBackfill.slice(0, 12).map(async row => {
      try { await backfillSnapshot(db, row); }
      catch (error) { console.warn('Stats snapshot backfill skipped:', row.id, error.message); }
    }));

    const tournaments = entries.sort(compareByScheduledStart)
      .map(row => snapshotToPublicResult(row.id, row.data, linkMap));
    // All viewers receive the same public finished results. The browser has a
      // longer local cache; this short CDN cache also prevents a burst of
      // anonymous visitors from rerunning Vercel's CPU-intensive rating map.
      return NextResponse.json({ tournaments }, { headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300',
      } });
  } catch (error) {
    console.error('Stats identity links:', error);
    return NextResponse.json({ error: '旧ID連携情報を取得できませんでした。' }, { status: 500 });
  }
}
