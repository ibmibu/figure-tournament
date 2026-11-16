'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '../../../lib/supabase/client';

export default function TournamentAdminPage() {
  const [tournaments, setTournaments] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairResult, setRepairResult] = useState(null);

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

  async function repairPokemonTrainer() {
    if (!window.confirm('全大会の過去キャラ報告・キャラ宣言・マイカラーの「ゼニガメ／フシギソウ／リザードン」を「ポケモントレーナー」に修正します。報告のカラーは変更しません。実行しますか？')) return;
    setRepairBusy(true);
    setRepairResult(null);
    setError('');
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session?.access_token) throw new Error('ログインしてください。');
      const response = await fetch('/api/admin/repair-pokemon-trainer', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + data.session.access_token },
        cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '過去の報告を修正できませんでした。');
      setRepairResult(result);
    } catch (err) {
      setError(err.message || '修正処理に失敗しました。');
    } finally {
      setRepairBusy(false);
    }
  }

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
          <section style={{ margin: '20px 0', padding: 16, border: '1px solid #bbb', borderRadius: 8 }}>
            <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>過去のポケモントレーナー報告を修正</h2>
            <p className="setting-help">3匹で保存されたキャラ報告・キャラ宣言・実績データを直接変更します。報告の各カラーはそのまま維持し、表示時に合算する処理は追加しません。</p>
            <button type="button" className="submit" disabled={repairBusy} onClick={repairPokemonTrainer}>
              {repairBusy ? '過去データを修正中…' : '過去の報告を一括修正'}
            </button>
            {repairResult && <p role="status" className="setting-help">
              {repairResult.updatedTournaments}大会を修正、ファイター名 {repairResult.correctedNames}件を変更。
              マイカラー {repairResult.colorPresets?.changed || 0}人分を修正。
              {(repairResult.writeConflicts || repairResult.colorPresets?.conflicts) ? ' 競合があったため変更できないデータがあります。' : ''}
              保存済みカラーが複数異なり統合できない場合は、元の設定を維持します。
            </p>}
          </section>
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
