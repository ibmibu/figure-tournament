'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '../../../lib/supabase/client';

export default function TournamentAdminPage() {
  const [tournaments, setTournaments] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        if (!data.session?.access_token) throw new Error('大会管理にはログインが必要です。');
        // The API checks FIGURE_STATS_ADMIN_USER_ID on the server; no other
        // user can read this complete list or change another person's event.
        const response = await fetch('/api/admin/series-tags', {
          headers: { Authorization: 'Bearer ' + data.session.access_token },
          cache: 'no-store',
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '大会一覧を取得できませんでした。');
        if (active) setTournaments(result.tournaments || []);
      } catch (err) {
        if (active) setError(err.message || '大会一覧を取得できませんでした。');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const shown = useMemo(() => tournaments.filter(t =>
    String(t.name || '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) ||
    (t.seriesTags || []).some(tag => String(tag).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  ), [tournaments, search]);

  return <main className="page">
    <section className="my-page" style={{ maxWidth: 920, margin: '24px auto' }}>
      <Link href="/" className="back-link">← ホームに戻る</Link>
      <h1>大会管理</h1>
      <p className="setting-help">管理者専用です。自分以外の主催大会や終了した大会の設定も編集できます。進行中の大会は対戦ルールを変更できません。</p>
      {loading ? <p className="setting-help">大会一覧を読み込み中…</p> :
        error ? <p className="form-error" role="alert">{error}</p> : <>
          <label>大会名・タグで検索
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="大会名またはタグ" />
          </label>
          <p className="setting-help">{shown.length} / {tournaments.length} 大会</p>
          <div className="results-table">
            {shown.map(t => <div className="results-table-row" key={t.id}>
              <span className="results-table-name"><span className="results-tournament-title">{t.name}</span>
                {(t.seriesTags || []).length > 0 && <span className="setting-help">{t.seriesTags.join('・')}</span>}</span>
              <Link className="button-link" href={`/tournaments/new?edit=${encodeURIComponent(t.id)}`}>編集</Link>
            </div>)}
          </div>
        </>}
    </section>
  </main>;
}
