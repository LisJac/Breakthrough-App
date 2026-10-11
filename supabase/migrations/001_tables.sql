-- Breakthrough App: tables and access rules (applied 2026-10-11).
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
