# Sprint 4 — Pitch logging and the rules engine (Jan 11–24, 2027)

Pitch counts and the rulebook engine behind them, built on the rosters and league
ages from Sprint 1. Coaches log their pitchers; the app works out rest and
eligibility from the Cal Ripken limits. Plain-language summary and the
definition-of-done status.

## What changed

- **Pitch logging.** Each head coach logs their own pitchers for a game — player
  and pitches, plus innings (stored as **outs**) when the pitcher is 12 by league
  age. A division director or admin can log for a coach who can't. League games
  only. The app **warns but never blocks** saving a count.
- **A pure rules engine** (`lib/pitching.js`) answers, for any player and date:
  are they **available**, **resting until** when, and how many **pitches left
  today**. It is pure — outings in, answer out — so every edge can be pinned.
- **The rulebook, from Settings (never hard-coded):**
  - Rest by the day's pitch total: 1–20 → 0 days, 21–35 → 1, 36–50 → 2, 51–65 →
    3, 66+ → 4.
  - Daily max by league age: 9–10 → 75, 11–12 → 85.
- **Finish the batter.** Reaching the max and finishing the current batter is
  allowed, so a small overage reads "check: finished the batter?" rather than a
  violation; a larger overage is a violation.
- **Two games in a day combine** for rest (40 + 40 for an 11-year-old is allowed,
  and the 80 total sets four days of rest), and **suspended-game pitches count**.
- **More pitches never means fewer rest days**, and a pitcher is never eligible
  before the day they pitched.

## Open question (left unlocked)

The exact day a pitcher with "4 days rest" is next eligible is the Cal Ripken
Director's call. The engine computes it from a Settings value
(`restEligibleOffset`, provisionally "rest days + 1"), and the one test that pins
the exact return day is marked **`todo`** — it does not gate the build until John
confirms the reading. The rest-days count itself (4 for a 66-pitch outing) is
locked.

## New endpoints

- `POST /api/coach/pitches` — a coach logs a pitcher (`{ gameId, playerId,
  pitches, outs? }`).
- `POST /api/admin/games/:id/pitches` — a director/admin logs for a coach
  (division-scoped); `GET /api/admin/games/:id/pitchlog` views a game's log.
- `GET /api/pitching/eligibility?playerId=&date=` — a player's status for a day.

## Definition of done — status

| Item | Status |
| --- | --- |
| The rulebook line by line (20/21, 35/36, 50/51, 65/66; 75/76, 85/86), each its own case | ✅ |
| A 66-pitch outing's rest days (4) pinned; the exact eligible day awaits the Director | ✅ rest days locked; exact day is a `todo` |
| Two games one day: 40 + 40 allowed; rest set by the 80 total | ✅ |
| Can't go backwards: more pitches never fewer rest days; never eligible before the day pitched | ✅ property + case |
| No hard-coded numbers: changing Settings changes the answers | ✅ |

## Tests

`npm test` → **202 passing**, 1 skipped (Firestore-emulator case), 1 todo (the
open eligible-day question). `npm run planted-bugs` → **23** caught, adding four
Sprint 4 rules (rest-bracket boundary, finish-the-batter tolerance, two-games
combining, resting ignored). Mutation config now covers `lib/pitching.js` (rules)
and `lib/pitchlog.js`.

## Not in this sprint (by design)

- Pre-game eligibility screens for both teams, violation emails to the Cal Ripken
  Director, the director dashboard and the 12-year-old weekly innings cap are
  Sprint 5. The engine and the logged outs are the foundation they build on.
