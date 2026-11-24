// Render a team entrant as captain and teammate on separate lines while
// leaving solo-tournament names and bracket score geometry unchanged.
export default function BracketPlayerLabel({ player, teamTournament = false, visible = true }) {
  const rawName = visible ? String(player?.name || '') : '';
  let captain = rawName;
  let teammate = teamTournament && visible ? String(player?.teamMate?.name || '') : '';
  if (teammate) {
    const suffix = ' ＋ ' + teammate;
    if (captain.endsWith(suffix)) captain = captain.slice(0, -suffix.length);
  } else if (teamTournament && rawName.includes(' ＋ ')) {
    // Support older bracket entrants stored only with a joined display name.
    const separator = rawName.indexOf(' ＋ ');
    captain = rawName.slice(0, separator);
    teammate = rawName.slice(separator + ' ＋ '.length);
  }
  const paired = Boolean(teamTournament && captain && teammate);
  const demo = visible && player?.isDemo ? '（デモ）' : '';
  const fullName = paired ? captain + ' ＋ ' + teammate : rawName;
  return <span className={paired ? 'team-bracket-name' : undefined}
    title={fullName} aria-label={fullName + demo}>
    {paired
      ? <>
          <span className="team-bracket-member">{captain}</span>
          <span className="team-bracket-member">{teammate}{demo}</span>
        </>
      : <>{rawName}{demo}</>}
  </span>;
}
