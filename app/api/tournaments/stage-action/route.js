import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { appendMatchLog } from '../../../../lib/tournament-match-log';
export const dynamic = 'force-dynamic';
const client = key => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
const fail = (error, status = 400) => NextResponse.json({ error }, { status });
export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return fail('ログインが必要です。', 401);
    const { data: { user }, error: authError } = await client(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).auth.getUser(token);
    if (authError || !user) return fail('ログインが必要です。', 401);
    const { id, matchId, action, stages, stage, actorId: requestedActorId } = await request.json();
    if (!id || !matchId || !['start', 'reject', 'choose'].includes(action)) return fail('操作が不正です。');
    const db = client(process.env.SUPABASE_SERVICE_ROLE_KEY);
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data: row, error } = await db.from('tournaments').select('data').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!row) return fail('大会が見つかりません。', 404);
      const original = row.data;
      if (!original.bracket || original.bracket.complete) return fail('対戦を操作できません。', 409);
      const next = structuredClone(original);
      const match = next.bracket.rounds.flat().find(m => String(m.id) === String(matchId));
      if (!match?.player1 || !match?.player2 || match.winnerId) return fail('対戦が更新されています。', 409);
      const players = [match.player1, match.player2];
      const owner = original.ownerUserId === user.id;
      const actor = requestedActorId ? players.find(p => String(p.id) === String(requestedActorId)) : players.find(p => String(p.userId || p.id) === String(user.id));
      if (!(action === 'start' && owner) && (!actor || (actor.isDemo ? !owner : String(actor.userId || actor.id) !== String(user.id)))) return fail('操作権限がありません。', 403);
      if (action === 'start') {
        if (!match.matchState) {
          const firstPlayerId = Math.random() < 0.5 ? match.player1.id : match.player2.id;
          match.matchState = {
            gameNumber: 1, score: { [match.player1.id]: 0, [match.player2.id]: 0 },
            games: [], currentGame: { firstPlayerId, rejects: [], rejectVotes: {},
              stage: original.stageRejects ? null : 'なし',
              chooserId: original.stageRejects ? null : firstPlayerId, results: {} },
            complete: false,
          };
        } else return NextResponse.json({ ok: true });
      } else {
        const state = match.matchState;
        if (!state || state.complete || !state.currentGame || state.currentGame.stage) return fail('ゲームが更新されています。', 409);
        const game = state.currentGame;
        const settings = original.stageSettings || {};
        const selected = original.stages || [];
        const starter = (settings.starterStages || selected).filter(s => selected.includes(s));
        const available = (state.gameNumber === 1 ? (starter.length ? starter : selected) : selected).filter(s => !(game.rejects || []).includes(s));
        const first = String(game.firstPlayerId);
        const other = String(players.find(p => String(p.id) !== first)?.id);
        const isFirstGame = Number(state.gameNumber) === 1;
        const firstCount = Number(settings.firstPlayerRejects ?? 1);
        const secondCount = Number(settings.secondPlayerRejects ?? 2);
        const laterCount = Number(settings.laterRejects ?? 3);
        if (action === 'reject') {
          if (!original.stageRejects) return fail('拒否ステージは無効です。', 409);
          const rejected = Array.isArray(game.rejects) ? game.rejects : [];
          const votes = game.rejectVotes || {};
          const firstDone = firstCount === 0 || Object.hasOwn(votes, first);
          const secondDone = secondCount === 0 || Object.hasOwn(votes, other);
          const turn = isFirstGame ? (!firstDone ? first : !secondDone ? other : null) : String(game.previousWinnerId || '');
          if (isFirstGame && !turn) return fail('拒否は完了しています。', 409);
          if (!isFirstGame) {
            const previousWinner = String(game.previousWinnerId || '');
            if (!players.some(p => String(p.id) === previousWinner)) return fail('拒否する選手が不明です。', 409);
          }
          if (String(actor.id) !== turn) return fail('現在はあなたの拒否ターンではありません。', 403);
          const required = isFirstGame ? (turn === first ? firstCount : secondCount) : Math.max(0, laterCount - rejected.length);
          if (!Array.isArray(stages) || stages.length !== required || new Set(stages).size !== stages.length ||
              stages.some(s => typeof s !== 'string' || !available.includes(s))) return fail('拒否ステージが不正です。');
          game.rejectVotes = { ...votes, [String(actor.id)]: stages };
          game.rejects = [...rejected, ...stages];
          const nowFirstDone = firstCount === 0 || Object.hasOwn(game.rejectVotes, first);
          const nowSecondDone = secondCount === 0 || Object.hasOwn(game.rejectVotes, other);
          if (isFirstGame ? nowFirstDone && nowSecondDone : game.rejects.length >= laterCount) {
            game.chooserId = isFirstGame ? game.firstPlayerId : players.find(p => String(p.id) !== String(game.previousWinnerId))?.id;
          }
        } else {
          const votes = game.rejectVotes || {};
          const done = !original.stageRejects || (isFirstGame
            ? (firstCount === 0 || Object.hasOwn(votes, first)) && (secondCount === 0 || Object.hasOwn(votes, other))
            : (game.rejects || []).length >= laterCount);
          if (!done || String(game.chooserId) !== String(actor.id)) return fail('現在はステージ選択ターンではありません。', 403);
          if (typeof stage !== 'string' || !available.includes(stage)) return fail('ステージが不正です。');
          game.stage = stage;
        }
      }
      const label = action === 'start' ? '対戦開始' : action === 'reject'
        ? `第${match.matchState.gameNumber}ゲーム 拒否：${stages.join('、')}`
        : `第${match.matchState.gameNumber}ゲーム ステージ決定：${stage}`;
      appendMatchLog(next, original, matchId, actor?.name || (owner ? '主催者' : ''), label);
      const { data: saved, error: writeError } = await db.from('tournaments').update({ data: next })
        .eq('id', id).eq('data', JSON.stringify(original)).select('id');
      if (writeError) { console.error('Stage action database write failed', { code: writeError.code, message: writeError.message, action }); throw writeError; }
      if (saved?.length) return NextResponse.json({ ok: true });
    }
    return fail('他の操作が先に保存されました。再度お試しください。', 409);
  } catch (error) {
    console.error('stage-action failed', { message: error?.message, code: error?.code, details: error?.details });
    return fail('ステージ操作に失敗しました。', 500);
  }
}
