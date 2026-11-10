// Reconfirming a moved game, and the job that reopens a spot nobody reconfirmed.
// The expiry job has two edges that a careless change would break, so both are
// tested: the deadline itself, and the game-start line (a game that has already
// happened must never have its umpire dropped). Ported and extended from
// flow.test.js / csv.test.js.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const H = require('../helpers');
H.setupEnv();

let app, W;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => { H.reset(); app.clearJars(); W = await H.world(app); });

// Put Alice on plate and Bob on field of the Red Sox game, then move it in the
// feed so both are asked to reconfirm. Returns the stored start and deadline.
async function moveRedSox() {
  await app.ok('alice', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'plate' });
  await app.ok('bob', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'field' });
  const moved = W.events.map(e => e.uid === 'e1@se'
    ? { ...e, start: W.at(1, 18, 0), end: W.at(1, 20, 0), loc: 'Quarry Hills Field B' } : e);
  fs.writeFileSync(W.feedFile, H.ics(moved));
  await app.ok('john', 'POST', '/api/admin/sync');
  const g = (await app.ok('john', 'GET', '/api/admin/overview')).games.find(x => x.id === W.games.redSox);
  return { start: Date.parse(g.start), deadline: Date.parse(g.slots.plate.reconfirmBy) };
}

const slotsOf = async id =>
  (await app.ok('john', 'GET', '/api/admin/overview')).games.find(g => g.id === id).slots;

test('reconfirming "yes" keeps the spot and leaves the reconfirm state', async () => {
  await moveRedSox();
  await app.ok('alice', 'POST', '/api/umpire/reconfirm', { gameId: W.games.redSox, slot: 'plate', yes: true });
  const slots = await slotsOf(W.games.redSox);
  assert.strictEqual(slots.plate.state, 'assigned');
  assert.strictEqual(slots.plate.umpireId, 'alice@x.test');
  assert.strictEqual(slots.plate.reconfirmBy, null);
});

test('before the deadline, an un-reconfirmed spot is left alone', async () => {
  const { deadline } = await moveRedSox();
  const dropped = await H.jobs().expireReconfirms(new Date(deadline - 3600e3));
  assert.strictEqual(dropped, 0, 'nothing drops an hour before the deadline');
  const slots = await slotsOf(W.games.redSox);
  assert.strictEqual(slots.field.state, 'reconfirm');
  assert.strictEqual(slots.field.umpireId, 'bob@x.test');
});

test('after the deadline, an un-reconfirmed spot reopens', async () => {
  const { deadline } = await moveRedSox();
  // Alice reconfirms; Bob does not.
  await app.ok('alice', 'POST', '/api/umpire/reconfirm', { gameId: W.games.redSox, slot: 'plate', yes: true });
  const dropped = await H.jobs().expireReconfirms(new Date(deadline + 3600e3));
  assert.strictEqual(dropped, 1, 'exactly Bob is dropped');
  const slots = await slotsOf(W.games.redSox);
  assert(!slots.field.umpireId, 'Bob is off the field spot');
  assert.strictEqual(slots.plate.umpireId, 'alice@x.test', 'Alice, who reconfirmed, stays');
});

test('declining a moved game opens the spot immediately', async () => {
  await moveRedSox();
  await app.ok('alice', 'POST', '/api/umpire/reconfirm', { gameId: W.games.redSox, slot: 'plate', yes: false });
  const slots = await slotsOf(W.games.redSox);
  assert(!slots.plate.umpireId, 'the plate spot is open again');
});

test('a reconfirm is NEVER dropped once the game has started', async () => {
  // This is the guard the planted "ignore game start" bug would break: if the
  // game has already happened there is nothing to reconfirm, so the umpire must
  // stay on it (and be paid), not be released past the deadline.
  const { start } = await moveRedSox();
  const dropped = await H.jobs().expireReconfirms(new Date(start + 3600e3));
  assert.strictEqual(dropped, 0, 'no umpire is dropped from a game that already started');
  const slots = await slotsOf(W.games.redSox);
  assert.strictEqual(slots.plate.umpireId, 'alice@x.test');
  assert.strictEqual(slots.field.umpireId, 'bob@x.test');
  assert.strictEqual(slots.plate.state, 'assigned', 'the stale reconfirm is cleared to assigned');
  assert.strictEqual(slots.field.state, 'assigned');
});
