-- Breakthrough App: matching, booking and account functions.
-- Run after 001. Paste into Supabase → SQL Editor → Run.

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
