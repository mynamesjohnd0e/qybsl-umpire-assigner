// Payouts: only coach-confirmed "worked" games are paid; no-shows are held.
// Ported from flow.test.js.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
const { etDateKey, addDaysToKey } = require('../../lib/time');
H.setupEnv();

let app, W;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => { H.reset(); app.clearJars(); W = await H.world(app); });

// A finished game, confirmed: Alice worked, Bob was a no-show.
async function confirmedGame() {
  const start = new Date(Date.now() - 3 * 3600e3).toISOString();
  const { id } = await app.ok('john', 'POST', '/api/admin/games',
    { start, division: 'Farm 8', home: 'Red Sox', away: 'Yankees', field: 'Quarry Hills Field A' });
  await app.ok('john', 'POST', `/api/admin/games/${id}/assign`, { slot: 'plate', umpireId: 'alice@x.test', force: true });
  await app.ok('john', 'POST', `/api/admin/games/${id}/assign`, { slot: 'field', umpireId: 'bob@x.test', force: true });
  await app.ok('red', 'POST', '/api/auth/signup', { role: 'coach', email: 'red@x.test', pin: '2222', name: 'Coach Red' });
  await app.ok('red', 'POST', '/api/coach/confirm', { gameId: id, results: { plate: 'worked', field: 'noshow' } });
  return id;
}

const endKey = () => addDaysToKey(etDateKey(new Date()), 14);

test('only the worked spot is paid; the no-show is not', async () => {
  await confirmedGame();
  const pv = await app.ok('john', 'GET', `/api/admin/payouts/preview?end=${endKey()}`);
  assert.strictEqual(pv.lines.length, 1, 'one umpire to pay');
  assert.strictEqual(pv.lines[0].amount, 40);
  assert.strictEqual(pv.lines[0].venmo, '@v');
  assert.strictEqual(pv.lines[0].name, 'Alice Ump');
});

test('paying locks the games so they drop off the next preview', async () => {
  await confirmedGame();
  const end = endKey();
  await app.ok('john', 'POST', '/api/admin/payouts/pay', { end });
  const pv2 = await app.ok('john', 'GET', `/api/admin/payouts/preview?end=${end}`);
  assert.strictEqual(pv2.lines.length, 0);
});

test('the payout CSV has the expected header', async () => {
  await confirmedGame();
  const csv = await app.call('john', 'GET', `/api/admin/payouts/csv?end=${endKey()}`);
  assert(String(csv.data).startsWith('"Umpire"'), csv.data);
});

test('an umpire sees their own game marked Paid after a payout run', async () => {
  await confirmedGame();
  await app.ok('john', 'POST', '/api/admin/payouts/pay', { end: endKey() });
  const pay = (await app.ok('alice', 'GET', '/api/umpire/board')).pay;
  assert.strictEqual(pay[0].status, 'Paid');
});

test('there is nothing to pay before any game is confirmed', async () => {
  await app.fails(/Nothing to pay/, 'john', 'POST', '/api/admin/payouts/pay', { end: endKey() });
});
