# Quincy Youth Baseball - League Operations

League app for Quincy Youth Baseball & Softball (QYBSL). Today it schedules Farm student umpires; over the 2026–27 off-season it grows into the league's operations app: scores, standings, playoff brackets, pitch counts, rainouts and Snack Shack sign-ups. The product owner is John Higgins (Director of Baseball Operations). He is not a developer: explain choices in plain language and keep the code simple to read.

Read these before starting work:
- `docs/PLAN.md` – what we're building and every decision already made. Don't re-ask decided questions.
- `docs/SPRINTS.md` – the sprint plan, the testing approach and the definition of done. Work happens in sprint order.
- `docs/UMPIRE_SPEC.md` – the original umpire scheduling requirements (already built).
- The living versions of the plan are in a Claude Doc: https://claude.ai/artifact/PXviRPquoZzbV8hhHMjSEb. If the two disagree, ask John which wins.

**Current sprint: Sprint 0 (Nov 16–22, 2026) – test foundation, no new features.** See `docs/SPRINTS.md`.

## Stack and conventions

- Node.js + Express (`server.js`, `lib/`), vanilla HTML/CSS/JS front end (`public/`), no front-end framework, no build step.
- Firestore on Cloud Run. Every collection is prefixed `ump_` (see `lib/store.js`). Without `FIRESTORE_PROJECT_ID` the app uses a local JSON file, which is how tests and local runs work today.
- No key files in code or the repo. Google auth uses Application Default Credentials; secrets live in Secret Manager.
- Branding: navy `#1B3A6B`, red `#B22222`, white. Never gold.
- All league logic runs on Eastern time (`America/New_York`, see `lib/time.js`). Weeks run Monday–Sunday.
- Plain-language UI copy. Short sentences, no jargon, written for coaches, teenage umpires and parents on phones.
- Keep dependencies few. Prefer a small readable function over a library, except for test tooling.

## Repo map

| Path | What it is |
| --- | --- |
| `server.js` | All HTTP routes |
| `lib/games.js` | Umpire sign-up rules, swaps, urgent openings, admin assign |
| `lib/sync.js`, `lib/ical.js`, `lib/secsv.js` | Schedule import: iCal feed or SportsEngine HQ CSV export; moved/cancelled reconciliation |
| `lib/coach.js` | Coach confirmations and umpire ratings |
| `lib/payouts.js` | Biweekly umpire payouts |
| `lib/jobs.js` | Timed jobs (reminders, alerts, reconfirm expiry) run by Cloud Scheduler |
| `lib/notify.js` | Email (Gmail/SMTP) and text (Twilio); every message logged to the outbox |
| `lib/auth.js`, `lib/people.js` | Email + PIN sign-in, umpire/coach lists |
| `public/` | The single-page web app |
| `test/` | Tests (`npm test`) |
| `test/fixtures/2026-farm-schedule-export.csv` | Real 2026 Farm schedule with real scores, coach names replaced. The standings answer key for Sprint 3 |
| `scripts/demo-seed.js` | Fills a local copy with fake data |

## Commands

```bash
npm install
npm test                                   # must pass before any push
LOCAL_DB_FILE=./data/demo.json node scripts/demo-seed.js
LOCAL_DB_FILE=./data/demo.json ADMIN_EMAILS=john@demo.test NOTIFY_DRY=1 npm start   # http://localhost:3000
```

## Deploying (read before touching cloudbuild.yaml)

- GCP project `qybsl-scheduler`, region `us-east1`. Cloud Build trigger `umpire-deploy-on-push` deploys on every push to `main`.
- One push deploys two services from the same image:
  - `qybsl-umpire-assigner` – the real app, Firestore database `umpires`.
  - `qybsl-umpire-assigner-test` – the test copy, database `umpires-test`, `TEST_MODE=1`, only messages addresses matching `^higgins\.qyb`.
- **Pushing to `main` changes the live app.** Work on a branch and open a pull request; John merges.
- Scheduled jobs (Cloud Scheduler) call `/api/cron/sync` nightly and `/api/cron/tick` every 15 minutes with the `X-Cron-Key` header (secret `ump-cron-key`).
- Cloud Run reserves URL paths ending in `z` (e.g. `/healthz`); use `/health`.

## Testing standard (non-negotiable)

John's instruction: tests must functionally test the code, not be green checkboxes. Concretely:

1. **A test must fail when the rule it covers is broken.** If you can't name the bug a test would catch, don't write it.
2. **Boundaries, not one happy case.** Every numeric or date rule is tested on both sides of each edge (20/21 pitches, 23h59m/24h01m, Apr 30/May 1 birthdays, Sunday/Monday week line).
3. **Assert outcomes, not status codes.** Check what changed in the stored data and exactly who was messaged (and who was not), the way a real user would notice.
4. **Drive the app as real roles** through the HTTP API for scenario tests (umpire, home coach, away coach, other team's coach, division director, other division's director, admin, signed out).
5. **Pure rules get table tests and property-based tests** (`fast-check`): invariants such as total wins = total losses, more pitches never means fewer rest days.
6. **Real data as an oracle:** the 2026 fixture's real scores must produce the standings computed by a separate, simpler test-only calculation.
7. **Time comes from one injectable clock** (Sprint 0 adds `lib/clock.js`). Never call `new Date()`/`Date.now()` directly in `lib/` once that exists.
8. **Concurrency is tested against the Firestore emulator**, not only the local JSON store.
9. **Mutation testing (Stryker) is the gate:** ≥ 85% mutation score for rules code (sign-up rules, pitch eligibility, standings, brackets), ≥ 70% elsewhere. Surviving mutants get tests, not exclusions, unless John agrees.
10. **Every bug gets a failing test before the fix.**

The full definition of done is at the end of `docs/SPRINTS.md`. A sprint is not done until every item holds.

## League rules quick reference (details in docs/PLAN.md)

- Pitch limits (Cal Ripken Minors and Majors 2026 rulebooks): league age 9–10 max 75/day, 11–12 max 85/day. Rest: 1–20 pitches 0 days, 21–35 one, 36–50 two, 51–65 three, 66+ four. A pitcher at the max may finish the current batter. Pitches in suspended games count. Limits live in Settings, not code.
- 12-year-olds: all 12-year-olds on a team combined may pitch at most 12 innings per Mon–Sun week. Store innings as outs.
- League age = age on April 30 of the season year, from the roster birthdate. Keep the league age, discard the birthdate.
- Open question for the Cal Ripken Director: exactly which day a pitcher with "4 days rest" is next eligible. Don't lock that test until John confirms.
- Standings: winning percentage, tie = half a win. Tiebreakers: head-to-head, fewest runs allowed (full season), coin toss recorded by the division director. Forfeit = 6–0.
- Playoffs: Majors 6-team double elimination; Minors 5-team single; Farm 8, Farm 9, Babe Ruth single. All teams qualify; higher seed is home.
- Messaging: coaches, umpires and Snack Shack volunteers get email/text. Umpires' parents are copied on umpire messages (the one family exception). No other parent or family address is ever messaged; families hear through SportsEngine.
- Pitch violations warn and report; the app never blocks saving a count.

## Data and privacy

- Players are minors. Store name, jersey number and league age only. No birthdates after upload, no player contact details.
- Never commit real SportsEngine exports or rosters with real names. Fixtures use made-up names.
- Umpire ratings are admin-only and never shown to umpires or coaches.
