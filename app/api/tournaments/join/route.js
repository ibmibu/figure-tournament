import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) throw new Error('Supabase server environment variables are missing.');

    const token = (request.headers.get('authorization') || '').match(/^Bearer\\s+(.+)$/i)?.[1];
    if (!token) return NextResponse.json({ error: '参加登録にはログインが必要です。' }, { status: 401 });

    const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || !authData?.user) return NextResponse.json({ error: 'ログインし直してください。' }, { status: 401 });

    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: '大会IDがありません。' }, { status: 400 });

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await supabase.from('profiles').select('display_name').eq('user_id', authData.user.id).maybeSingle();
    if (profileError) throw profileError;
    const name = String(profile?.display_name || '').trim();
    if (!name || name.toLowerCase() === 'no name') {
      return NextResponse.json({ error: '参加する前にマイページで名前を設定してください。' }, { status: 400 });
    }

    const { data: row, error: readError } = await supabase.from('tournaments').select('data').eq('id', String(id)).maybeSingle();
    if (readError) throw readError;
    if (!row) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });
    const tournament = row.data || {};
    const players = Array.isArray(tournament.joinedPlayers) ? tournament.joinedPlayers : [];
    if (players.length >= Number(tournament.participants || 8)) return NextResponse.json({ error: 'この大会は定員に達しています。' }, { status: 409 });
    if (players.some(player => String(player.name || '').trim().toLowerCase() === name.toLowerCase())) {
      return NextResponse.json({ error: '同じ名前の参加者がすでに登録されています。' }, { status: 409 });
    }

    const joinedPlayers = [...players, { id: authData.user.id, userId: authData.user.id, name, joinedAt: new Date().toISOString() }];
    const { error: updateError } = await supabase.from('tournaments').update({ data: { ...tournament, joinedPlayers } }).eq('id', String(id));
    if (updateError) throw updateError;
    return NextResponse.json({ ok: true, joinedPlayers });
  } catch (error) {
    console.error('POST /api/tournaments/join failed:', error);
    return NextResponse.json({ error: error?.message || '参加登録を保存できませんでした。' }, { status: 500 });
  }
}
