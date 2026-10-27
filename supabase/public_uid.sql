-- Run once in Supabase SQL Editor before deploying the UID display.
-- Keeps auth.users UUIDs unchanged. Assigns existing accounts in signup order.
begin;
alter table public.profiles add column if not exists public_uid bigint;
create sequence if not exists public.figure_public_uid_seq as bigint start with 1 increment by 1;
alter sequence public.figure_public_uid_seq owned by public.profiles.public_uid;
-- Prevent a second migration from reusing existing numbers.
select setval('public.figure_public_uid_seq',
  greatest(coalesce((select max(public_uid) from public.profiles), 0), 1),
  (select coalesce(max(public_uid), 0) > 0 from public.profiles));
-- Assign numbers strictly in auth.users creation order, including accounts
-- that have not yet created a profile.
do $$
declare account record;
begin
  for account in
    select u.id from auth.users u
    left join public.profiles p on p.user_id = u.id
    where p.public_uid is null
    order by u.created_at, u.id
  loop
    insert into public.profiles (user_id, display_name, avatar_data, public_uid)
    values (account.id, 'no name', '', nextval('public.figure_public_uid_seq'))
    on conflict (user_id) do update
      set public_uid = excluded.public_uid
      where public.profiles.public_uid is null;
  end loop;
end $$;
alter table public.profiles alter column public_uid set default nextval('public.figure_public_uid_seq');
create unique index if not exists profiles_public_uid_unique on public.profiles(public_uid);
create or replace function public.figure_create_profile_on_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id, display_name, avatar_data)
  values(new.id, 'no name', '')
  on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists figure_profile_on_signup on auth.users;
create trigger figure_profile_on_signup
after insert on auth.users for each row execute function public.figure_create_profile_on_signup();
commit;
