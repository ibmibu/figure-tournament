'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '../../../lib/supabase/client';
import OverlayScoreboardArtwork from '../../../components/OverlayScoreboardArtwork';
import {
  DEFAULT_OVERLAY_DESIGN, normalizeOverlayDesign, overlayPartPosition, moveOverlayPart,
  setOverlayMirror, overlayPartSize, OVERLAY_WIDTH, OVERLAY_HEIGHT,
} from '../../../lib/overlay-scoreboard';

const CATEGORIES = [
  ['name', '名前', 'name1'],
  ['score', 'スコア', 'score1'],
  ['round', '回戦・BO', 'round'],
  ['title', '大会名', 'title'],
];
const COLOR_GROUPS = {
  name: [['nameBg', '背景色'], ['nameText', '文字色'], ['nameBorder', '枠線色']],
  score: [['scoreBg', '背景色'], ['scoreText', '文字色']],
  round: [['metaBg', '背景色'], ['metaText', '文字色']],
  title: [['titleBg', '背景色'], ['titleText', '文字色']],
};
const field = { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, fontSize: 13, fontWeight: 700 };
const smallButton = (active = false) => ({
  borderRadius: 0, background: active ? '#eee8fb' : '#fff', border: '1px solid ' + (active ? '#6045a8' : '#d8d5e0'),
  color: active ? '#503592' : '#292533', padding: '8px 12px',
});
function ScaleField({ label, value, min, max, step = 1, onChange, unit = 'px' }) {
  return <label style={field}>
    <span>{label}：{value}{unit}</span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} style={{ width: '100%', accentColor: '#6045a8' }} />
  </label>;
}

