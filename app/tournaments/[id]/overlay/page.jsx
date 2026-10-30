'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

export default function TournamentOverlay() {
  const params = useParams();
  const id = String(params?.id || '');
  const [owner, setOwner] = useState('');
  useEffect(() => { setOwner(new URLSearchParams(window.location.search).get('owner') || ''); }, []);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const lastStatusRef = useRef('unassigned');
  const [debug, setDebug] = useState(false);
  useEffect(() => { setDebug(new URLSearchParams(window.location.search).has('debug')); }, []);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/tournaments/overlay?' + (owner ? 'owner=' + encodeURIComponent(owner) : 'id=' + encodeURIComponent(id)), { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'HTTP ' + response.status);
        if (active) { lastStatusRef.current = result.match ? 'active' : 'unassigned'; setData(result); setLoadError(''); }
      } catch (error) { if (active) setLoadError(error.message || '通信に失敗しました。'); }
    };
    refresh();
    let timer;
    const schedule = async () => {
      if (!active) return;
      if (!document.hidden) await refresh();
      if (active) timer = setTimeout(schedule, document.hidden ? 60000 : lastStatusRef.current === 'active' ? 10000 : 300000);
    };
    const onVisibility = () => { if (!document.hidden) { clearTimeout(timer); schedule(); } };
    document.addEventListener('visibilitychange', onVisibility);
    timer = setTimeout(schedule, 10000);
    return () => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [id, owner]);
  const match = data?.match;
  return <main className="obs-overlay-root">
    {debug && <div style={{ color: '#fff', background: '#333', padding: 12, fontSize: 16 }}>OBS診断：{loadError || (data === null ? '読み込み中' : match ? '配信台の対戦を取得しました' : data.status === 'unassigned' ? '配信台が未設定です' : '配信台の対戦が見つかりません')} / 大会ID：{id}</div>}
    {match && <div className="obs-scoreboard">
      <div className="obs-player obs-player-left">{match.player1}</div>
      <div className="obs-score">{match.score1}</div>
      <div className="obs-dash">–</div>
      <div className="obs-score">{match.score2}</div>
      <div className="obs-player obs-player-right">{match.player2}</div>
      <div className="obs-match-label">{data.name}　|　{match.round}　|　BO{match.bestOf}</div>
    </div>}
    <style jsx global>{`
      html,body{background:transparent!important;margin:0!important;padding:0!important;overflow:hidden!important}
      .obs-overlay-root{width:100%;min-height:80px;background:transparent!important;color:#fff;font-family:Arial,"Noto Sans JP",sans-serif;display:block!important;padding:0!important;margin:0!important}
      .obs-scoreboard{box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1fr) 52px 24px 52px minmax(0,1fr);grid-template-rows:52px auto;align-items:center;column-gap:5px;row-gap:4px;width:min(100%,960px);margin:0 auto;padding:0 8px;position:relative;background:transparent}
      .obs-scoreboard .obs-player{box-sizing:border-box;background:#19263e!important;height:52px;display:flex;align-items:center;padding:0 14px;font-size:22px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
      .obs-player-left{justify-content:flex-end;text-align:right}.obs-player-right{justify-content:flex-start;text-align:left}
      .obs-scoreboard .obs-score{box-sizing:border-box;background:#3170b8!important;width:52px;height:52px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:30px;font-weight:900;line-height:1;font-variant-numeric:tabular-nums}
      .obs-dash{text-align:center;color:#fff;font-size:24px;font-weight:700;text-shadow:0 1px 3px #000}
      .obs-match-label{grid-column:1/-1;justify-self:center;max-width:100%;box-sizing:border-box;background:#19263e!important;padding:5px 14px;text-align:center;font-size:13px;line-height:1.25;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    `}</style>
  </main>;
}
