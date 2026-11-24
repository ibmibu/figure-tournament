// Team brackets have ONE entrant per registered captain. Teammates share that
// entrant but never become score controllers or independent bracket players.
export const isTeamTournament = tournament => tournament?.teamTournament === true;
export const teamCaptainId = player => String(player?.userId || player?.id || '');
export const teamMateId = player => String(player?.teamMate?.userId || player?.teamMate?.id || '');
export const isTeamMember = (player, userId) => Boolean(userId &&
  (teamCaptainId(player) === String(userId) || teamMateId(player) === String(userId)));
export const isTeamCaptain = (player, userId) => Boolean(userId &&
  teamCaptainId(player) === String(userId));
export function teamDisplayName(player) {
  if (!player) return '';
  return player.teamMate?.name
    ? String(player.name || '') + ' ＋ ' + String(player.teamMate.name)
    : String(player.name || '');
}
// Until bracket creation the roster stores invited teams and individual solo
// registrations separately. Auto-match solos by registration order, not random
// draw order. The final odd solo remains provisional and never enters a match.
export function teamRegistrationPlan(tournament) {
  const players = Array.isArray(tournament?.joinedPlayers) ? tournament.joinedPlayers : [];
  if (!isTeamTournament(tournament))
    return { teams: players, provisionalPlayers: [], soloPlayers: [], autoPairIds: [] };
  const teams = players.filter(player => player && player.teamMate);
  const soloPlayers = players.map((player, index) => ({ player, index }))
    .filter(entry => entry.player && !entry.player.teamMate)
    .sort((a, b) => {
      const first = Date.parse(a.player.joinedAt || '');
      const second = Date.parse(b.player.joinedAt || '');
      return Number.isFinite(first) && Number.isFinite(second) && first !== second
        ? first - second : a.index - b.index;
    }).map(entry => entry.player);
  const autoPairIds = [];
  for (let i = 0; i + 1 < soloPlayers.length; i += 2) {
    const captain = soloPlayers[i];
    const mate = soloPlayers[i + 1];
    autoPairIds.push(String(captain.id), String(mate.id));
    teams.push({ ...captain, teamMate: {
      id: mate.id, userId: mate.userId || mate.id, name: mate.name,
      friendCode: mate.friendCode || '', joinedAt: mate.joinedAt || '',
    } });
  }
  return {
    teams,
    provisionalPlayers: soloPlayers.length % 2 ? [soloPlayers[soloPlayers.length - 1]] : [],
    soloPlayers,
    autoPairIds,
  };
}
export function teamBracketEntrants(tournament) {
  const captains = isTeamTournament(tournament)
    ? teamRegistrationPlan(tournament).teams : tournament?.joinedPlayers || [];
  return isTeamTournament(tournament)
    ? captains.map(captain => ({ ...captain, name: teamDisplayName(captain) }))
    : captains;
}
export function isTeamEligibleForStats(tournament) {
  return !isTeamTournament(tournament);
}
