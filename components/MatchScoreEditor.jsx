'use client';

// Compact "proposal B" score editor: two player cards and one-digit steppers.
// These are controlled values; server APIs validate every submitted result.
export default function MatchScoreEditor({
  firstName, secondName, firstScore, secondScore, target = 2,
  onFirstChange, onSecondChange, disabled = false, readOnly = false,
}) {
  const renderPlayer = (name, score, setScore) => (
    <div className="set-score-player">
      <span className="set-score-player-name" title={name}>{name}</span>
      <strong className="set-score-digit" aria-label={name + 'の勝利数'}>{Number(score) || 0}</strong>
      {!readOnly && <div className="set-score-stepper">
        <button type="button" aria-label={name + 'のスコアを減らす'}
          disabled={disabled || Number(score) <= 0}
          onClick={() => setScore(Math.max(0, Number(score) - 1))}>−</button>
        <button type="button" aria-label={name + 'のスコアを増やす'}
          disabled={disabled || Number(score) >= target}
          onClick={() => setScore(Math.min(target, Number(score) + 1))}>＋</button>
      </div>}
    </div>
  );
  return <div className="set-score-editor">
    {renderPlayer(firstName, firstScore, onFirstChange)}
    <span className="set-score-vs" aria-hidden="true">VS</span>
    {renderPlayer(secondName, secondScore, onSecondChange)}
  </div>;
}
