# Breakthrough Online

A small web app for practitioners of the Breakthrough Intensive:

1. **Find a buddy**
   - Mark the hours you're free. When someone else is free at the same time, you both get a notification, and either of you can book the slot.
   - Booked dyads come with a video call link and "Save in calendar".
   - **Community events** (e.g. hosted by Frances) appear at the top. Members join with one tap. Admins create events and see who is going.
2. **Timer:** the dyad timer with the singing bowl and the recorded instructions.
3. **Inspiration:** a shared board of books, films, podcasts, talks and practices, with optional images. You can view it as a list or as tiles.
4. **Account**, with three sections:
   - **Profile:** photo, name, question, time zone and matching visibility.
   - **Notifications:** matches, bookings and cancellations.
   - **Settings:** light, dark or automatic appearance; change password; sign out; delete account.

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
  - Admins are listed by email in `app_admins`. To add Frances, run `insert into public.app_admins (email) values ('her@email');` in the SQL editor.
  - Everyone sees events and how many are going.
  - Only participants and admins see the call link, and only admins see who's going.
- `005_inspiration_images.sql` adds the public `inspiration` Storage bucket. Members upload into their own folder.

**Matching:** whenever someone saves their hours, the database finds other people free at the same time and notifies both people once per shared hour. Booking an hour removes it from both people's availability and notifies the other person. Cancelling notifies them too.

## Run it locally

Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000      # then open http://localhost:8000
```

Local runs use the shared Supabase database too.

## Still to do

- **Email.** Supabase's built-in email only reaches members of your Supabase team. Password-reset emails therefore reach other participants only after you connect an email service, such as Resend, under Authentication → Emails → SMTP. Keep "Confirm email" switched off until then.
- **Site URL.** Under Authentication → URL Configuration, set the Site URL to the live address, so links in emails (like password resets) open the app.
- **Vercel.** Connect the GitHub repo. It's a static site: Framework "Other", no build command.
