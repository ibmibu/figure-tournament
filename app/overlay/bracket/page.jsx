'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowserClient } from '../../../lib/supabase/client';

const WIDTH = 1920;
const HEIGHT = 1080;
const CARD_WIDTH = 268;
const ROUND_GAP = 38;
const STEP = 104;

function roundName(index, total) {
  return index === total - 1 ? '決勝'
    : index === total - 2 ? '準決勝' : `第${index + 1}回戦`;
}

function MatchCard({ match, rounds, round, matchIndex }) {
  const { player1, player2, winnerId, resultType } = match;
  const bye = round === 0 && Boolean(player1) !== Boolean(player2);
  const top = 64 + (((matchIndex + 0.5) * (2 ** round)) - 0.5) * STEP;
  if (bye) return <div className="bracket-bye-spacer" style={{ top }} aria-hidden="true" />;

  const isWinner = player => player && winnerId != null &&
    String(player.id) === String(winnerId);
  const isLoser = player => player && winnerId != null && !isWinner(player);
  const showName = (side) => round === 0 ||
    Boolean(rounds[round - 1]?.[matchIndex * 2 + side]?.winnerId);
  const isLastRound = round === rounds.length - 1;
  const siblings = rounds[round] || [];
  return <div className="bracket-match"
    style={{ top }} aria-label={[player1?.name || '未定', player2?.name || '未定'].join(' 対 ')}>
    <div className="match-players">
      {[player1, player2].map((player, side) =>
        <div key={side}
          className={`match-player-line${!player ? ' empty-player-line' : ''}${isWinner(player) ? ' winner-line' : ''}${isLoser(player) ? ' loser-line' : ''}`}>
          <span title={showName(side) ? (player?.name || '') : ''}>
            {showName(side) && player ? player.name + (player.isDemo ? '（デモ）' : '') : ''}
          </span>
          <strong className={`player-score${isWinner(player) ? ' score-winner' : ''}`}>
            {player ? (resultType === 'forfeit'
              ? (isWinner(player) ? 'W' : '—')
              : player1 && player2 ? (side === 0 ? match.score1 : match.score2) : '') : ''}
          </strong>
        </div>)}
    </div>
    {!isLastRound && matchIndex % 2 === 0 && matchIndex + 1 < siblings.length && (() => {
      const next = siblings[matchIndex + 1];
      const nextVisible = !(round === 0 && Boolean(next.player1) !== Boolean(next.player2));
      const distance = STEP * (2 ** round);
      return <svg className="bracket-connector" width="38" height={distance}
        viewBox={`0 0 38 ${distance}`} aria-hidden="true">
        <path d={nextVisible
          ? `M 0 0 H 19 V ${distance} M 19 ${distance / 2} H 38`
          : `M 0 0 H 19 V ${distance / 2} H 38`}
          fill="none" stroke="#DCEBFF" strokeWidth="2" />
      </svg>;
    })()}
    {!isLastRound && matchIndex % 2 === 1 &&
      !(round === 0 && Boolean(siblings[matchIndex - 1]?.player1) !== Boolean(siblings[matchIndex - 1]?.player2)) &&
      <svg className="bracket-connector" width="19" height="2" viewBox="0 0 19 2" aria-hidden="true">
        <path d="M 0 1 H 19" fill="none" stroke="#DCEBFF" strokeWidth="2" />
      </svg>}
    {!isLastRound && matchIndex % 2 === 1 && round === 0 &&
      Boolean(siblings[matchIndex - 1]?.player1) !== Boolean(siblings[matchIndex - 1]?.player2) &&
      <svg className="bracket-connector bracket-connector-up" width="38" height="104"
        viewBox="0 0 38 104" aria-hidden="true">
        <path d="M 0 104 H 19 V 52 H 38" fill="none" stroke="#DCEBFF" strokeWidth="2" />
      </svg>}
  </div>;
}

