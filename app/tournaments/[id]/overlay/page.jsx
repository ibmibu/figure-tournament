'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { getSupabaseBrowserClient } from '../../../../lib/supabase/client';
import OverlayScoreboardArtwork from '../../../../components/OverlayScoreboardArtwork';
import { DEFAULT_OVERLAY_DESIGN, normalizeOverlayDesign } from '../../../../lib/overlay-scoreboard';

export default function TournamentOverlay() {
  const params = useParams();
  const id = String(params?.id || '');
  const [owner, setOwner] = useState('');
  const [player, setPlayer] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOwner(params.get('owner') || '');
    setPlayer(params.get('player') || '');
  }, []);
  const [data, setData] = useState(null);
  const [matchLoaded, setMatchLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [design, setDesign] = useState(null);
  const [designReady, setDesignReady] = useState(false);
  const [debug, setDebug] = useState(false);
  useEffect(() => { setDebug(new URLSearchParams(window.location.search).has('debug')); }, []);
  useEffect(() => {
    if (!owner && !player && !id) return;
    let active = true;
    let channel;
    let controller;
    let debounce;
    let holdTimer;
    let fallbackTimer;
    let inFlight = false;
    let pendingForce = false;
    let requestVersion = 0;
    let selectedId = '';
    let selectedRole = '';
    let knownSelection = false;
    let overlayVersion = '';
    const dynamicSource = Boolean(player || owner);
    const source = player ? 'player=' + encodeURIComponent(player)
      : owner ? 'owner=' + encodeURIComponent(owner)
      : 'id=' + encodeURIComponent(id);
    const refresh = async (forceData = false) => {
      if (!active) return;
      if (inFlight) {
        pendingForce ||= forceData;
        return;
      }
      // Select the tournament only when OBS starts/reloads. The current
      // tournament's match, score and round stay live without searching
      // unrelated events or the organizer's history again.
      const lookup = dynamicSource && !knownSelection;
      if (dynamicSource && !lookup && !selectedId) return;
      inFlight = true;
      const version = ++requestVersion;
      controller?.abort();
      controller = new AbortController();
      try {
        const hint = dynamicSource && !lookup
          ? '&selectedId=' + encodeURIComponent(selectedId) +
            '&selectedRole=' + encodeURIComponent(selectedRole)
          : '';
        const fullRead = forceData || lookup;
        const url = '/api/tournaments/overlay?' + source + hint +
          (forceData ? '&fresh=1' : '');
        const headers = overlayVersion && !fullRead
          ? { 'X-Overlay-Version': overlayVersion } : {};
        const response = await fetch(url, {
          cache: 'no-store', headers, signal: controller.signal,
        });
        if (!active || version !== requestVersion) return;
        if (response.status === 304) {
          setLoadError('');
          return;
        }
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'HTTP ' + response.status);
        if (lookup) knownSelection = true;
        if (dynamicSource) {
          selectedId = result.selectedTournamentId || '';
          selectedRole = result.selectedRole || '';
        }
        // Subscribe to the selected tournament only, not every change from
        // all tournaments. A different tournament is selected on OBS reload.
        subscribeToSelectedTournament(selectedId || id);
        overlayVersion = response.headers.get('x-overlay-version') || '';
        setData(result);
        setMatchLoaded(true);
        clearTimeout(holdTimer);
        if (result.holdUntil) {
          const remaining = Date.parse(result.holdUntil) - Date.now();
          // The hold period expires without a database write or revision bump.
          // A forced full read clears the finished match at the right time.
          if (remaining > 0) holdTimer = setTimeout(() => refresh(true), remaining + 100);
        }
        setLoadError('');
      } catch (error) {
        if (active && version === requestVersion && error.name !== 'AbortError') {
          setLoadError(error.message || '通信に失敗しました。');
          setMatchLoaded(true);
        }
      } finally {
        inFlight = false;
        if (active && pendingForce) {
          pendingForce = false;
          void refresh(true);
        }
      }
    };
    const scheduleRefresh = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => refresh(), 250);
    };
    // Realtime remains enabled for score and round changes within the
    // selected event. There is no cross-tournament subscription or timer.
    function subscribeToSelectedTournament(tournamentId) {
      if (!active || channel || !tournamentId) return;
      try {
        const supabase = getSupabaseBrowserClient();
        channel = supabase.channel('obs-overlay-' + tournamentId)
          .on('postgres_changes', {
            event: '*', schema: 'public', table: 'tournament_change_signals',
            filter: 'tournament_id=eq.' + tournamentId,
          }, scheduleRefresh)
          .subscribe(status => {
            if (status === 'SUBSCRIBED') void refresh();
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
              setLoadError('Realtimeの接続が切れました。再接続を待っています。');
          });
      } catch (error) {
        setLoadError(error.message || 'Realtimeに接続できませんでした。');
      }
    }
    // The score fallback remains 2.5 seconds. After the first response, an
    // unchanged tournament is only a tiny revision query; a changed result
    // immediately reads the selected tournament's score projection.
    fallbackTimer = setInterval(() => { void refresh(); }, 2500);
    void refresh();
    return () => {
      active = false;
      clearInterval(fallbackTimer);
      clearTimeout(debounce);
      clearTimeout(holdTimer);
      controller?.abort();
      if (channel) getSupabaseBrowserClient().removeChannel(channel);
    };
  }, [id, owner, player]);
  // OBS design rarely changes during a match. Load it once per organizer
  // instead of reading Supabase Auth metadata every 15 seconds. Reloading the
  // OBS browser source applies any layout edits; scores and tournament changes
  // still synchronize independently at their original fast intervals.
  const designOwner = player || owner || data?.ownerId || '';
  useEffect(() => {
    if (!designOwner) return;
    let active = true;
    const loadDesign = async () => {
      try {
        const response = await fetch('/api/overlay-design?owner=' + encodeURIComponent(designOwner), { cache: 'no-store' });
        if (!response.ok) throw new Error('overlay design HTTP ' + response.status);
        const result = await response.json();
        if (active) {
          setDesign(result.design?.version === 1 ? normalizeOverlayDesign(result.design) : null);
          setDesignReady(true);
        }
      } catch (error) {
        // Don't leave OBS blank if the optional design fetch fails.
        // A browser-source reload can retry without background polling.
        console.warn('OBS overlay design load failed:', error);
        if (active) setDesignReady(true);
      }
    };
    setDesign(null);
    setDesignReady(false);
    void loadDesign();
    return () => { active = false; };
  }, [designOwner]);
  // Show a clearly labeled sample whenever no stream match is assigned,
  // so OBS placement can be adjusted before the tournament starts.
  const isPreview = !data?.match;
  const match = data?.match || {
    player1: 'PLAYER 1', player2: 'PLAYER 2',
    score1: 0, score2: 0, round: 'GRAND FINAL', bestOf: 3,
  };
  const roundLabel = match?.round === 'GRAND FINAL' ? '決勝戦' : match?.round === 'SEMI FINAL' ? '準決勝' : String(match?.round || '').replace(/^ROUND (\d+)$/, (_, n) => n + '回戦');
  // Prevent the old 960px fallback and placeholder names flashing before
  // either the selected match or the saved design has finished loading.
  if (!matchLoaded || (designOwner && !designReady)) return <main className="obs-overlay-root"
    style={{ width: 1920, height: 1080, background: 'transparent' }}>
    <style jsx global>{`html,body{background:transparent!important;margin:0!important;padding:0!important;overflow:hidden!important}`}</style>
  </main>;
  if (design || player) return <main className="obs-overlay-root" style={{ width: 1920, height: 1080, overflow: 'hidden' }}>
    {debug && <div style={{ position: 'absolute', top: 200, left: 20, color: '#fff', background: '#333', fontSize: 18, zIndex: 10 }}>OBS診断：{loadError || '配信表示中'} / 大会ID：{id}</div>}
    <OverlayScoreboardArtwork config={design || DEFAULT_OVERLAY_DESIGN} match={match}
      title={isPreview ? (player ? 'プレビュー（対戦待ち）' : 'プレビュー（大会未設定）') : data.name} />
    <style jsx global>{`html,body{background:transparent!important;margin:0!important;padding:0!important;overflow:hidden!important}`}</style>
  </main>;
  return <main className="obs-overlay-root">
    {debug && <div style={{ color: '#fff', background: '#333', padding: 12, fontSize: 16 }}>OBS診断：{loadError || (data === null ? '読み込み中' : match ? '配信台の対戦を取得しました' : data.status === 'unassigned' ? '配信台が未設定です' : '配信台の対戦が見つかりません')} / 大会ID：{id}</div>}
    <div className="obs-scoreboard">
      <div className="obs-scoreboard-main">
        <div className="obs-player obs-player-left"><span>{match.player1}</span></div>
        <div className="obs-score">{match.score1}</div>
        <div className="obs-match-meta">
          <span className="obs-match-round">{roundLabel}</span>
          <span className="obs-match-format">BO{match.bestOf}</span>
        </div>
        <div className="obs-score">{match.score2}</div>
        <div className="obs-player obs-player-right"><span>{match.player2}</span></div>
      </div>
      <div className="obs-tournament-title">{isPreview ? 'プレビュー（大会未設定）' : data.name}</div>
    </div>
    <style jsx global>{`
      html,body{background:transparent!important;margin:0!important;padding:0!important;overflow:hidden!important}
      .obs-overlay-root{width:100%;min-height:80px;background:transparent!important;color:#fff;font-family:Arial,"Noto Sans JP",sans-serif;display:block!important;padding:0!important;margin:0!important}
      .obs-scoreboard{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:5px;width:min(100%,960px);margin:0 auto;padding:0 8px;background:transparent}
      .obs-scoreboard-main{box-sizing:border-box;width:80%;height:46px;display:grid;grid-template-columns:minmax(0,1fr) 46px 92px 46px minmax(0,1fr);align-items:stretch;column-gap:4px;margin:0 auto}
      .obs-player{box-sizing:border-box;min-width:0;height:46px;background:#fff!important;border:2px solid #5e45a8;border-radius:2px;display:flex;align-items:center;padding:0 12px;color:#24232b;font-size:25px;font-weight:800;line-height:1}
      .obs-player span{display:block;max-width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .obs-player-left{justify-content:flex-end;text-align:right}
      .obs-player-right{justify-content:flex-start;text-align:left}
      .obs-score{box-sizing:border-box;width:46px;height:46px;background:#5e45a8!important;border-radius:2px;display:flex;align-items:center;justify-content:center;text-align:center;color:#fff;font-size:35px;font-weight:900;line-height:1;font-variant-numeric:tabular-nums}
      .obs-match-meta{box-sizing:border-box;min-width:0;height:46px;background:#f0ebfb!important;border:1px solid #b7a8df;border-radius:2px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:#453487;white-space:nowrap;line-height:1}
      .obs-match-round{font-size:17px;font-weight:800}
      .obs-match-format{font-size:15px;font-weight:800}
      .obs-tournament-title{box-sizing:border-box;display:block;max-width:100%;background:#5e45a8!important;border-radius:2px;padding:4px 18px;text-align:center;color:#fff;font-size:14px;font-weight:700;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    `}</style>
  </main>;
}
