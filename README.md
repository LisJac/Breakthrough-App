# Breakthrough App

A small web app for participants of the Breakthrough Intensive:

1. **Find a buddy**: mark the hours you're free. When someone else is free at the same time, you both get an update with the shared slot, and either of you can book it.
2. **Inspiration**: a shared board of books, films, podcasts, talks and practices. Anyone can browse. Members can add entries and remove their own.
3. **Account**: needed to find a buddy or post to the board. Without one, the app is view-only. Holds name, question, time zone and the "show me for matching" switch.
4. **Timer**: the dyad timer with the singing bowl and the recorded instructions.

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

**Matching:** whenever someone saves their hours, the database finds other people free at the same time and notifies both people once per shared hour. Booking an hour removes it from both people's availability and notifies the other person. Cancelling notifies them too.

## Run it locally

Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000      # then open http://localhost:8000
```

Local runs use the shared Supabase database too.

## Still to do

- **Email.** Supabase's built-in email only reaches your own team, so "Confirm email" is switched off. Before a wider launch, connect an email service such as Resend under Authentication → SMTP. That also enables password resets and match emails.
- **Vercel.** Connect the GitHub repo. It's a static site: Framework "Other", no build command.
