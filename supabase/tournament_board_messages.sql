-- Run once in the Supabase SQL Editor before deploying the tournament board.
create table if not exists public.tournament_board_messages (
  id uuid primary key default gen_random_uuid(),
  tournament_id text not null references public.tournaments(id) on delete cascade,
  author_id uuid not null,
  author_name text not null,
  is_organizer boolean not null default false,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists tournament_board_messages_tournament_time_idx
  on public.tournament_board_messages (tournament_id, created_at);
alter table public.tournament_board_messages enable row level security;
-- No direct client policies: reads and writes go through the server API.
-- The API validates organizer/participant identity before inserting.
