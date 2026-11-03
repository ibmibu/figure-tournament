import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { findParticipantOverlay } from '../../../../lib/overlay-participant-match';
import { editableSetScores, getMatchReportMode, hasStreamUrl } from '../../../../lib/tournament-set-result';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams;
    const id = params.get('id');
    const owner = params.get('owner');
    const player = params.get('player');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if ((!id && !owner && !player) || (id && id.length > 128) ||
        (owner && !uuid.test(owner)) || (player && !uuid.test(player)) ||
        Number(Boolean(id)) + Number(Boolean(owner)) + Number(Boolean(player)) !== 1) {
      return NextResponse.json({ error: 'オーバーレイの指定が不正です。' }, { status: 400 });
    }
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    let row;
    let personalMatch = null;
    if (player) {
      // Query only tournaments the account entered, never every private
      // tournament. OBS receives only the public match names and scores.
      const { data: rows, error } = await db.from('tournaments')
        .select('id,data,created_at')
        .contains('data', { joinedPlayers: [{ userId: player }] })
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      let selected = findParticipantOverlay(rows, player);
      if (!selected && !rows?.length) {
        // Earlier linked accounts can have id without userId.
        const fallback = await db.from('tournaments')
          .select('id,data,created_at')
          .contains('data', { joinedPlayers: [{ id: player }] })
          .order('created_at', { ascending: false }).limit(100);
        if (fallback.error) throw fallback.error;
        selected = findParticipantOverlay(fallback.data, player);
      }
      row = selected?.row;
      personalMatch = selected?.item || null;
    } else if (owner) {
      // One account URL works for both organizer and participant.
      // A currently running tournament that this account organizes wins;
      // otherwise an active match the account is playing takes precedence.
      // Older ?owner= links therefore continue working without OBS changes.
      const [ownedResult, enteredResult] = await Promise.all([
        db.from('tournaments').select('data,created_at')
          .contains('data', { ownerUserId: owner })
          .order('created_at', { ascending: false }).limit(100),
        db.from('tournaments').select('data,created_at')
          .contains('data', { joinedPlayers: [{ userId: owner }] })
          .order('created_at', { ascending: false }).limit(100),
      ]);
      if (ownedResult.error) throw ownedResult.error;
      if (enteredResult.error) throw enteredResult.error;

      const organizerRows = (ownedResult.data || []).filter(r =>
        r.data?.bracket?.rounds?.length &&
        (r.data.status === '対戦中' || r.data.status === '終了' || r.data.bracket.complete));
      const dateOf = r => Date.parse(r?.data?.createdAt || r?.created_at || '') || 0;
      const latest = list => [...list].sort((a, b) => dateOf(b) - dateOf(a))[0] || null;
      const currentOrganizer = latest(organizerRows.filter(r =>
        r.data.status === '対戦中' && !r.data.bracket.complete));
      let participant = findParticipantOverlay(enteredResult.data, owner);
      if (!participant && !enteredResult.data?.length) {
        // Historic registrations may use the account UUID in id alone.
        const legacy = await db.from('tournaments').select('data,created_at')
          .contains('data', { joinedPlayers: [{ id: owner }] })
          .order('created_at', { ascending: false }).limit(100);
        if (legacy.error) throw legacy.error;
        participant = findParticipantOverlay(legacy.data, owner);
      }

      if (currentOrganizer) {
        row = currentOrganizer;
      } else if (participant?.priority > 1) {
        row = participant.row;
        personalMatch = participant.item;
      } else {
        const finishedOrganizer = latest(organizerRows);
        if (participant && (!finishedOrganizer ||
            dateOf(participant.row) > dateOf(finishedOrganizer))) {
          row = participant.row;
          personalMatch = participant.item;
        } else {
          row = finishedOrganizer;
        }
      }
    } else {
      const result = await db.from('tournaments').select('data').eq('id', id).maybeSingle();
      if (result.error) throw result.error;
      row = result.data;
    }
    if (!row) return NextResponse.json({ name: '', match: null, status: 'unassigned' }, { headers: { 'Cache-Control': 'no-store' } });
    const t = row.data || {};
    const rounds = t.bracket?.rounds || [];
    const matches = rounds.flat();
    const organizerMatch = hasStreamUrl(t)
      ? matches.find(m => (t.bracket?.complete || !m.winnerId) && m.player1 && m.player2 &&
          [m.player1, m.player2].some(p => !p.isDemo && String(p.userId || p.id) === String(t.ownerUserId)))
      : null;
    const explicit = t.streamMatchManual === true || t.streamMatchId !== undefined;
    // Keep the assigned match visible after its winner is confirmed until the organizer changes or clears the assignment.
    const holdUntil = Date.parse(t.streamHoldUntil || '') || 0;
    const held = holdUntil > Date.now()
      ? matches.find(m => String(m.id) === String(t.streamHoldMatchId) && m.winnerId && m.player1 && m.player2)
      : null;
    const selected = personalMatch ? personalMatch.match : held || (explicit
      ? matches.find(m => t.streamMatchId != null && String(m.id) === String(t.streamMatchId) && m.player1 && m.player2)
      : organizerMatch);
    if (!selected) return NextResponse.json({ name: t.name || '', match: null, status: explicit && t.streamMatchId == null ? 'unassigned' : 'not-found', ownerId: t.ownerUserId || null }, { headers: { 'Cache-Control': 'no-store' } });
    const roundIndex = personalMatch
      ? personalMatch.roundIndex
      : rounds.findIndex(round => round.some(m => String(m.id) === String(selected.id)));
    // Display provisional edits for both regular and broadcast matches.
    // Bracket progression always uses matchState.score only after confirmation.
    const score = !t.stageRejects && !selected.winnerId
      ? editableSetScores(t, selected) : selected.matchState?.score || {};
    const match = {
      player1: selected.player1.name || '',
      player2: selected.player2.name || '',
      score1: Number(score[selected.player1.id] || 0),
      score2: Number(score[selected.player2.id] || 0),
      round: roundIndex === rounds.length - 1 ? 'GRAND FINAL' : roundIndex === rounds.length - 2 ? 'SEMI FINAL' : 'ROUND ' + (roundIndex + 1),
      bestOf: Number(t.bestOf) === 5 ? 5 : 3,
      finished: Boolean(selected.winnerId),
    };
    return NextResponse.json({ name: t.name || '', match,
      holdUntil: personalMatch ? null : held ? t.streamHoldUntil : null,
      ownerId: t.ownerUserId || null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Overlay score read failed', error);
    return NextResponse.json({ error: 'スコアを取得できませんでした。' }, { status: 500 });
  }
}
