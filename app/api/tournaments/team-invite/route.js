import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { saveTournamentRevision } from '../../../../lib/tournament-save';
import { isTeamTournament, isTeamCaptain, isTeamMember } from '../../../../lib/team-tournament';

export const dynamic = 'force-dynamic';
const fail = (error, status = 400) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
const hash = token => createHash('sha256').update(token).digest('hex');
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const validToken = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{32,128}$/.test(value);
const client = key => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function authUser(request) {
  const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const { data: { user }, error } = await client(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).auth.getUser(token);
  return error ? null : user;
}
const isOpen = tournament => Boolean(isTeamTournament(tournament) &&
  !tournament.bracket && tournament.status === '募集中');
function findInvitation(tournament, token) {
  if (!validToken(token)) return null;
  const digest = hash(token);
  const captain = (tournament.joinedPlayers || []).find(p => !p.isDemo &&
    !p.teamMate && tournament.teamInvites?.[String(p.id)] === digest);
  return captain || null;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const token = searchParams.get('token');
    if (!validId(id) || !validToken(token)) return fail('招待URLが正しくありません。', 400);
    const db = client(process.env.SUPABASE_SERVICE_ROLE_KEY);
    // A public invitation preview does not need the full tournament bracket,
    // reports, stage state or participant avatars. Read only small JSON paths.
    const { data, error } = await db.from('tournaments')
      .select('name:data->>name,status:data->>status,teamTournament:data->teamTournament,joinedPlayers:data->joinedPlayers,teamInvites:data->teamInvites')
      .eq('id', id).maybeSingle();
    if (error) throw error;
    const tournament = data || null;
    if (!tournament || tournament.status !== '募集中' || !isTeamTournament(tournament))
      return fail('この招待は現在利用できません。', 409);
    const captain = findInvitation(tournament, token);
    if (!captain) return fail('招待URLが無効です。代表者に再発行をお願いしてください。', 404);
    return NextResponse.json({ tournamentName: String(tournament.name || ''),
      captainName: String(captain.name || ''), captainId: String(captain.id) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Team invitation preview failed:', error?.message);
    return fail('招待を確認できませんでした。', 500);
  }
}

export async function POST(request) {
  try {
    const user = await authUser(request);
    if (!user) return fail('Googleログインが必要です。', 401);
    const { id, action, token } = await request.json();
    if (!validId(id) || !['create', 'accept'].includes(action) ||
        (action === 'accept' && !validToken(token)))
      return fail('操作内容が正しくありません。');

    const db = client(process.env.SUPABASE_SERVICE_ROLE_KEY);
    let profile = null;
    if (action === 'accept') {
      const { data, error } = await db.from('profiles')
        .select('display_name,friend_code').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      if (!data?.display_name?.trim() || data.display_name.trim().toLowerCase() === 'no name')
        return fail('マイページで名前を設定してから招待に参加してください。', 400);
      profile = data;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: currentRow, error: readError } = await db.from('tournaments')
        .select('data').eq('id', id).maybeSingle();
      if (readError) throw readError;
      if (!currentRow) return fail('大会が見つかりません。', 404);
      const tournament = currentRow.data || {};
      if (!isOpen(tournament)) return fail('大会開始後はペアの招待・参加ができません。', 409);
      const players = Array.isArray(tournament.joinedPlayers) ? tournament.joinedPlayers : [];
      if (action === 'create') {
        const captain = players.find(p => !p.isDemo && isTeamCaptain(p, user.id));
        if (!captain) return fail('参加登録した代表者だけが招待できます。', 403);
        if (captain.teamMate) return fail('すでに相方が参加しています。', 409);
        const secret = randomBytes(24).toString('base64url');
        const updated = { ...tournament,
          teamInvites: { ...(tournament.teamInvites || {}), [String(captain.id)]: hash(secret) },
        };
        const { data: changed, error: writeError } =
          await saveTournamentRevision(db, id, tournament, updated);
        if (writeError) throw writeError;
        if (!changed?.length) continue;
        return NextResponse.json({ token: secret, captainName: captain.name }, {
          headers: { 'Cache-Control': 'no-store' },
        });
      }

      const captain = findInvitation(tournament, token);
      if (!captain) return fail('招待URLが無効になりました。', 404);
      if (isTeamCaptain(captain, user.id)) return fail('自分のチームには招待で参加できません。', 409);
      const existingMembership = players.find(p => !p.isDemo && isTeamMember(p, user.id));
      if (existingMembership?.teamMate && isTeamCaptain(existingMembership, user.id))
        return fail('すでに相方がいるため、ほかのチームには参加できません。', 409);
      if (existingMembership && !isTeamCaptain(existingMembership, user.id))
        return fail('すでに別のチームの相方として登録されています。', 409);

      // A previously registered SOLO entrant can join another captain.
      // Remove their independent slot atomically with the pairing.
      const nextPlayers = players.filter(p => !isTeamCaptain(p, user.id)).map(p =>
        String(p.id) === String(captain.id)
          ? { ...p, teamMate: { id: user.id, userId: user.id,
              name: profile.display_name.trim(), friendCode: String(profile.friend_code || '').trim().toUpperCase() } }
          : p);
      const invites = { ...(tournament.teamInvites || {}) };
      delete invites[String(captain.id)];
      if (existingMembership) delete invites[String(existingMembership.id)];
      const next = { ...tournament, joinedPlayers: nextPlayers, teamInvites: invites };
      const { data: changed, error: writeError } = await saveTournamentRevision(db, id, tournament, next);
      if (writeError) throw writeError;
      if (!changed?.length) continue;
      return NextResponse.json({ ok: true, captainName: captain.name }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    return fail('別の参加登録が先に保存されました。もう一度お試しください。', 409);
  } catch (error) {
    console.error('Team invitation failed:', error?.message);
    return fail('チームの招待処理に失敗しました。', 500);
  }
}
