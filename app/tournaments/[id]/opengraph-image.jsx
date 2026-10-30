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
  let dateText = '開催日未定';
  let timeText = '--:--';
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
          const match = String(t.date).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
          if (match) {
            const weekday = ['日','月','火','水','木','金','土'][new Date(Date.UTC(Number(match[1]), Number(match[2])-1, Number(match[3]))).getUTCDay()];
            dateText = Number(match[2]) + '月' + Number(match[3]) + '日（' + weekday + '）';
            timeText = match[4] + ':' + match[5];
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
    <div style={{ width:'100%', height:'100%', background:'#ffffff', display:'flex', flexDirection:'column', padding:'46px 76px 40px', color:'#17233a' }}>
      <div style={{ display:'flex', alignItems:'center', height:64 }}>
        {logo ? <img src={logo} alt="アミコネ" width={290} height={50} style={{ objectFit:'contain', objectPosition:'left center' }} /> : <div style={{ fontSize:44, fontWeight:900 }}>アミコネ</div>}
      </div>
      <div style={{ display:'flex', flexDirection:'column', flex:1, justifyContent:'center', borderLeft:'7px solid #6045a8', paddingLeft:32, marginTop:28, marginBottom:22, gap:13, minHeight:0 }}>
        <div style={{ display:'flex', color:'#64748b', fontSize:name.length > 46 ? 24 : 30, lineHeight:1.25, maxHeight:78, overflow:'hidden', overflowWrap:'anywhere' }}>{name}</div>
        <div style={{ display:'flex', fontSize:62, fontWeight:800, lineHeight:1.2 }}>{dateText}</div>
        <div style={{ display:'flex', alignItems:'baseline', gap:32 }}>
          <div style={{ display:'flex', color:'#6045a8', fontSize:76, fontWeight:800, lineHeight:1.1 }}>{timeText}</div>
          <div style={{ display:'flex', fontSize:34, fontWeight:800 }}>{formatText}</div>
        </div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:10, borderTop:'2px solid #e2e8f0', paddingTop:18, minHeight:stageRows.length ? 90 : 48 }}>
        {stageRows.map(([label, value]) => (
          <div key={label} style={{ display:'flex', gap:18, alignItems:'flex-start', fontSize:21, lineHeight:1.25 }}>
            <div style={{ display:'flex', flexShrink:0, width:145, color:'#64748b', fontWeight:700 }}>{label}</div>
            <div style={{ display:'flex', flex:1, color:'#334155', maxHeight:55, overflow:'hidden' }}>{value}</div>
          </div>
        ))}
        {!stageRows.length && <div style={{ display:'flex', fontSize:21, color:'#64748b' }}>amiibo大会プラットフォーム</div>}
      </div>
    </div>, size
  );
}
