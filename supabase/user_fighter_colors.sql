-- Run once in Supabase SQL Editor to sync My Colors across devices.
create table if not exists public.user_fighter_colors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  colors jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_fighter_colors enable row level security;
-- The authenticated server API uses the service role; no public RLS policies.
