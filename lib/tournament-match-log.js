import { randomUUID } from 'crypto';

// A match log is an audit trail for display only. Do not save a full bracket
// or match snapshot here: match-result updates and live polling must stay small.
// Keep legacy entries unchanged until an explicitly approved archival cleanup.
export function appendMatchLog(tournament, previous, matchId, actor, action) {
  const entries = Array.isArray(previous.matchLogs) ? previous.matchLogs : [];
  tournament.matchLogs = [...entries, {
    id: randomUUID(),
    matchId: String(matchId),
    at: new Date().toISOString(),
    actor: String(actor || ''),
    action: String(action),
  }].slice(-100);
}
