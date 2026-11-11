// Sprint 9 · the one go-live rule that only shows on the real app: restore is
// barred on production. You can always read a backup and run the self-check, but
// writing one back only ever happens on the test copy — so a mis-click can never
// overwrite the live league. TEST_MODE is fixed when the server loads, so this
// lives in its own file with TEST_MODE off.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
H.setupEnv({ adminEmails: 'john@qybsl.test' }); // no testMode → the real app

let app;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => {
  H.reset(); app.clearJars();
  process.env.ADMIN_EMAILS = 'john@qybsl.test';
  await app.ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '1234', name: 'John' });
});

test('restore is refused on the real app, even for an admin', async () => {
  const saved = await app.ok('john', 'GET', '/api/admin/backup'); // reading is fine
  const r = await app.fails(/test copy/i, 'john', 'POST', '/api/admin/restore', saved);
  assert(/test copy/i.test(r.error), r.error);
});

test('backup and self-check still work on the real app', async () => {
  const saved = await app.ok('john', 'GET', '/api/admin/backup');
  assert(saved.collections.people, 'the backup captured the admin');
  const c = await app.ok('john', 'GET', '/api/admin/selfcheck');
  assert.strictEqual(c.adminConfigured, true);
  assert.strictEqual(c.storage, 'local');
});
