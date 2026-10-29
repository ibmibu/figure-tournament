// A browser reload clears tab snapshots once. Client-side tab switches reuse them.
let initialized = false;
const memorySnapshots = new Map();
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
  if (memorySnapshots.has(key)) return memorySnapshots.get(key);
  try {
    const value = window.sessionStorage.getItem('figure-tab-' + key);
    if (!value) return null;
    const snapshot = JSON.parse(value);
    memorySnapshots.set(key, snapshot);
    return snapshot;
  } catch { return null; }
}
export function writeTabSnapshot(key, value) {
  initialize();
  memorySnapshots.set(key, value);
  try { window.sessionStorage.setItem('figure-tab-' + key, JSON.stringify(value)); } catch {}
}
