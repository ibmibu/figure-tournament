import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCharacterReportPlacement, repairPrematureAdvances } from '../../../../lib/tournament-bracket-admin';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: '大会IDが必要です。' }, { status: 400 });
    const { data: tournament, error } = await db.from('tournaments')
      .select('name:data->>name,joinedPlayers:data->joinedPlayers,bracket:data->bracket,resultPlacements:data->resultPlacements,characterReports:data->characterReports')
      .eq('id', id).maybeSingle();
    if (error) throw error;
    if (!tournament) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });
    // Public read-only report summary: only entrant names, placements, fighters and colors.
    const bracket = repairPrematureAdvances(tournament).bracket;
    const placements = tournament.resultPlacements || [];
    const placeRank = place => ({ '優勝': 0, '準優勝': 1, '3位': 2, 'ベスト4': 2 })[place] ?? 99;
    const players = (tournament.joinedPlayers || []).filter(p => !p.isDemo).map(p => ({
      id: String(p.id),
      name: p.name || p.displayName || '名前未登録',
      characters: tournament.characterReports?.[String(p.id)]?.characters || [],
      place: getCharacterReportPlacement(bracket, p.id) || placements.find(entry => String(entry.playerId) === String(p.id))?.place || ''
    })).filter(p => p.characters.length > 0).sort((a, b) => placeRank(a.place) - placeRank(b.place));
    // Count all actual entrants, not just the players who filed reports.
    const participantCount = (tournament.joinedPlayers || []).filter(p => !p.isDemo).length;
    return NextResponse.json({ name: tournament.name || '', participantCount, players }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Public character reports:', error);
    return NextResponse.json({ error: 'キャラ報告を読み込めませんでした。' }, { status: 500 });
  }
}
