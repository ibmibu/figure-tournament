import { getBracketPlacements } from './tournament-bracket-admin';

// PUBLIC archive schema. Never spread raw tournament JSON into a GitHub file:
// tokens, friend codes, emails, private declarations and character reports
// must stay exclusively in Supabase.
function string(value, limit = 160) {
  return String(value ?? '').slice(0, limit);
}
export function archivePlayer(player) {
  if (!player || typeof player !== 'object') return null;
  return {
    id: string(player.id, 128),
    userId: string(player.userId || player.id, 128),
    name: string(player.name || player.displayName || '', 100),
    isDemo: player.isDemo === true,
  };
}
function validPlacements(t) {
  // Some old finalized events stored only a subset of placements. Fill
  // missing 3rd-place and other bracket results without overwriting saved
  // organizer-corrected placements.
  const merged = new Map();
  for (const p of Array.isArray(t.resultPlacements) ? t.resultPlacements : []) {
    if (p?.playerId != null) merged.set(String(p.playerId), p);
  }
  for (const p of getBracketPlacements(t.bracket)) {
    if (p?.playerId != null && !merged.has(String(p.playerId)))
      merged.set(String(p.playerId), p);
  }
  return [...merged.values()].map(p => ({
    playerId: string(p.playerId, 128), place: string(p.place, 40),
  }));
}
export function completedArchiveRecord(id, t) {
  if (!t || t.bracket?.complete !== true || !Array.isArray(t.bracket?.rounds) ||
      !t.bracket.rounds.length) return null;
  return {
    id: string(id, 128),
    name: string(t.name, 140),
    date: string(t.date, 40),
    createdAt: string(t.createdAt, 40),
    completedAt: string(t.completedAt, 40),
    status: '終了',
    joinedPlayers: (Array.isArray(t.joinedPlayers) ? t.joinedPlayers : [])
      .map(archivePlayer).filter(Boolean),
    bracket: { complete: true },
    resultPlacements: validPlacements(t),
    seriesTags: Array.isArray(t.seriesTags)
      ? t.seriesTags.map(tag => string(tag, 80)).filter(Boolean).slice(0, 30) : [],
  };
}
export function completedArchiveDetail(id, t) {
  const record = completedArchiveRecord(id, t);
  if (!record) return null;
  return {
    ...record,
    format: string(t.format, 20),
    bestOf: Number(t.bestOf) === 5 ? 5 : 3,
    participants: Number(t.participants) || record.joinedPlayers.length,
    stages: Array.isArray(t.stages) ? t.stages.map(s => string(s, 80)).slice(0, 30) : [],
    stageRejects: t.stageRejects === true,
    bracket: {
      complete: true,
      rounds: t.bracket.rounds.map(round => (Array.isArray(round) ? round : []).map(match => {
        const scores = match?.matchState?.score || {};
        const score = Object.fromEntries(Object.entries(scores)
          .filter(([id, value]) => id.length <= 128 && Number.isFinite(Number(value)))
          .map(([key, value]) => [key, Number(value)]));
        return {
          id: string(match?.id, 128),
          player1: archivePlayer(match?.player1),
          player2: archivePlayer(match?.player2),
          winnerId: match?.winnerId == null ? null : string(match.winnerId, 128),
          resultType: match?.resultType === 'forfeit' ? 'forfeit' : null,
          score,
        };
      })),
    },
  };
}
