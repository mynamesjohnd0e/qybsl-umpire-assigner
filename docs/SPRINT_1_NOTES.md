# Sprint 1 — Foundation (Nov 23–Dec 6, 2026)

The first feature sprint. It turns the umpire app into the start of the League
Operations app: a new name, teams and divisions as real records, a division
director role, and player rosters that become league ages. Plain-language
summary and the definition-of-done status.

## What changed

- **Renamed to "Quincy Youth Baseball - League Operations".** The page title and
  header, the email sender name, and the project description all use the new
  name. (The umpire features are unchanged underneath.)
- **Teams and divisions as records.** Uploading the head-coach list now also
  builds a team record for each team — name (spelled exactly as SportsEngine
  spells it), division, and head coach. The five divisions in scope are known to
  the app: Farm 8, Farm 9, Minors, Majors, Babe Ruth. The coach list can cover
  all five.
- **The schedule is matched to those teams.** When a schedule is uploaded, every
  game's team names are checked against the team records. A name that matches
  none is **reported** (in the sync result and the warnings), so a misspelled or
  brand-new team gets noticed instead of quietly going unsorted. The real 2026
  Farm schedule's 14 teams all match.
- **Player rosters → league ages, birthdates discarded.** A new roster upload
  takes name, jersey number and birthdate, works out each player's **league age**
  (their age on April 30 of the season year), stores that, and throws the
  birthdate away. Players are minors, so nothing else about them is kept. A
  re-upload is safe: the same roster twice changes nothing, a traded player keeps
  their record (and anything attached to it), and a player dropped from a later
  upload is flagged, not deleted.
- **Division director role, scoped to one division.** An admin can make someone a
  director of one or more divisions. A director can staff umpires (assign, remove,
  post urgent openings) on games **in their division only**, and sees an overview
  scoped to those divisions. They cannot reach any board-admin tool (settings,
  rosters, payouts, ratings, people, sync). A Farm Director is refused on a Farm 9
  or Majors game, for every action.

## New endpoints

- `POST /api/admin/roster/players` — upload a player roster (CSV: name, number,
  birthdate, team, division).
- `GET /api/admin/players` — the stored players (league age, never birthdate).
- `GET /api/admin/teams` — team records and the list of divisions.
- Division directors are granted via `POST /api/admin/people` (`role: director`)
  or `PUT /api/admin/people/:email` (`director: { divisions: [...] }`), and sign
  in with email + PIN like everyone else.

## Definition of done — status

| Item | Status |
| --- | --- |
| League age at the cutoff (Apr 30 → older, May 1 → younger; Feb 29 works) | ✅ unit boundaries + property |
| Birthdates are gone after an upload | ✅ a scan of every stored player finds none |
| Every team matches; a misspelled team is reported, not dropped | ✅ real 2026 fixture: all 14 map |
| Director limited to their division, every action | ✅ `test/api/director.test.js` |
| Re-upload is safe (idempotent; trade keeps history; missing flagged) | ✅ |
| Permission tests cover every new endpoint for the new role | ✅ |
| Last spring's rosters and schedule load cleanly on the test copy | ✅ the fixture loads with 0 unmatched teams |

## Tests

`npm test` → **135 passing**, 1 skipped (the Firestore-emulator case).
`npm run planted-bugs` → **9** planted bugs caught, now including the four Sprint 1
rules (league-age cutoff, missing-player handling, director scope, team-match
reporting). Mutation testing (`npm run mutate`) now also covers `lib/roster.js`
and `lib/teams.js` as rules code.

## Not in this sprint (by design)

- Real Minors/Majors rosters still wait on John's SportsEngine export; the tests
  use made-up names, and the fixture covers the schedule side.
- Score entry, confirmations and disputes are Sprint 2 — they build directly on
  the teams, divisions and director role added here.
