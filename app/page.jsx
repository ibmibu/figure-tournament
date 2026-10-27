'use client';
import { useEffect, useState } from 'react';
import SiteHeader from '../components/SiteHeader';
import Link from 'next/link';
import { readTournamentCache, writeTournamentCache } from '../lib/tournament-cache';

function formatStartDate(value) {
  if (!value) return '';
  const [datePart, timePart = ''] = value.split('T');
  if (!datePart) return '';
  const [year, month, day] = datePart.split('-');
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][new Date(`${datePart}T12:00:00`).getDay()];
  const time = timePart.slice(0, 5);
  return `${year}/${month}/${day}(${weekday})${time ? ` ${time}` : ''}`;
}

export default function Home() {
  const [tournaments, setTournaments] = useState([]);

  useEffect(() => {
    let active = true;
    const cached = readTournamentCache();
    if (cached) setTournaments(cached);
    fetch('/api/tournaments', { cache: 'no-store' })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '大会データを読み込めませんでした。');
        const latest = result.tournaments || [];
        writeTournamentCache(latest);
        if (active) setTournaments(latest);
      })
      .catch(error => {
        console.error(error);
        if (active) setTournaments([]);
      });
    return () => { active = false; };
  }, []);

  return <main className="page">
    <SiteHeader />
    <section className="tournaments">
      <div className="section-title">
        <h2>大会一覧</h2>
        <a className="button-link" href="/tournaments/new">＋ 大会を作成</a>
      </div>
      {tournaments.length === 0 ? (
        <div className="empty"><p>大会はまだありません。</p><span>大会を作成すると、ここに表示されます。</span></div>
      ) : (
        <div className="home-tournament-table-wrap">
          <table className="home-tournament-table">
            <thead><tr><th scope="col">大会名</th><th scope="col">形式</th><th scope="col">参加人数</th><th scope="col">開催日時</th><th scope="col">状態</th></tr></thead>
            <tbody>{tournaments.map(tournament => (
              <tr key={tournament.id} className="home-tournament-row" onClick={() => { window.location.href = `/tournaments/${encodeURIComponent(tournament.id)}`; }}>
                <td><Link href={`/tournaments/${encodeURIComponent(tournament.id)}`} className="home-tournament-name">{tournament.name}</Link></td>
                <td>{tournament.format || '—'}</td>
                <td>{(tournament.joinedPlayers || []).length} / {tournament.participants || 8}</td>
                <td className="home-tournament-date">{formatStartDate(tournament.date) || '—'}</td>
                <td><span className="status">{tournament.status || '募集中'}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
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
