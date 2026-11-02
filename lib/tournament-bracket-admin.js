// Pure bracket mutations for tournament organizers. Never trust client-submitted brackets.
const samePlayer = (a, b) => String(a?.id ?? '') === String(b?.id ?? '');

export function getBracketPlacements(bracket) {
  if (!bracket?.complete || !bracket.rounds?.length) return [];
  const rounds = bracket.rounds;
  const final = rounds.at(-1)?.[0];
  const rows = [];
  if (final?.winnerId != null) rows.push({ playerId: final.winnerId, place: '優勝' });
  const runnerUp = [final?.player1, final?.player2].find(
    player => player && String(player.id) !== String(final.winnerId)
  );
  if (runnerUp) rows.push({ playerId: runnerUp.id, place: '準優勝' });
  for (let r = rounds.length - 2; r >= 0; r--) {
    const label = r === rounds.length - 2 ? '3位' : r === rounds.length - 3 ? 'ベスト8' : `ベスト${2 ** (rounds.length - r)}`;
    for (const match of rounds[r]) {
      if (match.winnerId == null) continue;
      const loser = [match.player1, match.player2].find(
        player => player && String(player.id) !== String(match.winnerId)
      );
      if (loser) rows.push({ playerId: loser.id, place: label });
    }
  }
  return rows;
}

export function updateBracketMatch(tournament, matchId, action, winnerId) {
  if (!tournament?.bracket?.rounds?.length) throw new Error('トーナメント表がありません。');
  if (!['reset', 'forfeit'].includes(action)) throw new Error('操作が正しくありません。');

  const bracket = JSON.parse(JSON.stringify(tournament.bracket));
  const rounds = bracket.rounds;
  let roundIndex = -1;
  let matchIndex = -1;
  for (let r = 0; r < rounds.length; r++) {
    const index = rounds[r].findIndex(match => String(match.id) === String(matchId));
    if (index !== -1) {
      roundIndex = r;
      matchIndex = index;
      break;
    }
  }
  if (roundIndex < 0) throw new Error('対戦カードが見つかりません。');

  const match = rounds[roundIndex][matchIndex];
  if (!match.player1 || !match.player2) {
    throw new Error('対戦相手が両方決まったカードだけ操作できます。');
  }
  if (action === 'reset') {
    if (!match.winnerId && !match.matchState) throw new Error('リセットする結果がありません。');
    match.winnerId = null;
    match.matchState = null;
    delete match.resultType;
  } else {
    const winner = [match.player1, match.player2].find(player => String(player.id) === String(winnerId));
    if (!winner) throw new Error('不戦勝にする選手を選択してください。');
    match.winnerId = winner.id;
    match.matchState = null;
    match.resultType = 'forfeit';
  }

  // Only the path that leads from the edited match to the final is invalidated.
  // A parent match is retained when its two players are still unchanged.
  let affectedIndex = matchIndex;
  for (let r = roundIndex + 1; r < rounds.length; r++) {
    const parentIndex = Math.floor(affectedIndex / 2);
    const parent = rounds[r][parentIndex];
    const feeders = [rounds[r - 1][parentIndex * 2], rounds[r - 1][parentIndex * 2 + 1]];
    const resolvedPlayers = feeders.map(feeder =>
      [feeder?.player1, feeder?.player2].find(
        player => player && feeder?.winnerId != null && String(player.id) === String(feeder.winnerId)
      ) || null
    );
    if (!samePlayer(parent.player1, resolvedPlayers[0]) || !samePlayer(parent.player2, resolvedPlayers[1])) {
      parent.player1 = resolvedPlayers[0];
      parent.player2 = resolvedPlayers[1];
      parent.winnerId = null;
      parent.matchState = null;
      delete parent.resultType;
    }
    affectedIndex = parentIndex;
  }

  bracket.complete = rounds.at(-1)?.[0]?.winnerId != null;
  return {
    ...tournament,
    bracket,
    status: bracket.complete ? '終了' : '対戦中',
    resultPlacements: bracket.complete ? getBracketPlacements(bracket) : null,
    completedAt: bracket.complete ? (tournament.completedAt || new Date().toISOString()) : null,
  };
}

