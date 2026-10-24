import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const next = searchParams.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const code = searchParams.get('code');

  // The browser Supabase client handles the PKCE session exchange from the callback URL.
  // Keep this route as a same-origin redirect target for OAuth.
  if (!code) {
    return NextResponse.redirect(new URL('/login?error=oauth_callback', origin));
  }

  return NextResponse.redirect(new URL(safeNext, origin));
}
