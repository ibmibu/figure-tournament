'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

export default function SiteHeader() {
  const pathname = usePathname();
  const isObsOverlay = (/^\/tournaments\/[^/]+\/overlay\/?$/.test(pathname || '') || pathname === '/overlay');

  const tabs = [
    { label: '戦績', href: '/stats' },
    { label: 'ホーム', href: '/' },
    { label: 'マイページ', href: '/mypage' },
  ];

  if (isObsOverlay) return null;

  return <>
    <header className="site-header">
      <div className="site-header-left">
        <Link className="site-logo" href="/" aria-label="ホームに戻る"><img className="site-logo-image" src="/amiconne-logo.svg" alt="アミコネ" width="720" height="124" /></Link>
      </div>
    </header>
    <nav className="bottom-tab-bar" aria-label="メインナビゲーション">
      {tabs.map(tab => {
        const active = tab.href === '/' ? pathname === '/' : pathname === tab.href || pathname.startsWith(tab.href + '/');
        return <Link key={tab.href} href={tab.href} className={active ? "bottom-tab active" : "bottom-tab"} aria-current={active ? "page" : undefined}>
          <span className="bottom-tab-icon" aria-hidden="true">{tab.href === '/stats' ? <svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="2" width="4" height="19" rx="1"/></svg> : tab.href === '/' ? <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 11.2 12 2l10 9.2v10.1a.7.7 0 0 1-.7.7h-6.1v-7h-6.4v7H2.7a.7.7 0 0 1-.7-.7z"/></svg> : <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7.2" r="4.2"/><path d="M3.5 22v-2.2a8.5 8.5 0 0 1 17 0V22z"/></svg>}</span><span className="bottom-tab-label">{tab.label}</span>
        </Link>;
      })}
    </nav>
  </>;
}
