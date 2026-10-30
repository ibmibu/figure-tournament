'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '../../lib/supabase/client';
import { readTournamentCache, writeTournamentCache } from '../../lib/tournament-cache';
import { readTabSnapshot, writeTabSnapshot } from '../../lib/tab-snapshot';

const EMPTY_PROFILE = { display_name: 'no name', avatar_data: '', friend_code: '', public_uid: null };

export default function MyPage({ colorsOnly = false }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [draftName, setDraftName] = useState('no name');
  const [draftAvatar, setDraftAvatar] = useState('');
  const [draftFriendCode, setDraftFriendCode] = useState('');
  const [editing, setEditing] = useState(false);
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [myColors, setMyColors] = useState([]);
  const [selectedFighter, setSelectedFighter] = useState('マリオ');
  const [selectedColor, setSelectedColor] = useState('1P');
  const [editingColors, setEditingColors] = useState(false);
  const [colorsReady, setColorsReady] = useState(false);
  const [savingColors, setSavingColors] = useState(false);
  const fighters = ['マリオ','ドンキーコング','リンク','サムス','ダークサムス','ヨッシー','カービィ','フォックス','ピカチュウ','ルイージ','ネス','キャプテン・ファルコン','プリン','ピーチ','デイジー','クッパ','アイスクライマー','シーク','ゼルダ','ドクターマリオ','ピチュー','ファルコ','マルス','ルキナ','こどもリンク','ガノンドロフ','ミュウツー','ロイ','クロム','Mr.ゲーム＆ウォッチ','メタナイト','ピット','ブラックピット','ゼロスーツサムス','ワリオ','スネーク','アイク','ゼニガメ','フシギソウ','リザードン','ディディーコング','リュカ','ソニック','デデデ','ピクミン＆オリマー','ルカリオ','ロボット','トゥーンリンク','ウルフ','むらびと','ロックマン','Wii Fit トレーナー','ロゼッタ＆チコ','リトル・マック','ゲッコウガ','Mii 格闘タイプ','Mii 剣術タイプ','Mii 射撃タイプ','パルテナ','パックマン','ルフレ','シュルク','クッパJr.','ダックハント','リュウ','ケン','クラウド','カムイ','ベヨネッタ','インクリング','リドリー','シモン','リヒター','キングクルール','しずえ','ガオガエン','パックンフラワー','ジョーカー','勇者','バンジョー＆カズーイ','テリー','ベレト／ベレス','ミェンミェン','スティーブ','セフィロス','ホムラ／ヒカリ','カズヤ','ソラ'];

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        const currentSession = data.session;
        if (!currentSession) {
          window.location.href = '/login?next=/mypage';
          return;
        }
        if (!active) return;
        setSession(currentSession);
        const snapshot = readTabSnapshot('mypage-' + currentSession.user.id);
        if (snapshot) {
          setProfile(snapshot.profile);
          setDraftName(snapshot.profile.display_name || 'no name');
          setDraftAvatar(snapshot.profile.avatar_data || '');
          setDraftFriendCode(snapshot.profile.friend_code || '');
          setTournaments(snapshot.tournaments);
          setMyColors(snapshot.colors || []);
          setColorsReady(true);
          setLoading(false);
          return;
        }
        let localColors = [];
        try { localColors = JSON.parse(window.localStorage.getItem('figure-my-colors-' + currentSession.user.id) || '[]'); } catch {}
        if (!Array.isArray(localColors)) localColors = [];
        setMyColors(localColors);
        try {
          const response = await fetch('/api/my-colors', { headers: { Authorization: `Bearer ${currentSession.access_token}` }, cache: 'no-store' });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'マイカラーを読み込めませんでした。');
          if (!active) return;
          if (Array.isArray(result.colors)) {
            setMyColors(result.colors);
            try { window.localStorage.setItem('figure-my-colors-' + currentSession.user.id, JSON.stringify(result.colors)); } catch {}
          } else if (localColors.length) {
            const migrated = await fetch('/api/my-colors', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentSession.access_token}` },
              body: JSON.stringify({ colors: localColors }),
            });
            if (!migrated.ok) throw new Error('以前のマイカラーをアカウントに移行できませんでした。');
          }
        } catch (colorError) {
          if (active) setError(colorError.message || 'マイカラーの同期に失敗しました。');
        } finally {
          if (active) setColorsReady(true);
        }
        const cacheKey = 'figure-profile-' + currentSession.user.id;
        try {
          const cached = window.localStorage.getItem(cacheKey);
          if (cached) {
            const cachedProfile = JSON.parse(cached);
            setProfile(cachedProfile);
            setDraftName(cachedProfile.display_name || 'no name');
            setDraftAvatar(cachedProfile.avatar_data || '');
            setDraftFriendCode(cachedProfile.friend_code || '');
          }
        } catch {}
        const cachedTournaments = readTournamentCache();
        if (cachedTournaments) {
          setTournaments(cachedTournaments.filter(item => item.isOwner || (item.joinedPlayers || []).some(player => !player.isDemo && String(player.userId || player.id) === String(currentSession.user.id))));
        }
        const headers = { Authorization: `Bearer ${currentSession.access_token}` };
        const [profileResponse, tournamentResponse] = await Promise.all([
          fetch('/api/profile', { headers, cache: 'no-store' }),
          fetch('/api/tournaments', { headers, cache: 'no-store' }),
        ]);
        const profileResult = await profileResponse.json();
        const tournamentResult = await tournamentResponse.json();
        if (!profileResponse.ok) throw new Error(profileResult.error || 'プロフィールを読み込めませんでした。');
        if (!tournamentResponse.ok) throw new Error(tournamentResult.error || '大会結果を読み込めませんでした。');
        if (!active) return;
        const loadedProfile = profileResult.profile || EMPTY_PROFILE;
        setProfile(loadedProfile);
        try { window.localStorage.setItem(cacheKey, JSON.stringify(loadedProfile)); } catch {}
        setDraftName(loadedProfile.display_name || 'no name');
        setDraftAvatar(loadedProfile.avatar_data || '');
        setDraftFriendCode(loadedProfile.friend_code || '');
        const all = tournamentResult.tournaments || [];
        writeTournamentCache(all);
        const myTournaments = all.filter(item => item.isOwner || (item.joinedPlayers || []).some(player => !player.isDemo && String(player.userId || player.id) === String(currentSession.user.id)));
        setTournaments(myTournaments);
        writeTabSnapshot('mypage-' + currentSession.user.id, { profile: loadedProfile, tournaments: myTournaments, colors: JSON.parse(localStorage.getItem('figure-my-colors-' + currentSession.user.id) || '[]') });
      } catch (e) {
        if (active) setError(e.message || '読み込みに失敗しました。');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, []);

  async function saveMyColors(next) {
    if (!session || !colorsReady || savingColors) return;
    setSavingColors(true);
    setError('');
    try {
      const response = await fetch('/api/my-colors', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ colors: next }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'マイカラーを保存できませんでした。');
      setMyColors(result.colors);
      try { window.localStorage.setItem('figure-my-colors-' + session.user.id, JSON.stringify(result.colors)); } catch {}
    } catch (e) {
      setError(e.message || 'マイカラーを保存できませんでした。');
    } finally {
      setSavingColors(false);
    }
  }

  function addMyColor() {
    const fighter = availableFighters.includes(selectedFighter) ? selectedFighter : availableFighters[0];
    if (!fighter) return;
    if (myColors.some(item => item.fighter === fighter)) {
      setError('このファイターのカラーは登録済みです。編集から削除して変更してください。');
      return;
    }
    saveMyColors([...myColors, { fighter, color: selectedColor }]);
    setError('');
  }

  async function chooseImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('画像ファイルを選択してください。'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('画像は5MB以下にしてください。'); return; }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            const maxSide = 256;
            const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            const context = canvas.getContext('2d');
            if (!context) throw new Error('画像を処理できません。');
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const output = canvas.toDataURL('image/webp', 0.82);
            if (!output.startsWith('data:image/webp;')) throw new Error('WebPへの変換に対応していません。');
            resolve(output);
          } catch (error) { reject(error); }
          finally { URL.revokeObjectURL(url); }
        };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めません。')); };
        image.src = url;
      });
      setDraftAvatar(dataUrl);
      setError('');
    } catch {
      setError('画像を読み込めませんでした。');
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!session) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ display_name: draftName, avatar_data: draftAvatar, friend_code: draftFriendCode }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'プロフィールを保存できませんでした。');
      setProfile(result.profile);
      try { window.localStorage.setItem('figure-profile-' + session.user.id, JSON.stringify(result.profile)); } catch {}
      setEditing(false);
    } catch (e) {
      setError(e.message || '保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  }

  const availableFighters = fighters.filter(name => !myColors.some(item => item.fighter === name));
  const activeFighter = availableFighters.includes(selectedFighter) ? selectedFighter : (availableFighters[0] || '');
  const avatar = editing ? draftAvatar : profile.avatar_data;
  const displayName = editing ? draftName : profile.display_name;

  return <main className="page mypage-layout">
    
    <section className="my-page">
      <h1>{colorsOnly ? 'マイカラー登録' : 'マイページ'}</h1>
      {colorsOnly && <Link className="my-colors-back" href="/mypage">← マイページに戻る</Link>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!colorsOnly && <>
        <section className="mypage-minimal-profile">
          <div className="profile-summary">
            {avatar ? <img className="profile-avatar" src={avatar} alt="プロフィールアイコン" /> : <div className="profile-avatar profile-avatar-empty" aria-label="初期アイコン" />}
            <div className="mypage-profile-info">
              <div className="profile-name">{displayName || 'no name'}</div>
              
              {!editing && <div className="setting-help">フレンドコード：{profile.friend_code || '未登録'}</div>}
              {!editing && <button type="button" className="mypage-edit-link" onClick={() => { setDraftName(profile.display_name || 'no name'); setDraftAvatar(profile.avatar_data || ''); setDraftFriendCode(profile.friend_code || ''); setEditing(true); }}>プロフィールを編集 <span aria-hidden="true">›</span></button>}
            </div>
          </div>
          {editing && <form onSubmit={saveProfile} className="profile-edit-form">
            <label>名前<input value={draftName} onChange={e => setDraftName(e.target.value)} maxLength={40} required placeholder="no name" /></label>
            <label>フレンドコード<input value={draftFriendCode} onChange={e => setDraftFriendCode(e.target.value.toUpperCase())} placeholder="SW-0000-0000-0000" pattern="[A-Za-z0-9-]+" title="英数字とハイフンのみ" /></label>
            <label>アイコン画像<input type="file" accept="image/*" onChange={chooseImage} /></label>
            <p className="setting-help">画像は5MB以下。選択すると自動でWebP形式（最大256px）に圧縮します。</p>
            <div className="form-actions"><button type="button" onClick={() => { setEditing(false); setError(''); }}>キャンセル</button><button className="submit" type="submit" disabled={saving}>{saving ? '保存中…' : '保存する'}</button></div>
          </form>}
        </section>
        <nav className="mypage-minimal-nav" aria-label="マイページメニュー">
          <Link href="/results" className="mypage-minimal-link">大会結果一覧 <span aria-hidden="true">›</span></Link>
          <Link href="/mypage/colors" className="mypage-minimal-link">マイカラー登録 <span aria-hidden="true">›</span></Link>
        </nav>
      </>}
      {colorsOnly && <section className="my-results my-color-panel">
        <div className="my-color-heading">
          <h2>マイカラー登録</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={addMyColor} disabled={!colorsReady || savingColors || availableFighters.length === 0}>追加</button>
            <button type="button" onClick={() => setEditingColors(value => !value)}>{editingColors ? '編集終了' : '編集'}</button>
          </div>
        </div>
        <p className="setting-help">キャラ報告で使うカラーを登録します。登録したカラーは初期値になります。</p>
        <div className="my-color-form">
          <select aria-label="ファイター" value={activeFighter} onChange={e => setSelectedFighter(e.target.value)} disabled={!colorsReady || savingColors || availableFighters.length === 0} className="my-color-fighter-select">{availableFighters.map(name => <option key={name} value={name}>{name}</option>)}</select>
          <select aria-label="カラー" value={selectedColor} onChange={e => setSelectedColor(e.target.value)} className="my-color-variant-select">{['1P','2P','3P','4P','5P','6P','7P','8P'].map(color => <option key={color} value={color}>{color}</option>)}</select>
        </div>
        <div className="my-color-list">
          {myColors.length === 0 ? <p className="setting-help">登録したカラーはここに表示されます。</p> : myColors.map(item => <div className={`my-color-item${editingColors ? ' is-editing' : ''}`} key={item.fighter}><span className="my-color-name">{item.fighter}</span><span className="my-color-value">{item.color}</span>{editingColors && <button type="button" className="my-color-delete" disabled={savingColors || !colorsReady} onClick={() => saveMyColors(myColors.filter(value => value.fighter !== item.fighter))}>削除</button>}</div>)}
        </div>
      </section>}
    </section>
    
  </main>;
}
