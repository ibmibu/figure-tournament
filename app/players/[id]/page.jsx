'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

function placement(t, player) {
  const saved = (t.resultPlacements || []).find(r => String(r.playerId) === String(player.id));
  if (saved?.place) return saved.place;
  const rounds = t.bracket?.rounds || [];
  const final = rounds.at(-1)?.[0];
  if (String(final?.winnerId || '') === String(player.id)) return '優勝';
  if ([final?.player1, final?.player2].some(p => p && String(p.id) === String(player.id))) return '準優勝';
  if (rounds.length > 1 && (rounds.at(-2) || []).some(m => [m.player1, m.player2].some(p => p && String(p.id) === String(player.id)))) return '3位';
  return '';
}
function formatDate(value) {
  if (!value) return '';
  const date = value.slice(0, 10).replaceAll('-', '/');
  return date + (value.includes('T') ? ' ' + value.slice(11, 16) : '');
}
export default function PlayerResultsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const userId = String(params.id || '');
  const [items, setItems] = useState([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([fetch('/api/tournaments', { cache: 'no-store' }), fetch(`/api/players/legacy?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' })]).then(async ([response, legacyResponse]) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '大会を読み込めませんでした。');
      const matches = (data.tournaments || []).flatMap(t => {
        const player = (t.joinedPlayers || []).find(p => !p.isDemo && String(p.userId || p.id) === userId);
        return player && t.bracket?.complete && t.resultPlacements?.length ? [{ tournament: t, player }] : [];
      });
      const legacy = legacyResponse.ok ? (await legacyResponse.json()).tournaments || [] : [];
      matches.push(...legacy.map(tournament => ({ tournament, player: { id: userId, name: '' } })));
      matches.sort((a, b) => (Date.parse(b.tournament.date || b.tournament.createdAt || '') || 0) - (Date.parse(a.tournament.date || a.tournament.createdAt || '') || 0));
      if (active) {
        setItems(matches);
        setName(matches.find(item => !item.tournament.isLegacy)?.player.name || searchParams.get('name') || '選手');
      }
    }).catch(e => { if (active) setError(e.message || '読み込みに失敗しました。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId]);
  return <main className="page"><section className="my-page">
    <Link href="/" className="back-link">← ホームに戻る</Link>
    <h1>{name || '選手'}さんの参加大会一覧</h1>
    <section className="my-results">
      {loading ? <p className="setting-help">読み込み中…</p> : error ? <p className="form-error" role="alert">{error}</p> : items.length === 0 ? <p className="setting-help">参加大会はまだありません。</p> : <div className="results-table">
        {items.map(({ tournament: t, player }) => <div className="results-table-row" key={t.id}>
          {t.isLegacy ? <span className="results-table-name">
            <span className="results-participant-count">参加者{t.participantCount}名</span>
            <span className="results-tournament-title">{t.name}</span>
          </span> : <Link href={`/tournaments/${encodeURIComponent(t.id)}`} className="results-table-name">
            <span className="results-participant-count">参加者{(t.joinedPlayers || []).length}名</span>
            <span className="results-tournament-title">{t.name}</span>
          </Link>}
          <span className={`results-table-placement${(t.isLegacy ? t.myPlacement : placement(t, player)) === '優勝' ? ' results-placement-winner' : ''}`}>{t.isLegacy ? (['優勝', '準優勝', '3位'].includes(t.myPlacement) ? t.myPlacement : '') : placement(t, player)}</span>
        </div>)}
      </div>}
    </section>
  </section></main>;
}
