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
    const results = (tournaments || []).map(row => {
      const t = row.data || {};
      const participants = new Map();
      for (const p of t.joinedPlayers || []) {
        if (p.isDemo) continue;
        const id = linkMap.get(String(p.userId || p.id)) || 'figure:' + String(p.userId || p.id);
        participants.set(String(p.id), { id, name: p.name || p.displayName || String(p.id) });
      }
      const matches = (t.bracket?.rounds || []).flatMap(round => round.flatMap(match => {
        if (!match.player1 || !match.player2 || !match.winnerId) return [];
        const first = participants.get(String(match.player1.id));
        const second = participants.get(String(match.player2.id));
        if (!first || !second || first.id === second.id) return [];
        const winner = String(match.winnerId) === String(match.player1.id) ? first : String(match.winnerId) === String(match.player2.id) ? second : null;
        return winner ? [{ winnerId: winner.id, loserId: winner.id === first.id ? second.id : first.id }] : [];
      }));
      return { id: row.id, name: t.name || '', date: t.date || t.createdAt || '', seriesTags: Array.isArray(t.seriesTags) ? t.seriesTags : [], players: [...participants.values()], matches };
    });
    return NextResponse.json({ tournaments: results }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Stats identity links:', error);
    return NextResponse.json({ error: '旧ID連携情報を取得できませんでした。' }, { status: 500 });
  }
}
