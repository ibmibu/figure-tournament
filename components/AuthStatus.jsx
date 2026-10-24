'use client';

import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '../lib/supabase/client';

export default function AuthStatus() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabaseBrowserClient();
      supabase.auth.getSession().then(({ data }) => {
        setUser(data.session?.user || null);
        setReady(true);
      }).catch(() => setReady(true));
      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user || null);
        setReady(true);
      });
      return () => listener.subscription.unsubscribe();
    } catch {
      setReady(true);
    }
  }, []);

  async function signOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  if (!ready) return null;
  if (!user) return <div className="auth-status"><a className="button-link" href="/login">ログイン</a></div>;

  return <div className="auth-status">
    <span>{user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'ログイン中'}</span>
    <button type="button" className="cancel-link" onClick={signOut}>ログアウト</button>
  </div>;
}
