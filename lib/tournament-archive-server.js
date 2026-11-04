// Server-only read model. Finished public records are served by Vercel's
// static CDN from GitHub-tracked JSON; only the tiny update manifest and
// recent, not-yet-archived records touch Supabase (through the exporter).
// Do not use this module for mutable tournaments or confidential fields.
const INDEX = '/data/tournament-archive/index.json';
const EXPORT = '/api/archive/export';
async function readJSON(url, revalidate) {
  const response = await fetch(url, { next: { revalidate } });
  if (!response.ok) throw new Error('Archive read failed: ' + response.status);
  return response.json();
}
export async function loadServerArchivedTournamentRecords(request) {
  const base = new URL(request.url).origin;
  const [staticArchive, manifest] = await Promise.all([
    readJSON(base + INDEX, 45),
    readJSON(base + EXPORT + '?mode=index', 20),
  ]);
  if (staticArchive.version !== 1 || !Array.isArray(staticArchive.records) ||
      manifest.version !== 1 || !Array.isArray(manifest.records))
    throw new Error('Unrecognized tournament archive format');
  if (!staticArchive.records.length && !manifest.records.length)
    throw new Error('Initial tournament archive sync has not completed');
  const byId = new Map(staticArchive.records
    .filter(row => row?.fingerprint && row?.tournament?.id)
    .map(row => [String(row.tournament.id), row]));
  const missing = manifest.records.filter(row =>
    !byId.has(String(row.id)) || byId.get(String(row.id)).fingerprint !== row.fingerprint);
  for (let index = 0; index < missing.length; index += 20) {
    const batch = missing.slice(index, index + 20);
    const ids = batch.map(row => encodeURIComponent(row.id)).join(',');
    const latest = await readJSON(base + EXPORT + '?ids=' + ids, 10);
    if (latest.version !== 1 || !Array.isArray(latest.records) ||
        latest.records.length !== batch.length)
      throw new Error('Recent tournament archive update was incomplete');
    for (const record of latest.records) {
      const expected = batch.find(row => String(row.id) === String(record.id));
      if (!expected || expected.fingerprint !== record.fingerprint ||
          !record.tournament || String(record.tournament.id) !== String(record.id))
        throw new Error('Archive update fingerprint mismatch');
      byId.set(String(record.id), record);
    }
  }
  const records = manifest.records.map(row =>
    byId.get(String(row.id))?.tournament);
  if (records.some(row => !row)) throw new Error('Missing archive records');
  // Old deployed archives have no statsSnapshot. Never silently show an
  // incomplete ranking while GitHub Actions is backfilling the newer format.
  if (records.some(row => !('statsSnapshot' in row)))
    throw new Error('Archive statistics backfill pending');
  return records;
}
