// Navigation between tabs uses the current tab-session snapshot.
// A full browser reload bypasses this snapshot and fetches fresh server data.
export function isFullPageReload() {
  if (typeof window === 'undefined') return false;
  return window.performance?.getEntriesByType?.('navigation')?.[0]?.type === 'reload';
}
export function readTabSnapshot(key) {
  if (typeof window === 'undefined' || isFullPageReload()) return null;
  try {
    const value = window.sessionStorage.getItem('figure-tab-' + key);
    return value ? JSON.parse(value) : null;
  } catch { return null; }
}
export function writeTabSnapshot(key, value) {
  try { window.sessionStorage.setItem('figure-tab-' + key, JSON.stringify(value)); } catch {}
}
