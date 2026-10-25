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
  const [demoName, setDemoName] = useState('');
  const [savingBracket, setSavingBracket] = useState(false);

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

  function demoPlayersFor(current) {
    return (current.joinedPlayers || []).filter(player => player.isDemo);
  }

  function makeBracket(players) {
    const size = 2 ** Math.ceil(Math.log2(Math.max(2, players.length)));
    const slots = [...players];
    while (slots.length < size) slots.push(null);
    const rounds = [];
    let count = size / 2;
    for (let round = 0; count >= 1; round++, count = count / 2) {
      rounds.push(Array.from({ length: count }, (_, index) => ({
        id: `r${round + 1}-m${index + 1}`,
        player1: round === 0 ? slots[index * 2] : null,
        player2: round === 0 ? slots[index * 2 + 1] : null,
        winnerId: null,
      })));
    }
    // Bye slots advance automatically.
    for (let r = 0; r < rounds.length - 1; r++) {
      rounds[r].forEach((match, i) => {
        if (Boolean(match.player1) !== Boolean(match.player2)) {
          match.winnerId = (match.player1 || match.player2).id;
          rounds[r + 1][Math.floor(i / 2)][i % 2 === 0 ? 'player1' : 'player2'] = match.player1 || match.player2;
        }
      });
    }
    return { rounds, complete: false, startedAt: new Date().toISOString() };
  }

  function bracketPlacements(bracket) {
    if (!bracket?.complete || !bracket.rounds?.length) return [];
    const rounds = bracket.rounds;
    const winner = rounds[rounds.length - 1]?.[0]?.winnerId;
    const runnerUpMatch = rounds[rounds.length - 1]?.[0];
    const rows = [];
    if (winner) rows.push({ playerId: winner, place: '優勝' });
    if (runnerUpMatch) {
      const runnerUp = [runnerUpMatch.player1, runnerUpMatch.player2].find(p => p && p.id !== winner);
      if (runnerUp) rows.push({ playerId: runnerUp.id, place: '準優勝' });
    }
    for (let r = rounds.length - 2; r >= 0; r--) {
      const losingPlayers = rounds[r].filter(m => m.winnerId).map(m => [m.player1, m.player2].find(p => p && p.id !== m.winnerId)).filter(Boolean);
      const label = r === rounds.length - 2 ? 'ベスト4' : r === rounds.length - 3 ? 'ベスト8' : `ベスト${2 ** (rounds.length - r)}`;
      losingPlayers.forEach(p => rows.push({ playerId: p.id, place: label }));
    }
    return rows;
  }

  async function saveBracket(nextTournament) {
    setSavingBracket(true);
    setError('');
    try {
      await updateTournament(nextTournament);
      setNotice('トーナメント表を保存しました。');
    } catch (e) {
      setError(e.message || 'トーナメント表を保存できませんでした。');
    } finally {
      setSavingBracket(false);
    }
  }

  async function addDemoPlayer() {
    const name = demoName.trim();
    if (!name) { setError('デモプレイヤー名を入力してください。'); return; }
    if (!isOwner) return;
    if (tournament.bracket) { setError('トーナメント開始後は参加者を追加できません。'); return; }
    const players = tournament.joinedPlayers || [];
    if (players.length >= Number(tournament.participants || 8)) { setError('定員に達しています。'); return; }
    if (players.some(p => p.name.trim().toLowerCase() === name.toLowerCase())) { setError('同じ名前の参加者がいます。'); return; }
    const next = { ...tournament, joinedPlayers: [...players, { id: `demo-${Date.now()}`, name, isDemo: true }] };
    setDemoName('');
    await saveBracket(next);
  }

  async function startBracket() {
    if (!isOwner) return;
    const players = tournament.joinedPlayers || [];
    if (players.length < 2) { setError('トーナメント開始には参加者が2人以上必要です。'); return; }
    const next = { ...tournament, status: '対戦中', bracket: makeBracket(players), resultPlacements: null };
    await saveBracket(next);
  }

  async function setMatchWinner(roundIndex, matchIndex, playerId) {
    if (!isOwner || !tournament.bracket) return;
    const bracket = JSON.parse(JSON.stringify(tournament.bracket));
    const match = bracket.rounds[roundIndex][matchIndex];
    match.winnerId = playerId;
    if (roundIndex < bracket.rounds.length - 1) {
      const nextMatch = bracket.rounds[roundIndex + 1][Math.floor(matchIndex / 2)];
      const slot = matchIndex % 2 === 0 ? 'player1' : 'player2';
      nextMatch[slot] = [match.player1, match.player2].find(p => p && p.id === playerId) || null;
      nextMatch.winnerId = null;
      // Clear all downstream matches because the advancing player changed.
      for (let r = roundIndex + 1; r < bracket.rounds.length; r++) {
        for (const m of bracket.rounds[r]) {
          if (r > roundIndex + 1 || m !== nextMatch) { m.winnerId = null; }
        }
      }
    }
    bracket.complete = bracket.rounds[bracket.rounds.length - 1][0].winnerId != null;
    const next = { ...tournament, bracket, status: bracket.complete ? '終了' : '対戦中', resultPlacements: bracket.complete ? bracketPlacements(bracket) : null, completedAt: bracket.complete ? new Date().toISOString() : null };
    await saveBracket(next);
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

  if (loading && !tournament) return <main className="page"><SiteHeader /><section className="intro"><p>大会情報を読み込み中…</p></section></main>;

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
      {isOwner && !tournament.bracket && <section className="bracket-panel">
        <h3>デモモード</h3>
        <p className="setting-help">テスト用の架空プレイヤーを追加できます。デモ参加者は実際のログイン参加者とは区別されます。</p>
        <div className="demo-player-form"><input value={demoName} onChange={e => setDemoName(e.target.value)} placeholder="例：テストプレイヤー1" aria-label="デモプレイヤー名" /><button type="button" onClick={addDemoPlayer}>デモ参加者を追加</button></div>
        <button className="submit" type="button" onClick={startBracket} disabled={savingBracket || joinedPlayers.length < 2}>トーナメントを開始（{joinedPlayers.length}人）</button>
      </section>}
      {tournament.bracket && <section className="bracket-panel">
        <div className="tournament-card-top"><h3>トーナメント表</h3><span className="status">{tournament.bracket.complete ? '結果確定' : '対戦中'}</span></div>
        <p className="setting-help">主催者は各対戦の勝者を選択してください。選んだ勝者は次のラウンドへ進みます。</p>
        <div className="bracket-rounds">{tournament.bracket.rounds.map((round, ri) => <div className="bracket-round" key={ri}><strong>{ri === tournament.bracket.rounds.length - 1 ? '決勝' : ri === tournament.bracket.rounds.length - 2 ? '準決勝' : `第${ri + 1}回戦`}</strong>{round.map((match, mi) => <div className="bracket-match" key={match.id}><div>{[match.player1, match.player2].map((player, pi) => <button key={pi} type="button" disabled={!isOwner || !player || !match.player1 || !match.player2 || savingBracket || tournament.bracket.complete} className={match.winnerId === player?.id ? 'bracket-player winner' : 'bracket-player'} onClick={() => player && setMatchWinner(ri, mi, player.id)}>{player?.name || 'BYE'}{match.winnerId === player?.id ? ' ✓' : ''}{player?.isDemo ? '（デモ）' : ''}</button>)}</div></div>)}</div>)}</div>
        {tournament.bracket.complete && <><h3>確定順位</h3><ol className="joined-player-list">{(tournament.resultPlacements || bracketPlacements(tournament.bracket)).map((row, i) => { const player = joinedPlayers.find(p => p.id === row.playerId); return player ? <li key={row.playerId}><strong>{row.place}</strong>　{player.name}{player.isDemo ? '（デモ）' : ''}</li> : null; })}</ol></>}
        {isOwner && tournament.bracket.complete && <button type="button" onClick={() => window.confirm('トーナメント表をリセットしますか？順位結果も消えます。') && saveBracket({ ...tournament, status: '募集中', bracket: null, resultPlacements: null, completedAt: null })}>トーナメントをリセット</button>}
      </section>}
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
