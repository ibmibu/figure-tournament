import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { unstable_cache } from 'next/cache';

export const dynamic = 'force-dynamic';
function client(key) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key,
    { auth: { persistSession: false, autoRefreshToken: false } });
}
// Global tag choices are shared by every organizer. Cache only the public
// tag names, NEVER the private previous-event stream settings or user auth.
const cachedKnownSeriesTags = unstable_cache(async () => {
  const db = client(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const tags = new Set();
  for (let start = 0; ; start += 500) {
    const { data, error } = await db.from('tournaments')
      .select('seriesTags:data->seriesTags').range(start, start + 499);
    if (error) throw error;
    for (const row of data || []) {
      if (!Array.isArray(row.seriesTags)) continue;
      for (const tag of row.seriesTags) {
        const normalized = String(tag).trim();
        if (normalized) tags.add(normalized);
      }
    }
    if (!data || data.length < 500) break;
  }
  return [...tags].sort((a,b) => a.localeCompare(b,'ja'));
}, ['tournament-series-tag-options-v1'], { revalidate: 600 });
// Only the previous organizer settings and the global tag names are needed
// when creating a tournament. Never read or return whole historical brackets.
export async function GET(request) {
  try {
    const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return NextResponse.json({ error: 'ログインが必要です。' }, { status: 401 });
    const auth = client(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data: { user }, error: authError } = await auth.auth.getUser(token);
    if (authError || !user)
      return NextResponse.json({ error: 'ログインし直してください。' }, { status: 401 });
    const db = client(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const previousQuery = db.from('tournaments')
      .select([
        'name:data->>name',
        'seriesTags:data->seriesTags',
        'streamUrl:data->>streamUrl',
        'streamFriendCode:data->>streamFriendCode',
      ].join(','))
      .contains('data', { ownerUserId: user.id })
      .order('created_at', { ascending: false }).limit(1);
    const [{ data: previousRows, error: previousError }, knownSeriesTags] =
      await Promise.all([previousQuery, cachedKnownSeriesTags()]);
    if (previousError) throw previousError;
    const previous = (previousRows || []).find(t =>
      typeof t.name === 'string' && t.name.trim()) || null;
    return NextResponse.json({ previous, knownSeriesTags }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    console.error('Tournament creation preset load failed:', error);
    return NextResponse.json({ error: '大会作成用の設定を読み込めませんでした。' },
      { status: 500 });
  }
}
