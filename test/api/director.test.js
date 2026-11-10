// Division director: scoped to one division. A Farm Director can manage umpires
// on Farm 8 games and is refused everywhere else, for every action, and cannot
// touch board-admin tools. Covers the Sprint 1 definition-of-done for the role.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
H.setupEnv();

let app, W;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => { H.reset(); app.clearJars(); W = await H.world(app); });

// Add a director (admin action) and sign them in so they can set a PIN.
async function makeDirector(jar, email, name, divisions) {
  await app.ok('john', 'POST', '/api/admin/people', { role: 'director', email, name, divisions });
  await app.ok(jar, 'POST', '/api/auth/signup', { role: 'director', email, pin: '3333', name });
}

test('a director account must be set up by an admin first', async () => {
  await app.fails(/not set up as a division director/, 'x', 'POST', '/api/auth/signup',
    { role: 'director', email: 'nobody@x.test', pin: '3333', name: 'Nobody' });
});

test('granting a bogus division is refused', async () => {
  await app.fails(/Not a division/, 'john', 'POST', '/api/admin/people',
    { role: 'director', email: 'd@x.test', name: 'D', divisions: ['Farm 8', 'Pickleball'] });
});

test('the Farm Director can staff a Farm 8 game', async () => {
  await makeDirector('dir', 'farmdir@x.test', 'Farm Director', ['Farm 8']);
  const me = await app.ok('dir', 'GET', '/api/me');
  assert.deepStrictEqual(me.me.director.divisions, ['Farm 8']);
  await app.ok('dir', 'POST', `/api/admin/games/${W.games.redSox}/assign`, { slot: 'plate', umpireId: 'alice@x.test', force: true });
  const slots = (await app.ok('john', 'GET', '/api/admin/overview')).games.find(g => g.id === W.games.redSox).slots;
  assert.strictEqual(slots.plate.umpireId, 'alice@x.test');
});

test('the Farm Director is refused on another division\'s games, for every action', async () => {
  await makeDirector('dir', 'farmdir@x.test', 'Farm Director', ['Farm 8']);
  // Orioles is Farm 9; Majors is a patched game — both outside Farm 8.
  for (const gid of [W.games.orioles, W.games.majors]) {
    const assign = await app.call('dir', 'POST', `/api/admin/games/${gid}/assign`, { slot: 'plate', umpireId: 'alice@x.test', force: true });
    assert.strictEqual(assign.status, 403, `assign on ${gid} must be 403`);
    const urgent = await app.call('dir', 'POST', `/api/admin/games/${gid}/urgent`, { slot: 'plate' });
    assert.strictEqual(urgent.status, 403, `urgent on ${gid} must be 403`);
  }
  // And it really did nothing: Orioles is still unstaffed.
  const slots = (await app.ok('john', 'GET', '/api/admin/overview')).games.find(g => g.id === W.games.orioles).slots;
  assert(!slots.plate.umpireId);
});

test('the Farm Director can post an urgent opening on a Farm 8 game', async () => {
  await makeDirector('dir', 'farmdir@x.test', 'Farm Director', ['Farm 8']);
  await app.ok('dan', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'plate' });
  await app.ok('dir', 'POST', `/api/admin/games/${W.games.redSox}/urgent`, { slot: 'plate' });
  const g = (await app.ok('john', 'GET', '/api/admin/overview')).games.find(x => x.id === W.games.redSox);
  assert(g.slots.plate.urgent);
});

test('the overview a director sees is scoped to their division(s)', async () => {
  await makeDirector('dir', 'farmdir@x.test', 'Farm Director', ['Farm 8']);
  const ov = await app.ok('dir', 'GET', '/api/admin/overview');
  assert.deepStrictEqual(ov.scope, ['Farm 8']);
  assert(ov.games.every(g => g.division === 'Farm 8'), 'only Farm 8 games');
  assert(ov.games.some(g => g.id === W.games.redSox), 'includes the Farm 8 Red Sox game');
  assert(!ov.games.some(g => g.id === W.games.orioles), 'excludes the Farm 9 Orioles game');
  assert(!ov.games.some(g => g.id === W.games.majors), 'excludes the Majors game');
});

test('a two-division director manages both and no others', async () => {
  await makeDirector('dir', 'bothdir@x.test', 'Multi Director', ['Farm 8', 'Farm 9']);
  await app.ok('dir', 'POST', `/api/admin/games/${W.games.orioles}/assign`, { slot: 'plate', umpireId: 'alice@x.test', force: true });
  const majors = await app.call('dir', 'POST', `/api/admin/games/${W.games.majors}/assign`, { slot: 'plate', umpireId: 'alice@x.test', force: true });
  assert.strictEqual(majors.status, 403, 'still refused on Majors');
});

test('a director cannot reach board-admin tools', async () => {
  await makeDirector('dir', 'farmdir@x.test', 'Farm Director', ['Farm 8']);
  const adminOnly = [
    ['PUT', '/api/admin/settings', {}],
    ['GET', '/api/admin/settings'],
    ['GET', '/api/admin/ratings'],
    ['POST', '/api/admin/sync'],
    ['POST', '/api/admin/roster/umpires', 'name,email\nz,z@x.test'],
    ['POST', '/api/admin/roster/players', { csv: 'name,number,birthdate,team\nK,1,2015-01-01,QCARE' }],
    ['GET', '/api/admin/players'],
    ['GET', '/api/admin/teams'],
    ['GET', '/api/admin/payouts'],
    ['POST', '/api/admin/people', { email: 'z@x.test', name: 'Z' }],
    ['GET', '/api/admin/outbox'],
    ['POST', '/api/admin/run-jobs']
  ];
  for (const [m, u, b] of adminOnly) {
    assert.strictEqual((await app.call('dir', m, u, b)).status, 403, `director must be refused ${m} ${u}`);
  }
});

test('removing all divisions clears director status', async () => {
  await makeDirector('dir', 'farmdir@x.test', 'Farm Director', ['Farm 8']);
  await app.ok('john', 'PUT', '/api/admin/people/farmdir@x.test', { director: { divisions: [] } });
  // No longer a director → refused on the overview (director/admin only).
  assert.strictEqual((await app.call('dir', 'GET', '/api/admin/overview')).status, 403);
});
