'use client';
import { useState } from 'react';

const STORAGE_KEY = 'figure-tournament-list-v1';

export default function NewTournamentPage() {
  const [name, setName] = useState('');
  const [format, setFormat] = useState('人形劇');
  const [date, setDate] = useState('');
  const [rules, setRules] = useState('');
  const [error, setError] = useState('');

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

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const tournaments = saved ? JSON.parse(saved) : [];
      localStorage.setItem(STORAGE_KEY, JSON.stringify([tournament, ...tournaments]));
      window.location.href = '/';
    } catch {
      setError('保存できませんでした。ブラウザの保存設定を確認してください。');
    }
  }

  return <main className="page">
    <section className="intro">
      <a className="back-link" href="/">← 大会一覧に戻る</a>
      <h1>大会を作成</h1>
      <p>大会の情報を入力してください。</p>
    </section>

    <section className="create-panel">
      <form onSubmit={createTournament}>
        <label>大会名 <span className="required">必須</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="大会名を入力" maxLength={80} autoFocus required />
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
          <textarea value={rules} onChange={(event) => setRules(event.target.value)} placeholder="例：amiibo限定、レベル50、スピリッツなし" rows={4} maxLength={1000} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <a className="cancel-link" href="/">キャンセル</a>
          <button className="submit" type="submit">大会を作成する</button>
        </div>
      </form>
    </section>
    <footer>Figure Tournament</footer>
  </main>;
}
