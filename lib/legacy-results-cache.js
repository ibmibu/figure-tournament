// Immutable 人形劇 historical participation lists are cached across browser
// restarts. An old ID association may still change: the shared manifest has a
// separate account-link revision for that case.
import { loadHistoryRevision } from './history-revision-client';

export async function loadLegacyParticipations(kind, userId, token = '') {
  const key = 'amiconne-legacy-participations-v2-' + kind + '-' + userId;
  const oldKey = 'amiconne-legacy-participations-v1-' + kind + '-' + userId;
  let cached = null;
  let old = null;
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (value?.version === 2 && Array.isArray(value.tournaments))
      cached = value;
    const previous = JSON.parse(localStorage.getItem(oldKey) || 'null');
    if (previous?.version === 1 && Array.isArray(previous.tournaments))
      old = previous.tournaments;
  } catch {}

  let manifest = null;
  try { manifest = await loadHistoryRevision(); }
  catch (error) { console.warn('Old ID association version unavailable:', error); }
  const revision = manifest?.verified ? manifest.identityRevision : '';
  // The list itself has no expiration. Only changed user/legacy ID links
  // warrant recalculating it from the immutable old tournament source.
  if (cached && (!revision || cached.revision === revision))
    return { tournaments: cached.tournaments, stale: !manifest?.verified };

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
    if (revision) {
      try {
        localStorage.setItem(key, JSON.stringify({
          version: 2, revision, tournaments,
        }));
        localStorage.removeItem(oldKey);
      } catch {}
    }
    return { tournaments, stale: false };
  } catch (error) {
    if (cached || old) return {
      tournaments: cached?.tournaments || old, stale: true,
    };
    throw error;
  }
}
