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
  return { ...publicData, isOwner };
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
    return NextResponse.json({ tournaments: (data || []).map(row => publicTournament(row, user)) });
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

    const { ownerId, ownerUserId, ...safeTournament } = input;
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
    if (!isCurrentOwner) return NextResponse.json({ error: '更新する権限がありません。' }, { status: 403 });

    const { ownerId, ownerUserId, ...safeInput } = input;
    const updated = { ...safeInput, ownerUserId: existingOwnerId || user.id };
    const { error } = await supabase.from('tournaments').update({ data: updated }).eq('id', id);
    if (error) throw error;
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
