# Sprint 8 — Practice season (Mar 1–21, 2027)

A full dress rehearsal. A season simulator replays the real 2026 schedule day by
day on the moving clock, driving the whole app the way a season of scripted
coaches, umpires and a director would — and the board's acceptance checks confirm
the season came out right. Plain-language summary and the definition-of-done
status.

## What changed

- **A season simulator** (`lib/simulator.js`). It sets up a coach per team, a pool
  of umpires (with parents), a Farm director and the league staff; imports the
  2026 schedule with the scores stripped out; then replays every game day in
  order on the clock:
  - umpires are assigned to each game;
  - the home coach enters the real final score; the away coach confirms, or
    (every 7th game) disputes and the director settles; every 11th score is left
    for the 24-hour auto-confirm;
  - coaches confirm the umpires worked, with a no-show every 9th game;
  - one Saturday is rained out;
  - at season end everyone who worked is paid, once.
  It runs the real `lib/` flows (scores, games, payouts, closures) on the clock,
  so a 28-day, 96-game season runs in a few seconds.
- **End-of-season acceptance checks** (`test/api/season.test.js`) — the board's
  sign-off, as tests.
- **The Saturday rush** (`test/api/load.test.js`) — a 200-request burst of public
  Snack Shack traffic, all succeeding quickly, with no overselling.

## Definition of done — status

| Item | Status |
| --- | --- |
| Every played game final | ✅ |
| Every working umpire paid exactly once (no-shows never paid) | ✅ |
| Standings agree with an independent calc of the season as played | ✅ |
| No unflagged pitch violation | ✅ (consistency invariant across the season) |
| Nobody outside coaches, umpires, umpires' parents and the league staff messaged | ✅ |
| Saturday rush: 200 requests, no errors, a page under a second | ✅ |
| Busiest simulated day under the email sending limit | ✅ |
| Board findings: each bug gets a failing test first | ✅ the acceptance suite is the gate; a planted regression turns it red |

## Tests

`npm test` → **242 passing**, 1 skipped (Firestore-emulator case), 0 todo. The
suite now includes the full season replay and the load burst. `npm run
planted-bugs` → **36** caught; the new one shows the season acceptance suite bites
(an auto-confirm regression leaves games un-final and the season test goes red).

## The board-plays-it-live half

The automated replay is the simulator above. "The board plays the same season
live on the test copy" is a manual activity on the deployed test copy (which only
ever messages John's addresses), not code — the simulator is the repeatable proof
that the flows hold together, and the test copy is where the board walks it by
hand.

## Not in this sprint (by design)

- Go-live (upload preview, backups, rollback rehearsal, loading 2027) is Sprint 9.
