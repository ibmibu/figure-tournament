'use client';

import { useEffect, useState } from 'react';
import SiteHeader from '../../components/SiteHeader';
import { getSupabaseBrowserClient } from '../../lib/supabase/client';
import { readTournamentCache, writeTournamentCache } from '../../lib/tournament-cache';

const EMPTY_PROFILE = { display_name: 'no name', avatar_data: '' };

export default function MyPage() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [draftName, setDraftName] = useState('no name');
  const [draftAvatar, setDraftAvatar] = useState('');
  const [editing, setEditing] = useState(false);
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
        const cacheKey = 'figure-profile-' + currentSession.user.id;
        try {
          const cached = window.localStorage.getItem(cacheKey);
          if (cached) {
            const cachedProfile = JSON.parse(cached);
            setProfile(cachedProfile);
            setDraftName(cachedProfile.display_name || 'no name');
            setDraftAvatar(cachedProfile.avatar_data || '');
          }
        } catch {}
        const cachedTournaments = readTournamentCache();
        if (cachedTournaments) {
          const cachedName = String(profile.display_name || 'no name').trim().toLowerCase();
          setTournaments(cachedTournaments.filter(item => item.isOwner || (item.joinedPlayers || []).some(player => String(player.name || '').trim().toLowerCase() === cachedName)));
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
        const all = tournamentResult.tournaments || [];
        writeTournamentCache(all);
        const myName = (loadedProfile.display_name || 'no name').trim().toLowerCase();
        setTournaments(all.filter(item => item.isOwner || (item.joinedPlayers || []).some(player => String(player.name || '').trim().toLowerCase() === myName)));
      } catch (e) {
        if (active) setError(e.message || '読み込みに失敗しました。');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, []);

  async function chooseImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('画像ファイルを選択してください。'); return; }
    if (file.size > 1024 * 1024) { setError('画像は1MB以下にしてください。'); return; }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = reject;
        reader.readAsDataURL(file);
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
        body: JSON.stringify({ display_name: draftName, avatar_data: draftAvatar }),
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

  const avatar = editing ? draftAvatar : profile.avatar_data;
  const displayName = editing ? draftName : profile.display_name;

  return <main className="page">
    <SiteHeader />
    <section className="my-page">
      <h1>マイページ</h1>
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="profile-panel">
        {<>
        <div className="profile-summary">
          {avatar ? <img className="profile-avatar" src={avatar} alt="プロフィールアイコン" /> : <div className="profile-avatar profile-avatar-empty" aria-label="初期アイコン" />}
          <div className="profile-name">{displayName || 'no name'}</div>
        </div>
        {!editing ? <button type="button" className="button-link" onClick={() => { setDraftName(profile.display_name || 'no name'); setDraftAvatar(profile.avatar_data || ''); setEditing(true); }}>プロフィールを編集</button> : <form onSubmit={saveProfile} className="profile-edit-form">
          <label>名前<input value={draftName} onChange={e => setDraftName(e.target.value)} maxLength={40} required placeholder="no name" /></label>
          <label>アイコン画像<input type="file" accept="image/*" onChange={chooseImage} /></label>
          <p className="setting-help">画像は1MB以下。画像を選ばず保存すると現在のアイコンを維持します。</p>
          <div className="form-actions"><button type="button" onClick={() => { setEditing(false); setError(''); }}>キャンセル</button><button className="submit" type="submit" disabled={saving}>{saving ? '保存中…' : '保存する'}</button></div>
        </form>}
        </>}
      </section>
      <section className="my-results">
        <h2>大会結果一覧</h2>
        {loading ? <p className="setting-help">読み込み中…</p> : tournaments.length === 0 ? <p className="setting-help">大会結果はまだありません。</p> : <div className="tournament-list">
          {tournaments.map(tournament => <a className="tournament-card tournament-card-link" href={`/tournaments/${encodeURIComponent(tournament.id)}`} key={tournament.id}>
            <div className="tournament-card-top"><h3>{tournament.name}</h3><span className="status">{tournament.status || '募集中'}</span></div>
            <div className="tournament-meta"><span>{tournament.format || '大会'}</span>{tournament.date && <span>{tournament.date.slice(0, 16).replace('T', ' ').replaceAll('-', '/')}</span>}</div>
          </a>)}
        </div>}
      </section>
    </section>
    <footer>Figure Tournament</footer>
  </main>;
}
