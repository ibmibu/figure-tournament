// Browser-side read model for completed PUBLIC tournament results.
// GitHub-tracked JSON is the primary source. A tiny revision manifest from
// Supabase checks for newly completed/revised tournaments before the next
// GitHub Actions run; only those missing records are fetched from the DB.
// If the archive has not been deployed yet, preserve the old read as fallback.
const STATIC_INDEX = '/data/tournament-archive/index.json';
const EXPORT = '/api/archive/export';
async function json(response, error) {
  if (!response.ok) throw new Error(error + ' (' + response.status + ')');
  return response.json();
}
export async function loadCompletedTournamentRecords() {
  try {
    const [staticResponse, currentResponse] = await Promise.all([
      fetch(STATIC_INDEX, { cache: 'no-store' }),
      fetch(EXPORT + '?mode=index', { cache: 'no-store' }),
    ]);
    const [archive, manifest] = await Promise.all([
      json(staticResponse, 'GitHubアーカイブがまだ公開されていません'),
      json(currentResponse, '大会更新一覧を取得できませんでした'),
    ]);
    if (archive.version !== 1 || !Array.isArray(archive.records) ||
        manifest.version !== 1 || !Array.isArray(manifest.records))
      throw new Error('大会アーカイブの形式が正しくありません。');
    // An empty manifest during the first rollout is not evidence that the
    // user's historical results are empty. Use the established read instead
    // of accidentally presenting an empty record page.
    if (!manifest.records.length && !archive.records.length)
      throw new Error('初回アーカイブの同期前です。');
    const local = new Map(archive.records
      .filter(r => r?.tournament?.id && r?.fingerprint)
      .map(r => [String(r.tournament.id), r]));
    const missing = manifest.records.filter(r =>
      !local.has(String(r.id)) || local.get(String(r.id)).fingerprint !== r.fingerprint);
    for (let i = 0; i < missing.length; i += 20) {
      const batch = missing.slice(i, i + 20);
      const ids = batch.map(r => r.id);
      const response = await fetch(EXPORT + '?ids=' + ids.map(encodeURIComponent).join(','), { cache: 'no-store' });
      const payload = await json(response, '新しい大会結果を取得できませんでした');
      if (payload.version !== 1 || !Array.isArray(payload.records) ||
          payload.records.length !== batch.length)
        throw new Error('大会結果が更新されたため、再読み込みしてください。');
      for (const r of payload.records) {
        const expected = batch.find(b => String(b.id) === String(r.id));
        if (!expected || r.fingerprint !== expected.fingerprint || !r.tournament)
          throw new Error('大会結果の更新番号が一致しません。');
        local.set(String(r.id), r);
      }
    }
    return manifest.records.map(r => local.get(String(r.id))?.tournament).filter(Boolean);
  } catch (error) {
    // Existing results must remain accessible while archive backfill is
    // pending or on an archive error. Only this fallback fetches full records.
    console.warn('Public archive unavailable; using Supabase fallback:', error);
    const response = await fetch('/api/tournaments', { cache: 'no-store' });
    const payload = await json(response, '大会情報を読み込めませんでした');
    return (payload.tournaments || []).filter(t => t.bracket?.complete === true);
  }
}
