import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const size = { width: 1200, height: 630 };

export async function GET() {
  let logo = '';
  try {
    const svg = await readFile(path.join(process.cwd(), 'public', 'amiconne-logo.svg'), 'utf8');
    logo = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  } catch {}

  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#ffffff', color: '#6045a8' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 170, width: 850 }}>
        {logo
          ? <img src={logo} alt="アミコネ" width={720} height={124} style={{ objectFit: 'contain' }} />
          : <div style={{ fontSize: 100, fontWeight: 900, color: '#171717' }}>アミコネ</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28, marginTop: 54, fontSize: 29, fontWeight: 600 }}>
        <div>大会開催</div>
        <div style={{ color: '#c4b5d9', fontWeight: 400 }}>/</div>
        <div>大会参加</div>
        <div style={{ color: '#c4b5d9', fontWeight: 400 }}>/</div>
        <div>戦績管理</div>
      </div>
    </div>,
    size
  );
}
