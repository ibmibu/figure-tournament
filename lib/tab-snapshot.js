// A browser reload clears tab snapshots once. Client-side tab switches reuse them.
let initialized = false;
function initialize() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  if (window.performance?.getEntriesByType?.('navigation')?.[0]?.type === 'reload') {
    try {
      for (const key of Object.keys(window.sessionStorage)) {
        if (key.startsWith('figure-tab-')) window.sessionStorage.removeItem(key);
      }
    } catch {}
  }
}
export function readTabSnapshot(key) {
  initialize();
  try {
    const value = window.sessionStorage.getItem('figure-tab-' + key);
    return value ? JSON.parse(value) : null;
  } catch { return null; }
}
export function writeTabSnapshot(key, value) {
  initialize();
  try { window.sessionStorage.setItem('figure-tab-' + key, JSON.stringify(value)); } catch {}
}
