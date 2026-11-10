// Swaps: hand a spot to another eligible umpire. Ported from flow.test.js.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
H.setupEnv();

let app, W;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => { H.reset(); app.clearJars(); W = await H.world(app); });

test('a swap is offered only to eligible umpires, and only one can take it', async () => {
  await app.ok('alice', 'POST', '/api/umpire/claim', { gameId: W.games.cubs, slot: 'plate' });
  const sw = await app.ok('alice', 'POST', '/api/umpire/swap', { gameId: W.games.cubs, slot: 'plate' });
  assert.strictEqual(sw.offeredTo, 1, 'only Dan is plate-qualified and free');

  // Bob is not plate-qualified, so he cannot accept a plate swap.
  await app.fails(/plate-qualified/, 'bob', 'POST', `/api/umpire/swap/${sw.swapId}/accept`);
  await app.ok('dan', 'POST', `/api/umpire/swap/${sw.swapId}/accept`);
  await app.fails(/already took/, 'dan', 'POST', `/api/umpire/swap/${sw.swapId}/accept`);

  const ov = await app.ok('john', 'GET', '/api/admin/overview');
  assert.strictEqual(ov.games.find(g => g.id === W.games.cubs).slots.plate.umpireId, 'dan@x.test',
    'the game is now Dan\'s in the stored data');
});

test('you cannot swap a spot that is not yours', async () => {
  await app.ok('alice', 'POST', '/api/umpire/claim', { gameId: W.games.cubs, slot: 'plate' });
  await app.fails(/not yours/, 'dan', 'POST', '/api/umpire/swap', { gameId: W.games.cubs, slot: 'plate' });
});

test('a swap can be withdrawn and then nobody can accept it', async () => {
  await app.ok('alice', 'POST', '/api/umpire/claim', { gameId: W.games.cubs, slot: 'plate' });
  const sw = await app.ok('alice', 'POST', '/api/umpire/swap', { gameId: W.games.cubs, slot: 'plate' });
  await app.ok('alice', 'POST', `/api/umpire/swap/${sw.swapId}/cancel`);
  await app.fails(/no longer open|already took/, 'dan', 'POST', `/api/umpire/swap/${sw.swapId}/accept`);
  // Alice still holds the spot.
  const ov = await app.ok('john', 'GET', '/api/admin/overview');
  assert.strictEqual(ov.games.find(g => g.id === W.games.cubs).slots.plate.umpireId, 'alice@x.test');
});
