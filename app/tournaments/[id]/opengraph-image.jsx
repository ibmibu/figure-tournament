import { ImageResponse } from 'next/og';
import { createClient } from '@supabase/supabase-js';
export const runtime = 'nodejs';
export const alt = 'アミコネ 大会案内';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export default async function Image({ params }) {
  const { id } = await params;
  let name = '大会情報';
  let detail = 'アミコネで大会に参加しよう';
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data } = await db.from('tournaments').select('data').eq('id', id).maybeSingle();
      const t = data?.data;
      if (t?.name) {
        name = String(t.name).slice(0, 70);
        detail = [t.format, t.date ? String(t.date).replace('T', ' ') : ''].filter(Boolean).join('   /   ');
      }
    }
  } catch {}
  return new ImageResponse(
    <div style={{ width:'100%', height:'100%', background:'#f5f7fa', display:'flex', flexDirection:'column', justifyContent:'space-between', padding:'66px 76px', borderTop:'24px solid #6045a8', color:'#142136' }}>
      <div style={{ display:'flex', alignItems:'center', gap:18 }}>
        <div style={{ width:16, height:52, background:'#6045a8' }} />
        <div style={{ fontSize:46, fontWeight:900 }}>アミコネ</div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:28 }}>
        <div style={{ fontSize:name.length > 30 ? 47 : 64, fontWeight:800, lineHeight:1.25, overflow:'hidden', maxHeight:230 }}>{name}</div>
        <div style={{ fontSize:31, color:'#6045a8', fontWeight:700 }}>{detail}</div>
      </div>
      <div style={{ fontSize:25, color:'#687587' }}>amiibo大会プラットフォーム</div>
    </div>, size
  );
}
