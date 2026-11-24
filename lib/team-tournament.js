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
export function teamBracketEntrants(tournament) {
  const captains = tournament?.joinedPlayers || [];
  return isTeamTournament(tournament)
    ? captains.map(captain => ({ ...captain, name: teamDisplayName(captain) }))
    : captains;
}
export function isTeamEligibleForStats(tournament) {
  return !isTeamTournament(tournament);
}
