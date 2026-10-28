'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getSupabaseBrowserClient } from '../../../../lib/supabase/client';

export default function OrganizerReportsPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
        if (!session) throw Error('主催者としてログインしてください。');
        const response = await fetch('/api/tournaments/reports?id=' + encodeURIComponent(id), {
          headers: { Authorization: 'Bearer ' + session.access_token }, cache: 'no-store'
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || '読み込みに失敗しました。');
        if (active) setData(result);
      } catch (e) { if (active) setError(e.message); }
    })();
    return () => { active = false; };
  }, [id]);
  return <main className="page">
    <section className="intro">
      <a className="back-link" href={'/tournaments/' + encodeURIComponent(id)}>← 大会に戻る</a>
      <h1>キャラ報告を見る</h1>
      {data && <p>{data.name}</p>}
    </section>
    {error ? <p role="alert">{error}</p> : !data ? <p>読み込み中…</p> :
      <section className="my-results my-color-panel">
        <h2>参加者のキャラ報告</h2>
        {data.players.map(player => <div className="my-color-item" key={player.id} style={{display:'block',padding:'12px 0'}}>
          <strong>{player.name}</strong>
          {player.characters.length ? <div style={{marginTop:8}}>{player.characters.map((character, index) =>
            <div key={index}>{character.fighter}　{character.color || '1P'}</div>)}</div>
            : <p className="setting-help">未報告</p>}
        </div>)}
      </section>}
  </main>;
}
