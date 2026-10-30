import { createClient } from '@supabase/supabase-js';
const baseUrl = 'https://figure-tournament.vercel.app';
export async function generateMetadata({ params }) {
  const { id } = await params;
  let name = '大会';
  let description = 'アミコネで大会の詳細を確認して参加しよう。';
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data } = await db.from('tournaments').select('data').eq('id', id).maybeSingle();
      const t = data?.data;
      if (t?.name) {
        name = String(t.name).slice(0, 120);
        description = [t.format, t.date ? '開催：' + String(t.date).replace('T', ' ') : '', 'アミコネで大会の詳細を確認・参加'].filter(Boolean).join(' | ');
      }
    }
  } catch {}
  const title = name + ' | アミコネ';
  const imageUrl = baseUrl + '/tournaments/' + encodeURIComponent(id) + '/opengraph-image';
  return {
    title, description,
    openGraph: { title, description, type: 'website', url: baseUrl + '/tournaments/' + encodeURIComponent(id), siteName: 'アミコネ', images: [{ url: imageUrl, width: 1200, height: 630 }] },
    twitter: { card: 'summary_large_image', title, description, images: [imageUrl] },
  };
}
export default function TournamentLayout({ children }) { return children; }
