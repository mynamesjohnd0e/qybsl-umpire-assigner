# Sprints and testing

Source: "Sprints and testing" tab of the plan Claude Doc, Nov 9, 2026.
Living copy: https://claude.ai/artifact/PXviRPquoZzbV8hhHMjSEb#df983b78-840e

Ten sprints take League Operations from the umpire app to Opening Day 2027. Each sprint ships a working slice to the **test copy**, proven by tests that exercise real behavior, with a mutation-testing gate so a test that can't catch a broken rule doesn't count.

## How we test

A test counts only if it would fail when the rule it covers is broken.

**Where the existing tests stand:** `test/flow.test.js` and `test/csv.test.js` drive the app through its HTTP API as real roles and assert outcomes (they caught the reconfirm-on-a-past-game bug). Weaknesses: each is one long script (first failure hides the rest), they read the real clock, and they run only against the local JSON store, so Firestore transaction behavior is never tested. Sprint 0 fixes all three.

| Layer | Proves | Example |
| --- | --- | --- |
| Rule tables | Each rule is right at every boundary | 20 pitches = no rest, 21 = 1 day; 35/36; 65/66. Born Apr 30 vs May 1 land in different league ages |
| Invariants (property-based, `fast-check`) | Rules hold for thousands of generated cases | Total wins = total losses; more pitches never means fewer rest days; a double-elim bracket never eliminates a team with one loss |
| Real-data oracle | The app agrees with what happened | `test/fixtures/2026-farm-schedule-export.csv` real scores → standings must match a separate test-only calculation |
| Role scenarios | Features work end to end for real users | Home coach enters 7–4; away disputes; Farm Director sets 6–4; standings and the "enter in SE" list both change |
| Time travel | Deadlines and reminders fire exactly once at the right time | 23h59m: no auto-confirm; 24h01m: confirmed; job run twice = one message |
| Permissions | Nobody can do what their role shouldn't | Every endpoint × every role (umpire, coach, other team's coach, division director, other division's director, admin, signed out) |
| Messages | The right people hear, nobody else | Rainout reaches both coaches, assigned umpires and their parents; no other parent address appears; test copy only sends to John |

- **Quality gate:** Stryker mutation testing. Rules code (sign-up rules, pitch eligibility, standings, brackets) ≥ 85% mutation score; everything else ≥ 70%.
- **Concurrency against Firestore:** integration tests run against the Firestore emulator.
- **Every bug becomes a failing test first.**

## Calendar

| Sprint | Dates | Ships to the test copy | Demo |
| --- | --- | --- | --- |
| 0 | Nov 16–22 | Test foundation; no features | A deliberately broken rule fails the build and blocks the deploy |
| 1 | Nov 23–Dec 6 | Teams, divisions, division directors, roster upload, new name | Upload last spring's rosters; see league ages; sign in as a division director |
| 2 | Dec 7–20 | Score entry, confirmation, disputes, other-town approvals, forfeits, home runs | Enter as home, dispute as away, settle as director |
| 3 | Dec 21–Jan 10 | Standings, tiebreakers, "enter in SE" list, seeding, brackets | 2026's real scores produce 2026's standings and a bracket |
| 4 | Jan 11–24 | Pitch logging and the rules engine | Log a 66-pitch outing, see 4 days of rest |
| 5 | Jan 25–Feb 7 | Eligibility screens, warnings, director alerts, 12-year-old innings cap | Pre-game eligibility for both teams; a violation emails the Cal Ripken Director |
| 6 | Feb 8–21 | Field closures, rainouts, notices | Close Quarry Hills for a Saturday; everyone affected hears once |
| 7 | Feb 22–28 | Snack Shack shifts and public sign-up | Sign up from a phone with no account; get the reminder |
| 8 | Mar 1–21 | Practice season on the test copy | The board plays a full 2026 season through the app |
| 9 | Mar 22–Apr 9 | Go-live | 2027 schedule, rosters and people loaded; coaches shown the app |

## Sprint 0 · Nov 16–22 · Test foundation (CURRENT)

No new features. Make every later test trustworthy and stop a broken build reaching the live app (today a push to `main` deploys even if tests fail).

