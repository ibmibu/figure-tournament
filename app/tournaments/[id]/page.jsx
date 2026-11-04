'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { getSupabaseBrowserClient } from '../../../lib/supabase/client';
import { removeCachedTournament } from '../../../lib/tournament-cache';
import { getCharacterReportPlacement } from '../../../lib/tournament-bracket-admin';
import { editableSetScores, getMatchReportMode, liveSetScores, scoreControlLockRemainingMs } from '../../../lib/tournament-set-result';
import MatchScoreEditor from '../../../components/MatchScoreEditor';

const OWNER_KEY = 'figure-tournament-owner-v1';

// Images live in profiles, not the tournament document. Refresh them only
// when the registration roster changes, never on every live state poll.
function avatarRosterKey(players) {
  return (Array.isArray(players) ? players : [])
    .filter(player => !player.isDemo)
    .map(player => String(player.userId || player.id || ''))
    .filter(Boolean).sort().join('|');
}
const FIGHTERS = ['マリオ','ドンキーコング','リンク','サムス','ダークサムス','ヨッシー','カービィ','フォックス','ピカチュウ','ルイージ','ネス','キャプテン・ファルコン','プリン','ピーチ','デイジー','クッパ','アイスクライマー','シーク','ゼルダ','ドクターマリオ','ピチュー','ファルコ','マルス','ルキナ','こどもリンク','ガノンドロフ','ミュウツー','ロイ','クロム','Mr.ゲーム＆ウォッチ','メタナイト','ピット','ブラックピット','ゼロスーツサムス','ワリオ','スネーク','アイク','ゼニガメ','フシギソウ','リザードン','ディディーコング','リュカ','ソニック','デデデ','ピクミン＆オリマー','ルカリオ','ロボット','トゥーンリンク','ウルフ','むらびと','ロックマン','Wii Fit トレーナー','ロゼッタ＆チコ','リトル・マック','ゲッコウガ','Mii 格闘タイプ','Mii 剣術タイプ','Mii 射撃タイプ','パルテナ','パックマン','ルフレ','シュルク','クッパJr.','ダックハント','リュウ','ケン','クラウド','カムイ','ベヨネッタ','インクリング','リドリー','シモン','リヒター','キングクルール','しずえ','ガオガエン','パックンフラワー','ジョーカー','勇者','バンジョー＆カズーイ','テリー','ベレト／ベレス','ミェンミェン','スティーブ','セフィロス','ホムラ／ヒカリ','カズヤ','ソラ'];

