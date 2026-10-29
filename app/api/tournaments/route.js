import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server environment variables are missing.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function getAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase authentication environment variables are missing.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function getUser(request, required = true) {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    if (required) throw Object.assign(new Error('大会の管理にはログインが必要です。'), { status: 401 });
    return null;
  }
  const { data, error } = await getAuthClient().auth.getUser(token);
  if (error || !data?.user) {
    if (required) throw Object.assign(new Error('ログインの有効期限が切れています。再度ログインしてください。'), { status: 401 });
    return null;
  }
  return data.user;
}

function publicTournament(row, user, legacyOwnerToken = '') {
  const data = row.data || {};
  const { ownerId, ownerUserId, ...publicData } = data;
  const isOwner = Boolean(user && (
    ownerUserId === user.id ||
    (!ownerUserId && legacyOwnerToken && row.owner_token === legacyOwnerToken)
  ));
  const activeMatches = (data.bracket?.rounds || []).flat();
  const organizerMatch = activeMatches.find(match => !match.winnerId && match.player1 && match.player2 &&
    [match.player1, match.player2].some(player => !player.isDemo && String(player.userId || player.id) === String(ownerUserId)));
  const selectedStreamMatch = activeMatches.find(match => String(match.id) === String(data.streamMatchId) && match.player1 && match.player2 && !match.winnerId);
  const effectiveStreamMatchId = data.streamMatchId === undefined ? (String(data.streamFriendCode || '').trim() ? (organizerMatch?.id || null) : null) : (selectedStreamMatch?.id || null);
  const visibleReports = isOwner ? (data.characterReports || {}) : Object.fromEntries(
    Object.entries(data.characterReports || {}).filter(([playerId]) =>
      user && (data.joinedPlayers || []).some(player =>
        String(player.id) === String(playerId) &&
        !player.isDemo && String(player.userId || player.id) === String(user.id)
      )
    )
  );
  // Keep declarations hidden until the organizer publishes them.
  if (data.characterDeclaration && data.declarationPhase === 'collecting' && !isOwner) {
    const ownPlayer = (data.joinedPlayers || []).find(p => !p.isDemo && user && String(p.userId || p.id) === String(user.id));
    publicData.characterDeclarations = ownPlayer && data.characterDeclarations?.[String(ownPlayer.id)]
      ? { [String(ownPlayer.id)]: data.characterDeclarations[String(ownPlayer.id)] }
      : {};
    publicData.declarationSubmittedCount = Object.keys(data.characterDeclarations || {}).length;
  }
  // Never expose stored contact codes to anonymous visitors or unrelated users.
  // Only the organizer and the two players in a live match need the relevant code.
  const visibleCodeIds = new Set();
  if (user) {
    for (const match of activeMatches) {
      if (match.winnerId || !match.player1 || !match.player2) continue;
      const pair = [match.player1, match.player2];
      if (pair.some(p => String(p.userId || p.id) === String(user.id))) {
        pair.forEach(p => visibleCodeIds.add(String(p.userId || p.id)));
      }
    }
  }
  const canSeeCode = p => isOwner || (user && (String(p.userId || p.id) === String(user.id) || visibleCodeIds.has(String(p.userId || p.id))));
  const redactPlayer = p => {
    if (!p || typeof p !== 'object') return p;
    const { friendCode, email, avatar_data, ...safe } = p;
    return canSeeCode(p) ? { ...safe, ...(friendCode ? { friendCode } : {}) } : safe;
  };
  publicData.joinedPlayers = (data.joinedPlayers || []).map(redactPlayer);
  if (data.bracket?.rounds) {
    publicData.bracket = {
      ...data.bracket,
      rounds: data.bracket.rounds.map(round => round.map(match => ({
        ...match,
        player1: redactPlayer(match.player1),
        player2: redactPlayer(match.player2),
      }))),
    };
  }
  const isStreamPlayer = Boolean(user && activeMatches.some(match =>
    String(match.id) === String(effectiveStreamMatchId) && !match.winnerId &&
    [match.player1, match.player2].some(p => p && String(p.userId || p.id) === String(user.id))
  ));
  if (!isOwner && !isStreamPlayer) delete publicData.streamFriendCode;
  if (!isOwner) { delete publicData.adminHistory; delete publicData.adminLog; }
  return { ...publicData, characterReports: visibleReports, isOwner, effectiveStreamMatchId };
}

function errorResponse(error, fallback) {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error(fallback, error);
  return NextResponse.json(
    { error: status === 500 ? fallback : error.message },
    { status }
  );
}

