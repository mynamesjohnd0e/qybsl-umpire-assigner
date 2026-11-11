// Sprint 9 · Go-live. The three promises the board is trusting on launch night:
//
//   1. Upload preview tells the truth — what it shows is exactly what the real
//      upload then does, game for game, and it changes nothing on its own.
//   2. A clean import either matches every team or stops and names the ones it
//      can't place, so a misspelled team is never silently dropped.
//   3. A backup can be restored record for record, so last night's copy brings
//      the test copy back to exactly where production was.
//
// Plus the post-deploy self-check, and that every new admin door is locked to
// admins. Runs as the test copy (TEST_MODE), the way restore really runs.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
const { umpBody } = require('../helpers/world');
const backup = require('../../lib/backup');
H.setupEnv({ testMode: true, testSendOnly: '^john', adminEmails: 'john@qybsl.test' });

let app;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => {
  H.reset(); app.clearJars();
  process.env.ADMIN_EMAILS = 'john@qybsl.test';
  await app.ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '1234', name: 'John' });
  // A coach list so team names on the schedule have something to match against.
  await app.ok('john', 'POST', '/api/admin/roster/coaches',
    'name,email,mobile,team,division\n' +
    'Coach Q,q@x.test,6175550101,QCARE (BUCKLEY),Farm 8\n' +
    'Coach S,s@x.test,6175550102,SINC LAW P.C. (BYRNE),Farm 8\n' +
    'Coach L,l@x.test,,QUINCY LOCK (FEENEY),Farm 9\n' +
    'Coach H,h@x.test,,HERITAGE COMPANIES (TOLAND),Farm 9\n');
});

// A first schedule: three student games plus one T-ball game the app skips.
const csv1 = () => H.seCsv([
  H.seRow(H.fut(3), '5:30 PM', 'FARM 8 > JF8- QCARE  (BUCKLEY)', 'FARM 8 > JF8- SINC LAW P.C. (BYRNE)', 'Quarry Hills - Field B > Quarry Hills - Field B'),
  H.seRow(H.fut(10), '5:30 PM', 'FARM 8 > JF8- QCARE  (BUCKLEY)', 'FARM 8 > JF8- SINC LAW P.C. (BYRNE)', 'Quarry Hills - Field C > Quarry Hills - Field C'),
  H.seRow(H.fut(4), '5:30 PM', 'FARM 9 > JF9- QUINCY LOCK (FEENEY)', 'FARM 9 > JF9- HERITAGE COMPANIES (TOLAND)', 'Quarry Hills  > Quarry A'),
  H.seRow(H.fut(6), '9:00 AM', 'T-BALL > Bees', 'T-BALL > Ants', 'Quarry Hills - Field D > Quarry Hills - Field D')
]);

// A refresh of csv1: drops the Farm 9 game (→ cancelled) and moves the Field B
// game a day and half an hour later (→ moved). The far-future rematch is left
// alone. Built from csv1 the same way the board's second export would differ.
const csv2 = () => csv1().split('\n').filter(l => !l.includes('HERITAGE'))
  .map(l => l.startsWith(`game,x,,${H.fut(3)}`) ? l.replace(H.fut(3), H.fut(4)).replace('5:30 PM', '6:00 PM') : l)
  .join('\n');

// A snapshot of the league a test can compare before and after a preview, to
// prove a preview touched nothing.
async function snapshot() {
  const ov = await app.ok('john', 'GET', '/api/admin/overview');
  const games = ov.games.map(g => ({ id: g.id, start: g.start, field: g.field, status: g.status, track: g.track }))
    .sort((a, b) => a.id < b.id ? -1 : 1);
  const jobs = (await H.store().get('settings', 'jobs')) || {};
  const runs = (await H.store().list('syncRuns')).length;
  return { games, lastSyncId: jobs.lastSyncId || null, runs };
}

// ── 1. Preview tells the truth ───────────────────────────────────────────────

