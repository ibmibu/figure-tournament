'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getSupabaseBrowserClient } from '../../../lib/supabase/client';
import { removeCachedTournament } from '../../../lib/tournament-cache';

const OWNER_KEY = 'figure-tournament-owner-v1';

export default function TournamentPage() {
  const params = useParams();
  const id = decodeURIComponent(String(params.id || ''));
  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ownerId, setOwnerId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [savedFriendCode, setSavedFriendCode] = useState('');
  const [joinFriendCode, setJoinFriendCode] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [demoName, setDemoName] = useState('');
  const [demoPerspective, setDemoPerspective] = useState('');
  const [savingBracket, setSavingBracket] = useState(false);
  const [activeMatchId, setActiveMatchId] = useState('');
  const [adminMatchSelection, setAdminMatchSelection] = useState(null);
  const [showForfeitChoices, setShowForfeitChoices] = useState(false);
  const [showAdminLog, setShowAdminLog] = useState(false);
  const [rejectSelection, setRejectSelection] = useState([]);
  const [stageSelection, setStageSelection] = useState('');
  const [showTournamentOverview, setShowTournamentOverview] = useState(true);

  const [declarationCharacter, setDeclarationCharacter] = useState('');
  const [declarationColor, setDeclarationColor] = useState('1P');
  const [declarationBusy, setDeclarationBusy] = useState(false);
  const [boardMessages, setBoardMessages] = useState([]);
  const [boardText, setBoardText] = useState('');
  const [boardBusy, setBoardBusy] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [boardError, setBoardError] = useState('');

  async function refreshBoard() {
    if (!id) return;
    try {
      const response = await fetch(`/api/tournaments/board?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'コメントを読み込めませんでした。');
      setBoardMessages(data.messages || []);
      setBoardError('');
    } catch (error) { setBoardError(error.message || 'コメントを読み込めませんでした。'); }
  }

  useEffect(() => {
    refreshBoard();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refreshBoard(); }, 10000);
    return () => clearInterval(timer);
  }, [id]);

  async function postBoardMessage(event) {
    event.preventDefault();
    if (!boardText.trim() || boardBusy) return;
    setBoardBusy(true);
    setBoardError('');
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session?.access_token) throw new Error('投稿にはログインが必要です。');
      const response = await fetch('/api/tournaments/board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ id, text: boardText.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '投稿できませんでした。');
      setBoardText('');
      await refreshBoard();
    } catch (error) { setBoardError(error.message || '投稿できませんでした。'); }
    finally { setBoardBusy(false); }
  }

  async function loadTournament() {
    setLoading(true);
    setError('');
    try {
      const owner = localStorage.getItem(OWNER_KEY) || '';
      setOwnerId(owner);
      let accessToken = '';
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        accessToken = data.session?.access_token || '';
        setAccessToken(accessToken);
        setCurrentUserId(data.session?.user?.id || '');
        if (accessToken) {
          // Profile is supplemental: never block the tournament request on it.
          fetch('/api/profile', { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
            .then(async response => {
              if (!response.ok) return;
              const profileResult = await response.json();
              setAccountName(String(profileResult.profile?.display_name || 'no name').trim());
              setSavedFriendCode(String(profileResult.profile?.friend_code || '').trim());
            }).catch(() => {});
        }
      } catch {}
      const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
      const response = await fetch(`/api/tournaments?id=${encodeURIComponent(id)}&ownerToken=${encodeURIComponent(owner)}`, { cache: 'no-store', headers });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '大会を読み込めませんでした。');
      if (result.tournament) {
        setTournament(result.tournament);
      } else {
        setTournament(null);
      }
    } catch (loadError) {
      console.error(loadError);
      setTournament(null);
      setError(loadError.message || '大会情報を読み込めませんでした。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTournament(); }, [id]);

  // Character declaration is live even before the bracket exists.
  useEffect(() => {
    if (tournament?.declarationPhase !== 'collecting' || !id) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !declarationBusy && !savingBracket) loadTournament();
    }, 4000);
    return () => clearInterval(timer);
  }, [id, tournament?.declarationPhase, declarationBusy, savingBracket]);

  // Keep both players in sync while a bracket is active, without flashing the loading screen.
  useEffect(() => {
    if (!tournament?.bracket || tournament.bracket.complete || showTournamentOverview || savingBracket) return;
    let cancelled = false;
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const owner = localStorage.getItem(OWNER_KEY) || '';
        const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
        const response = await fetch(`/api/tournaments?id=${encodeURIComponent(id)}&ownerToken=${encodeURIComponent(owner)}`, { cache: 'no-store', headers });
        if (!response.ok || cancelled) return;
        const result = await response.json();
        if (!cancelled && result.tournament) {
          setTournament(result.tournament);

        }
      } catch {}
    };
    const interval = setInterval(refresh, 4000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [id, Boolean(tournament?.bracket), tournament?.bracket?.complete, showTournamentOverview, savingBracket, accessToken]);

  // 大会終了後、条件を満たす参加者を一度だけキャラ報告ページへ案内する。
  useEffect(() => {
    if (!tournament?.bracket?.complete || !currentUserId || loading) return;
    const player = (tournament.joinedPlayers || []).find(p => !p.isDemo && String(p.userId || p.id) === String(currentUserId));
    if (!player || tournament.characterReports?.[String(player.id)]) return;
    const rounds = tournament.bracket.rounds || [];
    const final = rounds.at(-1)?.[0];
    const podium = new Set([final?.winnerId, ...[final?.player1, final?.player2].filter(Boolean).map(p => p.id)]);
    if (rounds.length >= 2) for (const m of rounds.at(-2)) for (const p of [m.player1, m.player2]) if (p && m.winnerId && String(p.id) !== String(m.winnerId)) podium.add(p.id);
    const wins = rounds.flat().filter(m => String(m.winnerId) === String(player.id) && m.player1 && m.player2 && m.resultType !== 'forfeit').length;
    if (wins < 1 || ![...podium].some(v => String(v) === String(player.id))) return;
    const key = 'figure-report-visited-' + id + '-' + currentUserId;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    window.location.href = '/tournaments/' + encodeURIComponent(id) + '/report';
  }, [tournament, currentUserId, loading, id]);

  // 大会ページを開いたら自分の未完了対戦を自動表示し、管理者なら対戦状態も開始する。
  useEffect(() => {
    const perspectiveId = tournament?.isOwner && demoPerspective ? demoPerspective : currentUserId;
    if (!tournament?.bracket || !perspectiveId || tournament.bracket.complete) return;
    for (let ri = 0; ri < (tournament.bracket.rounds || []).length; ri++) {
      const round = tournament.bracket.rounds[ri];
      const mi = round.findIndex(match =>
        !match.winnerId && match.player1 && match.player2 &&
        (String(match.player1.id) === String(perspectiveId) || String(match.player2.id) === String(perspectiveId))
      );
      if (mi >= 0) {
        const ownMatch = round[mi];
        setActiveMatchId(ownMatch.id);
        if (!ownMatch.matchState) startMatch(ri, mi);
        return;
      }
    }
    setActiveMatchId('');
  }, [tournament, currentUserId, demoPerspective]);

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

  }

  function demoPlayersFor(current) {
    return (current.joinedPlayers || []).filter(player => player.isDemo);
  }

  function makeBracket(players) {
    const size = 2 ** Math.ceil(Math.log2(Math.max(2, players.length)));
    const shuffle = items => {
      const result = [...items];
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    };
    // Standard bracket positions: top seeds occupy opposite halves/quarters.
    let seedOrder = [1, 2];
    while (seedOrder.length < size) {
      const nextSize = seedOrder.length * 2;
      seedOrder = seedOrder.flatMap(seed => [seed, nextSize + 1 - seed]);
    }
    const ranked = [...players].sort((a, b) => Number(b.rating) - Number(a.rating));
    const canSeed = tournament.autoSeed && players.every(player => player.rating !== undefined && player.rating !== null && Number.isFinite(Number(player.rating)));
    const seedCount = canSeed ? Math.min(players.length, Math.max(2, Math.ceil(players.length * 0.25))) : 0;
    const entrants = canSeed
      ? [...ranked.slice(0, seedCount), ...shuffle(ranked.slice(seedCount))]
      : shuffle(players);
    // Assign players to conventional seed positions; the remaining ranks are
    // byes. This balances the two halves and avoids empty first-round matches.
    // Without seeding, randomize the draw orientation as well.
    let positions = seedOrder.map(rank => rank - 1);
    if (!canSeed) {
      for (let span = size; span >= 2; span /= 2) {
        for (let start = 0; start < size; start += span) {
          if (Math.random() < 0.5) {
            const half = span / 2;
            for (let offset = 0; offset < half; offset++) {
              [positions[start + offset], positions[start + half + offset]] =
                [positions[start + half + offset], positions[start + offset]];
            }
          }
        }
      }
    }
    const slots = positions.map(rank => entrants[rank] || null);
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
      const label = r === rounds.length - 2 ? '3位' : r === rounds.length - 3 ? 'ベスト8' : `ベスト${2 ** (rounds.length - r)}`;
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
    if (tournament.characterDeclaration && tournament.declarationPhase !== 'published') {
      if (players.some(player => player.isDemo)) { setError('キャラ宣言ありの大会ではデモ参加者を利用できません。'); return; }
      await saveBracket({ ...tournament, status: 'キャラ宣言中', declarationPhase: 'collecting', characterDeclarations: {} });
      return;
    }
    const next = { ...tournament, status: '対戦中', bracket: makeBracket(players), streamMatchId: undefined, resultPlacements: null };
    await saveBracket(next);
    setTimeout(() => document.getElementById('tournament-bracket')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  async function declarationAction(action) {
    setDeclarationBusy(true);
    setError('');
    try {
      const response = await fetch('/api/tournaments/declaration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ id, action, character: declarationCharacter, color: declarationColor }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'キャラ宣言を保存できませんでした。');
      await loadTournament();
    } catch (e) { setError(e.message || 'キャラ宣言を保存できませんでした。'); }
    finally { setDeclarationBusy(false); }
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

  async function submitMatchResult(roundIndex, matchIndex, result) {
    const match = tournament?.bracket?.rounds?.[roundIndex]?.[matchIndex];
    if (!match?.matchState?.currentGame?.stage || savingBracket) return;
    setSavingBracket(true);
    setError('');
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('勝敗報告にはログインが必要です。');
      const response = await fetch('/api/tournaments/match-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, matchId: match.id, gameNumber: match.matchState.gameNumber, result, demoPerspective: isOwner ? demoPerspective : '' }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '報告を保存できませんでした。');
      setTournament(prev => ({ ...body.tournament, isOwner: prev?.isOwner }));

    } catch (e) { setError(e.message || '勝敗報告に失敗しました。'); }
    finally { setSavingBracket(false); }
  }

  async function recordMatchGame(roundIndex, matchIndex, winnerId, confirmedBracket = null) {
    const bracket = confirmedBracket || JSON.parse(JSON.stringify(tournament.bracket));
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

  async function administerMatch(match, action, winnerId = null) {
    if (!tournament?.isOwner || savingBracket || !match) return;
    const label = action === 'reset'
      ? 'この対戦結果をリセットしますか？'
      : `${[match.player1, match.player2].find(player => String(player?.id) === String(winnerId))?.name || '選手'}を不戦勝にしますか？`;
    if (!window.confirm(`${label}\n後続の対戦結果がある場合は、関係する結果もリセットされます。`)) return;
    setSavingBracket(true);
    setError('');
    setNotice('');
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('主催者としてログインしてください。');
      const response = await fetch('/api/tournaments/admin-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, matchId: match.id, action, winnerId, ownerToken: ownerId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '対戦結果を更新できませんでした。');
      setTournament(result.tournament);
      setAdminMatchSelection(null);
      setShowForfeitChoices(false);

      setActiveMatchId('');
      setNotice(action === 'reset' ? '対戦結果をリセットしました。' : '不戦勝として勝者を確定しました。');
    } catch (updateError) {
      setError(updateError.message || '対戦結果を更新できませんでした。');
    } finally {
      setSavingBracket(false);
    }
  }

  async function undoAdminAction() {
    if (!isOwner || savingBracket || !tournament?.adminHistory?.length) return;
    if (!window.confirm('直前の主催者操作を巻き戻しますか？')) return;
    setSavingBracket(true);
    setError('');
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session?.access_token) throw new Error('主催者としてログインしてください。');
      const response = await fetch('/api/tournaments/admin-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ id, action: 'undo', ownerToken: ownerId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '巻き戻せませんでした。');
      setTournament(result.tournament);
      setAdminMatchSelection(null);
      setActiveMatchId('');
      setNotice('直前の主催者操作を巻き戻しました。');
    } catch (e) { setError(e.message || '巻き戻せませんでした。'); }
    finally { setSavingBracket(false); }
  }

  async function setStreamMatch(matchId) {
    if (!tournament?.isOwner || savingBracket) return;
    setSavingBracket(true);
    setError('');
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session?.access_token) throw new Error('主催者としてログインしてください。');
      const response = await fetch('/api/tournaments/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ id, matchId, ownerToken: ownerId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '配信台を設定できませんでした。');
      setTournament(result.tournament);
      setAdminMatchSelection(null);
      setShowForfeitChoices(false);

      setNotice(matchId ? '配信台を変更しました。' : '配信台設定を解除しました。');
    } catch (e) { setError(e.message || '配信台を設定できませんでした。'); }
    finally { setSavingBracket(false); }
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
        body: JSON.stringify({ id, friendCode: savedFriendCode || joinFriendCode.trim().toUpperCase() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '参加登録を保存できませんでした。');
      setTournament(current => {
        const next = { ...current, joinedPlayers: result.joinedPlayers };

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

  if (loading && !tournament) return <main className="page tournament-detail-page"><section className="intro"><p>大会情報を読み込み中…</p></section></main>;

  if (!tournament) return <main className="page">
    <section className="intro">
      <a className="back-link" href="/">← 大会一覧に戻る</a><h1>{error || '大会が見つかりません'}</h1><p>大会情報はサーバーで管理されています。URLや通信状況を確認してください。</p></section></main>;

  const joinedPlayers = tournament.joinedPlayers || [];
  const isOwner = Boolean(tournament.isOwner);
  const currentRoundNumber = Math.max(1, (tournament.bracket?.rounds || []).findIndex(round => round.some(match => match.player1 && match.player2 && !match.winnerId)) + 1 || tournament.bracket?.rounds?.length || 1);
  const roundCount = tournament.bracket?.rounds?.length || 0;
  const roundAnnouncement = roundCount > 1 && currentRoundNumber === roundCount ? '決勝' : roundCount > 2 && currentRoundNumber === roundCount - 1 ? '準決勝' : `${currentRoundNumber}回戦`;
  const selectedAdminMatch = isOwner && adminMatchSelection
    ? tournament.bracket?.rounds?.[adminMatchSelection.roundIndex]?.[adminMatchSelection.matchIndex] || null
    : null;
  const canEditAdminMatch = Boolean(selectedAdminMatch?.player1 && selectedAdminMatch?.player2);
  const streamMatchId = tournament.effectiveStreamMatchId ?? null;

  return <main className="page tournament-detail-page">
    <section className="intro tournament-heading">
      {tournament.bracket && !showTournamentOverview ? <button type="button" className="back-link tournament-back-button" onClick={() => { setShowTournamentOverview(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>← 大会概要に戻る</button> : <a className="back-link" href="/">← ホームに戻る</a>}
      <div className="tournament-title-row">
        <div><h1>{tournament.name}</h1></div>
      </div>
    </section>
      {!showTournamentOverview && error && <p className="form-error" role="alert">{error}</p>}
      {!showTournamentOverview && notice && <p className="form-success" role="status">{notice}</p>}
      {tournament.bracket && !showTournamentOverview && !tournament.bracket.complete && <div className="tournament-match-area">
        {isOwner && joinedPlayers.some(p => p.isDemo) && <div className="bracket-panel demo-perspective-control"><label htmlFor="demoPerspective">現在の操作視点</label><select id="demoPerspective" value={demoPerspective} onChange={e => { setDemoPerspective(e.target.value); setActiveMatchId(''); setRejectSelection([]); setStageSelection(''); }}><option value="">主催者（通常操作）</option>{joinedPlayers.filter(p=>p.isDemo).map(p=><option key={p.id} value={p.id}>{p.name} として操作</option>)}</select><p className="setting-help">{demoPerspective ? '選択したデモ選手の視点で対戦を操作します。' : 'デモ選手を選ぶと、その選手の対戦画面が表示されます。'}</p></div>}
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
          const demoMatch = isOwner && Boolean(demoPerspective) && [match.player1, match.player2].some(p => String(p.id) === String(demoPerspective));
          const viewingPlayerId = demoMatch ? String(demoPerspective) : String(currentUserId || '');
          const viewingPlayer = [match.player1, match.player2].find(p => String(p.id) === String(viewingPlayerId));
          const rejectTurnId = state?.gameNumber === 1
            ? (!game?.rejectVotes?.[firstId] && Number(settings.firstPlayerRejects ?? 1) > 0 ? firstId : (match.player1.id === firstId ? match.player2.id : match.player1.id))
            : game?.previousWinnerId;
          const firstRejectDone = !firstId || Number(settings.firstPlayerRejects ?? 1) === 0 || Boolean(game?.rejectVotes?.[firstId]);
          const secondId = match.player1.id === firstId ? match.player2.id : match.player1.id;
          const secondRejectDone = !secondId || Number(settings.secondPlayerRejects ?? 2) === 0 || Boolean(game?.rejectVotes?.[secondId]);
          const rejectsDone = !tournament.stageRejects || (state?.gameNumber === 1 ? firstRejectDone && secondRejectDone : (game?.rejects?.length || 0) >= Number(settings.laterRejects ?? 3));
          const chooserId = state?.gameNumber === 1 ? firstId : (game?.previousWinnerId === match.player1.id ? match.player2.id : match.player1.id);
          const canActFor = id => isOwner && !demoMatch ? true : String(id) === String(viewingPlayerId);
          const waitingFor = id => <p className="setting-help match-turn-waiting">{[match.player1,match.player2].find(p => String(p.id) === String(id))?.name || '相手'} の入力を待っています…</p>;
          return <section className={`bracket-panel match-controls-below${String(streamMatchId) === String(match.id) ? " match-controls-streaming" : ""}`} aria-label="対戦操作">
            {String(streamMatchId) === String(match.id) && <div className="match-stream-announcement"><strong>● 配信台の対戦</strong><span>配信台に入室して試合を進めてください。</span>{tournament.streamFriendCode && <span>配信台フレンドコード：<b>{tournament.streamFriendCode}</b></span>}</div>}

            <div className="game-top">
              <div className="game-heading"><span className="eyebrow">ROUND {ri + 1} / GAME {state?.gameNumber || 1}</span></div>
              <div className="current-score">{state?.score?.[p1Id] || 0}<span> - </span>{state?.score?.[match.player2.id] || 0}</div>
            </div>
            <div className="player-strip">
              <div className={state?.currentGame?.firstPlayerId === p1Id ? "current" : ""}><small>PLAYER 1</small><b>{match.player1.name}</b></div>
              <div className={state?.currentGame?.firstPlayerId === match.player2.id ? "current" : ""}><small>PLAYER 2</small><b>{match.player2.name}</b></div>
            </div>
            {(() => {
              const opponent = [match.player1, match.player2].find(player => String(player.id) !== String(viewingPlayerId));
              return opponent?.friendCode ? <div className="match-opponent-friend-code"><span>対戦相手のフレンドコード</span><strong>{opponent.friendCode}</strong></div> : null;
            })()}
            {!state ? <p className="setting-help">対戦を準備しています…</p> : <>
              {!game?.stage ? <>
                {rejectsDone ? (canActFor(chooserId) ? <>
                  <p className="setting-help">{[match.player1,match.player2].find(p=>p?.id===chooserId)?.name || 'プレイヤー'} がステージを選択</p>
                  <div className="stage-grid">{available.map(stage => <button key={stage} type="button" className={stageSelection===stage?'stage selected':'stage'} onClick={()=>setStageSelection(stage)}>{stage}</button>)}</div>
                  <button className="submit" type="button" disabled={!stageSelection || savingBracket || (demoMatch && String(chooserId) !== String(viewingPlayerId))} onClick={() => { const chosen = stageSelection; setStageSelection(''); chooseMatchStage(ri,mi,chosen); }}>このステージに決定</button>
                </> : waitingFor(chooserId)) : (canActFor(rejectTurnId) ? <>
                  <p className="setting-help">ステージ拒否：{[match.player1,match.player2].find(p=>p?.id===rejectTurnId)?.name || 'プレイヤー'}（{state.gameNumber===1 ? (rejectTurnId===firstId ? settings.firstPlayerRejects??1 : settings.secondPlayerRejects??2) : Math.max(0,Number(settings.laterRejects??3)-(game?.rejects?.length||0))}個選択）</p>
                  <div className="stage-grid">{available.map(stage => <button key={stage} type="button" className={rejectSelection.includes(stage)?'stage selected':'stage'} disabled={rejectSelection.length >= (state.gameNumber===1 ? Number(rejectTurnId===firstId ? settings.firstPlayerRejects??1 : settings.secondPlayerRejects??2) : Math.max(0,Number(settings.laterRejects??3)-(game?.rejects?.length||0))) && !rejectSelection.includes(stage)} onClick={()=>setRejectSelection(old=>old.includes(stage)?old.filter(s=>s!==stage):[...old,stage])}>{stage}</button>)}</div>
                  <button className="submit" type="button" disabled={savingBracket || (demoMatch && String(rejectTurnId) !== String(viewingPlayerId))} onClick={() => rejectMatchStages(ri,mi,rejectTurnId,rejectSelection)}>拒否を確定</button>
                </> : waitingFor(rejectTurnId))}
              </> : <>
                
                {tournament.stageRejects && game.stage !== "なし" && <p className="match-stage-decided" role="status">ステージが決まりました：<strong>{game.stage}</strong></p>}
                <h3 className="match-result-heading">試合結果を入力</h3>
                {[match.player1,match.player2].some(p=>String(p.id)===String(viewingPlayerId)) ? <>
                  <div className="match-result-buttons stage-striker-results">
                    <button type="button" className={"match-result-win"+(game?.results?.[String(viewingPlayerId)]==="win"?" active":"")} disabled={savingBracket} onClick={()=>submitMatchResult(ri,mi,'win')}>WIN</button>
                    <button type="button" className={"match-result-lose"+(game?.results?.[String(viewingPlayerId)]==="lose"?" active":"")} disabled={savingBracket} onClick={()=>submitMatchResult(ri,mi,'lose')}>LOSE</button>
                  </div>
                  {game?.results?.[String(viewingPlayerId)] && !game?.results?.[String(viewingPlayerId===String(p1Id)?match.player2.id:p1Id)] && <p className="setting-help match-turn-waiting">相手の勝敗報告を待っています…</p>}
                  {game?.results?.[String(p1Id)] && game?.results?.[String(match.player2.id)] && game.results[String(p1Id)]===game.results[String(match.player2.id)] && <p className="form-error">勝敗報告が一致していません。WIN / LOSEを確認してください。</p>}
                </> : <p className="setting-help">選手の勝敗報告を待っています…</p>}
              </>}
            </>}
          </section>;
        })()}
{!activeMatchId && !tournament.bracket.complete && <section className="bracket-panel match-controls-below"><h3>対戦画面</h3><p className="setting-help">{currentUserId ? '現在、自分の進行中の対戦はありません。' : 'ログインして参加登録すると、自分の対戦が自動表示されます。'}</p></section>}
      </div>}
      {tournament.bracket && !showTournamentOverview && <section className="tournament-board" aria-label="コメント">
        <div className="tournament-board-heading"><h2>コメント</h2><button type="button" className="tournament-board-toggle" aria-expanded={boardOpen} onClick={() => setBoardOpen(open => !open)}>{boardOpen ? '履歴を閉じる ▲' : '過去のコメント ▼'}</button></div>
        {boardMessages.length ? <article className="tournament-board-entry tournament-board-latest">
          <div className="tournament-board-meta"><strong>{boardMessages[boardMessages.length - 1].author_name}{boardMessages[boardMessages.length - 1].is_organizer ? '（主催者）' : ''}</strong><time dateTime={boardMessages[boardMessages.length - 1].created_at}>{new Date(boardMessages[boardMessages.length - 1].created_at).toLocaleString('ja-JP')}</time></div>
          <p className="tournament-board-message">{boardMessages[boardMessages.length - 1].body}</p>
        </article> : <p className="setting-help">まだコメントはありません。</p>}
        {boardOpen && boardMessages.length > 1 && <div className="tournament-board-messages">
          {boardMessages.slice(0, -1).map(message => <article className="tournament-board-entry" key={message.id}>
            <div className="tournament-board-meta"><strong>{message.author_name}{message.is_organizer ? '（主催者）' : ''}</strong><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString('ja-JP')}</time></div>
            <p className="tournament-board-message">{message.body}</p>
          </article>)}
        </div>}
        {(isOwner || (tournament.joinedPlayers || []).some(player => !player.isDemo && String(player.userId || player.id) === String(currentUserId))) ? <form className="tournament-board-form" onSubmit={postBoardMessage}>
          <textarea aria-label="コメント入力" value={boardText} maxLength={1000} onChange={event => setBoardText(event.target.value)} placeholder="コメントを入力（1000文字以内）" rows={3} />
          <div className="tournament-board-actions">
            {isOwner && <button type="button" className="tournament-board-quick-message" onClick={() => setBoardText(`${roundAnnouncement}を開始してください。配信台の方は入室お願いします。`)}>試合開始アナウンス</button>}
            <button className="submit" type="submit" disabled={boardBusy || !boardText.trim()}>{boardBusy ? '投稿中…' : '投稿する'}</button>
          </div>
        </form> : <p className="setting-help">コメントできるのは主催者と大会参加者のみです。</p>}
        {boardError && <p className="form-error" role="alert">{boardError.replaceAll('掲示板', 'コメント')}</p>}
      </section>}
      {tournament.bracket && !showTournamentOverview && <section className="tournament-live-panel" id="tournament-bracket">
        <div className="bracket-header"><h2>トーナメント表</h2><span className="status">{tournament.bracket.complete ? '結果確定' : '対戦中'}</span></div>
        <p className="setting-help">大会作成時に設定したBO形式・使用ステージ・拒否数に従って各ゲームを進めます。ゲーム結果を記録するとセット勝者が次のラウンドへ進みます。</p>
        {isOwner && <div className="bracket-admin-hint">主催者：対戦カードを選択すると、結果のリセット・不戦勝・配信台の設定ができます。</div>}
        {isOwner && selectedAdminMatch && <div className="bracket-admin-modal-backdrop" onClick={() => { if (!savingBracket) { setAdminMatchSelection(null); setShowForfeitChoices(false); } }}><section className="bracket-admin-panel bracket-admin-modal" role="dialog" aria-modal="true" aria-label="主催者の対戦管理" onClick={event => event.stopPropagation()}>
          <div className="bracket-admin-heading">
            <strong>選択中：{selectedAdminMatch.player1?.name || '未定'} VS {selectedAdminMatch.player2?.name || '未定'}</strong>
            <button type="button" onClick={() => { setAdminMatchSelection(null); setShowForfeitChoices(false); }}>閉じる ×</button>
          </div>
          {!canEditAdminMatch ? <p>両方の対戦相手が決まると操作できます。</p> : <>
            <div className="bracket-admin-history-actions">
              <button type="button" onClick={() => setShowAdminLog(value => !value)}>{showAdminLog ? 'ログを閉じる' : 'ログを見る'}</button>
              <button type="button" disabled={savingBracket || !tournament.adminHistory?.length} onClick={undoAdminAction}>巻き戻し</button>
            </div>
            {showAdminLog && <div className="bracket-admin-history-list">{(tournament.adminLog || []).length
              ? [...tournament.adminLog].reverse().map((entry, index) => <div className="bracket-admin-log-entry" key={index}><span className="bracket-admin-log-dot" /><div><time>{new Date(entry.at).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time><p><strong>主催者：</strong>{entry.label}</p></div></div>)
              : <p>操作履歴はありません。</p>}</div>}
            <div className="bracket-admin-actions">
              {selectedAdminMatch.winnerId || selectedAdminMatch.matchState ? <button type="button" className="bracket-admin-reset" disabled={savingBracket} onClick={() => administerMatch(selectedAdminMatch, 'reset')}>結果をリセット</button> : null}
              {!selectedAdminMatch.winnerId && <button type="button" disabled={savingBracket} onClick={() => setShowForfeitChoices(value => !value)}>{showForfeitChoices ? '不戦勝設定を閉じる' : '不戦勝にする'}</button>}
              {String(streamMatchId) === String(selectedAdminMatch.id) ? <button type="button" disabled={savingBracket} onClick={() => setStreamMatch(null)}>配信台を解除</button> : !selectedAdminMatch.winnerId ? <button type="button" disabled={savingBracket} onClick={() => setStreamMatch(selectedAdminMatch.id)}>配信台に設定</button> : null}
            </div>
            {showForfeitChoices && !selectedAdminMatch.winnerId && <div className="bracket-admin-forfeit">
              <p>不戦勝にする選手を選択してください。</p>
              <div className="bracket-admin-actions">
                <button type="button" disabled={savingBracket} onClick={() => { setShowForfeitChoices(false); administerMatch(selectedAdminMatch, 'forfeit', selectedAdminMatch.player1.id); }}>{selectedAdminMatch.player1.name} を勝者にする</button>
                <button type="button" disabled={savingBracket} onClick={() => { setShowForfeitChoices(false); administerMatch(selectedAdminMatch, 'forfeit', selectedAdminMatch.player2.id); }}>{selectedAdminMatch.player2.name} を勝者にする</button>
              </div>
            </div>}
          </>}
          <p>変更すると、このカードにつながる後続の対戦結果も必要に応じてリセットされます。</p>
        </section></div>}
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
          const canSelect = isOwner || canStartMatch;
          const handleSelect = () => {
            if (isOwner) { setAdminMatchSelection({ roundIndex: ri, matchIndex: mi }); setShowForfeitChoices(false); }
            else if (canStartMatch) startMatch(ri, mi);
          };
          const isAdminSelected = isOwner && adminMatchSelection?.roundIndex === ri && adminMatchSelection?.matchIndex === mi;
          const isStreamMatch = String(streamMatchId) === String(match.id);
          if (ri === 0 && Boolean(match.player1) !== Boolean(match.player2)) return <div key={match.id} className="bracket-bye-spacer" style={{ top: `${64 + (((mi + 0.5) * (2 ** ri)) - 0.5) * 104}px` }} aria-hidden="true" />;
          return <div className={`bracket-match${canSelect ? ' match-startable' : ''}${isAdminSelected ? ' match-admin-selected' : ''}${isStreamMatch ? ' match-streaming' : ''}`} style={{ top: `${64 + (((mi + 0.5) * (2 ** ri)) - 0.5) * 104}px` }} key={match.id} onClick={canSelect ? handleSelect : undefined} role={canSelect ? "button" : undefined} tabIndex={canSelect ? 0 : undefined} aria-label={canSelect ? `${match.player1?.name || '未定'} 対 ${match.player2?.name || '未定'}の${isOwner ? '管理メニュー' : '対戦画面'}を開く` : undefined} onKeyDown={canSelect ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSelect(); } } : undefined}>
            
            {isStreamMatch && <span className="bracket-stream-badge">● 配信台</span>}
            <div className="match-players">{[match.player1, match.player2].map((player, pi) => <div key={pi} className={"match-player-line" + (!player ? " empty-player-line" : "") + (match.player1 && match.player2 && match.winnerId === player?.id ? " winner-line" : "") + (match.winnerId && match.winnerId !== player?.id ? " loser-line" : "")}><span title={player?.name || ""}>{(ri === 0 || tournament.bracket.rounds[ri - 1]?.[mi * 2 + pi]?.winnerId) ? (player?.name || "") : ""}{(ri === 0 || tournament.bracket.rounds[ri - 1]?.[mi * 2 + pi]?.winnerId) && player?.isDemo ? "（デモ）" : ""}</span><strong className={"player-score" + (match.player1 && match.player2 && match.winnerId === player?.id ? " score-winner" : "")}>{player ? (match.resultType === 'forfeit' ? (String(match.winnerId) === String(player.id) ? 'W' : '—') : (match.player1 && match.player2 ? (state?.score?.[player.id] ?? 0) : '')) : ""}</strong></div>)}</div>


            {ri < tournament.bracket.rounds.length - 1 && mi % 2 === 0 && mi + 1 < round.length && (() => {
              const next = round[mi + 1];
              const nextVisible = !(ri === 0 && Boolean(next.player1) !== Boolean(next.player2));
              const distance = 104 * (2 ** ri);
              return <svg className="bracket-connector" width="38" height={distance} viewBox={`0 0 38 ${distance}`} aria-hidden="true"><path d={nextVisible ? `M 0 0 H 19 V ${distance} M 19 ${distance / 2} H 38` : `M 0 0 H 38`} fill="none" stroke="#3170b8" strokeWidth="2" /></svg>;
            })()}
            {ri < tournament.bracket.rounds.length - 1 && mi % 2 === 1 && !(ri === 0 && Boolean(round[mi - 1]?.player1) !== Boolean(round[mi - 1]?.player2)) && <svg className="bracket-connector" width="19" height="2" viewBox="0 0 19 2" aria-hidden="true"><path d="M 0 1 H 19" fill="none" stroke="#3170b8" strokeWidth="2" /></svg>}
            {ri < tournament.bracket.rounds.length - 1 && mi % 2 === 1 && ri === 0 && Boolean(round[mi - 1]?.player1) !== Boolean(round[mi - 1]?.player2) && <svg className="bracket-connector bracket-connector-up" width="38" height="104" viewBox="0 0 38 104" aria-hidden="true"><path d="M 0 104 H 38" fill="none" stroke="#3170b8" strokeWidth="2" /></svg>}
          </div>;
        })}</div>)}</div>


        {tournament.bracket.complete && <><h3 id="tournament-standings">順位・結果</h3><ol className="joined-player-list">{(tournament.resultPlacements || bracketPlacements(tournament.bracket)).map((row, i) => { const player = joinedPlayers.find(p => p.id === row.playerId); return player ? <li key={row.playerId}><strong>{row.place}</strong>　{player.name}{player.isDemo ? '（デモ）' : ''}</li> : null; })}</ol></>}
        {isOwner && tournament.bracket.complete && <button type="button" onClick={() => window.confirm('トーナメント表をリセットしますか？順位結果も消えます。') && saveBracket({ ...tournament, status: '募集中', bracket: null, resultPlacements: null, completedAt: null })}>トーナメントをリセット</button>}
      </section>}

    {(!tournament.bracket || showTournamentOverview) && tournament.bracket?.complete && <><section className="create-panel tournament-results-card"><h2>大会結果</h2><div className="tournament-results-list">{(tournament.resultPlacements || bracketPlacements(tournament.bracket)).filter(row => ['優勝','準優勝','3位','ベスト4'].includes(row.place)).map(row => { const player = joinedPlayers.find(p => String(p.id) === String(row.playerId)); return player ? <div className="tournament-result-item" key={String(row.playerId)}><strong>{row.place === 'ベスト4' ? '3位' : row.place}</strong><span>{player.name}</span></div> : null; })}</div></section><div className="tournament-report-action">{joinedPlayers.some(p => !p.isDemo && String(p.userId || p.id) === String(currentUserId)) && <a className="button-link" href={`/tournaments/${encodeURIComponent(id)}/report`}>キャラ報告を編集</a>}{isOwner && <a className="button-link" href={`/tournaments/${encodeURIComponent(id)}/reports`}>キャラ報告を見る</a>}</div></>}
    {(!tournament.bracket || showTournamentOverview) && <div className="tournament-bottom-grid">
    <section className="create-panel tournament-detail" id="tournament-overview">
      <div className="tournament-card-top"><h2>大会概要</h2>{isOwner && !tournament.bracket && <a className="button-link overview-edit-link" href={`/tournaments/new?edit=${encodeURIComponent(id)}`}>編集</a>}</div>
      <div className="detail-grid">
        <div><span>対戦形式</span><strong>{tournament.format || `BO${tournament.bestOf || 3}`}</strong></div>
        <div><span>参加人数</span><strong>{joinedPlayers.length}/{tournament.participants || 8}人</strong></div>
        <div><span>開始時刻</span><strong>{tournament.date ? `${tournament.date.slice(0, 10).replaceAll('-', '/')} ${tournament.date.slice(11, 16)}` : '未設定'}</strong></div>
        <div><span>拒否ステージ</span><strong>{tournament.stageRejects ? 'あり' : 'なし'}</strong></div>
      </div>
      {isOwner && <div className="overview-actions">
        {!tournament.bracket && tournament.declarationPhase !== 'collecting' && <button className="submit" type="button" onClick={startBracket} disabled={savingBracket || joinedPlayers.length < 2}>{tournament.declarationPhase === 'published' ? 'トーナメントを開始する' : '大会を開始する'}</button>}
        {tournament.bracket && <button className="submit" type="button" onClick={() => { setShowTournamentOverview(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>トーナメント表へ</button>}
      </div>}
      {tournament.characterDeclaration && tournament.declarationPhase === 'collecting' && <section className="tournament-declaration">
        <h3>キャラ宣言</h3>
        <p className="setting-help">参加者全員がキャラクターとカラーを送信したら、主催者が宣言を公開します。送信後は変更できません。</p>
        <p>宣言済み：{joinedPlayers.filter(p => tournament.characterDeclarations?.[String(p.id)]).length} / {joinedPlayers.length}人</p>
        {joinedPlayers.some(p => String(p.userId || p.id) === String(currentUserId)) && !joinedPlayers.some(p => String(p.userId || p.id) === String(currentUserId) && tournament.characterDeclarations?.[String(p.id)]) && <div className="declaration-entry">
          <label>使用キャラクター<input value={declarationCharacter} onChange={e => setDeclarationCharacter(e.target.value)} maxLength={60} placeholder="キャラクター名" /></label>
          <label>カラー<select value={declarationColor} onChange={e => setDeclarationColor(e.target.value)}>{Array.from({length:8},(_,i)=><option key={i} value={`${i+1}P`}>{i+1}P</option>)}</select></label>
          <button className="submit" type="button" disabled={declarationBusy || !declarationCharacter.trim()} onClick={() => declarationAction('submit')}>キャラ宣言を送信</button>
        </div>}
        {joinedPlayers.some(p => String(p.userId || p.id) === String(currentUserId) && tournament.characterDeclarations?.[String(p.id)]) && <p>宣言を受け付けました。公開をお待ちください。</p>}
        {isOwner && <button className="submit" type="button" disabled={declarationBusy || !joinedPlayers.length || joinedPlayers.some(p => !tournament.characterDeclarations?.[String(p.id)])} onClick={() => declarationAction('publish')}>宣言を公開</button>}
      </section>}
      {tournament.characterDeclaration && tournament.declarationPhase === 'published' && <section className="tournament-declaration">
        <h3>キャラ宣言一覧</h3>
        <ul className="joined-player-list">{joinedPlayers.map(p => <li key={p.id}>{p.name}：{tournament.characterDeclarations?.[String(p.id)]?.character} {tournament.characterDeclarations?.[String(p.id)]?.color}</li>)}</ul>
      </section>}
      <h3>大会説明</h3>
      <p className="generated-description">{(tournament.description || '大会の詳細設定をご確認ください。').replace(/\\n|\/n/g, '\n')}</p>
      {!tournament.stageRejects ? <>
        <h3>使用ステージ</h3>
        <div className="detail-stage-list">{(tournament.stages || []).map(stage => <span key={stage}>{stage}</span>)}</div>
      </> : <>
        <h3>拒否ステージ設定</h3>
        <h4 className="stage-group-heading">スターター</h4>
        <div className="detail-stage-list">{(tournament.stageSettings?.starterStages || []).map(stage => <span key={stage}>{stage}</span>)}</div>
        <h4 className="stage-group-heading">カウンターピック</h4>
        <div className="detail-stage-list">{(tournament.stageSettings?.counterpickStages || []).map(stage => <span key={stage}>{stage}</span>)}</div>
        <p className="generated-description">最初のプレイヤー：{tournament.stageSettings?.firstPlayerRejects ?? 1}ステージ拒否／次のプレイヤー：{tournament.stageSettings?.secondPlayerRejects ?? 2}ステージ拒否／2ゲーム目以降：{tournament.stageSettings?.laterRejects ?? 3}ステージ拒否</p>
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
      {!tournament.bracket && !joinedPlayers.some(player => String(player.userId || player.id) === String(currentUserId)) && (
        joinedPlayers.length >= Number(tournament.participants || 8)
          ? <p className="setting-help">定員に達しています。</p>
          : <form onSubmit={joinTournament}>
              {!savedFriendCode && <label>フレンドコード（必須）<input value={joinFriendCode} onChange={event => setJoinFriendCode(event.target.value.toUpperCase())} placeholder="SW-0000-0000-0000" pattern="[A-Za-z0-9-]+" title="英数字とハイフンのみ" required /></label>}
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="submit" type="submit">参加登録する</button>
            </form>
      )}
    </section>
    </div>}
    {isOwner && (!tournament.bracket || showTournamentOverview) && <div className="tournament-delete-section"><button className="danger-button" type="button" onClick={deleteTournament}>この大会を削除</button></div>}
    <footer>アミコネ</footer>
  </main>;
}
