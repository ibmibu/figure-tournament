import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server environment variables are missing.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function publicTournament(row, ownerToken = '') {
  const data = row.data || {};
  const { ownerId, ...publicData } = data;
  return { ...publicData, isOwner: Boolean(ownerToken && row.owner_token === ownerToken) };
}

export async function GET(request) {
  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const ownerToken = searchParams.get('ownerToken') || '';
    if (id) {
      const { data, error } = await supabase.from('tournaments').select('id,data,owner_token,created_at').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });
      return NextResponse.json({ tournament: publicTournament(data, ownerToken) });
    }
    const { data, error } = await supabase.from('tournaments').select('id,data,owner_token,created_at').order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ tournaments: (data || []).map(row => publicTournament(row)) });
  } catch (error) {
    console.error('GET /api/tournaments failed:', error);
    return NextResponse.json({ error: '大会データを読み込めませんでした。Supabaseの設定を確認してください。' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const tournament = body?.tournament;
    const ownerToken = String(tournament?.ownerId || '');
    const id = String(tournament?.id || '');
    if (!tournament || !id || !ownerToken || !String(tournament.name || '').trim()) {
      return NextResponse.json({ error: '大会情報が不足しています。' }, { status: 400 });
    }
    const supabase = getSupabase();
    const { error } = await supabase.from('tournaments').insert({
      id,
      data: tournament,
      owner_token: ownerToken,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    console.error('POST /api/tournaments failed:', error);
    return NextResponse.json({ error: '大会を保存できませんでした。Supabaseの設定を確認してください。' }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const tournament = body?.tournament;
    const ownerToken = String(body?.ownerToken || '');
    const id = String(tournament?.id || '');
    if (!tournament || !id || !ownerToken) return NextResponse.json({ error: '更新情報が不足しています。' }, { status: 400 });
    const supabase = getSupabase();
    const { data: row, error: readError } = await supabase.from('tournaments').select('owner_token').eq('id', id).maybeSingle();
    if (readError) throw readError;
    if (!row) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });
    if (row.owner_token !== ownerToken) return NextResponse.json({ error: '更新する権限がありません。' }, { status: 403 });
    const { error } = await supabase.from('tournaments').update({ data: tournament }).eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('PUT /api/tournaments failed:', error);
    return NextResponse.json({ error: '大会情報を保存できませんでした。' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json();
    const id = String(body?.id || '');
    const ownerToken = String(body?.ownerToken || '');
    if (!id || !ownerToken) return NextResponse.json({ error: '削除情報が不足しています。' }, { status: 400 });
    const supabase = getSupabase();
    const { data: row, error: readError } = await supabase.from('tournaments').select('owner_token').eq('id', id).maybeSingle();
    if (readError) throw readError;
    if (!row) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });
    if (row.owner_token !== ownerToken) return NextResponse.json({ error: '削除する権限がありません。' }, { status: 403 });
    const { error } = await supabase.from('tournaments').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/tournaments failed:', error);
    return NextResponse.json({ error: '大会を削除できませんでした。' }, { status: 500 });
  }
}
