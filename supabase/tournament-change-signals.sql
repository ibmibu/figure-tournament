-- Run once in the Supabase SQL editor before enabling Realtime in Vercel.
-- Notifications contain only tournament IDs and random revision tokens.
-- NEVER add public.tournaments to the Realtime publication: its data JSON
-- contains private participant and tournament information.

create table if not exists public.tournament_change_signals (
  tournament_id text primary key,
  revision uuid not null default gen_random_uuid()
);

alter table public.tournament_change_signals enable row level security;
revoke all on public.tournament_change_signals from anon, authenticated;
grant select on public.tournament_change_signals to anon, authenticated;

drop policy if exists "Read tournament change signals" on public.tournament_change_signals;
create policy "Read tournament change signals"
  on public.tournament_change_signals for select
  to anon, authenticated using (true);

create or replace function public.notify_tournament_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    delete from public.tournament_change_signals where tournament_id = OLD.id;
    return OLD;
  end if;
  insert into public.tournament_change_signals (tournament_id, revision)
  values (NEW.id, gen_random_uuid())
  on conflict (tournament_id) do update set revision = excluded.revision;
  return NEW;
end;
$$;

drop trigger if exists tournament_change_signal_trigger on public.tournaments;
create trigger tournament_change_signal_trigger
after insert or update or delete on public.tournaments
for each row execute function public.notify_tournament_change();

-- Backfill signals for tournaments created before this migration.
insert into public.tournament_change_signals (tournament_id)
select id from public.tournaments
on conflict (tournament_id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tournament_change_signals'
  ) then
    alter publication supabase_realtime add table public.tournament_change_signals;
  end if;
end;
$$;