test('preview = the actual upload, counts and change list game for game', async () => {
  await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: csv1(), filename: 'e.csv', season: 'Test Spring' });

  const prev = await app.ok('john', 'POST', '/api/admin/schedule-upload/preview', { text: csv2(), season: 'Test Spring' });
  assert.strictEqual(prev.preview, true, 'the result is flagged as a preview');

  const act = await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: csv2(), filename: 'e2.csv', season: 'Test Spring' });

  // What the preview promised is what the upload delivered.
  assert.deepStrictEqual(prev.counts, act.counts, `counts differ: preview ${JSON.stringify(prev.counts)} vs actual ${JSON.stringify(act.counts)}`);
  assert.deepStrictEqual(prev.unmatchedTeams, act.unmatchedTeams);
  // The change list matches move-for-move and cancel-for-cancel (ignore the run
  // id and timestamp, which are assigned only when a real run is saved).
  const strip = s => s.changes.map(c => ({ change: c.change, start: c.start, before: c.before, after: c.after, summary: c.summary }))
    .sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  assert.deepStrictEqual(strip(prev), strip(act), 'the preview change list does not match what the upload did');
  // And the upload really did move one and cancel one, so this isn't two empty lists agreeing.
  assert.strictEqual(act.counts.moved, 1, JSON.stringify(act.counts));
  assert.strictEqual(act.counts.cancelled, 1, JSON.stringify(act.counts));
});

test('a preview saves nothing and messages no one', async () => {
  await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: csv1(), filename: 'e.csv', season: 'Test Spring' });
  const before = await snapshot();
  const outBefore = (await H.outbox()).length;

  const prev = await app.ok('john', 'POST', '/api/admin/schedule-upload/preview', { text: csv2(), season: 'Test Spring' });
  assert(prev.counts.moved + prev.counts.cancelled > 0, 'the preview had real changes to report');

  const after = await snapshot();
  assert.deepStrictEqual(after, before, 'the preview changed stored games, the sync pointer, or the run log');
  assert.strictEqual((await H.outbox()).length, outBefore, 'the preview sent a message');
  // The upload record still points at the first file, not the previewed one.
  const up = await app.ok('john', 'GET', '/api/admin/schedule-upload');
  assert.strictEqual(up.filename, 'e.csv');
});

// ── 2. Clean-import validation ───────────────────────────────────────────────

test('an unmatched team is named, in the preview and in the upload, never dropped', async () => {
  // GIANTS is nowhere on the coach list. The game still imports, but the import
  // calls it out so the board can fix the spelling or add the coach.
  const csvBad = H.seCsv([
    H.seRow(H.fut(3), '5:30 PM', 'FARM 8 > JF8- QCARE  (BUCKLEY)', 'FARM 8 > JF8- GIANTS OF QUINCY', 'Quarry Hills - Field B > Quarry Hills - Field B')
  ]);
  const prev = await app.ok('john', 'POST', '/api/admin/schedule-upload/preview', { text: csvBad, season: 'Test Spring' });
  assert(prev.unmatchedTeams.some(t => /GIANTS/i.test(t)), `preview should name GIANTS: ${JSON.stringify(prev.unmatchedTeams)}`);
  assert(prev.warnings.some(w => /GIANTS/i.test(w) && /coach list/i.test(w)), 'preview warns about the unmatched team');

  const act = await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: csvBad, filename: 'bad.csv', season: 'Test Spring' });
  assert.deepStrictEqual(act.unmatchedTeams, prev.unmatchedTeams, 'the upload names the same unmatched team the preview did');
  // Named, not dropped: the game is still on the schedule.
  const ov = await app.ok('john', 'GET', '/api/admin/overview');
  assert(ov.games.some(g => /GIANTS/i.test(g.away || '')), 'the GIANTS game was kept, not silently dropped');
});

test('a fully matched import reports no unmatched teams', async () => {
  const r = await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: csv1(), filename: 'e.csv', season: 'Test Spring' });
  assert.deepStrictEqual(r.unmatchedTeams, [], `expected a clean import: ${JSON.stringify(r.unmatchedTeams)}`);
  assert(!r.warnings.some(w => /coach list/i.test(w)), 'no unmatched-team warning on a clean import');
});

// ── 3. Backup and restore, record for record ─────────────────────────────────

