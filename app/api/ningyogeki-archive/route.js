import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const response = await fetch('https://raw.githubusercontent.com/ibmibu/ningyogeki-stats/main/public/data/ningyogeki-archive.json', { next: { revalidate: 3600 } });
    if (!response.ok) throw new Error('Archive fetch failed: ' + response.status);
    const body = await response.text();
    return new NextResponse(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } });
  } catch (error) { return NextResponse.json({error:'過去の大会データを読み込めませんでした。'}, {status:502}); }
}
