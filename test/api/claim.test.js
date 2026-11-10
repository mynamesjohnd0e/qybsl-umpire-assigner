// Umpire sign-up (claim) rules and the board view. Ported from flow.test.js.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
H.setupEnv();

let app, W;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => { H.reset(); app.clearJars(); W = await H.world(app); });

test('an unapproved walk-in umpire cannot claim', async () => {
  await app.fails(/approval/, 'carl', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'field' });
});

test('plate spots are refused to umpires who are not plate-qualified', async () => {
  await app.fails(/plate-qualified/, 'bob', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'plate' });
});

test('a claimed spot cannot be claimed again', async () => {
  await app.ok('bob', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'field' });
  await app.fails(/just taken/, 'dan', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'field' });
  // The claim really stuck in the stored data.
  const ov = await app.ok('john', 'GET', '/api/admin/overview');
  assert.strictEqual(ov.games.find(g => g.id === W.games.redSox).slots.field.umpireId, 'bob@x.test');
});

test('you cannot take both spots on the same game', async () => {
  await app.ok('alice', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'plate' });
  const r = await app.call('alice', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'field' });
  assert(r.status >= 400, 'second spot on same game refused');
  assert(/already working|just taken/.test(r.data.error), r.data.error);
});

test('the weekly cap stops a third game in one Mon–Sun week', async () => {
  await app.ok('alice', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'plate' });
  await app.ok('alice', 'POST', '/api/umpire/claim', { gameId: W.games.cubs, slot: 'plate' });
  const ov = await app.ok('john', 'GET', '/api/admin/overview');
  const aliceGames = ov.games.filter(g => g.slots && Object.values(g.slots).some(s => s.umpireId === 'alice@x.test')).length;
  assert.strictEqual(aliceGames, 2, 'alice holds exactly two games');
  await app.fails(/2 games that week/, 'alice', 'POST', '/api/umpire/claim', { gameId: W.games.orioles, slot: 'plate' });
});

test('the board shows a partner first name but never another umpire email', async () => {
  await app.ok('bob', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'field' });
  await app.ok('alice', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'plate' });
  const board = await app.ok('alice', 'GET', '/api/umpire/board');
  const g = board.board.find(x => x.id === W.games.redSox);
  assert.strictEqual(g.partner, 'Bob');
  assert.deepStrictEqual(g.mine, ['plate']);
  const bobBoard = await app.ok('bob', 'GET', '/api/umpire/board');
  assert.strictEqual(bobBoard.board.find(x => x.id === W.games.cubs)?.slots.plate.status, 'open');
  assert(!JSON.stringify(bobBoard).includes('alice@x.test'), 'no other umpire emails leak onto the board');
});

test('patched (assignor) games do not accept student-umpire claims', async () => {
  await app.fails(/does not use student umpires|not found/i, 'alice', 'POST', '/api/umpire/claim', { gameId: W.games.majors, slot: 'plate' });
});
