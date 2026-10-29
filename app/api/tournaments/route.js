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
  if (!isOwner && !user) delete publicData.streamFriendCode;
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
    const rows = data || [];
    const ownerIds = [...new Set(rows.map(row => row.data?.ownerUserId).filter(Boolean))];
    let ownerNames = new Map();
    if (ownerIds.length) {
      const { data: profiles, error: profileError } = await supabase.from('profiles').select('user_id,display_name').in('user_id', ownerIds);
      if (profileError) console.error('Tournament organizer names could not be loaded:', profileError);
      else ownerNames = new Map((profiles || []).map(profile => [profile.user_id, profile.display_name]));
    }
    return NextResponse.json({ tournaments: rows.map(row => ({
      ...publicTournament(row, user),
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

    const { ownerId, ownerUserId, characterReports, ...safeTournament } = input;
    const tournament = { ...safeTournament, name, ownerUserId: user.id };
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
          status: safeInput.status || existing.status,
          resultPlacements: safeInput.resultPlacements ?? existing.resultPlacements,
          completedAt: safeInput.completedAt ?? existing.completedAt,
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
