// ONE-TIME DATA REPAIR. This deliberately rewrites stored tournament reports;
// it is not a read-time alias, aggregation, or statistics workaround.
const legacyNames = new Set(['ゼニガメ', 'フシギソウ', 'リザードン']);
const trainer = 'ポケモントレーナー';

function replaceName(value) {
  return typeof value === 'string' && legacyNames.has(value) ? trainer : value;
}

export function repairTournamentPokemonNames(original) {
  if (!original || typeof original !== 'object') return { tournament: original, replacements: 0 };
  let replacements = 0;
  const update = (name) => {
    const corrected = replaceName(name);
    if (corrected !== name) replacements++;
    return corrected;
  };
  const repairCharacterList = characters => characters.map(item => {
    if (typeof item === 'string') return update(item);
    if (!item || typeof item !== 'object') return item;
    const fighter = update(item.fighter);
    return fighter === item.fighter ? item : { ...item, fighter };
    // Never touch item.color, even if multiple historical entries share a fighter.
  });
  const repairReports = reports => {
    if (!reports || typeof reports !== 'object' || Array.isArray(reports)) return reports;
    return Object.fromEntries(Object.entries(reports).map(([playerId, report]) => {
      if (!report || typeof report !== 'object') return [playerId, report];
      const next = { ...report };
      if (Array.isArray(report.characters)) next.characters = repairCharacterList(report.characters);
      if (typeof report.fighter === 'string') next.fighter = update(report.fighter);
      return [playerId, next];
    }));
  };
  const repairDeclarations = declarations => {
    if (!declarations || typeof declarations !== 'object' || Array.isArray(declarations))
      return declarations;
    return Object.fromEntries(Object.entries(declarations).map(([playerId, declaration]) => {
      if (!declaration || typeof declaration !== 'object') return [playerId, declaration];
      const character = update(declaration.character);
      return [playerId, character === declaration.character
        ? declaration : { ...declaration, character }];
    }));
  };
  let tournament = {
    ...original,
    characterReports: repairReports(original.characterReports),
    characterDeclarations: repairDeclarations(original.characterDeclarations),
  };
  if (original.statsSnapshot?.version === 1 && Array.isArray(original.statsSnapshot.characterReports)) {
    const snapshotReports = original.statsSnapshot.characterReports.map(report => ({
      ...report,
      characters: Array.isArray(report?.characters)
        ? repairCharacterList(report.characters) : report.characters,
    }));
    tournament.statsSnapshot = { ...original.statsSnapshot, characterReports: snapshotReports };
  }
  if (!replacements) tournament = original;
  return { tournament, replacements };
}

export function repairColorPresets(colors) {
  if (!Array.isArray(colors)) return { colors, replacements: 0, conflict: false };
  let replacements = 0;
  const updated = colors.map(item => {
    if (!item || typeof item !== 'object') return item;
    const fighter = replaceName(item.fighter);
    if (fighter === item.fighter) return item;
    replacements++;
    return { ...item, fighter }; // Preserve the chosen color.
  });
  const unique = [];
  const byFighter = new Map();
  for (const item of updated) {
    const previous = byFighter.get(item?.fighter);
    if (previous) {
      // Two different presets cannot become one without losing a preferred
      // color. Leave this account untouched for the owner to choose.
      if (previous.color !== item.color)
        return { colors, replacements: 0, conflict: true };
      continue; // Identical colors are safe to collapse into one preset.
    }
    byFighter.set(item?.fighter, item);
    unique.push(item);
  }
  return { colors: replacements ? unique : colors, replacements, conflict: false };
}
