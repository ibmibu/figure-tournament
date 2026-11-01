'use client';

import { normalizeOverlayDesign, overlayPartPosition, overlayPartSize, overlayImageUrl, OVERLAY_WIDTH, OVERLAY_HEIGHT } from '../lib/overlay-scoreboard';

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
  const partBackground = (key, fallback) => {
    const url = overlayImageUrl(d, key);
    return url
      ? { backgroundColor: 'transparent', backgroundImage: 'url("' + url + '")',
          backgroundSize: '100% 100%', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }
      : { backgroundColor: fallback };
  };
  // Left leans the opposite way to the previous version. Right is its mirror.
  // Clip the shape, not the text, so labels and scores remain upright.
  const parallelogramMask = (key, height, maxCut) => {
    const cut = Math.min(maxCut, Math.round(height * 0.3));
    return key.endsWith('1')
      ? `polygon(0 0, calc(100% - ${cut}px) 0, 100% 100%, ${cut}px 100%)`
      : `polygon(${cut}px 0, 100% 0, calc(100% - ${cut}px) 100%, 0 100%)`;
  };
  const angledName = d.nameShape === 'parallelogram';
  const nameStyle = key => ({
    ...position(key), ...(angledName ? { backgroundColor: 'transparent' } : partBackground(key, d.nameBg)),
    color: d.nameText,
    border: angledName ? 'none' : `${d.borderWidth}px solid ${d.nameBorder}`,
    borderRadius: !angledName && d.nameShape === 'rounded' ? 14 : 0,
    padding: angledName ? '0 28px' : '0 12px',
    display: 'flex', alignItems: 'center',
    justifyContent: key === 'name1' ? 'flex-end' : 'flex-start',
    fontSize: d.nameFontSize, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden',
    lineHeight: 1,
  });
  const nameShapeMask = key => parallelogramMask(key, d.nameHeight, 26);
  const nameContent = (key, name) => <>
    {angledName && <>
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundColor: d.nameBorder, clipPath: nameShapeMask(key),
      }} />
      <div aria-hidden="true" style={{
        position: 'absolute', inset: d.borderWidth, pointerEvents: 'none',
        ...partBackground(key, d.nameBg), clipPath: nameShapeMask(key),
      }} />
    </>}
    <span style={{
      position: 'relative', zIndex: 1, overflow: 'hidden',
      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>{name}</span>
  </>;
  const scoreStyle = key => ({
    ...position(key), display: 'flex', alignItems: 'center', justifyContent: 'center',
    ...partBackground(key, d.scoreBg), color: d.scoreText, borderRadius: d.scoreShape === 'circle' ? '50%' : d.scoreShape === 'rounded' ? 12 : 0,
    clipPath: d.scoreShape === 'parallelogram' ? parallelogramMask(key, d.scoreSize, 14) : 'none',
    overflow: 'hidden',
    fontSize: d.scoreFontSize, fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1,
  });
  return <div style={{ position: 'relative', width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT, background: 'transparent', fontFamily: 'Arial, "Noto Sans JP", sans-serif', color: '#222' }}>
    <div data-overlay-part="name1" style={nameStyle('name1')}>{nameContent('name1', m.player1)}</div>
    <div data-overlay-part="name2" style={nameStyle('name2')}>{nameContent('name2', m.player2)}</div>
    <div data-overlay-part="score1" style={scoreStyle('score1')}>{m.score1}</div>
    <div data-overlay-part="score2" style={scoreStyle('score2')}>{m.score2}</div>
    <div data-overlay-part="round" style={{
      ...position('round'), ...partBackground('round', d.metaBg), color: d.metaText,
      border: '1px solid #b7a8df', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 3, lineHeight: 1,
    }}>
      <span style={{ fontSize: d.roundFontSize, fontWeight: 800 }}>{roundLabel || '試合中'}</span>
      <span style={{ fontSize: d.boFontSize, fontWeight: 800 }}>BO{m.bestOf || 3}</span>
    </div>
    <div data-overlay-part="title" style={{
      ...position('title'), ...partBackground('title', d.titleBg), color: d.titleText, textAlign: 'center',
      fontSize: d.titleFontSize, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', padding: '0 12px',
    }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{title || '大会名'}</span></div>
  </div>;
}
