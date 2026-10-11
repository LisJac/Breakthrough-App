# Breakthrough App

A small web app for participants of the Breakthrough Intensive:

1. **Find a buddy**: mark the hours you're free. When someone else is free at the same time, you both get an update with the shared slot, and either of you can book it.
2. **Inspiration**: a shared board of books, films, podcasts, talks and practices. Anyone can browse. Members can add entries and remove their own.
3. **Account**: needed to find a buddy or post to the board. Without one, the app is view-only. Holds name, question, time zone and the "show me for matching" switch.
4. **Timer**: the dyad timer with the singing bowl and the recorded instructions.

## Run it locally

Open `index.html` in a browser. There's no build step and no server needed.

Or serve the folder, which is closer to how it will run after launch:

```
cd dyad-app
python3 -m http.server 8000      # then open http://localhost:8000
```

## Testing matching on one computer

- **Account → Local testing → Add sample participants** adds three sample people with evening availability this week and three board entries.
- Or open a second tab and create a second account. Each tab keeps its own sign-in, and changes show up live in the other tab.
- **Reset all local data** wipes everything in this browser.

## How it works

| File | What it does |
|---|---|
| `index.html` | Shell, navigation and the timer markup |
| `styles.css` | All styling, light and dark mode |
| `js/app.js` | Routing and the Find a buddy, Inspiration and Account views |
| `js/store.js` | **The only file that touches data.** Today it uses localStorage. |
| `js/matching.js` | Pure slot and matching logic, with no storage |
| `js/timer.js` | The dyad timer, ported from the earlier version |
| `js/clips.js` | The three recorded instructions as embedded audio |
| `js/devseed.js` | Sample data for local testing only. Remove it before launch. |

**Slots** are stored as the UTC start of a one-hour block, so participants in London, Berlin and elsewhere match on the same real moment. Each person sees the grid in their own time zone, and matches show the other person's local time too.

**Matching:** whenever availability or bookings change, every pair of participants is checked for shared future hours that neither has booked. Each new shared slot is announced once to both people. Booking a slot removes it from both people's matches and tells the other person. Cancelling tells them too.

## Before deploying

Local mode is for building and testing only. All data lives in one browser, and sign-in has no password. To go live:

1. Replace `js/store.js` with a version backed by a real database and email sign-in, such as Supabase. Keep the same method names, and the rest of the app won't need changes.
2. Send match, booking and cancellation updates by email as well as showing them in the app.
3. Remove `js/devseed.js` and the "Local testing" block in the Account view.
4. Deploy the folder as a static site on Vercel.
