import { NextResponse } from 'next/server';
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

export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return fail('大会IDが必要です。', 400);
  try {
    const db = adminClient();
    const { data: tournament, error: tournamentError } = await db.from('tournaments').select('id').eq('id', id).maybeSingle();
    if (tournamentError) return databaseFailure(tournamentError, '読み込み');
    if (!tournament) return fail('大会が見つかりません。', 404);
    const { data, error } = await db.from('tournament_board_messages').select('id,author_name,is_organizer,body,created_at').eq('tournament_id', id).order('created_at', { ascending: true }).limit(300);
    if (error) return databaseFailure(error, '読み込み');
    return NextResponse.json({ messages: data || [] });
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
    const { data: row, error: readError } = await db.from('tournaments').select('data').eq('id', tournamentId).maybeSingle();
    if (readError) return databaseFailure(readError, '投稿');
    if (!row) return fail('大会が見つかりません。', 404);
    const tournament = row.data || {};
    const organizer = String(tournament.ownerUserId || '') === String(user.id);
    const player = (tournament.joinedPlayers || []).find(p => !p.isDemo && String(p.userId || p.id) === String(user.id));
    if (!organizer && !player) return fail('主催者と大会参加者のみ投稿できます。', 403);
    const authorName = String(player?.name || user.user_metadata?.full_name || user.user_metadata?.name || '主催者').trim().slice(0, 80);
    const { error } = await db.from('tournament_board_messages').insert({
      tournament_id: tournamentId, author_id: user.id, author_name: authorName,
      is_organizer: organizer, body,
    });
    if (error) return databaseFailure(error, '投稿');
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error('Tournament board post failed', error);
    return fail('投稿できませんでした。', 500);
  }
}