test('restore brings the store back to the backup, record for record', async () => {
  await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: csv1(), filename: 'e.csv', season: 'Test Spring' });
  // Give an umpire a game, so there is assignment state to lose and recover.
  await app.ok('john', 'POST', '/api/admin/roster/umpires', { csv: 'name,email\nAmy Ump,amy@x.test' });
  const g = (await app.ok('john', 'GET', '/api/admin/overview')).games.find(x => x.field === 'Quarry Hills - Field B');
  await app.ok('john', 'POST', `/api/admin/games/${g.id}/assign`, { slot: 'plate', umpireId: 'amy@x.test', force: true });

  const saved = await app.ok('john', 'GET', '/api/admin/backup');
  assert(saved.records > 0 && saved.collections.games, 'the backup captured the league');

  // The disaster: wipe the test copy clean.
  await app.ok('john', 'POST', '/api/admin/test/reset', {});
  assert.strictEqual((await app.ok('john', 'GET', '/api/admin/overview')).games.length, 0, 'the reset emptied the schedule');

  // Restore last night's copy.
  const res = await app.ok('john', 'POST', '/api/admin/restore', saved);
  assert(res.restored.games >= 1, JSON.stringify(res.restored));

  // A fresh backup of the restored store equals the one we restored, doc for doc
  // — including the umpire's assignment and the settings/uploads docs that are
  // keyed by name rather than a field.
  const after = await app.ok('john', 'GET', '/api/admin/backup');
  assert.strictEqual(after.records, saved.records, `record count drifted: ${after.records} vs ${saved.records}`);
  assert.deepStrictEqual(after.collections, saved.collections, 'the restored store does not match the backup record for record');
  const g2 = (await app.ok('john', 'GET', '/api/admin/overview')).games.find(x => x.field === 'Quarry Hills - Field B');
  assert.strictEqual(g2.slots.plate.umpireId, 'amy@x.test', 'the assignment came back');
  assert.strictEqual(g2.status, 'scheduled', 'the game came back');
});

// ── 4. Post-deploy self-check ────────────────────────────────────────────────

test('the self-check reports a healthy, configured, synced app', async () => {
  await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: csv1(), filename: 'e.csv', season: 'Test Spring' });
  const c = await app.ok('john', 'GET', '/api/admin/selfcheck');
  assert.strictEqual(c.ok, true, JSON.stringify(c));
  assert.strictEqual(c.settingsLoaded, true);
  assert.strictEqual(c.adminConfigured, true);
  assert.strictEqual(c.feedConfigured, true, 'the upload registered a feed');
  assert(c.games >= 3, `expected the imported games: ${c.games}`);
  assert(c.lastSyncAt, 'the upload recorded a sync time');
  assert.strictEqual(c.storage, 'local');
});

test('the self-check reads not-ok when no admin is configured', async () => {
  // A deploy where nobody is an admin yet: the check must flag it, not pass. Set
  // this at the data layer (emptying admins would lock the HTTP door we'd use).
  delete process.env.ADMIN_EMAILS;
  await H.store().set('settings', 'main', { seasonLabel: 'Spring 2027', adminEmails: [] });
  H.settings().clearCache();
  const c = await backup.selfCheck();
  assert.strictEqual(c.settingsLoaded, true, 'settings still load');
  assert.strictEqual(c.adminConfigured, false);
  assert.strictEqual(c.ok, false, 'no admin configured must read not-ok');
});

// ── 5. Every new door is admin-only ──────────────────────────────────────────

test('preview, backup, restore and self-check refuse non-admins and the signed-out', async () => {
  await app.ok('john', 'POST', '/api/admin/roster/umpires', { csv: 'name,email\nAmy Ump,amy@x.test' });
  await app.ok('amy', 'POST', '/api/auth/signup', umpBody('amy@x.test', 'Amy Ump'));
  const doors = [
    ['POST', '/api/admin/schedule-upload/preview', { text: csv1(), season: 'X' }],
    ['GET', '/api/admin/backup', undefined],
    ['POST', '/api/admin/restore', { collections: {} }],
    ['GET', '/api/admin/selfcheck', undefined]
  ];
  for (const [m, url, body] of doors) {
    await app.fails(null, 'amy', m, url, body);      // signed in, but only an umpire
    await app.fails(null, 'nobody', m, url, body);   // signed out
  }
  // And the admin can walk through all of them.
  await app.ok('john', 'GET', '/api/admin/backup');
  await app.ok('john', 'GET', '/api/admin/selfcheck');
});
