'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '../../lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const supabase = getSupabaseBrowserClient();
      supabase.auth.getSession().then(({ data }) => {
        const next = new URLSearchParams(window.location.search).get('next');
        const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
        if (data.session) router.replace(safeNext);
      });
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [router]);

  async function signInWithGoogle() {
    setError('');
    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const params = new URLSearchParams(window.location.search);
      const next = params.get('next');
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`,
        },
      });
      if (signInError) throw signInError;
    } catch (signInError) {
      setError(signInError.message || 'Googleログインを開始できませんでした。');
      setLoading(false);
    }
  }

  return <main className="page">
    <section className="intro">
      <a className="back-link" href="/">← 大会一覧に戻る</a>
      <h1>ログイン</h1>
      <p>Googleアカウントでアミコネにログインします。</p>
    </section>
    <section className="login-actions">
      <button className="submit" type="button" onClick={signInWithGoogle} disabled={loading}>
        {loading ? '接続しています…' : 'Googleでログイン'}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
    <footer>アミコネ</footer>
  </main>;
}
