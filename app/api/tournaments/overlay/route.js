import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id || id.length > 128) return NextResponse.json({ error: '大会IDが不正です。' }, { status: 400 });
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: row, error } = await db.from('tournaments').select('data').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!row) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });
    const t = row.data || {};
    const rounds = t.bracket?.rounds || [];
    const matches = rounds.flat();
    const organizerMatch = matches.find(m => !m.winnerId && m.player1 && m.player2 &&
      [m.player1, m.player2].some(p => !p.isDemo && String(p.userId || p.id) === String(t.ownerUserId)));
    const explicit = t.streamMatchManual === true || t.streamMatchId !== undefined;
    const selected = explicit
      ? matches.find(m => t.streamMatchId != null && String(m.id) === String(t.streamMatchId) && m.player1 && m.player2 && !m.winnerId)
      : organizerMatch;
    if (!selected) return NextResponse.json({ name: t.name || '', match: null, status: explicit && t.streamMatchId == null ? 'unassigned' : 'not-found' }, { headers: { 'Cache-Control': 'no-store' } });
    const roundIndex = rounds.findIndex(round => round.some(m => String(m.id) === String(selected.id)));
    const score = selected.matchState?.score || {};
    const match = {
      player1: selected.player1.name || '',
      player2: selected.player2.name || '',
      score1: Number(score[selected.player1.id] || 0),
      score2: Number(score[selected.player2.id] || 0),
      round: roundIndex === rounds.length - 1 ? 'GRAND FINAL' : roundIndex === rounds.length - 2 ? 'SEMI FINAL' : 'ROUND ' + (roundIndex + 1),
      bestOf: Number(t.bestOf) === 5 ? 5 : 3,
      finished: Boolean(selected.winnerId),
    };
    return NextResponse.json({ name: t.name || '', match }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Overlay score read failed', error);
    return NextResponse.json({ error: 'スコアを取得できませんでした。' }, { status: 500 });
  }
}
