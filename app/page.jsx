'use client';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'figure-tournament-list-v1';
const OWNER_KEY = 'figure-tournament-owner-v1';

export default function Home() {
  const [tournaments, setTournaments] = useState([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setTournaments(JSON.parse(saved));
    } catch {
      setTournaments([]);
    }
  }, []);

  return <main className="page">
    <section className="intro">
      <h1>Figure Tournament</h1>
      <p>amiibo大会の開催・参加・戦績管理</p>
    </section>
    <section className="tournaments">
      <div className="section-title">
        <h2>大会一覧</h2>
        <a className="button-link" href="/tournaments/new">＋ 大会を作成</a>
      </div>
      {tournaments.length === 0 ? (
        <div className="empty"><p>大会はまだありません。</p><span>大会を作成すると、ここに表示されます。</span></div>
      ) : (
        <div className="tournament-list">
          {tournaments.map(tournament => (
            <a className="tournament-card tournament-card-link" href={`/tournaments/${encodeURIComponent(tournament.id)}`} key={tournament.id}>
              <div className="tournament-card-top"><h3>{tournament.name}</h3><span className="status">{tournament.status || '募集中'}</span></div>
              <div className="tournament-meta">
                <span>{tournament.format}</span>
                <span>参加者：{(tournament.joinedPlayers || []).length}/{tournament.participants || 8}人</span>
                {tournament.date && <span>開始時刻：{new Date(tournament.date).toLocaleString('ja-JP')}</span>}
              </div>
              <p className="tournament-rules">{(tournament.description || '大会詳細を確認して参加できます。').replace(/\\n|\/n/g, '\n')}</p>
              <span className="open-tournament">大会ページへ →</span>
            </a>
          ))}
        </div>
      )}
    </section>
    <footer>Figure Tournament</footer>
  </main>;
}
