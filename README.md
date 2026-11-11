# Quincy Youth Baseball - League Operations

(Started as the QYBSL Umpire Assigner.) Developers and Claude Code: start with `CLAUDE.md`, then `docs/PLAN.md` and `docs/SPRINTS.md`.

Sign-up, swaps, reminders, coach confirmations and payouts for Farm 8 / Farm 9 student umpires (and summer 8s/9s), plus a coverage view for patched-umpire games. Built from the requirements spec: Node + Express, Firestore, Cloud Run, vanilla HTML/JS. Same setup as the practice scheduler.

## What's in here

| File | What it does |
| --- | --- |
| `server.js` | Web server and all the URLs the pages call |
| `lib/sync.js`, `lib/ical.js` | Reads the SportsEngine calendar feed and handles new, moved and cancelled games |
| `lib/games.js` | Sign-up rules (plate-qualified, 2 per Mon–Sun week, no overlaps), swaps, urgent openings, admin overrides |
| `lib/teams.js` | Teams and divisions as records; matching schedule team names to them |
| `lib/roster.js` | Player roster upload: birthdate → league age (Apr 30 cutoff), birthdate discarded |
| `lib/scores.js` | Scores: home enters, away confirms/disputes, 24h auto-confirm, director settles/approves/forfeits, "enter in SE" list |
| `lib/standings.js` | Standings: win % (tie = half win), tiebreakers (head-to-head → runs allowed → coin toss) |
| `lib/brackets.js` | Seeding and playoff brackets (single elimination, plus Majors 6-team double elimination) |
| `lib/pitching.js` | Pitch-count rules engine: rest days, daily max, eligibility, finish-the-batter (all limits from Settings) |
| `lib/pitchlog.js` | Pitch logging per game, pre-game eligibility for both teams, violation alerts to the Cal Ripken Director, the weekly 12-year-old cap |
| `lib/coach.js` | Coach confirmations and ratings |
| `lib/payouts.js` | Biweekly payout report |
| `lib/jobs.js` | Sunday digest, day-before reminders, 72-hour gap alerts, reconfirm deadlines, coach nudges |
| `lib/notify.js` | Email (Gmail) and text (Twilio). Everything is logged on the Messages page |
| `lib/people.js`, `lib/auth.js` | Email + PIN sign-in, umpire and coach lists |
| `lib/clock.js` | The one clock. Every "now" in the code comes from here so tests can travel in time |
| `public/` | The web pages |
| `test/unit/`, `test/api/`, `test/integration/` | The test suite (`npm test`); helpers in `test/helpers/` |
| `scripts/planted-bugs.js` | Breaks each rule in turn and checks a test goes red (`npm run planted-bugs`) |
| `scripts/demo-seed.js` | Fills a local copy with fake umpires, coaches and games |

All Firestore collections start with `ump_`, so nothing collides with the other QYBSL apps.

## Try it on your computer

```bash
npm install
npm test                                   # unit + API + integration (local store)
npm run planted-bugs                       # proves the tests catch a broken rule
LOCAL_DB_FILE=./data/demo.json node scripts/demo-seed.js
LOCAL_DB_FILE=./data/demo.json ADMIN_EMAILS=john@demo.test NOTIFY_DRY=1 npm start
```

### Tests

The suite runs on Node's built-in test runner and is split by kind so one
failure never hides the next:

- `test/unit/` — pure rules at every boundary, with `fast-check` property tests
  (sign-up eligibility, payout periods, time/DST math, schedule parsing).
- `test/api/` — each feature driven through the HTTP API as the real roles
  (umpire, coach, admin, signed out), checking what changed in the data and
  exactly who was messaged.
- `test/integration/` — `lib/store.js` and the 20-umpires-one-slot race, run on
  the local store always and against the Firestore emulator when
  `FIRESTORE_EMULATOR_HOST` is set (`npm run test:integration`).

Time comes from `lib/clock.js`; tests freeze or travel it, never the wall clock.
`npm run mutate` runs Stryker mutation testing (rules ≥ 85%, the rest ≥ 70%).
Both the test suite and `npm run planted-bugs` run in Cloud Build before the
image is built, so a failing test blocks the deploy.

Open http://localhost:3000 and sign in as:
- `john@demo.test` / `1234` (admin)
- `alice@demo.test` / `1111` (plate-qualified umpire)
- `coach.red@demo.test` / `2222` (Quincy Police coach)

Without `FIRESTORE_PROJECT_ID` the app saves to a local file, so you can't hurt anything.

## Put it online (one time)

Run these in Cloud Shell in the same Google Cloud project as the practice scheduler.

**1. Make a Firestore database for it**
```bash
gcloud firestore databases create --database=umpires --location=nam5
```

**2. Push this folder to a new GitHub repo** (for example `qybsl-umpire-assigner`), then in Cloud Build → Triggers, connect it the same way as the practice scheduler: event "push to branch", branch `^main$`, config file `cloudbuild.yaml`. Push once and it deploys. Copy the service URL Cloud Run shows you.

If your admin email isn't `higgins.qyb@gmail.com`, change `_ADMIN_EMAILS` in `cloudbuild.yaml` first. You can add the other three admins later from the Settings page.

**3. Email, the scheduled jobs key, and the app link**

Email goes out from a Gmail account using an app password (Google Account → Security → 2-Step Verification → App passwords). When the Google for Nonprofits workspace is approved, swap in that address.

