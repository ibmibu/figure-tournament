// Select only matches belonging to the requested registered participant.
// The result exposes no private tournament, profile or friend-code data.
export function ownOverlayMatch(tournament, userId) {
  if (!tournament?.bracket?.rounds?.length || !userId) return null;
  const entry = (tournament.joinedPlayers || []).find(p =>
    !p?.isDemo && String(p.userId || p.id) === String(userId));
  if (!entry) return null;
  const matches = tournament.bracket.rounds.flatMap((round, roundIndex) =>
    (round || []).flatMap(match => {
      if (!match?.player1 || !match.player2 || match.player1.isDemo || match.player2.isDemo) return [];
      const mine = [match.player1, match.player2].some(p =>
        String(p.id) === String(entry.id) || String(p.userId || p.id) === String(userId));
      return mine ? [{ match, roundIndex }] : [];
    }));
  const latest = matches.filter(item => !item.match.winnerId).at(-1) ||
    [...matches].reverse().find(item => item.match.winnerId);
  if (!latest) return null;
  return latest;
}
export function findParticipantOverlay(rows, userId) {
  const candidates = (rows || []).map(row => {
    const tournament = row.data || {};
    if (!tournament.bracket?.rounds?.length) return null;
    const item = ownOverlayMatch(tournament, userId);
    if (!item) return null;
    const activeTournament = !tournament.bracket.complete &&
      (tournament.status === '対戦中' || tournament.status === 'キャラ宣言中' || tournament.status === '開始');
    const playing = activeTournament && !item.match.winnerId;
    const at = Date.parse(tournament.createdAt || row.created_at || '') || 0;
    return { row, item, priority: playing ? 3 : activeTournament ? 2 : 1, at };
  }).filter(Boolean);
  candidates.sort((a, b) => b.priority - a.priority || b.at - a.at);
  return candidates[0] || null;
}
