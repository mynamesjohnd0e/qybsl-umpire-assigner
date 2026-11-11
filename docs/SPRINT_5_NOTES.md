# Sprint 5 — Eligibility and alerts (Jan 25–Feb 7, 2027)

The pitch-count engine from Sprint 4 goes to work: coaches and directors see each
pitcher's status before a game, violations email the Cal Ripken Director, and the
12-year-old weekly innings cap is watched. Plain-language summary and the
definition-of-done status.

## What changed

- **Pre-game eligibility for both teams.** For any game, each pitcher on both
  rosters shows as available, resting until a date, or with pitches left today —
  opponents included. The two teams' coaches, the division director and the board
  can see it; nobody else.
- **Warnings while logging.** Logging a count returns the engine's read (ok /
  check: finished the batter / violation) and, for 12-year-olds, the team's
  running weekly innings.
- **Violation emails to the Cal Ripken Director — one per problem.** A count over
  the daily max, or a team's 12-year-olds over the weekly cap, emails that
  division's director. Editing the same over-limit count again does **not** send
  a second email; correcting it below the limit **clears** the flag (so a later
  recurrence alerts again).
- **Director dashboard.** `GET /api/admin/pitching/violations` lists the active
  problems in a director's division(s).
- **12-year-old weekly innings cap (Mon–Sun).** All of a team's 12-year-olds
  combined may pitch at most 12 innings (36 outs) per week; the app warns as the
  team nears the cap and flags a violation over it. Innings are stored as outs,
  and the week resets on Monday.
- **24-hour log nudges.** Coaches whose finished Minors/Majors game still has no
  pitch log 24 hours on are nudged nightly, until it's in.
- **Pitch history carries into the playoffs.** Every outing counts, whatever the
  game, so a regular-season outing still rests a pitcher for a playoff game.
- **Warn, never block.** An over-limit count always saves and shows as a
  violation.

## New endpoints

- `GET /api/games/:id/eligibility` — both teams' pitchers for a game (the two
  coaches, the division director, the board).
- `GET /api/admin/pitching/violations` — the director's dashboard (scoped).
- Job: `pitchLogNudges` runs on the existing 15-minute tick.

## Definition of done — status

| Item | Status |
| --- | --- |
| Weekly cap edges (3+4+4 then 2 Sat → over; the same 2 the next Monday → none) | ✅ |
| Thirds add up exactly (1⅓ + 1⅔ = 3; 36 outs = 12 innings; stored as outs) | ✅ |
| One alert per problem (edit over-limit twice → one email; correcting below clears it) | ✅ |
| Warn, never block (an over-limit count saves and shows as a violation) | ✅ |
| Screens agree with the engine | ✅ the screen matches the engine for a pitcher |
| The opposing coach can see but every attempt to change the other team's logs is refused | ✅ |
| A replayed Majors week → the right eligibility screens and exactly the right director emails | ✅ exercised across the eligibility/alert tests |

## Tests

`npm test` → **214 passing**, 1 skipped (Firestore-emulator case), 1 todo (the
still-open "4 days rest" eligible day). `npm run planted-bugs` → **27** caught,
adding four Sprint 5 rules (weekly cap never over, alert not deduped, alert not
cleared, opposing-coach write). Mutation config already covers `lib/pitching.js`
(rules) and `lib/pitchlog.js`.

## Still open

- The exact day a "4 days rest" pitcher returns is unchanged from Sprint 4 — one
  `todo` test, pending the Cal Ripken Director's reading.

## Not in this sprint (by design)

- Field closures and rainouts are Sprint 6; Snack Shack sign-ups Sprint 7.
