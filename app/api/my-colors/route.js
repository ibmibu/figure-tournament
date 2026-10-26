import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

async function authenticate(request) {
  const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { error: NextResponse.json({ error: 'ログインしてください。' }, { status: 401 }) };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error('Supabaseの設定が不足しています。');
  const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data?.user) return { error: NextResponse.json({ error: 'ログインし直してください。' }, { status: 401 }) };
  return { user: data.user, admin: createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) };
}

function validateColors(colors) {
  if (!Array.isArray(colors) || colors.length > 100) return null;
  const seen = new Set();
  const normalized = [];
  for (const item of colors) {
    if (!item || typeof item.fighter !== 'string' || !item.fighter.trim() || item.fighter.length > 80 || !/^[1-8]P$/.test(item.color) || seen.has(item.fighter)) return null;
    seen.add(item.fighter);
    normalized.push({ fighter: item.fighter, color: item.color });
  }
  return normalized;
}

export async function GET(request) {
  try {
    const auth = await authenticate(request);
    if (auth.error) return auth.error;
    const { data, error } = await auth.admin.from('user_fighter_colors').select('colors').eq('user_id', auth.user.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ colors: data?.colors ?? null });
  } catch (error) {
    console.error('GET /api/my-colors:', error);
    return NextResponse.json({ error: 'マイカラーを読み込めませんでした。Supabaseのテーブル設定を確認してください。' }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const auth = await authenticate(request);
    if (auth.error) return auth.error;
    const colors = validateColors((await request.json()).colors);
    if (!colors) return NextResponse.json({ error: 'カラー情報が正しくありません。' }, { status: 400 });
    const { error } = await auth.admin.from('user_fighter_colors').upsert({ user_id: auth.user.id, colors, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    return NextResponse.json({ colors });
  } catch (error) {
    console.error('PUT /api/my-colors:', error);
    return NextResponse.json({ error: 'マイカラーを保存できませんでした。Supabaseのテーブル設定を確認してください。' }, { status: 500 });
  }
}
