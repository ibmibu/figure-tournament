import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const token = (request.headers.get('authorization') || '').match(/^Bearer\\s+(.+)$/i)?.[1];
    if (!token) return NextResponse.json({ error: 'ログインが必要です。' }, { status: 401 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const auth = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data: { user }, error: authError } = await auth.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: 'ログインが必要です。' }, { status: 401 });
    const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: link, error: linkError } = await db.from('legacy_player_links').select('legacy_player_id').eq('user_id', user.id).maybeSingle();
    if (linkError) throw linkError;
    if (!link) return NextResponse.json({ tournaments: [] });
    const response = await fetch('https://raw.githubusercontent.com/ibmibu/ningyogeki-stats/main/public/data/ningyogeki-archive.json', { next: { revalidate: 3600 } });
    if (!response.ok) throw Error('過去大会データを取得できませんでした。');
    const archive = await response.json();
    const data = archive.data || archive;
    const aliases = { '99450':'145071','118591':'149650','148400':'164481','80108':'142959','100389':'167992','159344':'167992','156108':'156414' };
    const canonical = value => { let id = String(value); const visited = new Set(); while (aliases[id] && !visited.has(id)) { visited.add(id); id = aliases[id]; } return id; };
    const playerId = canonical(link.legacy_player_id);
    const byNumber = new Map();
    for (const record of data.records || []) {
      const number = Number(record.tournamentNumber);
      if (!Number.isFinite(number)) continue;
      if (!byNumber.has(number)) byNumber.set(number, []);
      byNumber.get(number).push(record);
    }
    const tournaments = (data.tournaments || []).flatMap(t => {
      const number = Number(t.number);
      const matches = byNumber.get(number) || [];
      if (!matches.some(m => canonical(m.winnerId) === playerId || canonical(m.loserId) === playerId)) return [];
      const losers = new Set(matches.map(m => canonical(m.loserId)));
      const participants = new Set(matches.flatMap(m => [canonical(m.winnerId), canonical(m.loserId)]));
      const unbeaten = [...participants].filter(id => !losers.has(id));
      const champion = unbeaten.length === 1 ? unbeaten[0] : null;
      return [{ id: 'legacy-' + number, name: t.name || '人形劇#' + number, number, myPlacement: champion === playerId ? '優勝' : '参加', isLegacy: true }];
    });
    return NextResponse.json({ tournaments }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Legacy results:', error);
    return NextResponse.json({ error: '過去の人形劇の結果を読み込めませんでした。' }, { status: 500 });
  }
}
