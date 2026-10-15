-- Community events reach members as notifications instead of a list in Find a buddy.
-- New event -> every member (except the creator) is notified and can join from the notification.
-- New member -> notified about every upcoming event.
-- Event cancelled -> everyone who joined is notified.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('match', 'booked', 'cancelled', 'event', 'event_cancelled'));
alter table public.notifications add column event_id uuid references public.events (id) on delete cascade;
create index notifications_event_idx on public.notifications (event_id);

create function public.notify_new_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, kind, event_id, slots)
  select p.id, 'event', new.id, array[new.starts_at]
  from public.profiles p where p.id is distinct from new.created_by;
  return new;
end $$;
create trigger on_event_created after insert on public.events
  for each row execute function public.notify_new_event();

create function public.notify_event_cancelled() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, kind, slots, note)
  select s.user_id, 'event_cancelled', array[old.starts_at], old.title
  from public.event_signups s where s.event_id = old.id;
  return old;
end $$;
create trigger on_event_cancelled before delete on public.events
  for each row execute function public.notify_event_cancelled();

create function public.notify_member_of_events() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, kind, event_id, slots)
  select new.id, 'event', e.id, array[e.starts_at]
  from public.events e where e.starts_at + make_interval(mins => e.duration_min) > now();
  return new;
end $$;
create trigger on_profile_created_events after insert on public.profiles
  for each row execute function public.notify_member_of_events();

-- Events created before this change: notify everyone who hasn't been told yet.
insert into public.notifications (user_id, kind, event_id, slots)
select p.id, 'event', e.id, array[e.starts_at]
from public.events e cross join public.profiles p
where e.starts_at + make_interval(mins => e.duration_min) > now()
  and p.id is distinct from e.created_by
  and not exists (select 1 from public.notifications n where n.user_id = p.id and n.event_id = e.id);

revoke execute on function public.notify_new_event() from public, anon, authenticated;
revoke execute on function public.notify_event_cancelled() from public, anon, authenticated;
revoke execute on function public.notify_member_of_events() from public, anon, authenticated;
