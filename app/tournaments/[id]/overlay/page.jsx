'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { getSupabaseBrowserClient } from '../../../../lib/supabase/client';

export default function TournamentOverlay() {
  const params = useParams();
  const id = String(params?.id || '');
  const [owner, setOwner] = useState('');
  useEffect(() => { setOwner(new URLSearchParams(window.location.search).get('owner') || ''); }, []);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [debug, setDebug] = useState(false);
  useEffect(() => { setDebug(new URLSearchParams(window.location.search).has('debug')); }, []);
  useEffect(() => {
    if (!owner && !id) return;
    let active = true;
    let channel;
    let controller;
    let debounce;
    let holdTimer;
    let requestVersion = 0;
    const refresh = async () => {
      if (!active) return;
      const version = ++requestVersion;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch('/api/tournaments/overlay?' + (owner ? 'owner=' + encodeURIComponent(owner) : 'id=' + encodeURIComponent(id)), {
          cache: 'no-store', signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'HTTP ' + response.status);
        if (active && version === requestVersion) {
          setData(result);
          clearTimeout(holdTimer);
          if (result.holdUntil) {
            const remaining = Date.parse(result.holdUntil) - Date.now();
            if (remaining > 0) holdTimer = setTimeout(refresh, remaining + 100);
          }
          setLoadError('');
        }
      } catch (error) {
        if (active && version === requestVersion && error.name !== 'AbortError') setLoadError(error.message || '通信に失敗しました。');
      }
    };
    const scheduleRefresh = () => {
      clearTimeout(debounce);
      debounce = setTimeout(refresh, 250);
    };
    // The public change-signals table exposes only IDs and revision tokens,
    // never private tournament JSON. Its trigger must be installed in Supabase.
    try {
      const supabase = getSupabaseBrowserClient();
      channel = supabase.channel('obs-overlay-' + (owner || id))
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'tournament_change_signals',
          ...(id && !owner ? { filter: 'tournament_id=eq.' + id } : {}),
        }, scheduleRefresh)
        .subscribe(status => {
          // A fresh read on subscription/reconnection catches missed changes.
          if (status === 'SUBSCRIBED') refresh();
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setLoadError('Realtimeの接続が切れました。再接続を待っています。');
        });
    } catch (error) {
      setLoadError(error.message || 'Realtimeに接続できませんでした。');
    }
    // Initial read also works if the subscription is delayed or unavailable.
    refresh();
    return () => {
      active = false;
      clearTimeout(debounce);
      clearTimeout(holdTimer);
      controller?.abort();
      if (channel) getSupabaseBrowserClient().removeChannel(channel);
    };
  }, [id, owner]);
  // Show a clearly labeled sample whenever no stream match is assigned,
  // so OBS placement can be adjusted before the tournament starts.
  const isPreview = !data?.match;
  const match = data?.match || {
    player1: 'PLAYER 1', player2: 'PLAYER 2',
    score1: 0, score2: 0, round: 'GRAND FINAL', bestOf: 3,
  };
  const roundLabel = match?.round === 'GRAND FINAL' ? '決勝戦' : match?.round === 'SEMI FINAL' ? '準決勝' : String(match?.round || '').replace(/^ROUND (\d+)$/, (_, n) => n + '回戦');
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
