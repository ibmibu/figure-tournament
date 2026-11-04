// Browser-side, version-based historical cache validation.
//
// A 30-minute timer limits *small manifest checks*, not the lifetime of
// tournaments or derived rankings. Cached payloads never expire merely
// because time passed. A new finished event, report, correction or account
// link changes the relevant revision and invalidates only affected results.
const KEY = 'amiconne-history-revision-v1';
const CHECK_INTERVAL = 30 * 60 * 1000;
let inFlight = null;
let generation = 0;

function readStored() {
  try {
    const item = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (item?.version !== 1 || !Array.isArray(item.records) ||
        typeof item.revision !== 'string' || !item.revision ||
        !Number.isFinite(item.checkedAt) || item.checkedAt > Date.now() + 60000)
      return null;
    return item;
  } catch { return null; }
}

function normalizedManifest(payload) {
  if (payload?.version !== 1 || !Array.isArray(payload.records))
    throw new Error('大会更新一覧の形式が正しくありません。');
  const records = payload.records.map(row => ({
    id: String(row.id || ''), fingerprint: String(row.fingerprint || ''),
  }));
  if (records.some(row => !/^[A-Za-z0-9_-]{1,128}$/.test(row.id) ||
      !/^[0-9a-f]{24}$/.test(row.fingerprint)))
    throw new Error('大会更新番号が正しくありません。');
  // The fallback supports a brief mixed deployment while the new exporter
  // revision field is rolling out. Both methods include every fingerprint.
  const revision = payload.revision || records
    .map(row => row.id + ':' + row.fingerprint).sort().join('|') || 'empty';
  return {
    version: 1, checkedAt: Date.now(),
    revision, identityRevision: String(payload.identityRevision || ''),
    records,
  };
}

export async function loadHistoryRevision() {
  const stored = readStored();
  if (stored && Date.now() - stored.checkedAt < CHECK_INTERVAL)
    return { ...stored, verified: true };
  if (inFlight) return inFlight;
  const myGeneration = generation;
  const task = (async () => {
    try {
      const response = await fetch('/api/archive/export?mode=index', { cache: 'no-store' });
      if (!response.ok) throw new Error('大会更新情報を取得できませんでした。');
      const item = normalizedManifest(await response.json());
      if (myGeneration === generation) {
        try { localStorage.setItem(KEY, JSON.stringify(item)); } catch {}
      }
      return { ...item, verified: true };
    } catch (error) {
      // Offline visitors may keep reading old results. Do not extend the
      // check TTL after an error; the next visit will retry validation.
      if (stored) return { ...stored, verified: false };
      throw error;
    }
  })();
  inFlight = task;
  try { return await task; }
  finally { if (inFlight === task) inFlight = null; }
}

export function rankingHistoryRevision(manifest) {
  return manifest.revision + ':' + (manifest.identityRevision || 'unversioned');
}

export function invalidateHistoryRevision() {
  generation++;
  try { localStorage.removeItem(KEY); } catch {}
}
