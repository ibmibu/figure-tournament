import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return NextResponse.json({ error: 'ログインが必要です。' }, { status: 401 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const auth = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || !authData.user) return NextResponse.json({ error: 'ログインし直してください。' }, { status: 401 });
    const { id, matchId } = await request.json();
    if (!id || (matchId !== null && typeof matchId !== 'string')) return NextResponse.json({ error: '設定内容が不正です。' }, { status: 400 });
    const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: row, error: readError } = await db.from('tournaments').select('data').eq('id', id).maybeSingle();
      if (readError) throw readError;
      if (!row) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });
      const current = row.data || {};
      if (String(current.ownerUserId || '') !== String(authData.user.id)) return NextResponse.json({ error: '主催者のみ設定できます。' }, { status: 403 });
      if (matchId !== null && !(current.bracket?.rounds || []).flat().some(m => String(m.id) === matchId && m.player1 && m.player2 && !m.winnerId)) {
        return NextResponse.json({ error: '配信台に設定できる対戦ではありません。' }, { status: 400 });
      }
      const updated = { ...current, streamMatchId: matchId };
      const { data: changed, error } = await db.from('tournaments').update({ data: updated }).eq('id', id).eq('data', JSON.stringify(current)).select('id');
      if (error) throw error;
      if (changed?.length) return NextResponse.json({ ok: true, tournament: {
        ...updated, ownerUserId: undefined, ownerId: undefined, isOwner: true, effectiveStreamMatchId: matchId,
      } });
    }
    return NextResponse.json({ error: '他の更新と重なりました。もう一度お試しください。' }, { status: 409 });
  } catch (error) {
    console.error('Stream match update failed', error);
    return NextResponse.json({ error: '配信台を保存できませんでした。' }, { status: 500 });
  }
}
