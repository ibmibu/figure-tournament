import { ImageResponse } from 'next/og';
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const alt = 'アミコネ 大会案内';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const stageLabel = stages => (Array.isArray(stages) ? stages : []).filter(Boolean).join(' / ');

export default async function Image({ params }) {
  const { id } = await params;
  let name = '大会情報';
  let detail = 'アミコネで大会に参加しよう';
  let stageRows = [];
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data } = await db.from('tournaments').select('data').eq('id', id).maybeSingle();
      const t = data?.data;
      if (t?.name) {
        name = String(t.name).slice(0, 90);
        detail = [t.format, t.date ? String(t.date).replace('T', ' ') : ''].filter(Boolean).join('   /   ');
        if (t.stageRejects) {
          stageRows = [
            ['スターター', stageLabel(t.stageSettings?.starterStages)],
            ['カウンター', stageLabel(t.stageSettings?.counterpickStages)],
          ].filter(row => row[1]);
        } else {
          const stages = stageLabel(t.stages);
          if (stages) stageRows = [['使用ステージ', stages]];
        }
      }
    }
  } catch {}
  let logo = '';
  try {
    const svg = await readFile(path.join(process.cwd(), 'public', 'amiconne-logo.svg'), 'utf8');
    logo = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  } catch {}

  return new ImageResponse(
    <div style={{ width:'100%', height:'100%', background:'#f5f7fa', display:'flex', flexDirection:'column', padding:'48px 70px 42px', borderTop:'20px solid #6045a8', color:'#142136' }}>
      <div style={{ display:'flex', alignItems:'center', height:78 }}>
        {logo ? <img src={logo} alt="アミコネ" width={320} height={56} style={{ objectFit:'contain', objectPosition:'left center' }} /> : <div style={{ fontSize:44, fontWeight:900 }}>アミコネ</div>}
      </div>
      <div style={{ display:'flex', flexDirection:'column', justifyContent:'center', flex:1, gap:20, minHeight:0 }}>
        <div style={{ display:'flex', fontSize:name.length > 45 ? 39 : name.length > 26 ? 49 : 64, fontWeight:800, lineHeight:1.2, maxHeight:168, overflow:'hidden', overflowWrap:'anywhere' }}>{name}</div>
        <div style={{ display:'flex', fontSize:30, color:'#6045a8', fontWeight:700 }}>{detail}</div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:10, paddingTop:18, borderTop:'2px solid #d9dce6', minHeight:stageRows.length ? 98 : 50 }}>
        {stageRows.map(([label, value]) => (
          <div key={label} style={{ display:'flex', alignItems:'flex-start', gap:18, fontSize:20, lineHeight:1.3 }}>
            <div style={{ display:'flex', flexShrink:0, width:145, color:'#6045a8', fontWeight:800 }}>{label}</div>
            <div style={{ display:'flex', color:'#3c465a', flex:1, overflow:'hidden', maxHeight:54 }}>{value}</div>
          </div>
        ))}
        {!stageRows.length && <div style={{ display:'flex', fontSize:22, color:'#687587' }}>amiibo大会プラットフォーム</div>}
      </div>
    </div>, size
  );
}
