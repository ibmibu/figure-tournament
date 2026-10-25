'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import SiteHeader from '../../../components/SiteHeader';
import { getSupabaseBrowserClient } from '../../../lib/supabase/client';
import { readTournamentCache, updateCachedTournament, removeCachedTournament } from '../../../lib/tournament-cache';

const OWNER_KEY = 'figure-tournament-owner-v1';

export default function TournamentPage() {
  const params = useParams();
  const id = decodeURIComponent(String(params.id || ''));
  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ownerId, setOwnerId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadTournament() {
    setLoading(true);
    setError('');
    try {
      const cached = readTournamentCache() || [];
      const cachedTournament = cached.find(item => String(item.id) === String(id));
      if (cachedTournament) setTournament(cachedTournament);

      const owner = localStorage.getItem(OWNER_KEY) || '';
      setOwnerId(owner);
      let accessToken = '';
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        accessToken = data.session?.access_token || '';
        setAccessToken(accessToken);
        if (accessToken) {
          const profileResponse = await fetch('/api/profile', { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
          const profileResult = await profileResponse.json();
          if (profileResponse.ok) setAccountName(String(profileResult.profile?.display_name || 'no name').trim());
        }
      } catch {}
      const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
      const response = await fetch(`/api/tournaments?id=${encodeURIComponent(id)}&ownerToken=${encodeURIComponent(owner)}`, { cache: 'no-store', headers });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '大会を読み込めませんでした。');
      if (result.tournament) {
        setTournament(result.tournament);
        updateCachedTournament(result.tournament);
      } else if (!cachedTournament) {
        setTournament(null);
      }
    } catch (loadError) {
      console.error(loadError);
      const cached = readTournamentCache() || [];
      const cachedTournament = cached.find(item => String(item.id) === String(id));
      if (cachedTournament) setTournament(cachedTournament);
      else setTournament(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTournament(); }, [id]);

  async function updateTournament(next) {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error('大会の管理にはGoogleログインが必要です。');
    const response = await fetch('/api/tournaments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ tournament: next, ownerToken: ownerId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '大会情報を保存できませんでした。');
    setTournament(next);
    updateCachedTournament(next);
  }

  async function joinTournament(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!accessToken) {
      window.location.href = `/login?next=${encodeURIComponent(`/tournaments/${id}`)}`;
      return;
    }
    if (!accountName || accountName === 'no name') {
      setError('参加する前にマイページで名前を設定してください。');
      return;
    }
    try {
      const response = await fetch('/api/tournaments/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '参加登録を保存できませんでした。');
      setTournament(current => {
        const next = { ...current, joinedPlayers: result.joinedPlayers };
        updateCachedTournament(next);
        return next;
      });
      setNotice('参加登録しました。');
    } catch (joinError) {
      setError(joinError.message || '参加登録を保存できませんでした。');
    }
  }

  async function leaveTournament(playerId) {
    if (!window.confirm('この参加登録を取り消しますか？')) return;
    const next = { ...tournament, joinedPlayers: (tournament.joinedPlayers || []).filter(player => player.id !== playerId) };
    try { await updateTournament(next); } catch (updateError) { setError(updateError.message); }
  }

  async function deleteTournament() {
    if (!window.confirm('この大会を削除しますか？この操作は取り消せません。')) return;
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error('大会の削除にはGoogleログインが必要です。');
      const response = await fetch('/api/tournaments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ id, ownerToken: ownerId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '削除できませんでした。');
      removeCachedTournament(id);
      window.location.href = '/';
    } catch (deleteError) {
      setError(deleteError.message || '大会を削除できませんでした。');
    }
  }

  if (!tournament) return <main className="page">
    <SiteHeader /><section className="intro">
      <a className="back-link" href="/">← 大会一覧に戻る</a><h1>大会が見つかりません</h1><p>このブラウザに大会データが保存されていないか、URLが正しくありません。</p></section></main>;

  const joinedPlayers = tournament.joinedPlayers || [];
  const isOwner = Boolean(tournament.isOwner);

  return <main className="page">
    <section className="intro">
      <a className="back-link" href="/">← 大会一覧に戻る</a>
      <h1>{tournament.name}</h1>
      <p>大会詳細・参加登録</p>
    </section>
    <section className="create-panel tournament-detail">
      <div className="tournament-card-top"><h2>大会概要</h2><span className="status">{tournament.status || '募集中'}</span></div>
      <div className="detail-grid">
        <div><span>対戦形式</span><strong>{tournament.format || `BO${tournament.bestOf || 3}`}</strong></div>
        <div><span>参加人数</span><strong>{joinedPlayers.length}/{tournament.participants || 8}人</strong></div>
        <div><span>開始時刻</span><strong>{tournament.date ? `${tournament.date.slice(0, 10).replaceAll('-', '/')} ${tournament.date.slice(11, 16)}` : '未設定'}</strong></div>
        <div><span>拒否ステージ</span><strong>{tournament.stageRejects ? 'あり' : 'なし'}</strong></div>
      </div>
      <h3>大会説明</h3>
      <p className="generated-description">{(tournament.description || '大会の詳細設定をご確認ください。').replace(/\\n|\/n/g, '\n')}</p>
      <h3>使用ステージ</h3>
      <div className="detail-stage-list">{(tournament.stages || []).map(stage => <span key={stage}>{stage}</span>)}</div>
      {tournament.stageRejects && tournament.stageSettings && <>
        <h3>拒否ステージ設定</h3>
        <p className="generated-description">スターター：{(tournament.stageSettings.starterStages || []).join('、') || '未設定'}</p>
        <p className="generated-description">カウンターピック：{(tournament.stageSettings.counterpickStages || []).join('、') || '未設定'}</p>
        <p className="generated-description">最初のプレイヤー：{tournament.stageSettings.firstPlayerRejects}ステージ拒否／次のプレイヤー：{tournament.stageSettings.secondPlayerRejects}ステージ拒否／2ゲーム目以降：{tournament.stageSettings.laterRejects}ステージ拒否</p>
      </>}
      <h3>参加者（{joinedPlayers.length}/{tournament.participants || 8}人）</h3>
      {joinedPlayers.length ? <ul className="joined-player-list">{joinedPlayers.map(player => <li key={player.id}><span>{player.name}</span>{isOwner && <button type="button" onClick={() => leaveTournament(player.id)}>登録を削除</button>}</li>)}</ul> : <p className="setting-help">まだ参加者はいません。</p>}
      <h3>参加する</h3>
      {joinedPlayers.length >= Number(tournament.participants || 8) ? <p className="setting-help">定員に達しています。</p> : <form onSubmit={joinTournament}>
        {accessToken ? <p className="setting-help">参加者名：{accountName || '読み込み中…'}</p> : <p className="setting-help">参加登録にはログインが必要です。</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="form-success" role="status">{notice}</p>}
        <button className="submit" type="submit">参加登録する</button>
      </form>}
      {isOwner && <div className="owner-actions"><p className="setting-help">あなたが作成した大会です。</p><button className="danger-button" type="button" onClick={deleteTournament}>この大会を削除</button></div>}
    </section>
    <footer>Figure Tournament</footer>
  </main>;
}
