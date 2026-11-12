# How to test the League Operations app

Written for John. Plain language. Two parts matter most:

1. **How to open the app and sign in.**
2. **What you can click and test today** — and what is built and tested behind
   the scenes but doesn't have a screen yet.

---

## A quick, honest map of where things stand

The app has two layers:

- **The web app** (what you see in a browser). Today it covers the original job:
  **umpire scheduling** — the schedule, sign-ups, swaps, coverage, coach
  confirmations, ratings and payouts. This is fully clickable.
- **The engine behind it** (the server). It also does **scores, standings,
  playoff brackets, pitch counts, rainouts, Snack Shack sign-ups, and
  backup/self-check.** These are built and covered by automated tests, but they
  **don't have buttons in the web app yet** — the screens are the next piece of
  work.

So this guide has two sections: **what you can click now**, and **what's built
but still needs a screen** (and how we know it works).

---

## How to open the app

### Option A — The test copy (recommended, nothing to install)

Every time we deploy, a **test copy** of the app updates automatically. It has its
own separate database, shows a red **TEST COPY** banner, and only ever emails your
own addresses — so you can't break anything real or message a real family.

1. Open the **test-copy web address** in your browser. (It's the
   `qybsl-umpire-assigner-test` service in Google Cloud Run — I can send you the
   exact link, or your developer can grab it from the Cloud Run console.)
2. You'll see the **TEST COPY** banner at the top. If you don't see it, stop —
   you may be on the real app.
3. Tap **First time? Sign up**, choose **Board admin**, and set a PIN. You're in
   as the admin.
4. When you want a clean slate, go to **Settings → Clear test data** (or the
   "Clear test data" button) and start over.

Tips for the test copy:
- Messages don't really send; open the **Messages** tab (admin) to see every email
  or text the app *would* have sent, and who it went to.
- To get test messages to your inbox, use an address like
  `higgins.qyb+test@gmail.com` — only addresses starting with `higgins.qyb` are
  allowed to receive on the test copy.

### Option B — Run it on a computer with sample data (for your developer)

This fills a local copy with fake umpires, coaches and games so you can click
around immediately. Three commands in the project folder:

```bash
npm install
```

```bash
LOCAL_DB_FILE=./data/demo.json node scripts/demo-seed.js
```

```bash
LOCAL_DB_FILE=./data/demo.json ADMIN_EMAILS=john@demo.test NOTIFY_DRY=1 npm start
```

Then open **http://localhost:3000**. `NOTIFY_DRY=1` means no real emails or texts
go out — they're logged on the Messages page instead.

**Sample logins (Option B):**

| Who | Email | PIN | What they are |
| --- | --- | --- | --- |
| Admin | `john@demo.test` | `1234` | You — full access |
| Umpire (plate-qualified) | `alice@demo.test` | `1111` | Can take plate or field |
| Umpire (not plate-qualified) | `ben@demo.test` | `1111` | Field only |
| More umpires | `chloe` / `danny` / `ella` / `finn@demo.test` | `1111` | Mixed |
| Walk-in umpire | `newkid@demo.test` | `1111` | Signed up, **awaiting your approval** |
| Coach | `coach.red@demo.test` | `2222` | Coaches Quincy Police (Farm 8) |

To test "who sees what," open two browsers (or a normal and a private window) and
sign in as two different people at once.

---

## Part 1 — Features you can click and test now

For each: who to sign in as, what to do, and what you should see. Work top to
bottom; later tests use games set up by earlier ones.

### 1. Sign-in and roles
- **Do:** Sign in as the admin. Sign out. Sign in as an umpire. Sign in as the
  coach.
- **Expect:** Each role sees different tabs. Admin sees **Coverage, People,
  Ratings, Payouts, Schedule sync, Messages, Settings**. An umpire sees **Open
  games, My games, My pay**. A coach sees **My team's games**. A wrong PIN is
  refused; too many wrong tries locks the account for a bit.

### 2. Load a schedule (admin → Schedule sync)
- **Do:** Go to **Schedule sync** and **upload** a schedule exported from
  SportsEngine HQ (a CSV file). (On the demo, games are already loaded.)
- **Expect:** It tells you how many games were added, moved, cancelled or
  skipped, and **names any team it couldn't match** to your coach list. Upload a
  fresh export anytime; moved and cancelled games are handled automatically.
- **Edge to try:** Upload the same file twice — the second time should show no
  changes. Upload a file with a misspelled team — it should **name that team**,
  not silently drop the game.

### 3. People and lists (admin → People)
- **Do:** Upload the **umpire list** and the **coach list** (CSV). Mark a
  returning umpire **plate-qualified**. Approve the **walk-in** umpire
  (`newkid`). Reset someone's PIN. Make someone a **division director**.
