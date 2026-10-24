import { createClient } from '@supabase/supabase-js';

let supabase;

export function getSupabaseBrowserClient() {
  if (supabase) return supabase;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Supabaseの公開キーが設定されていません。');
  }

  supabase = createClient(url, key);
  return supabase;
}
