# Sprint 0 — Test foundation (Nov 16–22, 2026)

No new features. The goal was to make every later sprint's tests trustworthy and
to stop a broken build from ever reaching the live app. Plain-language summary of
what changed and where Sprint 0 stands against its definition of done.

## What changed

- **One clock (`lib/clock.js`).** Every "right now" in the code now comes from a
  single place. In production it is the real clock; in tests we can freeze it or
  jump to any moment, so a deadline or a reminder can be checked on both sides of
  its line without waiting. No `new Date()`/`Date.now()` for "now" is left in
  `lib/` or `server.js`.
- **A real test suite, split by feature.** The two old end-to-end scripts
  (`flow.test.js`, `csv.test.js`) became focused files under `test/unit/`,
  `test/api/` and `test/integration/`, on Node's built-in test runner. One
  failure no longer hides the rest. Every assertion the old scripts made is kept.
  Shared setup lives in `test/helpers/`.
- **Tests that bite.** Boundaries are tested on both sides (the weekly cap at
  2 vs 3 games, the game-start line to the millisecond, the overlap window,
  payout period edges, the Sunday/Monday week line, April 30 vs May 1).
  `fast-check` property tests cover thousands of generated cases. API tests drive
  the app as each real role and check what changed in the data **and exactly who
  was messaged**. Every endpoint is checked for every role, refusals included.
- **The deploy is now gated.** `cloudbuild.yaml` runs `npm ci && npm test` and
  the planted-bug check **before** the image is built. A failing test stops both
  the live and the test-copy deploys. (Before Sprint 0, a push to `main` deployed
  even if tests failed.)
- **Planted-bug proof (`npm run planted-bugs`).** Breaks each rule in turn —
  weekly limit off by one, plate rule removed, reconfirm expiry ignoring game
  start, payout including no-shows, parent copy dropped — and confirms a test
  goes red for each, then restores the code. All five are caught.
- **Firestore emulator + race.** `test/integration/` runs the store contract and
  the 20-umpires-one-slot race on the local store always, and against the
  Firestore emulator when `FIRESTORE_EMULATOR_HOST` is set. Exactly one claim
  wins; the database holds one assignment.
- **Daylight saving.** A day-before reminder for Monday Mar 15 2027 goes out once,
  on Sunday Mar 14 (the day DST starts), at the configured hour — proven with the
  frozen clock.
- **Mutation testing wired (`npm run mutate`).** Stryker with per-area
  thresholds: rules code ≥ 85%, the rest ≥ 70%.

## Definition of done — status

| Item | Status |
| --- | --- |
| Rules tested at boundaries, not one typical case | Done |
| Each feature tested as the real roles, checking data + who was messaged | Done |
| Permission tests for every endpoint and role, refusals included | Done |
| Deadlines/reminders tested on both sides of the line with the test clock | Done |
| Integration tests against the Firestore emulator | Code + race done; runs against the emulator in CI (local store always) |
| A pushed bug is blocked from deploying | Done (tests + planted-bugs gate the build) |
| Mutation score ≥ 85% rules / ≥ 70% elsewhere | Wired; baselines captured, see below |

## Mutation baseline

Run with `npm run mutate`. Stryker re-runs the suite once per planted change, so
a full pass over the large files is a CI-length job. Captured this sprint:

- `lib/clock.js`: **100%** (the surviving `setNow(null/undefined)` mutants were
  closed with tests — the exact "surviving mutants get tests" step).
- `lib/payouts.js`: **100%**, `lib/time.js`: **100%** (0 mutants survived the
  full `npm test` suite). Both are well above the 85% rules threshold.
- `lib/games.js` (the main rules file, ~800 mutants): mutation run is wired
  (`npm run mutate:rules`) and belongs in CI given its size; closing any
  survivors to ≥ 85% is the remaining mutation work.

## Not done this sprint (by design)

- Minors/Majors roster fixtures: waiting on John's SportsEngine export (noted in
  the sprint plan). The 2026 Farm schedule fixture is already in `test/fixtures/`.
- The exact "4 days rest" eligibility day stays unlocked until the Cal Ripken
  Director confirms it (Sprint 4).
