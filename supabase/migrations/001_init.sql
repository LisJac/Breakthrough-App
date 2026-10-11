-- Breakthrough App: schema, access rules and server functions.
-- Slots are UTC hour starts. Matching, booking and notifications run in
-- security-definer functions so people can't write each other's rows.

-- ---------- tables ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  question text not null default 'Who am I?' check (char_length(question) <= 120),
  timezone text not null default 'UTC' check (char_length(timezone) <= 64),
  looking_for_buddy boolean not null default true,
  photo text check (photo is null or (photo like 'data:image/%' and char_length(photo) < 200000)),
  created_at timestamptz not null default now()
);

create table public.availability (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  slot timestamptz not null,
  primary key (user_id, slot)
);
create index availability_slot_idx on public.availability (slot);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  a uuid not null references public.profiles (id) on delete cascade,
  b uuid not null references public.profiles (id) on delete cascade,
  slot timestamptz not null,
  created_at timestamptz not null default now(),
  check (a <> b)
);
create index sessions_a_idx on public.sessions (a, slot);
create index sessions_b_idx on public.sessions (b, slot);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('match','booked','cancelled')),
  other uuid references public.profiles (id) on delete set null,
  slots timestamptz[] not null default '{}',
  note text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_other_idx on public.notifications (other);

-- Which shared slots a pair has already been told about (internal only).
create table public.notified (
  pair text not null,
  slot timestamptz not null,
  primary key (pair, slot)
);

create table public.inspiration (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'book' check (type in ('book','film','podcast','talk','practice','other')),
  title text not null check (char_length(title) between 1 and 140),
  creator text not null default '' check (char_length(creator) <= 120),
  link text not null default '' check (char_length(link) <= 400 and (link = '' or link ~* '^https?://')),
  note text not null default '' check (char_length(note) <= 600),
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index inspiration_author_idx on public.inspiration (author_id);
create index inspiration_created_idx on public.inspiration (created_at desc);

-- ---------- row-level security ----------
alter table public.profiles enable row level security;
alter table public.availability enable row level security;
alter table public.sessions enable row level security;
alter table public.notifications enable row level security;
alter table public.notified enable row level security;
alter table public.inspiration enable row level security;

-- Members see each other's public profile (name, question, time zone, photo). Email stays in auth.
create policy "members read profiles" on public.profiles for select to authenticated using (true);
create policy "edit own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "members read availability" on public.availability for select to authenticated using (true);

create policy "read own dyads" on public.sessions for select to authenticated
  using ((select auth.uid()) in (a, b));

create policy "read own notifications" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

-- The board is public to read; members add entries and remove their own.
create policy "anyone reads the board" on public.inspiration for select to anon, authenticated using (true);
create policy "members add entries" on public.inspiration for insert to authenticated
  with check (author_id = (select auth.uid()));
create policy "authors remove entries" on public.inspiration for delete to authenticated
  using (author_id = (select auth.uid()));

-- ---------- new account -> profile ----------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name, question, timezone)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), 'Participant'), 60),
    left(coalesce(nullif(new.raw_user_meta_data->>'question', ''), 'Who am I?'), 120),
    left(coalesce(nullif(new.raw_user_meta_data->>'timezone', ''), 'UTC'), 64)
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- matching ----------
-- Tell both people, once, about each new shared future hour.
create function public.refresh_matches(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = uid and looking_for_buddy) then return; end if;
  with shared as (
    select o.user_id as other, m.slot,
           least(uid::text, o.user_id::text) || '|' || greatest(uid::text, o.user_id::text) as pair
    from public.availability m
    join public.availability o on o.slot = m.slot and o.user_id <> m.user_id
    join public.profiles p on p.id = o.user_id and p.looking_for_buddy
    where m.user_id = uid and m.slot > now()
  ), fresh as (
    insert into public.notified (pair, slot)
    select pair, slot from shared
    on conflict do nothing
    returning pair, slot
  ), grouped as (
    select s.other, array_agg(s.slot order by s.slot) as slots
    from shared s join fresh f on f.pair = s.pair and f.slot = s.slot
    group by s.other
  )
  insert into public.notifications (user_id, kind, other, slots)
  select uid, 'match', g.other, g.slots from grouped g
  union all
  select g.other, 'match', uid, g.slots from grouped g;
