# Breakthrough Online

A small web app for practitioners of the Breakthrough Intensive:

1. **Find a buddy**
   - Mark the hours you're free. When someone else is free at the same time, you both get a notification, and either of you can book the slot.
   - Booked dyads come with a video call link and "Save in calendar".
   - **Community events** (e.g. hosted by Frances) arrive as notifications, and members join from there. Admins create and manage events under Account → Events.
2. **Timer:** the dyad timer with the singing bowl and the recorded instructions.
3. **Inspiration:** a shared board of books, films, podcasts, talks and practices, with optional images. You can view it as a list or as tiles.
4. **Account**, with three sections:
   - **Profile:** photo, name, question, time zone and matching visibility.
   - **Notifications:** matches, bookings, cancellations and community events (with a Join button).
   - **Settings:** light, dark or automatic appearance; timer sound; change password; sign out; delete account.
   - **Events** (admins only): create events, see participants, cancel.

## Where the data lives

- **Live site:** accounts and data are shared through Supabase (project `breakthrough-app`, Frankfurt). People sign up with email and password. `js/config.js` holds the project address and its publishable key, which is safe to be public because the database's access rules decide what each person can see and change.
- **claude.ai preview:** the preview can't reach Supabase, so it falls back to `js/store-local.js`, which keeps everything in that browser. It also shows a "Local testing" panel with sample participants.

`js/store.js` picks one of the two. Both have the same methods, so the views don't change.

## Database

The schema is in `supabase/migrations/`:

- `001_tables.sql` holds the tables and access rules:
  - Members see each other's name, question, time zone and photo.
  - Emails stay private.
  - People see only their own dyads and updates.
  - Anyone can read the board, and only the author can remove an entry.
- `002_functions.sql` holds the server-side logic for matching, booking, cancelling, marking updates read and deleting an account.
- `003_meeting_link.sql` gives each booked dyad its own video call room.
- `004_community_events.sql` adds events, sign-ups and the admin list:
  - Admins are listed in the table `app_admins` (see "Who can create events" below).
  - Everyone sees events and how many are going.
  - Only participants and admins see the call link, and only admins see who's going.
- `006_event_notifications.sql` notifies every member about a new event, notifies new members about upcoming events, and tells participants when an event is cancelled.
- `008_admins_editable.sql` makes `app_admins` easy to edit by hand: it cleans up emails and adds name and date columns.
- `007_booking_email.sql` records when the booking email went out, so each booking is emailed only once.
- `005_inspiration_images.sql` adds the public `inspiration` Storage bucket. Members upload into their own folder.

**Matching:** whenever someone saves their hours, the database finds other people free at the same time and notifies both people once per shared hour. Booking an hour removes it from both people's availability and notifies the other person. Cancelling notifies them too.

## Run it locally

Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000      # then open http://localhost:8000
```

Local runs use the shared Supabase database too.

## Who can create events

Only people listed in the Supabase table `app_admins` can create, manage and cancel community events. Everyone else just gets notified.

- **Add someone:**
  1. In Supabase, open **Table Editor → app_admins → Insert row**.
  2. Enter their email (the one they sign in with) and optionally their name.
  3. Click **Save**. Capital letters and spaces are fixed automatically.
- **Remove someone:** delete their row.
- The change applies the next time that person opens the app or signs in.

## Server function

`supabase/functions/notify-booking` emails the buddy when someone books a dyad with them. The email includes the time in their own time zone, the video call link and a calendar file. It needs the secret `RESEND_API_KEY` from resend.com; without it, bookings still work and show up as in-app notifications. Once a domain is verified in Resend, set `EMAIL_FROM` (e.g. `Breakthrough Online <lisa@breakthrough-online.com>`).

## Still to do

- **Email.** Supabase's built-in email only reaches members of your Supabase team. Password-reset emails therefore reach other participants only after you connect an email service, such as Resend, under Authentication → Emails → SMTP. Keep "Confirm email" switched off until then.
- **Site URL.** Under Authentication → URL Configuration, set the Site URL to the live address, so links in emails (like password resets) open the app.
- **Vercel.** Connect the GitHub repo. It's a static site: Framework "Other", no build command.