Tasks:
- [ ] `cloudbuild.yaml`: run `npm ci && npm test` (and the emulator suite) before `docker build`; a failing test stops both deploys.
- [ ] `lib/clock.js`: one `now()` used everywhere in `lib/` and `server.js` (games, jobs, sync, payouts, coach, people, auth session expiry). Tests set the time explicitly. No direct `new Date()`/`Date.now()` for "now" left in `lib/`.
- [ ] Test runner: `node --test` with `test/unit`, `test/api`, `test/integration`. Shared helpers in `test/helpers/` (start app on a random port, sign in as a role, build people/teams/games, upload a schedule, set the clock, read the outbox).
- [ ] Split `flow.test.js` and `csv.test.js` into focused tests per feature, keeping every assertion they make today.
- [ ] Firestore emulator: `npm run test:integration` runs `lib/store.js` against `FIRESTORE_EMULATOR_HOST`; same tests also run on the local store.
- [ ] Dev dependencies: `fast-check`, `@stryker-mutator/core`. `npm run mutate` with per-area thresholds (rules ≥ 85, rest ≥ 70); record the baseline for the existing umpire code.
- [ ] Fixtures: `test/fixtures/2026-farm-schedule-export.csv` (done: real scores, coach names replaced). Add Minors/Majors rosters with made-up names once John exports them.

Tests that prove it:
- **Planted bugs:** weekly limit off by one; plate-qualified rule removed; reconfirm expiry ignoring game start; payout including no-shows; parent copy dropped. Each must turn at least one test red (check by applying each break locally; Stryker covers the general case).
- **Race:** 20 umpires claim one slot at the same instant against the emulator. Exactly one succeeds, 19 get "That spot was just taken.", and the database holds one assignment.
- **Daylight saving:** DST starts Sunday Mar 14, 2027. A day-before reminder for Monday Mar 15, 5:30 PM goes out once, at the configured hour, on Sunday.
- **Mutation baseline:** surviving mutants in the umpire code get tests this sprint.

Done when: a pushed bug is blocked from deploying, and the umpire code meets the mutation thresholds.

## Sprint 1 · Nov 23–Dec 6 · Foundation

Build: rename to "Quincy Youth Baseball - League Operations"; teams and divisions as records matched to SportsEngine export team names; division director role scoped to one division; roster upload (name, number, birthdate → league age on Apr 30, birthdate discarded); coach list across all five divisions.

Tests:
- League age at the cutoff: for the 2027 season, born Apr 30, 2014 → 13; born May 1, 2014 → 12. Feb 29 birthdays work in non-leap years.
- Birthdates are gone: after an upload, a scan of every stored record finds no birthdate.
- Every team matches: all 14 teams in the 2026 fixture map to exactly one team; a misspelled team is reported, never silently dropped.
- Director limits: the Farm Director can manage umpires on a Farm 8 game and is refused on a Majors game, for every action.
- Re-upload is safe: same roster twice changes nothing; a traded player moves with pitch history; a missing player is flagged, not deleted.

Done when: last spring's rosters and schedule load cleanly on the test copy, and permission tests cover every endpoint for the new role.

## Sprint 2 · Dec 7–20 · Scores

Build: home coach enters final score + optional home runs; away confirms or disputes; 24h auto-confirm; director settles disputes, approves other-town games, marks forfeits (6–0), enters for a coach who can't; nightly nudges; "enter in SE" list.

Tests:
- Every move, allowed and refused: away can't enter; home can't confirm own; no score on cancelled/rained-out/not-yet-started games; only a director changes a final score.
- 24-hour line: 23h59m no auto-confirm; 24h01m confirmed; a dispute at 23h59m stops it for good.
- Simultaneous moves: away confirms while home corrects. The final is always the version the away coach saw.
- Other towns: a South Boston game never auto-confirms; only the Babe Ruth Director can approve it.
- Messages: home coach nudged nightly until entered, then never; disputes reach only that division's director; no family address ever appears.

Done when: a full week of 2026 Farm games entered through the app ends with every score final and on the "enter in SE" list.

## Sprint 3 · Dec 21–Jan 10 · Standings and brackets

