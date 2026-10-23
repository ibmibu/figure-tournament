'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const STORAGE_KEY = 'figure-tournament-list-v1';
const OWNER_KEY = 'figure-tournament-owner-v1';

export default function TournamentPage() {
  const params = useParams();
  const id = decodeURIComponent(String(params.id || ''));
  const [tournament, setTournament] = useState(null);
  const [ownerId, setOwnerId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function loadTournament() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      setTournament(saved.find(item => String(item.id) === id) || null);
      let owner = localStorage.getItem(OWNER_KEY);
      if (!owner) {
        owner = `owner-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(OWNER_KEY, owner);
      }
      setOwnerId(owner);
    } catch {
      setTournament(null);
    }
  }

  useEffect(() => { loadTournament(); }, [id]);

  function updateTournament(next) {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const updated = saved.map(item => String(item.id) === id ? next : item);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setTournament(next);
  }

  function joinTournament(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    const name = playerName.trim();
    if (!name) {
      setError('参加者名を入力してください。');
      return;
    }
    const joinedPlayers = tournament.joinedPlayers || [];
    if (joinedPlayers.length >= Number(tournament.participants || 8)) {
      setError('この大会は定員に達しています。');
      return;
    }
    if (joinedPlayers.some(player => player.name.toLowerCase() === name.toLowerCase())) {
      setError('同じ名前の参加者がすでに登録されています。');
      return;
    }
    try {
      updateTournament({ ...tournament, joinedPlayers: [...joinedPlayers, { id: `${Date.now()}`, name, joinedAt: new Date().toISOString() }] });
      setPlayerName('');
      setNotice('参加登録しました。');
    } catch {
      setError('参加登録を保存できませんでした。');
    }
  }

  function leaveTournament(playerId) {
    if (!window.confirm('この参加登録を取り消しますか？')) return;
    const next = { ...tournament, joinedPlayers: (tournament.joinedPlayers || []).filter(player => player.id !== playerId) };
    updateTournament(next);
  }

  function deleteTournament() {
    if (!window.confirm('この大会を削除しますか？この操作は取り消せません。')) return;
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved.filter(item => String(item.id) !== id)));
    window.location.href = '/';
  }

  if (!tournament) return <main className="page"><section className="intro"><a className="back-link" href="/">← 大会一覧に戻る</a><h1>大会が見つかりません</h1><p>このブラウザに大会データが保存されていないか、URLが正しくありません。</p></section></main>;

  const joinedPlayers = tournament.joinedPlayers || [];
  const isOwner = Boolean(tournament.ownerId && tournament.ownerId === ownerId);

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
        <div><span>開始時刻</span><strong>{tournament.date ? new Date(tournament.date).toLocaleString('ja-JP') : '未設定'}</strong></div>
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
      {joinedPlayers.length ? <ol className="joined-player-list">{joinedPlayers.map((player, index) => <li key={player.id}><span>{index + 1}. {player.name}</span>{isOwner && <button type="button" onClick={() => leaveTournament(player.id)}>登録を削除</button>}</li>)}</ol> : <p className="setting-help">まだ参加者はいません。</p>}
      <h3>参加する</h3>
      {joinedPlayers.length >= Number(tournament.participants || 8) ? <p className="setting-help">定員に達しています。</p> : <form onSubmit={joinTournament}>
        <label>参加者名<input value={playerName} onChange={event => setPlayerName(event.target.value)} placeholder="名前を入力" maxLength={40} required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="form-success" role="status">{notice}</p>}
        <button className="submit" type="submit">参加登録する</button>
      </form>}
      {isOwner && <div className="owner-actions"><p className="setting-help">あなたが作成した大会です。</p><button className="danger-button" type="button" onClick={deleteTournament}>この大会を削除</button></div>}
    </section>
    <footer>Figure Tournament</footer>
  </main>;
}
