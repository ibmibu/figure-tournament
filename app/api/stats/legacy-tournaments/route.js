import { NextResponse } from 'next/server';
import { convertLegacyArchive } from '../../../../lib/legacy-tournament-converter';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const response = await fetch('https://raw.githubusercontent.com/ibmibu/ningyogeki-stats/main/public/data/ningyogeki-archive.json', { next: { revalidate: 3600 } });
    if (!response.ok) throw new Error('Archive fetch failed');
    const archive = await response.json();
    const tournaments = convertLegacyArchive(archive);
    const data = archive.data || archive;
    const count = tournaments.reduce((n, t) => n + t.matches.length, 0);
    if (count !== data.records.length || tournaments.length !== data.tournaments.length) throw new Error('Archive validation mismatch');
    return NextResponse.json({ tournaments, validation: { tournaments: tournaments.length, matches: count, sourceTournaments: data.tournaments.length, sourceMatches: data.records.length, verified: true } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Legacy conversion:', error);
    return NextResponse.json({ error: '過去大会の変換または検証に失敗しました。' }, { status: 502 });
  }
}
