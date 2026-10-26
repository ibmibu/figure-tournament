'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
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
    { label: '戦績', href: '/stats', icon: '🏆' },
    { label: 'ホーム', href: '/', icon: '⌂' },
    { label: 'マイページ', href: '/mypage', icon: '●' },
  ];

  return <>
    <header className="site-header">
      <div className="site-header-left">
        <Link className="site-logo" href="/" aria-label="ホームに戻る"><img className="site-logo-image" src="/amiconne-logo.svg" alt="アミコネ" width="720" height="124" /></Link>
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
        return <Link key={tab.href} href={tab.href} className={active ? "bottom-tab active" : "bottom-tab"} aria-current={active ? "page" : undefined}>
          <span className="bottom-tab-icon" aria-hidden="true">{tab.icon}</span>
          <span>{tab.label}</span>
        </Link>;
      })}
    </nav>
  </>;
}
