// Permission matrix: every guarded endpoint, every role, refusals included.
// A route "allows" a role when the request is not turned away with 401/403 —
// a 400 for a deliberately thin body still means the guard let the role in.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
H.setupEnv();

let app, W;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => {
  H.reset(); app.clearJars();
  W = await H.world(app);
  await app.ok('red', 'POST', '/api/auth/signup', { role: 'coach', email: 'red@x.test', pin: '2222', name: 'Coach Red' });
});

// Roles by cookie-jar name. 'guest' is never signed in.
const ADMIN = 'john', UMP = 'alice', PENDING_UMP = 'carl', COACH = 'red', GUEST = 'guest';

async function status(who, method, url, body) {
  return (await app.call(who, method, url, body)).status;
}
const refused = s => s === 401 || s === 403;

// [method, url, body]
const adminRoutes = [
  ['GET', '/api/admin/overview'],
  ['POST', '/api/admin/sync'],
  ['PUT', '/api/admin/settings', {}],
  ['GET', '/api/admin/ratings'],
  ['GET', '/api/admin/outbox'],
  ['POST', '/api/admin/run-jobs'],
  ['GET', '/api/admin/payouts'],
  ['GET', '/api/admin/settings'],
  ['POST', '/api/admin/roster/umpires', 'name,email\nz,z@x.test'],
  ['POST', '/api/admin/roster/coaches', 'name,email,team\nz,z@x.test,Z'],
  ['POST', '/api/admin/people', { email: 'z@x.test', name: 'Z' }],
  ['POST', '/api/admin/schedule-upload', { text: 'x' }]
];
const umpireRoutes = [
  ['POST', '/api/umpire/claim', { gameId: 'nope', slot: 'plate' }],
  ['POST', '/api/umpire/swap', { gameId: 'nope', slot: 'plate' }],
  ['POST', '/api/umpire/reconfirm', { gameId: 'nope', slot: 'plate', yes: true }]
];
const coachRoutes = [
  ['GET', '/api/coach/games'],
  ['POST', '/api/coach/confirm', { gameId: 'nope', results: {} }],
  ['POST', '/api/coach/rate', { gameId: 'nope', slot: 'plate', score: 3 }]
];
const userRoutes = [
  ['GET', '/api/umpire/board'],
  ['PUT', '/api/me', {}]
];

test('admin routes: only the board admin gets in', async () => {
  for (const [m, u, b] of adminRoutes) {
    assert.strictEqual(await status(GUEST, m, u, b), 401, `guest ${u}`);
    assert.strictEqual(await status(UMP, m, u, b), 403, `umpire ${u}`);
    assert.strictEqual(await status(COACH, m, u, b), 403, `coach ${u}`);
    assert(!refused(await status(ADMIN, m, u, b)), `admin should reach ${u}`);
  }
});

test('umpire routes: approved umpires only; coaches, admins and walk-ins are refused', async () => {
  for (const [m, u, b] of umpireRoutes) {
    assert.strictEqual(await status(GUEST, m, u, b), 401, `guest ${u}`);
    assert.strictEqual(await status(COACH, m, u, b), 403, `coach ${u}`);
    assert.strictEqual(await status(ADMIN, m, u, b), 403, `admin (no umpire role) ${u}`);
    assert.strictEqual(await status(PENDING_UMP, m, u, b), 403, `unapproved umpire ${u}`);
    assert(!refused(await status(UMP, m, u, b)), `approved umpire should reach ${u}`);
  }
});

test('coach routes: coaches and admins in, umpires and guests out', async () => {
  for (const [m, u, b] of coachRoutes) {
    assert.strictEqual(await status(GUEST, m, u, b), 401, `guest ${u}`);
    assert.strictEqual(await status(UMP, m, u, b), 403, `umpire ${u}`);
    assert(!refused(await status(COACH, m, u, b)), `coach should reach ${u}`);
    assert(!refused(await status(ADMIN, m, u, b)), `admin should reach ${u}`);
  }
});

test('signed-in-only routes: any signed-in role in, guests out', async () => {
  for (const [m, u, b] of userRoutes) {
    assert.strictEqual(await status(GUEST, m, u, b), 401, `guest ${u}`);
    for (const who of [ADMIN, UMP, COACH]) assert(!refused(await status(who, m, u, b)), `${who} should reach ${u}`);
  }
});

test('cron endpoints require the cron key', async () => {
  for (const u of ['/api/cron/tick', '/api/cron/sync']) {
    assert.strictEqual((await app.call(GUEST, 'POST', u)).status, 403, `no key ${u}`);
    const r = await fetch(app.base + u, { method: 'POST', headers: { 'X-Cron-Key': 'cron-test' } });
    assert(r.status < 400, `valid key ${u} → ${r.status}`);
  }
});