```bash
URL=https://YOUR-SERVICE-URL.run.app
printf 'YOUR-16-CHAR-APP-PASSWORD' | gcloud secrets create ump-gmail-app-password --data-file=-
openssl rand -hex 24 | tr -d '\n' | gcloud secrets create ump-cron-key --data-file=-

# Let Cloud Run read the secrets
SA=$(gcloud run services describe qybsl-umpire-assigner --region us-east1 --format='value(spec.template.spec.serviceAccountName)')
SA=${SA:-$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')-compute@developer.gserviceaccount.com}
for s in ump-gmail-app-password ump-cron-key; do
  gcloud secrets add-iam-policy-binding $s --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
done

gcloud run services update qybsl-umpire-assigner --region us-east1 \
  --update-secrets GMAIL_APP_PASSWORD=ump-gmail-app-password:latest,CRON_KEY=ump-cron-key:latest \
  --update-env-vars GMAIL_USER=higgins.qyb@gmail.com,APP_URL=$URL
```

**4. Scheduled jobs** (nightly sync at 2 AM, reminders checked every 15 minutes)
```bash
KEY=$(gcloud secrets versions access latest --secret=ump-cron-key)
gcloud scheduler jobs create http ump-nightly-sync --location us-east1 \
  --schedule "0 2 * * *" --time-zone "America/New_York" \
  --uri "$URL/api/cron/sync" --http-method POST --headers "X-Cron-Key=$KEY"
gcloud scheduler jobs create http ump-reminders --location us-east1 \
  --schedule "*/15 * * * *" --time-zone "America/New_York" \
  --uri "$URL/api/cron/tick" --http-method POST --headers "X-Cron-Key=$KEY"
```
Each job remembers what it already sent, so running every 15 minutes never double-sends.

**5. Texts (when Twilio's 10DLC registration is approved)**
```bash
printf 'YOUR-AUTH-TOKEN' | gcloud secrets create ump-twilio-token --data-file=-
gcloud secrets add-iam-policy-binding ump-twilio-token --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
gcloud run services update qybsl-umpire-assigner --region us-east1 \
  --update-secrets TWILIO_AUTH_TOKEN=ump-twilio-token:latest \
  --update-env-vars TWILIO_ACCOUNT_SID=ACxxxxxxxx,TWILIO_FROM=+16175550000
```
Then tick "Send texts" in Settings. Until then everything still goes by email, and the Messages page shows texts as "not sent".

## Before each season

1. Open the app, tap **First time? Sign up**, choose **Board admin**, and set your PIN.
2. **Settings**: season name, Director of Umpires email, other admins, pay rate, first payout Monday.
3. **Schedule sync**: upload the game schedule exported from SportsEngine HQ (CSV). Upload a fresh export whenever games change; moved and cancelled games are handled automatically. A calendar feed link works too if a team calendar offers one.
4. Check the sync result. If it says some events "didn't match a division", either add that team's coach on the People page or adjust the sorting rules (Settings → Advanced).
5. **People → Upload lists**: the umpire list and the head coach list.
6. Send umpires and coaches the link. Umpires on the list are approved as soon as they sign up; coaches on the list are linked to their team.
7. Mark returning umpires plate-qualified on the People page.

### List formats (CSV, first row is the column names)

Umpires: `name, email, mobile, parent_name, parent_email, parent_mobile, venmo, plate_qualified`
Only name and email are required. Umpires fill in the rest at sign-up.

Coaches: `name, email, mobile, team, division` — one row per team, team names spelled as in SportsEngine. Uploading the coach list also creates a team record (name, division, head coach) for each team, across all five divisions (Farm 8, Farm 9, Minors, Majors, Babe Ruth). When a schedule is uploaded, any team name that matches no record is reported, so misspellings get noticed.

Players (Minors/Majors): `name, number, birthdate, team, division`. The birthdate becomes a **league age** (age on April 30 of the season year) and is then discarded — players are minors, so only name, number and league age are kept. Re-uploads are safe: a trade moves the player's record, a dropped player is flagged (not deleted).

**Division directors**: a board admin can make someone a director of one or more divisions (People page, or `POST /api/admin/people` with `role: director`). A director can staff umpires on games in their division and see those games, but cannot reach board-admin tools. They sign in with email + PIN like everyone else.

## How games are sorted

The feed's game titles are matched against rules in Settings (first match wins):
- Fall Ball, T-Ball, Instructional → skipped (no umpires)
- Farm 8, Farm 9, summer 8A/8B/9A/9B/8U/9U → **student** (two student umpires, sign-up)
- Minors, Majors, Babe Ruth, summer 10 and up → **patched** (assignor, manual status)

If a title has no division in it, the app looks up the team name in the coach list.

## Test copy

Every deploy also updates a test copy (`qybsl-umpire-assigner-test`) with its own database (`umpires-test`). It shows a TEST COPY banner, only ever emails John's own addresses (`higgins.qyb+anything@gmail.com`), can move uploaded dates forward (Schedule sync → "Move dates forward"), and has a button to clear all practice data.

## Things to check against the real feed

The spec flagged this as a pre-build check, and it still applies: export the actual SportsEngine feed and run a sync before opening sign-ups. Confirm game titles include the division (or the coach list covers every team name) and that field names come through in the location.
