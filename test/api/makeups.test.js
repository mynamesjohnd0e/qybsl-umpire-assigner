// Makeups: when a rained-out game's rematch is uploaded, the makeup attaches to
// the original (never duplicated) and the original's umpires are carried onto it
// with a reconfirm request.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
const { etDateKey } = require('../../lib/time');
H.setupEnv();

let app;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => {
  H.reset(); app.clearJars();
  await app.ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '4321', name: 'John' });
  await app.ok('john', 'POST', '/api/admin/roster/umpires', 'name,email\nAmy Ump,amy@x.test\n');
});

const row = (date, venue = 'Quarry Hills - Field B') =>
  H.seRow(date, '5:30 PM', 'FARM 8 > JF8- QCARE (BUCKLEY)', 'FARM 8 > JF8- SINC LAW (BYRNE)', `${venue} > ${venue}`);
const overview = () => app.ok('john', 'GET', '/api/admin/overview');

test('a makeup attaches to its rained-out original and carries the umpire with a reconfirm', async () => {
  // Upload the original game and assign an umpire.
  await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: H.seCsv([row(H.fut(3))]), filename: 'a.csv', season: 'Spring 2027' });
  let ov = await overview();
  const original = ov.games.find(g => g.field === 'Quarry Hills - Field B');
  await app.ok('john', 'POST', `/api/admin/games/${original.id}/assign`, { slot: 'field', umpireId: 'amy@x.test', force: true });

  // Rain the original out (its field, its day) — the umpire stays assigned.
  await app.ok('john', 'POST', '/api/admin/closures', { fields: ['Field B'], date: etDateKey(original.start), reason: 'rain' });
  assert.strictEqual((await overview()).games.find(g => g.id === original.id).status, 'rainout');

  // Upload the makeup: same teams, a week later, with the original gone from the feed.
  const r = await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: H.seCsv([row(H.fut(10))]), filename: 'b.csv', season: 'Spring 2027' });
  assert.strictEqual(r.counts.makeups, 1, 'one makeup paired');

  ov = await overview();
  const makeup = ov.games.find(g => g.makeupOf === original.id);
  assert(makeup, 'the makeup is linked to the original');
  assert.notStrictEqual(makeup.id, original.id, 'it is a new game, not a duplicate of the original');
  assert.strictEqual(makeup.slots.field.umpireId, 'amy@x.test', 'the umpire is carried onto the makeup');
  assert.strictEqual(makeup.slots.field.state, 'reconfirm', 'and asked to reconfirm');
  // The original records that it has a makeup.
  assert.strictEqual(ov.games.find(g => g.id === original.id).madeUpBy, makeup.id);
  // The umpire gets a reconfirm request.
  assert((await H.outbox()).some(m => m.kind === 'reconfirm' && m.person === 'amy@x.test'));
});

test('without a rained-out original, a rematch is just a new game (no false pairing)', async () => {
  await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: H.seCsv([row(H.fut(3))]), filename: 'a.csv', season: 'Spring 2027' });
  // A second game between the same teams, both still live → not a makeup.
  const r = await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: H.seCsv([row(H.fut(3)), row(H.fut(10), 'Quarry Hills - Field C')]), filename: 'b.csv', season: 'Spring 2027' });
  assert.strictEqual(r.counts.makeups || 0, 0, 'two live games between the same teams are not a makeup');
  const ov = await overview();
  assert.strictEqual(ov.games.filter(g => g.makeupOf).length, 0);
});
