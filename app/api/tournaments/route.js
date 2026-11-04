import { saveTournamentRevision } from '../../../lib/tournament-save';
import { repairPrematureAdvances } from '../../../lib/tournament-bracket-admin';
import { getEffectiveStreamMatchId } from '../../../lib/tournament-set-result';
import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { randomUUID, createHash } from 'crypto';

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

const readOnlyAuthCache = new Map();

async function getUser(request, required = true) {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    if (required) throw Object.assign(new Error('大会の管理にはログインが必要です。'), { status: 401 });
    return null;
  }
  // Read-only requests can reuse a recently validated identity. Never cache
  // authorization decisions for writes, which still validate with Supabase.
  const cacheKey = !required ? createHash('sha256').update(token).digest('hex') : '';
  const cached = cacheKey ? readOnlyAuthCache.get(cacheKey) : null;
  if (cached && cached.expires > Date.now()) return cached.user;
  const { data, error } = await getAuthClient().auth.getUser(token);
  if (cacheKey) {
    if (readOnlyAuthCache.size > 500) readOnlyAuthCache.clear();
    readOnlyAuthCache.set(cacheKey, { user: error ? null : data?.user || null, expires: Date.now() + (error ? 5000 : 30000) });
  }
  if (error || !data?.user) {
    if (required) throw Object.assign(new Error('ログインの有効期限が切れています。再度ログインしてください。'), { status: 401 });
    return null;
  }
  return data.user;
}

function publicTournament(row, user, legacyOwnerToken = '') {
  const data = repairPrematureAdvances(row.data || {});
  const { ownerId, ownerUserId, ...publicData } = data;
  const isOwner = Boolean(user && (
    ownerUserId === user.id ||
    (!ownerUserId && legacyOwnerToken && row.owner_token === legacyOwnerToken)
  ));
  const activeMatches = (data.bracket?.rounds || []).flat();
  // Reuse the exact server-side assignment policy used by score-write
  // permissions: no automatic broadcast without a configured stream URL.
  const effectiveStreamMatchId = getEffectiveStreamMatchId(data);
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
  // Result status and scores live in the bracket, not in operation logs.
  delete publicData.matchLogs;
  delete publicData.adminLog;
  delete publicData.adminHistory;
  delete publicData.participantAvatars;
  delete publicData.statsSnapshot;
  return { ...publicData, characterReports: visibleReports, isOwner, ...(isOwner ? { overlayOwnerId: ownerUserId } : {}), effectiveStreamMatchId };
}

function errorResponse(error, fallback) {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error(fallback, error);
  return NextResponse.json(
    { error: status === 500 ? fallback : error.message },
    { status }
  );
}

// Coalesce concurrent reads and briefly reuse the raw database row within
// one server instance. Redaction is still performed separately for each caller;
// never cache the user-specific response or authorization decision here.
const tournamentReads = new Map();
const TOURNAMENT_ROW_TTL_MS = 1500;
const FINISHED_TOURNAMENT_ROW_TTL_MS = 60000;
const MAX_TOURNAMENT_ROW_CACHE_ENTRIES = 200;
function isFinishedTournamentRow(row) {
  const tournament = row?.data || {};
  return tournament.bracket?.complete === true ||
    ['終了', '終了済み', '大会終了'].includes(tournament.status);
}
// Disabled by default until the SQL view is installed and verified.
// This is an opt-in path: the legacy full-row read remains the fallback.
async function readLiveTournamentProjection(supabase, id) {
  const { data, error } = await supabase.from('tournament_live_projection')
    .select('id,created_at,owner_token,live_data').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, created_at: data.created_at,
    owner_token: data.owner_token, data: data.live_data || {} } : null;
}

