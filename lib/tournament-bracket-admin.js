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
