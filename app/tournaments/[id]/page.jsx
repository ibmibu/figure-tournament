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
  const [currentUserId, setCurrentUserId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [demoName, setDemoName] = useState('');
  const [savingBracket, setSavingBracket] = useState(false);
  const [activeMatchId, setActiveMatchId] = useState('');
  const [rejectSelection, setRejectSelection] = useState([]);
  const [stageSelection, setStageSelection] = useState('');
  const [showTournamentOverview, setShowTournamentOverview] = useState(false);

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
        setCurrentUserId(data.session?.user?.id || '');
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

  // 大会ページを開いたら自分の未完了対戦を自動表示し、管理者なら対戦状態も開始する。
  useEffect(() => {
    if (!tournament?.bracket || !currentUserId || tournament.bracket.complete) return;
    for (let ri = 0; ri < (tournament.bracket.rounds || []).length; ri++) {
      const round = tournament.bracket.rounds[ri];
      const mi = round.findIndex(match =>
        !match.winnerId && match.player1 && match.player2 &&
        (String(match.player1.id) === String(currentUserId) || String(match.player2.id) === String(currentUserId))
      );
      if (mi >= 0) {
        const ownMatch = round[mi];
        setActiveMatchId(ownMatch.id);
        if (!ownMatch.matchState) startMatch(ri, mi);
        return;
      }
    }
    setActiveMatchId('');
  }, [tournament, currentUserId]);

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
    setTimeout(() => document.getElementById('tournament-bracket')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  function getMatchStageLists() {
    const selected = tournament?.stages || [];
    const settings = tournament?.stageSettings || {};
    const starter = (settings.starterStages || selected).filter(stage => selected.includes(stage));
    const counter = (settings.counterpickStages || selected).filter(stage => selected.includes(stage));
    return { selected, starter: starter.length ? starter : selected, counter };
  }

  function startMatch(roundIndex, matchIndex) {
    if (!tournament?.bracket) return;
    const bracket = JSON.parse(JSON.stringify(tournament.bracket));
    const match = bracket.rounds[roundIndex][matchIndex];
    if (!match.player1 || !match.player2 || match.winnerId) return;
    const isOwnMatch = [match.player1, match.player2].some(player => String(player?.id) === String(currentUserId));
    if (!isOwner && !isOwnMatch) return;
    if (!match.matchState) {
      const firstPlayerId = Math.random() < 0.5 ? match.player1.id : match.player2.id;
      match.matchState = {
        gameNumber: 1,
        score: { [match.player1.id]: 0, [match.player2.id]: 0 },
        games: [],
        currentGame: { firstPlayerId, rejects: [], rejectVotes: {}, stage: tournament.stageRejects ? null : 'なし', chooserId: tournament.stageRejects ? null : firstPlayerId, results: {} },
        complete: false,
      };
    }
    setActiveMatchId(match.id);
    setRejectSelection([]);
    setStageSelection('');
    saveBracket({ ...tournament, bracket });
  }

  async function rejectMatchStages(roundIndex, matchIndex, playerId, chosenStages) {
    const bracket = JSON.parse(JSON.stringify(tournament.bracket));
    const match = bracket.rounds[roundIndex][matchIndex];
    const state = match.matchState;
    if (!state || state.complete || state.currentGame.stage) return;
    const game = state.currentGame;
    const settings = tournament.stageSettings || {};
    if (!tournament.stageRejects) return;
    const { starter, selected } = getMatchStageLists();
    const available = (state.gameNumber === 1 ? starter : selected).filter(stage => !game.rejects.includes(stage));
    const isFirst = state.gameNumber === 1;
    const firstId = game.firstPlayerId;
    const otherId = match.player1.id === firstId ? match.player2.id : match.player1.id;
    const required = isFirst
      ? Number(playerId === firstId ? (settings.firstPlayerRejects ?? 1) : (settings.secondPlayerRejects ?? 2))
      : Math.max(0, Number(settings.laterRejects ?? 3) - game.rejects.length);
    if (chosenStages.length !== required || chosenStages.some(stage => !available.includes(stage))) return;
    const votes = { ...(game.rejectVotes || {}), [playerId]: chosenStages };
    const rejects = [...game.rejects, ...chosenStages];
    const nextGame = { ...game, rejectVotes: votes, rejects };
    const firstDone = Number(settings.firstPlayerRejects ?? 1) === 0 || Boolean(votes[firstId]);
    const secondDone = Number(settings.secondPlayerRejects ?? 2) === 0 || Boolean(votes[otherId]);
    const laterDone = rejects.length >= Number(settings.laterRejects ?? 3);
    if ((isFirst && firstDone && secondDone) || (!isFirst && laterDone)) {
      nextGame.chooserId = isFirst ? firstId : (game.previousWinnerId === match.player1.id ? match.player2.id : match.player1.id);
    }
    state.currentGame = nextGame;
    bracket.rounds[roundIndex][matchIndex] = match;
    setRejectSelection([]);
    await saveBracket({ ...tournament, bracket });
  }

  async function chooseMatchStage(roundIndex, matchIndex, stage) {
    const bracket = JSON.parse(JSON.stringify(tournament.bracket));
    const match = bracket.rounds[roundIndex][matchIndex];
    if (!match.matchState || match.matchState.complete) return;
    const current = match.matchState.currentGame;
    if (current.rejects.includes(stage)) return;
    current.stage = stage;
    match.matchState.currentGame = current;
    await saveBracket({ ...tournament, bracket });
  }

  async function recordMatchGame(roundIndex, matchIndex, winnerId) {
    const bracket = JSON.parse(JSON.stringify(tournament.bracket));
    const match = bracket.rounds[roundIndex][matchIndex];
    const state = match.matchState;
    if (!state || state.complete || !state.currentGame.stage) return;
    const target = Number(tournament.bestOf || 3) === 5 ? 3 : 2;
    state.score[winnerId] = (state.score[winnerId] || 0) + 1;
    state.games.push({ number: state.gameNumber, stage: state.currentGame.stage, winnerId });
    if (state.score[winnerId] >= target) {
      state.complete = true;
      state.winnerId = winnerId;
      match.winnerId = winnerId;
      const loserId = match.player1.id === winnerId ? match.player2.id : match.player1.id;
      if (roundIndex < bracket.rounds.length - 1) {
        const nextMatch = bracket.rounds[roundIndex + 1][Math.floor(matchIndex / 2)];
        nextMatch[matchIndex % 2 === 0 ? 'player1' : 'player2'] = [match.player1, match.player2].find(p => p?.id === winnerId) || null;
        nextMatch.winnerId = null;
        nextMatch.matchState = null;
        for (let r = roundIndex + 1; r < bracket.rounds.length; r++) {
          for (const m of bracket.rounds[r]) if (r > roundIndex + 1 || m === nextMatch) { m.winnerId = null; m.matchState = null; }
        }
      }
    } else {
      const previousWinnerId = winnerId;
      const { selected } = getMatchStageLists();
      state.gameNumber += 1;
      state.currentGame = {
        firstPlayerId: state.games[state.games.length - 1].winnerId,
        previousWinnerId,
        rejects: [],
        rejectVotes: {},
        stage: tournament.stageRejects ? null : 'なし',
        chooserId: tournament.stageRejects ? (match.player1.id === previousWinnerId ? match.player2.id : match.player1.id) : (match.player1.id === previousWinnerId ? match.player2.id : match.player1.id),
        results: {},
      };
    }
    bracket.complete = bracket.rounds[bracket.rounds.length - 1][0].winnerId != null;
    const next = { ...tournament, bracket, status: bracket.complete ? '終了' : '対戦中', resultPlacements: bracket.complete ? bracketPlacements(bracket) : null, completedAt: bracket.complete ? new Date().toISOString() : null };
    await saveBracket(next);
    if (match.winnerId) setActiveMatchId('');
  }

  async function setMatchWinner(roundIndex, matchIndex, playerId) {
    // 勝者の直接指定ではなく、BO形式に従って各ゲームの結果を記録する。
    await recordMatchGame(roundIndex, matchIndex, playerId);
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

  if (loading && !tournament) return <main className="page tournament-detail-page"><SiteHeader /><section className="intro"><p>大会情報を読み込み中…</p></section></main>;

  if (!tournament) return <main className="page">
    <SiteHeader /><section className="intro">
      <a className="back-link" href="/">← 大会一覧に戻る</a><h1>大会が見つかりません</h1><p>このブラウザに大会データが保存されていないか、URLが正しくありません。</p></section></main>;

  const joinedPlayers = tournament.joinedPlayers || [];
  const isOwner = Boolean(tournament.isOwner);

  return <main className="page tournament-detail-page">
    <section className="intro tournament-heading">
      {tournament.bracket ? <button className="back-link tournament-back-button" type="button" onClick={() => setShowTournamentOverview(v => !v)}>{showTournamentOverview ? "← トーナメント表に戻る" : "← 大会概要に戻る"}</button> : <a className="back-link" href="/">← 大会一覧に戻る</a>}
      <div className="tournament-title-row">
        <div><h1>{tournament.name}</h1></div>
      </div>
    </section>
      {tournament.bracket && !showTournamentOverview && <section className="tournament-live-panel" id="tournament-bracket">
        <div className="bracket-header"><h2>トーナメント表</h2><span className="status">{tournament.bracket.complete ? '結果確定' : '対戦中'}</span></div>
        <p className="setting-help">大会作成時に設定したBO形式・使用ステージ・拒否数に従って各ゲームを進めます。ゲーム結果を記録するとセット勝者が次のラウンドへ進みます。</p>
        {activeMatchId && !tournament.bracket.complete && (() => {
          let selected = null;
          tournament.bracket.rounds.forEach((round, ri) => round.forEach((match, mi) => {
            if (match.id === activeMatchId) selected = { roundIndex: ri, matchIndex: mi, match };
          }));
          if (!selected || !selected.match.player1 || !selected.match.player2 || selected.match.winnerId) return null;
          const { roundIndex: ri, matchIndex: mi, match } = selected;
          const state = match.matchState;
          const game = state?.currentGame;
          const { selected: allStages, starter } = getMatchStageLists();
          const gameStages = state?.gameNumber === 1 ? starter : allStages;
          const available = gameStages.filter(stage => !game?.rejects?.includes(stage));
          const settings = tournament.stageSettings || {};
          const firstId = game?.firstPlayerId;
          const p1Id = match.player1.id;
          const rejectTurnId = state?.gameNumber === 1
            ? (!game?.rejectVotes?.[firstId] && Number(settings.firstPlayerRejects ?? 1) > 0 ? firstId : (match.player1.id === firstId ? match.player2.id : match.player1.id))
            : game?.previousWinnerId;
          const firstRejectDone = !firstId || Number(settings.firstPlayerRejects ?? 1) === 0 || Boolean(game?.rejectVotes?.[firstId]);
          const secondId = match.player1.id === firstId ? match.player2.id : match.player1.id;
          const secondRejectDone = !secondId || Number(settings.secondPlayerRejects ?? 2) === 0 || Boolean(game?.rejectVotes?.[secondId]);
          const rejectsDone = !tournament.stageRejects || (state?.gameNumber === 1 ? firstRejectDone && secondRejectDone : (game?.rejects?.length || 0) >= Number(settings.laterRejects ?? 3));
          const chooserId = state?.gameNumber === 1 ? firstId : (game?.previousWinnerId === match.player1.id ? match.player2.id : match.player1.id);
          return <section className="bracket-panel match-controls-below" aria-label="対戦操作">
            <div className="game-top">
              <div className="game-heading"><span className="eyebrow">ROUND {ri + 1} / GAME {state?.gameNumber || 1}</span></div>
              <div className="current-score">{state?.score?.[p1Id] || 0}<span> - </span>{state?.score?.[match.player2.id] || 0}</div>
            </div>
            <div className="player-strip">
              <div className={state?.currentGame?.firstPlayerId === p1Id ? "current" : ""}><small>PLAYER 1</small><b>{match.player1.name}</b><span>{state?.score?.[p1Id] || 0} 勝</span></div>
              <div className={state?.currentGame?.firstPlayerId === match.player2.id ? "current" : ""}><small>PLAYER 2</small><b>{match.player2.name}</b><span>{state?.score?.[match.player2.id] || 0} 勝</span></div>
            </div>
            {!state ? <p className="setting-help">対戦を準備しています…</p> : <>
              {!game?.stage ? <>
                {rejectsDone ? <>
                  <p className="setting-help">{[match.player1,match.player2].find(p=>p?.id===chooserId)?.name || 'プレイヤー'} がステージを選択</p>
                  <div className="stage-grid">{available.map(stage => <button key={stage} type="button" className={stageSelection===stage?'stage selected':'stage'} onClick={()=>setStageSelection(stage)}>{stage}</button>)}</div>
                  <button className="submit" type="button" disabled={!stageSelection || savingBracket} onClick={() => { const chosen = stageSelection; setStageSelection(''); chooseMatchStage(ri,mi,chosen); }}>このステージに決定</button>
                </> : <>
                  <p className="setting-help">ステージ拒否：{[match.player1,match.player2].find(p=>p?.id===rejectTurnId)?.name || 'プレイヤー'}（{state.gameNumber===1 ? (rejectTurnId===firstId ? settings.firstPlayerRejects??1 : settings.secondPlayerRejects??2) : Math.max(0,Number(settings.laterRejects??3)-(game?.rejects?.length||0))}個選択）</p>
                  <div className="stage-grid">{available.map(stage => <button key={stage} type="button" className={rejectSelection.includes(stage)?'stage selected':'stage'} disabled={rejectSelection.length >= (state.gameNumber===1 ? Number(rejectTurnId===firstId ? settings.firstPlayerRejects??1 : settings.secondPlayerRejects??2) : Math.max(0,Number(settings.laterRejects??3)-(game?.rejects?.length||0))) && !rejectSelection.includes(stage)} onClick={()=>setRejectSelection(old=>old.includes(stage)?old.filter(s=>s!==stage):[...old,stage])}>{stage}</button>)}</div>
                  <button className="submit" type="button" disabled={savingBracket} onClick={() => rejectMatchStages(ri,mi,rejectTurnId,rejectSelection)}>拒否を確定</button>
                </>}
              </> : <>
                <p className="setting-help">決定ステージ：{game.stage}</p>
                <h3 className="match-result-heading">試合結果を入力</h3>
                <div className="match-result-buttons">
                  <button type="button" className="submit match-result-win" disabled={savingBracket} onClick={()=>recordMatchGame(ri,mi,match.player1.id)}>WIN — {match.player1.name}</button>
                  <button type="button" className="submit match-result-lose" disabled={savingBracket} onClick={()=>recordMatchGame(ri,mi,match.player2.id)}>LOSE — {match.player2.name}</button>
                </div>
              </>}
            </>}
          </section>;
        })()}
        <div className="bracket-rounds" style={{ "--bracket-height": `${64 + tournament.bracket.rounds[0].length * 104}px` }}>{tournament.bracket.rounds.map((round, ri) => <div className="bracket-round" key={ri}><strong>{ri === tournament.bracket.rounds.length - 1 ? '決勝' : ri === tournament.bracket.rounds.length - 2 ? '準決勝' : `第${ri + 1}回戦`}</strong>{round.map((match, mi) => {
          const state = match.matchState;
          const game = state?.currentGame;
          const { selected, starter } = getMatchStageLists();
          const gameStages = state?.gameNumber === 1 ? starter : selected;
          const available = gameStages.filter(stage => !game?.rejects?.includes(stage));
          const settings = tournament.stageSettings || {};
          const firstId = game?.firstPlayerId;
          const p1Id = match.player1?.id;
          const rejectTurnId = state?.gameNumber === 1
            ? (!game?.rejectVotes?.[firstId] && Number(settings.firstPlayerRejects ?? 1) > 0 ? firstId : (match.player1?.id === firstId ? match.player2?.id : match.player1?.id))
            : game?.previousWinnerId;
          const firstRejectDone = !firstId || Number(settings.firstPlayerRejects ?? 1) === 0 || Boolean(game?.rejectVotes?.[firstId]);
          const secondId = match.player1?.id === firstId ? match.player2?.id : match.player1?.id;
          const secondRejectDone = !secondId || Number(settings.secondPlayerRejects ?? 2) === 0 || Boolean(game?.rejectVotes?.[secondId]);
          const rejectsDone = !tournament.stageRejects || (state?.gameNumber === 1 ? firstRejectDone && secondRejectDone : (game?.rejects?.length || 0) >= Number(settings.laterRejects ?? 3));
          const chooserId = state?.gameNumber === 1 ? firstId : (game?.previousWinnerId === match.player1?.id ? match.player2?.id : match.player1?.id);
          const isOwnMatch = [match.player1, match.player2].some(player => String(player?.id) === String(currentUserId));
          const canStartMatch = !state && (isOwner || isOwnMatch) && match.player1 && match.player2 && !match.winnerId && !tournament.bracket.complete;
          return <div className={canStartMatch ? "bracket-match match-startable" : "bracket-match"} style={{ top: `${64 + (((mi + 0.5) * (2 ** ri)) - 0.5) * 104}px` }} key={match.id} onClick={canStartMatch ? () => startMatch(ri,mi) : undefined} role={canStartMatch ? "button" : undefined} tabIndex={canStartMatch ? 0 : undefined} onKeyDown={canStartMatch ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startMatch(ri,mi); } } : undefined}>
            
            <div className="match-players">{[match.player1, match.player2].map((player, pi) => <div key={pi} className={"match-player-line" + (match.winnerId === player?.id ? " winner-line" : "") + (match.winnerId && match.winnerId !== player?.id ? " loser-line" : "")}><span title={player?.name || "BYE"}>{player?.name || "BYE"}{player?.isDemo ? "（デモ）" : ""}</span><strong className={"player-score" + (match.winnerId === player?.id ? " score-winner" : "")}>{state?.score?.[player?.id] || 0}</strong></div>)}</div>


            {ri < tournament.bracket.rounds.length - 1 && mi % 2 === 0 && mi + 1 < round.length && <i className="bracket-pair-connector" style={{ height: `${104 * (2 ** ri)}px` }} aria-hidden="true" />}
          </div>;
        })}</div>)}</div>

{!activeMatchId && !tournament.bracket.complete && <section className="bracket-panel match-controls-below"><h3>対戦画面</h3><p className="setting-help">{currentUserId ? '現在、自分の進行中の対戦はありません。' : 'ログインして参加登録すると、自分の対戦が自動表示されます。'}</p></section>}
        {tournament.bracket.complete && <><h3 id="tournament-standings">順位・結果</h3><ol className="joined-player-list">{(tournament.resultPlacements || bracketPlacements(tournament.bracket)).map((row, i) => { const player = joinedPlayers.find(p => p.id === row.playerId); return player ? <li key={row.playerId}><strong>{row.place}</strong>　{player.name}{player.isDemo ? '（デモ）' : ''}</li> : null; })}</ol></>}
        {isOwner && tournament.bracket.complete && <button type="button" onClick={() => window.confirm('トーナメント表をリセットしますか？順位結果も消えます。') && saveBracket({ ...tournament, status: '募集中', bracket: null, resultPlacements: null, completedAt: null })}>トーナメントをリセット</button>}
      </section>}

    {(!tournament.bracket || showTournamentOverview) && <div className="tournament-bottom-grid">
    <section className="create-panel tournament-detail" id="tournament-overview">
      <div className="tournament-card-top"><h2>大会概要</h2><span className="status">{tournament.status || '募集中'}</span></div>
      <div className="detail-grid">
        <div><span>対戦形式</span><strong>{tournament.format || `BO${tournament.bestOf || 3}`}</strong></div>
        <div><span>参加人数</span><strong>{joinedPlayers.length}/{tournament.participants || 8}人</strong></div>
        <div><span>開始時刻</span><strong>{tournament.date ? `${tournament.date.slice(0, 10).replaceAll('-', '/')} ${tournament.date.slice(11, 16)}` : '未設定'}</strong></div>
        <div><span>拒否ステージ</span><strong>{tournament.stageRejects ? 'あり' : 'なし'}</strong></div>
      </div>
      {isOwner && <div className="overview-actions">
        {!tournament.bracket && <a className="button-link" href={`/tournaments/new?edit=${encodeURIComponent(id)}`}>編集</a>}
        {!tournament.bracket && <button className="submit" type="button" onClick={startBracket} disabled={savingBracket || joinedPlayers.length < 2}>大会を開始する</button>}
        {tournament.bracket && <button className="submit" type="button" onClick={() => document.getElementById('tournament-bracket')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>トーナメント表へ</button>}
      </div>}
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

      {isOwner && !tournament.bracket && <section className="bracket-panel" id="tournament-bracket">
        <h3>デモモード</h3>
        <p className="setting-help">テスト用の架空プレイヤーを追加できます。デモ参加者は実際のログイン参加者とは区別されます。</p>
        <div className="demo-player-form"><input value={demoName} onChange={e => setDemoName(e.target.value)} placeholder="例：テストプレイヤー1" aria-label="デモプレイヤー名" /><button type="button" onClick={addDemoPlayer}>デモ参加者を追加</button></div>
        <p className="setting-help">大会概要の「大会を開始する」から開始してください。</p>
      </section>}

    </section>
    <section className="create-panel tournament-detail participant-side-panel">
      <h2>参加者（{joinedPlayers.length}/{tournament.participants || 8}人）</h2>
      {joinedPlayers.length ? <ul className="joined-player-list">{joinedPlayers.map(player => <li key={player.id}><span>{player.name}{player.isDemo ? '（デモ）' : ''}</span>{isOwner && !tournament.bracket && <button type="button" onClick={() => leaveTournament(player.id)}>登録を削除</button>}</li>)}</ul> : <p className="setting-help">まだ参加者はいません。</p>}
      {!joinedPlayers.some(player => String(player.id) === String(currentUserId)) && <>
        <h3>参加する</h3>
        {joinedPlayers.length >= Number(tournament.participants || 8) ? <p className="setting-help">定員に達しています。</p> : <form onSubmit={joinTournament}>
          {accessToken ? <p className="setting-help">参加者名：{accountName || '読み込み中…'}</p> : <p className="setting-help">参加登録にはログインが必要です。</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {notice && <p className="form-success" role="status">{notice}</p>}
          <button className="submit" type="submit">参加登録する</button>
        </form>}
      </>}
      {isOwner && <div className="owner-actions"><p className="setting-help">あなたが作成した大会です。</p><button className="danger-button" type="button" onClick={deleteTournament}>この大会を削除</button></div>}
    </section>
    </div>}
    <footer>Figure Tournament</footer>
  </main>;
}
