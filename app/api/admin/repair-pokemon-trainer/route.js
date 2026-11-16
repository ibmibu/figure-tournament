import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { repairTournamentPokemonNames, repairColorPresets } from '../../../../lib/pokemon-trainer-backfill';

export const dynamic = 'force-dynamic';
const oldNames = /"(?:ゼニガメ|フシギソウ|リザードン)"/u;

async function authorize(request) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service || !process.env.FIGURE_STATS_ADMIN_USER_ID) return null;
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user || String(data.user.id) !== String(process.env.FIGURE_STATS_ADMIN_USER_ID))
    return null;
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
}

function candidate(row) {
  return [row.reports, row.declarations, row.snapshotReports].some(
    value => value && oldNames.test(JSON.stringify(value))
  );
}

async function findCandidates(db) {
  const ids = [];
  // Read only the relevant small JSON paths, not all tournament brackets or
  // personal info. Stable ordering ensures no rows are skipped during writes.
  const select = 'id,reports:data->characterReports,declarations:data->characterDeclarations,snapshotReports:data->statsSnapshot->characterReports';
  for (let start = 0; ; start += 500) {
    const { data, error } = await db.from('tournaments').select(select)
      .order('id', { ascending: true }).range(start, start + 499);
    if (error) throw error;
    for (const row of data || []) if (candidate(row)) ids.push(String(row.id));
    if (!data || data.length < 500) return ids;
  }
}

async function repairTournament(db, id) {
  const { data: row, error } = await db.from('tournaments')
    .select('data').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!row?.data) return { replaced: 0, conflict: false };
  const original = row.data;
  const { tournament, replacements } = repairTournamentPokemonNames(original);
  if (!replacements) return { replaced: 0, conflict: false };
  const prevRevision = Number.isSafeInteger(original.stageActionRevision) &&
    original.stageActionRevision >= 0 ? original.stageActionRevision : null;
  const revision = (prevRevision ?? 0) + 1;
  const next = { ...tournament, stageActionRevision: revision };
  // Retain the rest of the completed stats snapshot verbatim. Rewriting the
  // character names is sufficient; never alter results, rankings or colors.
  if (next.statsSnapshot?.version === 1)
    next.statsSnapshot = { ...next.statsSnapshot, revision };
  let query = db.from('tournaments').update({ data: next }).eq('id', id);
  query = prevRevision === null
    ? query.is('data->>stageActionRevision', null)
    : query.eq('data->>stageActionRevision', String(prevRevision));
  const { data: saved, error: saveError } = await query.select('id');
  if (saveError) throw saveError;
  return { replaced: saved?.length ? replacements : 0, conflict: !saved?.length };
}

async function repairSavedColors(db) {
  let changed = 0, conflicts = 0, replacements = 0;
  for (let start = 0; ; start += 500) {
    const { data, error } = await db.from('user_fighter_colors')
      .select('user_id,colors,updated_at')
      .order('user_id', { ascending: true }).range(start, start + 499);
    if (error) throw error;
    for (const row of data || []) {
      const corrected = repairColorPresets(row.colors);
      if (corrected.conflict) { conflicts++; continue; }
      if (!corrected.replacements) continue;
      // Only update records not edited concurrently by the owner.
      let query = db.from('user_fighter_colors')
        .update({ colors: corrected.colors, updated_at: new Date().toISOString() })
        .eq('user_id', row.user_id);
      query = row.updated_at == null
        ? query.is('updated_at', null) : query.eq('updated_at', row.updated_at);
      const { data: saved, error: writeError } = await query.select('user_id');
      if (writeError) throw writeError;
      if (saved?.length) { changed++; replacements += corrected.replacements; }
      else conflicts++;
    }
    if (!data || data.length < 500) break;
  }
  return { changed, conflicts, replacements };
}

// Explicit administrator-only one-time action; no mutations occur on page
// views or regular user requests. Safe to run again: corrected values are
// ignored and concurrent writes are protected with revision comparisons.
export async function POST(request) {
  try {
    const db = await authorize(request);
    if (!db) return NextResponse.json({ error: '管理者権限が必要です。' }, { status: 403 });
    const ids = await findCandidates(db);
    let updatedTournaments = 0, correctedNames = 0, writeConflicts = 0;
    for (const id of ids) {
      const result = await repairTournament(db, id);
      if (result.conflict) { writeConflicts++; continue; }
      if (result.replaced) { updatedTournaments++; correctedNames += result.replaced; }
    }
    const colorPresets = await repairSavedColors(db);
    return NextResponse.json({
      ok: true, updatedTournaments, correctedNames, colorPresets,
      writeConflicts,
      message: writeConflicts || colorPresets.conflicts
        ? '競合したデータは保護のため変更していません。確認して再実行してください。'
        : '過去の報告と保存済みのキャラ名を修正しました。',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Pokémon Trainer backfill failed:', error);
    return NextResponse.json({
      error: '一括修正に失敗しました。修正済みのデータは保持されています。再実行しても重複更新されません。',
    }, { status: 500 });
  }
}
