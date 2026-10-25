const TOURNAMENTS_KEY = 'figure-tournament-list-v1';

export function readTournamentCache() {
  try {
    const value = localStorage.getItem(TOURNAMENTS_KEY);
    const parsed = value ? JSON.parse(value) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeTournamentCache(tournaments) {
  try {
    localStorage.setItem(TOURNAMENTS_KEY, JSON.stringify(tournaments));
  } catch {}
}

export function updateCachedTournament(tournament) {
  const current = readTournamentCache() || [];
  const next = current.some(item => String(item.id) === String(tournament.id))
    ? current.map(item => String(item.id) === String(tournament.id) ? tournament : item)
    : [tournament, ...current];
  writeTournamentCache(next);
}

export function removeCachedTournament(id) {
  writeTournamentCache((readTournamentCache() || []).filter(item => String(item.id) !== String(id)));
}
