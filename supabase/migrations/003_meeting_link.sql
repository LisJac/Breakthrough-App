-- Every booked dyad gets its own video call room (Jitsi Meet, no account setup needed).
-- Either partner can swap in their own link (Zoom, Google Meet ...).
alter table public.sessions
  add column meeting_url text not null
  default ('https://meet.jit.si/breakthrough-dyad-' || substr(md5(gen_random_uuid()::text), 1, 16))
  check (char_length(meeting_url) <= 400 and meeting_url ~* '^https://');

create policy "partners change the call link" on public.sessions for update to authenticated
  using ((select auth.uid()) in (a, b)) with check ((select auth.uid()) in (a, b));

revoke update on public.sessions from anon, authenticated;
grant update (meeting_url) on public.sessions to authenticated;
