'use client';

import { normalizeOverlayDesign, overlayPartPosition, overlayPartSize, OVERLAY_WIDTH, OVERLAY_HEIGHT } from '../lib/overlay-scoreboard';

export default function OverlayScoreboardArtwork({ config, match, title, selected = '', editable = false }) {
  const d = normalizeOverlayDesign(config);
  const m = match || { player1: 'PLAYER 1', player2: 'PLAYER 2', score1: 0, score2: 0, round: 'GRAND FINAL', bestOf: 3 };
  const roundLabel = m.round === 'GRAND FINAL' ? '決勝戦' : m.round === 'SEMI FINAL' ? '準決勝'
    : String(m.round || '').replace(/^ROUND (\d+)$/, (_, n) => n + '回戦');
  const position = key => {
    const at = overlayPartPosition(d, key);
    const { width, height } = overlayPartSize(d, key);
    return { position: 'absolute', left: at.x, top: at.y, width, height, boxSizing: 'border-box',
      outline: editable && selected === key ? '3px solid #ffbb44' : 'none',
      outlineOffset: 3, cursor: editable ? 'move' : 'default', userSelect: 'none' };
  };
  const nameStyle = key => ({
    ...position(key), background: d.nameBg, color: d.nameText,
    border: `${d.borderWidth}px solid ${d.nameBorder}`, borderRadius: d.roundedNames ? 14 : 0,
    padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: key === 'name1' ? 'flex-end' : 'flex-start',
    fontSize: d.nameFontSize, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden',
    lineHeight: 1,
  });
  const scoreStyle = key => ({
    ...position(key), display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: d.scoreBg, color: d.scoreText, borderRadius: d.scoreShape === 'circle' ? '50%' : d.scoreShape === 'rounded' ? 12 : 0,
    fontSize: d.scoreFontSize, fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1,
  });
  return <div style={{ position: 'relative', width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT, background: 'transparent', fontFamily: 'Arial, "Noto Sans JP", sans-serif', color: '#222' }}>
    <div data-overlay-part="name1" style={nameStyle('name1')}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.player1}</span></div>
    <div data-overlay-part="name2" style={nameStyle('name2')}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.player2}</span></div>
    <div data-overlay-part="score1" style={scoreStyle('score1')}>{m.score1}</div>
    <div data-overlay-part="score2" style={scoreStyle('score2')}>{m.score2}</div>
    <div data-overlay-part="round" style={{
      ...position('round'), background: d.metaBg, color: d.metaText,
      border: '1px solid #b7a8df', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 3, lineHeight: 1,
    }}>
      <span style={{ fontSize: 18, fontWeight: 800 }}>{roundLabel || '試合中'}</span>
      <span style={{ fontSize: 15, fontWeight: 800 }}>BO{m.bestOf || 3}</span>
    </div>
    <div data-overlay-part="title" style={{
      ...position('title'), background: d.titleBg, color: d.titleText, textAlign: 'center',
      fontSize: 17, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', padding: '0 12px',
    }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{title || '大会名'}</span></div>
  </div>;
}
