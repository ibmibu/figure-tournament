import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { findParticipantOverlay, ownOverlayMatch } from '../../../../lib/overlay-participant-match';
import { editableSetScores, getMatchReportMode, hasStreamUrl } from '../../../../lib/tournament-set-result';

export const dynamic = 'force-dynamic';

// JSON-path selection is performed by PostgREST before data crosses the
// Supabase -> Vercel boundary. Never select the entire tournaments.data JSON
// (historical results, avatars, logs, reports) for OBS score reads.
const OVERLAY_SELECT = [
  'id', 'created_at', 'name:data->>name', 'createdAt:data->>createdAt',
  'ownerUserId:data->>ownerUserId', 'status:data->>status',
  'bracket:data->bracket', 'joinedPlayers:data->joinedPlayers',
  'streamUrl:data->>streamUrl', 'streamMatchManual:data->streamMatchManual',
  'streamMatchId:data->streamMatchId', 'streamHoldMatchId:data->streamHoldMatchId',
  'streamHoldUntil:data->>streamHoldUntil', 'bestOf:data->bestOf',
  'stageRejects:data->stageRejects', 'stageActionRevision:data->stageActionRevision',
].join(',');
const OVERLAY_INDEX_SELECT = [
  'id', 'created_at', 'createdAt:data->>createdAt', 'status:data->>status',
  'complete:data->bracket->>complete',
].join(',');
const CANDIDATE_BATCH_SIZE = 4;

