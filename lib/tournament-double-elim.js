// Double elimination graph. This module is independent of the UI and database.
// Every destination slot points to a fixed result source, so the first loss
// never has to be assigned by guessing which losers match is vacant.

export const isDoubleBracket = bracket => bracket?.type === 'double';

function game(id, sources = null, first = null, second = null) {
  return {
    id, player1: first, player2: second, winnerId: null,
    ...(sources ? { sources } : {}),
  };
}

function link(from, result, to, slot) {
  if (!to?.sources || slot < 0 || slot > 1 || to.sources[slot])
    throw new Error('ダブルエリミの移動先が重複しています。');
  to.sources[slot] = { matchId: from.id, result };
}

// slots are ordered exactly as in the site's existing single-elimination
// seeded/random draw (including nulls for first-round byes).
export function makeDoubleBracket(slots) {
  if (!Array.isArray(slots) || slots.length < 2 ||
      (slots.length & (slots.length - 1)) !== 0 ||
      slots.filter(Boolean).length < 2) throw new Error('参加人数が不正です。');
  const size = slots.length;
  const winnerCount = Math.log2(size);
  const loserCount = 2 * (winnerCount - 1);
  const winners = Array.from({ length: winnerCount }, (_, r) =>
    Array.from({ length: size / 2 ** (r + 1) }, (_, i) =>
      game('w' + (r + 1) + '-m' + (i + 1),
        r ? [null, null] : null,
        r === 0 ? slots[i * 2] : null,
        r === 0 ? slots[i * 2 + 1] : null)));
  const losers = Array.from({ length: loserCount }, (_, r) =>
    Array.from({ length: size / 2 ** (Math.floor(r / 2) + 2) }, (_, i) =>
      game('l' + (r + 1) + '-m' + (i + 1), [null, null])));
  const grandFinal = game('gf-1', [null, null]);
  const grandReset = game('gf-2', [null, null]);
  for (let r = 0; r < winnerCount; r++) {
    for (let i = 0; i < winners[r].length; i++) {
      const match = winners[r][i];
      if (r < winnerCount - 1) {
        link(match, 'winner', winners[r + 1][Math.floor(i / 2)], i % 2);
      } else {
        link(match, 'winner', grandFinal, 0);
        link(match, 'winner', grandReset, 0);
      }
      if (r === 0 && winnerCount === 1) {
        link(match, 'loser', grandFinal, 1);
        link(match, 'loser', grandReset, 1);
      } else if (r === 0) {
        // Cross the two halves on LB entry, reducing immediate rematches.
        const half = losers[0].length;
        link(match, 'loser', losers[0][i % half], i < half ? 0 : 1);
      } else {
        // Each later WB round drops into every second LB column.
        const destRound = losers[2 * r - 1];
        const half = Math.floor(destRound.length / 2);
        const position = (i + half) % destRound.length;
        link(match, 'loser', destRound[position], 1);
      }
    }
  }
  for (let r = 0; r < loserCount; r++) {
    losers[r].forEach((match, i) => {
      if (r === loserCount - 1) {
        link(match, 'winner', grandFinal, 1);
        link(match, 'winner', grandReset, 1);
      } else if (r % 2 === 0) {
        link(match, 'winner', losers[r + 1][i], 0);
      } else {
        link(match, 'winner', losers[r + 1][Math.floor(i / 2)], i % 2);
      }
    });
  }
  const bracket = {
    type: 'double', winnerRounds: winnerCount, loserRounds: loserCount,
    rounds: [...winners, ...losers, [grandFinal], [grandReset]],
    complete: false, startedAt: new Date().toISOString(),
  };
  return reconcileDoubleBracket(bracket);
}

