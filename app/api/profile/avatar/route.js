import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
const CACHE = 'public, max-age=300, s-maxage=300, stale-while-revalidate=60';
// Only publicly displayed tournament participant avatars are read here.
// Do not include email, friend code or other profile fields in the response.
export async function GET(request) {
  const userId = new URL(request.url).searchParams.get('userId') || '';
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(userId) || userId.length > 36)
    return NextResponse.json({ error: '不正なユーザーID' }, { status: 400 });
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.from('profiles').select('avatar_data')
      .eq('user_id', userId).maybeSingle();
    if (error) throw error;
    const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/
      .exec(data?.avatar_data || '');
    if (!match)
      return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE } });
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 5 * 1024 * 1024)
      return new NextResponse(null, { status: 404, headers: { 'Cache-Control': CACHE } });
    const etag = '"' + createHash('sha256').update(bytes).digest('hex') + '"';
    if (request.headers.get('if-none-match') === etag)
      return new NextResponse(null, { status: 304, headers: { ETag: etag, 'Cache-Control': CACHE } });
    const mime = match[1] === 'jpeg' ? 'image/jpeg' : 'image/' + match[1];
    return new NextResponse(bytes, { headers: {
      'Content-Type': mime,
      'Content-Length': String(bytes.length),
      'Cache-Control': CACHE,
      'ETag': etag,
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    console.error('Avatar image read failed:', error);
    return NextResponse.json({ error: 'アイコンを読み込めませんでした。' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
