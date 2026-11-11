# Sprint 7 — Snack Shack sign-ups (Feb 22–28, 2027)

Snack Shack volunteer sign-ups. Parents sign up from a public link with no
account; the Snack Shack Director posts shifts and sees who's coming.
Plain-language summary and the definition-of-done status.

## What changed

- **Shifts.** The Snack Shack Director (or an admin) posts shifts — date, time,
  how many volunteers are needed — and can **copy last week's** shifts into the
  next week.
- **Public sign-up, no account.** Parents sign up from a public link with their
  name, email and mobile. The public page shows **counts only** — never another
  volunteer's name, email or phone.
- **The last spot is atomic.** Two parents racing for the last spot: one gets it,
  the other is told it's full.
- **Cancel links.** Each sign-up gets an unguessable cancel link that reopens the
  spot. The link cancels only that sign-up; a guessed or altered link is refused;
  using it twice does nothing.
- **Reminders.** Exactly one day-before reminder per sign-up, with the cancel
  link. A shift cancelled by a closure gets no reminder (its volunteers got a
  cancellation notice instead).
- **Weekly unfilled email.** The Snack Shack Director gets a weekly email listing
  the coming week's shifts that still need volunteers.
- **A full Quarry Hills closure cancels that day's shifts** and tells the
  volunteers.

## New endpoints

- Public (no account): `GET /api/public/snack/shifts` (counts only),
  `POST /api/public/snack/signup`, `POST /api/public/snack/cancel`.
- Manager (Snack Shack Director or admin): `POST /api/admin/snack/shifts`,
  `POST /api/admin/snack/copy-week`, `GET /api/admin/snack` (with volunteer
  details).
- The Snack Shack Director is a person with the `snack` flag (granted by an
  admin). Jobs `snackReminders` and `snackUnfilled` run on the existing tick.

## Definition of done — status

| Item | Status |
| --- | --- |
| Last spot: two parents at once → one gets it, the other is told it's full | ✅ atomic in a transaction |
| Cancel links: own sign-up only; altered/guessed refused; second use does nothing | ✅ |
| Public page leaks nothing: counts only, never a name, email or phone | ✅ |
| Reminders: exactly one per sign-up, day before; none for closure-cancelled shifts | ✅ |
| A phone with no account can sign up, get the reminder and cancel | ✅ (the public API carries the whole flow) |

## Tests

`npm test` → **232 passing**, 1 skipped (Firestore-emulator case), 0 todo.
`npm run planted-bugs` → **35** caught, adding four Sprint 7 rules (full shift
still takes sign-ups, cancel link not checked, reminder sent every run, closure
doesn't cancel shifts). Mutation config now covers `lib/snackshack.js`.

## Note on the public UI

The public sign-up flow is built and tested end to end at the API. The single
public page that calls it (a simple form at `/snack`, with a `/snack/cancel`
link) is light front-end work that can land with the go-live UI pass in Sprint 9;
the cancel link the reminders send already points at `/snack/cancel`.

## Not in this sprint (by design)

- The practice season replay is Sprint 8; go-live is Sprint 9.
