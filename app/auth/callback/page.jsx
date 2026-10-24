'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseBrowserClient } from '../../../lib/supabase/client';

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState('ログインを確認しています…');

  useEffect(() => {
    let active = true;
    async function finishSignIn() {
      try {
        const supabase = getSupabaseBrowserClient();
        const code = searchParams.get('code');
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data.session) throw new Error('ログインを完了できませんでした。');
        const next = searchParams.get('next');
        const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
        router.replace(safeNext);
      } catch (error) {
        if (active) setMessage(error.message || 'ログインに失敗しました。');
      }
    }
    finishSignIn();
    return () => { active = false; };
  }, [router, searchParams]);

  return <main className="page"><section className="intro"><h1>ログイン処理中</h1><p>{message}</p><a className="back-link" href="/login">ログイン画面へ戻る</a></section></main>;
}

export default function AuthCallbackPage() {
  return <Suspense fallback={<main className="page"><section className="intro"><h1>ログイン処理中</h1><p>ログイン情報を確認しています…</p></section></main>}>
    <AuthCallbackContent />
  </Suspense>;
}
