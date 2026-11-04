import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { completedArchiveRecord, completedArchiveDetail } from '../../../../lib/archive-public';

export const dynamic = 'force-dynamic';
const MAX_BATCH = 20;
// Bump when exported public archive fields change: refresh all GitHub JSON.
const ARCHIVE_SCHEMA = 3;
const INDEX_FIELDS = [
  'id', 'complete:data->bracket->>complete',
  'revision:data->>stageActionRevision',
  'name:data->>name', 'date:data->>date',
  'completedAt:data->>completedAt',
  'tags:data->seriesTags', 'placements:data->resultPlacements',
  'reports:data->characterReports',
].join(',');
function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
}
function fingerprint(row) {
  return createHash('sha256').update(JSON.stringify([
    ARCHIVE_SCHEMA, row.id, row.revision, row.name, row.date,
    row.completedAt, row.tags, row.placements, row.reports,
  ])).digest('hex').slice(0, 24);
}
function publicJson(body, cache = 'no-store') {
  return NextResponse.json(body, { headers: { 'Cache-Control': cache } });
}
// Only public, *completed* tournament results are accessible here.
// Never expose full tournaments.data in any response.
export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams;
    const database = db();
    if (params.get('mode') === 'index') {
      const rows = [];
      for (let start = 0; ; start += 500) {
        const { data, error } = await database.from('tournaments')
          .select(INDEX_FIELDS).order('created_at', { ascending: true })
          .range(start, start + 499);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 500) break;
      }
      return publicJson({
        version: 1,
        archiveSchema: ARCHIVE_SCHEMA,
        records: rows.filter(row => row.complete === 'true' || row.complete === true)
          .map(row => ({ id: row.id, fingerprint: fingerprint(row) })),
      }, 'public, s-maxage=30, stale-while-revalidate=30');
    }
    const rawIds = params.get('ids') || '';
    const ids = [...new Set(rawIds.split(',').filter(Boolean))];
    if (!ids.length || ids.length > MAX_BATCH ||
        ids.some(id => !/^[A-Za-z0-9_-]{1,128}$/.test(id))) {
      return publicJson({ error: '大会IDの指定が正しくありません。' });
    }
    const { data, error } = await database.from('tournaments')
      .select(['id', 'data', INDEX_FIELDS.split(',').slice(2).join(',')].join(','))
      .in('id', ids);
    if (error) throw error;
    const records = [];
    for (const row of data || []) {
      const summary = completedArchiveRecord(row.id, row.data);
      if (!summary) continue; // In-progress and cancelled events are private.
      const detail = completedArchiveDetail(row.id, row.data);
      records.push({ id: row.id, fingerprint: fingerprint(row), tournament: summary, detail });
    }
    // Public immutable-ish result data may be cached briefly by Vercel CDN.
    // This prevents multiple visitors from all pulling the same recently
    // completed brackets from Supabase before GitHub catches up.
    return publicJson({ version: 1, archiveSchema: ARCHIVE_SCHEMA, records }, 'public, s-maxage=15, stale-while-revalidate=15');
  } catch (error) {
    console.error('Public tournament archive export failed:', error);
    return NextResponse.json({ error: '大会アーカイブの取得に失敗しました。' }, { status: 500 });
  }
}
