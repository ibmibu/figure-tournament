import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) throw new Error('Supabase server environment variables are missing.');

    const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return NextResponse.json({ error: '参加登録にはログインが必要です。' }, { status: 401 });

    const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || !authData?.user) return NextResponse.json({ error: 'ログインし直してください。' }, { status: 401 });

    const { id, friendCode: submittedFriendCode } = await request.json();
    if (typeof id !== 'string' || !id || id.length > 128) return NextResponse.json({ error: '大会IDが正しくありません。' }, { status: 400 });

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await supabase.from('profiles').select('display_name,friend_code').eq('user_id', authData.user.id).maybeSingle();
    if (profileError) throw profileError;
    const name = String(profile?.display_name || '').trim();
    if (!name || name.toLowerCase() === 'no name') {
      return NextResponse.json({ error: '参加する前にマイページで名前を設定してください。' }, { status: 400 });
    }

    const friendCode = String(profile?.friend_code || submittedFriendCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]+$/.test(friendCode)) {
      return NextResponse.json({ error: 'フレンドコードを英数字とハイフンのみで入力してください。' }, { status: 400 });
    }

    const { data: row, error: readError } = await supabase.from('tournaments').select('data').eq('id', String(id)).maybeSingle();
    if (readError) throw readError;
    if (!row) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });
    const tournament = row.data || {};
    if (tournament.bracket || tournament.status === "対戦中" || tournament.status === "終了") return NextResponse.json({ error: "大会開始後は参加登録できません。" }, { status: 409 });
    const players = Array.isArray(tournament.joinedPlayers) ? tournament.joinedPlayers : [];
    if (players.length >= Number(tournament.participants || 8)) return NextResponse.json({ error: 'この大会は定員に達しています。' }, { status: 409 });
    if (players.some(player => String(player.userId || player.id) === String(authData.user.id))) return NextResponse.json({ error: 'すでに参加登録しています。' }, { status: 409 });
    if (players.some(player => String(player.name || '').trim().toLowerCase() === name.toLowerCase())) {
      return NextResponse.json({ error: '同じ名前の参加者がすでに登録されています。' }, { status: 409 });
    }

    const joinedPlayers = [...players, { id: authData.user.id, userId: authData.user.id, name, friendCode, joinedAt: new Date().toISOString() }];
    // Optimistic concurrency control prevents simultaneous joins from overwriting
    // another participant or bypassing the configured capacity.
    const { data: updated, error: updateError } = await supabase.from('tournaments')
      .update({ data: { ...tournament, joinedPlayers } })
      .eq('id', String(id))
      .eq('data', JSON.stringify(tournament))
      .select('id');
    if (updateError) throw updateError;
    if (!updated?.length) return NextResponse.json({ error: '他の参加登録が先に保存されました。更新して再試行してください。' }, { status: 409 });
    return NextResponse.json({ ok: true, joinedPlayers });
  } catch (error) {
    console.error('POST /api/tournaments/join failed:', error);
    return NextResponse.json({ error: '参加登録を保存できませんでした。' }, { status: 500 });
  }
}


export async function DELETE(request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) throw new Error('Supabase server environment variables are missing.');
    const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return NextResponse.json({ error: '参加解除にはログインが必要です。' }, { status: 401 });
    const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await auth.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: 'ログインし直してください。' }, { status: 401 });
    const { id } = await request.json();
    if (typeof id !== 'string' || !id || id.length > 128) return NextResponse.json({ error: '大会IDが正しくありません。' }, { status: 400 });
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: row, error: readError } = await supabase.from('tournaments').select('data').eq('id', id).maybeSingle();
    if (readError) throw readError;
    if (!row) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });
    const existing = row.data || {};
    if (existing.bracket || existing.status === '対戦中' || existing.status === '終了') {
      return NextResponse.json({ error: '大会開始後は参加を解除できません。' }, { status: 409 });
    }
    const players = Array.isArray(existing.joinedPlayers) ? existing.joinedPlayers : [];
    const mine = players.find(p => !p.isDemo && String(p.userId || p.id) === String(user.id));
    if (!mine) return NextResponse.json({ error: 'この大会には参加していません。' }, { status: 403 });
    const joinedPlayers = players.filter(p => p !== mine);
    const declarations = { ...(existing.characterDeclarations || {}) };
    delete declarations[String(mine.id)];
    const updatedData = { ...existing, joinedPlayers, characterDeclarations: declarations };
    const { data: changed, error: writeError } = await supabase.from('tournaments')
      .update({ data: updatedData }).eq('id', id).eq('data', JSON.stringify(existing)).select('id');
    if (writeError) throw writeError;
    if (!changed?.length) return NextResponse.json({ error: '他の操作が先に保存されました。再読み込みしてやり直してください。' }, { status: 409 });
    return NextResponse.json({ ok: true, joinedPlayers });
  } catch (error) {
    console.error('DELETE /api/tournaments/join failed:', error);
    return NextResponse.json({ error: '参加解除に失敗しました。' }, { status: 500 });
  }
}
