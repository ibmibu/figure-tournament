import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_OVERLAY_DESIGN, normalizeOverlayDesign, normalizeOverlayPresets, OVERLAY_SLOTS } from '../../../lib/overlay-scoreboard';

export const dynamic = 'force-dynamic';
const reply = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const client = key => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function authorize(request) {
  const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await client(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).auth.getUser(token);
  return !error ? data?.user || null : null;
}
async function readOwner(admin, owner) {
  const { data, error } = await admin.auth.admin.getUserById(owner);
  if (error) throw error;
  if (!data?.user) throw new Error('No owner');
  const meta = data.user.user_metadata || {};
  const presets = normalizeOverlayPresets(meta.overlayScoreboardPresets, meta.overlayScoreboard);
  return { meta, presets };
}
function slotNumber(value) {
  const slot = Number(value);
  return OVERLAY_SLOTS.includes(slot) ? slot : null;
}
export async function GET(request) {
  try {
    const owner = new URL(request.url).searchParams.get('owner');
    const admin = client(process.env.SUPABASE_SERVICE_ROLE_KEY);
    let userId;
    if (owner) {
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(owner) || owner.length > 36) return reply({ error: '主催者IDが正しくありません。' }, 400);
      userId = owner;
    } else {
      const user = await authorize(request);
      if (!user) return reply({ error: 'ログインしてください。' }, 401);
      userId = user.id;
    }
    let record;
    try { record = await readOwner(admin, userId); }
    catch (error) {
      if (error?.status === 404) return reply({ design: null, activeSlot: 1, slots: [null,null,null] });
      throw error;
    }
    const { presets } = record;
    const design = presets.slots[presets.activeSlot - 1];
    // Public OBS queries only receive the active layout; private editor
    // queries can inspect all three slots without sharing account metadata.
    return owner ? reply({ design, activeSlot: presets.activeSlot })
      : reply({ design, activeSlot: presets.activeSlot, slots: presets.slots });
  } catch (error) {
    console.error('Overlay design GET failed:', error);
    return reply({ error: 'デザインを読み込めませんでした。' }, 500);
  }
}
export async function PUT(request) {
  try {
    const user = await authorize(request);
    if (!user) return reply({ error: 'ログインしてください。' }, 401);
    const body = await request.json();
    const slot = slotNumber(body?.slot);
    if (!slot || !body?.design || typeof body.design !== 'object' ||
      JSON.stringify(body.design).length > 10000) return reply({ error: '保存先またはデザインが正しくありません。' }, 400);
    const admin = client(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { meta, presets } = await readOwner(admin, user.id);
    const design = normalizeOverlayDesign(body.design);
    // Only allow image paths inside this account and this preset slot.
    for (const [category, path] of Object.entries(design.images)) {
      if (path && !path.startsWith(user.id + '/' + slot + '/' + category + '/')) {
        return reply({ error: '画像の保存先が一致しません。画像を選び直してください。' }, 400);
      }
    }
    presets.slots[slot - 1] = design;
    presets.activeSlot = slot;
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...meta, overlayScoreboardPresets: presets },
    });
    if (error) throw error;
    return reply({ design, activeSlot: presets.activeSlot, slots: presets.slots });
  } catch (error) {
    console.error('Overlay design PUT failed:', error);
    return reply({ error: 'デザインを保存できませんでした。' }, 500);
  }
}
export async function PATCH(request) {
  try {
    const user = await authorize(request);
    if (!user) return reply({ error: 'ログインしてください。' }, 401);
    const { slot: requested } = await request.json();
    const slot = slotNumber(requested);
    if (!slot) return reply({ error: '保存先が正しくありません。' }, 400);
    const admin = client(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { meta, presets } = await readOwner(admin, user.id);
    if (!presets.slots[slot - 1]) return reply({ error: 'このスロットには保存されたデザインがありません。' }, 409);
    presets.activeSlot = slot;
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...meta, overlayScoreboardPresets: presets },
    });
    if (error) throw error;
    return reply({ design: presets.slots[slot - 1], activeSlot: slot, slots: presets.slots });
  } catch (error) {
    console.error('Overlay design PATCH failed:', error);
    return reply({ error: 'デザインを切り替えられませんでした。' }, 500);
  }
}
