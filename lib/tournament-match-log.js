import { randomUUID } from 'crypto';
import { getBracketPlacements } from './tournament-bracket-admin';

// Match history is stored as one card per entry, not an entire bracket both
// before and after every result. Keep compactly rewindable records.
function matchFromBracket(bracket, matchId) {
  for (const round of bracket?.rounds || []) {
    const match = round.find(value => String(value?.id) === String(matchId));
    if (match) return match;
  }
  return null;
}
function compactMatchLog(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  if (entry.before?.match) {
    const { afterBracket, ...withoutAfter } = entry;
    return withoutAfter;
  }
  const before = matchFromBracket(entry.before?.bracket, entry.matchId);
  if (!before) return entry; // Preserve unknown old snapshots.
  const { afterBracket, before: old, ...rest } = entry;
  return {
    ...rest,
    before: { match: before, status: old.status,
      resultPlacements: old.resultPlacements ?? null,
      completedAt: old.completedAt ?? null },
  };
}
export function appendMatchLog(tournament, previous, matchId, actor, action) {
  const entries = Array.isArray(previous.matchLogs) ? previous.matchLogs : [];
  const before = matchFromBracket(previous.bracket, matchId);
  tournament.matchLogs = [...entries.map(compactMatchLog), {
    id: randomUUID(), matchId: String(matchId), at: new Date().toISOString(),
    actor: String(actor || ''), action: String(action),
    before: {
      match: before, status: previous.status,
      resultPlacements: previous.resultPlacements ?? null,
      completedAt: previous.completedAt ?? null,
    },
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
  if (index < 0 || !(entries[index]?.before?.match || entries[index]?.before?.bracket)) throw new Error('巻き戻す履歴が見つかりません。');
  const current = tournament.bracket;
  if (!current?.rounds?.length) throw new Error('トーナメント表がありません。');
  const rounds = structuredClone(current.rounds);
  const targetRound = rounds.findIndex(round => round.some(match => String(match.id) === String(matchId)));
  if (targetRound < 0) throw new Error('対戦カードが見つかりません。');
  let matchIndex = rounds[targetRound].findIndex(match => String(match.id) === String(matchId));
  const beforeMatch = entries[index].before.match ||
    entries[index].before.bracket?.rounds?.[targetRound]?.[matchIndex];
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
    resultPlacements: bracket.complete ? getBracketPlacements(bracket) : null,
    completedAt: bracket.complete ? tournament.completedAt : null,
  };
}
