-- Figure Tournament: shared tournament records
create table if not exists public.tournaments (
  id text primary key,
  data jsonb not null,
  owner_token text not null,
  created_at timestamptz not null default now()
);

-- All reads/writes are performed by the server API using the service-role key.
-- Keep direct client access blocked by RLS.
alter table public.tournaments enable row level security;


-- Per-user Figure Tournament profile (default values are applied by the app).
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'no name',
  avatar_data text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
