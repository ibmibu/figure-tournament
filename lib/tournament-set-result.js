import { getBracketPlacements } from './tournament-bracket-admin';

// Once a match starts, its reporting mode stays fixed if stream assignment changes.
// Old matches without a stored mode fall back to the historic stage configuration.
export function getMatchReportMode(tournament, match) {
  if (tournament.stageRejects) return 'games';
  const stored = match?.matchState?.reportMode;
  if (stored === 'stream' || stored === 'set') return stored;
  if (!match?.matchState && tournament.streamMatchId != null &&
      String(tournament.streamMatchId) === String(match?.id)) return 'stream';
  return 'set';
}

export function initializeScoreState(tournament, match, mode) {
  if (!match.matchState) {
    match.matchState = {
      reportMode: mode, gameNumber: 1,
      score: { [match.player1.id]: 0, [match.player2.id]: 0 },
      games: [], currentGame: null, complete: false,
      pendingResult: null,
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
