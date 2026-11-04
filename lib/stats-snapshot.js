// Minimal, versioned stats representation persisted inside the existing
// tournaments.data JSONB row. Account IDs stay raw until the current legacy
// linking table is read, so connecting a player never requires rewriting history.
export const STATS_SNAPSHOT_VERSION = 1;

export function completedForStats(tournament) {
  const bracket = tournament?.bracket;
  const final = bracket?.rounds?.at(-1)?.[0];
  return bracket?.complete === true && Boolean(final?.player1 && final?.player2 && final?.winnerId) &&
    [final.player1, final.player2].some(player => String(player.id) === String(final.winnerId));
}

export function buildStatsSnapshot(tournament) {
  if (!completedForStats(tournament)) return null;
  const players = (tournament.joinedPlayers || []).filter(p => !p.isDemo).map(p => ({
    id: String(p.id),
    accountId: String(p.userId || p.id),
    name: p.name || p.displayName || String(p.id),
  }));
  const ids = new Set(players.map(p => p.id));
  const matches = (tournament.bracket?.rounds || []).flatMap(round => round.flatMap(match => {
    if (!match.player1 || !match.player2 || !match.winnerId || match.resultType === 'forfeit') return [];
    const first = String(match.player1.id), second = String(match.player2.id);
    if (first === second || !ids.has(first) || !ids.has(second)) return [];
    const winner = String(match.winnerId);
    if (winner !== first && winner !== second) return [];
    return [{ winnerId: winner, loserId: winner === first ? second : first }];
  }));
  const final = tournament.bracket.rounds.at(-1)[0];
  const opponent = [final.player1, final.player2].find(p => p && String(p.id) !== String(final.winnerId));
  const semifinal = tournament.bracket.rounds.length > 1 ? tournament.bracket.rounds.at(-2) : [];
  const thirdPlaceIds = [...new Set((semifinal || []).flatMap(match => {
    if (!match.winnerId) return [];
    const loser = [match.player1, match.player2].find(p => p && String(p.id) !== String(match.winnerId));
    return loser && ids.has(String(loser.id)) ? [String(loser.id)] : [];
  }))];
  const characterReports = players.flatMap(player => {
    const report = tournament.characterReports?.[player.id];
    if (!Array.isArray(report?.characters) || !report.characters.length) return [];
    return [{
      playerId: player.id,
      characters: [...new Set(report.characters.map(c => String(c?.fighter || '').trim()).filter(Boolean))],
    }];
  });
  return {
    version: STATS_SNAPSHOT_VERSION,
    revision: tournament.stageActionRevision ?? null,
    name: tournament.name || '',
    date: tournament.date || tournament.createdAt || '',
    createdAt: tournament.createdAt || '',
    seriesTags: Array.isArray(tournament.seriesTags) ? tournament.seriesTags
      : (typeof tournament.seriesTag === 'string' && tournament.seriesTag ? [tournament.seriesTag] : []),
    players,
    demoIds: (tournament.joinedPlayers || []).filter(p => p.isDemo).map(p => String(p.id)),
    matches, championId: String(final.winnerId),
    runnerUpId: opponent ? String(opponent.id) : null,
    thirdPlaceIds, characterReports,
  };
}

export function snapshotIsCurrent(snapshot, revision) {
  return snapshot?.version === STATS_SNAPSHOT_VERSION &&
    String(snapshot.revision ?? '') === String(revision ?? '') &&
    Array.isArray(snapshot.players) && Array.isArray(snapshot.matches) &&
    Array.isArray(snapshot.characterReports);
}

export function withStatsSnapshot(tournament) {
  // Operation logs and undo snapshots are no longer part of tournament data.
  // Strip legacy copies on every write, not only on dedicated match updates.
  const { statsSnapshot: previousSnapshot, matchLogs, adminLog, adminHistory, ...rest } = tournament;
  const statsSnapshot = buildStatsSnapshot(rest);
  return statsSnapshot ? { ...rest, statsSnapshot } : rest;
}

// Outputs the exact public stats schema, with IDs mapped at request time.
export function snapshotToPublicResult(rowId, snapshot, linkedIds) {
  const resolved = new Map(snapshot.players.map(p => [
    String(p.id),
    { id: linkedIds.get(String(p.accountId)) || linkedIds.get(String(p.id)) || 'figure:' + String(p.accountId), name: p.name },
  ]));
  const characterReports = snapshot.characterReports.flatMap(report => {
    const player = resolved.get(String(report.playerId));
    return player ? [{ playerId: player.id, characters: report.characters }] : [];
  });
  const matches = snapshot.matches.flatMap(match => {
    const winner = resolved.get(String(match.winnerId));
    const loser = resolved.get(String(match.loserId));
    return winner && loser && winner.id !== loser.id
      ? [{ winnerId: winner.id, loserId: loser.id }] : [];
  });
  const player = id => resolved.get(String(id))?.id || null;
  return {
    id: rowId,
    characterReports,
    championId: player(snapshot.championId),
    runnerUpId: player(snapshot.runnerUpId),
    thirdPlaceIds: [...new Set(snapshot.thirdPlaceIds.map(player).filter(Boolean))],
    name: snapshot.name,
    date: snapshot.date,
    seriesTags: snapshot.seriesTags,
    players: [...resolved.values()],
    demoTierIds: snapshot.demoIds.map(id => 'demo-tier:' + String(rowId) + ':' + id),
    matches,
  };
}
