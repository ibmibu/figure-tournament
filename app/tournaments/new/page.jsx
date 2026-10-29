'use client';
import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '../../../lib/supabase/client';

const STORAGE_KEY = 'figure-tournament-list-v1';
const LAST_SERIES_TAG_KEY = 'figure-tournament-last-series-tag-v1';
const LAST_TOURNAMENT_NAME_KEY = 'figure-tournament-last-name-v1';
const LAST_STREAM_URL_KEY = 'figure-tournament-last-stream-url-v1';
const LAST_STREAM_FRIEND_CODE_KEY = 'figure-tournament-last-stream-friend-code-v1';
const LAST_DESCRIPTION_KEY = 'figure-tournament-last-description-v1';
const STAGES = ['終点', '戦場', '小戦場', 'ポケモンスタジアム2', 'すま村', 'カロスポケモンリーグ', '村と街', 'ホロウバスティオン'];
const DEFAULT_STARTERS = ['終点', '戦場', '小戦場', '村と街', 'ホロウバスティオン'];
const DEFAULT_COUNTERPICKS = ['ポケモンスタジアム2', 'すま村', 'カロスポケモンリーグ'];

function nextTournamentName(previousName) {
  const match = previousName.match(/^(.*?)(\d+)([^\d]*)$/u);
  if (!match) return previousName;
  const nextNumber = String(Number(match[2]) + 1).padStart(match[2].length, '0');
  return `${match[1]}${nextNumber}${match[3]}`;
}

