'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { getSupabaseBrowserClient } from '../../../lib/supabase/client';
import { removeCachedTournament } from '../../../lib/tournament-cache';

const OWNER_KEY = 'figure-tournament-owner-v1';
const FIGHTERS = ['マリオ','ドンキーコング','リンク','サムス','ダークサムス','ヨッシー','カービィ','フォックス','ピカチュウ','ルイージ','ネス','キャプテン・ファルコン','プリン','ピーチ','デイジー','クッパ','アイスクライマー','シーク','ゼルダ','ドクターマリオ','ピチュー','ファルコ','マルス','ルキナ','こどもリンク','ガノンドロフ','ミュウツー','ロイ','クロム','Mr.ゲーム＆ウォッチ','メタナイト','ピット','ブラックピット','ゼロスーツサムス','ワリオ','スネーク','アイク','ゼニガメ','フシギソウ','リザードン','ディディーコング','リュカ','ソニック','デデデ','ピクミン＆オリマー','ルカリオ','ロボット','トゥーンリンク','ウルフ','むらびと','ロックマン','Wii Fit トレーナー','ロゼッタ＆チコ','リトル・マック','ゲッコウガ','Mii 格闘タイプ','Mii 剣術タイプ','Mii 射撃タイプ','パルテナ','パックマン','ルフレ','シュルク','クッパJr.','ダックハント','リュウ','ケン','クラウド','カムイ','ベヨネッタ','インクリング','リドリー','シモン','リヒター','キングクルール','しずえ','ガオガエン','パックンフラワー','ジョーカー','勇者','バンジョー＆カズーイ','テリー','ベレト／ベレス','ミェンミェン','スティーブ','セフィロス','ホムラ／ヒカリ','カズヤ','ソラ'];

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
  const [savingBracket, setSavingBracket] = useState(false);
  const [activeMatchId, setActiveMatchId] = useState('');
  const [adminMatchSelection, setAdminMatchSelection] = useState(null);
  const [showForfeitChoices, setShowForfeitChoices] = useState(false);
  const [showAdminLog, setShowAdminLog] = useState(false);
  const [logMatchId, setLogMatchId] = useState('');
  const [rejectSelection, setRejectSelection] = useState([]);
  const [stageSelection, setStageSelection] = useState('');
  const [showTournamentOverview, setShowTournamentOverview] = useState(true);

  const [declarationCharacter, setDeclarationCharacter] = useState('マリオ');
  const [declarationColor, setDeclarationColor] = useState('1P');
  const [declarationBusy, setDeclarationBusy] = useState(false);
  const [boardMessages, setBoardMessages] = useState([]);
  const [boardText, setBoardText] = useState('');
  const [boardBusy, setBoardBusy] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [boardError, setBoardError] = useState('');
  const tournamentSnapshotRef = useRef('');
  const tournamentEtagRef = useRef('');
  const boardSnapshotRef = useRef('');
  const boardInFlightRef = useRef(false);

  function applyTournamentSnapshot(next) {
    const signature = JSON.stringify(next);
    if (signature === tournamentSnapshotRef.current) return;
    const previous = tournamentSnapshotRef.current;
    tournamentSnapshotRef.current = signature;
    // Open the bracket when it first becomes available, including when a
    // participant opens the page just after the organizer started the event.
    // Subsequent snapshots do not override manual navigation to the overview.
    let previouslyHadBracket = false;
    if (previous) {
      try { previouslyHadBracket = Boolean(JSON.parse(previous).bracket); } catch {}
    }
    if (next.bracket && !next.bracket.complete && !previouslyHadBracket) {
      setShowTournamentOverview(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    setTournament(next);
  }

  async function refreshBoard() {
    if (!id || boardInFlightRef.current) return;
    boardInFlightRef.current = true;
    try {
      const response = await fetch(`/api/tournaments/board?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'コメントを読み込めませんでした。');
      const messages = data.messages || [];
      const signature = JSON.stringify(messages);
      if (signature !== boardSnapshotRef.current) {
        boardSnapshotRef.current = signature;
        setBoardMessages(messages);
      }
      setBoardError('');
    } catch (error) { setBoardError(error.message || 'コメントを読み込めませんでした。'); }
    finally { boardInFlightRef.current = false; }
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
      const response = await fetch(`/api/tournaments?id=${encodeURIComponent(id)}&ownerToken=${encodeURIComponent(owner)}`, { cache: 'no-store', headers: { ...headers, ...(tournamentEtagRef.current ? { 'If-None-Match': tournamentEtagRef.current } : {}) } });
        if (response.status === 304) return;
        const newEtag = response.headers.get('etag');
        if (newEtag) tournamentEtagRef.current = newEtag;
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '大会を読み込めませんでした。');
      if (result.tournament) {
        applyTournamentSnapshot(result.tournament);
      } else {
        tournamentSnapshotRef.current = '';
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

  // Keep the overview synchronized as well: tournament start and declaration
  // changes must appear on other participants' screens without a reload.
  useEffect(() => {
    if (!id || !tournament || !showTournamentOverview || tournament.bracket?.complete || savingBracket || tournament.declarationPhase === 'collecting') return;
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (cancelled || inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const owner = localStorage.getItem(OWNER_KEY) || '';
        const response = await fetch(`/api/tournaments?id=${encodeURIComponent(id)}&ownerToken=${encodeURIComponent(owner)}`, { cache: 'no-store', headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(tournamentEtagRef.current ? { 'If-None-Match': tournamentEtagRef.current } : {}) } });
        if (response.status === 304) return;
        const newEtag = response.headers.get('etag');
        if (newEtag) tournamentEtagRef.current = newEtag;
        if (!response.ok || cancelled) return;
        const result = await response.json();
        if (!cancelled && result.tournament) applyTournamentSnapshot(result.tournament);
      } catch {} finally { inFlight = false; }
    };
    const timer = setInterval(refresh, 4000);
    const onVisible = () => { void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [id, Boolean(tournament), showTournamentOverview, tournament?.bracket?.complete, tournament?.declarationPhase, savingBracket, accessToken]);

  // Character declaration is live even before the bracket exists.
  useEffect(() => {
    if (tournament?.declarationPhase !== 'collecting' || !id) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible' || declarationBusy || savingBracket) return;
      fetch(`/api/tournaments?id=${encodeURIComponent(id)}`, { cache: 'no-store', headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} })
        .then(async response => {
          if (!response.ok) return;
          const result = await response.json();
          if (result.tournament) applyTournamentSnapshot(result.tournament);
        }).catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [id, tournament?.declarationPhase, declarationBusy, savingBracket, accessToken]);

  // Keep both players in sync while a bracket is active, without flashing the loading screen.
  useEffect(() => {
    if (!tournament || tournament.bracket?.complete || savingBracket) return;
    let cancelled = false;
    let inFlight = false;
    let lastSync = 0;
    let realtimeConnected = false;
    let receivedSignal = false;
    let channel = null;
    const refresh = async () => {
      if (cancelled || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const owner = localStorage.getItem(OWNER_KEY) || '';
        const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
        const response = await fetch(`/api/tournaments?id=${encodeURIComponent(id)}&ownerToken=${encodeURIComponent(owner)}`, { cache: 'no-store', headers });
        if (!response.ok || cancelled) return;
        const result = await response.json();
        if (!cancelled && result.tournament) {
          applyTournamentSnapshot(result.tournament);
          lastSync = Date.now();
        }
      } catch {} finally {
        inFlight = false;
      }
    };
    // Subscribe only to a dedicated, non-sensitive change signal table.
    // Never subscribe to public.tournaments: its JSON contains private data.
    // The authenticated GET API remains the source of truth.
    if (process.env.NEXT_PUBLIC_TOURNAMENT_REALTIME_ENABLED === 'true') {
      try {
        const client = getSupabaseBrowserClient();
        channel = client.channel(`tournament-signals:${id}`);
        channel.on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'tournament_change_signals',
          filter: `tournament_id=eq.${id}`,
        }, () => { receivedSignal = true; void refresh(); });
        channel.subscribe(status => {
          realtimeConnected = status === 'SUBSCRIBED';
          if (status === 'SUBSCRIBED') void refresh();
        });
      } catch {
        realtimeConnected = false;
      }
    }
    // Preserve the 4-second fallback if the signal channel is unavailable.
    // While connected, a periodic 30-second refresh catches missed signals.
    const interval = setInterval(() => {
      // Do not slow polling until every write path publishes notifications.
      const intervalMs = realtimeConnected && receivedSignal ? 30000 : 4000;
      if (Date.now() - lastSync >= intervalMs) void refresh();
    }, 4000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      if (channel) void getSupabaseBrowserClient().removeChannel(channel);
    };
  }, [id, Boolean(tournament), tournament?.bracket?.complete, savingBracket, accessToken]);

  // 大会終了後、条件を満たす参加者を一度だけキャラ報告ページへ案内する。
  useEffect(() => {
    if (!tournament?.bracket?.complete || !currentUserId || loading) return;
    const player = (tournament.joinedPlayers || []).find(p => !p.isDemo && String(p.userId || p.id) === String(currentUserId));
    if (!player || tournament.characterDeclaration || tournament.characterReports?.[String(player.id)]) return;
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
    const perspectiveId = currentUserId;
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
    applyTournamentSnapshot(next);

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

  async function startBracket() {
    if (!isOwner) return;
    const players = tournament.joinedPlayers || [];
    if (players.length < 2) { setError('トーナメント開始には参加者が2人以上必要です。'); return; }
    if (tournament.characterDeclaration && tournament.declarationPhase !== 'published') {
      await saveBracket({ ...tournament, status: 'キャラ宣言中', declarationPhase: 'collecting', characterDeclarations: {} });
      return;
    }
    const next = { ...tournament, status: '対戦中', bracket: makeBracket(players), streamMatchId: undefined, resultPlacements: null };
    await saveBracket(next);
    setShowTournamentOverview(false);
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

  async function performStageAction(roundIndex, matchIndex, action, extra = {}) {
    if (savingBracket) return;
    const match = tournament?.bracket?.rounds?.[roundIndex]?.[matchIndex];
    if (!match) return;
    setSavingBracket(true);
    setError('');
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('ログインが必要です。');
      const response = await fetch('/api/tournaments/stage-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, matchId: match.id, action, ...extra }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '対戦操作に失敗しました。');
      const owner = localStorage.getItem(OWNER_KEY) || '';
      const latest = await fetch(`/api/tournaments?id=${encodeURIComponent(id)}&ownerToken=${encodeURIComponent(owner)}`, {
        cache: 'no-store', headers: { Authorization: `Bearer ${token}` },
      });
      if (latest.ok) {
        const data = await latest.json();
        if (data.tournament) setTournament(data.tournament);
      }
      if (action === 'start') setActiveMatchId(match.id);
      setRejectSelection([]);
      setStageSelection('');
    } catch (e) {
      setError(e.message || '対戦操作に失敗しました。');
    } finally {
      setSavingBracket(false);
    }
  }

  function startMatch(roundIndex, matchIndex) {
    return performStageAction(roundIndex, matchIndex, 'start');
  }

  function rejectMatchStages(roundIndex, matchIndex, playerId, chosenStages) {
    return performStageAction(roundIndex, matchIndex, 'reject', { actorId: playerId, stages: chosenStages });
  }

  function chooseMatchStage(roundIndex, matchIndex, stage) {
    const match = tournament?.bracket?.rounds?.[roundIndex]?.[matchIndex];
    return performStageAction(roundIndex, matchIndex, 'choose', { actorId: match?.matchState?.currentGame?.chooserId, stage });
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
        body: JSON.stringify({ id, matchId: match.id, gameNumber: match.matchState.gameNumber, result }),
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
      applyTournamentSnapshot(result.tournament);
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

  async function rewindMatchLog(matchId, logId) {
    if (!isOwner || savingBracket) return;
    const entries = tournament.matchLogs || [];
    const targetIndex = entries.findIndex(entry => entry.id === logId && String(entry.matchId) === String(matchId));
    if (targetIndex < 0 || !window.confirm(`この対戦カードを選択した操作の直前まで戻しますか？このカードの以降の操作と、影響を受ける後続カードだけを取り消します。無関係な対戦カードは維持します。`)) return;
    setSavingBracket(true);
    setError('');
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session?.access_token) throw new Error('主催者としてログインしてください。');
      const response = await fetch('/api/tournaments/admin-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ id, matchId, action: 'rewind-match', winnerId: logId, ownerToken: ownerId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '巻き戻せませんでした。');
      applyTournamentSnapshot(result.tournament);
    } catch (e) { setError(e.message || '巻き戻せませんでした。'); }
    finally { setSavingBracket(false); }
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
      applyTournamentSnapshot(result.tournament);
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

  async function withdrawTournament() {
    if (!window.confirm('この大会の参加登録を解除しますか？')) return;
    setError('');
    try {
      const response = await fetch('/api/tournaments/join', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '参加解除に失敗しました。');
      setTournament(current => ({ ...current, joinedPlayers: result.joinedPlayers }));
    } catch (error) { setError(error.message || '参加解除に失敗しました。'); }
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
  // Prefer the deepest round with a playable unresolved match. Earlier rounds may
  // retain incomplete/bye cards even after the final has become playable.
  const bracketRounds = tournament.bracket?.rounds || [];
  const activeRoundIndex = bracketRounds.findLastIndex(round => round.some(match => !match.winnerId && match.player1 && match.player2));
  const pendingRoundIndex = bracketRounds.findIndex(round => round.some(match => !match.winnerId && (match.player1 || match.player2)));
  const currentRoundNumber = (activeRoundIndex >= 0 ? activeRoundIndex : pendingRoundIndex >= 0 ? pendingRoundIndex : Math.max(0, bracketRounds.length - 1)) + 1;
  const roundCount = tournament.bracket?.rounds?.length || 0;
  const roundAnnouncement = roundCount > 0 && currentRoundNumber === roundCount ? '決勝戦' : roundCount > 2 && currentRoundNumber === roundCount - 1 ? '準決勝' : `${currentRoundNumber}回戦`;
  const selectedAdminMatch = isOwner && adminMatchSelection
    ? tournament.bracket?.rounds?.[adminMatchSelection.roundIndex]?.[adminMatchSelection.matchIndex] || null
    : null;
  const canEditAdminMatch = Boolean(selectedAdminMatch?.player1 && selectedAdminMatch?.player2);
  const streamMatchId = tournament.effectiveStreamMatchId ?? tournament.streamMatchId ?? null;

  // Declaration is its own phase, not a section hidden below the overview.
  if (tournament.characterDeclaration && tournament.declarationPhase === 'collecting') {
    const me = joinedPlayers.find(p => !p.isDemo && String(p.userId || p.id) === String(currentUserId));
    const submitted = Boolean(me && tournament.characterDeclarations?.[String(me.id)]);
    const count = tournament.declarationSubmittedCount ?? joinedPlayers.filter(p => tournament.characterDeclarations?.[String(p.id)]).length;
    return <main className="page tournament-detail-page">
      <section className="intro"><h1>{tournament.name}</h1><h2>キャラ宣言</h2>
        <p>宣言済み：{count} / {joinedPlayers.length}人</p>
        <p className="setting-help">参加者全員が送信したあと、主催者が公開します。宣言したキャラクターとカラーは公開まで他の参加者には表示されません。</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {me && !submitted && <div className="declaration-entry my-color-form">
          <label>使用キャラクター<select className="my-color-fighter-select" value={declarationCharacter} onChange={e => setDeclarationCharacter(e.target.value)}>{FIGHTERS.map(fighter => <option key={fighter} value={fighter}>{fighter}</option>)}</select></label>
          <label>カラー<select className="my-color-variant-select" value={declarationColor} onChange={e => setDeclarationColor(e.target.value)}>{Array.from({length:8},(_,i)=><option key={i} value={`${i+1}P`}>{i+1}P</option>)}</select></label>
          <button className="submit" type="button" disabled={declarationBusy || !declarationCharacter.trim()} onClick={() => declarationAction('submit')}>キャラ宣言を送信</button>
        </div>}
        {submitted && <p>宣言済みです。公開をお待ちください。</p>}
        {isOwner && <><h3>参加者の宣言状況</h3>
          <ul className="joined-player-list">{joinedPlayers.map(p => <li key={p.id}><span>{p.name}</span><strong>{tournament.characterDeclarations?.[String(p.id)] ? '入力済み' : '未入力'}</strong></li>)}</ul>
          <button className="submit" type="button" disabled={declarationBusy || !joinedPlayers.length || joinedPlayers.some(p => !tournament.characterDeclarations?.[String(p.id)])} onClick={() => declarationAction('publish')}>宣言を公開</button>
        </>}
        {!me && !isOwner && <p>大会参加者のみキャラ宣言を送信できます。</p>}
      </section>
    </main>;
  }

  return <main className="page tournament-detail-page">
    <section className="intro tournament-heading">
      {tournament.bracket && !showTournamentOverview ? <button type="button" className="back-link tournament-back-button" onClick={() => { setShowTournamentOverview(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>← 大会概要に戻る</button> : <a className="back-link" href="/">← ホームに戻る</a>}
      <div className="tournament-title-row">
        <div><h1>{tournament.name}</h1></div>
      </div>
    </section>
      {!showTournamentOverview && error && <p className="form-error" role="alert">{error}</p>}
      {tournament.bracket && !showTournamentOverview && !tournament.bracket.complete && <div className="tournament-match-area">
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
          const viewingPlayerId = String(currentUserId || '');
          const viewingPlayer = [match.player1, match.player2].find(p => String(p.id) === String(viewingPlayerId));
          const rejectTurnId = state?.gameNumber === 1
            ? (!game?.rejectVotes?.[firstId] && Number(settings.firstPlayerRejects ?? 1) > 0 ? firstId : (match.player1.id === firstId ? match.player2.id : match.player1.id))
            : game?.previousWinnerId;
          const firstRejectDone = !firstId || Number(settings.firstPlayerRejects ?? 1) === 0 || Boolean(game?.rejectVotes?.[firstId]);
          const secondId = match.player1.id === firstId ? match.player2.id : match.player1.id;
          const secondRejectDone = !secondId || Number(settings.secondPlayerRejects ?? 2) === 0 || Boolean(game?.rejectVotes?.[secondId]);
          const rejectsDone = !tournament.stageRejects || (state?.gameNumber === 1 ? firstRejectDone && secondRejectDone : (game?.rejects?.length || 0) >= Number(settings.laterRejects ?? 3));
          const chooserId = state?.gameNumber === 1 ? firstId : (game?.previousWinnerId === match.player1.id ? match.player2.id : match.player1.id);
          const demoMatch = Boolean(match.player1?.isDemo || match.player2?.isDemo);
          const canActFor = id => isOwner && demoMatch ? true : String(id) === String(viewingPlayerId);
          const waitingFor = id => <p className="setting-help match-turn-waiting">{[match.player1,match.player2].find(p => String(p.id) === String(id))?.name || '相手'} の入力を待っています…</p>;
          return <section className={`bracket-panel match-controls-below${String(streamMatchId) === String(match.id) ? " match-controls-streaming" : ""}`} aria-label="対戦操作">
            {String(streamMatchId) === String(match.id) && <div className="match-stream-announcement"><strong>● 配信台の対戦</strong><span>配信台に入室して試合を進めてください。</span></div>}

            <div className="game-top">
              <div className="current-score">{state?.score?.[p1Id] || 0}<span> - </span>{state?.score?.[match.player2.id] || 0}</div>
            </div>
            <div className="player-strip">
              <div ><small>PLAYER 1</small><b>{match.player1.name}</b></div>
              <div ><small>PLAYER 2</small><b>{match.player2.name}</b></div>
            </div>
            {(() => {
              const isStreaming = String(streamMatchId) === String(match.id);
              const opponent = [match.player1, match.player2].find(player => String(player.id) !== String(viewingPlayerId));
              const code = isStreaming ? '' : opponent?.friendCode;
              return code ? <div className="match-opponent-friend-code"><span>対戦相手のフレンドコード</span><strong>{code}</strong></div> : null;
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
        <div className="tournament-board-scroll" role="region" aria-label="コメント履歴" tabIndex={0}>
          {boardMessages.length ? boardMessages.slice().reverse().map(message => <article className="tournament-board-entry" key={message.id}>
            <div className="tournament-board-meta"><strong>{message.author_name}{message.is_organizer ? '（主催者）' : ''}</strong><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString('ja-JP')}</time></div>
            <p className="tournament-board-message">{message.body}</p>
          </article>) : <p className="setting-help">まだコメントはありません。</p>}
        </div>
        {(isOwner || (tournament.joinedPlayers || []).some(player => !player.isDemo && String(player.userId || player.id) === String(currentUserId))) ? <form className="tournament-board-form" onSubmit={postBoardMessage}>
          <textarea aria-label="コメント入力" value={boardText} maxLength={1000} onChange={event => setBoardText(event.target.value)} placeholder="コメントを入力" rows={3} />
          <div className="tournament-board-actions">
            {isOwner && <button type="button" className="tournament-board-quick-message" onClick={() => setBoardText(`${roundAnnouncement}を開始してください。配信台の方は入室お願いします。`)}>試合開始アナウンス</button>}
            <button className="submit" type="submit" disabled={boardBusy || !boardText.trim()}>{boardBusy ? '投稿中…' : '投稿する'}</button>
          </div>
        </form> : <p className="setting-help">コメントできるのは主催者と大会参加者のみです。</p>}
        {boardError && <p className="form-error" role="alert">{boardError.replaceAll('掲示板', 'コメント')}</p>}
      </section>}
      {tournament.bracket && !showTournamentOverview && <section className="tournament-live-panel" id="tournament-bracket">
        <div className="bracket-header"><h2>トーナメント表</h2></div>
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
            </div>
            {showAdminLog && <div className="bracket-admin-history-list">{(tournament.matchLogs || []).filter(entry => String(entry.matchId) === String(selectedAdminMatch.id)).slice().reverse().map(entry => <div className="bracket-admin-log-entry" key={entry.id}><span className="bracket-admin-log-dot" /><div><div className="bracket-admin-log-meta"><time>{new Date(entry.at).toLocaleString('ja-JP')}</time>{isOwner && <button type="button" className="bracket-admin-rewind-mini" disabled={savingBracket} onClick={() => rewindMatchLog(selectedAdminMatch.id, entry.id)}>戻る</button>}</div><p><strong>{entry.actor}：</strong>{entry.action}</p></div></div>)}{!(tournament.matchLogs || []).some(entry => String(entry.matchId) === String(selectedAdminMatch.id)) && <p>この対戦の操作ログはまだありません。</p>}</div>}
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
            {ri < tournament.bracket.rounds.length - 1 && mi % 2 === 1 && ri === 0 && Boolean(round[mi - 1]?.player1) !== Boolean(round[mi - 1]?.player2) && <svg className="bracket-connector bracket-connector-up" width="38" height="104" viewBox="0 0 38 104" aria-hidden="true"><path d="M 0 104 H 19 V 52 H 38" fill="none" stroke="#3170b8" strokeWidth="2" /></svg>}
          </div>;
        })}</div>)}</div>


        {logMatchId && <div className="bracket-admin-modal-backdrop" onClick={() => setLogMatchId('')}><section className="bracket-admin-panel bracket-admin-modal" role="dialog" aria-modal="true" aria-label="対戦操作ログ" onClick={e => e.stopPropagation()}><div className="bracket-admin-heading"><strong>対戦操作ログ</strong><button type="button" onClick={() => setLogMatchId('')}>閉じる ×</button></div><div className="bracket-admin-history-list">{(tournament.matchLogs || []).filter(entry => String(entry.matchId) === logMatchId).slice().reverse().map(entry => <div className="bracket-admin-log-entry" key={entry.id}><span className="bracket-admin-log-dot" /><div><div className="bracket-admin-log-meta"><time>{new Date(entry.at).toLocaleString('ja-JP')}</time>{isOwner && <button type="button" className="bracket-admin-rewind-mini" disabled={savingBracket} onClick={() => rewindMatchLog(logMatchId, entry.id)}>戻る</button>}</div><p><strong>{entry.actor}：</strong>{entry.action}</p></div></div>)}{!(tournament.matchLogs || []).some(entry => String(entry.matchId) === logMatchId) && <p>この対戦の操作ログはまだありません。</p>}</div></section></div>}
        {tournament.bracket.complete && <><h3 id="tournament-standings">順位・結果</h3><ol className="joined-player-list">{(tournament.resultPlacements || bracketPlacements(tournament.bracket)).map((row, i) => { const player = joinedPlayers.find(p => p.id === row.playerId); return player ? <li key={row.playerId}><strong>{row.place}</strong>　{player.name}{player.isDemo ? '（デモ）' : ''}</li> : null; })}</ol></>}
        {isOwner && tournament.bracket.complete && <button type="button" onClick={() => window.confirm('トーナメント表をリセットしますか？順位結果も消えます。') && saveBracket({ ...tournament, status: '募集中', bracket: null, resultPlacements: null, completedAt: null })}>トーナメントをリセット</button>}
      </section>}

    {(!tournament.bracket || showTournamentOverview) && tournament.bracket?.complete && <><section className="create-panel tournament-results-card"><h2>大会結果</h2><div className="tournament-results-list">{(tournament.resultPlacements || bracketPlacements(tournament.bracket)).filter(row => ['優勝','準優勝','3位','ベスト4'].includes(row.place)).map(row => { const player = joinedPlayers.find(p => String(p.id) === String(row.playerId)); return player ? <div className="tournament-result-item" key={String(row.playerId)}><strong>{row.place === 'ベスト4' ? '3位' : row.place}</strong><span>{player.name}</span></div> : null; })}</div></section><div className="tournament-report-action">{!tournament.characterDeclaration && joinedPlayers.some(p => !p.isDemo && String(p.userId || p.id) === String(currentUserId)) && <a className="button-link" href={`/tournaments/${encodeURIComponent(id)}/report`}>キャラ報告を編集</a>}{isOwner && !tournament.characterDeclaration && <a className="button-link" href={`/tournaments/${encodeURIComponent(id)}/reports`}>キャラ報告を見る</a>}</div></>}
    {(!tournament.bracket || showTournamentOverview) && <div className="tournament-bottom-grid">
    <section className="create-panel tournament-detail" id="tournament-overview">
      <div className="tournament-card-top"><h2>大会概要</h2></div>
      {(isOwner || tournament.bracket) && <div className="overview-actions">
        {isOwner && !tournament.bracket && tournament.declarationPhase !== 'collecting' && <button className="submit overview-start-button" type="button" onClick={startBracket} disabled={savingBracket || joinedPlayers.length < 2}>{tournament.declarationPhase === 'published' ? 'トーナメント表へ' : '大会を開始する'}</button>}
        {tournament.bracket && <button className="overview-bracket-button" type="button" onClick={() => { setShowTournamentOverview(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>トーナメント表へ</button>}
        {isOwner && !tournament.bracket && <a className="button-link overview-edit-link" href={`/tournaments/new?edit=${encodeURIComponent(id)}`}>編集</a>}
        <a className="button-link overview-share-x" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(tournament.name + '\n' + (typeof window !== 'undefined' ? window.location.origin + '/tournaments/' + encodeURIComponent(id) : 'https://figure-tournament.vercel.app/tournaments/' + encodeURIComponent(id))) }`} target="_blank" rel="noopener noreferrer">Xに投稿する</a>
      </div>}

      <div className="detail-grid">
        <div><span>対戦形式</span><strong>{tournament.format || `BO${tournament.bestOf || 3}`}</strong></div>
        <div><span>参加人数</span><strong>{joinedPlayers.length}/{tournament.participants || 8}人</strong></div>
        <div><span>開始時刻</span><strong>{tournament.date ? `${tournament.date.slice(0, 10).replaceAll('-', '/')} ${tournament.date.slice(11, 16)}` : '未設定'}</strong></div>
        <div><span>拒否ステージ</span><strong>{tournament.stageRejects ? 'あり' : 'なし'}</strong></div>
      </div>
      {/^https?:\/\//i.test(tournament.streamUrl || '') && <div className="overview-stream-link"><span>配信先</span><a href={tournament.streamUrl} target="_blank" rel="noopener noreferrer">{tournament.streamUrl}</a></div>}
      {tournament.characterDeclaration && tournament.declarationPhase === 'collecting' && <section className="tournament-declaration">
        <h3>キャラ宣言</h3>
        <p className="setting-help">参加者全員がキャラクターとカラーを送信したら、主催者が宣言を公開します。送信後は変更できません。</p>
        <p>宣言済み：{(tournament.declarationSubmittedCount ?? joinedPlayers.filter(p => tournament.characterDeclarations?.[String(p.id)]).length)} / {joinedPlayers.length}人</p>
        {joinedPlayers.some(p => String(p.userId || p.id) === String(currentUserId)) && !joinedPlayers.some(p => String(p.userId || p.id) === String(currentUserId) && tournament.characterDeclarations?.[String(p.id)]) && <div className="declaration-entry my-color-form">
          <label>使用キャラクター<select className="my-color-fighter-select" value={declarationCharacter} onChange={e => setDeclarationCharacter(e.target.value)}>{FIGHTERS.map(fighter => <option key={fighter} value={fighter}>{fighter}</option>)}</select></label>
          <label>カラー<select className="my-color-variant-select" value={declarationColor} onChange={e => setDeclarationColor(e.target.value)}>{Array.from({length:8},(_,i)=><option key={i} value={`${i+1}P`}>{i+1}P</option>)}</select></label>
          <button className="submit" type="button" disabled={declarationBusy || !declarationCharacter.trim()} onClick={() => declarationAction('submit')}>キャラ宣言を送信</button>
        </div>}
        {joinedPlayers.some(p => String(p.userId || p.id) === String(currentUserId) && tournament.characterDeclarations?.[String(p.id)]) && <p>宣言を受け付けました。公開をお待ちください。</p>}
        {isOwner && <button className="submit" type="button" disabled={declarationBusy || !joinedPlayers.length || joinedPlayers.some(p => !tournament.characterDeclarations?.[String(p.id)])} onClick={() => declarationAction('publish')}>宣言を公開</button>}
      </section>}
      {tournament.characterDeclaration && tournament.declarationPhase === 'published' && <section className="tournament-declaration">
        <h3>キャラ宣言一覧</h3>
        <ul className="joined-player-list">{joinedPlayers.map(p => <li key={p.id}>{p.name}：{tournament.characterDeclarations?.[String(p.id)]?.character} {tournament.characterDeclarations?.[String(p.id)]?.color}</li>)}</ul>
      </section>}
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
      <h3>大会説明</h3>
      <p className="generated-description">{(tournament.description || '大会の詳細設定をご確認ください。').replace(/\\n|\/n/g, '\n')}</p>

    </section>
    <section className="create-panel tournament-detail participant-side-panel">
      <h2 className="participant-section-heading">参加者（{joinedPlayers.length}/{tournament.participants || 8}人）</h2>
      {joinedPlayers.length ? <ul className="joined-player-list">{joinedPlayers.map(player => <li key={player.id}><span>{player.isDemo ? <>{player.name}（デモ）</> : <a href={`/players/${encodeURIComponent(player.userId || player.id)}?name=${encodeURIComponent(player.name)}`} className="participant-history-link">{player.name}</a>}</span>{!tournament.bracket && (isOwner ? <button type="button" onClick={() => leaveTournament(player.id)}>登録を削除</button> : !player.isDemo && String(player.userId || player.id) === String(currentUserId) ? <button type="button" onClick={withdrawTournament}>参加を解除</button> : null)}</li>)}</ul> : <p className="setting-help">まだ参加者はいません。</p>}
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
  </main>;
}
