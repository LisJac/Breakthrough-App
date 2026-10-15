-- Community events (e.g. hosted by Frances): admins create them, members join or withdraw.
-- Everyone sees the events and how many people are going; only participants and admins
-- see the call link; only admins see who is going.

-- ---------- admins ----------
create table public.app_admins (
  email text primary key check (email = lower(email))
);
alter table public.app_admins enable row level security;   -- no policies: only read through is_admin()
insert into public.app_admins (email) values ('lisa.jacob@gmx.de');

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admins a where a.email = lower(coalesce(auth.jwt()->>'email', '')));
$$;

-- ---------- events ----------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  host text not null default '' check (char_length(host) <= 80),
  description text not null default '' check (char_length(description) <= 1500),
  starts_at timestamptz not null,
  duration_min int not null default 60 check (duration_min between 10 and 600),
  meeting_url text not null default '' check (char_length(meeting_url) <= 400 and (meeting_url = '' or meeting_url ~* '^https://')),
  capacity int check (capacity is null or capacity between 1 and 1000),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index events_starts_idx on public.events (starts_at);
create index events_created_by_idx on public.events (created_by);
alter table public.events enable row level security;
create policy "admins read events" on public.events for select to authenticated using ((select public.is_admin()));
create policy "admins add events" on public.events for insert to authenticated with check ((select public.is_admin()));
create policy "admins edit events" on public.events for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins remove events" on public.events for delete to authenticated using ((select public.is_admin()));

create table public.event_signups (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index event_signups_user_idx on public.event_signups (user_id);
alter table public.event_signups enable row level security;
create policy "read own signups, admins read all" on public.event_signups for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "withdraw own signup" on public.event_signups for delete to authenticated
  using (user_id = (select auth.uid()));

-- Upcoming events with how many are going; the call link only for participants and admins.
create function public.list_events()
returns table (id uuid, title text, host text, description text, starts_at timestamptz, duration_min int,
               capacity int, meeting_url text, going int, i_am_going boolean)
language sql stable security definer set search_path = '' as $$
  select e.id, e.title, e.host, e.description, e.starts_at, e.duration_min, e.capacity,
         case when public.is_admin() or mine.yes then e.meeting_url else '' end,
         (select count(*)::int from public.event_signups s where s.event_id = e.id),
         coalesce(mine.yes, false)
  from public.events e
  left join lateral (
    select true as yes from public.event_signups s where s.event_id = e.id and s.user_id = auth.uid()
  ) mine on true
  where e.starts_at + make_interval(mins => e.duration_min) > now()
  order by e.starts_at;
$$;

-- Join, respecting the capacity even when several people join at once.
create function public.join_event(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); cap int; n int;
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  select e.capacity into cap from public.events e
   where e.id = p_event and e.starts_at + make_interval(mins => e.duration_min) > now()
   for update;
  if not found then raise exception 'This event is no longer open.'; end if;
  if cap is not null then
    select count(*) into n from public.event_signups s where s.event_id = p_event;
    if n >= cap then raise exception 'This event is full.'; end if;
  end if;
  insert into public.event_signups (event_id, user_id) values (p_event, uid) on conflict do nothing;
end $$;

revoke execute on function public.is_admin() from public;
revoke execute on function public.list_events() from public;
revoke execute on function public.join_event(uuid) from public, anon;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.list_events() to anon, authenticated;
grant execute on function public.join_event(uuid) to authenticated;
