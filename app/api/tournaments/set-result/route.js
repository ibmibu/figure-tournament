import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withStatsSnapshot } from '../../../../lib/stats-snapshot';
import { appendMatchLog } from '../../../../lib/tournament-match-log';
import { repairPrematureAdvances } from '../../../../lib/tournament-bracket-admin';
import { advanceMatch, adjustLiveSetScore, getMatchReportMode, initializeScoreState, liveSetScores, scoreTarget, validateFinalScore } from '../../../../lib/tournament-set-result';

export const dynamic = 'force-dynamic';
const client = key => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const fail = (message, status = 400) => NextResponse.json({ error: message }, { status });

export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return fail('ログインが必要です。', 401);
    const { data: { user }, error: authError } = await client(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).auth.getUser(token);
    if (authError || !user) return fail('ログインし直してください。', 401);
    const { id, matchId, action, firstScore, secondScore, winnerId, gameNumber,
      scorePlayerId, scoreDelta, scoreVersion } = await request.json();
    if (!id || !matchId || !['submit', 'confirm', 'dispute', 'owner-confirm', 'stream-game', 'score-adjust'].includes(action))
      return fail('操作内容が不正です。');
    const db = client(process.env.SUPABASE_SERVICE_ROLE_KEY);
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: row, error: readError } = await db.from('tournaments')
        .select('data').eq('id', String(id)).maybeSingle();
      if (readError) throw readError;
      if (!row) return fail('大会が見つかりません。', 404);
      const current = repairPrematureAdvances(row.data || {});
      if (!current.bracket?.rounds || current.bracket.complete) return fail('大会は終了しています。', 409);
      if (current.stageRejects) return fail('この大会はゲームごとの勝敗報告を使用します。', 409);
      const bracket = structuredClone(current.bracket);
      let ri = -1, mi = -1;
      for (let r = 0; r < bracket.rounds.length; r++) {
        const found = bracket.rounds[r].findIndex(m => String(m.id) === String(matchId));
        if (found >= 0) { ri = r; mi = found; break; }
      }
      if (ri < 0) return fail('対戦カードが見つかりません。', 404);
      const match = bracket.rounds[ri][mi];
      if (!match.player1 || !match.player2 || match.winnerId) return fail('この試合はすでに確定しています。', 409);
      const mode = getMatchReportMode(current, match);
      const owner = String(current.ownerUserId || '') === String(user.id);
      const me = [match.player1, match.player2].find(p =>
        !p.isDemo && String(p.userId || p.id) === String(user.id));
      if (mode === 'stream') {
        if (action !== 'stream-game') return fail('配信台のスコアは主催者が入力します。', 403);
        if (!owner) return fail('配信台のスコアは主催者のみ入力できます。', 403);
      } else {
        if (action === 'stream-game') return fail('この試合はセット結果を報告してください。', 400);
        if (action === 'owner-confirm') {
          if (!owner) return fail('主催者のみ代理確定できます。', 403);
        } else if (!me) return fail('対戦選手のみ報告・確認できます。', 403);
      }

      const state = initializeScoreState(current, match, mode);
      const p1 = String(match.player1.id), p2 = String(match.player2.id);
      let label, updated;
      if (mode === 'stream') {
        // The game number is a guard against a second tap or delayed retry
        // recording the same game twice.
        if (Number(gameNumber) !== Number(state.gameNumber)) return fail('スコアが更新されました。最新の結果を確認してください。', 409);
        const winner = [match.player1, match.player2].find(p => String(p.id) === String(winnerId));
        if (!winner) return fail('勝利した選手を選んでください。');
        const target = scoreTarget(current);
        if (Number(state.score[p1] || 0) >= target || Number(state.score[p2] || 0) >= target)
          return fail('この試合はすでに終了しています。', 409);
        state.score[winner.id] = Number(state.score[winner.id] || 0) + 1;
        state.games.push({ number: state.gameNumber, stage: '配信台', winnerId: winner.id });
        label = '配信台・第' + state.gameNumber + 'ゲーム勝利：' + winner.name;
        state.gameNumber += 1;
        if (Number(state.score[winner.id]) >= target) {
          updated = advanceMatch(current, bracket, ri, mi, winner.id);
          if (String(current.streamMatchId ?? '') === String(match.id)) {
            updated.streamHoldMatchId = match.id;
            updated.streamHoldUntil = new Date(Date.now() + 60000).toISOString();
          }
        } else {
          updated = { ...current, bracket };
        }
      } else if (action === 'score-adjust') {
        try {
          adjustLiveSetScore(current, match, scorePlayerId, scoreDelta, scoreVersion);
        } catch (error) {
          return fail(error.message || 'スコアを更新できませんでした。', 409);
        }
        label = (scoreDelta === 1 ? '暫定スコア加点：' : '暫定スコア訂正：') +
          [match.player1, match.player2].find(p => String(p.id) === String(scorePlayerId))?.name;
        updated = { ...current, bracket };
      } else if (action === 'submit') {
        if (state.pendingResult) return fail('この試合は結果の確認待ちです。', 409);
        // Submitted scores must match the live scoreboard. No separate
        // unverified score entry can skip the shared 10-second guard.
        const live = liveSetScores(match);
        const currentFirst = live[p1], currentSecond = live[p2];
        validateFinalScore(current, currentFirst, currentSecond);
        if (firstScore !== currentFirst || secondScore !== currentSecond)
          return fail('スコアが更新されています。最新のスコアを確認してください。', 409);
        state.pendingResult = {
          firstScore: currentFirst, secondScore: currentSecond,
          submittedBy: user.id, submittedAt: new Date().toISOString(),
        };
        state.disputedAt = null;
        label = 'セット結果を申告：' + match.player1.name + ' ' + firstScore + '-' + secondScore + ' ' + match.player2.name;
        updated = { ...current, bracket };
      } else if (action === 'dispute') {
        if (!state.pendingResult) return fail('確認待ちの結果がありません。', 409);
        if (String(state.pendingResult.submittedBy) === String(user.id)) return fail('自分の報告には異議を出せません。', 403);
        state.pendingResult = null;
        state.disputedAt = new Date().toISOString();
        label = 'セット結果に異議：' + (me?.name || '参加者');
        updated = { ...current, bracket };
      } else {
        const pending = state.pendingResult;
        if (!pending) return fail('確認待ちの結果がありません。', 409);
        if (action === 'confirm' && String(pending.submittedBy) === String(user.id))
          return fail('自分の報告は自分で承認できません。', 403);
        // Revalidate untrusted persisted values before advancement.
        validateFinalScore(current, pending.firstScore, pending.secondScore);
        state.score[p1] = pending.firstScore;
        state.score[p2] = pending.secondScore;
        state.games = [];
        const winner = pending.firstScore === scoreTarget(current) ? match.player1 : match.player2;
        label = (action === 'owner-confirm' ? '主催者が代理確定：' : '相手がセット結果を承認：') +
          match.player1.name + ' ' + pending.firstScore + '-' + pending.secondScore + ' ' + match.player2.name;
        updated = advanceMatch(current, bracket, ri, mi, winner.id);
      }
      appendMatchLog(updated, current, matchId, owner && (mode === 'stream' || action === 'owner-confirm')
        ? '主催者' : me?.name || '参加者', label);
      const revision = Number.isSafeInteger(current.stageActionRevision) && current.stageActionRevision >= 0
        ? current.stageActionRevision : null;
      updated.stageActionRevision = (revision ?? 0) + 1;
      let write = db.from('tournaments').update({ data: withStatsSnapshot(updated) }).eq('id', String(id));
      write = revision === null ? write.is('data->>stageActionRevision', null)
        : write.eq('data->>stageActionRevision', String(revision));
      const { data: changed, error: writeError } = await write.select('id');
      if (writeError) throw writeError;
      if (changed?.length) return NextResponse.json({
        ok: true,
        // Small authoritative acknowledgement: the writer's score changes
        // without another heavyweight tournament GET round-trip.
        ...(action === 'score-adjust' ? { scoreUpdate: {
          matchId: String(matchId),
          liveScore: liveSetScores(match),
          scoreVersion: state.scoreVersion,
          lastScoreIncrementAt: state.lastScoreIncrementAt || null,
          stageActionRevision: updated.stageActionRevision,
        } } : {}),
      });
      // CAS lost to another player. Reload, revalidate and retry.
    }
    return fail('同時に更新が行われました。最新の結果を確認してください。', 409);
  } catch (error) {
    console.error('Set result API failed', { message: error?.message, code: error?.code });
    return fail('スコアを保存できませんでした。', 500);
  }
}
