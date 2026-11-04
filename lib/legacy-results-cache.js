// Confirmed 人形劇 tournament results never change. Reuse the calculated
// per-player list instead of re-fetching and re-scanning the entire historical
// archive whenever someone visits Results or a player profile.
const MAX_AGE = 6 * 60 * 60 * 1000;
export async function loadLegacyParticipations(kind, userId, token = '') {
  const key = 'amiconne-legacy-participations-v1-' + kind + '-' + userId;
  let cached = null;
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (value?.version === 1 && Array.isArray(value.tournaments))
      cached = value;
  } catch {}
  if (cached && cached.savedAt <= Date.now() &&
      Date.now() - cached.savedAt < MAX_AGE)
    return { tournaments: cached.tournaments, stale: false };
  const url = kind === 'mine' ? '/api/results/legacy'
    : '/api/players/legacy?userId=' + encodeURIComponent(userId);
  try {
    const response = await fetch(url, {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('過去の人形劇データを取得できませんでした。');
    const payload = await response.json();
    const tournaments = Array.isArray(payload.tournaments) ? payload.tournaments : [];
    try {
      localStorage.setItem(key, JSON.stringify({
        version: 1, savedAt: Date.now(), tournaments,
      }));
    } catch {}
    return { tournaments, stale: false };
  } catch (error) {
    if (cached) return { tournaments: cached.tournaments, stale: true };
    throw error;
  }
}
