'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '../../../lib/supabase/client';

export default function MyOverlayPage() {
  const [ownerId, setOwnerId] = useState('');
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getSupabaseBrowserClient().auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session?.user?.id) {
        window.location.href = '/login?next=/mypage/overlay';
        return;
      }
      setOwnerId(data.session.user.id);
      setUrl(window.location.origin + '/overlay?owner=' + encodeURIComponent(data.session.user.id));
    }).catch(() => { if (active) setError('ログイン情報を取得できませんでした。'); });
    return () => { active = false; };
  }, []);

  async function copyUrl() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setError('');
    } catch {
      setError('URLをコピーできませんでした。');
    }
  }

  return <main className="page mypage-layout">
    <section className="my-page">
      <h1>OBSオーバーレイ</h1>
      <Link className="my-colors-back" href="/mypage">← マイページに戻る</Link>
      <section className="my-results my-color-panel" style={{ marginTop: 24 }}>
        <h2>スコアボードのURL</h2>
        <p className="setting-help">主催者アカウント専用のURLです。OBSに一度登録すれば、大会が変わってもURLを変更する必要はありません。</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 14 }}>
          <input aria-label="OBSオーバーレイURL" readOnly value={url} placeholder="読み込み中…" style={{ flex: '1 1 260px', minWidth: 0 }} onFocus={e => e.target.select()} />
          <button type="button" className="submit" disabled={!ownerId} onClick={copyUrl}>{copied ? 'コピーしました' : 'URLをコピー'}</button>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <h2 style={{ marginTop: 28 }}>OBSのブラウザソース設定</h2>
        <p className="setting-help">OBSで「ソースを追加」→「ブラウザ」を選び、上のURLを設定してください。</p>
        <p><strong>幅：960 px　高さ：90 px</strong></p>
        <p className="setting-help">背景は透明です。スコアや配信台の情報は自動更新されます。決勝終了後も次の大会が始まるまで最終スコアを表示します。</p>
      </section>
      <section className="my-results my-color-panel" style={{ marginTop: 24 }} aria-labelledby="scoreboard-editor-heading">
        <h2 id="scoreboard-editor-heading">スコアボードエディター</h2>
        <p className="setting-help">選手名・スコア・大会情報の配置や色を自由に調整できる機能を予定しています。左右対称のレイアウトにも対応予定です。</p>
        <p className="setting-help" style={{ marginTop: 12, fontWeight: 700 }}>近日実装予定</p>
      </section>
    </section>
  </main>;
}
