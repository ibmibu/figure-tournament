import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
const baseUrl = 'https://figure-tournament.vercel.app';
export async function generateMetadata({ params, searchParams }) {
  const { id } = await params;
  let name = '大会';
  let description = 'アミコネで大会の詳細を確認して参加しよう。';
  let imageVersion = '0';
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data } = await db.from('tournaments').select('data').eq('id', id).maybeSingle();
      const t = data?.data;
      if (t) {
        // Image URL changes only when visible card details change.
        // X and other crawlers may retain an earlier image URL for a long time.
        imageVersion = createHash('sha256').update(JSON.stringify([
          t.name, t.date, t.format, t.bestOf,
          t.stageRejects, t.stageSettings, t.stages,
        ])).digest('hex').slice(0, 16);
      }
      if (t?.name) {
        name = String(t.name).slice(0, 120);
        description = [t.format, t.date ? '開催：' + String(t.date).replace('T', ' ') : '', 'アミコネで大会の詳細を確認・参加'].filter(Boolean).join(' | ');
      }
    }
  } catch {}
  const title = name + ' | アミコネ';
  const suppliedVersion = (await searchParams)?.v;
  // Match the URL being shared so Discord does not reuse the prior card.
  const sharedVersion = typeof suppliedVersion === 'string' &&
    /^[0-9a-z_-]{1,48}$/i.test(suppliedVersion) ? suppliedVersion : '';
  const tournamentUrl = baseUrl + '/tournaments/' + encodeURIComponent(id) +
    (sharedVersion ? '?v=' + encodeURIComponent(sharedVersion) : '');
  // An explicit PNG path and a new release version avoid stale failed fetches.
  const imageUrl = baseUrl + '/api/og-tournament/' + encodeURIComponent(id) + '.png?v=og3-' + imageVersion;
  return {
    title, description,
    openGraph: { title, description, type: 'website', url: tournamentUrl, siteName: 'アミコネ', images: [{ url: imageUrl, width: 1200, height: 630, type: 'image/png', alt: name + ' 大会サムネイル' }] },
    twitter: { card: 'summary_large_image', title, description, images: [imageUrl] },
  };
}
export default function TournamentLayout({ children }) { return children; }
