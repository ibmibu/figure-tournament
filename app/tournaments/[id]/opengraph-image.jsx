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
  let dateText = '開催日時未定';
  let formatText = 'BO3';
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
        formatText = String(t.format || (t.bestOf ? 'BO' + t.bestOf : 'BO3'));
        if (t.date) {
          const match = String(t.date).match(/^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})/);
          if (match) {
            const weekday = ['日','月','火','水','木','金','土'][new Date(Date.UTC(Number(match[1]), Number(match[2])-1, Number(match[3]))).getUTCDay()];
            dateText = match[2] + '/' + match[3] + '（' + weekday + '） ' + match[4] + ':' + match[5];
          } else dateText = String(t.date).replace('T', ' ');
        }
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
    <div style={{ width:'100%', height:'100%', background:'#f5f7fa', display:'flex', flexDirection:'column', padding:'42px 70px 40px', borderTop:'20px solid #6045a8', color:'#142136' }}>
      <div style={{ display:'flex', alignItems:'center', height:70 }}>
        {logo ? <img src={logo} alt="アミコネ" width={290} height={50} style={{ objectFit:'contain', objectPosition:'left center' }} /> : <div style={{ fontSize:44, fontWeight:900 }}>アミコネ</div>}
      </div>
      <div style={{ display:'flex', flexDirection:'column', justifyContent:'center', flex:1, gap:22, minHeight:0 }}>
        <div style={{ display:'flex', fontSize:name.length > 45 ? 31 : name.length > 26 ? 37 : 43, fontWeight:750, lineHeight:1.25, maxHeight:116, overflow:'hidden', overflowWrap:'anywhere' }}>{name}</div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:'#e9e2f5', borderRadius:16, padding:'24px 30px', gap:18 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:7, minWidth:0 }}>
            <div style={{ display:'flex', color:'#6045a8', fontSize:19, fontWeight:700 }}>開催日時</div>
            <div style={{ display:'flex', color:'#35215e', fontSize:38, fontWeight:800 }}>{dateText}</div>
          </div>
          <div style={{ display:'flex', flexShrink:0, background:'#ffffff', color:'#6045a8', borderRadius:12, padding:'13px 20px', fontSize:29, fontWeight:800 }}>{formatText}</div>
        </div>
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
