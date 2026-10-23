'use client';
import { useState } from 'react';

const STORAGE_KEY = 'figure-tournament-list-v1';
const STAGES = ['終点', '戦場', '小戦場', 'ポケモンスタジアム2', 'すま村', 'カロスポケモンリーグ', '村と街', 'ホロウバスティオン'];
const DEFAULT_STARTERS = ['終点', '戦場', '小戦場', '村と街', 'ホロウバスティオン'];
const DEFAULT_COUNTERPICKS = ['ポケモンスタジアム2', 'すま村', 'カロスポケモンリーグ'];

export default function NewTournamentPage() {
  const [name, setName] = useState('');
  const [format, setFormat] = useState(3);
  const [participants, setParticipants] = useState(8);
  const [date, setDate] = useState('');
  const [selectedStages, setSelectedStages] = useState([...STAGES]);
  const [stageRejects, setStageRejects] = useState(true);
  const [starterStages, setStarterStages] = useState([...DEFAULT_STARTERS]);
  const [counterpickStages, setCounterpickStages] = useState([...DEFAULT_COUNTERPICKS]);
  const [firstPlayerRejects, setFirstPlayerRejects] = useState(1);
  const [secondPlayerRejects, setSecondPlayerRejects] = useState(2);
  const [laterRejects, setLaterRejects] = useState(3);
  const [error, setError] = useState('');

  function toggleStage(stage, setter) {
    setter(old => old.includes(stage) ? old.filter(item => item !== stage) : [...old, stage]);
  }

  function createTournament(event) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('大会名を入力してください。');
      return;
    }
    if (selectedStages.length === 0) {
      setError('使用ステージを1つ以上選択してください。');
      return;
    }
    if (stageRejects && (starterStages.length === 0 || counterpickStages.length === 0)) {
      setError('拒否ステージありの場合、スターターとカウンターピックをそれぞれ1つ以上選択してください。');
      return;
    }

    const tournament = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmedName,
      format: `BO${format}`,
      bestOf: format,
      participants: Number(participants),
      date,
      stages: selectedStages,
      stageRejects,
      stageSettings: stageRejects ? {
        starterStages,
        counterpickStages,
        firstPlayerRejects: Number(firstPlayerRejects),
        secondPlayerRejects: Number(secondPlayerRejects),
        laterRejects: Number(laterRejects),
      } : null,
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
      <p>大会ルールとステージを設定してください。</p>
    </section>

    <section className="create-panel">
      <form onSubmit={createTournament}>
        <label>大会名 <span className="required">必須</span>
          <input value={name} onChange={event => setName(event.target.value)} placeholder="大会名を入力" maxLength={80} autoFocus required />
        </label>

        <fieldset className="setup-group">
          <legend>対戦形式</legend>
          <div className="format-options">
            <button type="button" className={format === 3 ? 'format-option selected' : 'format-option'} aria-pressed={format === 3} onClick={() => setFormat(3)}><strong>BO3</strong><small>2本先取</small></button>
            <button type="button" className={format === 5 ? 'format-option selected' : 'format-option'} aria-pressed={format === 5} onClick={() => setFormat(5)}><strong>BO5</strong><small>3本先取</small></button>
          </div>
        </fieldset>

        <label>参加人数
          <select value={participants} onChange={event => setParticipants(Number(event.target.value))}>
            {[2, 4, 8, 16, 32, 64, 128].map(count => <option key={count} value={count}>{count}人</option>)}
          </select>
        </label>

        <label>開始時刻
          <input type="datetime-local" value={date} onChange={event => setDate(event.target.value)} />
        </label>

        <fieldset className="setup-group">
          <legend>使用ステージ（チェックしたステージを使用）</legend>
          <div className="stage-checkbox-grid">
            {STAGES.map(stage => <label className="stage-checkbox" key={stage}>
              <input type="checkbox" checked={selectedStages.includes(stage)} onChange={() => toggleStage(stage, setSelectedStages)} />
              <span>{stage}</span>
            </label>)}
          </div>
        </fieldset>

        <fieldset className="setup-group">
          <legend>拒否ステージ</legend>
          <div className="toggle-options">
            <button type="button" className={stageRejects ? 'toggle-option selected' : 'toggle-option'} aria-pressed={stageRejects} onClick={() => setStageRejects(true)}>あり</button>
            <button type="button" className={!stageRejects ? 'toggle-option selected' : 'toggle-option'} aria-pressed={!stageRejects} onClick={() => setStageRejects(false)}>なし</button>
          </div>
          {stageRejects && <div className="reject-settings">
            <p className="setting-help">ステージストライクと同じ設定です。スターターとカウンターピックを選択してください。</p>
            <h3>スターターステージ</h3>
            <div className="stage-checkbox-grid">
              {STAGES.map(stage => <label className="stage-checkbox" key={stage}>
                <input type="checkbox" checked={starterStages.includes(stage)} onChange={() => toggleStage(stage, setStarterStages)} />
                <span>{stage}</span>
              </label>)}
            </div>
            <h3>カウンターピックステージ</h3>
            <div className="stage-checkbox-grid">
              {STAGES.map(stage => <label className="stage-checkbox" key={stage}>
                <input type="checkbox" checked={counterpickStages.includes(stage)} onChange={() => toggleStage(stage, setCounterpickStages)} />
                <span>{stage}</span>
              </label>)}
            </div>
            <div className="reject-count-grid">
              <label>最初のプレイヤーの拒否数
                <select value={firstPlayerRejects} onChange={event => setFirstPlayerRejects(Number(event.target.value))}>{[1,2,3,4].map(n => <option key={n} value={n}>{n}ステージ</option>)}</select>
              </label>
              <label>次のプレイヤーの拒否数
                <select value={secondPlayerRejects} onChange={event => setSecondPlayerRejects(Number(event.target.value))}>{[1,2,3,4].map(n => <option key={n} value={n}>{n}ステージ</option>)}</select>
              </label>
              <label>2ゲーム目以降の拒否数
                <select value={laterRejects} onChange={event => setLaterRejects(Number(event.target.value))}>{[1,2,3,4].map(n => <option key={n} value={n}>{n}ステージ</option>)}</select>
              </label>
            </div>
          </div>}
        </fieldset>

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
