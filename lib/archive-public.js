import { getBracketPlacements } from './tournament-bracket-admin';
import { buildStatsSnapshot } from './stats-snapshot';

// PUBLIC archive schema. Never spread raw tournament JSON into a GitHub file:
// tokens, friend codes, emails and unannounced declarations
// must stay exclusively in Supabase. Character reports (fighter and color)
// are public tournament results and may be archived by explicit allowlist.
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
function publicCharacterReports(t) {
  const reports = t.characterReports || {};
  const result = {};
  for (const p of Array.isArray(t.joinedPlayers) ? t.joinedPlayers : []) {
    if (!p || p.isDemo || p.id == null) continue;
    const id = string(p.id, 128);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) continue;
    const characters = reports[id]?.characters;
    if (!Array.isArray(characters)) continue;
    const safe = characters.slice(0, 100).filter(c =>
      c && typeof c.fighter === 'string' && c.fighter.trim()).map(c => ({
      fighter: string(c.fighter.trim(), 80),
      color: /^[1-8]P$/.test(c.color) ? c.color : '',
    }));
    if (safe.length) result[id] = { characters: safe };
  }
  return result;
}
// Preserve the existing series-summary semantics (including completed
// forfeits); the ratings snapshot separately excludes forfeit matches.
function publicMatchOutcomes(t) {
  return (t.bracket?.rounds || []).flatMap(round => (Array.isArray(round) ? round : [])
    .flatMap(match => {
      if (!match?.player1 || !match?.player2 || match.winnerId == null) return [];
      const ids = [String(match.player1.id), String(match.player2.id)];
      const winner = String(match.winnerId);
      if (ids[0] === ids[1] || !ids.includes(winner)) return [];
      return [{
        winnerId: string(winner, 128),
        loserId: string(ids.find(id => id !== winner), 128),
      }];
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
    characterReports: publicCharacterReports(t),
    matchResults: publicMatchOutcomes(t),
    // Already-public finished-match projection used by ratings and series
    // statistics. Build from the bracket on export instead of spreading the
    // original tournament's potentially sensitive statsSnapshot object.
    statsSnapshot: buildStatsSnapshot(t),
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
