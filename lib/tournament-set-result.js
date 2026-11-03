import { getBracketPlacements } from './tournament-bracket-admin';

// One authoritative stream assignment for both server permissions and the UI.
// A valid streaming URL enables automatic selection of the organizer's own
// match; without one there is no automatic broadcast. Explicit assignments
// remain under organizer control regardless of the URL.
export function hasStreamUrl(tournament) {
  return /^https?:\/\/\S+/i.test(String(tournament?.streamUrl || '').trim());
}
export function getEffectiveStreamMatchId(tournament) {
  // Public tournament responses intentionally hide ownerUserId and provide
  // the already resolved effectiveStreamMatchId. Honor that field on clients.
  if (tournament && !tournament.ownerUserId &&
      Object.prototype.hasOwnProperty.call(tournament, 'effectiveStreamMatchId')) {
    return tournament.effectiveStreamMatchId ?? null;
  }
  const matches = (tournament?.bracket?.rounds || []).flat();
  const active = match => match?.player1 && match?.player2 && !match.winnerId;
  if (tournament?.streamMatchManual === true || tournament?.streamMatchId !== undefined) {
    return matches.find(match => active(match) &&
      String(match.id) === String(tournament.streamMatchId))?.id ?? null;
  }
  // No livestream URL means the organizer's own match is NOT automatically
  // made the broadcast table. Manual match selections above still work.
  const ownerId = tournament?.ownerUserId;
  if (!ownerId || !hasStreamUrl(tournament)) return null;
  return matches.find(match => active(match) &&
    [match.player1, match.player2].some(player => !player.isDemo &&
      String(player.userId || player.id) === String(ownerId)))?.id ?? null;
}

// Currently assigned streaming matches ALWAYS reject participant score writes.
// A previously started *actual* stream match stays organizer-controlled if
// reassigned. Legacy auto-starts without any URL/manual assignment are normal
// matches unless a stream game was already scored (preserve those results).
export function getMatchReportMode(tournament, match) {
  if (tournament?.stageRejects) return 'games';
  if (match && String(getEffectiveStreamMatchId(tournament) ?? '') === String(match.id))
    return 'stream';
  if (match?.matchState?.reportMode === 'stream') {
    if (tournament?.streamMatchManual === true ||
        tournament?.streamMatchId !== undefined || hasStreamUrl(tournament)) return 'stream';
    const state = match.matchState;
    if ((state.games || []).length ||
        Object.values(state.score || {}).some(value => Number(value) > 0)) return 'stream';
  }
  return 'set';
}

export function initializeScoreState(tournament, match, mode) {
  if (!match.matchState) {
    match.matchState = {
      reportMode: mode, gameNumber: 1,
      score: { [match.player1.id]: 0, [match.player2.id]: 0 },
      games: [], currentGame: null, complete: false,
      pendingResult: null,
      liveScore: { [match.player1.id]: 0, [match.player2.id]: 0 },
      scoreVersion: 0, lastScoreActorId: null, lastScoreActionAt: null,
    };
  } else {
    match.matchState.reportMode = mode;
    if (!match.matchState.score) match.matchState.score = {
      [match.player1.id]: 0, [match.player2.id]: 0,
    };
    if (!Array.isArray(match.matchState.games)) match.matchState.games = [];
    if (!Number.isInteger(match.matchState.gameNumber)) {
      match.matchState.gameNumber = Number(match.matchState.score[match.player1.id] || 0) +
        Number(match.matchState.score[match.player2.id] || 0) + 1;
    }
  }
  return match.matchState;
}

// OBS/display score for a non-strike set is provisional until approved.
// Legacy matches may lack the liveScore field, so read their existing score.
export function liveSetScores(match) {
  const state = match?.matchState;
  const first = String(match?.player1?.id ?? '');
  const second = String(match?.player2?.id ?? '');
  const source = state?.liveScore || state?.score || {};
  return { [first]: Number(source[first] || 0), [second]: Number(source[second] || 0) };
}

export const SCORE_CONTROL_LOCK_MS = 3000;

// A score editor is briefly reserved for the latest editor, not locked against
// that editor. Accept the authenticated account ID, never a client-supplied ID.
export function scoreControlLockRemainingMs(state, actorUserId, now = Date.now()) {
  if (!state?.lastScoreActorId || !state?.lastScoreActionAt ||
      !actorUserId || String(state.lastScoreActorId) === String(actorUserId)) return 0;
  const last = Date.parse(state.lastScoreActionAt);
  return Number.isFinite(last) ? Math.max(0, last + SCORE_CONTROL_LOCK_MS - now) : 0;
}

