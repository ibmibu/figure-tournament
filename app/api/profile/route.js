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
  return NextResponse.json({ error: 'プロフィールの処理に失敗しました。しばらくしてから再試行してください。' }, { status: 500 });
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
    if (avatarData && (!avatarData.startsWith('data:image/') || avatarData.length > 7000000)) {
      return NextResponse.json({ error: '画像は5MB以下の画像を選択してください。' }, { status: 400 });
    }
    if (avatarData) {
      const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(avatarData);
      if (!match) return NextResponse.json({ error: '画像はPNG・JPEG・GIF・WebP形式で登録してください。' }, { status: 400 });
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length > 5 * 1024 * 1024 || bytes.length === 0) return NextResponse.json({ error: '画像は5MB以下にしてください。' }, { status: 400 });
      const signatures = {
        png: bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
        jpeg: bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')),
        gif: ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')),
        webp: bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP',
      };
      if (!signatures[match[1]]) return NextResponse.json({ error: '画像ファイルの形式が正しくありません。' }, { status: 400 });
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
