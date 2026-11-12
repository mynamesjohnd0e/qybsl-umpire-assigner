# Front-End Requirements – League Operations

Status: **Approved — all decisions locked**, Nov 12, 2026. Owner: John Higgins.
Companion to `docs/PLAN.md` (what we're building) and `docs/SPRINTS.md` (how we build and test).
This document covers only the **web app people see** — the screens — not the server rules, which already exist.

---

## 1. Why this document exists

Over Sprints 0–9 the **back end grew into the whole league app**: scores, standings, playoff
brackets, pitch counts and eligibility, rainouts, Snack Shack, payouts and backups all work and are
tested through the API. But the **screens never caught up**. Today `public/app.js` is still essentially
the *umpire* app. A coach signing in can confirm which umpires worked — but there is nowhere to enter a
score, log a pitcher, or see standings, even though the server does all three.

So "front-end requirements" here means one thing: **design the screens that finally expose the league
app the server already supports**, for each role, on a phone, in plain language.

### What exists on the server but has no screen today

| Capability (server is done) | API it lives behind | Who needs the screen |
| --- | --- | --- |
| Enter / confirm / dispute a final score; home runs | `/api/coach/score*`, `/api/coach/scores` | Home & away coaches |
| Director settles disputes, approves other-town, forfeit, "entered in SE" | `/api/admin/games/:id/score/*`, `/api/admin/enter-se` | Division directors |
| Standings & tiebreakers | `/api/standings` | Everyone |
| Playoff brackets, seeding, coin toss | `/api/admin/bracket`, `/api/admin/bracket/seeds`, `/api/admin/standings/coin-toss` | Directors; viewed by all |
| Pitch logging | `/api/coach/pitches`, `/api/admin/games/:id/pitches` | Coaches, directors |
| Pre-game eligibility ("who can pitch today") | `/api/games/:id/eligibility`, `/api/pitching/eligibility` | Coaches, directors |
| Pitch violations dashboard | `/api/admin/pitching/violations` | Cal Ripken Director |
| Field closures / rainouts | `/api/admin/closures*` | Board admins |
| Snack Shack shifts (staff) | `/api/admin/snack*` | Snack Shack Director |
| **Snack Shack public sign-up (no login)** | `/api/public/snack/*` | Parents |
| Roster / player upload; teams | `/api/admin/roster/players`, `/api/admin/players`, `/api/admin/teams` | Admins |
| Schedule upload **preview** before saving | `/api/admin/schedule-upload/preview` | Admins |
| Backup / restore / self-check | `/api/admin/backup`, `/api/admin/restore`, `/api/admin/selfcheck` | Admins |

What already has screens and **stays largely as-is**: umpire open/my-games/pay, coach-confirms-umpire,
admin coverage, people, ratings, payouts, schedule sync, messages, settings, account.

---

## 2. Decisions locked (from John, Nov 12)

1. **Deliverable now:** this written requirements doc. No code yet.
2. **Navigation:** a **bottom navigation bar** (app-like) with a **simple line icon + text label** on each
   item, replacing the top tab row as features grow.
3. **Snack Shack public sign-up:** a **separate, no-login page** titled **"Quarry Snack Shack Staffing"**
   (path `/snack-shack`), its own simple look — no app chrome.
4. **Scope:** plan **all roles**; phase the build in the order of §9 (approved Nov 12).
5. **Home runs:** score entry **captures who hit the home runs** (hitter names per side), not just a count.
6. **"Who can pitch":** the **pre-game eligibility snapshot only** — no season-long per-player pitch history
   for coaches.
7. **Multiple roles:** a person with more than one role gets a **role switcher in the top-right**; the bottom
   nav and Today follow the **active role**. No merged bar. Single-role people never see the switcher.

### Inherited, non-negotiable from `CLAUDE.md` (not re-decided)

- **Vanilla HTML/CSS/JS, no framework, no build step.** (ES modules are fine — they need no build.)
- **Branding:** navy `#1B3A6B`, red `#B22222`, white. **Never gold.**
- **Plain-language copy**, short sentences, written for coaches, teenage umpires and parents on phones.
- **Eastern time everywhere; weeks run Monday–Sunday.**
- **Players are minors:** show name, jersey number, league age only. No birthdates, no player contact.
- **Umpire ratings are admin-only** — never shown to umpires or coaches.
- **Pitch counts: warn and report, never block saving.** The UI must reflect this exactly.

---

## 3. Design foundations (reuse what's there)

The current app already has a clean, phone-first design system in `public/styles.css`. **Everything new
reuses it** — we are extending a house style, not starting over.

| Already have | Reuse for |
| --- | --- |
| Color tokens (`--navy`, `--red`, status greens/yellows/reds/blues) | All new states |
| `.game` cards, `.slot` boxes | Game lists everywhere (scores, pitching, eligibility hang off a game) |
| `.badge` (green/red/yellow/blue/gray/navy) | Status pills: "Needs your score", "Disputed", "Resting until…", "Violation" |
| `.note` (info/warn/bad/good) | Inline guidance and warnings (incl. the pitch-count warning) |
| `.tbl-wrap` + `table`, `td.num` | Standings, pitch logs, "enter in SE" list, payouts |
| `.stats` / `.stat` tiles | Home dashboard counts ("3 scores to enter", "1 dispute") |
| `modal()`, `toast()`, `confirmBox()` | Confirmations and quick forms (keep the existing helpers) |
| `.seg` segmented control, `.filters` | Week/division/status filters |
| Test-copy warning banner | Keep on every screen of the test copy |

**New components needed** (small, built in the same style):
- **Bottom navigation bar** (fixed, ≤5 items, safe-area aware for phones) — each item a **simple line icon
  above a short text label** (e.g. home, calendar, trophy, clipboard, list). Icons are inline SVG, navy;
  the active item is red, matching the current tab treatment.
- **Role switcher** — a small dropdown in the **top-right** (next to the name/Sign-out), shown only to
  people with more than one role. Picking a role re-renders the bottom nav and Today for that role.
- **"More" sheet** — a slide-up menu for destinations beyond the 5th nav slot.
- **Game detail screen** — one game opened full, with sections (Score / Pitchers / Eligibility / Umpires).
- **Bracket view** — a simple, horizontally-scrollable playoff tree (navy lines, higher seed marked home).
- **Score entry stepper** — big number inputs for two scores, plus home-run hitter names per side.
- The **"Quarry Snack Shack Staffing" page** — its own minimal shell, no app chrome, no login.

---

## 4. Information architecture

### 4.1 Role-aware "Today" home

Every signed-in person lands on a **Today** screen built from *their* open tasks — not a feature list.
It answers "what do I need to do right now?" This is the single biggest usability win as features multiply.

| Role | Today shows (each a tappable stat tile / row) |
| --- | --- |
| Umpire | Games you're on this week; open games needing umpires; reconfirm requests; this period's pay |
| Head coach | Scores to enter (home) or confirm (away); pitchers to log; umpires to confirm; disputes you raised |
| Division director | Disputes to settle; other-town scores to approve; pitch violations; unresolved standings ties; coverage gaps — **their division only** |
| Snack Shack Director | Unfilled shifts this week; shifts to create/copy |
| Board admin | Everything above across divisions, plus: uploads pending, open field closures, backup status |

One person can hold several roles. They pick the **active role** from the top-right **role switcher**
(§4.2); Today then shows that role's tasks, newest/urgent first. Someone with one role sees no switcher and
simply lands on their Today.

### 4.2 Bottom navigation (per role)

The bar shows **up to 5 destinations**, each a **line icon above a text label**; slot 1 is always **Today**,
slot 5 is **More** when there's overflow. The set follows the **active role** (see the role switcher below).
Badges (red count pills, reusing `setBadge`) sit on the icon when action is waiting.

| Role | Bottom bar (left → right) | Behind "More" |
| --- | --- | --- |
| Umpire | Today · Games · Pay · Account | — |
| Head coach | Today · My Games · Standings · More | Eligibility ("Who can pitch"), Account |
| Division director | Today · Games · Standings · More | Brackets, Pitching (violations/eligibility), Enter-in-SE, Messages, Account |
| Snack Shack Director | Today · Shifts · Account | — |
| Board admin | Today · Games · League · More | Standings, Brackets, People, Uploads, Closures, Payouts, Snack Shack, Messages, Settings, Backup, Account |

- **"Games"** is the hub for coaches/directors/admins: a filtered list of games where each game opens
  the **Game detail** screen. Most in-season work (score, pitchers, eligibility, umpires) happens there,
  so the bar stays short.
- **Multiple roles — the switcher, not a merged bar.** A person who is, say, **director + admin** sees a
  **role switcher in the top-right**; the bottom bar and Today reflect whichever role is active, so each
  role stays clean and uncluttered. Division scoping still applies while the director role is active. The
  switcher lists only the roles that person actually holds, and never appears for a single-role user.

### 4.3 Game detail — the in-season workhorse

Tapping any game opens one screen with the game header (teams, time, field, division) and the sections
that apply to that game and that viewer:

- **Score** — enter / confirm / dispute / settle / forfeit / approve / mark entered-in-SE (by role).
- **Pitchers** — log counts for your team; see both teams' logs.
- **Eligibility** — "who can pitch today" for both teams, pulled before the game.
- **Umpires** — who's assigned; confirm they worked (coach); assign/urgent (director/admin).

Sections a viewer may not act on are read-only, not hidden, so coaches can *see* the opponent's
eligibility and umpires but can't change them (mirrors the server's permission rules).