async function readTournamentRow(supabase, id, bypassCache = false) {
  const now = Date.now();
  const cached = tournamentReads.get(id);
  if (!bypassCache && cached && (cached.pending || cached.expires > now)) {
    return cached.pending || cached.result;
  }
  const entry = { pending: null, result: null, expires: 0 };
  const pending = Promise.resolve(supabase.from('tournaments')
    .select('id,data,owner_token,created_at').eq('id', id).maybeSingle());
  entry.pending = pending;
  tournamentReads.set(id, entry);
  try {
    const result = await pending;
    if (tournamentReads.get(id) === entry) {
      entry.pending = null;
      if (!result.error) {
        entry.result = result;
        entry.expires = Date.now() + (isFinishedTournamentRow(result.data)
          ? FINISHED_TOURNAMENT_ROW_TTL_MS : TOURNAMENT_ROW_TTL_MS);
        // Bound memory usage in long-lived server instances.
        if (tournamentReads.size > MAX_TOURNAMENT_ROW_CACHE_ENTRIES) {
          for (const [key, value] of tournamentReads) {
            if (!value.pending && value.expires <= Date.now()) tournamentReads.delete(key);
          }
          while (tournamentReads.size > MAX_TOURNAMENT_ROW_CACHE_ENTRIES) {
            const oldestKey = tournamentReads.keys().next().value;
            if (oldestKey === undefined) break;
            tournamentReads.delete(oldestKey);
          }
        }
      } else {
        tournamentReads.delete(id);
      }
    }
    return result;
  } catch (error) {
    if (tournamentReads.get(id) === entry) tournamentReads.delete(id);
    throw error;
  }
}


// Home only needs compact public fields. Fetching full bracket JSON (including
// all prior games and organizer logs) for every historical tournament makes the
// homepage increasingly expensive as tournaments accumulate.
async function readTournamentSummaries(db) {
  const select = [
    'id', 'created_at', 'record_id:data->>id', 'name:data->>name',
    'format:data->>format', 'date:data->>date',
    'participants:data->>participants', 'joined_players:data->joinedPlayers',
    'status:data->>status', 'completed_at:data->>completedAt',
    'complete:data->bracket->>complete',
    'owner_user_id:data->>ownerUserId', 'organizer_name:data->>organizerName',
  ].join(',');
  const rows = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from('tournaments').select(select)
      .order('created_at', { ascending: false }).range(from, from + 499);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
  }
}

// Cache only the public tournament-list projection. Live tournament details,
// authenticated views, and all writes continue to read Supabase directly.
const cachedTournamentSummaries = unstable_cache(
  async () => readTournamentSummaries(getAdminClient()),
  ['public-tournament-summaries-v1'],
  { revalidate: 20 }
);

// Live responses are user-specific (owner flags, declarations and friend codes).
// Scope a compact revision check to the same caller as the last complete
// response; do not use a shared ETag or skip authentication.
function liveVersionToken(id, revision, user, legacyOwnerToken) {
  if (revision == null || revision === '' || !Number.isSafeInteger(Number(revision)) || Number(revision) < 0) return '';
  return createHash('sha256').update(JSON.stringify([
    String(id), String(revision), String(user?.id || ''), String(legacyOwnerToken || ''),
  ])).digest('hex');
}