function expandOverlayRow(raw) {
  if (!raw) return null;
  const { id, created_at, ...data } = raw;
  // JSON path extraction returns null for absent keys. The legacy overlay
  // distinguishes an omitted streamMatchId (automatic owner selection) from
  // an explicit null paired with streamMatchManual=true (manual clear).
  if (data.streamMatchId == null && data.streamMatchManual !== true)
    delete data.streamMatchId;
  return { id, created_at, data };
}
function overlayAt(row) {
  return Date.parse(row?.data?.createdAt || row?.createdAt || row?.created_at || '') || 0;
}
async function readOverlayRow(db, id) {
  const { data, error } = await db.from('tournaments')
    .select(OVERLAY_SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  return expandOverlayRow(data);
}
async function readOverlayIndex(db, contains) {
  const { data, error } = await db.from('tournaments')
    .select(OVERLAY_INDEX_SELECT).contains('data', contains)
    .order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data || []).sort((a, b) => overlayAt(b) - overlayAt(a));
}
// Return exact match detail for only the few candidate tournaments that might
// actually be shown. Preserve the previous 100-row cap and selection priority.
async function readCandidateBatch(db, indexRows) {
  if (!indexRows.length) return [];
  const { data, error } = await db.from('tournaments')
    .select(OVERLAY_SELECT).in('id', indexRows.map(row => row.id));
  if (error) throw error;
  const byId = new Map((data || []).map(row => [String(row.id), expandOverlayRow(row)]));
  return indexRows.map(row => byId.get(String(row.id))).filter(Boolean);
}
async function firstOrganizer(db, indexRows) {
  for (let offset = 0; offset < indexRows.length; offset += CANDIDATE_BATCH_SIZE) {
    const rows = await readCandidateBatch(db, indexRows.slice(offset, offset + CANDIDATE_BATCH_SIZE));
    const found = rows.find(row => row.data?.bracket?.rounds?.length);
    if (found) return found;
  }
  return null;
}
function activeParticipantIndex(row) {
  return row.complete !== 'true' &&
    ['対戦中', 'キャラ宣言中', '開始'].includes(row.status);
}
async function bestParticipant(db, indexRows, userId) {
  // Playing (priority 3) beats another live event already played (priority 2),
  // regardless of its date. Completed matches (priority 1) come last.
  const active = indexRows.filter(activeParticipantIndex);
  let waiting = null;
  for (let offset = 0; offset < active.length; offset += CANDIDATE_BATCH_SIZE) {
    const rows = await readCandidateBatch(db, active.slice(offset, offset + CANDIDATE_BATCH_SIZE));
    const found = findParticipantOverlay(rows, userId);
    if (found?.priority === 3) return found;
    if (!waiting && found?.priority === 2) waiting = found;
  }
  if (waiting) return waiting;
  const completed = indexRows.filter(row => !activeParticipantIndex(row));
  for (let offset = 0; offset < completed.length; offset += CANDIDATE_BATCH_SIZE) {
    const rows = await readCandidateBatch(db, completed.slice(offset, offset + CANDIDATE_BATCH_SIZE));
    const found = findParticipantOverlay(rows, userId);
    if (found) return found;
  }
  return null;
}
async function selectOverlay(db, owner, player) {
  if (player) {
    let rows = await readOverlayIndex(db, { joinedPlayers: [{ userId: player }] });
    let selected = await bestParticipant(db, rows, player);
    if (!selected && !rows.length) {
      rows = await readOverlayIndex(db, { joinedPlayers: [{ id: player }] });
      selected = await bestParticipant(db, rows, player);
    }
    return selected ? { row: selected.row, personalMatch: selected.item, role: 'participant' } : null;
  }
  const owned = await readOverlayIndex(db, { ownerUserId: owner });
  const running = owned.filter(row => row.status === '対戦中' && row.complete !== 'true');
  const currentOrganizer = await firstOrganizer(db, running);
  if (currentOrganizer) return { row: currentOrganizer, personalMatch: null, role: 'organizer' };

  let entered = await readOverlayIndex(db, { joinedPlayers: [{ userId: owner }] });
  let participant = await bestParticipant(db, entered, owner);
  if (!participant && !entered.length) {
    entered = await readOverlayIndex(db, { joinedPlayers: [{ id: owner }] });
    participant = await bestParticipant(db, entered, owner);
  }
  if (participant?.priority > 1)
    return { row: participant.row, personalMatch: participant.item, role: 'participant' };
  const finished = owned.filter(row =>
    row.status === '対戦中' || row.status === '終了' || row.complete === 'true');
  const finishedOrganizer = await firstOrganizer(db, finished);
  if (participant && (!finishedOrganizer ||
      overlayAt(participant.row) > overlayAt(finishedOrganizer))) {
    return { row: participant.row, personalMatch: participant.item, role: 'participant' };
  }
  return finishedOrganizer
    ? { row: finishedOrganizer, personalMatch: null, role: 'organizer' } : null;
}
function versionToken(rowId, revision, selector, role) {
  if (revision == null || revision === '' || !Number.isSafeInteger(Number(revision)) || Number(revision) < 0)
    return '';
  return createHash('sha256').update(JSON.stringify([
    String(rowId), String(revision), String(selector || ''), String(role),
  ])).digest('hex');
}


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
    const selectedId = params.get('selectedId');
    const selectedRole = params.get('selectedRole');
    const useSelection = Boolean(owner || player);
    if ((selectedId && (!useSelection || !/^[a-zA-Z0-9_-]{1,128}$/.test(selectedId))) ||
        (selectedRole && !['organizer', 'participant'].includes(selectedRole)) ||
        (selectedId && !selectedRole)) {
      return NextResponse.json({ error: 'オーバーレイの選択が不正です。' }, { status: 400 });
    }
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const targetId = selectedId || id;
    const role = selectedId ? selectedRole : id ? 'direct' : null;
    const selector = owner || player || '';
    const priorVersion = request.headers.get('x-overlay-version') || '';
    if (targetId && priorVersion && !params.has('fresh')) {
      try {
        const { data: record, error } = await db.from('tournaments')
          .select('revision:data->>stageActionRevision').eq('id', targetId).maybeSingle();
        if (error) throw error;
        if (record && priorVersion === versionToken(targetId, record.revision, selector, role)) {
          return new NextResponse(null, { status: 304, headers: {
            'X-Overlay-Version': priorVersion,
            'Cache-Control': 'no-store',
          } });
        }
      } catch (revisionError) {
        // OBS must continue showing scores if the compact check is unavailable.
        console.warn('Overlay revision preflight unavailable:', revisionError.message);
      }
    }

    let row = null;
    let personalMatch = null;
    let sourceRole = role;
    if (id) {
      row = await readOverlayRow(db, id);
    } else if (selectedId) {
      row = await readOverlayRow(db, selectedId);
      if (row && (selectedRole === 'participant' || player)) {
        personalMatch = ownOverlayMatch(row.data, selector);
        if (!personalMatch) row = null;
        sourceRole = 'participant';
      } else if (row && selectedRole === 'organizer') {
        if (String(row.data.ownerUserId || '') !== String(owner)) row = null;
        sourceRole = 'organizer';
      }
      // If an old selection is no longer valid, re-resolve rather than showing
      // a different person's tournament under the account OBS URL.
      if (!row) {
        const selected = await selectOverlay(db, owner, player);
        row = selected?.row || null;
        personalMatch = selected?.personalMatch || null;
        sourceRole = selected?.role || null;
      }
    } else {
      const selected = await selectOverlay(db, owner, player);
      row = selected?.row || null;
      personalMatch = selected?.personalMatch || null;
      sourceRole = selected?.role || null;
    }
    const headers = { 'Cache-Control': 'no-store' };
    if (row) {
      const token = versionToken(row.id, row.data.stageActionRevision, selector, sourceRole);
      if (token) headers['X-Overlay-Version'] = token;
    }
    const reply = body => NextResponse.json({
      ...body,
      selectedTournamentId: row?.id || null,
      selectedRole: sourceRole || null,
    }, { headers });
    if (!row) return reply({ name: '', match: null, status: 'unassigned' });
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
    if (!selected) return reply({ name: t.name || '', match: null, status: explicit && t.streamMatchId == null ? 'unassigned' : 'not-found', ownerId: t.ownerUserId || null });
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
    return reply({ name: t.name || '', match,
      holdUntil: personalMatch ? null : held ? t.streamHoldUntil : null,
      ownerId: t.ownerUserId || null });
  } catch (error) {
    console.error('Overlay score read failed', error);
    return NextResponse.json({ error: 'スコアを取得できませんでした。' }, { status: 500 });
  }
}
