import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getBracketPlacements } from '../../../../lib/tournament-bracket-admin';

export const dynamic = 'force-dynamic';
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const auth = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const fail = (error, status = 400) => NextResponse.json({ error }, { status });

function safeTournament(data, user) {
  const { ownerId, ownerUserId, adminHistory, adminLog, ...publicData } = data;
  const isOwner = ownerUserId === user.id;
  const visible = new Set([String(user.id)]);
  for (const match of (data.bracket?.rounds || []).flat()) {
    if (match.winnerId || !match.player1 || !match.player2) continue;
    if ([match.player1, match.player2].some(p => String(p.userId || p.id) === String(user.id))) {
      visible.add(String(match.player1.userId || match.player1.id));
      visible.add(String(match.player2.userId || match.player2.id));
    }
  }
  const player = p => {
    if (!p) return p;
    const { friendCode, email, avatar_data, ...rest } = p;
    return (isOwner || visible.has(String(p.userId || p.id))) && friendCode
      ? { ...rest, friendCode } : rest;
  };
  publicData.joinedPlayers = (data.joinedPlayers || []).map(player);
  if (data.bracket?.rounds) publicData.bracket = {
    ...data.bracket,
    rounds: data.bracket.rounds.map(round => round.map(match => ({
      ...match, player1: player(match.player1), player2: player(match.player2),
    }))),
  };
  if (!isOwner) {
    publicData.characterReports = Object.fromEntries(
      Object.entries(data.characterReports || {}).filter(([playerId]) =>
        (data.joinedPlayers || []).some(p => String(p.id) === playerId && String(p.userId || p.id) === String(user.id))
      )
    );
    if (data.declarationPhase === 'collecting') {
      publicData.characterDeclarations = Object.fromEntries(
        Object.entries(data.characterDeclarations || {}).filter(([playerId]) =>
          (data.joinedPlayers || []).some(p => String(p.id) === playerId && String(p.userId || p.id) === String(user.id))
        )
      );
    }
    const streamMatch = (data.bracket?.rounds || []).flat().find(m => String(m.id) === String(data.streamMatchId));
    if (!streamMatch || ![streamMatch.player1, streamMatch.player2].some(p => p && String(p.userId || p.id) === String(user.id))) delete publicData.streamFriendCode;
  } else {
    publicData.adminHistory = adminHistory;
    publicData.adminLog = adminLog;
  }
  return { ...publicData, isOwner };
}

export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return fail('ログインが必要です。', 401);
    const { data: { user }, error: authError } = await auth().auth.getUser(token);
    if (authError || !user) return fail('ログインが必要です。', 401);
    const { id, matchId, gameNumber, result, demoPerspective } = await request.json();
    if (!['win', 'lose'].includes(result)) return fail('報告内容が不正です。');
    const db = admin();
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data: row, error } = await db.from('tournaments').select('data').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!row) return fail('大会が見つかりません。', 404);
      const current = row.data;
      const owner = current.ownerUserId === user.id;
      const actorId = owner && demoPerspective ? String(demoPerspective) : user.id;
      const bracket = structuredClone(current.bracket);
      if (!bracket || bracket.complete) return fail('大会は終了しています。', 409);
      let found = null, roundIndex = -1, matchIndex = -1;
      for (let ri = 0; ri < bracket.rounds.length; ri++) {
        const mi = bracket.rounds[ri].findIndex(m => String(m.id) === String(matchId));
        if (mi >= 0) { found = bracket.rounds[ri][mi]; roundIndex = ri; matchIndex = mi; break; }
      }
      if (!found?.player1 || !found?.player2 || found.winnerId) return fail('この対戦は報告できません。', 409);
      const p1 = String(found.player1.id), p2 = String(found.player2.id);
      if (![p1, p2].includes(String(actorId))) return fail('対戦選手ではありません。', 403);
      const actorPlayer = [found.player1, found.player2].find(p => String(p.id) === String(actorId));
      if (demoPerspective && (!owner || !actorPlayer?.isDemo)) return fail('デモ選手の操作権限がありません。', 403);
      if (!demoPerspective && (actorPlayer?.isDemo || String(actorPlayer?.userId || actorPlayer?.id) !== String(user.id))) return fail('報告権限がありません。', 403);
      const state = found.matchState;
      if (!state || state.complete || Number(state.gameNumber) !== Number(gameNumber) || !state.currentGame?.stage) return fail('ゲームが更新されています。', 409);
      const votes = { ...(state.currentGame.results || {}), [actorId]: result };
      if (votes[actorId] === state.currentGame.results?.[actorId]) return NextResponse.json({ ok: true, tournament: safeTournament(current, user) });
      state.currentGame.results = votes;
      if (votes[p1] && votes[p2] && votes[p1] !== votes[p2]) {
        const winnerId = votes[p1] === 'win' ? found.player1.id : found.player2.id;
        state.score[winnerId] = (state.score[winnerId] || 0) + 1;
        state.games.push({ number: state.gameNumber, stage: state.currentGame.stage, winnerId });
        const target = Number(current.bestOf || 3) === 5 ? 3 : 2;
        if (state.score[winnerId] >= target) {
          state.complete = true;
          state.winnerId = winnerId;
          found.winnerId = winnerId;
          if (roundIndex < bracket.rounds.length - 1) {
            const next = bracket.rounds[roundIndex + 1][Math.floor(matchIndex / 2)];
            next[matchIndex % 2 === 0 ? 'player1' : 'player2'] = [found.player1, found.player2].find(p => String(p.id) === String(winnerId));
            next.winnerId = null;
            next.matchState = null;
          }
        } else {
          state.gameNumber += 1;
          state.currentGame = { firstPlayerId: winnerId, previousWinnerId: winnerId, rejects: [], rejectVotes: {}, stage: current.stageRejects ? null : 'なし', chooserId: current.stageRejects ? null : (p1 === String(winnerId) ? found.player2.id : found.player1.id), results: {} };
        }
      }
      bracket.complete = Boolean(bracket.rounds.at(-1)?.[0]?.winnerId);
      const updated = { ...current, bracket, status: bracket.complete ? '終了' : current.status, completedAt: bracket.complete ? (current.completedAt || new Date().toISOString()) : current.completedAt, resultPlacements: bracket.complete ? getBracketPlacements(bracket) : current.resultPlacements };
      const { data: changed, error: writeError } = await db.from('tournaments').update({ data: updated }).eq('id', id).eq('data', JSON.stringify(current)).select('id');
      if (writeError) throw writeError;
      if (changed?.length) return NextResponse.json({ ok: true, tournament: safeTournament(updated, user) });
      // Another player committed first. Reload, merge this vote and retry.
    }
    return fail('同時操作が集中しています。もう一度お試しください。', 409);
  } catch (error) {
    console.error('Match result error:', error);
    return fail('勝敗報告を保存できませんでした。', 500);
  }
}
