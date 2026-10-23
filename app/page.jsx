'use client';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'figure-tournament-list-v1';

export default function Home() {
  const [showForm, setShowForm] = useState(false);
  const [tournaments, setTournaments] = useState([]);
  const [name, setName] = useState('');
  const [format, setFormat] = useState('人形劇');
  const [date, setDate] = useState('');
  const [rules, setRules] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setTournaments(JSON.parse(saved));
    } catch {
      setTournaments([]);
    }
  }, []);

  function openForm() {
    setError('');
    setShowForm(true);
  }

  function createTournament(event) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('大会名を入力してください。');
      return;
    }

    const tournament = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmedName,
      format,
      date,
      rules: rules.trim(),
      status: '募集中',
      createdAt: new Date().toISOString(),
    };
    const next = [tournament, ...tournaments];
    setTournaments(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      setError('保存できませんでした。ブラウザの保存設定を確認してください。');
      return;
    }
    setName('');
    setFormat('人形劇');
    setDate('');
    setRules('');
    setError('');
    setShowForm(false);
  }

  return <main className="page">
    <header className="header">
      <a className="logo" href="/">Figure Tournament</a>
      <button onClick={openForm}>大会を作成</button>
    </header>

    <section className="intro">
      <h1>Figure Tournament</h1>
      <p>amiibo大会の開催・参加・戦績管理</p>
    </section>

    <section className="tournaments">
      <div className="section-title">
        <h2>大会一覧</h2>
        <button onClick={openForm}>＋ 大会を作成</button>
      </div>
      {tournaments.length === 0 ? (
        <div className="empty">
          <p>大会はまだありません。</p>
          <span>大会を作成すると、ここに表示されます。</span>
        </div>
      ) : (
        <div className="tournament-list">
          {tournaments.map((tournament) => (
            <article className="tournament-card" key={tournament.id}>
              <div className="tournament-card-top">
                <h3>{tournament.name}</h3>
                <span className="status">{tournament.status}</span>
              </div>
              <div className="tournament-meta">
                <span>{tournament.format}</span>
                {tournament.date && <span>開催日時：{new Date(tournament.date).toLocaleString('ja-JP')}</span>}
              </div>
              {tournament.rules && <p className="tournament-rules">{tournament.rules}</p>}
            </article>
          ))}
        </div>
      )}
    </section>

    {showForm && (
      <div className="overlay" onClick={() => setShowForm(false)}>
        <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-title" onClick={(event) => event.stopPropagation()}>
          <button className="close" aria-label="閉じる" onClick={() => setShowForm(false)}>×</button>
          <h2 id="create-title">大会を作成</h2>
          <form onSubmit={createTournament}>
            <label>大会名 <span className="required">必須</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="大会名を入力" maxLength={80} autoFocus />
            </label>
            <label>大会形式
              <select value={format} onChange={(event) => setFormat(event.target.value)}>
                <option>人形劇</option>
                <option>トーナメント</option>
                <option>ルール自由</option>
              </select>
            </label>
            <label>開催日時（任意）
              <input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label>ルール・参加条件（任意）
              <textarea value={rules} onChange={(event) => setRules(event.target.value)} placeholder="例：amiibo限定、レベル50、スピリッツなし" rows={3} maxLength={1000} />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="submit" type="submit">大会を作成する</button>
          </form>
        </section>
      </div>
    )}
    <footer>Figure Tournament</footer>
  </main>;
}
