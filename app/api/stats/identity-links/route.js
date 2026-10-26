import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

// Only expose links for participants in public tournament brackets.
export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase is not configured');
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: rows, error } = await db.from('legacy_player_links').select('legacy_player_id,user_id');
    if (error) throw error;
    return NextResponse.json({ links: rows || [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Stats identity links:', error);
    return NextResponse.json({ error: '旧ID連携情報を取得できませんでした。' }, { status: 500 });
  }
}
