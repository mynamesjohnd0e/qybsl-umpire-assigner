// The Saturday rush: a burst of public sign-up traffic. 200 requests should all
// succeed, quickly — no errors, and well under the "a minute / a page a second"
// bar.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
H.setupEnv();

let app, shiftId;
before(async () => {
  app = await H.startApp();
  await app.ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '4321', name: 'John' });
  const sh = await app.ok('john', 'POST', '/api/admin/snack/shifts', { date: '2027-05-01', start: '9:00 AM', peopleNeeded: 250 });
  shiftId = sh.id;
});
after(() => app.close());

test('200 public requests all succeed, quickly', async () => {
  const N = 200;
  const start = Date.now();
  // A realistic mix: most people look at the page, some sign up.
  const reqs = Array.from({ length: N }, (_, i) =>
    i % 4 === 0
      ? fetch(`${app.base}/api/public/snack/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shiftId, name: `V${i}`, email: `v${i}@x.test`, mobile: '6175550000' }) })
      : fetch(`${app.base}/api/public/snack/shifts`));
  const results = await Promise.all(reqs);
  const elapsed = Date.now() - start;

  assert(results.every(r => r.status < 400), 'no request errored');
  assert(elapsed < 30000, `the burst finished in ${elapsed}ms (well under a minute)`);

  // Every sign-up that was accepted is real (no overselling past capacity).
  const filled = (await app.ok('john', 'GET', '/api/public/snack/shifts')).shifts.find(s => s.id === shiftId).filled;
  assert.strictEqual(filled, N / 4, 'exactly the sign-up requests took a spot');
});

test('a single page responds in well under a second', async () => {
  const t = Date.now();
  await fetch(`${app.base}/api/public/snack/shifts`);
  assert(Date.now() - t < 1000, 'a page comes back in under a second');
});
