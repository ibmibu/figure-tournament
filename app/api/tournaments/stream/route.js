import { withStatsSnapshot } from '../../../../lib/stats-snapshot';
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
      const revision = Number.isSafeInteger(current.stageActionRevision) && current.stageActionRevision >= 0 ? current.stageActionRevision : null;
      // A match may have auto-initialized before the organizer assigned it to
      // the stream table. Switch it to host-controlled scoring only if no
      // game/score/report has been recorded yet; never change an active match.
      const bracket = current.bracket ? structuredClone(current.bracket) : null;
      if (!current.stageRejects && matchId && bracket?.rounds) {
        const selected = bracket.rounds.flat().find(m => String(m.id) === String(matchId));
        const state = selected?.matchState;
        if (state && !selected.winnerId &&
            Number(state.score?.[selected.player1.id] || 0) === 0 &&
            Number(state.score?.[selected.player2.id] || 0) === 0 &&
            !(state.games || []).length && !state.pendingResult &&
            !state.disputedAt && state.reportMode !== 'stream') {
          state.reportMode = 'stream';
          state.currentGame = null;
          state.gameNumber = 1;
          state.score = { [selected.player1.id]: 0, [selected.player2.id]: 0 };
          state.games = [];
        }
      }
      const updated = { ...current, ...(bracket ? { bracket } : {}), streamMatchId: matchId, streamMatchManual: true, stageActionRevision: (revision ?? 0) + 1 };
      let update = db.from('tournaments').update({ data: withStatsSnapshot(updated) }).eq('id', id);
      update = revision === null ? update.is('data->>stageActionRevision', null) : update.eq('data->>stageActionRevision', String(revision));
      const { data: changed, error } = await update.select('id');
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
