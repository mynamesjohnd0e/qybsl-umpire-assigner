// Importing a SportsEngine HQ CSV export: parsing, moved-game pairing, moving a
// game into the past, the test-copy send guard and the date shift. Runs as the
// test copy (TEST_MODE), as the real export flow does. Ported from csv.test.js.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
const { addDaysToKey, etDateKey } = require('../../lib/time');
H.setupEnv({ testMode: true, testSendOnly: '^john', adminEmails: 'john@qybsl.test' });

let app;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => {
  H.reset(); app.clearJars();
  await app.ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '1234', name: 'John' });
});

const csv1 = () => H.seCsv([
  H.seRow(H.fut(3), '5:30 PM', 'FARM 8 > JF8- QCARE  (BUCKLEY)', 'FARM 8 > JF8- SINC LAW P.C. (BYRNE)', 'Quarry Hills - Field B > Quarry Hills - Field B'),
  H.seRow(H.fut(10), '5:30 PM', 'FARM 8 > JF8- QCARE  (BUCKLEY)', 'FARM 8 > JF8- SINC LAW P.C. (BYRNE)', 'Quarry Hills - Field C > Quarry Hills - Field C'),
  H.seRow(H.fut(4), '5:30 PM', 'FARM 9 > JF9- QUINCY LOCK (FEENEY)', 'FARM 9 > JF9- HERITAGE COMPANIES (TOLAND)', 'Quarry Hills  > Quarry A'),
  H.seRow(H.fut(5), '5:30 PM', 'MAJORS > Quincy Police', 'MAJORS > Forepoint', 'Quarry Hills - Field C > Quarry Hills - Field C'),
  H.seRow(H.fut(6), '9:00 AM', 'T-BALL > Bees', 'T-BALL > Ants', 'Quarry Hills - Field D > Quarry Hills - Field D'),
  H.seRow(H.fut(7), '5:30 PM', 'FARM 9 > JF9- QUINCY LOCK (FEENEY)', 'FARM 9 > JF9- NOEL DIBONA (CHIRIELEISON)', 'Quarry Hills - Field A > Quarry Hills - Field A', 'cancelled'),
  H.seRow(H.fut(7), '6:00 PM', 'x', 'y', 'z', 'scheduled', 'practice')
]);

test('the CSV test copy confirms it is in test mode', async () => {
  assert.strictEqual((await app.ok('john', 'GET', '/api/me')).testMode, true);
});

test('upload sorts games and parses teams and venues from the export format', async () => {
  const r = await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: csv1(), filename: 'export.csv', season: 'Test Spring' });
  assert.deepStrictEqual([r.counts.new, r.counts.skipped], [4, 1], JSON.stringify(r.counts));
  const ov = await app.ok('john', 'GET', '/api/admin/overview');
  const g1 = ov.games.find(g => g.field === 'Quarry Hills - Field B');
  assert.strictEqual(g1.division, 'Farm 8');
  assert.strictEqual(g1.home, 'QCARE (BUCKLEY)');
  assert.strictEqual(g1.away, 'SINC LAW P.C. (BYRNE)');
  assert(ov.games.some(g => g.field === 'Quarry Hills - Quarry A'), 'the short venue form parses');
  assert.strictEqual(ov.games.find(g => g.division === 'Majors').track, 'patched');
});

