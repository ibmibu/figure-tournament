import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function authenticatedUser(request) {
  const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  return error ? null : data.user;
}
function fail(error, status, code) { return NextResponse.json({ error, ...(code ? { code } : {}) }, { status }); }
function databaseFailure(error, action) {
  console.error(`Tournament comments ${action} failed`, { code: error?.code, message: error?.message, details: error?.details });
  if (error?.code === '42P01' || error?.code === 'PGRST205') return fail('コメント用テーブルが見つかりません。Supabaseのテーブル設定を確認してください。', 503, error.code);
  if (error?.code === '42501') return fail('コメント用テーブルへのアクセス権限がありません。SupabaseのGRANT設定を確認してください。', 503, error.code);
  if (error?.code === '23503') return fail('投稿先の大会データが存在しません。ページを更新してください。', 409, error.code);
  return fail(`コメントの${action}に失敗しました。管理者にエラーコードを伝えてください。`, 500, error?.code || 'UNKNOWN');
}

// Public board messages are shared across viewers. A brief server cache
// prevents every viewer from re-reading the same rows on each poll.
async function readBoardUncached(id) {
  const db = adminClient();
  const { data: tournament, error: tournamentError } = await db.from('tournaments').select('id').eq('id', id).maybeSingle();
  if (tournamentError) throw tournamentError;
  if (!tournament) return null;
  const { data, error } = await db.from('tournament_board_messages')
    .select('id,author_name,is_organizer,body,created_at')
    .eq('tournament_id', id).order('created_at', { ascending: true }).limit(300);
  if (error) throw error;
  return data || [];
}
const readBoardCached = unstable_cache(readBoardUncached,
  ['public-tournament-board-v1'], { revalidate: 10 });

export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return fail('大会IDが必要です。', 400);
  try {
    const fresh = new URL(request.url).searchParams.get('fresh') === '1';
    const messages = await (fresh ? readBoardUncached(id) : readBoardCached(id));
    if (messages === null) return fail('大会が見つかりません。', 404);
    const etag = '"' + createHash('sha256').update(JSON.stringify(messages)).digest('hex') + '"';
    const headers = { ETag: etag, 'Cache-Control': 'no-cache' };
    if (!fresh && request.headers.get('if-none-match') === etag)
      return new NextResponse(null, { status: 304, headers });
    return NextResponse.json({ messages }, { headers });
  } catch (error) {
    console.error('Tournament board read failed', error);
    return fail('掲示板を読み込めませんでした。', 500);
  }
}

export async function POST(request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return fail('投稿にはログインが必要です。', 401);
    const { id, text } = await request.json();
    const tournamentId = String(id || '');
    const body = String(text || '').trim();
    if (!tournamentId || !body || body.length > 1000) return fail('本文は1〜1000文字で入力してください。', 400);
    const db = adminClient();
    const { data: tournament, error: readError } = await db.from('tournaments')
      .select('ownerUserId:data->>ownerUserId,joinedPlayers:data->joinedPlayers')
      .eq('id', tournamentId).maybeSingle();
    if (readError) return databaseFailure(readError, '投稿');
    if (!tournament) return fail('大会が見つかりません。', 404);
    // Membership and organizer rights need only the roster, not the entire
    // score history, stage actions, images and tournament logs.
    const organizer = String(tournament.ownerUserId || '') === String(user.id);
    const player = (tournament.joinedPlayers || []).find(p => !p.isDemo && String(p.userId || p.id) === String(user.id));
    if (!organizer && !player) return fail('主催者と大会参加者のみ投稿できます。', 403);
    // Per-account cooldown limits casual flooding without changing normal board behavior.
    const since = new Date(Date.now() - 5000).toISOString();
    const { data: recent, error: recentError } = await db.from('tournament_board_messages')
      .select('id').eq('author_id', user.id).gte('created_at', since).limit(1);
    if (recentError) return databaseFailure(recentError, '投稿制限の確認');
    if (recent?.length) return fail('連続投稿は5秒以上あけてください。', 429);
    const authorName = String(player?.name || user.user_metadata?.full_name || user.user_metadata?.name || '主催者').trim().slice(0, 80);
    const { data: postedMessage, error } = await db.from('tournament_board_messages').insert({
      tournament_id: tournamentId, author_id: user.id, author_name: authorName,
      is_organizer: organizer, body,
    }).select('id').single();
    if (error) return databaseFailure(error, '投稿');
    // The client uses this ID to avoid sounding an alert for its own post.
    return NextResponse.json({ ok: true, messageId: postedMessage.id }, { status: 201 });
  } catch (error) {
    console.error('Tournament board post failed', error);
    return fail('投稿できませんでした。', 500);
  }
}
