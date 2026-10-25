'use client';

import { useEffect, useState } from 'react';
import SiteHeader from '../../components/SiteHeader';
import { getSupabaseBrowserClient } from '../../lib/supabase/client';
import Link from 'next/link';
import { readTournamentCache, writeTournamentCache } from '../../lib/tournament-cache';

function formatDate(value) {
  if (!value) return '';
  const [datePart, timePart = ''] = value.split('T');
  const [year, month, day] = datePart.split('-');
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][new Date(`${datePart}T12:00:00`).getDay()];
  return `${year}/${month}/${day}(${weekday})${timePart ? ` ${timePart.slice(0, 5)}` : ''}`;
}

export default function ResultsPage() {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        const session = data.session;
        if (!session) {
          window.location.href = '/login?next=/results';
          return;
        }
        const cachedTournaments = readTournamentCache();
        if (cachedTournaments) {
          const cachedProfile = (() => { try { return JSON.parse(localStorage.getItem('figure-profile-' + session.user.id) || '{}'); } catch { return {}; } })();
          const cachedName = String(cachedProfile.display_name || 'no name').trim().toLowerCase();
          setTournaments(cachedTournaments.filter(item => item.bracket?.complete && (item.resultPlacements || []).some(result => { const player = (item.joinedPlayers || []).find(p => p.id === result.playerId); return player && !player.isDemo && String(player.name || '').trim().toLowerCase() === cachedName; })));
          setLoading(false);
        }
        const headers = { Authorization: `Bearer ${session.access_token}` };
        const [profileResponse, tournamentResponse] = await Promise.all([
          fetch('/api/profile', { headers, cache: 'no-store' }),
          fetch('/api/tournaments', { headers, cache: 'no-store' }),
        ]);
        const profileResult = await profileResponse.json();
        const tournamentResult = await tournamentResponse.json();
        if (!profileResponse.ok) throw new Error(profileResult.error || 'プロフィールを読み込めませんでした。');
        if (!tournamentResponse.ok) throw new Error(tournamentResult.error || '大会情報を読み込めませんでした。');
        writeTournamentCache(tournamentResult.tournaments || []);
        try { localStorage.setItem('figure-profile-' + session.user.id, JSON.stringify(profileResult.profile || {})); } catch {}
        const myName = String(profileResult.profile?.display_name || 'no name').trim().toLowerCase();
        const mine = (tournamentResult.tournaments || []).filter(item =>
          item.bracket?.complete && (item.resultPlacements || []).some(result => {
            const player = (item.joinedPlayers || []).find(p => p.id === result.playerId);
            return player && !player.isDemo && String(player.name || '').trim().toLowerCase() === myName;
          })
        );
        if (active) setTournaments(mine);
      } catch (e) {
        if (active) setError(e.message || '読み込みに失敗しました。');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, []);

  return <main className="page">
    <SiteHeader />
    <section className="my-page">
      <h1>参加大会一覧</h1>
      <section className="my-results">
        {error && <p className="form-error" role="alert">{error}</p>}
        {loading ? <p className="setting-help">読み込み中…</p> : tournaments.length === 0 ? <p className="setting-help">大会記録はまだありません。</p> : <div className="tournament-list">
          {tournaments.map(tournament => { const myPlacement = (tournament.resultPlacements || []).find(result => { const player = (tournament.joinedPlayers || []).find(p => p.id === result.playerId); return player && !player.isDemo && String(player.name || '').trim().toLowerCase() === String((tournament.joinedPlayers || []).find(p => !p.isDemo && String(p.name || '').trim().toLowerCase() === String(p.name || '').trim().toLowerCase())?.name || '').trim().toLowerCase(); }); return <Link className="tournament-card tournament-card-link" href={`/tournaments/${encodeURIComponent(tournament.id)}`} key={tournament.id}>
            <div className="tournament-card-top"><h3>{tournament.name}</h3><span className="status">{myPlacement?.place || '結果確定'}</span></div>
            <div className="tournament-meta">
              <span>{tournament.format || '大会'}</span>
              <span>参加者：{(tournament.joinedPlayers || []).length}/{tournament.participants || 8}人</span>
              {tournament.date && <span>{formatDate(tournament.date)}</span>}
            </div>
          </Link>; })}
        </div>}
      </section>
    </section>
    <footer>Figure Tournament</footer>
  </main>;
}