---

## 5. Screen-by-screen requirements

Each screen lists **who** sees it, **what** they do, the **states/edges** that must be visible, and the
**copy intent**. Endpoints are named so the build maps cleanly to the server that already exists.

### 5.1 Scores  *(Sprint 2 server; no screen yet)*

**Enter a score — home coach.** `POST /api/coach/score`
- Two large number fields (home team's runs / away team's runs) **plus** a "Who hit home runs?" name
  entry per side — coaches record the home-run hitters' names, not just a count (confirmed by John).
- Shows the **24-hour deadline** ("confirm by Tue 7:10 PM or it confirms on its own") and nightly-nudge note.
- Edge: no score field on **cancelled / rained-out / not-yet-started** games — the Score section explains why.
- After save: status badge flips to **"Waiting for away coach"**; away coach's Today gets a task.

**Confirm or dispute — away coach.** `POST /api/coach/score/confirm` · `POST /api/coach/score/dispute`
- Shows the score the home coach entered, exactly. Two buttons: **Confirm** / **Dispute** (with a reason box).
- Edge: home coach **cannot** confirm their own; away **cannot** enter. Buttons simply aren't offered;
  attempting via a stale screen shows the server's refusal as a toast.
- Dispute routes to that division's director and sets a **Disputed** badge.

