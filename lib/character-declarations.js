// Character declaration data shared by create/submit/publish views.
// Legacy tournaments stored one {character,color}; new tournaments store
// {characters:[{fighter,color}, ...]}. Both must remain readable.
export const MAX_DECLARED_CHARACTERS = 10;

export function declarationCount(tournament) {
  const count = tournament?.characterDeclarationCount;
  return Number.isInteger(count) && count >= 1 && count <= MAX_DECLARED_CHARACTERS ? count : 1;
}

export function declaredCharacters(entry) {
  if (Array.isArray(entry?.characters)) return entry.characters.map(item => ({
    fighter: String(item?.fighter || ''), color: String(item?.color || ''),
  }));
  if (typeof entry?.character === 'string' && entry.character) {
    return [{ fighter: entry.character, color: String(entry.color || '') }];
  }
  return [];
}

export function validDeclaration(tournament, entry, validFighters) {
  const characters = declaredCharacters(entry);
  return characters.length === declarationCount(tournament) &&
    characters.every(item => validFighters.includes(item.fighter) && /^[1-8]P$/.test(item.color)) &&
    new Set(characters.map(item => item.fighter)).size === characters.length;
}
