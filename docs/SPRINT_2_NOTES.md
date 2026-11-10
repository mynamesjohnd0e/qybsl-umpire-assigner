# Sprint 2 — Scores (Dec 7–20, 2026)

Scores enter the app. The home coach enters the final, the away coach confirms
or disputes, and after 24 hours with no answer it auto-confirms. Disputes and
out-of-town games go to the division director, who can also mark forfeits or
enter a score for a coach. Confirmed scores land on an "enter in SE" list that
directors copy into SportsEngine by hand. Plain-language summary and the
definition-of-done status.

## What changed

- **Home coach enters the final score** (plus an optional "home runs — who hit
  them" field). Only the home-side coach can enter; only after the game has
  started; never on a cancelled or rained-out game.
- **Away coach confirms or disputes.** The home coach can't confirm their own
  score — the away coach does. A dispute goes to the division director and stops
  the clock for good.
- **24-hour auto-confirm.** A score the away coach never answers becomes final 24
  hours after it was entered. Tested on both sides of the line: 23h59m does
  nothing, 24h01m confirms, and a dispute at 23h59m stops it for good.
- **The version the away coach saw wins.** If the home coach corrects the score
  at the same moment the away coach confirms what they were shown, the away-seen
  version is the one that becomes final.
- **Division director settles and decides.** A director (or admin) settles a
  dispute by setting the final score, approves out-of-town games, marks a forfeit
  (6–0 to the winner), and can enter a score for a coach who can't — all for
  their division only. **Only a director changes a score once it is final.**
- **Out-of-town games** (one team not on our coach list, e.g. Babe Ruth vs South
  Boston) never auto-confirm; our coach enters, and the score is final only once
  the division director approves it. The other town never uses the app.
- **"Enter in SE" list.** Final scores that haven't been copied into SportsEngine
  yet, scoped to a director's divisions. A one-tap "mark entered in SE" removes a
  game from the list.
- **Nightly nudges.** Home coaches with a finished game and no score are nudged
  each night until they enter it, then never again. Nudges go to coaches only —
  no family address is ever messaged.

## New endpoints

- Coach: `POST /api/coach/score`, `/confirm`, `/dispute`; `GET /api/coach/scores`.
- Director/admin (scoped to their division): `POST /api/admin/games/:id/score/`
  `settle` · `approve` · `forfeit` · `enter` · `entered-se`, and
  `GET /api/admin/enter-se`.
- Jobs: `scoreAutoConfirm` and `scoreNudges` run on the existing 15-minute tick.

## Definition of done — status

| Item | Status |
| --- | --- |
| Every move allowed and refused (away can't enter, home can't confirm own, no score on cancelled/not-started, only a director changes a final) | ✅ |
| 24-hour line on both sides; a dispute at 23h59m stops it | ✅ |
| Simultaneous away-confirm vs home-correction → away-seen version is final | ✅ |
| Out-of-town never auto-confirms; only that division's director approves | ✅ |
| Messages: home nudged until entered then never; disputes reach only that division's director; no family address | ✅ |
| A full slate ends with every score final and on the enter-in-SE list | ✅ |

## Tests

`npm test` → **156 passing**, 1 skipped (the Firestore-emulator case).
`npm run planted-bugs` → **13** caught, adding four Sprint 2 rules (away entering,
home confirming own, forfeit ≠ 6–0, out-of-town auto-confirming). Mutation config
now covers `lib/scores.js` as rules code.

## Not in this sprint (by design)

- Standings, tiebreakers, seeding and brackets are Sprint 3 — they consume the
  confirmed scores this sprint produces.
- "Home runs — who hit them" is stored as entered; it feeds nothing yet.
