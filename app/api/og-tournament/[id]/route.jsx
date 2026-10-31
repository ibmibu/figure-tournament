import { ImageResponse } from 'next/og';
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const size = { width: 1200, height: 630 };

const stageLabel = stages => (Array.isArray(stages) ? stages : []).filter(Boolean).join(' / ');

// The previous font path was not committed, so Japanese text could fail to
// render and the English-only emergency card was shown instead.
// Google Fonts supports request-time TTF subsets for precisely the glyphs used.
async function loadJapaneseFont(text) {
  const glyphs = [...new Set(Array.from(String(text)))].join('');
  const base = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@900&text=' + encodeURIComponent(glyphs);
  const agents = [
    {},
    { 'User-Agent': 'Mozilla/5.0 (compatible; MSIE 8.0; Windows NT 6.1; Trident/4.0)' },
  ];
  for (const headers of agents) {
    const cssResponse = await fetch(base, { headers, next: { revalidate: 86400 } });
    if (!cssResponse.ok) continue;
    const css = await cssResponse.text();
    const match = css.match(/src:\s*url\(([^)]+)\)\s*format\('(truetype|opentype|woff)'\)/);
    if (!match) continue;
    const url = match[1].replace(/^['"]|['"]$/g, '');
    if (!url.startsWith('https://fonts.gstatic.com/')) continue;
    const fontResponse = await fetch(url, { next: { revalidate: 86400 } });
    if (fontResponse.ok) return fontResponse.arrayBuffer();
  }
  throw new Error('Japanese font could not be loaded in a Satori-compatible format');
}


export async function GET(_request, { params }) {
  const { id: rawId } = await params;
  // Both the legacy URL and the explicit .png URL remain valid.
  const id = String(rawId).endsWith('.png') ? String(rawId).slice(0, -4) : String(rawId);
  let name = '大会情報';
  let dateText = '開催日未定';
  let timeText = '--:--';
  let formatText = 'BO3';
  let stageRows = [];
  let stageCount = 0;
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
          const starters = Array.isArray(t.stageSettings?.starterStages) ? t.stageSettings.starterStages : [];
          const counters = Array.isArray(t.stageSettings?.counterpickStages) ? t.stageSettings.counterpickStages : [];
          stageCount = starters.length + counters.length;
          stageRows = [
            ['スターター', stageLabel(starters)],
            ['カウンター', stageLabel(counters)],
          ].filter(row => row[1]);
        } else {
          const stages = Array.isArray(t.stages) ? t.stages : [];
          stageCount = stages.length;
          if (stages.length) stageRows = [['使用ステージ', stageLabel(stages)]];
        }
      }
    }
  } catch {}
  let logo = '';
  try {
    const svg = await readFile(path.join(process.cwd(), 'public', 'amiconne-logo.svg'), 'utf8');
    logo = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  } catch {}

  let japaneseFont;
  try {
    const glyphText = [name, dateText, timeText, formatText,
      ...stageRows.flat(), 'アミコネ', 'ステージ情報未設定'].join('');
    japaneseFont = await loadJapaneseFont(glyphText);
  } catch (error) {
    console.error('Tournament OG Japanese font loading failed:', error);
  }

  // Reserve a taller bottom strip for the stage names. The previous layout
  // cropped long stage lists at maxHeight:55 and minHeight:85.
  const stageFontSize = stageCount >= 10 ? 17 : stageCount >= 7 ? 19 : 22;
  const stageFooterHeight = stageRows.length > 1 ? 154 : 130;
  const image = new ImageResponse(
    <div style={{
      width: '100%', height: '100%', background: '#ffffff',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'Noto Sans JP', fontWeight: 900,
      padding: '28px 62px 26px', color: '#17233a',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 100, flexShrink: 0 }}>
        {logo ? <img src={logo} alt="アミコネ" width={430} height={75} style={{ objectFit: 'contain', objectPosition: 'left center' }} /> : <div style={{ fontSize: 60, fontWeight: 900 }}>アミコネ</div>}
      </div>
      <div style={{
        display: 'flex', flexDirection: 'column', flex: 1,
        justifyContent: 'center', borderLeft: '8px solid #6045a8',
        paddingLeft: 32, marginTop: 10, marginBottom: 10,
        gap: 12, minHeight: 0,
      }}>
        <div style={{
          display: 'flex', fontSize: name.length > 45 ? 26 : name.length > 27 ? 32 : 38,
          fontWeight: 900, lineHeight: 1.3, color: '#17233a',
          maxHeight: 92, overflow: 'hidden', overflowWrap: 'anywhere',
        }}>{name}</div>
        <div style={{ display: 'flex', fontSize: 70, fontWeight: 900, lineHeight: 1.2 }}>{dateText}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 30 }}>
          <div style={{ display: 'flex', fontSize: 82, fontWeight: 800, color: '#6045a8', lineHeight: 1.05 }}>{timeText}</div>
          <div style={{ display: 'flex', fontSize: 33, fontWeight: 800, color: '#17233a' }}>{formatText}</div>
        </div>
      </div>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        height: stageFooterHeight, flexShrink: 0,
        justifyContent: 'flex-start', paddingTop: 7,
      }}>
        {stageRows.map(([label, value]) => (
          <div key={label} style={{
            display: 'flex', alignItems: 'flex-start',
            gap: 16, fontSize: stageFontSize, lineHeight: 1.35,
          }}>
            <div style={{
              display: 'flex', flexShrink: 0, color: '#17233a',
              fontWeight: 800, width: 170,
            }}>{label}</div>
            <div style={{
              display: 'flex', flex: 1, minWidth: 0, color: '#17233a',
              fontWeight: 900, overflowWrap: 'anywhere', whiteSpace: 'normal',
            }}>{value}</div>
          </div>
        ))}
        {!stageRows.length && <div style={{ display: 'flex', fontSize: 21, color: '#64748b' }}>ステージ情報未設定</div>}
      </div>
    </div>, { ...size, headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60' }, fonts: japaneseFont ? [{ name: 'Noto Sans JP', data: japaneseFont, weight: 900, style: 'normal' }] : [] }
  );
  // Fully buffer the PNG before returning it. Some social preview fetchers
  // require a complete binary response with an explicit content length.
  async function pngResponse(source, variant) {
    const buffer = new Uint8Array(await source.arrayBuffer());
    const valid = buffer.length > 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => buffer[index] === byte);
    if (!valid) throw new Error('OG generator returned an invalid PNG');
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(buffer.length),
        'Content-Disposition': 'inline; filename="tournament.png"',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'X-Content-Type-Options': 'nosniff',
        'X-OG-Variant': variant,
      },
    });
  }
  try {
    return await pngResponse(image, 'tournament');
  } catch (error) {
    console.error('Tournament OG image rendering failed:', id, error);
    // A failed dynamic render must still return an actual image, not an
    // HTML error body that Discord caches as a broken embed.
    const fallback = new ImageResponse(
      <div style={{
        width: '100%', height: '100%', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: '#ffffff', color: '#6045a8',
        fontSize: 84, fontWeight: 800,
      }}>AmiCone</div>,
      { ...size }
    );
    return pngResponse(fallback, 'fallback');
  }
}