export default function NewTournamentPage() {
  const [editId, setEditId] = useState('');
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await getSupabaseBrowserClient().auth.getSession();
        if (error) throw error;
        if (!data.session) {
          window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          return;
        }
        if (active) setCheckingAuth(false);
      } catch (error) {
        if (active) setError(error.message || 'ログイン状態を確認できませんでした。');
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (checkingAuth || new URLSearchParams(window.location.search).has('edit')) return;
    try { const savedTag = window.localStorage.getItem(LAST_SERIES_TAG_KEY); if (savedTag !== null) setSeriesTag(savedTag); const savedName = window.localStorage.getItem(LAST_TOURNAMENT_NAME_KEY); if (savedName) setName(current => current || nextTournamentName(savedName)); const savedStreamUrl = window.localStorage.getItem(LAST_STREAM_URL_KEY); if (savedStreamUrl !== null) setStreamUrl(savedStreamUrl); const savedFriendCode = window.localStorage.getItem(LAST_STREAM_FRIEND_CODE_KEY); if (savedFriendCode !== null) setStreamFriendCode(savedFriendCode); const savedDescription = window.localStorage.getItem(LAST_DESCRIPTION_KEY); if (savedDescription !== null) setDescription(savedDescription); } catch {}
    let active = true;
    (async () => {
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        if (!data.session) return;
        const response = await fetch('/api/tournaments', {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: 'no-store',
        });
        if (!response.ok) return;
        const result = await response.json();
        const previous = (result.tournaments || []).find(t => t.isOwner && typeof t.name === 'string' && t.name.trim());
        if (active && previous) {
          setName(current => current || nextTournamentName(previous.name));
          setSeriesTag(current => current || (previous.seriesTags?.[0] || ''));
          setStreamUrl(current => current || previous.streamUrl || '');
          setStreamFriendCode(current => current || previous.streamFriendCode || '');
        }
        if (active) setKnownSeriesTags([...new Set((result.tournaments || []).flatMap(t => Array.isArray(t.seriesTags) ? t.seriesTags : []))].sort((a,b) => a.localeCompare(b, 'ja')));
      } catch { /* Keep the name empty if previous tournaments cannot be loaded. */ }
    })();
    return () => { active = false; };
  }, [checkingAuth]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('edit') || '';
    if (id) {
      setEditId(id);
      setLoadingEdit(true);
    }
  }, []);
  const [name, setName] = useState('');
  const [seriesTag, setSeriesTag] = useState('');
  const [knownSeriesTags, setKnownSeriesTags] = useState([]);
  const [format, setFormat] = useState(3);
  const [participants, setParticipants] = useState(16);
  const [date, setDate] = useState('');

  useEffect(() => {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const localDate = `${nextWeek.getFullYear()}-${String(nextWeek.getMonth() + 1).padStart(2, '0')}-${String(nextWeek.getDate()).padStart(2, '0')}`;
    if (!new URLSearchParams(window.location.search).has('edit')) setDate(localDate);
  }, []);
  const [hour, setHour] = useState('21');
  const [selectedStages, setSelectedStages] = useState([...STAGES]);
  const [customStageName, setCustomStageName] = useState('');
  const [stageRejects, setStageRejects] = useState(false);
  const [autoSeed, setAutoSeed] = useState(false);
  const [characterDeclaration, setCharacterDeclaration] = useState(false);
  const [starterStages, setStarterStages] = useState([...DEFAULT_STARTERS]);
  const [counterpickStages, setCounterpickStages] = useState([...DEFAULT_COUNTERPICKS]);
  const [firstPlayerRejects, setFirstPlayerRejects] = useState(1);
  const [secondPlayerRejects, setSecondPlayerRejects] = useState(2);
  const [laterRejects, setLaterRejects] = useState(3);
  const [description, setDescription] = useState('');
  const [streamUrl, setStreamUrl] = useState('');
  const [streamFriendCode, setStreamFriendCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editId || checkingAuth) return;
    let active = true;
    (async () => {
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        const session = data.session;
        if (!session) { window.location.href = `/login?next=${encodeURIComponent('/tournaments/new?edit=' + editId)}`; return; }
        const response = await fetch(`/api/tournaments?id=${encodeURIComponent(editId)}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '大会情報を読み込めませんでした。');
        const t = result.tournament;
        if (!t.isOwner) throw new Error('この大会を編集する権限がありません。');
        if (!active) return;
        setName(t.name || '');
        setStreamUrl(t.streamUrl || '');
        setStreamFriendCode(t.streamFriendCode || '');
        setSeriesTag(Array.isArray(t.seriesTags) ? (t.seriesTags[0] || '') : '');
        setFormat(Number(t.bestOf) === 5 ? 5 : 3);
        setParticipants(Number(t.participants) || 8);
        setDate(t.date ? t.date.slice(0, 10) : '');
        setHour(t.date ? t.date.slice(11, 13) : '21');
        setSelectedStages(Array.isArray(t.stages) ? t.stages : [...STAGES]);
        setStageRejects(Boolean(t.stageRejects));
        setAutoSeed(Boolean(t.autoSeed));
        setCharacterDeclaration(Boolean(t.characterDeclaration));
        setStarterStages(t.stageSettings?.starterStages || [...DEFAULT_STARTERS]);
        setCounterpickStages(t.stageSettings?.counterpickStages || [...DEFAULT_COUNTERPICKS]);
        setFirstPlayerRejects(Number(t.stageSettings?.firstPlayerRejects) || 1);
        setSecondPlayerRejects(Number(t.stageSettings?.secondPlayerRejects) || 2);
        setLaterRejects(Number(t.stageSettings?.laterRejects) || 3);
        setDescription(t.description || '');
      } catch (e) { if (active) setError(e.message || '読み込みに失敗しました。'); }
      finally { if (active) setLoadingEdit(false); }
    })();
    return () => { active = false; };
  }, [editId, checkingAuth]);

  const stageOptions = [...new Set([...STAGES, ...selectedStages])];
  function addCustomStage() {
    const name = customStageName.trim();
    if (!name) return;
    if (name.length > 40) { setError('追加ステージ名は40文字以内にしてください。'); return; }
    setSelectedStages(old => old.includes(name) ? old : [...old, name]);
    setCustomStageName('');
    setError('');
  }

  function toggleStage(stage, setter) {
    setter(old => old.includes(stage) ? old.filter(item => item !== stage) : [...old, stage]);
  }

  async function createTournament(event) {
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
    const effectiveStarters = starterStages.filter(stage => selectedStages.includes(stage));
    const effectiveCounterpicks = counterpickStages.filter(stage => selectedStages.includes(stage));
    if (stageRejects && (effectiveStarters.length === 0 || effectiveCounterpicks.length === 0)) {
      setError('拒否ステージありの場合、使用ステージの中からスターターとカウンターピックをそれぞれ1つ以上選択してください。');
      return;
    }

    let session;
    try {
      const { data, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
      if (sessionError) throw sessionError;
      session = data.session;
    } catch (authError) {
      setError(authError.message || 'ログイン状態を確認できませんでした。');
      return;
    }
    if (!session) {
      window.location.href = `/login?next=${encodeURIComponent('/tournaments/new')}`;
      return;
    }

    if (streamUrl.trim()) {
      try { const url = new URL(streamUrl.trim()); if (!['https:', 'http:'].includes(url.protocol)) throw new Error(); }
      catch { setError('配信先URLはhttps://から始まる正しいURLを入力してください。'); return; }
    }
    if (streamFriendCode.trim() && !/^[A-Z0-9-]+$/.test(streamFriendCode.trim().toUpperCase())) {
      setError('配信台のフレンドコードは英数字とハイフンのみで入力してください。'); return;
    }

    const tournament = {
      id: editId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description: description.trim(),
      streamUrl: streamUrl.trim(),
      streamFriendCode: streamFriendCode.trim().toUpperCase(),
      name: trimmedName,
      seriesTags: seriesTag.trim() ? [seriesTag.trim()] : [],
      format: `BO${format}`,
      bestOf: format,
      participants: Number(participants),
      date: date ? `${date}T${hour}:00` : '',
      stages: selectedStages,
      stageRejects,
      autoSeed,
      characterDeclaration,
      stageSettings: stageRejects ? {
        starterStages: effectiveStarters,
        counterpickStages: effectiveCounterpicks,
        firstPlayerRejects: Number(firstPlayerRejects),
        secondPlayerRejects: Number(secondPlayerRejects),
        laterRejects: Number(laterRejects),
      } : null,
      status: editId ? '募集中' : '募集中',
      createdAt: new Date().toISOString(),
    };

    try {
      const response = await fetch('/api/tournaments', {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ tournament }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '保存できませんでした。');
      try { window.localStorage.setItem(LAST_SERIES_TAG_KEY, seriesTag.trim()); window.localStorage.setItem(LAST_STREAM_URL_KEY, streamUrl.trim()); window.localStorage.setItem(LAST_STREAM_FRIEND_CODE_KEY, streamFriendCode.trim().toUpperCase()); window.localStorage.setItem(LAST_DESCRIPTION_KEY, description.trim()); if (!editId) { window.localStorage.setItem(LAST_TOURNAMENT_NAME_KEY, trimmedName); window.localStorage.setItem(LAST_STREAM_URL_KEY, streamUrl.trim()); window.localStorage.setItem(LAST_STREAM_FRIEND_CODE_KEY, streamFriendCode.trim().toUpperCase()); } } catch {}
      window.location.href = `/tournaments/${encodeURIComponent(editId || result.id || tournament.id)}`;
    } catch (saveError) {
      setError(saveError.message || '保存できませんでした。通信状況とサーバー設定を確認してください。');
    }
  }

  const weekday = date ? ['日', '月', '火', '水', '木', '金', '土'][new Date(date + 'T12:00:00').getDay()] : '';

  if (checkingAuth && !error) return <main className="page"><p className="setting-help">ログイン状態を確認しています…</p></main>;

  return <main className="page tournament-create-page">
    
    <section className="intro">
      
      <a className="back-link" href="/">← 大会一覧に戻る</a>
      <h1>{editId ? '大会を編集' : '大会を作成'}</h1>
      <p>大会ルールとステージを設定してください。</p>
    </section>

    <section className="create-panel">
      {loadingEdit ? <p className="setting-help">大会情報を読み込み中…</p> : <form onSubmit={createTournament}>
        <label>大会名 <span className="required">必須</span>
          <input value={name} onChange={event => setName(event.target.value)} placeholder="大会名を入力" maxLength={80} autoFocus required />
        </label>

        <label>大会タグ
          <input value={seriesTag} onChange={event => setSeriesTag(event.target.value)} placeholder="例：人形劇" maxLength={40} list="tournament-series-tags" />
          <datalist id="tournament-series-tags">{knownSeriesTags.map(tag => <option key={tag} value={tag} />)}</datalist>
          <small className="setting-help">同じタグの大会を戦績ページでまとめて表示できます。</small>
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

        <fieldset className="setup-group">
          <legend>開始日時</legend>
          <label>日付
            <div className="date-with-weekday">
              <span className={date ? '' : 'date-placeholder'}>{date ? `${date.replaceAll('-', '/') }(${weekday})` : '日付を選択'}</span>
              <input aria-label="開始日" type="date" value={date} onChange={event => setDate(event.target.value)} onClick={event => { try { event.currentTarget.showPicker(); } catch {} }} />
            </div>
          </label>
          <label>時間
            <select value={hour} onChange={event => setHour(event.target.value)}>
              {Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0')).map(value => <option key={value} value={value}>{value}:00</option>)}
            </select>
          </label>
        </fieldset>

        <fieldset className="setup-group">
          <legend>使用ステージ</legend>
          <div className="stage-checkbox-grid">
            {stageOptions.map(stage => <label className="stage-checkbox" key={stage}>
              <input type="checkbox" checked={selectedStages.includes(stage)} onChange={() => toggleStage(stage, setSelectedStages)} />
              <span>{stage}</span>
            </label>)}
          </div>
          <div className="custom-stage-entry"><label htmlFor="customStageName">追加ステージ（1行につき1つ）</label><div className="custom-stage-input"><input id="customStageName" type="text" maxLength={40} value={customStageName} onChange={e => setCustomStageName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomStage(); } }} /><button type="button" onClick={addCustomStage} disabled={!customStageName.trim()}>追加</button></div></div>
        </fieldset>

        <fieldset className="setup-group">
          <legend>拒否ステージ</legend>
          <div className="toggle-options">
            <button type="button" className={!stageRejects ? 'toggle-option selected' : 'toggle-option'} aria-pressed={!stageRejects} onClick={() => setStageRejects(false)}>なし</button>
            <button type="button" className={stageRejects ? 'toggle-option selected' : 'toggle-option'} aria-pressed={stageRejects} onClick={() => setStageRejects(true)}>あり</button>
          </div>
          {stageRejects && <div className="reject-settings">
            <p className="setting-help">使用ステージの中から、スターターとカウンターピックを選択してください。</p>
            <h3>スターターステージ</h3>
            <div className="stage-checkbox-grid">
              {stageOptions.filter(stage => selectedStages.includes(stage)).map(stage => <label className="stage-checkbox" key={stage}>
                <input type="checkbox" checked={starterStages.includes(stage)} onChange={() => toggleStage(stage, setStarterStages)} />
                <span>{stage}</span>
              </label>)}
            </div>
            <h3>カウンターピックステージ</h3>
            <div className="stage-checkbox-grid">
              {stageOptions.filter(stage => selectedStages.includes(stage)).map(stage => <label className="stage-checkbox" key={stage}>
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

        <fieldset className="setup-group">
          <legend>自動シード</legend>
          <div className="toggle-options">
            <button type="button" className={!autoSeed ? 'toggle-option selected' : 'toggle-option'} aria-pressed={!autoSeed} onClick={() => setAutoSeed(false)}>なし</button>
            <button type="button" className={autoSeed ? 'toggle-option selected' : 'toggle-option'} aria-pressed={autoSeed} onClick={() => setAutoSeed(true)}>あり</button>
          </div>
          <p className="setting-help">ありの場合、参加者のレート上位25%（最低2名）を離して配置します。その他の配置はランダムです。</p>
        </fieldset>

        <fieldset className="setup-group">
          <legend>キャラ宣言</legend>
          <div className="format-options">
            <button type="button" className={!characterDeclaration ? 'format-option selected' : 'format-option'} aria-pressed={!characterDeclaration} onClick={() => setCharacterDeclaration(false)}>なし</button>
            <button type="button" className={characterDeclaration ? 'format-option selected' : 'format-option'} aria-pressed={characterDeclaration} onClick={() => setCharacterDeclaration(true)}>あり</button>
          </div>
          {characterDeclaration && <small className="setting-help">参加者が使用キャラクターと1P〜8Pカラーを宣言します。送信後は変更できません。</small>}
        </fieldset>

        <label>配信先URL
          <input type="url" value={streamUrl} onChange={event => setStreamUrl(event.target.value)} placeholder="https://www.youtube.com/live/..." />
        </label>
        <label>配信台のフレンドコード
          <input type="text" value={streamFriendCode} onChange={event => setStreamFriendCode(event.target.value.toUpperCase())} placeholder="SW-0000-0000-0000" pattern="[A-Za-z0-9-]+" title="英数字とハイフンのみ" />
        </label>
        <label>大会説明
          <textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="大会について伝えたいことがあれば入力してください。" rows={4} maxLength={2000} />
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <a className="cancel-link" href="/">キャンセル</a>
          <button className="submit" type="submit">{editId ? '変更を保存する' : '大会を作成する'}</button>
        </div>
      </form>}
    </section>
    <footer>アミコネ</footer>
  </main>;
}