**Settle / approve / forfeit — division director.** `/api/admin/games/:id/score/{enter,settle,approve,forfeit,entered-se}`
- Director can enter for a coach who can't, **settle** a dispute to a final score, **approve** an
  other-town game, mark a **forfeit (6–0)**, and tick **"entered in SE."**
- **Other-town games** (e.g. Babe Ruth vs South Boston) show an "approve" step and **never auto-confirm**;
  only that division's director approves.

**"Enter in SE" list — director/admin.** `GET /api/admin/enter-se`
- A plain list of **confirmed scores not yet copied into SportsEngine**, each with a "Mark entered" tick.
- Copy intent: "Copy these into SportsEngine, then tick them off." This is a manual hand-off, by design.

Score **status badges** (reuse `.badge`): *Needs score* (yellow) · *Waiting for away* (blue) ·
*Confirmed* (green) · *Disputed* (red) · *Forfeit* (gray) · *Entered in SE* (navy).

### 5.2 Standings  *(Sprint 3 server)* — `GET /api/standings`

- Per-division table, best first: **Rank, Team, W-L-T, Win %, Runs Allowed** (server returns
  `rank, wins, losses, ties, winPct, runsScored, runsAllowed`). `td.num` for all numbers.
- **Tied teams share a rank.** When a tie is unresolved, show a **"Tie — coin toss needed"** note;
  directors get a button to record the toss (§5.3). Everyone else sees the tie plainly.
