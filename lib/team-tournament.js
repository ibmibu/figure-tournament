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
// Registration order decides ONLY who gets a slot in the solo draw.
// No solo pairing is made or revealed before tournament start.
export function teamRegistrationPlan(tournament) {
  const players = Array.isArray(tournament?.joinedPlayers) ? tournament.joinedPlayers : [];
  if (!isTeamTournament(tournament))
    return { teams: players, teamCount: players.length, provisionalPlayers: [],
      eligibleSoloPlayers: [], soloPlayers: [] };
  const teams = players.filter(player => player && player.teamMate);
  const soloPlayers = players.map((player, index) => ({ player, index }))
    .filter(entry => entry.player && !entry.player.teamMate)
    .sort((a, b) => {
      const first = Date.parse(a.player.joinedAt || '');
      const second = Date.parse(b.player.joinedAt || '');
      return Number.isFinite(first) && Number.isFinite(second) && first !== second
        ? first - second : a.index - b.index;
    }).map(entry => entry.player);
  const eligibleCount = soloPlayers.length - (soloPlayers.length % 2);
  return {
    teams, // Previously invited/fixed pairs only; solo partners are undecided.
    teamCount: teams.length + eligibleCount / 2,
    provisionalPlayers: soloPlayers.slice(eligibleCount),
    eligibleSoloPlayers: soloPlayers.slice(0, eligibleCount),
    soloPlayers,
  };
}

// Called on the organizer's Start action, never while rendering signup lists.
// Shuffle eligible solo entrants first, then pair adjacent shuffled entrants.
export function drawRandomTeamRoster(tournament, random = Math.random) {
  const plan = teamRegistrationPlan(tournament);
  const pool = [...plan.eligibleSoloPlayers];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const order = new Map(plan.soloPlayers.map((player, index) => [String(player.id), index]));
  const teams = [...plan.teams];
  for (let i = 0; i < pool.length; i += 2) {
    const pair = [pool[i], pool[i + 1]].sort((a, b) =>
      order.get(String(a.id)) - order.get(String(b.id)));
    const [captain, mate] = pair;
    teams.push({ ...captain, teamMate: {
      id: mate.id, userId: mate.userId || mate.id, name: mate.name,
      friendCode: mate.friendCode || '', joinedAt: mate.joinedAt || '',
    } });
  }
  return { teams, provisionalPlayers: plan.provisionalPlayers };
}

// The browser can suggest a randomized pairing, but the API must reconstruct
// it from the current authoritative registration roster before persisting.
export function rebuildDrawnTeamRoster(tournament, submittedTeams) {
  if (!isTeamTournament(tournament) || !Array.isArray(submittedTeams)) return null;
  const plan = teamRegistrationPlan(tournament);
  if (submittedTeams.length !== plan.teamCount) return null;
  const fixed = new Map(plan.teams.map(team => [String(team.id), team]));
  const eligible = new Map(plan.eligibleSoloPlayers.map(player => [String(player.id), player]));
  const order = new Map(plan.soloPlayers.map((player, index) => [String(player.id), index]));
  const used = new Set();
  const output = [];
  for (const submitted of submittedTeams) {
    const captainId = String(submitted?.id || '');
    if (!captainId || used.has(captainId)) return null;
    const existing = fixed.get(captainId);
    if (existing) {
      if (String(submitted?.teamMate?.id || '') !== String(existing.teamMate?.id || '') ||
          String(submitted.name || '') !== String(existing.name || '')) return null;
      used.add(captainId);
      output.push(existing);
      continue;
    }
    const captain = eligible.get(captainId);
    const mateId = String(submitted?.teamMate?.id || '');
    const mate = eligible.get(mateId);
    if (!captain || !mate || captainId === mateId || used.has(mateId) ||
        String(submitted.name || '') !== String(captain.name || '') ||
        String(submitted?.teamMate?.name || '') !== String(mate.name || '') ||
        order.get(captainId) > order.get(mateId)) return null;
    used.add(captainId);
    used.add(mateId);
    output.push({ ...captain, teamMate: {
      id: mate.id, userId: mate.userId || mate.id, name: mate.name,
      friendCode: mate.friendCode || '', joinedAt: mate.joinedAt || '',
    } });
  }
  const requiredIds = [...fixed.keys(), ...eligible.keys()];
  if (requiredIds.some(id => !used.has(id)) || used.size !== requiredIds.length) return null;
  return output;
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