export async function GET(request) {
  try {
    const user = await getUser(request, false);
    const supabase = getAdminClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const legacyOwnerToken = searchParams.get('ownerToken') || '';
    if (id) {
      const { data, error } = await supabase.from('tournaments').select('id,data,owner_token,created_at').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });
      return NextResponse.json({ tournament: publicTournament(data, user, legacyOwnerToken) });
    }
    const { data, error } = await supabase.from('tournaments').select('id,data,owner_token,created_at').order('created_at', { ascending: false });
    if (error) throw error;
    const allRows = data || [];
    const summaryMode = searchParams.get('view') === 'summary';
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const rows = summaryMode ? allRows.filter(row => {
      const t = row.data || {};
      const finished = t.bracket?.complete === true || ['終了', '終了済み', '大会終了'].includes(t.status);
      const timestamp = Date.parse(t.completedAt || t.date || '');
      return !finished || (Number.isFinite(timestamp) && timestamp >= cutoff);
    }) : allRows;
    const ownerIds = [...new Set(rows.map(row => row.data?.ownerUserId).filter(Boolean))];
    let ownerNames = new Map();
    if (ownerIds.length) {
      const { data: profiles, error: profileError } = await supabase.from('profiles').select('user_id,display_name').in('user_id', ownerIds);
      if (profileError) console.error('Tournament organizer names could not be loaded:', profileError);
      else ownerNames = new Map((profiles || []).map(profile => [profile.user_id, profile.display_name]));
    }
    return NextResponse.json({ tournaments: rows.map(row => ({
      ...(summaryMode ? {
        id: row.data?.id || row.id, name: row.data?.name, format: row.data?.format,
        date: row.data?.date, participants: row.data?.participants,
        joinedPlayers: Array.isArray(row.data?.joinedPlayers) ? Array(row.data.joinedPlayers.length).fill(null) : [],
        status: row.data?.status, completedAt: row.data?.completedAt,
        bracket: { complete: row.data?.bracket?.complete === true },
      } : publicTournament(row, user)),
      organizerName: ownerNames.get(row.data?.ownerUserId) || row.data?.organizerName || ''
    })) });
  } catch (error) {
    return errorResponse(error, '大会データを読み込めませんでした。Supabaseの設定を確認してください。');
  }
}

