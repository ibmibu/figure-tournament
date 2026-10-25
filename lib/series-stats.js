// Shared aggregation for completed Figure Tournament brackets.
export function tournamentSeries(tournament) {
  const tags = Array.isArray(tournament.seriesTags) ? tournament.seriesTags : [];
  return [...new Set(tags.map(x => String(x).trim()).filter(Boolean))];
}
export function playerTournamentStats(tournaments, userId, tag = 'all') {
  const entries = [];
  for (const tournament of tournaments || []) {
    if (!tournament?.bracket?.complete || !Array.isArray(tournament.bracket.rounds)) continue;
    const tags = tournamentSeries(tournament);
    if (tag !== 'all' && !tags.includes(tag)) continue;
    const player = (tournament.joinedPlayers || []).find(p => !p.isDemo && String(p.userId || p.id) === String(userId));
    if (!player) continue;
    let wins = 0, losses = 0;
    for (const round of tournament.bracket.rounds) for (const match of round) {
      if (!match.player1 || !match.player2 || !match.winnerId) continue;
      const participants = [String(match.player1.id), String(match.player2.id)];
      if (!participants.includes(String(player.id))) continue;
      if (String(match.winnerId) === String(player.id)) wins++;
      else losses++;
    }
    const placement = (tournament.resultPlacements || []).find(p => String(p.playerId) === String(player.id))?.place || '';
    entries.push({id:tournament.id,name:tournament.name,tags,wins,losses,placement});
  }
  return {tournaments:entries.length,wins:entries.reduce((s,x)=>s+x.wins,0),losses:entries.reduce((s,x)=>s+x.losses,0),championships:entries.filter(x=>x.placement==='優勝').length,entries};
}
