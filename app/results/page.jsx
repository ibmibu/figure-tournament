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
          setTournaments(cachedTournaments.filter(item => item.bracket?.complete && (item.joinedPlayers || []).some(p => !p.isDemo && String(p.userId || p.id) === String(session.user.id))).map(item => ({ ...item, myPlacement: (item.resultPlacements || []).find(result => { const player = (item.joinedPlayers || []).find(p => String(p.id) === String(result.playerId)); return player && !player.isDemo && String(player.userId || player.id) === String(session.user.id); })?.place || '' })));
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
        const mine = (tournamentResult.tournaments || []).filter(item =>
          item.bracket?.complete && (item.joinedPlayers || []).some(player => !player.isDemo && String(player.userId || player.id) === String(session.user.id))
        ).map(item => ({ ...item, myPlacement: (item.resultPlacements || []).find(result => { const player = (item.joinedPlayers || []).find(p => String(p.id) === String(result.playerId)); return player && !player.isDemo && String(player.userId || player.id) === String(session.user.id); })?.place || '' }));
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
        {loading ? <p className="setting-help">読み込み中…</p> : tournaments.length === 0 ? <p className="setting-help">大会記録はまだありません。</p> : <div className="results-table">
          {tournaments.map(tournament => <div className="results-table-row" key={tournament.id}>
            <Link href={`/tournaments/${encodeURIComponent(tournament.id)}`} className="results-table-name">参加者{(tournament.joinedPlayers || []).length}名 {tournament.name}</Link>
            <span className={`results-table-placement${tournament.myPlacement === "優勝" ? " results-placement-winner" : ""}`}>{tournament.myPlacement === 'ベスト4' ? '3位' : tournament.myPlacement || '結果確定'}</span>
          </div>)}
        </div>}
      </section>
    </section>
    <footer>Figure Tournament</footer>
  </main>;
}