// Returns the next *temporary* score. The caller must persist it with the
// tournament revision guard; this function does not finalize bracket results.
export function adjustLiveSetScore(tournament, match, playerId, delta, expectedVersion, actorUserId, now = Date.now()) {
  if (getMatchReportMode(tournament, match) !== 'set' || tournament.stageRejects ||
      !match?.player1 || !match?.player2 || match.winnerId) {
    throw new Error('この試合ではスコアを操作できません。');
  }
  const state = initializeScoreState(tournament, match, 'set');
  if (state.complete || state.pendingResult) throw new Error('結果の確認中はスコアを変更できません。');
  const id = String(playerId);
  if (![String(match.player1.id), String(match.player2.id)].includes(id))
    throw new Error('スコアの対象選手が正しくありません。');
  if (delta !== 1 && delta !== -1) throw new Error('スコア操作が不正です。');
  if (!actorUserId) throw new Error('スコア操作の権限を確認できませんでした。');
  const remaining = scoreControlLockRemainingMs(state, actorUserId, now);
  if (remaining > 0)
    throw new Error('相手がスコアを操作中です。あと' + Math.ceil(remaining / 1000) + '秒お待ちください。');
  const version = Number.isSafeInteger(state.scoreVersion) ? state.scoreVersion : 0;
  if (!Number.isSafeInteger(expectedVersion) || version !== expectedVersion)
    throw new Error('スコアが更新されています。画面を更新して確認してください。');
  const live = liveSetScores(match);
  const target = scoreTarget(tournament);
  if (delta === 1) {
    const otherId = id === String(match.player1.id) ? String(match.player2.id) : String(match.player1.id);
    if (live[id] >= target || (live[otherId] >= target && live[id] >= target - 1))
      throw new Error('両選手が規定勝利数に達するスコアにはできません。');
  } else if (live[id] <= 0) {
    throw new Error('これ以上減点できません。');
  }
  live[id] = Math.max(0, Math.min(target, live[id] + delta));
  state.liveScore = live;
  state.scoreVersion = version + 1;
  state.lastScoreUpdatedAt = new Date(now).toISOString();
  state.lastScoreActorId = String(actorUserId);
  state.lastScoreActionAt = state.lastScoreUpdatedAt;
  return { score: live, version: state.scoreVersion };
}

// Persist a complete provisional score in one revisioned write. This allows
// participants to tap multiple +/- buttons immediately while the browser
// coalesces their edits, without weakening opponent locks or approvals.
export function setLiveSetScores(tournament, match, firstScore, secondScore, expectedVersion, actorUserId, now = Date.now()) {
  if (getMatchReportMode(tournament, match) !== 'set' || tournament.stageRejects ||
      !match?.player1 || !match?.player2 || match.winnerId)
    throw new Error('この試合ではスコアを操作できません。');
  const state = initializeScoreState(tournament, match, 'set');
  if (state.complete || state.pendingResult)
    throw new Error('結果の確認中はスコアを変更できません。');
  if (!actorUserId) throw new Error('スコア操作の権限を確認できませんでした。');
  const remaining = scoreControlLockRemainingMs(state, actorUserId, now);
  if (remaining > 0)
    throw new Error('相手がスコアを操作中です。あと' + Math.ceil(remaining / 1000) + '秒お待ちください。');
  const version = Number.isSafeInteger(state.scoreVersion) ? state.scoreVersion : 0;
  if (!Number.isSafeInteger(expectedVersion) || version !== expectedVersion)
    throw new Error('スコアが更新されています。最新のスコアを確認してください。');
  const target = scoreTarget(tournament);
  if (!Number.isInteger(firstScore) || !Number.isInteger(secondScore) ||
      firstScore < 0 || secondScore < 0 || firstScore > target || secondScore > target ||
      (firstScore === target && secondScore === target))
    throw new Error('BO形式に合うスコアを入力してください。');
  const previous = liveSetScores(match);
  const firstId = String(match.player1.id), secondId = String(match.player2.id);
  if (previous[firstId] === firstScore && previous[secondId] === secondScore)
    throw new Error('スコアが変更されていません。');
  state.liveScore = { [firstId]: firstScore, [secondId]: secondScore };
  state.scoreVersion = version + 1;
  state.lastScoreUpdatedAt = new Date(now).toISOString();
  state.lastScoreActorId = String(actorUserId);
  state.lastScoreActionAt = state.lastScoreUpdatedAt;
  return { score: state.liveScore, version: state.scoreVersion };
}

export function scoreTarget(tournament) {
  return Number(tournament.bestOf) === 5 ? 3 : 2;
}

export function validateFinalScore(tournament, firstScore, secondScore) {
  const target = scoreTarget(tournament);
  if (!Number.isInteger(firstScore) || !Number.isInteger(secondScore) ||
      firstScore < 0 || secondScore < 0 ||
      firstScore > target || secondScore > target ||
      (firstScore === target) === (secondScore === target)) {
    throw new Error('BO形式に合う最終スコアを入力してください。');
  }
}

export function advanceMatch(tournament, bracket, ri, mi, winnerId) {
  const match = bracket.rounds[ri][mi];
  if (!match?.player1 || !match?.player2 || match.winnerId) {
    throw new Error('対戦カードが更新されています。');
  }
  const winner = [match.player1, match.player2]
    .find(player => String(player.id) === String(winnerId));
  if (!winner) throw new Error('勝者が正しくありません。');
  match.winnerId = winner.id;
  match.matchState.complete = true;
  match.matchState.winnerId = winner.id;
  match.matchState.currentGame = null;
  match.matchState.pendingResult = null;
  delete match.resultType;
  if (ri < bracket.rounds.length - 1) {
    const next = bracket.rounds[ri + 1][Math.floor(mi / 2)];
    if (!next) throw new Error('後続の対戦カードがありません。');
    // A new winner advances into exactly one side of the next match.
    next[mi % 2 === 0 ? 'player1' : 'player2'] = winner;
    next.winnerId = null;
    next.matchState = null;
    delete next.resultType;
  }
  bracket.complete = Boolean(bracket.rounds.at(-1)?.[0]?.winnerId);
  return {
    ...tournament,
    bracket,
    status: bracket.complete ? '終了' : '対戦中',
    resultPlacements: bracket.complete ? getBracketPlacements(bracket) : null,
    completedAt: bracket.complete ? (tournament.completedAt || new Date().toISOString()) : null,
  };
}
