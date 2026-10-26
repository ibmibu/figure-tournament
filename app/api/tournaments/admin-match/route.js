import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { updateBracketMatch } from '../../../../lib/tournament-bracket-admin';

export const dynamic = 'force-dynamic';

function client(key) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !key) throw new Error('Supabaseの設定がありません。');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request) {
  try {
    const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return NextResponse.json({ error: '主催者としてログインしてください。' }, { status: 401 });
    const auth = client(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data: { user }, error: authError } = await auth.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: 'ログインの有効期限が切れています。' }, { status: 401 });

    const { id, matchId, action, winnerId, ownerToken } = await request.json();
    if (!id || !matchId || !['reset', 'forfeit'].includes(action)) {
      return NextResponse.json({ error: '操作内容が正しくありません。' }, { status: 400 });
    }
    const admin = client(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: row, error: readError } = await admin.from('tournaments')
      .select('data,owner_token').eq('id', String(id)).maybeSingle();
    if (readError) throw readError;
    if (!row) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });

    const existing = row.data || {};
    const isOwner = existing.ownerUserId
      ? String(existing.ownerUserId) === String(user.id)
      : Boolean(ownerToken && String(ownerToken) === String(row.owner_token));
    if (!isOwner) return NextResponse.json({ error: '対戦結果を変更できるのは大会主催者のみです。' }, { status: 403 });

    let updated;
    try {
      updated = updateBracketMatch(existing, String(matchId), action, winnerId);
    } catch (error) {
      return NextResponse.json({ error: error.message || '対戦結果を変更できませんでした。' }, { status: 400 });
    }

    const { error: writeError } = await admin.from('tournaments')
      .update({ data: updated }).eq('id', String(id));
    if (writeError) throw writeError;
    const { ownerUserId, ownerId, ...publicTournament } = updated;
    return NextResponse.json({ ok: true, tournament: { ...publicTournament, isOwner: true } });
  } catch (error) {
    console.error('Match administration failed:', error);
    return NextResponse.json({ error: '対戦結果の更新に失敗しました。' }, { status: 500 });
  }
}
