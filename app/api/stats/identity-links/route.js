import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

// Only expose links for participants in public tournament brackets.
export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase is not configured');
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: rows, error } = await db.from('legacy_player_links').select('legacy_player_id,user_id');
    if (error) throw error;
    const { data: tournaments, error: tournamentError } = await db.from('tournaments').select('id,data').order('created_at', { ascending: true });
    if (tournamentError) throw tournamentError;
    const linkMap = new Map((rows || []).map(row => [String(row.user_id), String(row.legacy_player_id)]));
    // Only finalized brackets belong in the shared public record. Drafts and active events are excluded.
    const results = (tournaments || []).filter(row => {
      const bracket = row.data?.bracket;
      const final = bracket?.rounds?.at(-1)?.[0];
      return bracket?.complete === true && final?.player1 && final?.player2 && final?.winnerId &&
        [final.player1, final.player2].some(player => String(player.id) === String(final.winnerId));
    }).map(row => {
      const t = row.data || {};
      const participants = new Map();
      const characterReports = [];
      for (const p of t.joinedPlayers || []) {
        if (p.isDemo) continue;
        const id = linkMap.get(String(p.userId || p.id)) || 'figure:' + String(p.userId || p.id);
        participants.set(String(p.id), { id, name: p.name || p.displayName || String(p.id) });
        const report = t.characterReports?.[String(p.id)];
        if (Array.isArray(report?.characters) && report.characters.length) {
          characterReports.push({ playerId: id, characters: [...new Set(report.characters.map(c => String(c?.fighter || '').trim()).filter(Boolean))] });
        }
      }
      const matches = (t.bracket?.rounds || []).flatMap(round => round.flatMap(match => {
        if (!match.player1 || !match.player2 || !match.winnerId) return [];
        const first = participants.get(String(match.player1.id));
        const second = participants.get(String(match.player2.id));
        if (!first || !second || first.id === second.id) return [];
        const winner = String(match.winnerId) === String(match.player1.id) ? first : String(match.winnerId) === String(match.player2.id) ? second : null;
        return winner ? [{ winnerId: winner.id, loserId: winner.id === first.id ? second.id : first.id }] : [];
      }));
      const final = t.bracket.rounds.at(-1)?.[0];
      const championId = participants.get(String(final.winnerId))?.id || null;
      const runnerUp = [final.player1, final.player2].find(p => p && String(p.id) !== String(final.winnerId));
      const runnerUpId = runnerUp ? participants.get(String(runnerUp.id))?.id || null : null;
      const semifinal = t.bracket.rounds.length > 1 ? t.bracket.rounds.at(-2) : [];
      const thirdPlaceIds = [...new Set((semifinal || []).flatMap(match => {
        if (!match.winnerId) return [];
        const loser = [match.player1, match.player2].find(p => p && String(p.id) !== String(match.winnerId));
        const mapped = loser && participants.get(String(loser.id));
        return mapped ? [mapped.id] : [];
      }))];
      return { id: row.id, characterReports, championId, runnerUpId, thirdPlaceIds, name: t.name || '', date: t.date || t.createdAt || '', seriesTags: Array.isArray(t.seriesTags) ? t.seriesTags : [], players: [...participants.values()], matches };
    });
    return NextResponse.json({ tournaments: results }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Stats identity links:', error);
    return NextResponse.json({ error: '旧ID連携情報を取得できませんでした。' }, { status: 500 });
  }
}
