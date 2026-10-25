-- Run in Supabase SQL Editor before using /admin/player-links.
create table if not exists public.legacy_player_links (
  legacy_player_id text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.legacy_player_links enable row level security;
-- No public policies: only the server-side service role may access this table.
