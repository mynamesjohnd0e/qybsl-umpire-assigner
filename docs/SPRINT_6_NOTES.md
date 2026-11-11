# Sprint 6 — Rainouts and field closures (Feb 8–21, 2027)

Weather and field closures. A board admin closes a field for a day or a window;
the games on it are rained out, everyone who needs to know hears once, and when a
makeup is scheduled it attaches to the original. Plain-language summary and the
definition-of-done status.

## What changed

- **Close a field, several, or all of Quarry Hills** — for a whole day or a time
  window, including a planned closure (a City Parks closure or a multi-day infield
  rebuild). **Board admins only.**
- **Affected games are rained out.** A game on a closed field whose time overlaps
  the window becomes a rainout: no score, no pitch log, no umpire pay, and not in
  the standings. The window is half-open, so a game ending exactly when the window
  starts is left alone.
- **Everyone who needs to know hears, once.** Both coaches, the assigned umpires
  and their parents are told, and the **Communications Director** gets one
  ready-to-post note listing every affected game. No other address is messaged,
  and re-closing the same games sends nothing new.
- **Reopening restores the games** and tells the same people it's back on.
- **Makeups pair to the original.** When the makeup (the same two teams, a later
  date) comes in on the next upload, it attaches to the rained-out original —
  never duplicated — and the original's umpires are carried onto it with a
  reconfirm request.

## Also in this PR

- **The "4 days rest" eligible day is now confirmed and locked.** John's ruling:
  "N days rest" means eligible on the (N+1)th day — pitch Monday with 4 days rest,
  eligible Saturday. The engine already computed this (`restEligibleOffset` = 1);
  the test that was a `todo` is now a real test, and `CLAUDE.md`/`docs/PLAN.md`
  record the ruling. The suite has no `todo`s left.

## New endpoints

- `POST /api/admin/closures` — close field(s) for a day (`date`) or a window
  (`from`/`to`), with `fields` or `all`.
- `POST /api/admin/closures/:id/reopen` — lift a closure.
- `GET /api/admin/closures` — the closure history.

## Definition of done — status

| Item | Status |
| --- | --- |
| Which games: a 9 AM–3 PM window takes out 8:30–10:30 and leaves one ending exactly at 9:00 | ✅ |
| Exact recipients: both coaches, umpires + parents, one note per game, no other address, re-closing silent | ✅ |
| Gone everywhere: no score/pitch prompt, not in payouts, not in standings | ✅ (rainouts are not "live") |
| Makeups pair, not duplicate; umpires get a reconfirm | ✅ |
| Reopening restores games and tells the same people | ✅ |

## Tests

`npm test` → **224 passing**, 1 skipped (Firestore-emulator case), **0 todo**.
`npm run planted-bugs` → **31** caught, adding four Sprint 6 rules (overlap edge,
rainout treated as live, re-close re-notify, makeup not paired). Mutation config
now covers `lib/closures.js`.

## Not in this sprint (by design)

- Snack Shack volunteer sign-ups are Sprint 7. The practice season and go-live are
  Sprints 8–9.