export default function MyOverlayPage() {
  const [ownerId, setOwnerId] = useState('');
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [design, setDesign] = useState(() => normalizeOverlayDesign(DEFAULT_OVERLAY_DESIGN));
  const [saved, setSaved] = useState(() => normalizeOverlayDesign(DEFAULT_OVERLAY_DESIGN));
  const [selected, setSelected] = useState('name1');
  const [scale, setScale] = useState(0.45);
  const previewRef = useRef(null);
  const dragRef = useRef(null);
  const dirty = JSON.stringify(design) !== JSON.stringify(saved);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data: sessionResult } = await getSupabaseBrowserClient().auth.getSession();
        const session = sessionResult.session;
        if (!active) return;
        if (!session?.user?.id) {
          window.location.href = '/login?next=/mypage/overlay';
          return;
        }
        setOwnerId(session.user.id);
        setUrl(window.location.origin + '/overlay?owner=' + encodeURIComponent(session.user.id));
        const response = await fetch('/api/overlay-design', {
          headers: { Authorization: 'Bearer ' + session.access_token }, cache: 'no-store',
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'デザインを読み込めませんでした。');
        if (!active) return;
        const next = normalizeOverlayDesign(result.design || DEFAULT_OVERLAY_DESIGN);
        setDesign(next);
        setSaved(next);
      } catch (e) {
        if (active) setError(e.message || 'デザインの読み込みに失敗しました。');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (loading || !previewRef.current) return;
    const node = previewRef.current;
    const update = () => setScale(node.clientWidth / OVERLAY_WIDTH);
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(node);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, [loading]);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setError('');
    } catch { setError('URLをコピーできませんでした。'); }
  }
  const edit = (key, value) => {
    setDesign(prev => normalizeOverlayDesign({ ...prev, [key]: value }));
    setSaveMessage('');
  };
  function pointerDown(event) {
    if (event.button !== 0 || loading) return;
    const target = event.target.closest?.('[data-overlay-part]');
    const part = target?.getAttribute('data-overlay-part');
    if (!part) return;
    setSelected(part);
    const at = overlayPartPosition(design, part);
    dragRef.current = { part, x: event.clientX, y: event.clientY, posX: at.x, posY: at.y, scale };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function pointerMove(event) {
    const drag = dragRef.current;
    if (!drag || !drag.scale) return;
    const x = drag.posX + (event.clientX - drag.x) / drag.scale;
    const y = drag.posY + (event.clientY - drag.y) / drag.scale;
    setDesign(prev => moveOverlayPart(prev, drag.part, x, y));
    setSaveMessage('');
  }
  function pointerEnd(event) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function nudge(event) {
    const key = event.key;
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(key) || loading) return;
    event.preventDefault();
    const delta = event.shiftKey ? 10 : 1;
    const pos = overlayPartPosition(design, selected);
    setDesign(prev => moveOverlayPart(prev, selected,
      pos.x + (key === 'ArrowLeft' ? -delta : key === 'ArrowRight' ? delta : 0),
      pos.y + (key === 'ArrowUp' ? -delta : key === 'ArrowDown' ? delta : 0)));
    setSaveMessage('');
  }
  async function save() {
    if (!ownerId || saving || loading) return;
    setSaving(true);
    setError('');
    setSaveMessage('');
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session?.access_token) throw new Error('ログインし直してください。');
      const response = await fetch('/api/overlay-design', {
        method: 'PUT', headers: {
          'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token,
        }, body: JSON.stringify({ design }), cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'デザインを保存できませんでした。');
      setSaved(result.design);
      setDesign(result.design);
      setSaveMessage('保存しました。OBSの表示にも反映されます。');
    } catch (e) { setError(e.message || '保存できませんでした。'); }
    finally { setSaving(false); }
  }
  const selectedCategory = selected.startsWith('name') ? 'name' : selected.startsWith('score') ? 'score' : selected;
  const chosenPosition = overlayPartPosition(design, selected);
  const chosenSize = overlayPartSize(design, selected);
  const changeChosen = (coordinate, value) => setDesign(prev => {
    const pos = overlayPartPosition(prev, selected);
    return moveOverlayPart(prev, selected, coordinate === 'x' ? value : pos.x, coordinate === 'y' ? value : pos.y);
  });
  return <main className="page mypage-layout">
    <section className="my-page">
      <h1>OBSオーバーレイ</h1>
      <Link className="my-colors-back" href="/mypage">← マイページに戻る</Link>
      <section className="my-results my-color-panel" style={{ marginTop: 24 }}>
        <h2>スコアボードのURL</h2>
        <p className="setting-help">主催者アカウント専用のURLです。OBSに一度登録すれば、大会が変わっても変更する必要はありません。</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 14 }}>
          <input aria-label="OBSオーバーレイURL" readOnly value={url} placeholder="読み込み中…" style={{ flex: '1 1 260px', minWidth: 0 }} onFocus={e => e.target.select()} />
          <button type="button" className="submit" disabled={!ownerId} onClick={copyUrl}>{copied ? 'コピーしました' : 'URLをコピー'}</button>
        </div>
        <h2 style={{ marginTop: 28 }}>OBSのブラウザソース設定</h2>
        <p className="setting-help">「ソースを追加」→「ブラウザ」に上のURLを設定してください。</p>
        <p><strong>幅：1920 px　高さ：1080 px</strong></p>
        <p className="setting-help">設定を保存した後は、OBSのブラウザソースも1920×1080にしてください。背景は透明です。従来のデザインを使っている間は960×90のままでも表示できます。</p>
      </section>

      <section className="my-results my-color-panel" style={{ marginTop: 24 }} aria-labelledby="scoreboard-editor-heading">
        <h2 id="scoreboard-editor-heading">スコアボードエディター</h2>
        <p className="setting-help">1920×1080の配信画面を縮小表示しています。パーツをドラッグして配置してください。背景の暗色とガイド線はOBSには表示されません。</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <strong style={{ fontSize: 12 }}>1920 × 1080</strong>
          <span style={{ fontSize: 12, color: dirty ? '#8c6121' : '#74717e' }}>{loading ? '読み込み中…' : dirty ? '未保存の変更があります' : '保存済み'}</span>
        </div>
        <div ref={previewRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd}
          onPointerCancel={pointerEnd} onKeyDown={nudge} tabIndex={0} aria-label="スコアボード編集キャンバス。パーツをドラッグまたは矢印キーで移動できます"
          style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', overflow: 'hidden', touchAction: 'none', background: '#1b2430', outlineOffset: 3, border: '1px solid #4b5563' }}>
          {!loading && <div style={{ position: 'absolute', width: 1920, height: 1080, left: 0, top: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
            <div style={{ position: 'absolute', left: 960, height: 1080, width: 1, borderLeft: '2px dashed #67768c', opacity: 0.5, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: 540, width: 1920, borderTop: '2px dashed #67768c', opacity: 0.25, pointerEvents: 'none' }} />
            <OverlayScoreboardArtwork config={design} selected={selected} editable
              match={{ player1: 'PLAYER 1', player2: 'PLAYER 2', score1: 0, score2: 0, round: 'GRAND FINAL', bestOf: 3 }} title="人形劇 #135" />
          </div>}
        </div>
        <p className="setting-help" style={{ marginTop: 10 }}>クリックでパーツ選択。ドラッグで移動。選択したまま矢印キーで1pxずつ、Shift＋矢印キーで10pxずつ移動できます。</p>

        <label style={{ ...field, flexDirection: 'row', alignItems: 'center', marginTop: 17, gap: 9 }}>
          <input type="checkbox" checked={design.mirror}
            onChange={e => { setDesign(prev => setOverlayMirror(prev, e.target.checked)); setSaveMessage(''); }} />
          名前とスコアは左右対称で移動（初期設定：ON）
        </label>

        <div style={{ borderTop: '1px solid #e6e4eb', paddingTop: 20, marginTop: 24 }}>
          <h3 style={{ fontSize: 15, margin: '0 0 12px' }}>パーツ別の設定</h3>
          <div role="tablist" aria-label="編集するパーツの種類"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 6 }}>
            {CATEGORIES.map(([key, label, firstPart]) => <button type="button" role="tab"
              id={'overlay-tab-' + key} aria-selected={selectedCategory === key}
              aria-controls="overlay-settings-panel" key={key}
              disabled={loading} onClick={() => setSelected(firstPart)}
              style={{ ...smallButton(selectedCategory === key), padding: '10px 4px', fontSize: 12, whiteSpace: 'normal', minWidth: 0 }}>
              {label}
            </button>)}
          </div>

          <div id="overlay-settings-panel" role="tabpanel" aria-labelledby={'overlay-tab-' + selectedCategory}
            style={{ marginTop: 20 }}>
            {(selectedCategory === 'name' || selectedCategory === 'score') && <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                <strong style={{ fontSize: 13 }}>調整する側</strong>
                <button type="button" onClick={() => setSelected(selectedCategory + '1')} style={smallButton(selected.endsWith('1'))}>左</button>
                <button type="button" onClick={() => setSelected(selectedCategory + '2')} style={smallButton(selected.endsWith('2'))}>右</button>
                {design.mirror && <span className="setting-help">反対側も自動で連動します</span>}
              </div>
            </>}

            <h4 style={{ fontSize: 13, margin: '0 0 12px' }}>位置</h4>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label style={field}>X座標（px）
                <input type="number" min="0" max={OVERLAY_WIDTH - chosenSize.width}
                  value={chosenPosition.x} onChange={e => changeChosen('x', Number(e.target.value))} style={{ width: 120 }} />
              </label>
              <label style={field}>Y座標（px）
                <input type="number" min="0" max={OVERLAY_HEIGHT - chosenSize.height}
                  value={chosenPosition.y} onChange={e => changeChosen('y', Number(e.target.value))} style={{ width: 120 }} />
              </label>
            </div>

            <h4 style={{ fontSize: 13, margin: '24px 0 12px' }}>形・サイズ</h4>
            {selectedCategory === 'name' && <>
              <label style={{ ...field, flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                <input type="checkbox" checked={design.roundedNames}
                  onChange={e => edit('roundedNames', e.target.checked)} />角丸にする
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 16 }}>
                <ScaleField label="横幅" value={design.nameWidth} min={100} max={700} onChange={v => edit('nameWidth', v)} />
                <ScaleField label="高さ" value={design.nameHeight} min={30} max={160} onChange={v => edit('nameHeight', v)} />
                <ScaleField label="文字サイズ" value={design.nameFontSize} min={12} max={68} onChange={v => edit('nameFontSize', v)} />
                <ScaleField label="枠線の太さ" value={design.borderWidth} min={0} max={12} onChange={v => edit('borderWidth', v)} />
              </div>
            </>}
            {selectedCategory === 'score' && <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {[['circle','丸'],['rounded','角丸四角'],['square','正方形']].map(([value,label]) =>
                  <button type="button" key={value} style={smallButton(design.scoreShape === value)}
                    onClick={() => edit('scoreShape', value)}>{label}</button>)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 16 }}>
                <ScaleField label="大きさ" value={design.scoreSize} min={30} max={150} onChange={v => edit('scoreSize', v)} />
                <ScaleField label="文字サイズ" value={design.scoreFontSize} min={16} max={90} onChange={v => edit('scoreFontSize', v)} />
              </div>
            </>}
            {selectedCategory === 'round' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 16 }}>
              <ScaleField label="横幅" value={design.roundWidth} min={70} max={400} onChange={v => edit('roundWidth', v)} />
              <ScaleField label="高さ" value={design.roundHeight} min={35} max={150} onChange={v => edit('roundHeight', v)} />
              <ScaleField label="回戦の文字サイズ" value={design.roundFontSize} min={11} max={50} onChange={v => edit('roundFontSize', v)} />
              <ScaleField label="BOの文字サイズ" value={design.boFontSize} min={11} max={50} onChange={v => edit('boFontSize', v)} />
            </div>}
            {selectedCategory === 'title' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 16 }}>
              <ScaleField label="横幅" value={design.titleWidth} min={130} max={900} onChange={v => edit('titleWidth', v)} />
              <ScaleField label="高さ" value={design.titleHeight} min={24} max={130} onChange={v => edit('titleHeight', v)} />
              <ScaleField label="文字サイズ" value={design.titleFontSize} min={11} max={55} onChange={v => edit('titleFontSize', v)} />
            </div>}

            <h4 style={{ fontSize: 13, margin: '24px 0 12px' }}>カラー</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 14 }}>
              {COLOR_GROUPS[selectedCategory].map(([key, label]) =>
                <label key={key} style={{ ...field, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span>{label}</span>
                  <input type="color" value={design[key]} onChange={e => edit(key, e.target.value)}
                    style={{ width: 48, height: 34, padding: 1 }} />
                </label>)}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 24, paddingTop: 18, borderTop: '1px solid #e6e4eb' }}>
          <button type="button" disabled={loading || saving} onClick={() => { setDesign(normalizeOverlayDesign(DEFAULT_OVERLAY_DESIGN)); setSaveMessage(''); }}>初期配置に戻す</button>
          <button type="button" className="submit" disabled={loading || saving || !ownerId || !dirty} onClick={save}>{saving ? '保存中…' : 'デザインを保存'}</button>
        </div>
        {saveMessage && <p className="form-success" role="status" style={{ marginTop: 12 }}>{saveMessage}</p>}
        <p className="setting-help" style={{ marginTop: 10 }}>保存した設定はこのアカウントのOBS URLに反映されます。名前欄とスコア欄は分離して動かせます。</p>
      </section>
    </section>
  </main>;
}