- Tiebreak order shown on tap: head-to-head → fewest runs allowed → coin toss.
- Copy intent: "Families see standings on SportsEngine; this is the league's working view."
- Visible to **all signed-in roles** (read-only for coaches/umpires).

### 5.3 Playoffs & brackets  *(Sprint 3 server)* — `GET /api/admin/bracket`, `/bracket/seeds`, `/standings/coin-toss`

- **Bracket view**: a simple tree, higher seed marked **home**, horizontally scrollable on a phone.
  - Majors: **6-team double elimination**, with the **"if needed" final** appearing only when the
    winners'-bracket team loses the first final.
  - Minors: 5-team single elim; Farm 8 / Farm 9 / Babe Ruth: single elim.
- **Seeding screen (director):** seeds from standings; a **drag/number-swap** to reorder before publishing;
  a **"Record coin toss"** action for dead ties. Nothing publishes until the director confirms.
- Playoff games come from the SportsEngine upload mapped to bracket slots, so each slot links to its
  **Game detail** — scores, pitchers and umpires work exactly as the regular season.
- Viewed by everyone once published; edited by directors/admins only.

### 5.4 Pitch logging  *(Sprint 4 server)* — `POST /api/coach/pitches`, `/api/admin/games/:id/pitches`, `GET .../pitchlog`

- From a game's **Pitchers** section: pick a player from **your roster**, enter **pitches thrown**;
  for a player who is **12 by league age**, also enter **innings pitched to a third** (stored as outs).
- **Warn, never block:** if a count breaks a rule, save succeeds and an inline **warning note** appears
  ("Over the daily max — did they finish the batter?" or "Needs 4 days rest; eligible Sat Apr 18").
  The count is still saved and shows a **Violation** badge; nothing is prevented.
- 24-hour logging deadline with nightly nudges (shown on Today).
- Coaches log **their own** pitchers; a director can log for a coach who can't. Opposing coach can
  **see** logs but every attempt to change them is refused.

### 5.5 Eligibility — "Who can pitch today"  *(Sprint 5 server)* — `GET /api/games/:id/eligibility`, `/api/pitching/eligibility`

- Pre-game screen listing **both teams'** pitchers (server returns `home`/`away`, each player with
  `name, number, leagueAge` + status). Each pitcher shows one of:
  - **Available** (green) — plus **pitches left today**.
  - **Resting until <date>** (yellow) — the exact day they're eligible again.
  - **At limit** (red).
- A standalone **"Who can pitch"** quick view (behind More) for a coach checking before they set a lineup.
  This is the **pre-game snapshot only** — availability, pitches left today, and resting-until date — **not**
  a season-long pitch history (confirmed by John).
- 12-year-old weekly cap surfaces here too (§5.6).
- Both coaches and the director see it; it's **read-only** — it never lets you change the other team.

### 5.6 Pitch violations & the 12-year-old cap  *(Sprint 5 server)* — `GET /api/admin/pitching/violations`

- **Cal Ripken Director dashboard:** a list of current violations (player, game, rule broken, date),
  each linking to the game. Clearing the count below the limit clears the flag; editing twice must
  **not** re-alert (the server handles de-dup; the screen just reflects state).
- **12-year-old innings cap:** a per-team running total toward **12 innings/week (Mon–Sun)**, with a
  **near-limit warning** as it approaches. Innings shown as thirds (1⅓, 1⅔) though stored as outs.

### 5.7 Rainouts & field closures  *(Sprint 6 server)* — `POST /api/admin/closures`, `/closures/:id/reopen`, `GET /api/admin/closures`

- **Board-admin only.** Close a field, several fields, or **all of Quarry Hills**, for a **day or a time
  window** (including a planned multi-day closure). A clear date/time + field picker.
- Before confirming, show **exactly which games** fall in the window ("3 games affected"), because the
  rule is edge-sensitive (a game ending exactly at the window start is *not* affected).
- After closing: those games show **Rained out** everywhere — no score, no pitch log, no pay, not in
  standings. A **copy-ready note** is produced for the Communications Director to post in SportsEngine
  (show it with a "Copy" button).
