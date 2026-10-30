'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

export default function TournamentOverlay() {
  const params = useParams();
  const id = String(params.id || '');
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [debug, setDebug] = useState(false);
  useEffect(() => { setDebug(new URLSearchParams(window.location.search).has('debug')); }, []);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/tournaments/overlay?id=' + encodeURIComponent(id), { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'HTTP ' + response.status);
        if (active) { setData(result); setLoadError(''); }
      } catch (error) { if (active) setLoadError(error.message || '通信に失敗しました。'); }
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [id]);
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
      .obs-overlay-root{width:100%;min-height:140px;background:transparent!important;color:#fff;font-family:Arial,"Noto Sans JP",sans-serif;display:block!important;padding:0!important;margin:0!important}
      .obs-scoreboard{box-sizing:border-box;display:grid;grid-template-columns:minmax(160px,1fr) 66px 22px 66px minmax(160px,1fr);align-items:center;gap:5px;width:min(100%,960px);margin:0 auto;padding:8px 12px 28px;position:relative;background:transparent}
      .obs-scoreboard .obs-player{background:#17243b!important;padding:15px 16px;font-size:22px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:3px solid #67c1b0}
      .obs-player-left{text-align:right}.obs-player-right{text-align:left}
      .obs-scoreboard .obs-score{background:#3170b8!important;text-align:center;padding:10px 0;font-size:34px;font-weight:900;line-height:1.1;font-variant-numeric:tabular-nums}
      .obs-dash{text-align:center;color:#fff;font-size:20px;text-shadow:0 1px 3px #000}
      .obs-match-label{position:absolute;bottom:2px;left:0;right:0;text-align:center;font-size:13px;font-weight:700;color:#fff;text-shadow:0 1px 3px #000}
    `}</style>
  </main>;
}