/** Organizer-only game-score correction. Never modify unrelated bracket branches. */
export function correctBracketScore(tournament, matchId, firstScore, secondScore) {
  if (!tournament?.bracket?.rounds?.length) throw new Error('トーナメント表がありません。');
  const target = Number(tournament.bestOf) === 5 ? 3 : 2;
  const isValid = n => Number.isInteger(n) && n >= 0 && n <= target;
  if (!isValid(firstScore) || !isValid(secondScore) ||
      (firstScore === target && secondScore === target)) {
    throw new Error('BO形式に合うスコアを指定してください。');
  }

  const bracket = JSON.parse(JSON.stringify(tournament.bracket));
  const rounds = bracket.rounds;
  let ri = -1, mi = -1;
  for (let r = 0; r < rounds.length; r++) {
    const idx = rounds[r].findIndex(m => String(m.id) === String(matchId));
    if (idx !== -1) { ri = r; mi = idx; break; }
  }
  if (ri === -1) throw new Error('対戦カードが見つかりません。');
  const match = rounds[ri][mi];
  if (!match.player1 || !match.player2 || match.player1.isDemo || match.player2.isDemo) {
    throw new Error('対戦相手が両方決まったカードのみ修正できます。');
  }
  const p1 = String(match.player1.id), p2 = String(match.player2.id);
  if (p1 === p2) throw new Error('対戦カードが不正です。');
  const previousScore = match.matchState?.score || {};
  if (match.matchState && Number(previousScore[p1] || 0) === firstScore &&
      Number(previousScore[p2] || 0) === secondScore) {
    throw new Error('スコアが変更されていません。');
  }

  const oldWinner = match.winnerId == null ? null : String(match.winnerId);
  const nextWinner = firstScore === target ? p1 : secondScore === target ? p2 : null;
  const lastWinner = firstScore >= secondScore ? match.player1.id : match.player2.id;
  const finished = nextWinner !== null;
  const isOpening = firstScore + secondScore === 0;
  // Old stage choices and votes belong to the previous game number.
  // Rebuild only this match's current game; leave every other match intact.
  match.matchState = {
    score: { [p1]: firstScore, [p2]: secondScore }, games: [],
    gameNumber: firstScore + secondScore + 1,
    currentGame: finished ? null : {
      firstPlayerId: lastWinner, previousWinnerId: isOpening ? null : lastWinner,
      rejects: [], rejectVotes: {}, results: {},
      stage: tournament.stageRejects ? null : 'なし',
      chooserId: tournament.stageRejects ? null : lastWinner,
    },
    complete: finished, winnerId: finished ? nextWinner : null,
  };
  match.winnerId = nextWinner === p1 ? match.player1.id :
    nextWinner === p2 ? match.player2.id : null;
  delete match.resultType;

  // Only changing the set winner can affect the later rounds.
  // Recompute direct ancestors; reset them only if their participants changed.
  if (oldWinner !== nextWinner) {
    let matchIndex = mi;
    for (let r = ri + 1; r < rounds.length; r++) {
      const parentIndex = Math.floor(matchIndex / 2);
      const parent = rounds[r][parentIndex];
      if (!parent) throw new Error('後続の対戦カードが見つかりません。');
      const previousRound = rounds[r - 1];
      const feeders = [previousRound[parentIndex * 2], previousRound[parentIndex * 2 + 1]];
      const players = feeders.map(feeder =>
        [feeder?.player1, feeder?.player2].find(p =>
          p && feeder?.winnerId != null && String(p.id) === String(feeder.winnerId)
        ) || null
      );
      if (!samePlayer(parent.player1, players[0]) || !samePlayer(parent.player2, players[1])) {
        parent.player1 = players[0];
        parent.player2 = players[1];
        parent.winnerId = null;
        parent.matchState = null;
        delete parent.resultType;
      }
      matchIndex = parentIndex;
    }
  }
  bracket.complete = Boolean(rounds.at(-1)?.[0]?.winnerId);
  return {
    ...tournament, bracket,
    status: bracket.complete ? '終了' : '対戦中',
    resultPlacements: bracket.complete ? getBracketPlacements(bracket) : null,
    completedAt: bracket.complete ? (tournament.completedAt || new Date().toISOString()) : null,
  };
}

