import SiteHeader from '../components/SiteHeader';
import './globals.css';
export const metadata={title:'アミコネ',description:'amiibo大会を開催・参加・記録するためのプラットフォーム'};
export default function RootLayout({children}){return <html lang="ja"><body><SiteHeader />{children}</body></html>}
