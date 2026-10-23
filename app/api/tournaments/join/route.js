import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase server environment variables are missing.');
    const { id, playerName } = await request.json();
    const name = String(playerName || '').trim();
    if (!id || !name) return NextResponse.json({ error: '大会IDと参加者名を入力してください。' }, { status: 400 });
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: row, error: readError } = await supabase.from('tournaments').select('data').eq('id', String(id)).maybeSingle();
    if (readError) throw readError;
    if (!row) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });
    const tournament = row.data || {};
    const players = Array.isArray(tournament.joinedPlayers) ? tournament.joinedPlayers : [];
    if (players.length >= Number(tournament.participants || 8)) return NextResponse.json({ error: 'この大会は定員に達しています。' }, { status: 409 });
    if (players.some(player => String(player.name || '').toLowerCase() === name.toLowerCase())) return NextResponse.json({ error: '同じ名前の参加者がすでに登録されています。' }, { status: 409 });
    const joinedPlayers = [...players, { id: String(Date.now()), name, joinedAt: new Date().toISOString() }];
    const { error: updateError } = await supabase.from('tournaments').update({ data: { ...tournament, joinedPlayers } }).eq('id', String(id));
    if (updateError) throw updateError;
    return NextResponse.json({ ok: true, joinedPlayers });
  } catch (error) {
    console.error('POST /api/tournaments/join failed:', error);
    return NextResponse.json({ error: '参加登録を保存できませんでした。' }, { status: 500 });
  }
}
