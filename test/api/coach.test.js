// Coach side: confirm the umpires worked, rate them, and the admin-only rating
// summary. Umpires must never see ratings. Ported from flow.test.js.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
H.setupEnv();

let app, W;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => { H.reset(); app.clearJars(); W = await H.world(app); });

// A game three hours in the past with Alice on plate and Bob on field.
async function pastGame() {
  const start = new Date(Date.now() - 3 * 3600e3).toISOString();
  const { id } = await app.ok('john', 'POST', '/api/admin/games',
    { start, division: 'Farm 8', home: 'Red Sox', away: 'Yankees', field: 'Quarry Hills Field A' });
  await app.ok('john', 'POST', `/api/admin/games/${id}/assign`, { slot: 'plate', umpireId: 'alice@x.test', force: true });
  await app.ok('john', 'POST', `/api/admin/games/${id}/assign`, { slot: 'field', umpireId: 'bob@x.test', force: true });
  return id;
}

async function signInCoaches() {
  await app.ok('red', 'POST', '/api/auth/signup', { role: 'coach', email: 'red@x.test', pin: '2222', name: 'Coach Red' });
  await app.ok('yank', 'POST', '/api/auth/signup', { role: 'coach', email: 'yank@x.test', pin: '2222', name: 'Coach Yank' });
  await app.ok('walk', 'POST', '/api/auth/signup', { role: 'coach', email: 'walk@x.test', pin: '2222', name: 'Walk In' });
}

test('a coach sees their own team games and not other teams', async () => {
  const PG = await pastGame();
  await signInCoaches();
  const cg = await app.ok('red', 'GET', '/api/coach/games');
  assert(cg.games.some(g => g.id === PG), 'sees the past game');
  assert(cg.games.some(g => g.id === W.games.redSox), 'sees the upcoming Red Sox game');
  assert(!cg.games.some(g => g.id === W.games.orioles), 'does not see an Orioles game');
});

test('a coach cannot confirm before the game has started', async () => {
  await pastGame();
  await signInCoaches();
  await app.fails(/once the game has started/, 'red', 'POST', '/api/coach/confirm',
    { gameId: W.games.redSox, results: { plate: 'worked' } });
});

test('a coach cannot confirm another team\'s game', async () => {
  const PG = await pastGame();
  await signInCoaches();
  await app.fails(/own team/, 'walk', 'POST', '/api/coach/confirm', { gameId: PG, results: { plate: 'worked' } });
});

test('confirming marks who worked and who was a no-show', async () => {
  const PG = await pastGame();
  await signInCoaches();
  await app.ok('red', 'POST', '/api/coach/confirm', { gameId: PG, results: { plate: 'worked', field: 'noshow' } });
  const slots = (await app.ok('john', 'GET', '/api/admin/overview')).games.find(g => g.id === PG).slots;
  assert.strictEqual(slots.plate.worked, 'worked');
  assert.strictEqual(slots.field.worked, 'noshow');
});

test('ratings average per umpire and a bad score is refused', async () => {
  const PG = await pastGame();
  await signInCoaches();
  await app.ok('red', 'POST', '/api/coach/rate', { gameId: PG, slot: 'plate', score: 5, comment: 'Great zone' });
  await app.ok('yank', 'POST', '/api/coach/rate', { gameId: PG, slot: 'plate', score: 2, comment: 'Tight on us' });
  await app.fails(/1 to 5/, 'yank', 'POST', '/api/coach/rate', { gameId: PG, slot: 'plate', score: 9 });

  const rt = await app.ok('john', 'GET', '/api/admin/ratings');
  const alice = rt.rows.find(r => r.email === 'alice@x.test');
  assert.strictEqual(alice.seasonAvg, 3.5, 'average of 5 and 2');
  assert.strictEqual(alice.ratings.length, 2);
});

test('a no-show is counted against the umpire', async () => {
  const PG = await pastGame();
  await signInCoaches();
  await app.ok('red', 'POST', '/api/coach/confirm', { gameId: PG, results: { plate: 'worked', field: 'noshow' } });
  const rt = await app.ok('john', 'GET', '/api/admin/ratings');
  assert.strictEqual(rt.rows.find(r => r.email === 'bob@x.test').noShows, 1);
});

test('umpires never see ratings; only admins can read them', async () => {
  const PG = await pastGame();
  await signInCoaches();
  await app.ok('red', 'POST', '/api/coach/rate', { gameId: PG, slot: 'plate', score: 5, comment: 'Great zone' });
  await app.fails(/Not allowed/, 'alice', 'GET', '/api/admin/ratings');
  const board = await app.ok('alice', 'GET', '/api/umpire/board');
  assert(!JSON.stringify(board).includes('Great zone'), 'rating comments never reach an umpire');
});