Build: standings (win %, tie = half win); tiebreakers head-to-head → fewest runs allowed (full season) → coin toss recorded by the director; seeding; brackets (Majors 6-team double elim with "if needed" final, Minors 5-team single, Farm and Babe Ruth single; higher seed home); playoff games from the upload mapped to bracket slots.

Tests:
- Answer key: the 2026 fixture's real scores; a separate test-only calculation computes standings; the app matches team by team, including runs allowed.
- Generated seasons: total wins = total losses; entry order doesn't change standings; no two teams share a rank.
- Hard ties: a three-way circle (A>B, B>C, C>A) falls to runs allowed; a dead tie holds seeding until the coin toss is recorded.
- Brackets: every team appears once; higher seed home every game; Majors: no team out before its second loss; "if needed" final only when the winner's-bracket team loses the first.
- Forfeits: 6–0 changes runs allowed and can change a tiebreak.

Done when: 2026's real scores reproduce 2026's standings, and a full bracket plays out on the test copy.

## Sprint 4 · Jan 11–24 · Pitch logging and the rules engine

Build: pitch logging per game (player, pitches; innings when 12 by league age); a pure rules engine (available / resting until / pitches left today for any player and date); finish-the-batter tolerance; two games a day; suspended-game pitches; limits from Settings.

Tests:
- The rulebook line by line: 20/21, 35/36, 50/51, 65/66; 75/76 and 85/86 daily max, each its own case.
- "Days of rest": a 66-pitch Saturday outing pinned to its exact first eligible day, after the Cal Ripken Director confirms the reading.
- Two games one day: 40 + 40 for an 11-year-old allowed; rest set by the 80 total.
- Can't go backwards: more pitches never means fewer rest days; never eligible before the day pitched.
- No hard-coded numbers: changing Settings changes the answers.

Done when: the rules engine clears 85% mutation, and the Cal Ripken Director signs off the boundary table.

## Sprint 5 · Jan 25–Feb 7 · Eligibility and alerts

Build: pre-game eligibility for both teams; warnings while logging; violation email to the Cal Ripken Director; director dashboard; 12-year-old weekly innings cap (Mon–Sun) with near-limit warning; nudges for logs not in within 24h; pitch history into playoffs.

Tests:
- Weekly cap edges: 12-year-olds throw 3, 4, 4 innings then 2 more Saturday → warning; the same 2 innings the next Monday → none.
- Thirds add up exactly: 1⅓ + 1⅔ = 3; 36 outs = 12 innings; stored as outs.
- One alert per problem: editing an over-limit count twice sends one email; correcting below the limit clears the flag.
- Warn, never block: an over-limit count saves as entered and shows as a violation.
- Screens agree with the engine across a replayed season.
- Opposing coach can see but every attempt to change the other team's logs is refused.

Done when: a replayed Majors week produces the right eligibility screens and exactly the right director emails.

## Sprint 6 · Feb 8–21 · Rainouts and field closures

Build: close a field / several / all of Quarry Hills for a day or window (including planned closures); affected games rained out (no score, no pitch log, no pay, not in standings); notices to both coaches, assigned umpires and their parents; one Communications Director note; makeups from the next upload paired to originals.

Tests:
- Which games: closing Saturday 9 AM–3 PM takes out a game running 8:30–10:30 and leaves one ending exactly at 9:00.
- Exact recipients: both coaches, assigned umpires and their parents, one note listing each game once; no other address; re-closing sends nothing new.
- Gone everywhere: no score/pitch prompt, not in payouts, not in standings.
- Makeups pair, not duplicate: using the fixture's three real cancellations, rescheduled games attach to originals and umpires get a reconfirm.
- Reopening restores games and tells the same people.

Done when: a Saturday rainout on the test copy reaches every right inbox and no wrong one.

## Sprint 7 · Feb 22–28 · Snack Shack sign-ups

Build: shifts (date, time, people needed; copy last week); public sign-up with name/email/mobile; day-before reminder with cancel link; weekly unfilled email to the director; full closure cancels shifts.

Tests:
- Last spot: two parents take the last spot at once; one gets it, the other is told it's full.
- Cancel links: only cancel their own sign-up; altered/guessed links refused; second use does nothing.
- Public page leaks nothing: counts only, never another volunteer's name, email or phone.
- Reminders: exactly one per sign-up, day before; none for closure-cancelled shifts (cancellation notice instead).

