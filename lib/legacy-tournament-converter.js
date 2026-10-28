// Lossless, read-only normalization of archived Smashmate results to AmiCone's
// tournament model. The source archive remains the canonical backup.
const aliases = { '99450':'145071','118591':'149650','148400':'164481','80108':'142959','100389':'167992','159344':'167992','156108':'156414' };
export function canonicalLegacyId(value) {
  let id = String(value);
  const seen = new Set();
  while (aliases[id] && !seen.has(id)) { seen.add(id); id = aliases[id]; }
  return id;
}
export function convertLegacyArchive(archive) {
  const source = archive?.data || archive;
  if (!Array.isArray(source?.tournaments) || !Array.isArray(source?.records) || !Array.isArray(source?.players)) throw new Error('Invalid legacy archive');
  const players = new Map(source.players.map(p => [canonicalLegacyId(p.id), { id: canonicalLegacyId(p.id), name: p.name || String(p.id), legacyPlayerId: String(p.id) }]));
  const records = new Map();
  for (const r of source.records) {
    const n = Number(r.tournamentNumber);
    if (!Number.isFinite(n)) continue;
    if (!records.has(n)) records.set(n, []);
    records.get(n).push(r);
  }
  return source.tournaments.map(t => {
    const number = Number(t.number);
    const matches = records.get(number) || [];
    const ids = [...new Set(matches.flatMap(m => [canonicalLegacyId(m.winnerId), canonicalLegacyId(m.loserId)]))];
    const losers = new Set(matches.map(m => canonicalLegacyId(m.loserId)));
    const undefeated = ids.filter(id => !losers.has(id));
    const championId = undefeated.length === 1 ? undefeated[0] : null;
    const wins = new Map();
    for (const m of matches) { const id = canonicalLegacyId(m.winnerId); wins.set(id, (wins.get(id) || 0) + 1); }
    const finalRoundWins = Math.max(1, Math.ceil(Math.log2(ids.length)));
    const resultPlacements = ids.map(id => {
      const count = wins.get(id) || 0;
      const place = id === championId ? '優勝' : count >= finalRoundWins - 1 ? '準優勝' : count >= finalRoundWins - 2 ? '3位' : count >= finalRoundWins - 3 ? 'ベスト8' : '参加';
      return { playerId: id, place, inferred: id !== championId };
    });
    return {
      id: 'legacy-' + number, legacyNumber: number, number,
      name: t.name || '人形劇#' + number, date: t.date || null,
      seriesTags: ['人形劇'], isLegacy: true, readOnly: true,
      joinedPlayers: ids.map(id => players.get(id) || { id, name: id, legacyPlayerId: id }),
      matches: matches.map((m, index) => ({ id: 'legacy-' + number + '-match-' + index, winnerId: canonicalLegacyId(m.winnerId), loserId: canonicalLegacyId(m.loserId), resultType: 'played', round: null, sourceRecord: m })),
      bracket: { complete: Boolean(championId), rounds: null, reconstructed: false },
      championId, resultPlacements,
      // Original record retained: no fabricated bracket, stage, organizer or report.
      sourceTournament: t,
    };
  });
}
