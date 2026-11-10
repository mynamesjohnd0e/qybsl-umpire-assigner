// Importing and reconciling an iCal schedule: sorting games into divisions and
// tracks, and handling moves, cancellations and reinstatements on re-sync.
// Ported from flow.test.js.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const H = require('../helpers');
H.setupEnv();

let app, W;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => { H.reset(); app.clearJars(); W = await H.world(app); });

// Rewrite the feed file with a new event list and sync again.
async function resync(events) {
  fs.writeFileSync(W.feedFile, H.ics(events));
  return app.ok('john', 'POST', '/api/admin/sync');
}

test('the first import sorts games, skipping and parking what it cannot place', async () => {
  assert.strictEqual(W.sync.counts.new, 7, JSON.stringify(W.sync.counts));
  assert.strictEqual(W.sync.counts.skipped, 1, 'the T-Ball game is skipped');
  assert.strictEqual(W.sync.counts.unsorted, 1, 'the Mystery game cannot be sorted');
});

test('games are classified by rule, then by the coach list', async () => {
  const g = s => W.overview.games.find(x => x.summary.includes(s));
  const pirates = W.overview.games.find(x => x.summary.startsWith('Pirates'));
  assert.strictEqual(pirates.division, 'Farm 9', 'Pirates sorted via the coach list');
  assert.strictEqual(pirates.track, 'student');
  assert.strictEqual(g('9A').track, 'student');
  assert.strictEqual(g('11B').track, 'patched');
  assert.strictEqual(g('Majors').coverage, 'Not requested', 'patched game starts unrequested');
});

test('moving a game in SportsEngine puts assigned umpires into reconfirm', async () => {
  await app.ok('alice', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'plate' });
  await app.ok('bob', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'field' });

  const moved = W.events.filter(e => e.uid !== 'e2@se');
  moved[0] = { ...moved[0], start: W.at(1, 18, 0), end: W.at(1, 20, 0), loc: 'Quarry Hills Field B' };
  const r = await resync(moved);
  assert.strictEqual(r.counts.moved, 1);
  assert.strictEqual(r.counts.cancelled, 1, 'the dropped Cubs game is cancelled');

  const ov = await app.ok('john', 'GET', '/api/admin/overview');
  const g1 = ov.games.find(g => g.id === W.games.redSox);
  assert.strictEqual(g1.coverage, 'Needs reconfirm');
  assert.strictEqual(g1.field, 'Quarry Hills Field B', 'the new field is stored');
  assert.strictEqual(g1.slots.plate.state, 'reconfirm');
  const g2 = ov.games.find(g => g.id === W.games.cubs);
  assert.strictEqual(g2.status, 'cancelled');
  assert(!g2.slots.plate.umpireId, 'a cancelled game keeps no umpires');
});

test('a cancelled game that comes back is reinstated, not duplicated', async () => {
  // Drop the Cubs game, then bring it back.
  const without = W.events.filter(e => e.uid !== 'e2@se');
  const c1 = await resync(without);
  assert.strictEqual(c1.counts.cancelled, 1);
  const c2 = await resync(W.events);
  assert.strictEqual(c2.counts.reinstated, 1);
  const ov = await app.ok('john', 'GET', '/api/admin/overview');
  assert.strictEqual(ov.games.filter(g => g.id === W.games.cubs).length, 1, 'still one Cubs game');
  assert.strictEqual(ov.games.find(g => g.id === W.games.cubs).status, 'scheduled');
});

test('a feed that loses more than half its games does not wipe the season', async () => {
  const r = await resync(W.events.slice(8)); // keep only the last event
  assert(r.warnings.length, 'a warning is raised');
  assert.strictEqual(r.counts.cancelled, 0, 'nothing is cancelled');
  const ov = await app.ok('john', 'GET', '/api/admin/overview');
  assert(ov.games.filter(g => g.status !== 'cancelled').length > 1, 'games survive');
});
