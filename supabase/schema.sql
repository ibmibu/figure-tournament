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