- **Expect:** Umpires on the list are approved as soon as they sign up; the
  walk-in waits for your approval. A coach is linked to their team. A director can
  staff only their own division (see test #8).

### 4. Umpire sign-up and the plate rule (sign in as an umpire)
- **Do:** As `alice` (plate-qualified), open **Open games** and **take** a plate
  spot. As `ben` (not plate-qualified), try to take a **plate** spot, then take a
  **field** spot instead.
- **Expect:** Alice gets the plate spot. **Ben is refused the plate spot** (not
  plate-qualified) but can take field. Nobody can be in two places at once, and an
  umpire can't take more than **2 games in a Monday–Sunday week**.

### 5. Swaps (two umpires)
- **Do:** As the umpire holding a spot, **Post swap** on it. As a *different*
  qualified umpire, **Take it**.
- **Expect:** The spot moves to the second umpire. Someone not qualified for a
  plate spot can't accept it. Once taken, it can't be taken again; the person who
  posted it can withdraw it.

### 6. Moved game → reconfirm
- **Do:** (Demo already moves one game.) Re-upload a schedule with a game at a new
  time, or watch the game that was moved.
- **Expect:** The assigned umpire is asked to **reconfirm**. If they don't within
  the time limit (Settings), the spot **reopens** to others.

### 7. Coverage and admin overrides (admin → Coverage)
- **Do:** See every game and who's on it. **Assign** an umpire to an open spot
  (you can override with "Assign anyway"). Post an **Urgent opening**. **Add a
  game by hand**. **Cancel** a game. Mark a patched (Majors/Minors/Babe Ruth) game
  **Confirmed**.
- **Expect:** Open spots and gaps are easy to see. Urgent openings message the
  umpire pool (check the **Messages** tab). Cancelling a game takes its umpires
  off it.

### 8. Division director scope (sign in as a director)
- **Do:** Make someone a Farm 8 director (People). Sign in as them.
- **Expect:** They can staff **their** division's games but can't reach
  board-admin tools or another division.

### 9. Coach confirms the umpire + ratings (sign in as the coach)
- **Do:** As `coach.red`, open **My team's games** for a game that has finished,
  mark the umpire **worked** (or **no-show**), and give a 1–5 **rating**.
- **Expect:** Your confirmation is recorded. Ratings are **admin-only** — umpires
  and other coaches never see them (check the admin **Ratings** tab).

### 10. Payouts (admin → Payouts)
- **Do:** **Preview** the biweekly payout, then **Mark paid**. Download the
  **CSV**.
- **Expect:** Only **coach-confirmed "worked"** spots are paid, at the rate in
  Settings. **No-shows are not paid.** Once paid, a game drops off the next
  preview (never paid twice).

### 11. Messages, Settings, jobs
- **Do:** Open **Messages** to see every email/text the app sent and to whom.
  Open **Settings** to change the season name, pay rate, admins, reminder times
  and pitch limits. (Admin can also trigger the timed jobs for testing.)
- **Expect:** No message ever goes to a family address except an **umpire's
  parent** (the one exception). Changing a limit in Settings changes the rule —
  nothing is hard-coded.

---

## Part 2 — Built and tested, but no screen yet

These work in the engine and are covered by the automated tests (Part 3), but
they don't have buttons in the web app today. This is the **next build**. I can
wire up screens for any of them on request. If you want to *see* them working
before then, your developer can exercise them directly, or I can walk you through
each one.

- **Game scores** — a coach enters the final; the other coach confirms or
  disputes; a dispute goes to the division director to settle; forfeits are 6–0;
  out-of-town games wait for director approval; an unconfirmed score auto-confirms
  after 24 hours.
- **Standings** — winning percentage (a tie counts as half a win), with
  tiebreakers (head-to-head, then fewest runs allowed, then a director's coin
  toss).
- **Playoff brackets** — Majors 6-team double-elimination; Minors, Farm and Babe
  Ruth single-elimination; higher seed is home.
- **Pitch counts** — daily limits by age, required rest days, the 12-year-old
  weekly innings cap, and a warning to the division director when a count is over
  (it warns, never blocks).
- **Rainouts** — close a field (or a whole day); the affected games become
  rainouts and everyone is told; reopening puts them back.
- **Snack Shack** — shifts with a public, no-login sign-up page that never leaks a
  volunteer's details, with cancel links and reminders.
- **Backup / restore / self-check** — a one-file backup of the whole league, a
  rehearsed restore (on the test copy only), and a one-page post-deploy health
  check.

---

## Part 3 — The automated tests (how we know all of it works)

Everything above — clickable or not — is checked by an automated test suite that
runs before any deploy. Your developer runs:

```bash
npm test
```

- **267 tests** drive the app as real people (umpire, both coaches, director,
  admin, the public, signed-out) and check what actually changed and **who was
  messaged** — not just that a page loaded.
- Rules are tested on **both sides of every edge** (20 vs 21 pitches, an April 30
  vs May 1 birthday, the last Snack Shack spot, a 6–0 forfeit).
- A **whole-season dress rehearsal** (`test/api/e2e-season.test.js`) plays a full
  season across **all five divisions** from the first upload to the last payout.

There's also a **planted-bug check** (`npm run planted-bugs`): it deliberately
breaks each rule one at a time and confirms a test goes red. All **39** planted
bugs are currently caught — which is how we know the tests have teeth and aren't
just green checkmarks.

**What "green" means for you:** if `npm test` passes, every rule in Parts 1 and 2
behaved correctly for the scenarios above and their edge cases.

---

## One-page checklist (the clickable features)

- [ ] Sign in as admin, umpire, coach — each sees the right tabs; wrong PIN refused
- [ ] Upload a schedule; re-upload shows no changes; a misspelled team is named
- [ ] Upload umpire & coach lists; approve the walk-in; mark one plate-qualified
- [ ] Umpire takes a spot; non-qualified umpire refused the plate; 2-a-week limit holds
- [ ] Post and accept a swap; can't double-book; can withdraw
- [ ] A moved game asks its umpire to reconfirm
- [ ] Coverage: assign, urgent opening, add game, cancel game, mark patched
- [ ] Director sees only their division
- [ ] Coach confirms umpire worked / no-show; gives a rating (admin-only)
- [ ] Payouts: preview, mark paid, CSV; no-shows unpaid; never paid twice
- [ ] Messages shows every message and recipient; no stray family addresses
- [ ] Settings changes a rule (e.g. pay rate) and it takes effect
