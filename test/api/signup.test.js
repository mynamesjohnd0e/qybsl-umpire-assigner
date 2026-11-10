// Sign up and sign in, as every role. Ported from flow.test.js, one assertion
// per behavior so a break in one does not hide the rest.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
H.setupEnv();

let app;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(() => { H.reset(); app.clearJars(); });

const umpBody = (email, name) => ({
  role: 'umpire', email, pin: '1111', name, mobile: '6175559999',
  parentName: 'P', parentEmail: 'p@x.test', parentMobile: '6175558888', venmo: 'v'
});

test('a non-admin email cannot sign up as a board admin', async () => {
  await app.fails(/not on the board admin list/, 'x', 'POST', '/api/auth/signup',
    { role: 'admin', email: 'nobody@x.test', pin: '1234', name: 'Nope' });
});

test('the board admin email can sign up and is marked admin', async () => {
  const r = await app.ok('john', 'POST', '/api/auth/signup',
    { role: 'admin', email: 'John@QYBSL.test', pin: '4321', name: 'John Higgins', mobile: '617-555-0100' });
  assert.strictEqual(r.me.isAdmin, true);
  const me = await app.ok('john', 'GET', '/api/me');
  assert.strictEqual(me.me.isAdmin, true, 'admin flag survives a fresh /api/me');
});

test('a roster umpire is approved on sign-up; a walk-in is not', async () => {
  await app.ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '4321', name: 'John' });
  await app.ok('john', 'POST', '/api/admin/roster/umpires',
    'Name,Email,Plate Qualified\nAlice Ump,alice@x.test,yes\n');
  const a = await app.ok('alice', 'POST', '/api/auth/signup', umpBody('alice@x.test', 'Alice Ump'));
  assert.strictEqual(a.me.umpire.approved, true);
  assert.strictEqual(a.me.umpire.plateQualified, true);
  const c = await app.ok('carl', 'POST', '/api/auth/signup', umpBody('carl@x.test', 'Carl New'));
  assert.strictEqual(c.me.umpire.approved, false, 'walk-in umpire waits for approval');
});

test('umpire sign-up demands the parent and Venmo fields', async () => {
  await app.fails(/parent/i, 'alice', 'POST', '/api/auth/signup',
    { role: 'umpire', email: 'alice@x.test', pin: '1111', name: 'Alice Ump' });
});

test('you cannot sign up twice, and a wrong PIN is refused', async () => {
  await app.ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '4321', name: 'John' });
  await app.ok('alice', 'POST', '/api/auth/signup', umpBody('alice@x.test', 'Alice Ump'));
  await app.fails(/already have a PIN/, 'x', 'POST', '/api/auth/signup', umpBody('alice@x.test', 'Alice'));
  await app.fails(/wrong/, 'x', 'POST', '/api/auth/login', { email: 'alice@x.test', pin: '9999' });
  // The right PIN still works.
  const ok = await app.ok('alice2', 'POST', '/api/auth/login', { email: 'alice@x.test', pin: '1111' });
  assert.strictEqual(ok.me.email, 'alice@x.test');
});

test('a coach on the roster is auto-linked to their team; a walk-in is pending', async () => {
  const { ok } = app;
  await ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '4321', name: 'John' });
  await ok('john', 'POST', '/api/admin/roster/coaches', 'name,email,team,division\nCoach Red,red@x.test,Red Sox,Farm 8\n');
  const red = await ok('red', 'POST', '/api/auth/signup', { role: 'coach', email: 'red@x.test', pin: '2222', name: 'Coach Red' });
  assert.strictEqual(red.me.coach.teams[0].team, 'Red Sox');
  const walk = await ok('walk', 'POST', '/api/auth/signup', { role: 'coach', email: 'walk@x.test', pin: '2222', name: 'Walk In' });
  assert.strictEqual(walk.me.coach.pending, true);
});