export default function TournamentPage() {
  const params = useParams();
  const id = decodeURIComponent(String(params.id || ''));
  // ChatGPT may append a referrer query parameter when a link is opened.
  // Keep the versioned Discord/X preview URL, but clean that tracker from the
  // browser address bar without triggering a reload or losing Next.js state.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('utm_source') !== 'chatgpt.com') return;
    url.searchParams.delete('utm_source');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);
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
  const [showScoreEditor, setShowScoreEditor] = useState(false);
  const [adminScore, setAdminScore] = useState({ first: 0, second: 0 });
  const [scoreClock, setScoreClock] = useState(() => Date.now());
  const [scoreDraft, setScoreDraft] = useState(null);
  const scoreDraftRef = useRef(null);
  const scoreFlushTimerRef = useRef(null);
  const scoreSendingRef = useRef(false);
  const scoreLastAckRef = useRef(null);
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
  const liveEtagRef = useRef('');
  const liveVersionRef = useRef('');
  const liveFullReadAtRef = useRef(0);
  const avatarMapRef = useRef({});
  const avatarRosterRef = useRef('');
  const boardSnapshotRef = useRef('');
  const boardInFlightRef = useRef(false);
  const autoStartAttemptRef = useRef(new Set());

  function applyTournamentSnapshot(next) {
    // Live polling omits the base64 avatar collection; retain the map fetched
    // on the initial full read. This avoids refreshing N images every 2-5s.
    if (next?.participantAvatars) {
      avatarMapRef.current = next.participantAvatars;
      avatarRosterRef.current = avatarRosterKey(next.joinedPlayers);
    }
    else if (next) next = { ...next, participantAvatars: avatarMapRef.current };
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
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refreshBoard(); }, 30000);
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
          fetch('/api/profile?view=basic', { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
            .then(async response => {
              if (!response.ok) return;
              const profileResult = await response.json();
              setAccountName(String(profileResult.profile?.display_name || 'no name').trim());
              setSavedFriendCode(String(profileResult.profile?.friend_code || '').trim());
            }).catch(() => {});
        }
      } catch {}
      const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
      const response = await fetch(`/api/tournaments?id=${encodeURIComponent(id)}&ownerToken=${encodeURIComponent(owner)}&view=page`, { cache: 'no-store', headers: { ...headers, ...(tournamentEtagRef.current ? { 'If-None-Match': tournamentEtagRef.current } : {}) } });
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

  // A revision token is only valid for the user and tournament that received
  // the matching full response. Reset it when the login or route changes.
  useEffect(() => {
    liveVersionRef.current = '';
    liveEtagRef.current = '';
    liveFullReadAtRef.current = 0;
  }, [id, accessToken]);

  // While registration is open, live polling updates the roster without
  // transferring avatar base64. One compact page request hydrates the images
  // only when a newly registered participant changes the roster.
  const currentRosterKey = tournament && !tournament.bracket
    ? avatarRosterKey(tournament.joinedPlayers) : '';
  useEffect(() => {
    if (!tournament || tournament.bracket || currentRosterKey === avatarRosterRef.current) return;
    let cancelled = false;
    const owner = localStorage.getItem(OWNER_KEY) || '';
    const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
    const url = `/api/tournaments?id=${encodeURIComponent(id)}&ownerToken=${encodeURIComponent(owner)}&view=page`;
    fetch(url, { cache: 'no-store', headers })
      .then(async response => {
        if (!response.ok) return;
        const result = await response.json();
        const next = result.tournament;
        if (cancelled || !next || avatarRosterKey(next.joinedPlayers) !== currentRosterKey) return;
        const avatars = next.participantAvatars;
        if (!avatars || typeof avatars !== 'object') return;
        avatarMapRef.current = avatars;
        avatarRosterRef.current = currentRosterKey;
        setTournament(previous => {
          if (!previous || avatarRosterKey(previous.joinedPlayers) !== currentRosterKey) return previous;
          const updated = { ...previous, participantAvatars: avatars };
          tournamentSnapshotRef.current = JSON.stringify(updated);
          return updated;
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id, currentRosterKey, Boolean(tournament?.bracket), accessToken]);

  // A single tournament sync loop covers the overview, declarations and live bracket.
  // Avoid overlapping four-second requests from separate UI sections.
  // Keep tournament state synchronized without flashing the loading screen.
  useEffect(() => {
    if (!id || !tournament || tournament.bracket?.complete || savingBracket || declarationBusy) return;
    let cancelled = false;
    let inFlight = false;
    let lastSync = 0;
    let realtimeConnected = false;
    let receivedSignal = false;
    let lastSignalAt = 0;
    let pendingRefresh = false;
    let pendingFresh = false;
    let channel = null;
    const refresh = async (fresh = false) => {
      if (cancelled || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const owner = localStorage.getItem(OWNER_KEY) || '';
        const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
        // Both registration and matches use the compact live projection.
        // Avatar images are requested separately only after roster changes.
        if (liveEtagRef.current) headers['If-None-Match'] = liveEtagRef.current;
        // Every 60 seconds read the actual live projection even if the
        // revision is unchanged. Ordinary polls transfer only a tiny version
        // field from Supabase and keep the existing 1-2 second schedule.
        const checkVersion = !fresh && Boolean(liveVersionRef.current && liveEtagRef.current) &&
          Date.now() - liveFullReadAtRef.current < 60000;
        if (checkVersion) headers['X-Tournament-Version'] = liveVersionRef.current;
        const url = `/api/tournaments?id=${encodeURIComponent(id)}&ownerToken=${encodeURIComponent(owner)}&view=live` + (fresh ? '&fresh=1' : '');
        const response = await fetch(url, { cache: 'no-store', headers });
        if (cancelled) return;
        if (response.status === 304) {
          const nextVersion = response.headers.get('x-tournament-version');
          if (nextVersion) liveVersionRef.current = nextVersion;
          if (!checkVersion) liveFullReadAtRef.current = Date.now();
          lastSync = Date.now();
          return;
        }
        if (!response.ok) return;
        const etag = response.headers.get('etag');
        if (etag) liveEtagRef.current = etag;
        liveVersionRef.current = response.headers.get('x-tournament-version') || '';
        liveFullReadAtRef.current = Date.now();
        const result = await response.json();
        if (!cancelled && result.tournament) {
          applyTournamentSnapshot(result.tournament);
          lastSync = Date.now();
        }
      } catch {} finally {
        inFlight = false;
        if (pendingRefresh && !cancelled) {
          pendingRefresh = false;
          const fresh = pendingFresh;
          pendingFresh = false;
          void refresh(fresh);
        }
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
        }, () => {
          receivedSignal = true;
          lastSignalAt = Date.now();
          // Signals must bypass the short-lived server cache to see new writes.
          if (inFlight) { pendingRefresh = true; pendingFresh = true; }
          else void refresh(true);
        });
        channel.subscribe(status => {
          realtimeConnected = status === 'SUBSCRIBED';
          if (status === 'SUBSCRIBED') void refresh();
        });
      } catch {
        realtimeConnected = false;
      }
    }
    // Active matches prioritize responsiveness. Overview and declarations use a
    // slower fallback, while change signals can refresh immediately.
    const activeMatch = Boolean(tournament.bracket && !tournament.bracket.complete);
    const ownMatch = tournament.bracket?.rounds?.flat().find(match =>
      !match.winnerId && match.player1 && match.player2 &&
      [match.player1, match.player2].some(player =>
        String(player.userId || player.id) === String(currentUserId))
    );
    const game = ownMatch?.matchState?.currentGame;
    // A chosen stage normally means players are in-game. Keep fast updates
    // during stage striking and result reporting, but reduce idle game traffic.
    const reportsPending = Boolean(game?.results && Object.keys(game.results).length);
    const playingGame = Boolean(ownMatch && game?.stage && !reportsPending);
    // A shared live scoreboard needs fresher reads than stage-strike turns.
    // Keep inactive viewers and traditional mid-game reports on slower polls
    // to avoid hammering Supabase as tournament participation grows.
    const liveSet = Boolean(ownMatch && !tournament.stageRejects &&
      getMatchReportMode(tournament, ownMatch) === 'set');
    const fallbackMs = liveSet ? 1500 : playingGame ? 5000
      : activeMatch && ownMatch ? 2000 : activeMatch ? 15000 : 30000;
    // Spread clients' periodic reads across a short window: a new round can
    // otherwise cause all players' browsers to hit the API at the same instant.
    const staggerMs = Math.floor(Math.random() * 500);
    let timer;
    const poll = () => {
      if (cancelled) return;
      // Only relax active polling after a real change signal was observed.
      // Unproven subscriptions, disconnected sockets and stale signals retain
      // the original fast fallback so match progression stays responsive.
      const signalHealthy = realtimeConnected && receivedSignal && Date.now() - lastSignalAt < 60000;
      const intervalMs = signalHealthy && ownMatch ? Math.max(fallbackMs, 10000) : fallbackMs;
      if (Date.now() - lastSync >= intervalMs) void refresh();
      timer = setTimeout(poll, Math.min(fallbackMs, intervalMs));
    };
    timer = setTimeout(poll, fallbackMs + staggerMs);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      if (channel) void getSupabaseBrowserClient().removeChannel(channel);
    };
  }, [id, Boolean(tournament), Boolean(tournament?.bracket), tournament?.bracket?.complete, tournament?.stageActionRevision, currentUserId, savingBracket, declarationBusy, accessToken]);

  // Prompt for character reporting as soon as each placement is decided.
  // Semifinal losers need not wait for the final match to finish.
  useEffect(() => {
    if (!tournament?.bracket || !currentUserId || loading) return;
    const player = (tournament.joinedPlayers || []).find(p => !p.isDemo && String(p.userId || p.id) === String(currentUserId));
    if (!player || tournament.characterDeclaration || tournament.characterReports?.[String(player.id)]) return;
    if (!getCharacterReportPlacement(tournament.bracket, player.id)) return;
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
        [match.player1, match.player2].some(player =>
          !player.isDemo && String(player.userId || player.id) === String(perspectiveId))
      );
      if (mi >= 0) {
        const ownMatch = round[mi];
        setActiveMatchId(ownMatch.id);
        if (!ownMatch.matchState && !autoStartAttemptRef.current.has(String(ownMatch.id))) {
          autoStartAttemptRef.current.add(String(ownMatch.id));
          performStageAction(ri, mi, 'start', {}, true);
        }
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
    // A bye applies only to an empty seed in round one.
    // A future-round card with one participant must wait for its other feeder.
    if (rounds.length > 1) {
      rounds[0].forEach((match, i) => {
        if (Boolean(match.player1) !== Boolean(match.player2)) {
          match.winnerId = (match.player1 || match.player2).id;
          rounds[1][Math.floor(i / 2)][i % 2 === 0 ? 'player1' : 'player2'] = match.player1 || match.player2;
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
    const next = { ...tournament, status: '対戦中', bracket: makeBracket(players), streamMatchId: undefined, streamMatchManual: false, resultPlacements: null };
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

  async function performStageAction(roundIndex, matchIndex, action, extra = {}, automatic = false) {
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
      if (!response.ok) {
        if (response.status === 409) {
          // A concurrent action may already have advanced the turn. Refresh
          // instead of blindly resubmitting a potentially stale action.
          const owner = localStorage.getItem(OWNER_KEY) || '';
          const latest = await fetch(`/api/tournaments?id=${encodeURIComponent(id)}&ownerToken=${encodeURIComponent(owner)}`, {
            cache: 'no-store', headers: { Authorization: `Bearer ${token}` },
          });
          if (latest.ok) {
            const snapshot = await latest.json();
            if (snapshot.tournament) applyTournamentSnapshot(snapshot.tournament);
          }
        }
        throw new Error(response.status === 409 ? '他の操作が先に反映されました。最新の状態を確認して操作してください。' : (result.error || '対戦操作に失敗しました。'));
      }
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
      if (automatic) {
        autoStartAttemptRef.current.delete(String(match.id));
        console.error('Automatic match initialization failed:', e);
        setNotice('対戦の準備に失敗しました。対戦画面の「準備を再試行」を押してください。');
      } else setError(e.message || '対戦操作に失敗しました。');
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
      // Never leave the scoreboard permanently locked on an unanswered POST.
      // Aborting locally does not prove the server did not save the vote.
      const reportController = new AbortController();
      const reportTimer = setTimeout(() => reportController.abort(), 18000);
      let response, body;
      try {
        response = await fetch('/api/tournaments/match-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id, matchId: match.id, gameNumber: match.matchState.gameNumber, result }),
          signal: reportController.signal,
        });
        body = await response.json();
      } finally { clearTimeout(reportTimer); }
      if (!response.ok) {
        if (response.status === 409) {
          // The other player may have advanced the game first. Refresh the
          // authoritative snapshot; never blindly replay a stale result.
          const owner = localStorage.getItem(OWNER_KEY) || '';
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 9000);
          try {
            const latest = await fetch(`/api/tournaments?id=${encodeURIComponent(id)}&ownerToken=${encodeURIComponent(owner)}&view=live`, {
              cache: 'no-store', headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
            });
            if (latest.ok) {
              const snapshot = await latest.json();
              if (snapshot.tournament) applyTournamentSnapshot(snapshot.tournament);
            }
          } finally { clearTimeout(timer); }
        }
        throw new Error(response.status === 409
          ? '他の報告が先に反映されました。最新の対戦状況を確認してください。'
          : (body.error || '報告を保存できませんでした。'));
      }
      // Preserve the current stream assignment if the result response omits it.\n      setTournament(prev => ({ ...body.tournament, isOwner: prev?.isOwner, streamMatchId: body.tournament.streamMatchId !== undefined ? body.tournament.streamMatchId : (prev?.streamMatchId ?? null), effectiveStreamMatchId: body.tournament.effectiveStreamMatchId !== undefined ? body.tournament.effectiveStreamMatchId : (body.tournament.streamMatchId !== undefined ? body.tournament.streamMatchId : (prev?.effectiveStreamMatchId ?? prev?.streamMatchId ?? null)) }));

    } catch (e) {
      if (e?.name === 'AbortError') {
        // A timed-out write can commit on the server: refresh once without
        // accidentally submitting a second identical vote.
        try {
          const { data } = await getSupabaseBrowserClient().auth.getSession();
          const owner = localStorage.getItem(OWNER_KEY) || '';
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          try {
            const latest = await fetch(`/api/tournaments?id=${encodeURIComponent(id)}&ownerToken=${encodeURIComponent(owner)}&view=live`, {
              cache: 'no-store', signal: controller.signal,
              headers: data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {},
            });
            if (latest.ok) {
              const snapshot = await latest.json();
              if (snapshot.tournament) applyTournamentSnapshot(snapshot.tournament);
            }
          } finally { clearTimeout(timer); }
        } catch {}
        setError('勝敗報告の通信が時間切れになりました。保存済みの可能性があるため、最新のスコアを確認してから操作してください。');
      } else setError(e.message || '勝敗報告に失敗しました。');
    } finally { setSavingBracket(false); }
  }

  // All no-strike result changes go through one server-validated API.
  // A timed-out POST may have committed, so never automatically submit twice.
  // Keep the short opponent-edit lock clock current on both devices.
  useEffect(() => {
    if (!tournament?.bracket || tournament.stageRejects || !activeMatchId) return;
    const timer = setInterval(() => setScoreClock(Date.now()), 500);
    return () => clearInterval(timer);
  }, [Boolean(tournament?.bracket), tournament?.stageRejects, activeMatchId]);

  // Score controls are optimistic and save a complete draft after rapid taps,
  // instead of disabling +/- for each network round-trip.
  function queueLiveScore(match, playerId, delta) {
    const mode = getMatchReportMode(tournament, match);
    if (!match || savingBracket || !currentUserId || (delta !== 1 && delta !== -1) ||
        match.winnerId || match.matchState?.pendingResult ||
        (mode === 'stream' ? !tournament?.isOwner : mode !== 'set') ||
        (mode === 'set' && scoreControlLockRemainingMs(match.matchState, currentUserId) > 0)) return;
    const currentDraft = scoreDraftRef.current;
    if (currentDraft && currentDraft.matchId !== String(match.id)) return;
    const serverVersion = Number(match.matchState?.scoreVersion || 0);
    const ack = scoreLastAckRef.current;
    const useAck = !currentDraft && ack?.matchId === String(match.id) &&
      Number(ack.version) > serverVersion;
    const scores = { ...(currentDraft?.scores ||
      (useAck ? ack.scores : editableSetScores(tournament, match))) };
    const version = currentDraft?.version ?? (useAck ? ack.version : serverVersion);
    const firstId = String(match.player1.id);
    const secondId = String(match.player2.id);
    const idToEdit = String(playerId);
    if (idToEdit !== firstId && idToEdit !== secondId) return;
    const target = Number(tournament.bestOf) === 5 ? 3 : 2;
    const next = Number(scores[idToEdit] || 0) + delta;
    if (!Number.isInteger(next) || next < 0 || next > target) return;
    scores[idToEdit] = next;
    if (scores[firstId] === target && scores[secondId] === target) return;
    const draft = { matchId: String(match.id), firstId, secondId, scores, version, mode };
    scoreDraftRef.current = draft;
    setScoreDraft(draft);
    setError('');
    clearTimeout(scoreFlushTimerRef.current);
    scoreFlushTimerRef.current = setTimeout(() => { void flushLiveScoreDraft(); }, 450);
  }

  async function flushLiveScoreDraft() {
    if (scoreSendingRef.current || !scoreDraftRef.current) return;
    const submitted = scoreDraftRef.current;
    scoreSendingRef.current = true;
    clearTimeout(scoreFlushTimerRef.current);
    scoreFlushTimerRef.current = null;
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('スコアの保存にはログインが必要です。');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      let saved;
      try {
        const response = await fetch('/api/tournaments/set-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({
            id, matchId: submitted.matchId,
            action: submitted.mode === 'stream' ? 'stream-score-set' : 'score-set',
            scoreFirst: submitted.scores[submitted.firstId],
            scoreSecond: submitted.scores[submitted.secondId],
            scoreVersion: submitted.version,
          }),
          signal: controller.signal,
        });
        saved = await response.json();
        if (!response.ok || !saved.scoreUpdate)
          throw new Error(saved.error || 'スコアを保存できませんでした。');
      } finally { clearTimeout(timeout); }
      const update = saved.scoreUpdate;
      scoreLastAckRef.current = {
        matchId: update.matchId, scores: update.liveScore,
        version: update.scoreVersion, mode: submitted.mode,
      };
      setTournament(prev => {
        if (!prev?.bracket?.rounds) return prev;
        const previousMatch = prev.bracket.rounds.flat().find(entry =>
          String(entry.id) === update.matchId);
        if (!previousMatch || Number(previousMatch.matchState?.scoreVersion || 0) > Number(update.scoreVersion))
          return prev;
        const next = {
          ...prev,
          stageActionRevision: Math.max(Number(prev.stageActionRevision || 0), Number(update.stageActionRevision || 0)),
          bracket: { ...prev.bracket, rounds: prev.bracket.rounds.map(round => round.map(entry =>
            String(entry.id) === update.matchId
              ? { ...entry, matchState: {
                  ...entry.matchState,
                  ...(submitted.mode === 'stream'
                    ? { streamLiveScore: update.liveScore }
                    : { liveScore: update.liveScore,
                        lastScoreActorId: update.lastScoreActorId,
                        lastScoreActionAt: update.lastScoreActionAt }),
                  scoreVersion: update.scoreVersion,
                } }
              : entry)) },
        };
        tournamentSnapshotRef.current = JSON.stringify(next);
        return next;
      });
      if (scoreDraftRef.current === submitted) {
        scoreDraftRef.current = null;
        setScoreDraft(null);
      } else if (scoreDraftRef.current?.matchId === submitted.matchId) {
        const nextDraft = { ...scoreDraftRef.current, version: update.scoreVersion };
        scoreDraftRef.current = nextDraft;
        setScoreDraft(nextDraft);
      }
    } catch (error) {
      // An aborted request may already have been committed. Never blindly
      // resend an unknown write; reconcile against the authoritative record.
      scoreDraftRef.current = null;
      setScoreDraft(null);
      setError(error?.name === 'AbortError'
        ? 'スコアの通信が時間切れになりました。最新のスコアを確認してください。'
        : error.message || 'スコアを保存できませんでした。');
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        const token = data.session?.access_token;
        const owner = localStorage.getItem(OWNER_KEY) || '';
        const response = await fetch('/api/tournaments?id=' + encodeURIComponent(id) +
          '&ownerToken=' + encodeURIComponent(owner) + '&view=live', {
          cache: 'no-store', headers: token ? { Authorization: 'Bearer ' + token } : {},
        });
        if (response.ok) {
          const result = await response.json();
          if (result.tournament) applyTournamentSnapshot(result.tournament);
        }
      } catch {}
    } finally {
      scoreSendingRef.current = false;
      if (scoreDraftRef.current) {
        clearTimeout(scoreFlushTimerRef.current);
        scoreFlushTimerRef.current = setTimeout(() => { void flushLiveScoreDraft(); }, 100);
      }
    }
  }

  useEffect(() => {
    // Keep edits when switching away from the browser/OBS.
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && scoreDraftRef.current) {
        clearTimeout(scoreFlushTimerRef.current);
        void flushLiveScoreDraft();
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      clearTimeout(scoreFlushTimerRef.current);
    };
  }, [id]);

  async function submitSetAction(match, action, extras = {}) {
    if (!match || savingBracket) return;
    setSavingBracket(true);
    setError('');
    setNotice('');
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('ログインが必要です。');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 18000);
      let savedResult = null;
      try {
        const response = await fetch('/api/tournaments/set-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ id, matchId: match.id, action, ...extras }),
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'スコアを保存できませんでした。');
        savedResult = body;
      } finally { clearTimeout(timer); }
      if (action === 'score-adjust' && savedResult?.scoreUpdate) {
        const update = savedResult.scoreUpdate;
        setTournament(prev => {
          if (!prev?.bracket?.rounds) return prev;
          const currentMatch = prev.bracket.rounds.flat().find(item => String(item.id) === update.matchId);
          if (!currentMatch || Number(currentMatch.matchState?.scoreVersion || 0) > Number(update.scoreVersion))
            return prev;
          const next = {
            ...prev,
            stageActionRevision: Math.max(Number(prev.stageActionRevision || 0), Number(update.stageActionRevision || 0)),
            bracket: {
              ...prev.bracket,
              rounds: prev.bracket.rounds.map(round => round.map(item =>
                String(item.id) === update.matchId ? {
                  ...item,
                  matchState: {
                    ...item.matchState, liveScore: update.liveScore,
                    scoreVersion: update.scoreVersion,
                    lastScoreActorId: update.lastScoreActorId,
                    lastScoreActionAt: update.lastScoreActionAt,
                  },
                } : item)),
            },
          };
          tournamentSnapshotRef.current = JSON.stringify(next);
          return next;
        });
        return;
      }
      const owner = localStorage.getItem(OWNER_KEY) || '';
      let matchFinished = false;
      const refreshController = new AbortController();
      const refreshTimer = setTimeout(() => refreshController.abort(), 10000);
      try {
        const response = await fetch('/api/tournaments?id=' + encodeURIComponent(id) +
          '&ownerToken=' + encodeURIComponent(owner) + '&view=live', {
          cache: 'no-store', headers: { Authorization: 'Bearer ' + token },
          signal: refreshController.signal,
        });
        if (response.ok) {
          const body = await response.json();
          if (body.tournament) {
            applyTournamentSnapshot(body.tournament);
            matchFinished = Boolean(body.tournament.bracket?.rounds?.flat().find(
              entry => String(entry.id) === String(match.id))?.winnerId);
          }
        }
      } finally { clearTimeout(refreshTimer); }
      if (action === 'stream-game') {
        setNotice('配信台のスコアを更新しました。');
        // Keep the score-management dialog open between games so the
        // organizer can record the next game with one tap.
        if (matchFinished) setAdminMatchSelection(null);
      } else if (action === 'score-adjust') {
        // A provisional score update never finalizes a match.
        setNotice('');
      } else if (action === 'stream-confirm') {
        setNotice('配信台の結果を確定しました。');
        setAdminMatchSelection(null);
      } else if (action === 'submit') setNotice('結果を申告しました。相手の確認を待っています。');
      else if (action === 'dispute') setNotice('結果に異議を出しました。相手に再入力を依頼してください。');
      else { setNotice('対戦結果を確定しました。'); setAdminMatchSelection(null); }
    } catch (e) {
      setError(e?.name === 'AbortError'
        ? '通信が時間切れになりました。保存されている可能性があるため、スコアを確認してから再操作してください。'
        : e.message || 'スコアを保存できませんでした。');
    } finally { setSavingBracket(false); }
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
    const isStreamResult = Boolean(match.winnerId) && String(tournament.streamMatchId ?? tournament.effectiveStreamMatchId ?? '') === String(match.id);
    const streamHold = isStreamResult ? { streamHoldMatchId: match.id, streamHoldUntil: new Date(Date.now() + 60000).toISOString() } : {};
    const next = { ...tournament, ...streamHold, bracket, status: bracket.complete ? '終了' : '対戦中', resultPlacements: bracket.complete ? bracketPlacements(bracket) : null, completedAt: bracket.complete ? new Date().toISOString() : null };
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

  async function correctMatchScore(match) {
    if (!tournament?.isOwner || savingBracket || !match?.player1 || !match?.player2) return;
    const first = Number(adminScore.first), second = Number(adminScore.second);
    const target = Number(tournament.bestOf) === 5 ? 3 : 2;
    if (!Number.isInteger(first) || !Number.isInteger(second) ||
        first < 0 || second < 0 || first > target || second > target ||
        (first === target && second === target)) {
      setError('BO形式に合うスコアを指定してください。');
      return;
    }
    if (!window.confirm(`${match.player1.name} ${first} - ${second} ${match.player2.name} に修正しますか？\nこの試合のステージ選択・勝敗報告は再設定されます。勝者が変わった場合、関係する後続の結果も更新されます。`)) return;
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
        body: JSON.stringify({ id, matchId: match.id, action: 'score', firstScore: first, secondScore: second, ownerToken: ownerId }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          await loadTournament();
        }
        throw new Error(result.error || 'スコアを修正できませんでした。');
      }
      applyTournamentSnapshot(result.tournament);
      setAdminMatchSelection(null);
      setShowScoreEditor(false);
      setShowForfeitChoices(false);
      setActiveMatchId('');
      setNotice('スコアを修正しました。');
    } catch (error) {
      setError(error.message || 'スコアを修正できませんでした。');
    } finally {
      setSavingBracket(false);
    }
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
      setTournament(prev => ({ ...result.tournament, overlayOwnerId: prev?.overlayOwnerId, effectiveStreamMatchId: matchId }));
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

  // Keep ordinary links clean. X caches link previews by the shared URL,
  // so use a stable version of the visible OG details for the X share button.
  // Bump the og6 prefix when the OG image layout changes again.
  const tournamentShareUrl = (forX = false) => {
    const url = 'https://figure-tournament.vercel.app/tournaments/' + encodeURIComponent(id);
    if (!forX) return url;
    const details = JSON.stringify([
      tournament?.name, tournament?.date, tournament?.format, tournament?.bestOf,
      tournament?.stageRejects, tournament?.stageSettings, tournament?.stages,
    ]);
    let hash = 2166136261;
    for (let i = 0; i < details.length; i += 1) {
      hash = Math.imul(hash ^ details.charCodeAt(i), 16777619);
    }
    return url + '?v=og6-' + (hash >>> 0).toString(36);
  };
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
  const streamMatchId = tournament.effectiveStreamMatchId !== undefined ? tournament.effectiveStreamMatchId : (tournament.streamMatchId ?? null);

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
          const liveDisplay = !tournament.stageRejects
            ? (scoreDraft?.matchId === String(match.id)
                ? scoreDraft.scores : editableSetScores(tournament, match))
            : state?.score || {};
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
          const canActFor = id => String(id) === String(viewingPlayerId);
          const waitingFor = id => <p className="setting-help match-turn-waiting">{[match.player1,match.player2].find(p => String(p.id) === String(id))?.name || '相手'} の入力を待っています…</p>;
          return <section className={`bracket-panel match-controls-below${String(streamMatchId) === String(match.id) ? " match-controls-streaming" : ""}`} aria-label="対戦操作">
            {String(streamMatchId) === String(match.id) && <div className="match-stream-announcement"><strong>● 配信台の対戦</strong><span>配信台に入室して試合を進めてください。</span></div>}

            <div className="game-top">
              <div className="current-score">{liveDisplay[p1Id] || 0}<span> - </span>{liveDisplay[match.player2.id] || 0}</div>
            </div>
            <div className="player-strip">
              <div><small>PLAYER 1</small><a href={`/stats?player=${encodeURIComponent(match.player1.name)}`} className="match-player-stats-link">{match.player1.name}</a></div>
              <div><small>PLAYER 2</small><a href={`/stats?player=${encodeURIComponent(match.player2.name)}`} className="match-player-stats-link">{match.player2.name}</a></div>
            </div>
            {(() => {
              const isStreaming = String(streamMatchId) === String(match.id);
              const opponent = [match.player1, match.player2].find(player => String(player.id) !== String(viewingPlayerId));
              const code = isStreaming ? '' : opponent?.friendCode;
              return code ? <div className="match-opponent-friend-code"><span>対戦相手のフレンドコード</span><strong>{code}</strong></div> : null;
            })()}
            {!tournament.stageRejects ? (() => {
              const mode = getMatchReportMode(tournament, match);
              const pending = state?.pendingResult;
              const meId = String(currentUserId || '');
              const isMyPending = pending && String(pending.submittedBy) === meId;
              const target = Number(tournament.bestOf) === 5 ? 3 : 2;
              const live = scoreDraft?.matchId === String(match.id)
                ? scoreDraft.scores : editableSetScores(tournament, match);
              const firstScore = live[match.player1.id];
              const secondScore = live[match.player2.id];
              const lockRemaining = scoreControlLockRemainingMs(state, currentUserId, scoreClock);
              const lockedByOther = lockRemaining > 0;
              const lockSeconds = Math.ceil(lockRemaining / 1000);
              const unsavedScore = scoreDraft?.matchId === String(match.id);
              const editFirst = next => queueLiveScore(match, match.player1.id, next > firstScore ? 1 : -1);
              const editSecond = next => queueLiveScore(match, match.player2.id, next > secondScore ? 1 : -1);
              if (mode === 'stream') return <div className="set-score-pending">
                {isOwner ? <>
                  <MatchScoreEditor
                    firstName={match.player1.name} secondName={match.player2.name}
                    firstScore={firstScore} secondScore={secondScore}
                    target={target} onFirstChange={editFirst} onSecondChange={editSecond}
                    disabled={savingBracket}
                    disableFirstIncrease={secondScore === target && firstScore >= target - 1}
                    disableSecondIncrease={firstScore === target && secondScore >= target - 1}
                    hideNames/>
                  <button type="button" className="set-score-primary" disabled={savingBracket || unsavedScore ||
                    !((firstScore === target && secondScore < target) ||
                      (secondScore === target && firstScore < target))}
                    onClick={() => {
                      if (window.confirm(match.player1.name + ' ' + firstScore + ' - ' +
                        secondScore + ' ' + match.player2.name + ' の結果を確定しますか？')) {
                        submitSetAction(match, 'stream-confirm', {
                          scoreFirst: firstScore, scoreSecond: secondScore,
                          scoreVersion: Number(scoreLastAckRef.current?.matchId === String(match.id)
                            ? Math.max(Number(state?.scoreVersion || 0), Number(scoreLastAckRef.current.version))
                            : Number(state?.scoreVersion || 0)),
                        });
                      }
                    }}>{unsavedScore ? '保存中…' : '結果を確定'}</button>
                </> : <p style={{ marginTop: 8, marginBottom: 0 }}>
                  配信台のスコアは主催者が入力します。
                </p>}
              </div>;
              if (!state) return <div className="set-score-pending">
                <p className="setting-help">対戦を準備しています…</p>
                <button type="button" disabled={savingBracket} onClick={() => startMatch(ri, mi)}>準備を再試行</button>
              </div>;
              if (pending) return <div className="set-score-pending" role="status">
                <h3 className="match-result-heading">セット結果の確認</h3>
                <MatchScoreEditor
                  firstName={match.player1.name} secondName={match.player2.name}
                  firstScore={pending.firstScore} secondScore={pending.secondScore}
                  target={target} readOnly />
                {isMyPending
                  ? <p>結果を申告しました。相手選手の確認を待っています。</p>
                  : <><p>相手から申告された結果を確認してください。</p>
                    <div className="set-score-pending-actions">
                      <button type="button" className="bracket-admin-reset" disabled={savingBracket}
                        onClick={() => submitSetAction(match, 'dispute')}>結果が違う</button>
                      <button type="button" disabled={savingBracket}
                        onClick={() => submitSetAction(match, 'confirm')}>承認する</button>
                    </div></>}
              </div>;
              return <div className="set-score-pending">
                {state.disputedAt && <p className="form-error">申告に異議がありました。正しい結果を再入力してください。</p>}
                <MatchScoreEditor
                  firstName={match.player1.name} secondName={match.player2.name}
                  firstScore={firstScore} secondScore={secondScore}
                  target={target} onFirstChange={editFirst} onSecondChange={editSecond}
                  disabled={savingBracket || lockedByOther}
                  disableFirstIncrease={secondScore === target && firstScore >= target - 1}
                  disableSecondIncrease={firstScore === target && secondScore >= target - 1}
                  hideNames/>
                <button type="button" className="set-score-primary" disabled={savingBracket || unsavedScore ||
                  !((firstScore === target && secondScore < target) ||
                    (secondScore === target && firstScore < target))}
                  onClick={() => {
                    if (window.confirm(match.player1.name + ' ' + firstScore + ' - ' +
                      secondScore + ' ' + match.player2.name + ' で申告しますか？')) {
                      submitSetAction(match, 'submit', { firstScore, secondScore });
                    }
                  }}>{unsavedScore ? '保存中…' : 'このスコアを申告'}</button>
              </div>;
            })() : <>
            {state && <div className="match-next-action" role="status" aria-live="polite">
              {!game?.stage
                ? <><strong>{rejectsDone ? (canActFor(chooserId) ? 'あなたの番：ステージを選択' : '相手のステージ選択待ち') : (canActFor(rejectTurnId) ? 'あなたの番：ステージを拒否' : '相手のステージ拒否待ち')}</strong><span>第{state.gameNumber}ゲーム</span></>
                : <><strong>{game?.results?.[String(viewingPlayerId)] ? '報告済み：相手の報告を待っています' : '試合後に勝敗を報告してください'}</strong><span>第{state.gameNumber}ゲーム</span></>}
            </div>}
            {!state ? <div><p className="setting-help">対戦を準備しています…</p><button type="button" className="submit" disabled={savingBracket} onClick={() => startMatch(ri, mi)}>準備を再試行</button></div> : <>
              {!game?.stage ? <>
                {rejectsDone ? (canActFor(chooserId) ? <>
                  <p className="setting-help">{[match.player1,match.player2].find(p=>p?.id===chooserId)?.name || 'プレイヤー'} がステージを選択</p>
                  <div className="stage-grid">{available.map(stage => <button key={stage} type="button" className={stageSelection===stage?'stage selected':'stage'} onClick={()=>setStageSelection(stage)}>{stage}</button>)}</div>
                  <button className="submit" type="button" disabled={!stageSelection || savingBracket} onClick={() => { const chosen = stageSelection; setStageSelection(''); chooseMatchStage(ri,mi,chosen); }}>このステージに決定</button>
                </> : waitingFor(chooserId)) : (canActFor(rejectTurnId) ? <>
                  <p className="setting-help">ステージ拒否：{[match.player1,match.player2].find(p=>p?.id===rejectTurnId)?.name || 'プレイヤー'}（{state.gameNumber===1 ? (rejectTurnId===firstId ? settings.firstPlayerRejects??1 : settings.secondPlayerRejects??2) : Math.max(0,Number(settings.laterRejects??3)-(game?.rejects?.length||0))}個選択）</p>
                  <div className="stage-grid">{available.map(stage => <button key={stage} type="button" className={rejectSelection.includes(stage)?'stage selected':'stage'} disabled={rejectSelection.length >= (state.gameNumber===1 ? Number(rejectTurnId===firstId ? settings.firstPlayerRejects??1 : settings.secondPlayerRejects??2) : Math.max(0,Number(settings.laterRejects??3)-(game?.rejects?.length||0))) && !rejectSelection.includes(stage)} onClick={()=>setRejectSelection(old=>old.includes(stage)?old.filter(s=>s!==stage):[...old,stage])}>{stage}</button>)}</div>
                  <button className="submit" type="button" disabled={savingBracket} onClick={() => rejectMatchStages(ri,mi,rejectTurnId,rejectSelection)}>拒否を確定</button>
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
        <p className="setting-help">{tournament.stageRejects
        ? '設定されたBO形式・使用ステージ・拒否数に従い、ゲームごとに両選手が勝敗を報告します。'
        : '通常対戦は片方が結果を申告し、相手が承認すると確定します。配信台は主催者がスコアを入力して確定します。'}</p>
        {isOwner && <div className="bracket-admin-hint">主催者：対戦カードを選択すると、結果のリセット・不戦勝・配信台の設定ができます。</div>}
        {isOwner && selectedAdminMatch && <div className="bracket-admin-modal-backdrop" onClick={() => { if (!savingBracket) { setAdminMatchSelection(null); setShowForfeitChoices(false); } }}><section className="bracket-admin-panel bracket-admin-modal" role="dialog" aria-modal="true" aria-label="主催者の対戦管理" onClick={event => event.stopPropagation()}>
          <div className="bracket-admin-heading">
            <strong>選択中：{selectedAdminMatch.player1?.name || '未定'} VS {selectedAdminMatch.player2?.name || '未定'}</strong>
            <button type="button" onClick={() => { setAdminMatchSelection(null); setShowForfeitChoices(false); }}>閉じる ×</button>
          </div>
          {!canEditAdminMatch ? <p>両方の対戦相手が決まると操作できます。</p> : <>
            <div className="bracket-admin-actions">
              {selectedAdminMatch.winnerId || selectedAdminMatch.matchState ? <button type="button" className="bracket-admin-reset" disabled={savingBracket} onClick={() => administerMatch(selectedAdminMatch, 'reset')}>結果をリセット</button> : null}
              {!selectedAdminMatch.winnerId && <button type="button" disabled={savingBracket} onClick={() => setShowForfeitChoices(value => !value)}>{showForfeitChoices ? '不戦勝設定を閉じる' : '不戦勝にする'}</button>}
              {String(streamMatchId) === String(selectedAdminMatch.id) ? <button type="button" disabled={savingBracket} onClick={() => setStreamMatch(null)}>配信台を解除</button> : !selectedAdminMatch.winnerId ? <button type="button" disabled={savingBracket} onClick={() => setStreamMatch(selectedAdminMatch.id)}>配信台に設定</button> : null}
            </div>
            <div className="bracket-admin-actions" style={{ marginTop: 10 }}>
              <button type="button" disabled={savingBracket} onClick={() => {
                if (showScoreEditor) {
                  setShowScoreEditor(false);
                } else {
                  setAdminScore({
                    first: Number(selectedAdminMatch.matchState?.liveScore?.[selectedAdminMatch.player1.id] ?? selectedAdminMatch.matchState?.score?.[selectedAdminMatch.player1.id] ?? 0),
                    second: Number(selectedAdminMatch.matchState?.liveScore?.[selectedAdminMatch.player2.id] ?? selectedAdminMatch.matchState?.score?.[selectedAdminMatch.player2.id] ?? 0),
                  });
                  setShowForfeitChoices(false);
                  setShowScoreEditor(true);
                }
              }}>{showScoreEditor ? 'スコア修正を閉じる' : 'スコアを修正'}</button>
            </div>
            {showScoreEditor && <div className="bracket-admin-forfeit" style={{ marginTop: 10 }}>
              <p>試合のスコアを入力してください（BO{Number(tournament.bestOf) === 5 ? 5 : 3}）。</p>
              <MatchScoreEditor
                firstName={selectedAdminMatch.player1.name} secondName={selectedAdminMatch.player2.name}
                firstScore={adminScore.first} secondScore={adminScore.second}
                target={Number(tournament.bestOf) === 5 ? 3 : 2}
                onFirstChange={first => setAdminScore(prev => ({ ...prev, first }))}
                onSecondChange={second => setAdminScore(prev => ({ ...prev, second }))}
                disabled={savingBracket} />
              <p style={{ fontSize: 12 }}>勝利本数に達すると勝者を確定します。修正するとこの試合のステージ・報告状況はリセットされます。</p>
              <button type="button" disabled={savingBracket || adminScore.first === '' || adminScore.second === ''}
                onClick={() => correctMatchScore(selectedAdminMatch)}>{savingBracket ? '保存中…' : 'スコアを保存'}</button>
            </div>}
            {!tournament.stageRejects && getMatchReportMode(tournament, selectedAdminMatch) === 'stream' &&
              !selectedAdminMatch.winnerId && (() => {
                const target = Number(tournament.bestOf) === 5 ? 3 : 2;
                const unsaved = scoreDraft?.matchId === String(selectedAdminMatch.id);
                const scores = unsaved ? scoreDraft.scores : editableSetScores(tournament, selectedAdminMatch);
                const first = Number(scores[selectedAdminMatch.player1.id] || 0);
                const second = Number(scores[selectedAdminMatch.player2.id] || 0);
                const serverVersion = Number(selectedAdminMatch.matchState?.scoreVersion || 0);
                const version = scoreLastAckRef.current?.matchId === String(selectedAdminMatch.id)
                  ? Math.max(serverVersion, Number(scoreLastAckRef.current.version))
                  : serverVersion;
                return <div className="set-score-pending">
                  <strong>配信台のスコアを入力</strong>
                  <MatchScoreEditor
                    firstName={selectedAdminMatch.player1.name} secondName={selectedAdminMatch.player2.name}
                    firstScore={first} secondScore={second} target={target}
                    onFirstChange={next => queueLiveScore(selectedAdminMatch, selectedAdminMatch.player1.id, next > first ? 1 : -1)}
                    onSecondChange={next => queueLiveScore(selectedAdminMatch, selectedAdminMatch.player2.id, next > second ? 1 : -1)}
                    disabled={savingBracket}
                    disableFirstIncrease={second === target && first >= target - 1}
                    disableSecondIncrease={first === target && second >= target - 1}
                    hideNames />
                  <button type="button" className="set-score-primary"
                    disabled={savingBracket || unsaved ||
                      !((first === target && second < target) || (second === target && first < target))}
                    onClick={() => {
                      if (window.confirm(selectedAdminMatch.player1.name + ' ' + first + ' - ' +
                        second + ' ' + selectedAdminMatch.player2.name + ' の結果を確定しますか？')) {
                        submitSetAction(selectedAdminMatch, 'stream-confirm', {
                          scoreFirst: first, scoreSecond: second, scoreVersion: version,
                        });
                      }
                    }}>{unsaved ? '保存中…' : '結果を確定'}</button>
                </div>;
              })()}
            {!tournament.stageRejects && getMatchReportMode(tournament, selectedAdminMatch) === 'set' &&
              selectedAdminMatch.matchState?.pendingResult && <div className="set-score-pending">
                <strong>セット結果・確認待ち</strong>
                <MatchScoreEditor
                  firstName={selectedAdminMatch.player1.name} secondName={selectedAdminMatch.player2.name}
                  firstScore={selectedAdminMatch.matchState.pendingResult.firstScore}
                  secondScore={selectedAdminMatch.matchState.pendingResult.secondScore}
                  target={Number(tournament.bestOf) === 5 ? 3 : 2} readOnly />
                <p className="setting-help">相手の確認待ちです。進行が止まった場合のみ、結果を確認して代理確定してください。</p>
                <button type="button" disabled={savingBracket}
                  onClick={() => window.confirm('主催者としてこのセット結果を代理確定しますか？') &&
                    submitSetAction(selectedAdminMatch, 'owner-confirm')}>主催者が代理確定</button>
              </div>}
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
          const isOwnMatch = [match.player1, match.player2].some(player =>
            player && !player.isDemo && String(player.userId || player.id) === String(currentUserId));
          const canStartMatch = !state && (isOwner || isOwnMatch) && match.player1 && match.player2 && !match.winnerId && !tournament.bracket.complete;
          const canSelect = isOwner || canStartMatch;
          const handleSelect = () => {
            if (isOwner) { setAdminMatchSelection({ roundIndex: ri, matchIndex: mi }); setShowForfeitChoices(false); setShowScoreEditor(false); }
            else if (canStartMatch) startMatch(ri, mi);
          };
          const isAdminSelected = isOwner && adminMatchSelection?.roundIndex === ri && adminMatchSelection?.matchIndex === mi;
          const isStreamMatch = String(streamMatchId) === String(match.id);
          if (ri === 0 && Boolean(match.player1) !== Boolean(match.player2)) return <div key={match.id} className="bracket-bye-spacer" style={{ top: `${64 + (((mi + 0.5) * (2 ** ri)) - 0.5) * 104}px` }} aria-hidden="true" />;
          return <div className={`bracket-match${canSelect ? ' match-startable' : ''}${isAdminSelected ? ' match-admin-selected' : ''}${isStreamMatch ? ' match-streaming' : ''}`} style={{ top: `${64 + (((mi + 0.5) * (2 ** ri)) - 0.5) * 104}px` }} key={match.id} onClick={canSelect ? handleSelect : undefined} role={canSelect ? "button" : undefined} tabIndex={canSelect ? 0 : undefined} aria-label={canSelect ? `${match.player1?.name || '未定'} 対 ${match.player2?.name || '未定'}の${isOwner ? '管理メニュー' : '対戦画面'}を開く` : undefined} onKeyDown={canSelect ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSelect(); } } : undefined}>
            
            {isStreamMatch && <span className="bracket-stream-badge">● 配信台</span>}
            <div className="match-players">{[match.player1, match.player2].map((player, pi) => <div key={pi} className={"match-player-line" + (!player ? " empty-player-line" : "") + (match.player1 && match.player2 && match.winnerId === player?.id ? " winner-line" : "") + (match.winnerId && match.winnerId !== player?.id ? " loser-line" : "")}><span title={player?.name || ""}>{(ri === 0 || tournament.bracket.rounds[ri - 1]?.[mi * 2 + pi]?.winnerId) ? (player?.name || "") : ""}{(ri === 0 || tournament.bracket.rounds[ri - 1]?.[mi * 2 + pi]?.winnerId) && player?.isDemo ? "（デモ）" : ""}</span><strong className={"player-score" + (match.player1 && match.player2 && match.winnerId === player?.id ? " score-winner" : "")}>{player ? (match.resultType === 'forfeit' ? (String(match.winnerId) === String(player.id) ? 'W' : '—') : (match.player1 && match.player2 ? ((!tournament.stageRejects && !match.winnerId
              ? (scoreDraft?.matchId === String(match.id)
                ? scoreDraft.scores : editableSetScores(tournament, match))
              : state?.score || {})[player.id] ?? 0) : '')) : ""}</strong></div>)}</div>


            {ri < tournament.bracket.rounds.length - 1 && mi % 2 === 0 && mi + 1 < round.length && (() => {
              const next = round[mi + 1];
              const nextVisible = !(ri === 0 && Boolean(next.player1) !== Boolean(next.player2));
              const distance = 104 * (2 ** ri);
              return <svg className="bracket-connector" width="38" height={distance} viewBox={`0 0 38 ${distance}`} aria-hidden="true"><path d={nextVisible ? `M 0 0 H 19 V ${distance} M 19 ${distance / 2} H 38` : `M 0 0 H 19 V ${distance / 2} H 38`} fill="none" stroke="#3170b8" strokeWidth="2" /></svg>;
            })()}
            {ri < tournament.bracket.rounds.length - 1 && mi % 2 === 1 && !(ri === 0 && Boolean(round[mi - 1]?.player1) !== Boolean(round[mi - 1]?.player2)) && <svg className="bracket-connector" width="19" height="2" viewBox="0 0 19 2" aria-hidden="true"><path d="M 0 1 H 19" fill="none" stroke="#3170b8" strokeWidth="2" /></svg>}
            {ri < tournament.bracket.rounds.length - 1 && mi % 2 === 1 && ri === 0 && Boolean(round[mi - 1]?.player1) !== Boolean(round[mi - 1]?.player2) && <svg className="bracket-connector bracket-connector-up" width="38" height="104" viewBox="0 0 38 104" aria-hidden="true"><path d="M 0 104 H 19 V 52 H 38" fill="none" stroke="#3170b8" strokeWidth="2" /></svg>}
          </div>;
        })}</div>)}</div>


        {isOwner && tournament.bracket.complete && <button type="button" onClick={() => window.confirm('トーナメント表をリセットしますか？順位結果も消えます。') && saveBracket({ ...tournament, status: '募集中', bracket: null, resultPlacements: null, completedAt: null })}>トーナメントをリセット</button>}
      </section>}

    {tournament.bracket && !tournament.bracket.complete && !tournament.characterDeclaration && (() => {
      const reportingPlayer = joinedPlayers.find(p => !p.isDemo && String(p.userId || p.id) === String(currentUserId));
      const canReport = Boolean(reportingPlayer && getCharacterReportPlacement(tournament.bracket, reportingPlayer.id));
      if (!canReport && !isOwner) return null;
      return <div className="tournament-report-action">
        {canReport && <a className="button-link" href={`/tournaments/${encodeURIComponent(id)}/report`}>キャラ報告を入力・編集</a>}
        {isOwner && <a className="button-link" href={`/tournaments/${encodeURIComponent(id)}/reports`}>キャラ報告を見る</a>}
      </div>;
    })()}
    {(!tournament.bracket || showTournamentOverview) && tournament.bracket?.complete && <><section className="create-panel tournament-results-card"><h2>大会結果</h2><div className="tournament-results-list">{(tournament.resultPlacements || bracketPlacements(tournament.bracket)).filter(row => ['優勝','準優勝','3位','ベスト4'].includes(row.place)).map(row => { const player = joinedPlayers.find(p => String(p.id) === String(row.playerId)); return player ? <div className="tournament-result-item" key={String(row.playerId)}><strong>{row.place === 'ベスト4' ? '3位' : row.place}</strong><span>{player.name}</span></div> : null; })}</div></section><div className="tournament-report-action">{!tournament.characterDeclaration && joinedPlayers.some(p => !p.isDemo && String(p.userId || p.id) === String(currentUserId)) && <a className="button-link" href={`/tournaments/${encodeURIComponent(id)}/report`}>キャラ報告を編集</a>}{isOwner && !tournament.characterDeclaration && <a className="button-link" href={`/tournaments/${encodeURIComponent(id)}/reports`}>キャラ報告を見る</a>}</div></>}
    {(!tournament.bracket || showTournamentOverview) && <div className="tournament-bottom-grid">
    <section className="create-panel tournament-detail" id="tournament-overview">
      <div className="tournament-card-top"><h2>大会概要</h2></div>
      <div className="overview-actions">
        {isOwner && !tournament.bracket && tournament.declarationPhase !== 'collecting' && <button className="submit overview-start-button" type="button" onClick={startBracket} disabled={savingBracket || joinedPlayers.length < 2}>{tournament.declarationPhase === 'published' ? 'トーナメント表へ' : '大会を開始する'}</button>}
        {tournament.bracket && <button className="overview-bracket-button" type="button" onClick={() => { setShowTournamentOverview(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>トーナメント表へ</button>}
        {isOwner && !tournament.bracket && <a className="button-link overview-edit-link" href={`/tournaments/new?edit=${encodeURIComponent(id)}`}>編集</a>}
        {!tournament.bracket && !joinedPlayers.some(player => String(player.userId || player.id) === String(currentUserId)) && (
          joinedPlayers.length >= Number(tournament.participants || 8)
            ? <p className="setting-help overview-join-status">定員に達しています。</p>
            : <form className="overview-join-form" onSubmit={joinTournament}>
                {!savedFriendCode && <label>フレンドコード（必須）<input value={joinFriendCode} onChange={event => setJoinFriendCode(event.target.value.toUpperCase())} placeholder="SW-0000-0000-0000" pattern="[A-Za-z0-9-]+" title="英数字とハイフンのみ" required /></label>}
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="submit" type="submit">参加登録する</button>
              </form>
        )}
        {!tournament.bracket && joinedPlayers.some(player => String(player.userId || player.id) === String(currentUserId)) && <p className="setting-help overview-join-status">参加済み</p>}
        <a className="button-link overview-share-x" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(tournament.name + '\n' + tournamentShareUrl(true))}`} target="_blank" rel="noopener noreferrer">Xに投稿する</a>
      </div>

      <div className="detail-grid">
        <div><span>対戦形式</span><strong>{tournament.format || `BO${tournament.bestOf || 3}`}</strong></div>
        <div><span>参加人数</span><strong>{joinedPlayers.length}/{tournament.participants || 8}人</strong></div>
        <div><span>開始時刻</span><strong>{tournament.date ? `${tournament.date.slice(0, 10).replaceAll('-', '/')} ${tournament.date.slice(11, 16)}` : '未設定'}</strong></div>
        <div><span>拒否ステージ</span><strong>{tournament.stageRejects ? 'あり' : 'なし'}</strong></div>
      </div>
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
      {/^https?:\/\//i.test(tournament.streamUrl || '') && <div className="overview-stream-link"><span>配信先</span><a href={tournament.streamUrl} target="_blank" rel="noopener noreferrer">{tournament.streamUrl}</a></div>}
      <h3>大会説明</h3>
      <p className="generated-description">{(tournament.description || '大会の詳細設定をご確認ください。').replace(/\\n|\/n/g, '\n')}</p>

    </section>
    <section className="create-panel tournament-detail participant-side-panel">
      <h2 className="participant-section-heading">参加者（{joinedPlayers.length}/{tournament.participants || 8}人）</h2>
      {joinedPlayers.length ? <ul className="joined-player-list">{joinedPlayers.map(player => <li key={player.id}><span className="participant-name-with-avatar"><span className="participant-avatar-square">{tournament.participantAvatars?.[String(player.userId || player.id)] ? <img src={tournament.participantAvatars[String(player.userId || player.id)]} alt="" /> : null}</span><a href={`/players/${encodeURIComponent(player.userId || player.id)}?name=${encodeURIComponent(player.name)}`} className="participant-history-link">{player.name}</a></span>{!tournament.bracket && (isOwner ? <button type="button" onClick={() => leaveTournament(player.id)}>登録を削除</button> : !player.isDemo && String(player.userId || player.id) === String(currentUserId) ? <button type="button" onClick={withdrawTournament}>参加を解除</button> : null)}</li>)}</ul> : <p className="setting-help">まだ参加者はいません。</p>}
    </section>
    </div>}
    {isOwner && (!tournament.bracket || showTournamentOverview) && <div className="tournament-delete-section"><button className="danger-button" type="button" onClick={deleteTournament}>この大会を削除</button></div>}
  </main>;
}
