-- Remember whether the "your dyad was booked" email went out, so it's sent once per booking.
alter table public.sessions add column booking_email_sent_at timestamptz;
