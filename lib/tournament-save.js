// Shared optimistic-concurrency guard for the tournaments.data JSON column.
// All writers must increment the same revision to avoid overwriting concurrent changes.
export async function saveTournamentRevision(db, id, previous, next) {
  const revision = Number.isSafeInteger(previous.stageActionRevision) && previous.stageActionRevision >= 0
    ? previous.stageActionRevision : null;
  const updated = { ...next, stageActionRevision: (revision ?? 0) + 1 };
  let query = db.from('tournaments').update({ data: updated }).eq('id', String(id));
  query = revision === null
    ? query.is('data->>stageActionRevision', null)
    : query.eq('data->>stageActionRevision', String(revision));
  return query.select('id');
}