export default function ObsBracketOverlay() {
  const [owner, setOwner] = useState('');
  const [data, setData] = useState(null);
  const [debug, setDebug] = useState(false);
  const [error, setError] = useState('');
  const [viewport, setViewport] = useState({ width: WIDTH, height: HEIGHT });

  // OBS browser sources can use any dimensions. Fit the entire bracket to
  // the actual browser viewport, not the tournament site's 1000px page width.
  useEffect(() => {
    const updateViewport = () => setViewport({
      width: Math.max(1, window.innerWidth),
      height: Math.max(1, window.innerHeight),
    });
    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOwner(params.get('owner') || '');
    setDebug(params.has('debug'));
  }, []);

  useEffect(() => {
    if (!owner) return;
    let active = true;
    let channel;
    let controller;
    let debounce;
    let fallbackTimer;
    let inFlight = false;
    let pendingForce = false;
    let requestVersion = 0;
    let selectedId = '';
    let selectedRole = '';
    let knownSelection = false;
    let overlayVersion = '';
    const source = 'owner=' + encodeURIComponent(owner);

    // Keep the selection and refresh rules consistent with the existing OBS
    // scoreboard. Only discover the event at OBS start/reload; afterward
    // watch that event alone, without scanning unrelated tournament histories.
    const refresh = async (forceData = false) => {
      if (!active) return;
      if (inFlight) {
        pendingForce ||= forceData;
        return;
      }
      const lookup = !knownSelection;
      if (!lookup && !selectedId) return;
      inFlight = true;
      const version = ++requestVersion;
      controller?.abort();
      controller = new AbortController();
      try {
        const hint = !lookup
          ? '&selectedId=' + encodeURIComponent(selectedId) +
            '&selectedRole=' + encodeURIComponent(selectedRole)
          : '';
        const fullRead = forceData || lookup;
        const url = '/api/tournaments/overlay?view=bracket&' + source + hint +
          (forceData ? '&fresh=1' : '');
        const headers = overlayVersion && !fullRead
          ? { 'X-Overlay-Version': overlayVersion } : {};
        const response = await fetch(url, {
          cache: 'no-store', headers, signal: controller.signal,
        });
        if (!active || version !== requestVersion) return;
        if (response.status === 304) {
          setError('');
          return;
        }
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'HTTP ' + response.status);
        if (lookup) knownSelection = true;
        selectedId = result.selectedTournamentId || '';
        selectedRole = result.selectedRole || '';
        subscribeToSelectedTournament(selectedId);
        overlayVersion = response.headers.get('x-overlay-version') || '';
        setData(result);
        setError('');
      } catch (err) {
        if (active && version === requestVersion && err.name !== 'AbortError')
          setError(err.message || '通信に失敗しました。');
      } finally {
        inFlight = false;
        if (active && pendingForce) {
          pendingForce = false;
          void refresh(true);
        }
      }
    };

    const scheduleRefresh = () => {
      if (document.visibilityState === 'hidden') return;
      clearTimeout(debounce);
      debounce = setTimeout(() => { void refresh(); }, 250);
    };

    // Realtime notification + lightweight revision fallback, as in the OBS
    // scoreboard. The larger bracket JSON is fetched only when its revision
    // actually changed. The API's bracket-specific field selection stays intact.
    function subscribeToSelectedTournament(tournamentId) {
      if (!active || channel || !tournamentId) return;
      try {
        const supabase = getSupabaseBrowserClient();
        channel = supabase.channel('obs-bracket-' + tournamentId)
          .on('postgres_changes', {
            event: '*', schema: 'public', table: 'tournament_change_signals',
            filter: 'tournament_id=eq.' + tournamentId,
          }, scheduleRefresh)
          .subscribe(status => {
            if (status === 'SUBSCRIBED') void refresh();
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
              setError('Realtimeの接続が切れました。再接続を待っています。');
          });
      } catch (err) {
        setError(err.message || 'Realtimeに接続できませんでした。');
      }
    }

    // Scoreboard-equivalent 2.5s safeguard: the server checks only a tiny
    // revision, then replies 304 if unchanged. Hidden OBS sources skip it.
    fallbackTimer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh();
    }, 60000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    void refresh();
    return () => {
      active = false;
      clearInterval(fallbackTimer);
      clearTimeout(debounce);
      document.removeEventListener('visibilitychange', onVisible);
      controller?.abort();
      if (channel) void getSupabaseBrowserClient().removeChannel(channel);
    };
  }, [owner]);

  const rounds = Array.isArray(data?.rounds) ? data.rounds : [];
  const geometry = useMemo(() => {
    if (!rounds.length) return null;
    // Fit the bracket itself (no title/BO header). Its CSS has 24px horizontal
    // padding and 20px/28px vertical padding around the round geometry.
    const totalWidth = rounds.length * CARD_WIDTH + (rounds.length - 1) * ROUND_GAP + 48;
    const contentHeight = 64 + (rounds[0]?.length || 1) * STEP;
    const bracketHeight = contentHeight + 48;
    // Give the actual diagram up to 96% of OBS width/height. Keeping
    // all scaling on the outer wrapper preserves the website's bracket layout.
    const scale = Math.min(3,
      Math.max(1, viewport.width * 0.96) / totalWidth,
      Math.max(1, viewport.height * 0.96) / bracketHeight);
    return { totalWidth, contentHeight, bracketHeight, totalHeight: bracketHeight, scale };
  }, [rounds, viewport.width, viewport.height]);

  return <main className="tournament-detail-page tournament-bracket-overlay" aria-label="配信用トーナメント表">
    {geometry && <div className="bracket-overlay-scale" style={{
      width: geometry.totalWidth, height: geometry.totalHeight,
      transform: `translate(-50%, -50%) scale(${geometry.scale})`,
    }}>
      <section className="tournament-live-panel">
        <div className="bracket-rounds" style={{
          '--bracket-height': geometry.contentHeight + 'px',
          width: geometry.totalWidth, height: geometry.bracketHeight,
        }}>
          {rounds.map((round, roundIndex) =>
            <div className="bracket-round" key={roundIndex}>
              <strong>{roundName(roundIndex, rounds.length)}</strong>
              {round.map((match, index) =>
                <MatchCard key={match.id || index} match={match} rounds={rounds}
                  round={roundIndex} matchIndex={index} />)}
            </div>)}
        </div>
      </section>
    </div>}
    {debug && <p className="bracket-overlay-debug">
      {error || (!rounds.length ? 'トーナメント未選択・開催前' : 'トーナメントを表示中')}
    </p>}
    <style jsx global>{`
      html,body{margin:0!important;padding:0!important;overflow:hidden!important;background:transparent!important}
      body{padding-bottom:0!important}
      body:has(.tournament-bracket-overlay) .site-header,
      body:has(.tournament-bracket-overlay) .bottom-tab-bar{display:none!important}
      .tournament-bracket-overlay{
        position:fixed!important;inset:0!important;
        box-sizing:border-box!important;
        width:100vw!important;height:100vh!important;
        max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;
        margin:0!important;padding:0!important;
        overflow:hidden!important;background:rgba(24,34,49,.85)!important;
        font-family:Arial,"Noto Sans JP",sans-serif;
      }
      .tournament-bracket-overlay .bracket-overlay-scale{
        position:absolute;left:50%;top:50%;transform-origin:center center;
      }
      .tournament-bracket-overlay .tournament-live-panel{
        box-sizing:border-box!important;width:100%;height:100%;margin:0!important;
        padding:0!important;border:0!important;background:transparent!important;
        box-shadow:none!important;overflow:visible!important;
      }
      .tournament-bracket-overlay .tournament-live-panel .bracket-rounds{
        box-sizing:border-box!important;overflow:visible!important;margin:0!important;
        border-radius:0!important;background:transparent!important;
      }
      .tournament-bracket-overlay .tournament-live-panel .bracket-round{
        flex:0 0 ${CARD_WIDTH}px!important;min-width:${CARD_WIDTH}px!important;width:${CARD_WIDTH}px!important;
      }
      .tournament-bracket-overlay .tournament-live-panel .bracket-round>strong{
        color:#f5f8fc!important;border-bottom-color:rgba(255,255,255,.36)!important;
      }
      .tournament-bracket-overlay .tournament-live-panel .bracket-match{
        cursor:default!important;pointer-events:none!important;
      }
      .tournament-bracket-overlay .bracket-overlay-debug{
        position:absolute;top:10px;left:14px;margin:0;padding:8px 14px;
        color:#fff;background:#333;border-radius:6px;z-index:30;font-size:18px;
      }
    `}</style>
  </main>;
}
