'use client';

import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '../lib/supabase/client';

export default function SiteHeader() {
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabaseBrowserClient();
      supabase.auth.getSession().then(({ data }) => {
        setSignedIn(Boolean(data.session?.user));
        setReady(true);
      }).catch(() => setReady(true));
      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        setSignedIn(Boolean(session?.user));
        setReady(true);
      });
      return () => listener.subscription.unsubscribe();
    } catch {
      setReady(true);
    }
  }, []);

  async function signOut() {
    try {
      await getSupabaseBrowserClient().auth.signOut();
      window.location.href = '/';
    } catch {
      window.location.href = '/';
    }
  }

  return <header className="site-header">
    <div className="site-header-left">
      <button type="button" className="menu-toggle" aria-label={menuOpen ? 'メニューを閉じる' : 'メニューを開く'} aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>
        <span></span><span></span><span></span>
      </button>
      <a className="site-logo" href="/">Figure Tournament</a>
    </div>
    <div className="site-header-right">
      {ready && (signedIn
        ? <button type="button" className="header-auth-button" onClick={signOut}>ログアウト</button>
        : <a className="header-auth-button" href="/login">ログイン</a>)}
    </div>
    {menuOpen && <nav className="site-menu">
      <a href="/">大会一覧</a>
      <a href="/tournaments/new">大会を作成</a>
      {ready && (signedIn
        ? <button type="button" onClick={signOut}>ログアウト</button>
        : <a href="/login">ログイン</a>)}
    </nav>}
  </header>;
}
