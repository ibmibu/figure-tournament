import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const token = (request.headers.get('authorization') || '').match(/^Bearer\\s+(.+)$/i)?.[1];
    if (!token) return NextResponse.json({ error: 'ログインしてください。' }, { status: 401 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const auth = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data: { user }, error: authError } = await auth.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: '認証できませんでした。' }, { status: 401 });
    const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: '大会IDが必要です。' }, { status: 400 });
    const { data: row, error } = await db.from('tournaments').select('data').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!row) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });
    const tournament = row.data || {};
    if (String(tournament.ownerUserId) !== String(user.id)) return NextResponse.json({ error: '主催者のみ閲覧できます。' }, { status: 403 });
    const players = (tournament.joinedPlayers || []).filter(p => !p.isDemo).map(p => ({
      id: String(p.id),
      name: p.name || p.displayName || '名前未登録',
      characters: tournament.characterReports?.[String(p.id)]?.characters || []
    }));
    return NextResponse.json({ name: tournament.name || '', players }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Organizer reports:', error);
    return NextResponse.json({ error: 'キャラ報告を読み込めませんでした。' }, { status: 500 });
  }
}
