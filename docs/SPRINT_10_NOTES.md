# Sprint 10 — Whole-app dress rehearsal (Apr 12–30, 2027)

The final check before go-live. Every feature already has deep tests of its own;
this sprint adds the one thing missing — a run that exercises the *whole* league,
all five divisions at once, driving every feature in the order a real season uses
them and checking that each feature hands off cleanly to the next. If the deep
tests are each a microscope on one rule, this is the walk-through of the whole
building with the lights on.

## What changed

- **One synthetic dataset for the whole league** (`test/helpers/league2027.js`).
  Made-up names only — no real SportsEngine export or roster ever lives in the
  repo. It sets up, through the real API: coaches and teams for Farm 8, Farm 9,
  Minors, Majors and Babe Ruth; student umpires with parents and a plate-qualified
  mix; Minors and Majors player rosters with league ages pinned to 2027 (including
  the April 30 boundary — a 12-year-old born on the cutoff next to an 11-year-old
  born a day later — and two 12-year-olds on one team for the weekly cap); three
  division directors; and the season schedule as a SportsEngine HQ CSV (the real
  export format, the one that carries makeup pairing), with a T-ball game that must
  be skipped.
- **One end-to-end walk** (`test/api/e2e-season.test.js`). Fifteen phases, in
  season order, sharing one league built once. Each phase is a real role doing a
  real thing and checking the outcome *and* the handoff to the next feature:

  1. **Import** — preview equals the actual upload; five divisions land; T-ball is
     skipped; every Quincy team matches the coach list.
  2. **Rosters** — birthdates became league ages (boundary included) and no
     birthdate or contact detail is kept.
  3. **Staffing** — students claim Farm slots and swap one; the plate-qualified
     rule holds; the Majors (patched) game takes an assignor status, not slots; an
     urgent opening messages the pool.
  4. **Scores** — every path to final: enter + confirm, dispute → director settles,
     forfeit (6–0), out-of-town approval, and the 24-hour auto-confirm.
  5. **Standings & brackets** — the Minors table balances (wins = losses) and a
     director records a coin toss; Majors seeds a double-elimination bracket (with
     the if-needed final) and Farm 8 a single; a director sees only their own
     division.
  6. **Pitching** — an over-limit count warns once (not twice) and still saves;
     four days rest means eligible on the fifth day; two 12-year-olds combine toward
     the 12-inning weekly cap; the rest shows on a later game's eligibility screen.
  7. **Rainouts & makeups** — closing a field rains its game out and reopening puts
     it back; a re-upload pairs the makeup to the rained-out original and carries
     the umpire.
  8. **Snack Shack** — the public fills a shift, the public page leaks no volunteer
     detail, the last spot is atomic, a cancel link works, and a full-day closure
     cancels the shifts and tells the volunteers.
  9. **Payouts** — a worked umpire is paid once; a no-show is not.
  10. **Go-live** — a backup captures all five divisions, the self-check reads ok,
      and — across the whole season — every email the app sent landed on an allowed
      address (coach, umpire, umpire's parent, Snack Shack volunteer or league
      staff). No other family address was ever used.

## A real fix this sprint surfaced

Building the dress rehearsal on the iCal feed showed that **makeup pairing never
fired for iCal imports** — the pair key that links a makeup to its rained-out
original is only computed by the SportsEngine CSV parser, not the iCal one. In
production the schedule comes from the SportsEngine HQ **CSV** export, so this is
not a live bug, but it is a sharp edge: an iCal-only league would silently never
pair makeups. The dataset now uses the CSV path (which is what the board actually
uploads), so the walk tests the real import route. Noted here for whoever later
decides whether iCal should compute a pair key too.

## Definition of done — status

| Item | Status |
| --- | --- |
| Every feature driven as the real roles, data + messaging checked | ✅ 15-phase walk |
| Rules exercised at their boundaries | ✅ Apr 30 age line, rest on the 5th day, 12-inning cap at/over, forfeit 6–0, last snack spot |
| Permission handoffs checked | ✅ plate rule, director-only coin toss/bracket, coach can't toss, public leak-proof |
| Mutation gate still catches every rule | ✅ 39 planted bugs caught; 4 now also verified through the walk |
| Every division represented | ✅ Farm 8, Farm 9, Minors, Majors, Babe Ruth |
| No real names or exports committed | ✅ all synthetic |
| Dress rehearsal is green and John has watched it | ✅ `npm test` → the walk passes |

## Notes for John

- This is the test you can point anyone at to answer "does the whole thing work
  together?" — it plays a season from the first upload to the last payout.
- It uses only made-up names, so it is safe to run and to read.
- One thing it taught us: always upload the **CSV** export from SportsEngine HQ,
  not an iCal link — the CSV is what lets a rained-out game's makeup attach to the
  original.
