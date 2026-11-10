# Sprint 3 — Standings and brackets (Dec 21–Jan 10, 2027)

Standings and playoff brackets, built on the confirmed scores from Sprint 2.
The app now ranks every division, breaks ties the way the rulebook says, seeds
the playoffs and draws the bracket. Plain-language summary and the
definition-of-done status.

## What changed

- **Standings.** Winning percentage with a tie counting as half a win, plus runs
  scored and runs allowed over the full season. Coaches, directors and the board
  see them in the app (families still see them on SportsEngine).
- **Tiebreakers, in order:** head-to-head record among the tied teams, then fewest
  runs allowed over the season, then a coin toss the division director records. A
  tie none of these breaks is **held** — the teams share a rank and are flagged as
  needing a coin toss — until the director records one.
- **Forfeits count.** A forfeit's 6–0 feeds runs scored and allowed, so it can
  change a tiebreak.
- **Seeding and brackets.** Teams are seeded from the standings (a director can
  save a different seed order before publishing). Every team qualifies and the
  **higher seed is always home**. Minors is a 5-team single elimination; Farm 8,
  Farm 9 and Babe Ruth are single elimination; Majors is a **6-team double
  elimination** with an "if needed" second final — played only when the
  losers'-bracket team wins the first final. **No Majors team is out before its
  second loss.**
- **The bracket plays itself out.** Uploaded (or app-entered) playoff games are
  matched to bracket slots by their two teams; as each game goes final, the winner
  advances and the next matchup fills in.
- **Scores import from the export.** A completed game in the SportsEngine CSV
  carries its final score; the sync reads it (never overwriting a score a coach or
  director entered), so last season's real results feed the standings.

## New endpoints

- `GET /api/standings` — standings per division (any signed-in user).
- `POST /api/admin/standings/coin-toss` — the division director records a coin
  toss (`{ division, order: [team, …] }`).
- `GET /api/admin/bracket?division=…` — the bracket, seeded and advanced from
  final games.
- `POST /api/admin/bracket/seeds` — a director saves a seed order before
  publishing.

## Definition of done — status

| Item | Status |
| --- | --- |
| Answer key: 2026 real scores reproduce the standings, team by team incl. runs allowed | ✅ matches an independent calc, Farm 8 and Farm 9 |
| Generated seasons: total wins = total losses; entry order doesn't change standings; no two teams share a rank (unless a coin toss is owed) | ✅ property tests |
| A three-way circle falls to runs allowed; a dead tie holds until the coin toss | ✅ |
| Brackets: every team once; higher seed home; Majors no team out before 2nd loss; "if needed" final only when the winners-bracket team loses the first | ✅ |
| Forfeits (6–0) change runs allowed and can change a tiebreak | ✅ |

## Tests

`npm test` → **179 passing**, 1 skipped (the Firestore-emulator case).
`npm run planted-bugs` → **19** caught, adding six Sprint 3 rules (tie ≠ half win,
runs-allowed miscount, head-to-head skipped, higher-seed-home, if-needed final,
imported scores not final). Mutation config now covers `lib/standings.js` and
`lib/brackets.js` as rules code.

## Not in this sprint (by design)

- Pitch counts and eligibility are Sprint 4. "Home runs — who hit them" is still
  stored but unused.
- A director's seed override is stored and used; a richer publish/lock workflow
  can come when the playoff UI is built.