function samePlayer(a, b) {
  return (a == null && b == null) || Boolean(a && b && String(a.id) === String(b.id));
}
function resolved(match) {
  return Boolean(match && (match.winnerId != null || match.resultType === 'empty-bye'));
}
function resultPlayer(match, result) {
  if (!resolved(match) || match.winnerId == null) return null;
  const participants = [match.player1, match.player2];
  return participants.find(player => player && (result === 'winner'
    ? String(player.id) === String(match.winnerId)
    : String(player.id) !== String(match.winnerId))) || null;
}
function invalidate(match) {
  match.winnerId = null;
  match.matchState = null;
  delete match.resultType;
}
function recalculateMatch(match, byId, allowBye = true) {
  if (!Array.isArray(match.sources)) return;
  const sources = match.sources;
  const inputs = sources.map(source => {
    const feeder = byId.get(source?.matchId);
    return feeder ? resultPlayer(feeder, source.result) : null;
  });
  const allResolved = sources.every(source => resolved(byId.get(source?.matchId)));
  if (!samePlayer(match.player1, inputs[0]) || !samePlayer(match.player2, inputs[1])) {
    invalidate(match);
    [match.player1, match.player2] = inputs;
  }
  // A single known player must NOT advance when the other source has not
  // finished. Empty branches caused by actual byes, however, can advance.
  const count = inputs.filter(Boolean).length;
  if (!allResolved || !allowBye) {
    if (match.resultType === 'bye' || match.resultType === 'empty-bye')
      invalidate(match);
  } else if (count === 0) {
    invalidate(match);
    match.resultType = 'empty-bye';
  } else if (count === 1) {
    const winner = inputs.find(Boolean);
    if (match.winnerId == null || String(match.winnerId) !== String(winner.id) ||
        match.resultType !== 'bye') invalidate(match);
    match.winnerId = winner.id;
    match.resultType = 'bye';
  } else if (match.resultType === 'bye' || match.resultType === 'empty-bye') {
    invalidate(match);
  }
  if (match.winnerId != null && !inputs.some(p => p && String(p.id) === String(match.winnerId)))
    invalidate(match);
}

export function reconcileDoubleBracket(bracket) {
  if (!isDoubleBracket(bracket)) return bracket;
  const all = bracket.rounds.flat();
  const byId = new Map(all.map(match => [String(match.id), match]));
  const winnerCount = bracket.winnerRounds;
  const loserCount = bracket.loserRounds;
  // First-round byes have no losing player and must be resolved before LB.
  for (const match of bracket.rounds[0]) {
    const present = [match.player1, match.player2].filter(Boolean);
    if (present.length === 1) {
      invalidate(match);
      match.winnerId = present[0].id;
      match.resultType = 'bye';
    }
  }
  for (let r = 1; r < winnerCount; r++)
    for (const match of bracket.rounds[r]) recalculateMatch(match, byId);
  for (let r = winnerCount; r < winnerCount + loserCount; r++)
    for (const match of bracket.rounds[r]) recalculateMatch(match, byId);
  const grand = bracket.rounds[winnerCount + loserCount][0];
  const reset = bracket.rounds[winnerCount + loserCount + 1][0];
  recalculateMatch(grand, byId, false);
  const resetNeeded = grand.winnerId != null && grand.player2 != null &&
    String(grand.winnerId) === String(grand.player2.id);
  if (resetNeeded) recalculateMatch(reset, byId, false);
  else if (reset.winnerId != null || reset.player1 || reset.player2 || reset.matchState) {
    invalidate(reset);
    reset.player1 = null;
    reset.player2 = null;
  }
  bracket.complete = Boolean(grand.winnerId != null &&
    (String(grand.winnerId) === String(grand.player1?.id) ||
     (resetNeeded && reset.winnerId != null)));
  return bracket;
}

export function doublePlacements(bracket) {
  if (!isDoubleBracket(bracket) || !bracket.complete) return [];
  const gf = bracket.rounds.at(-2)?.[0];
  const reset = bracket.rounds.at(-1)?.[0];
  const final = reset?.winnerId != null ? reset : gf;
  const winner = final?.winnerId;
  const runnerUp = [final?.player1, final?.player2].find(p =>
    p && String(p.id) !== String(winner));
  const lbFinal = bracket.loserRounds
    ? bracket.rounds[bracket.winnerRounds + bracket.loserRounds - 1][0] : null;
  const third = [lbFinal?.player1, lbFinal?.player2].find(p =>
    p && lbFinal.winnerId != null && String(p.id) !== String(lbFinal.winnerId));
  return [
    ...(winner != null ? [{ playerId: winner, place: '優勝' }] : []),
    ...(runnerUp ? [{ playerId: runnerUp.id, place: '準優勝' }] : []),
    ...(third ? [{ playerId: third.id, place: '3位' }] : []),
  ];
}

export function doubleCharacterPlacement(bracket, playerId) {
  if (!isDoubleBracket(bracket) || playerId == null) return null;
  const id = String(playerId);
  const realWins = bracket.rounds.flat().filter(match =>
    match.player1 && match.player2 &&
    match.resultType !== 'forfeit' && match.resultType !== 'bye' &&
    match.winnerId != null && String(match.winnerId) === id).length;
  if (!realWins) return null;
  if (bracket.loserRounds > 0) {
    const lbFinal = bracket.rounds[bracket.winnerRounds + bracket.loserRounds - 1][0];
    if (lbFinal?.winnerId != null && [lbFinal.player1, lbFinal.player2].some(p => p &&
        String(p.id) === id && String(lbFinal.winnerId) !== id)) return '3位';
  }
  if (!bracket.complete) return null;
  return doublePlacements(bracket).find(p => String(p.playerId) === id)?.place || null;
}
