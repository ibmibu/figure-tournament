'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { readTournamentCache, writeTournamentCache } from '../lib/tournament-cache';
import { readTabSnapshot, writeTabSnapshot } from '../lib/tab-snapshot';

function formatStartDate(value) {
  if (!value) return '';
  const [datePart, timePart = ''] = value.split('T');
  if (!datePart) return '';
  const [year, month, day] = datePart.split('-');
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][new Date(`${datePart}T12:00:00`).getDay()];
  const time = timePart.slice(0, 5);
  return `${year}/${month}/${day}(${weekday})${time ? ` ${time}` : ''}`;
}


function isFinished(t) { return t.bracket?.complete === true || ['終了','終了済み','大会終了'].includes(t.status); }
function finishedAt(t) { const n = Date.parse(t.completedAt || t.date || ''); return Number.isFinite(n) ? n : 0; }
function TournamentTable({items}) {
 return <div className="home-tournament-table-wrap"><table className="home-tournament-table">
 <thead><tr><th scope="col">大会名</th><th scope="col">開催日時</th><th scope="col">参加人数</th></tr></thead>
 <tbody>{items.map(t=><tr key={t.id} className="home-tournament-row" onClick={()=>{window.location.href='/tournaments/'+encodeURIComponent(t.id)}}>
 <td><span className="home-tournament-name-cell">{['BO3','BO5'].includes(String(t.format||'').toUpperCase())&&<span className={`home-format-badge ${String(t.format).toUpperCase()==='BO5'?'home-format-bo5':'home-format-bo3'}`}>{String(t.format).toUpperCase()}</span>}<Link href={'/tournaments/'+encodeURIComponent(t.id)} className="home-tournament-name">{t.name}</Link></span></td>
 <td className="home-tournament-date">{formatStartDate(t.date)||'—'}</td><td>{(t.joinedPlayers||[]).length} / {t.participants||8}</td>
 </tr>)}</tbody></table></div>;
}

export default function Home() {
  const [tournaments, setTournaments] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const snapshot = readTabSnapshot('home');
    if (snapshot) { setTournaments(snapshot); setLoading(false); return () => { active = false; }; }
    const cached = readTournamentCache();
    if (cached) { setTournaments(cached); setLoading(false); }
    fetch('/api/tournaments', { cache: 'no-store' })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '大会データを読み込めませんでした。');
        const latest = result.tournaments || [];
        writeTournamentCache(latest);
        writeTabSnapshot('home', latest);
        if (active) { setTournaments(latest); setLoadError(''); }
      })
      .catch(error => {
        console.error(error);
        if (active) { setLoadError(error.message || '大会データを読み込めませんでした。'); }
      }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const active = tournaments.filter(t=>!isFinished(t));
  const cutoff = Date.now()-14*24*60*60*1000;
  const finished = tournaments.filter(t=>isFinished(t)&&finishedAt(t)>=cutoff).sort((a,b)=>finishedAt(b)-finishedAt(a));
  return <main className="page">
    
    <section className="tournaments">
      <div className="section-title">
        <h2>大会一覧</h2>
        <a className="button-link" href="/tournaments/new">＋ 大会を作成</a>
      </div>
      {loading ? <div className="empty"><p>大会を読み込み中…</p></div> : loadError ? <div className="empty"><p role="alert">{loadError}</p></div> : active.length===0?<div className="empty"><p>開催予定・進行中の大会はありません。</p></div>:<TournamentTable items={active}/>}
    </section>
    <section className="tournaments home-finished-tournaments">
      <div className="section-title"><h2>終了した大会</h2></div>
      {loading ? <div className="empty"><p>大会を読み込み中…</p></div> : loadError ? <div className="empty"><p role="alert">{loadError}</p></div> : finished.length===0?<div className="empty"><p>過去2週間に終了した大会はありません。</p></div>:<TournamentTable items={finished}/>}
    </section>
    <footer className="home-legal-footer">
      <p>本サイトは非公式の大会管理サービスです。任天堂株式会社および『大乱闘スマッシュブラザーズ』公式とは関係ありません。</p>
      <nav className="home-legal-links" aria-label="サイト情報">
        <Link href="/terms">利用規約</Link>
        <Link href="/privacy">プライバシーポリシー</Link>
        <Link href="/disclaimer">免責事項</Link>
        <Link href="/contact">お問い合わせ</Link>
      </nav>
    </footer>
  </main>;
}