export async function GET(request) {
  try {
    const user = await getUser(request, false);
    const supabase = getAdminClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const legacyOwnerToken = searchParams.get('ownerToken') || '';
    if (id) {
      const requestedView = searchParams.get('view');
      if (requestedView === 'access') {
        // Finished public records are served from the GitHub archive. Only
        // validate that the event is still complete and whether this caller
        // needs the editable organizer view. No bracket JSON is read here.
        const { data: access, error: accessError } = await supabase.from('tournaments')
          .select('complete:data->bracket->>complete,ownerUserId:data->>ownerUserId,owner_token')
          .eq('id', id).maybeSingle();
        if (accessError) throw accessError;
        if (!access) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });
        const isOwner = Boolean(
          (user && access.ownerUserId && String(access.ownerUserId) === String(user.id)) ||
          (!access.ownerUserId && legacyOwnerToken && access.owner_token === legacyOwnerToken)
        );
        return NextResponse.json({
          completed: access.complete === true || access.complete === 'true',
          isOwner,
        }, { headers: { 'Cache-Control': 'private, no-store' } });
      }
      const liveMode = requestedView === 'live';
      // The first page load needs participant avatars, but not the full
      // tournaments.data document. Reuse the live projection for its metadata.
      const compactPageMode = requestedView === 'page';
      // Live polling compares a compact revision first; an unchanged revision
      // does not transfer the full bracket JSON from PostgREST. Browser reloads
      // can obtain the full current tournament state if recovery is needed.
      const previousVersion = request.headers.get('x-tournament-version') || '';
      const previousEtag = request.headers.get('if-none-match') || '';
      if (liveMode && process.env.TOURNAMENT_LIVE_PROJECTION_ENABLED === 'true' &&
          previousVersion && previousEtag && !searchParams.has('fresh')) {
        try {
          const { data: latest, error: revisionError } = await supabase.from('tournaments')
            .select('revision:data->>stageActionRevision').eq('id', id).maybeSingle();
          if (revisionError) throw revisionError;
          if (latest && previousVersion === liveVersionToken(
            id, latest.revision, user, legacyOwnerToken
          )) {
            return new NextResponse(null, { status: 304, headers: {
              ETag: previousEtag,
              'X-Tournament-Version': previousVersion,
              'Cache-Control': 'private, no-cache',
            } });
          }
        } catch (revisionError) {
          // A failed preflight may never interrupt a match: use the existing
          // full live projection instead.
          console.warn('Tournament revision check unavailable:', revisionError.message);
        }
      }
      // Explicit server-side opt-in only. If the projection is absent or fails,
      // preserve the existing full-row behavior for all callers.
      let data;
      if ((liveMode || compactPageMode) && process.env.TOURNAMENT_LIVE_PROJECTION_ENABLED === 'true') {
        try {
          data = await readLiveTournamentProjection(supabase, id);
        } catch (projectionError) {
          console.warn('Live projection unavailable; falling back to full tournament row:', projectionError.message);
        }
      }
      if (data === undefined) {
        const result = await readTournamentRow(supabase, id, searchParams.has('fresh'));
        if (result.error) throw result.error;
        data = result.data;
      }
      if (!data) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });
      const tournament = publicTournament(data, user, legacyOwnerToken);
      // Realtime polls use view=live: avatars are large base64 payloads and
      // rarely change during a set. Fetch them only on full page loads.
      if (!liveMode) {
        const participantIds = [...new Set((tournament.joinedPlayers || [])
          .filter(player => !player.isDemo)
          .map(player => String(player.userId || player.id || ''))
          .filter(value => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)))];
        tournament.participantAvatars = {};
        if (participantIds.length) {
          // Only check which participants have an icon. Never transfer
          // megabytes of avatar base64 inside the tournament JSON.
          const { data: profiles, error: avatarError } = await supabase.from('profiles')
            .select('user_id').in('user_id', participantIds)
            .not('avatar_data', 'is', null).neq('avatar_data', '');
          if (avatarError) console.error('Tournament participant avatar list failed:', avatarError);
          else tournament.participantAvatars = Object.fromEntries(
            (profiles || []).map(profile => [
              profile.user_id,
              '/api/profile/avatar?userId=' + encodeURIComponent(profile.user_id),
            ])
          );
        }
        }
      const payload = JSON.stringify({ tournament });
      // ETag is derived from the caller-specific, redacted response.
      const etag = '"' + createHash('sha256').update(payload).digest('hex') + '"';
      const liveVersion = liveMode ? liveVersionToken(
        id, data.data?.stageActionRevision, user, legacyOwnerToken
      ) : '';
      const responseHeaders = {
        ETag: etag, 'Cache-Control': 'private, no-cache',
        ...(liveVersion ? { 'X-Tournament-Version': liveVersion } : {}),
      };
      if (request.headers.get('if-none-match') === etag) {
        return new NextResponse(null, { status: 304, headers: responseHeaders });
      }
      return new NextResponse(payload, { headers: {
        ...responseHeaders, 'Content-Type': 'application/json; charset=utf-8',
      } });
    }
    const summaryMode = searchParams.get('view') === 'summary';
    let summaryRows = null;
    if (summaryMode) {
      try {
        summaryRows = searchParams.has('refresh')
          ? await readTournamentSummaries(supabase)
          : await cachedTournamentSummaries();
      } catch (projectionError) {
        // Retain compatibility with older PostgREST deployments.
        console.warn('Summary projection unavailable, using full records:', projectionError.message);
      }
    }
    const allRows = summaryRows || (await (async () => {
      const rows = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase.from('tournaments')
          .select('id,data,owner_token,created_at')
          .order('created_at', { ascending: false }).range(from, from + 499);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 500) return rows;
      }
    })());
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const compact = summaryMode && Boolean(summaryRows);
    const rows = summaryMode ? allRows.filter(row => {
      const finished = compact
        ? row.complete === true || row.complete === 'true' || ['終了', '終了済み', '大会終了'].includes(row.status)
        : row.data?.bracket?.complete === true || ['終了', '終了済み', '大会終了'].includes(row.data?.status);
      const stamp = compact
        ? Date.parse(row.completed_at || row.date || '') : Date.parse(row.data?.completedAt || row.data?.date || '');
      return !finished || (Number.isFinite(stamp) && stamp >= cutoff);
    }) : allRows;
    const ownerIds = [...new Set(rows.map(row => compact ? row.owner_user_id : row.data?.ownerUserId).filter(Boolean))];
    let ownerNames = new Map();
    if (ownerIds.length) {
      const { data: profiles, error: profileError } = await supabase.from('profiles')
        .select('user_id,display_name').in('user_id', ownerIds);
      if (profileError) console.error('Tournament organizer names could not be loaded:', profileError);
      else ownerNames = new Map((profiles || []).map(profile => [profile.user_id, profile.display_name]));
    }
    const tournaments = rows.map(row => {
      if (!summaryMode) return {
        ...publicTournament(row, user),
        organizerName: ownerNames.get(row.data?.ownerUserId) || row.data?.organizerName || '',
      };
      const t = compact ? {
        id: row.record_id || row.id, name: row.name, format: row.format,
        date: row.date, participants: Number(row.participants) || 8,
        joinedPlayers: Array.isArray(row.joined_players) ? Array(row.joined_players.length).fill(null) : [],
        status: row.status, completedAt: row.completed_at,
        bracket: { complete: row.complete === 'true' || row.complete === true },
        ownerUserId: row.owner_user_id, organizerName: row.organizer_name,
      } : row.data || {};
      return {
        id: t.id || row.id, name: t.name, format: t.format,
        date: t.date, participants: t.participants,
        joinedPlayers: compact ? t.joinedPlayers : Array.isArray(t.joinedPlayers) ? Array(t.joinedPlayers.length).fill(null) : [],
        status: t.status, completedAt: t.completedAt,
        bracket: { complete: t.bracket?.complete === true },
        organizerName: ownerNames.get(t.ownerUserId) || t.organizerName || '',
      };
    });
    return NextResponse.json({ tournaments }, {
      headers: summaryMode && !searchParams.has('refresh')
        ? { 'Cache-Control': 'public, s-maxage=8, stale-while-revalidate=20' }
        : { 'Cache-Control': 'no-store' },
    });
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
    // Preserve legacy tournament IDs, but reject matching existing records.
    const { data: existing, error: lookupError } = await supabase.from('tournaments')
      .select('id').contains('data', { ownerUserId: user.id, name, date: tournament.date }).limit(1);
    if (lookupError) throw lookupError;
    if (existing?.length) return NextResponse.json(
      { error: '同じ大会名・開催日時の大会がすでに作成されています。大会一覧を確認してください。' },
      { status: 409 }
    );
    // The deterministic primary key also prevents concurrent requests racing
    // past the lookup from creating two rows with the same owner/name/date.
    const uniqueId = 't-' + createHash('sha256')
      .update(JSON.stringify([user.id, name, tournament.date || ''])).digest('hex').slice(0, 32);
    tournament.id = uniqueId;
    const { error } = await supabase.from('tournaments').insert({
      id: uniqueId,
      data: tournament,
      owner_token: randomUUID(),
    });
    if (error?.code === '23505') return NextResponse.json(
      { error: 'この大会はすでに作成されています。大会一覧を確認してください。' },
      { status: 409 }
    );
    if (error) throw error;
    return NextResponse.json({ ok: true, id: uniqueId }, { status: 201 });
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

    // Settings edits must never replace the tournament document or erase registrations.
    // Only explicitly editable settings are copied onto the latest server version.
    if (body?.editSettings === true) {
      if (!isCurrentOwner) return NextResponse.json({ error: '大会設定を編集する権限がありません。' }, { status: 403 });
      if (existing.bracket) return NextResponse.json({ error: '大会開始後は設定を編集できません。' }, { status: 409 });
      const editableFields = [
        'name', 'description', 'streamUrl', 'streamFriendCode', 'seriesTags',
        'format', 'bestOf', 'participants', 'date', 'stages', 'stageRejects',
        'autoSeed', 'characterDeclaration', 'stageSettings',
      ];
      const updatedSettings = { ...existing };
      for (const field of editableFields) {
        if (Object.prototype.hasOwnProperty.call(input, field)) updatedSettings[field] = input[field];
      }
      if (Number(updatedSettings.participants) < (existing.joinedPlayers || []).length) {
        return NextResponse.json({ error: '参加人数を現在の登録者数より少なくできません。' }, { status: 400 });
      }
      const { data: saved, error: saveError } = await saveTournamentRevision(supabase, id, existing, updatedSettings);
      if (saveError) throw saveError;
      if (!saved?.length) return NextResponse.json({ error: '他の操作が先に保存されました。画面を更新してやり直してください。' }, { status: 409 });
      return NextResponse.json({ ok: true });
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
    const { data: changed, error } = await saveTournamentRevision(supabase, id, existing, updated);
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
