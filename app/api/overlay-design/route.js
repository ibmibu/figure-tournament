import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizeOverlayDesign } from '../../../lib/overlay-scoreboard';

export const dynamic = 'force-dynamic';
const respond = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const client = key => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function authenticatedUser(request) {
  const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await client(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export async function GET(request) {
  try {
    const owner = new URL(request.url).searchParams.get('owner');
    const admin = client(process.env.SUPABASE_SERVICE_ROLE_KEY);
    let userId;
    if (owner) {
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(owner) || owner.length > 36) return respond({ error: '主催者IDが正しくありません。' }, 400);
      userId = owner;
    } else {
      const user = await authenticatedUser(request);
      if (!user) return respond({ error: 'ログインしてください。' }, 401);
      userId = user.id;
    }
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error) {
      // A deleted or unavailable owner should not prevent OBS showing the
      // original uncustomized scoreboard.
      if (error.status === 404) return respond({ design: null });
      throw error;
    }
    const stored = data?.user?.user_metadata?.overlayScoreboard;
    return respond({ design: stored?.version === 1 ? normalizeOverlayDesign(stored) : null });
  } catch (error) {
    console.error('Overlay design GET failed:', error);
    return respond({ error: 'デザインを読み込めませんでした。' }, 500);
  }
}

export async function PUT(request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return respond({ error: 'ログインしてください。' }, 401);
    const body = await request.json();
    if (!body || typeof body !== 'object' || !body.design ||
      JSON.stringify(body.design).length > 10000) return respond({ error: 'デザイン情報が正しくありません。' }, 400);
    const design = normalizeOverlayDesign(body.design);
    const admin = client(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: latest, error: readError } = await admin.auth.admin.getUserById(user.id);
    if (readError || !latest?.user) throw readError || new Error('User not found');
    // Preserve Google login metadata and other profile fields.
    const user_metadata = { ...(latest.user.user_metadata || {}), overlayScoreboard: design };
    const { error: writeError } = await admin.auth.admin.updateUserById(user.id, { user_metadata });
    if (writeError) throw writeError;
    return respond({ design });
  } catch (error) {
    console.error('Overlay design PUT failed:', error);
    return respond({ error: 'デザインを保存できませんでした。' }, 500);
  }
}
