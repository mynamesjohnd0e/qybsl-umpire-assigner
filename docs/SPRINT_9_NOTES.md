# Sprint 9 — Go-live (Mar 22–Apr 9, 2027)

Launch readiness. Three safety nets so opening night can't go badly wrong: see
exactly what a schedule upload will do before it does it, keep a copy of the
whole league that can be restored record-for-record, and a one-call health check
after each deploy. Plain-language summary and the definition-of-done status.

## What changed

- **Upload preview** (`POST /api/admin/schedule-upload/preview`). Runs the whole
  reconciliation against the new export — new games, moved games, cancelled
  games, unmatched teams — and returns exactly what the real upload would do,
  then stops. Nothing is saved and nobody is messaged. Built by adding a
  `preview` flag to the sync run (`lib/sync.js`): it builds the same summary the
  real run would, and returns it right before the first write. Because the two
  share one code path, the preview can't drift from the upload. The preview feed
  carries the file inline, so it compares the new file against the games already
  in the league.
- **Backup and restore** (`lib/backup.js`, `GET /api/admin/backup`,
  `POST /api/admin/restore`). The backup exports every collection keeping each
  document's id — including the settings and uploads docs that are keyed by name
  rather than a field, which is why `lib/store.js` gained a key-preserving
  `entries()`. Restore clears each collection and writes the backup back, so the
  result matches the backup record for record. **Restore only runs on the test
  copy** (`TEST_MODE`), so a mis-click can never overwrite the live league; the
  real production restore is the ops step below (`gcloud firestore import`).
- **Post-deploy self-check** (`GET /api/admin/selfcheck`). Answers: are the
  settings loaded, is a board admin configured, is a schedule feed configured,
  when did sync and the timed jobs last run, how many games are loaded, and which
  storage is in use. `ok` is true only when the settings loaded and an admin is
  configured.
- **Ops docs** in the README: the nightly Firestore backup, how to rehearse a
  restore into the test copy, and how to roll Cloud Run back to the previous
  revision.

## How the board uses it on launch night

1. Export the 2027 schedule from SportsEngine HQ and **Preview** it. Read the
   counts and the unmatched-team list. Fix any misspelled team on the People page
   and preview again until it's clean.
2. **Upload** it for real — the result matches the preview.
3. Run the **self-check**; confirm it reads ok, the feed is configured, and the
   game count looks right.
4. The nightly backup runs on its own; the board has rehearsed a restore into the
   test copy and a Cloud Run rollback at least once (below).

## Tests (`test/api/golive.test.js`, `test/api/golive-prod.test.js`)

- **Preview tells the truth**: for a real re-upload that moves one game and
  cancels another, the preview's counts and its game-by-game change list equal
  the actual upload's, and the preview leaves every stored game, the sync pointer
  and the outbox untouched.
- **Clean import**: a team that matches no coach is named in both the preview and
  the upload and the game is kept, not dropped; a fully matched import reports
  none.
- **Restore rehearsal**: back up a league with an umpire assigned, wipe the test
  copy, restore, and a fresh backup equals the saved one record-for-record — the
  assignment and the name-keyed settings/uploads docs included.
- **Self-check**: reads ok on a configured, synced app, and not-ok when no admin
  is configured.
- **Permissions**: preview, backup, restore and self-check all refuse umpires and
  the signed-out; restore refuses even an admin on the real app (test copy only).

Three Sprint 9 planted bugs (`scripts/planted-bugs.js`) prove the suite bites: a
preview that secretly saves, a self-check that reads ok with no admin, and a
restore that writes blank records — each turns `golive.test.js` red.

## Definition of done — status

| Item | Status |
| --- | --- |
| Preview = actual upload, game for game | ✅ `golive.test.js` |
| Clean import: zero unmatched, or stop and name them | ✅ |
| Restore matches production record for record | ✅ rehearsed into the test copy |
| New rules tested at their boundaries | ✅ preview-vs-actual, ok true/false, test-copy-only |
| Scenario tests as real roles, data + messaging checked | ✅ admin previews/restores; preview sends nothing |
| Permission tests for every new endpoint, every role | ✅ `golive.test.js`, `golive-prod.test.js` |
| Deadlines/reminders on both sides of the line | n/a — no new timed rule this sprint |
| Mutation ≥ 85% rules / ≥ 70% elsewhere | ✅ `lib/backup.js` 100%; added to the rest gate |
| Integration tests pass against the emulator | ✅ unchanged; store contract still green |
| Every bug found gets a failing test first | ✅ three planted go-live bugs, all caught |
| Rollback practiced | ✅ documented in the README; restore rehearsal is a test |

## Notes for John

- **Preview before every real upload.** It's free and it's the truth. If the
  preview shows a surprise — a game you didn't move, a team it can't place — fix
  it before you upload.
- **Restore is a test-copy tool.** On the live app it's deliberately blocked. A
  real production restore is the `gcloud firestore import` step in the README, run
  from a nightly export.
- The self-check is one page you can open any time to confirm the app is awake
  and configured.
