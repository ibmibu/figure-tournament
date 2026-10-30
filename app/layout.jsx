import SiteHeader from '../components/SiteHeader';
import './globals.css';
export const metadata={metadataBase:new URL('https://figure-tournament.vercel.app'),title:'アミコネ',description:'amiibo大会を開催・参加・記録するためのプラットフォーム',openGraph:{title:'アミコネ',description:'amiibo大会を開催・参加・記録するためのプラットフォーム',type:'website',images:[{url:'/opengraph-image',width:1200,height:630}]},twitter:{card:'summary_large_image',title:'アミコネ',images:['/opengraph-image']}};
export default function RootLayout({children}){return <html lang="ja"><body><SiteHeader />{children}</body></html>}