- **Reopen** restores the games and notifies the same people. The screen must make "who gets told" plain:
  both coaches, assigned umpires **and their parents** — no other family address.

### 5.8 Snack Shack — staff  *(Sprint 7 server)* — `POST /api/admin/snack/shifts`, `/copy-week`, `GET /api/admin/snack`

- **Snack Shack Director.** Create a shift (date, start/end, people needed, title, location) or
  **copy last week**. List shows each shift with **spots left** and the **volunteers signed up**
  (name/email/mobile — staff-only).
- A weekly **unfilled-shifts** summary (the server also emails it).
- A full Quarry Hills closure cancels that day's shifts and tells the volunteers (shown as state here).

### 5.9 "Quarry Snack Shack Staffing" — public page  *(Sprint 7 server)* — **separate, no login** — `GET/POST /api/public/snack/*`

- Its **own minimal page** at **`/snack-shack`**, titled **"Quarry Snack Shack Staffing"**: QYBSL header,
  a list of upcoming shifts with **spots left**, and a sign-up form (**name, email, mobile** — no account).
  Server returns counts only. This is the link you'd text parents.
- **Privacy is a hard requirement:** the public page shows **spots left only — never another volunteer's
  name, email or phone.**
- Confirmation screen + a **cancel link** (emailed) that only cancels **their own** sign-up and reopens
  the spot; a reused or altered link does nothing.
- No app navigation, no login prompt — a parent should be able to open it from a texted link and finish
  in under a minute on a phone.

### 5.10 Uploads & data  *(Sprints 1, 9 server)* — rosters, players, teams, schedule **preview**

- **Schedule upload with preview** (`/api/admin/schedule-upload/preview`): before saving, show
  **adds / changes / cancels**, game by game, so an admin sees what an import will do and can back out.
  (The existing Schedule-sync screen already uploads; this adds the **preview step** in front of it.)
- **Roster / player upload** (`/api/admin/roster/players`): upload Minors/Majors rosters; after upload
  show **league ages** computed and confirm **no birthdates were kept** (privacy check visible to admin).
- **Teams view** (`/api/admin/teams`, `/api/admin/players`): teams by division with head coach and roster;
  a misspelled team from an import is **reported, never silently dropped**.

### 5.11 Backup & safety  *(Sprint 9 server)* — `GET /api/admin/backup`, `POST /api/admin/restore`, `GET /api/admin/selfcheck`

- **Admin-only utilities page:** download a backup, run the **self-check** (shows ok / problems), and a
  guarded **restore** (strong confirm, since it overwrites). Low-traffic but needed for go-live confidence.

### 5.12 Existing screens — keep, light touch

