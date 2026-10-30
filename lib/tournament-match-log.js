import { randomUUID } from 'crypto';

// Keep only match/bracket state in history. Never store private profile data.
export function appendMatchLog(tournament, previous, matchId, actor, action) {
  const entries = Array.isArray(previous.matchLogs) ? previous.matchLogs : [];
  tournament.matchLogs = [...entries, {
    id: randomUUID(), matchId: String(matchId), at: new Date().toISOString(),
    actor: String(actor || ''), action: String(action),
    before: {
      bracket: previous.bracket,
      status: previous.status,
      resultPlacements: previous.resultPlacements ?? null,
      completedAt: previous.completedAt ?? null,
    },
    afterBracket: tournament.bracket,
  }].slice(-100);
}

function samePlayer(a, b) {
  return String(a?.id ?? '') === String(b?.id ?? '');
}

// Restore only the selected card, then reconcile its direct route to the final.
// Unrelated matches and the other feeder of each parent remain untouched.
export function rewindMatchPath(tournament, matchId, logId) {
  const entries = Array.isArray(tournament.matchLogs) ? tournament.matchLogs : [];
  const index = entries.findIndex(entry => entry.id === logId && String(entry.matchId) === String(matchId));
  if (index < 0 || !entries[index]?.before?.bracket) throw new Error('巻き戻す履歴が見つかりません。');
  const current = tournament.bracket;
  if (!current?.rounds?.length) throw new Error('トーナメント表がありません。');
  const rounds = structuredClone(current.rounds);
  const targetRound = rounds.findIndex(round => round.some(match => String(match.id) === String(matchId)));
  if (targetRound < 0) throw new Error('対戦カードが見つかりません。');
  let matchIndex = rounds[targetRound].findIndex(match => String(match.id) === String(matchId));
  const beforeMatch = entries[index].before.bracket.rounds?.[targetRound]?.[matchIndex];
  if (!beforeMatch || String(beforeMatch.id) !== String(matchId)) throw new Error('対戦カードの履歴が一致しません。');
  const affected = new Set([String(matchId)]);
  rounds[targetRound][matchIndex] = structuredClone(beforeMatch);

  for (let r = targetRound + 1; r < rounds.length; r++) {
    const parentIndex = Math.floor(matchIndex / 2);
    const parent = rounds[r][parentIndex];
    if (!parent) throw new Error('後続の対戦カードが見つかりません。');
    const feeders = [rounds[r - 1][parentIndex * 2], rounds[r - 1][parentIndex * 2 + 1]];
    const resolved = feeders.map(feeder =>
      [feeder?.player1, feeder?.player2].find(player =>
        player && feeder?.winnerId != null && String(player.id) === String(feeder.winnerId)
      ) || null
    );
    // If the feeder has changed, its descendant's result is no longer valid.
    if (!samePlayer(parent.player1, resolved[0]) || !samePlayer(parent.player2, resolved[1])) {
      parent.player1 = resolved[0];
      parent.player2 = resolved[1];
      parent.winnerId = null;
      parent.matchState = null;
      delete parent.resultType;
      affected.add(String(parent.id));
    }
    matchIndex = parentIndex;
  }

  const bracket = { ...current, rounds };
  bracket.complete = rounds.at(-1)?.[0]?.winnerId != null;
  const remainingLogs = entries.filter((entry, i) => i < index || !affected.has(String(entry.matchId)));
  return {
    ...tournament,
    bracket,
    matchLogs: remainingLogs,
    adminHistory: [],
    status: bracket.complete ? '終了' : '対戦中',
    resultPlacements: bracket.complete ? tournament.resultPlacements : null,
    completedAt: bracket.complete ? tournament.completedAt : null,
    rewindCount: entries.length - remainingLogs.length,
  };
}
