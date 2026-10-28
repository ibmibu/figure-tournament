import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

async function getAuthenticatedUser(request) {
  const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { error: NextResponse.json({ error: 'ログインしてください。' }, { status: 401 }) };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error('Supabaseの環境変数が設定されていません。');
  const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data?.user) return { error: NextResponse.json({ error: 'ログインし直してください。' }, { status: 401 }) };
  return { user: data.user, admin: createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) };
}

function reportError(error, operation) {
  console.error(operation, error);
  const detail = [error?.message, error?.code ? `code: ${error.code}` : ''].filter(Boolean).join(' / ');
  return NextResponse.json({ error: detail || '不明なエラーが発生しました。' }, { status: 500 });
}

export async function GET(request) {
  try {
    const result = await getAuthenticatedUser(request);
    if (result.error) return result.error;
    const { user, admin } = result;
    const { data, error } = await admin.from('profiles').select('display_name,avatar_data,friend_code,public_uid').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ profile: data || { display_name: 'no name', avatar_data: '' } });
  } catch (error) {
    return reportError(error, 'GET /api/profile failed:');
  }
}

export async function PUT(request) {
  try {
    const result = await getAuthenticatedUser(request);
    if (result.error) return result.error;
    const { user, admin } = result;
    const body = await request.json();
    const displayName = String(body.display_name || '').trim();
    const avatarData = String(body.avatar_data || '');
    const friendCode = String(body.friend_code || '').trim().toUpperCase();
    if (friendCode && !/^[A-Z0-9-]+$/.test(friendCode)) return NextResponse.json({ error: 'フレンドコードは英数字とハイフンのみで入力してください。' }, { status: 400 });
    if (!displayName || displayName.length > 40) return NextResponse.json({ error: '名前は1〜40文字で入力してください。' }, { status: 400 });
    if (avatarData && (!avatarData.startsWith('data:image/') || avatarData.length > 1400000)) {
      return NextResponse.json({ error: '画像は1MB以下の画像を選択してください。' }, { status: 400 });
    }
    const { data, error } = await admin.from('profiles').upsert({
      user_id: user.id,
      display_name: displayName,
      avatar_data: avatarData,
      friend_code: friendCode,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' }).select('display_name,avatar_data,friend_code,public_uid').single();
    if (error) throw error;
    return NextResponse.json({ profile: data });
  } catch (error) {
    return reportError(error, 'PUT /api/profile failed:');
  }
}