Umpire (open / my games / pay), coach-confirms-umpire, People, Ratings (admin-only), Payouts, Schedule
sync, Messages, Settings, Account all stay. They move **into the new bottom-nav structure** and the
Account/role summary expands to name the new roles (division director, Snack Shack Director). Messages
copy should keep reflecting the **messaging policy** (umpires' parents copied; no other family address).

---

## 6. Cross-cutting requirements

1. **Permissions mirror the server, visibly.** A viewer only sees the actions their role allows; refused
   actions (via a stale screen) surface the server's plain-language message as a toast. Every new screen
   must be checked for the full role matrix the way `SPRINTS.md` demands for endpoints.
2. **Empty / loading / error states** on every screen (reuse `.empty`, the "Loading…" panel, `.note bad`).
   "No games yet," not a blank page.
3. **Phones first, slow networks.** Works at phone width with no horizontal page scroll (tables scroll
   inside `.tbl-wrap`); tappable targets ≥ 44px; number pads for number inputs (`inputmode="numeric"`).
4. **Badges for waiting work** on Today and the bottom bar, so a coach knows something needs them without
   hunting.
5. **Warn-never-block** is a UI principle, not just a server one: a saved-with-warning state is a first-class
   thing the screens show calmly (yellow note + saved), never an error that looks like a failure.
6. **Privacy in the UI:** no player birthdate or contact anywhere; ratings never leak to umpires/coaches;
   the public volunteer page leaks no volunteer's details.
7. **Test-copy banner** stays on every screen of the test copy; it already exists — keep it.
8. **Accessibility:** color is never the only signal (badges carry text); labels on every input; contrast
   meets the existing tokens.

### Maintainability note (for the build, not a product decision)

`public/app.js` is already ~900 lines as one file. Adding scores, standings, brackets, pitching,
eligibility, closures and Snack Shack will multiply that. Recommendation for whoever builds it: split the
front end into small **ES modules** (e.g. `scores.js`, `standings.js`, `bracket.js`, `pitching.js`,
`gameDetail.js`, `nav.js`) loaded with `<script type="module">`. **No build step, no framework** — this
stays within `CLAUDE.md`. It keeps each screen readable (John's standing ask) and testable on its own.

---

## 7. Where the front end gets tested

`SPRINTS.md` tests drive the app **through the HTTP API as real roles**, which already covers the rules.
The screens add a thin layer that should be checked for: the right **actions are offered/hidden per role**,
the right **states render** (disputed, resting-until, rained-out, violation, tie-needs-coin-toss), and the
**public volunteer page leaks nothing**. These are light DOM/flow checks on top of the existing API tests —
not a second test framework. The dress rehearsal (Sprint 10) is the moment to click every screen in season
order end to end.

---

## 8. Open questions for John

**All resolved as of Nov 12** — no open questions remain:

- Score entry captures home-run hitters' names (§2.5, §5.1).
- "Who can pitch" is the pre-game snapshot only (§2.6, §5.5).
- Bottom nav uses **line icons + text labels** (§2.2, §3, §4.2).
- Multiple roles handled by a **top-right role switcher**, not a merged bar (§2.7, §4.2).
- Public page titled **"Quarry Snack Shack Staffing"** at `/snack-shack` (§2.3, §5.9).
- This doc is **mirrored into the plan Claude Doc** beside `PLAN.md`/`SPRINTS.md`.
- Phasing approved (§9).

---

## 9. Phasing — **approved by John, Nov 12**

The server already supports everything, so the front end follows the **same order a season actually
runs** — the spine `SPRINTS.md` uses for the dress rehearsal. Each phase is shippable to the test copy and
demoable on a phone. This is a *build* sequence; the requirements above are the whole target.

| Phase | Screens | Why this order | Demo |
| --- | --- | --- | --- |
| **F1 — Shell** | Bottom nav, role-aware **Today**, Game detail frame, move existing screens in | Everything else hangs off the new navigation and Today | Sign in as each role; land on a Today that makes sense |
| **F2 — Scores** | Enter / confirm / dispute / settle / forfeit / other-town / "enter in SE" | The daily in-season task; unlocks standings | Enter as home, dispute as away, settle as director |
| **F3 — Standings & brackets** | Standings tables, tie/coin-toss, bracket view, seeding | Reads scores; needed before playoffs | 2026 scores → 2026 standings → a bracket |
| **F4 — Pitching** | Pitch logging, eligibility, violations, 12-yo cap | Independent of scores; coaches' other in-season task | Log a 66-pitch outing → see 4 days rest |
| **F5 — Rainouts** | Field closures, rained-out states, reopen, comms note | Needs games/scores in place to show what's affected | Close Quarry Hills Saturday; see who's told |
| **F6 — Snack Shack** | Staff shifts + **public "Quarry Snack Shack Staffing" page** (`/snack-shack`) | Self-contained; the one no-login surface | Sign up from a phone with no account |
| **F7 — Admin & go-live** | Upload preview, roster/teams view, backup/restore/self-check | Pre-season and safety tooling for the real import | Preview a 2027 import; practice a restore |

My recommendation: **F1 first regardless** (the nav and Today are the foundation), then **F2 → F3**
(the highest-value, most-used in-season flow), then F4–F7 as above. If you'd rather prove the full in-season
loop fastest, F1 → F2 → F4 (scores + pitching, the two things a coach touches every week) before standings.

---

## 10. Out of scope (front end, for now)

- Practice-field scheduler and equipment tracker (separate apps, only linked).
- Any write-back to SportsEngine (families see scores/standings there; we only read exports).
- Softball and summer travel divisions.
- Native mobile apps — this stays a phone-friendly web app, one link, one sign-in.
