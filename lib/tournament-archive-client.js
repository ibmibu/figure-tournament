// Browser read model for completed PUBLIC tournament results.
// Results and their fingerprints persist across browser restarts. Every
// navigation reuses them unless the *small shared manifest* reports a change.
import { loadHistoryRevision } from './history-revision-client';

const STATIC_INDEX = '/data/tournament-archive/index.json';
const EXPORT = '/api/archive/export';
const KEY = 'amiconne-completed-archive-v3';
const PRIOR_KEY = 'amiconne-completed-archive-v2';
let pendingLoad = null;

function storedArchive() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (data?.version === 3 && typeof data.revision === 'string' &&
        Array.isArray(data.rows) && data.rows.every(row =>
          row?.tournament?.id && typeof row.fingerprint === 'string'))
      return data;
  } catch {}
  return null;
}
function priorArchive() {
  try {
    const prior = JSON.parse(localStorage.getItem(PRIOR_KEY) || 'null');
    return prior?.version === 2 && Array.isArray(prior.records) ? prior.records : null;
  } catch { return null; }
}
function saveArchive(rows, revision) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: 3, revision, rows }));
    // The old format has no per-tournament fingerprints and is superseded.
    localStorage.removeItem(PRIOR_KEY);
  } catch { /* Storage quota/full/private browsing: network path still works. */ }
}
async function json(url, error) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(error + ' (' + response.status + ')');
  return response.json();
}
function recordsOf(rows) { return rows.map(row => row.tournament); }

async function refreshCompletedRecords() {
  const cached = storedArchive();
  try {
    const manifest = await loadHistoryRevision();
    if (!manifest.verified && cached) return recordsOf(cached.rows);
    if (!manifest.verified) throw new Error('大会更新一覧を検証できませんでした。');
    if (cached && cached.revision === manifest.revision)
      return recordsOf(cached.rows);

    const local = new Map();
    if (cached) {
      for (const row of cached.rows)
        local.set(String(row.tournament.id), row);
    } else {
      // A first visit loads the static GitHub index once. Subsequent visits
      // never re-download the full index merely because 30 minutes elapsed.
      const archive = await json(STATIC_INDEX, 'GitHubアーカイブを取得できませんでした');
      if (archive.version !== 1 || !Array.isArray(archive.records))
        throw new Error('大会アーカイブの形式が正しくありません。');
      for (const row of archive.records)
        if (row?.tournament?.id && row.fingerprint)
          local.set(String(row.tournament.id), row);
    }

    // Only new or revised event summaries are loaded. Removed/reopened events
    // are dropped by ordering the final rows from the live manifest alone.
    const missing = manifest.records.filter(row =>
      !local.has(row.id) || local.get(row.id).fingerprint !== row.fingerprint);
    for (let offset = 0; offset < missing.length; offset += 20) {
      const batch = missing.slice(offset, offset + 20);
      const response = await json(
        EXPORT + '?ids=' + batch.map(row => encodeURIComponent(row.id)).join(','),
        '新しい大会結果を取得できませんでした'
      );
      if (response.version !== 1 || !Array.isArray(response.records) ||
          response.records.length !== batch.length)
        throw new Error('大会結果の差分が不完全です。');
      for (const row of response.records) {
        const expected = batch.find(item => String(item.id) === String(row.id));
        if (!expected || expected.fingerprint !== row.fingerprint ||
            String(row.tournament?.id) !== String(row.id))
          throw new Error('大会結果の更新番号が一致しません。');
        local.set(String(row.id), {
          fingerprint: row.fingerprint, tournament: row.tournament,
        });
      }
    }
    const rows = manifest.records.map(row => local.get(row.id));
    if (rows.some(row => !row?.tournament))
      throw new Error('大会アーカイブに未取得の記録があります。');
    // Never overwrite a populated older history with a transient empty
    // exporter response (for example during the first rollout).
    if (!rows.length && (cached?.rows.length || priorArchive()?.length))
      throw new Error('大会アーカイブの初回同期が完了していません。');
    saveArchive(rows, manifest.revision);
    return recordsOf(rows);
  } catch (error) {
    console.warn('Completed tournament archive validation failed:', error);
    // An offline read must not discard perfectly good saved historical data.
    if (cached) return recordsOf(cached.rows);
    const old = priorArchive();
    if (old) return old;
    // Only a browser without any usable archive ever needs the old
    // heavy Supabase endpoint as last-resort compatibility fallback.
    const all = await json('/api/tournaments', '大会記録を読み込めませんでした');
    return (all.tournaments || []).filter(row => row.bracket?.complete === true);
  }
}

export function loadCompletedTournamentRecords() {
  if (pendingLoad) return pendingLoad;
  pendingLoad = refreshCompletedRecords().finally(() => { pendingLoad = null; });
  return pendingLoad;
}
