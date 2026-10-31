import { ImageResponse } from 'next/og';
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const alt = 'アミコネ 大会案内';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const stageLabel = stages => (Array.isArray(stages) ? stages : []).filter(Boolean).join(' / ');

export async function GET(_request, { params }) {
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
    <div style={{ width: '100%', height: '100%', background: '#ffffff', display: 'flex', flexDirection: 'column', padding: '44px 72px 38px', color: '#17233a' }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 74 }}>
        {logo ? <img src={logo} alt="アミコネ" width={330} height={57} style={{ objectFit: 'contain', objectPosition: 'left center' }} /> : <div style={{ fontSize: 46, fontWeight: 900 }}>アミコネ</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', borderLeft: '6px solid #6045a8', paddingLeft: 32, marginTop: 30, marginBottom: 25, gap: 13, minHeight: 0 }}>
        <div style={{ display: 'flex', fontSize: name.length > 45 ? 24 : name.length > 27 ? 28 : 33, lineHeight: 1.3, color: '#64748b', maxHeight: 85, overflow: 'hidden', overflowWrap: 'anywhere' }}>{name}</div>
        <div style={{ display: 'flex', fontSize: 59, fontWeight: 800, lineHeight: 1.25 }}>{dateText}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 34 }}>
          <div style={{ display: 'flex', fontSize: 79, fontWeight: 800, color: '#6045a8', lineHeight: 1.1 }}>{timeText}</div>
          <div style={{ display: 'flex', fontSize: 34, fontWeight: 800, color: '#17233a' }}>{formatText}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, minHeight: 104 }}>
        <div style={{ display: 'flex', fontSize: 17, fontWeight: 700, letterSpacing: 2, color: '#64748b' }}>STAGE RULE</div>
        {stageRows.map(([label, value]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 16, fontSize: 21, lineHeight: 1.3 }}>
            <div style={{ display: 'flex', flexShrink: 0, color: '#64748b', width: 150 }}>{label}</div>
            <div style={{ display: 'flex', flex: 1, color: '#334155', maxHeight: 55, overflow: 'hidden' }}>{value}</div>
          </div>
        ))}
        {!stageRows.length && <div style={{ display: 'flex', fontSize: 21, color: '#64748b' }}>ステージ情報未設定</div>}
      </div>
    </div>, size
  );
}
