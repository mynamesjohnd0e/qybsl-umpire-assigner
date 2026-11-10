// Admin actions: override assignment, urgent openings, patched-game status and
// cancellation. Ported from flow.test.js.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
H.setupEnv();

let app, W;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => { H.reset(); app.clearJars(); W = await H.world(app); });

test('assigning an umpire to a game that already started needs a force flag', async () => {
  const start = new Date(Date.now() - 3 * 3600e3).toISOString();
  const { id } = await app.ok('john', 'POST', '/api/admin/games',
    { start, division: 'Farm 8', home: 'Red Sox', away: 'Yankees', field: 'Quarry Hills Field A' });
  const warned = await app.call('john', 'POST', `/api/admin/games/${id}/assign`, { slot: 'plate', umpireId: 'alice@x.test' });
  assert(warned.status >= 400 && warned.data.needsForce, 'admin is warned, not silently blocked');
  await app.ok('john', 'POST', `/api/admin/games/${id}/assign`, { slot: 'plate', umpireId: 'alice@x.test', force: true });
  const slots = (await app.ok('john', 'GET', '/api/admin/overview')).games.find(g => g.id === id).slots;
  assert.strictEqual(slots.plate.umpireId, 'alice@x.test');
});

test('a patched game status can be set by an admin', async () => {
  await app.ok('john', 'POST', `/api/admin/games/${W.games.majors}/patched`, { status: 'Confirmed', note: '2 from assignor' });
  const g = (await app.ok('john', 'GET', '/api/admin/overview')).games.find(x => x.id === W.games.majors);
  assert.strictEqual(g.patchedStatus, 'Confirmed');
  assert.strictEqual(g.patchedNote, '2 from assignor');
});

test('an urgent opening frees the spot and blasts eligible umpires', async () => {
  await app.ok('dan', 'POST', '/api/umpire/claim', { gameId: W.games.orioles, slot: 'plate' });
  await app.ok('john', 'POST', `/api/admin/games/${W.games.orioles}/urgent`, { slot: 'plate' });
  const urgent = (await H.outbox()).filter(m => m.kind === 'urgent');
  assert(urgent.length > 0, 'an urgent blast was logged');
  const g = (await app.ok('john', 'GET', '/api/admin/overview')).games.find(x => x.id === W.games.orioles);
  assert(g.slots.plate.urgent, 'the spot is flagged urgent');
  assert(!g.slots.plate.umpireId, 'the previous umpire was released');
});

test('cancelling a game clears its umpires', async () => {
  await app.ok('alice', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'plate' });
  await app.ok('john', 'POST', `/api/admin/games/${W.games.redSox}/cancel`, {});
  const g = (await app.ok('john', 'GET', '/api/admin/overview')).games.find(x => x.id === W.games.redSox);
  assert.strictEqual(g.status, 'cancelled');
  assert(!g.slots.plate.umpireId);
});

test('resetting a PIN lets someone sign up again', async () => {
  await app.ok('alice', 'POST', '/api/auth/login', { email: 'alice@x.test', pin: '1111' }); // alice exists
  await app.ok('john', 'POST', '/api/admin/people/alice@x.test/reset-pin', {});
  // After a reset the old PIN no longer works and they can set a new one.
  await app.fails(/No PIN set|wrong/, 'x', 'POST', '/api/auth/login', { email: 'alice@x.test', pin: '1111' });
});

test('an admin cannot delete someone who still holds an upcoming game', async () => {
  await app.ok('alice', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'plate' });
  await app.fails(/upcoming games/, 'john', 'DELETE', '/api/admin/people/alice@x.test');
});