test('re-upload moves a game (umpire reconfirms), drops one, and leaves the rematch', async () => {
  await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: csv1(), filename: 'e.csv', season: 'Test Spring' });
  let ov = await app.ok('john', 'GET', '/api/admin/overview');
  const g1 = ov.games.find(g => g.field === 'Quarry Hills - Field B');
  await app.ok('john', 'POST', '/api/admin/roster/umpires', { csv: 'name,email\nAmy Ump,amy@x.test' });
  await app.ok('john', 'POST', `/api/admin/games/${g1.id}/assign`, { slot: 'field', umpireId: 'amy@x.test', force: true });

  // Drop the HERITAGE game and move the Field B game a day later / an hour later.
  const csv2 = csv1().split('\n').filter(l => !l.includes('HERITAGE'))
    .map(l => l.startsWith(`game,x,,${H.fut(3)}`) ? l.replace(H.fut(3), H.fut(4)).replace('5:30 PM', '6:00 PM') : l).join('\n');
  const r2 = await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: csv2, filename: 'e2.csv', season: 'Test Spring' });
  assert.strictEqual(r2.counts.moved, 1, JSON.stringify(r2.counts));
  assert.strictEqual(r2.counts.new, 0);
  assert.strictEqual(r2.counts.cancelled, 1);

  ov = await app.ok('john', 'GET', '/api/admin/overview');
  const moved = ov.games.find(g => g.id === g1.id);
  assert.strictEqual(moved.slots.field.state, 'reconfirm');
  assert.strictEqual(moved.slots.field.umpireId, 'amy@x.test');
  assert.strictEqual(ov.games.filter(g => g.track === 'student' && g.status !== 'cancelled').length, 2, 'the rematch is untouched');
});

test('moving a game into the past keeps its umpire; a stale reconfirm is cleared, not released', async () => {
  await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: csv1(), filename: 'e.csv', season: 'Test Spring' });
  let ov = await app.ok('john', 'GET', '/api/admin/overview');
  const g1 = ov.games.find(g => g.field === 'Quarry Hills - Field B');
  await app.ok('john', 'POST', '/api/admin/roster/umpires', { csv: 'name,email\nAmy Ump,amy@x.test' });
  await app.ok('john', 'POST', `/api/admin/games/${g1.id}/assign`, { slot: 'field', umpireId: 'amy@x.test', force: true });
  const csv2 = csv1().split('\n').filter(l => !l.includes('HERITAGE'))
    .map(l => l.startsWith(`game,x,,${H.fut(3)}`) ? l.replace(H.fut(3), H.fut(4)).replace('5:30 PM', '6:00 PM') : l).join('\n');
  await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: csv2, filename: 'e2.csv', season: 'Test Spring' });

  const past = (() => { const [y, m, d] = addDaysToKey(etDateKey(new Date()), -2).split('-').map(Number); return `${m}/${d}/${y}`; })();
  const csvPast = csv2.split('\n').map(l => l.startsWith(`game,x,,${H.fut(4)},6:00 PM`) ? l.replace(H.fut(4), past) : l).join('\n');
  const rp = await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: csvPast, filename: 'p.csv', season: 'Test Spring' });
  assert.strictEqual(rp.counts.moved, 1, JSON.stringify(rp.counts));
  const pg = (await app.ok('john', 'GET', '/api/admin/overview')).games.find(g => g.id === g1.id);
  assert(pg.past);
  assert.strictEqual(pg.slots.field.umpireId, 'amy@x.test');

  await H.jobs().expireReconfirms(new Date(Date.now() + 48 * 3600e3));
  const pg2 = (await app.ok('john', 'GET', '/api/admin/overview')).games.find(g => g.id === g1.id);
  assert.strictEqual(pg2.slots.field.umpireId, 'amy@x.test');
  assert.strictEqual(pg2.slots.field.state, 'assigned');

  // Test-copy guard: Amy's reconfirm messages were held back.
  const out = await H.outbox();
  assert(out.filter(m => m.to === 'amy@x.test').every(m => m.status.includes('test copy')), 'non-John addresses held');
});

test('test reset wipes practice data; a date shift lands games a week later', async () => {
  await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: csv1(), filename: 'e.csv', season: 'Test Spring' });
  const r = await app.ok('john', 'POST', '/api/admin/test/reset', {});
  assert(r.games >= 4);
  assert.strictEqual((await app.ok('john', 'GET', '/api/admin/overview')).games.length, 0);

  await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: csv1(), filename: 'e.csv', season: 'Test', shiftDays: 7 });
  const shifted = (await app.ok('john', 'GET', '/api/admin/overview')).games.find(g => g.field === 'Quarry Hills - Field B');
  assert.strictEqual(etDateKey(shifted.start), addDaysToKey(etDateKey(new Date()), 10), 'fut(3) shifted by 7 lands on day 10');
  assert.strictEqual(new Date(shifted.start).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }), '5:30 PM');
});
