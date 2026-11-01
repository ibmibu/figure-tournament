import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { OVERLAY_IMAGE_BUCKET, OVERLAY_IMAGE_CATEGORIES, OVERLAY_SLOTS } from '../../../lib/overlay-scoreboard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
function db(key) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
async function ensurePublicBucket(admin) {
  const { data: bucket, error: readError } = await admin.storage.getBucket(OVERLAY_IMAGE_BUCKET);
  if (bucket) {
    if (!bucket.public) {
      const { error } = await admin.storage.updateBucket(OVERLAY_IMAGE_BUCKET, {
        public: true, allowedMimeTypes: ['image/webp'], fileSizeLimit: 1048576,
      });
      if (error) throw error;
    }
    return;
  }
  const status = Number(readError?.status || readError?.statusCode);
  if (readError && status !== 404 && !/not found|does not exist/i.test(readError.message || '')) throw readError;
  const { error: createError } = await admin.storage.createBucket(OVERLAY_IMAGE_BUCKET, {
    public: true, allowedMimeTypes: ['image/webp'], fileSizeLimit: 1048576,
  });
  if (createError && Number(createError.status || createError.statusCode) !== 409 &&
      !/already exists|duplicate/i.test(createError.message || '')) throw createError;
}
export async function POST(request) {
  try {
    const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ error: 'ログインしてください。' }, 401);
    const { data: authData, error: authError } = await db(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: 'ログインし直してください。' }, 401);
    const form = await request.formData();
    const slot = Number(form.get('slot'));
    const category = form.get('category');
    const file = form.get('file');
    if (!OVERLAY_SLOTS.includes(slot) || !OVERLAY_IMAGE_CATEGORIES.includes(category) ||
      !file || typeof file.arrayBuffer !== 'function' || file.type !== 'image/webp' ||
      file.size < 12 || file.size > 1048576) return json({ error: 'WebP画像（1MB以下）を選んでください。' }, 400);
    const bytes = Buffer.from(await file.arrayBuffer());
    // Restrict uploads to re-encoded WebP images, never arbitrary HTML/SVG.
    if (bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
      bytes.subarray(8, 12).toString('ascii') !== 'WEBP') return json({ error: '画像形式が正しくありません。' }, 400);
    const admin = db(process.env.SUPABASE_SERVICE_ROLE_KEY);
    await ensurePublicBucket(admin);
    const imagePath = `${user.id}/${slot}/${category}/${randomUUID()}.webp`;
    const { error: uploadError } = await admin.storage.from(OVERLAY_IMAGE_BUCKET).upload(imagePath, bytes, {
      contentType: 'image/webp', cacheControl: '31536000', upsert: false,
    });
    if (uploadError) throw uploadError;
    return json({ path: imagePath });
  } catch (error) {
    console.error('Overlay image upload failed:', error);
    return json({ error: '画像を保存できませんでした。ストレージ設定を確認してください。' }, 500);
  }
}