/**
 * Fix historic bracket data where a one-player card was automatically promoted
 * through later rounds. First-round seed byes remain valid, and completed
 * two-player matches are kept. This function never mutates its input.
 */
export function repairPrematureAdvances(tournament) {
  const originalRounds = tournament?.bracket?.rounds;
  if (!Array.isArray(originalRounds) || originalRounds.length < 2) return tournament;
  const bracket = JSON.parse(JSON.stringify(tournament.bracket));
  const rounds = bracket.rounds;
  const sameId = (a, b) => a == null && b == null ||
    Boolean(a && b && String(a.id) === String(b.id));
  const winnerFrom = match => match?.winnerId == null ? null :
    [match.player1, match.player2].find(player =>
      player && String(player.id) === String(match.winnerId)) || null;
  let changed = false;
  for (let ri = 1; ri < rounds.length; ri++) {
    for (let mi = 0; mi < rounds[ri].length; mi++) {
      const match = rounds[ri][mi];
      const feeders = rounds[ri - 1];
      const first = winnerFrom(feeders[mi * 2]);
      const second = winnerFrom(feeders[mi * 2 + 1]);
      if (!sameId(match.player1, first) || !sameId(match.player2, second)) {
        match.player1 = first;
        match.player2 = second;
        match.winnerId = null;
        match.matchState = null;
        delete match.resultType;
        changed = true;
      }
      if (match.winnerId != null &&
          (!match.player1 || !match.player2 || !winnerFrom(match))) {
        match.winnerId = null;
        match.matchState = null;
        delete match.resultType;
        changed = true;
      }
    }
  }
  if (!changed) return tournament;
  const final = rounds.at(-1)?.[0];
  const complete = Boolean(final?.player1 && final?.player2 && winnerFrom(final));
  bracket.complete = complete;
  const repaired = { ...tournament, bracket };
  if (!complete) {
    if (['終了', '終了済み', '大会終了'].includes(tournament.status)) repaired.status = '対戦中';
    if (tournament.resultPlacements != null) repaired.resultPlacements = null;
    if (tournament.completedAt != null) repaired.completedAt = null;
  }
  return repaired;
}

/**
 * A semifinal loser can report third place immediately; finalists must wait
 * until the final is decided. At least one actual (non-forfeit) win is required.
 * This is shared by the UI and the authoritative reporting API.
 */
export function getCharacterReportPlacement(bracket, playerId) {
  if (playerId == null || !Array.isArray(bracket?.rounds)) return null;
  const rounds = bracket.rounds;
  const id = String(playerId);
  const realWins = rounds.flat().filter(match =>
    match?.player1 && match?.player2 &&
    match.resultType !== 'forfeit' &&
    match.winnerId != null && String(match.winnerId) === id
  ).length;
  if (!realWins) return null;

  if (rounds.length >= 2) {
    for (const semi of rounds[rounds.length - 2]) {
      if (!semi?.player1 || !semi?.player2 || semi.winnerId == null) continue;
      const participants = [semi.player1, semi.player2];
      if (!participants.some(player => String(player.id) === String(semi.winnerId))) continue;
      const loser = participants.find(player => String(player.id) !== String(semi.winnerId));
      if (loser && String(loser.id) === id) return '3位';
    }
  }
  const final = rounds.at(-1)?.[0];
  if (bracket.complete !== true || !final?.player1 || !final?.player2 || final.winnerId == null) return null;
  const finalists = [final.player1, final.player2];
  if (!finalists.some(player => String(player.id) === String(final.winnerId))) return null;
  if (!finalists.some(player => String(player.id) === id)) return null;
  return String(final.winnerId) === id ? '優勝' : '準優勝';
}
