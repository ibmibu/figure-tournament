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