export async function POST(request) {
  try {
    const user = await getUser(request);
    const body = await request.json();
    const input = body?.tournament;
    const id = String(input?.id || '');
    const name = String(input?.name || '').trim();
    if (!input || !id || !name) return NextResponse.json({ error: '大会情報が不足しています。' }, { status: 400 });
    if (id.length > 128 || name.length > 120 || !/^[a-zA-Z0-9_-]+$/.test(id)) return NextResponse.json({ error: '大会IDまたは大会名が正しくありません。' }, { status: 400 });

    // Explicit allowlist: client input must never initialize privileged or match-result fields.
    const allowed = ['id', 'description', 'streamUrl', 'streamFriendCode', 'name', 'seriesTags',
      'format', 'bestOf', 'participants', 'date', 'stages', 'stageRejects', 'autoSeed',
      'characterDeclaration', 'stageSettings'];
    const safeTournament = Object.fromEntries(allowed.filter(key =>
      Object.prototype.hasOwnProperty.call(input, key)).map(key => [key, input[key]]));
    const tournament = { ...safeTournament, name, status: '募集中',
      createdAt: new Date().toISOString(), ownerUserId: user.id };
    const supabase = getAdminClient();
    const { error } = await supabase.from('tournaments').insert({
      id,
      data: tournament,
      owner_token: randomUUID(),
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    return errorResponse(error, '大会を保存できませんでした。Supabaseの設定を確認してください。');
  }
}

export async function PUT(request) {
  try {
    const user = await getUser(request);
    const body = await request.json();
    const input = body?.tournament;
    const id = String(input?.id || '');
    const legacyOwnerToken = String(body?.ownerToken || '');
    if (!input || !id) return NextResponse.json({ error: '更新情報が不足しています。' }, { status: 400 });

    const supabase = getAdminClient();
    const { data: row, error: readError } = await supabase.from('tournaments').select('data,owner_token').eq('id', id).maybeSingle();
    if (readError) throw readError;
    if (!row) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });

    const existing = row.data || {};
    const existingOwnerId = existing.ownerUserId;
    const isCurrentOwner = existingOwnerId
      ? existingOwnerId === user.id
      : Boolean(legacyOwnerToken && row.owner_token === legacyOwnerToken);
    const existingMatches = (existing.bracket?.rounds || []).flat();
    const inputMatches = (input.bracket?.rounds || []).flat();
    const isParticipant = (existing.joinedPlayers || []).some(player =>
      !player.isDemo && String(player.userId || player.id) === String(user.id)
    );
    const isInActiveMatch = existingMatches.some(match =>
      !match.winnerId && [match.player1, match.player2].some(player => String(player?.id) === String(user.id))
    ) && inputMatches.some(match =>
      [match.player1, match.player2].some(player => String(player?.id) === String(user.id))
    );
    if (!isCurrentOwner && !(isParticipant && isInActiveMatch && existing.bracket && input.bracket)) {
      return NextResponse.json({ error: '更新する権限がありません。' }, { status: 403 });
    }

    // All participant match mutations now use dedicated, server-validated APIs.
    // Never accept a complete client-supplied bracket through this generic route.
    if (!isCurrentOwner) {
      return NextResponse.json({ error: '対戦操作は専用APIから行ってください。' }, { status: 403 });
    }

    // Reject changes to the bracket's structural metadata from participants.
    // The server must never accept a forged completion flag or reordered rounds.
    if (!isCurrentOwner) {
      const oldBracket = existing.bracket || {};
      const newBracket = input.bracket || {};
      const { rounds: oldRounds, ...oldMetadata } = oldBracket;
      const { rounds: newRounds, ...newMetadata } = newBracket;
      if (JSON.stringify(oldMetadata) !== JSON.stringify(newMetadata) ||
          !Array.isArray(newRounds) ||
          newRounds.length !== (oldRounds || []).length ||
          newRounds.some((round, index) => !Array.isArray(round) || round.length !== oldRounds[index]?.length)) {
        return NextResponse.json({ error: 'トーナメントの構成は変更できません。' }, { status: 403 });
      }
    }

    // Stage selection is the only bracket mutation allowed through this endpoint.
    // Winners, scores, games and result votes are committed exclusively by match-result.
    if (!isCurrentOwner) {
      const byId = new Map(existingMatches.map(match => [String(match.id), match]));
      for (const next of inputMatches) {
        const before = byId.get(String(next.id));
        if (!before) return NextResponse.json({ error: '対戦カードが不正です。' }, { status: 403 });
        if (JSON.stringify(next.winnerId ?? null) !== JSON.stringify(before.winnerId ?? null) ||
            JSON.stringify(next.matchState?.score ?? null) !== JSON.stringify(before.matchState?.score ?? null) ||
            JSON.stringify(next.matchState?.games ?? null) !== JSON.stringify(before.matchState?.games ?? null) ||
            JSON.stringify(next.matchState?.currentGame?.results ?? null) !== JSON.stringify(before.matchState?.currentGame?.results ?? null) ||
            Boolean(next.matchState?.complete) !== Boolean(before.matchState?.complete) ||
            JSON.stringify(next.matchState?.winnerId ?? null) !== JSON.stringify(before.matchState?.winnerId ?? null) ||
            JSON.stringify(next.matchState?.gameNumber ?? null) !== JSON.stringify(before.matchState?.gameNumber ?? null)) {
          return NextResponse.json({ error: '勝敗は専用の報告APIから確定してください。' }, { status: 403 });
        }
      }
    }

    // Ordinary participants may update their own in-progress match, but must not
    // undo finished results or create organizer-only walkover decisions via PUT.
    if (!isCurrentOwner) {
      const activeIds = new Set(existingMatches.filter(match =>
        !match.winnerId && match.player1 && match.player2 &&
        [match.player1, match.player2].some(player =>
          String(player?.id) === String(user.id)
        )
      ).map(match => String(match.id)));
      const nextById = new Map(inputMatches.map(match => [String(match.id), match]));
      // A participant may not modify another match's score, winner, stage state,
      // or administrator flags, even when submitting their own result.
      const unchanged = value => JSON.stringify(value ?? null);
      if (existingMatches.some(match => {
        if (activeIds.has(String(match.id))) return false;
        const next = inputMatches.find(candidate => String(candidate.id) === String(match.id));
        if (!next) return true;
        const { player1: beforeP1, player2: beforeP2, ...before } = match;
        const { player1: afterP1, player2: afterP2, ...after } = next;
        if (unchanged(before) !== unchanged(after)) return true;
        // Advancement may populate an empty downstream slot, but never replace
        // an existing player or edit their details.
        for (const [oldPlayer, newPlayer] of [[beforeP1, afterP1], [beforeP2, afterP2]]) {
          if (oldPlayer && unchanged(oldPlayer) !== unchanged(newPlayer)) return true;
          if (!oldPlayer && newPlayer && !existingMatches.some(source =>
            activeIds.has(String(source.id)) && String(source.player1?.id) === String(newPlayer.id) ||
            activeIds.has(String(source.id)) && String(source.player2?.id) === String(newPlayer.id)
          )) return true;
        }
        return false;
      })) return NextResponse.json({ error: '自分の対戦以外は変更できません。' }, { status: 403 });
      if (existingMatches.some(match => activeIds.has(String(match.id)) && (() => {
        const next = inputMatches.find(candidate => String(candidate.id) === String(match.id));
        if (!next) return true;
        const { matchState: previousState, winnerId: previousWinner, ...previousRest } = match;
        const { matchState: nextState, winnerId: nextWinner, ...nextRest } = next;
        if (unchanged(previousRest) !== unchanged(nextRest)) return true;
        if (nextWinner && ![match.player1?.id, match.player2?.id].some(id => String(id) === String(nextWinner))) return true;
        return false;
      })())) return NextResponse.json({ error: '対戦データの変更内容が不正です。' }, { status: 403 });

      if (existingMatches.length !== inputMatches.length || existingMatches.some(match => {
        const next = nextById.get(String(match.id));
        if (!next) return true;
        if ((match.resultType || null) !== (next.resultType || null)) return true;
        if (match.winnerId != null && String(next.winnerId) !== String(match.winnerId)) return true;
        if (match.winnerId != null &&
          JSON.stringify(match.matchState ?? null) !== JSON.stringify(next.matchState ?? null)) return true;
        if (match.winnerId == null && next.winnerId != null && !activeIds.has(String(match.id))) return true;
        return false;
      })) {
        return NextResponse.json({ error: '確定結果の変更・不戦勝設定は主催者のみ行えます。' }, { status: 403 });
      }
    }

    // Participants can submit match progress only. All other tournament fields remain server-owned.
    if (!isCurrentOwner) {
      const stable = value => JSON.stringify(value ?? null);
      // Prevent changing tournament settings, participants, or other fields via a crafted request.
      const { bracket: ignoredBracket, ...restInput } = input;
      const { bracket: ignoredExistingBracket, ...restExisting } = existing;
      // UI may send stale top-level derived status/placements while completing a match.
      const allowedDerived = new Set(['status', 'resultPlacements', 'completedAt']);
      for (const key of new Set([...Object.keys(restInput), ...Object.keys(restExisting)])) {
        if (allowedDerived.has(key) || key === 'ownerId' || key === 'ownerUserId') continue;
        if (stable(restInput[key]) !== stable(restExisting[key])) {
          return NextResponse.json({ error: '大会設定や参加者情報は変更できません。' }, { status: 403 });
        }
      }
    }

    const { ownerId, ownerUserId, ...safeInput } = input;
    const updated = isCurrentOwner
      ? { ...safeInput, ownerUserId: existingOwnerId || user.id }
      : {
          ...existing,
          bracket: safeInput.bracket,
          status: existing.status,
          resultPlacements: existing.resultPlacements,
          completedAt: existing.completedAt,
        };
    const { data: changed, error } = await supabase.from('tournaments').update({ data: updated }).eq('id', id).eq('data', JSON.stringify(existing)).select('id');
    if (error) throw error;
    if (!changed?.length) return NextResponse.json({ error: '他の操作が先に保存されました。画面を更新してやり直してください。' }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, '大会情報を保存できませんでした。');
  }
}

export async function DELETE(request) {
  try {
    const user = await getUser(request);
    const body = await request.json();
    const id = String(body?.id || '');
    const legacyOwnerToken = String(body?.ownerToken || '');
    if (!id) return NextResponse.json({ error: '削除情報が不足しています。' }, { status: 400 });

    const supabase = getAdminClient();
    const { data: row, error: readError } = await supabase.from('tournaments').select('data,owner_token').eq('id', id).maybeSingle();
    if (readError) throw readError;
    if (!row) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });

    const existingOwnerId = row.data?.ownerUserId;
    const isCurrentOwner = existingOwnerId
      ? existingOwnerId === user.id
      : Boolean(legacyOwnerToken && row.owner_token === legacyOwnerToken);
    if (!isCurrentOwner) return NextResponse.json({ error: '削除する権限がありません。' }, { status: 403 });

    const { error } = await supabase.from('tournaments').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, '大会を削除できませんでした。');
  }
}
