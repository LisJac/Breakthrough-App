-- Make the admin list easy to edit by hand in Supabase (Table Editor -> app_admins):
-- emails are cleaned up automatically (spaces, capital letters) and there's a name column
-- so it's clear who each row is.
alter table public.app_admins drop constraint app_admins_email_check;
alter table public.app_admins add column name text not null default '';
alter table public.app_admins add column added_at timestamptz not null default now();
comment on table public.app_admins is 'People who may create and manage community events. Add a row with their email; remove the row to take the right away.';
comment on column public.app_admins.email is 'The email they sign in with (capital letters and spaces are fixed automatically).';
comment on column public.app_admins.name is 'Optional: who this is, for your own overview.';

create function public.clean_admin_email() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.email := lower(trim(new.email));
  if new.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter a valid email address.';
  end if;
  return new;
end $$;
create trigger app_admins_clean_email before insert or update on public.app_admins
  for each row execute function public.clean_admin_email();
revoke execute on function public.clean_admin_email() from public, anon, authenticated;

update public.app_admins set name = 'Lisa' where email = 'lisa.jacob@gmx.de';
