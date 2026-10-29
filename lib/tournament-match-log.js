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
