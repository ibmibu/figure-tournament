'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getSupabaseBrowserClient } from '../lib/supabase/client';

export default function SiteHeader() {
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);
  const pathname = usePathname();

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

  const tabs = [
    { label: '戦績', href: '/results', icon: '🏆' },
    { label: 'ホーム', href: '/', icon: '⌂' },
    { label: 'マイページ', href: '/mypage', icon: '●' },
  ];

  return <>
    <header className="site-header">
      <div className="site-header-left">
        <a className="site-logo" href="/">Figure Tournament</a>
      </div>
      <div className="site-header-right">
        {ready && (signedIn
          ? <button type="button" className="header-auth-button" onClick={signOut}>ログアウト</button>
          : <a className="header-auth-button" href="/login">ログイン</a>)}
      </div>
    </header>
    <nav className="bottom-tab-bar" aria-label="メインナビゲーション">
      {tabs.map(tab => {
        const active = tab.href === '/' ? pathname === '/' : pathname === tab.href || pathname.startsWith(tab.href + '/');
        return <a key={tab.href} href={tab.href} className={active ? 'bottom-tab active' : 'bottom-tab'} aria-current={active ? 'page' : undefined}>
          <span className="bottom-tab-icon" aria-hidden="true">{tab.icon}</span>
          <span>{tab.label}</span>
        </a>;
      })}
    </nav>
  </>;
}