end $$;

-- Replace my future availability with this set, then look for matches.
create function public.set_availability(slots timestamptz[]) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  if coalesce(array_length(slots, 1), 0) > 2000 then raise exception 'Too many hours selected.'; end if;
  delete from public.availability where user_id = uid and slot > now();
  insert into public.availability (user_id, slot)
  select distinct uid, s from unnest(slots) s
  where s > now() and s < now() + interval '120 days'
    and not exists (select 1 from public.sessions x where x.slot = s and uid in (x.a, x.b))
  on conflict do nothing;
  perform public.refresh_matches(uid);
end $$;

create function public.refresh_my_matches() returns void
language sql security definer set search_path = '' as $$
  select public.refresh_matches(auth.uid());
$$;

-- ---------- booking ----------
create function public.book_dyad(other uuid, slot_at timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); sid uuid;
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  if other = uid then raise exception 'You can''t book a dyad with yourself.'; end if;
  if slot_at <= now() then raise exception 'That time has already passed.'; end if;
  -- lock both people's rows so two bookings can't race
  perform 1 from public.profiles where id in (uid, other) order by id for update;
  if not exists (select 1 from public.availability where user_id = other and slot = slot_at) then
    raise exception 'Your buddy is no longer free at that time.';
  end if;
  if exists (select 1 from public.sessions where slot = slot_at and (a in (uid, other) or b in (uid, other))) then
    raise exception 'One of you already has a dyad at that time.';
  end if;
  insert into public.sessions (a, b, slot) values (uid, other, slot_at) returning id into sid;
  delete from public.availability where slot = slot_at and user_id in (uid, other);
  insert into public.notifications (user_id, kind, other, slots) values (other, 'booked', uid, array[slot_at]);
  return sid;
end $$;

create function public.cancel_dyad(session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); s public.sessions;
begin
  select * into s from public.sessions where id = session_id and uid in (a, b);
  if not found then return; end if;
  delete from public.sessions where id = session_id;
  insert into public.notifications (user_id, kind, other, slots)
  values (case when s.a = uid then s.b else s.a end, 'cancelled', uid, array[s.slot]);
end $$;

create function public.mark_notifications_read() returns void
language sql security definer set search_path = '' as $$
  update public.notifications set read = true where user_id = auth.uid() and not read;
$$;

-- Number of people currently looking (shown to signed-out visitors).
create function public.looking_count() returns integer
language sql stable security definer set search_path = '' as $$
  select count(distinct a.user_id)::int
  from public.availability a join public.profiles p on p.id = a.user_id and p.looking_for_buddy
  where a.slot > now();
$$;

-- Delete my account and everything that belongs to it; tell any booked buddies.
create function public.delete_account() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  insert into public.notifications (user_id, kind, other, slots, note)
  select case when s.a = uid then s.b else s.a end, 'cancelled', null, array[s.slot], 'Your buddy deleted their account.'
  from public.sessions s where uid in (s.a, s.b) and s.slot > now();
  delete from auth.users where id = uid;
end $$;

-- ---------- who may call what ----------
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.refresh_matches(uuid) from public, anon, authenticated;
revoke execute on function public.set_availability(timestamptz[]) from public, anon;
revoke execute on function public.refresh_my_matches() from public, anon;
revoke execute on function public.book_dyad(uuid, timestamptz) from public, anon;
revoke execute on function public.cancel_dyad(uuid) from public, anon;
revoke execute on function public.mark_notifications_read() from public, anon;
revoke execute on function public.delete_account() from public, anon;
grant execute on function public.set_availability(timestamptz[]) to authenticated;
grant execute on function public.refresh_my_matches() to authenticated;
grant execute on function public.book_dyad(uuid, timestamptz) to authenticated;
grant execute on function public.cancel_dyad(uuid) to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;
grant execute on function public.delete_account() to authenticated;
grant execute on function public.looking_count() to anon, authenticated;

-- Profiles: members may only change these columns on their own row.
revoke update on public.profiles from anon, authenticated;
grant update (name, question, timezone, looking_for_buddy, photo) on public.profiles to authenticated;
