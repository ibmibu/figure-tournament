'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '../../../lib/supabase/client';
import OverlayScoreboardArtwork from '../../../components/OverlayScoreboardArtwork';
import {
  DEFAULT_OVERLAY_DESIGN, normalizeOverlayDesign, overlayPartPosition, moveOverlayPart,
  setOverlayMirror, overlayPartSize, overlayImageUrl, OVERLAY_WIDTH, OVERLAY_HEIGHT,
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
  const [uploading, setUploading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(1);
  const [activeSlot, setActiveSlot] = useState(1);
  const [slots, setSlots] = useState([null, null, null]);
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
        const storedSlots = Array.isArray(result.slots) && result.slots.length === 3
          ? result.slots.map(item => item ? normalizeOverlayDesign(item) : null)
          : [result.design ? normalizeOverlayDesign(result.design) : null, null, null];
        const slot = [1, 2, 3].includes(result.activeSlot) ? result.activeSlot : 1;
        const next = normalizeOverlayDesign(storedSlots[slot - 1] || DEFAULT_OVERLAY_DESIGN);
        setSlots(storedSlots);
        setSelectedSlot(slot);
        setActiveSlot(slot);
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
  function chooseSlot(slot) {
    if (slot === selectedSlot || uploading || saving) return;
    if (dirty && !window.confirm('このスロットの未保存の変更を破棄して切り替えますか？')) return;
    const next = normalizeOverlayDesign(slots[slot - 1] || DEFAULT_OVERLAY_DESIGN);
    setSelectedSlot(slot);
    setDesign(next);
    setSaved(next);
    setSaveMessage('');
    setError('');
  }

  async function useSavedSlot() {
    if (dirty || !slots[selectedSlot - 1] || saving) return;
    setSaving(true);
    setError('');
    setSaveMessage('');
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session?.access_token) throw new Error('ログインし直してください。');
      const response = await fetch('/api/overlay-design', {
        method: 'PATCH', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
        body: JSON.stringify({ slot: selectedSlot }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'デザインを切り替えられませんでした。');
      setActiveSlot(result.activeSlot);
      setSaveMessage('保存先' + selectedSlot + 'をOBSで使用するデザインに切り替えました。');
    } catch (e) { setError(e.message || '切り替えに失敗しました。'); }
    finally { setSaving(false); }
  }

  async function uploadPartImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || uploading || saving) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
      setError('PNG・JPEG・WebP形式で12MB以下の画像を選んでください。');
      return;
    }
    const part = selectedCategory;
    const targetSlot = selectedSlot;
    setUploading(true);
    setError('');
    setSaveMessage('');
    try {
      const bitmap = await createImageBitmap(file);
      const ratio = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('画像を変換できませんでした。');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      const toWebp = quality => new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
      let converted = await toWebp(0.85);
      if (converted && converted.size > 1048576) converted = await toWebp(0.65);
      if (!converted || converted.type !== 'image/webp' || converted.size > 1048576) {
        throw new Error('画像の変換後サイズが大きすぎます。別の画像を試してください。');
      }
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session?.access_token) throw new Error('ログインし直してください。');
      const body = new FormData();
      body.append('slot', String(targetSlot));
      body.append('category', part);
      body.append('file', converted, part + '.webp');
      const response = await fetch('/api/overlay-image', {
        method: 'POST', headers: { Authorization: 'Bearer ' + data.session.access_token }, body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '画像を保存できませんでした。');
      setDesign(prev => normalizeOverlayDesign({
        ...prev, images: { ...prev.images, [part]: result.path },
      }));
      setSaveMessage('画像を読み込みました。「デザインを保存」でこのスロットに反映してください。');
    } catch (e) {
      setError(e.message || '画像を読み込めませんでした。');
    } finally { setUploading(false); }
  }

  async function save() {
    if (!ownerId || saving || loading || uploading) return;
    setSaving(true);
    setError('');
    setSaveMessage('');
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session?.access_token) throw new Error('ログインし直してください。');
      const response = await fetch('/api/overlay-design', {
        method: 'PUT', headers: {
          'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token,
        }, body: JSON.stringify({ design, slot: selectedSlot }), cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'デザインを保存できませんでした。');
      setSaved(result.design);
      setDesign(result.design);
      setSlots(result.slots);
      setActiveSlot(result.activeSlot);
      setSaveMessage('保存先' + selectedSlot + 'に保存し、OBSにも反映しました。');
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
        <div style={{ borderTop: '1px solid #e6e4eb', marginTop: 18, paddingTop: 17 }}>
          <h3 style={{ fontSize: 15, margin: '0 0 10px' }}>デザインの保存先</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
            {[1, 2, 3].map(slot => <button key={slot} type="button"
              onClick={() => chooseSlot(slot)} disabled={loading || uploading || saving}
              style={{ ...smallButton(selectedSlot === slot), display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
              <strong>保存先 {slot}</strong>
              <span style={{ fontSize: 11 }}>{slot === activeSlot ? 'OBSで使用中' : slots[slot - 1] ? '保存済み' : '未登録'}</span>
            </button>)}
          </div>
          <p className="setting-help" style={{ marginTop: 9 }}>選択した保存先を編集できます。「デザインを保存」でOBSにも適用します。未保存のデザインは切り替え時に確認します。</p>
          {selectedSlot !== activeSlot && slots[selectedSlot - 1] && !dirty && <button type="button"
            style={{ ...smallButton(), marginTop: 10 }} disabled={saving || uploading} onClick={useSavedSlot}>
            この保存先をOBSで使用する
          </button>}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>
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
            <h4 style={{ fontSize: 13, margin: '24px 0 12px' }}>背景画像</h4>
            <p className="setting-help" style={{ marginBottom: 10 }}>
              このカテゴリの背景に好きな画像を設定できます。文字やスコアは画像の上に表示されます。
              左右の名前・スコアには同じ画像を使います。PNG・JPEG・WebP対応（透過PNGも可）。
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
              <label style={{ ...field, cursor: 'pointer' }}>
                <span>画像を選択</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadPartImage}
                  disabled={loading || saving || uploading} style={{ maxWidth: '100%', fontSize: 12 }} />
              </label>
              {uploading && <span role="status" className="setting-help">画像を読み込み中…</span>}
              {design.images?.[selectedCategory] && <>
                <img src={overlayImageUrl(design, selectedCategory)} alt="設定した背景画像"
                  style={{ width: 120, height: 60, objectFit: 'contain', background: '#ebebef', border: '1px solid #d8d5e0' }} />
                <button type="button" disabled={uploading || saving} onClick={() => {
                  setDesign(prev => normalizeOverlayDesign({ ...prev, images: { ...prev.images, [selectedCategory]: '' } }));
                  setSaveMessage('');
                }}>画像を外す</button>
              </>}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 24, paddingTop: 18, borderTop: '1px solid #e6e4eb' }}>
          <button type="button" disabled={loading || saving || uploading} onClick={() => { setDesign(normalizeOverlayDesign(DEFAULT_OVERLAY_DESIGN)); setSaveMessage(''); }}>初期配置に戻す</button>
          <button type="button" className="submit" disabled={loading || saving || uploading || !ownerId || (!dirty && Boolean(slots[selectedSlot - 1]))} onClick={save}>{saving ? '保存中…' : 'デザインを保存'}</button>
        </div>
        {saveMessage && <p className="form-success" role="status" style={{ marginTop: 12 }}>{saveMessage}</p>}
        <p className="setting-help" style={{ marginTop: 10 }}>保存した設定はこのアカウントのOBS URLに反映されます。名前欄とスコア欄は分離して動かせます。</p>
      </section>
    </section>
  </main>;
}