Done when: a phone with no account can sign up, get the reminder and cancel on the test copy.

## Sprint 8 · Mar 1–21 · Practice season

Build: a season simulator replaying 2026 day by day on a moving clock with scripted coaches, umpires and directors (late, disputes, no-shows, rainouts); the board plays the same season live on the test copy.

Tests:
- End-of-season checks: every played game final; every working umpire paid exactly once; standings = answer key; no unflagged pitch violation; nobody outside coaches, umpires, umpires' parents and volunteers messaged.
- Saturday rush: 200 requests in a minute, no errors, pages under a second.
- Email budget: busiest simulated day under the sending limit of the account in use.
- Board findings: each bug gets a failing test first.

Done when: the simulated season passes every check and the board signs off.

## Sprint 9 · Mar 22–Apr 9 · Go-live

Build: upload preview (adds/changes/cancels shown before saving); daily Firestore backup; tested rollback to the previous Cloud Run revision; post-deploy check that the live app and jobs run; load 2027 data; show coaches the app at the preseason meeting.

Tests:
- Preview tells the truth: for the 2026 fixture, preview = actual upload result, game for game.
- Clean 2027 import: zero unmatched teams or players, or the upload stops and names them.
- Restore rehearsal: last night's backup restored into the test copy matches production record for record.

Done when: 2027 is loaded, every coach can sign in, and a rollback has been practiced.

## Sprint 10 · Apr 12–30 · Whole-app dress rehearsal

Why: every feature has its own deep tests, but nothing yet exercises the whole league — all five divisions at once — in one run, driving every feature in the order a real season uses them and checking the handoffs between them (import → rosters → staffing → scores → standings → brackets → pitching → rainouts → Snack Shack → payouts → backup). This is the synthetic-data dress rehearsal before go-live.

Build: one comprehensive synthetic dataset (`test/helpers/league2027.js`) covering all five divisions with made-up names only — teams and coaches, Minors/Majors player rosters with league ages (including 12-year-olds), umpires with parents, a Babe Ruth other-town opponent, and Snack Shack shifts — and one end-to-end walk (`test/api/e2e-season.test.js`) that drives every feature against it as the real roles.

Tests (the walk, each phase a test, asserting outcomes and the handoff to the next):
- Import a multi-division schedule (preview = actual; T-ball skipped; the other-town game flagged; zero unmatched teams).
- Rosters load with correct league ages and no birthdates kept.
- Umpires staff Farm games (claim, swap) and a director assigns a patched Majors game; the plate-qualified rule holds.
- Scores run the full path — coach enters, coach confirms, a dispute the director settles, a forfeit (6–0), an other-town approval, and one left for the 24-hour auto-confirm.
- Standings compute with a tiebreaker coin toss; a Majors double-elimination and a single-elimination bracket seed and play out.
- Pitch counts drive rest-day eligibility, the 12-year-old weekly innings cap, and a single violation alert, carried into a playoff eligibility check.
- A field closure rains games out and a re-upload pairs a makeup to its original.
- Snack Shack shifts fill (leak-proof, last-spot safe), a cancel link works, and a full-day closure cancels the shifts.
- Payouts pay each worked spot once and never a no-show.
- Backup → wipe → restore matches record for record, the self-check reads ok, and across the whole season nobody outside coaches, umpires, umpires' parents and league staff was ever messaged.

Done when: the end-to-end walk is green, the planted-bug gate still catches every rule, and John has watched the dress rehearsal run.

## Definition of done (every sprint)

- [ ] Every rule added has tests at its boundaries, not one typical case.
- [ ] Each feature has a scenario test run as the real roles who use it, checking data changes and who was messaged, not only the response.
- [ ] Permission tests cover every new endpoint for every role, including refusals.
- [ ] Deadlines and reminders tested on both sides of their time line with the test clock.
- [ ] Mutation score ≥ 85% for rules code, ≥ 70% elsewhere; new gaps get tests before the sprint closes.
- [ ] Integration tests pass against the Firestore emulator.
- [ ] Every bug found this sprint has a test that failed before the fix.
- [ ] The sprint demo works on the test copy, and John has tried it.
