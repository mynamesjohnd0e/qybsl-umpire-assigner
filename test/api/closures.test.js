// Field closures and rainouts: which games are taken out (half-open time
// window), exactly who hears, that a rained-out game is gone everywhere, and that
// reopening restores the games and tells the same people.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
const { zonedToUtc } = require('../../lib/time');
H.setupEnv();

const et = (h, m = 0) => zonedToUtc(2027, 5, 1, h, m).toISOString(); // Sat May 1 2027, Eastern
const umpBody = (email, name, parentEmail) => ({
  role: 'umpire', email, pin: '1111', name, mobile: '6175559999',
  parentName: 'P', parentEmail, parentMobile: '6175558888', venmo: 'v'
});

let app;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => {
  H.reset(); app.clearJars();
  await app.ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '4321', name: 'John' });
  await app.ok('john', 'PUT', '/api/admin/settings', { commsDirectorEmail: 'comms@x.test', directorEmail: 'dir@x.test' });
  await app.ok('john', 'POST', '/api/admin/roster/umpires', 'Name,Email\nAlice,alice@x.test\nBob,bob@x.test\n');
  await app.ok('john', 'POST', '/api/admin/roster/coaches', 'name,email,team,division\nCoach Red,red@x.test,Red Sox,Farm 8\nCoach Yank,yank@x.test,Yankees,Farm 8\n');
  await app.ok('alice', 'POST', '/api/auth/signup', umpBody('alice@x.test', 'Alice', 'pa@x.test'));
  await app.ok('bob', 'POST', '/api/auth/signup', umpBody('bob@x.test', 'Bob', 'pb@x.test'));
});

async function game(field, start, end, home = 'Red Sox', away = 'Yankees') {
  const { id } = await app.ok('john', 'POST', '/api/admin/games', { division: 'Farm 8', home, away, field, start, end });
  return id;
}
const statusOf = async id => (await app.ok('john', 'GET', '/api/admin/overview')).games.find(g => g.id === id).status;

test('a window takes out an overlapping game and leaves one ending exactly as it starts', async () => {
  const over = await game('Quarry Hills - Field A', et(8, 30), et(10, 30));  // 8:30–10:30, overlaps 9–3
  const edge = await game('Quarry Hills - Field A', et(7, 0), et(9, 0));     // ends exactly at 9:00
  const otherField = await game('Quarry Hills - Field B', et(8, 30), et(10, 30));
  const r = await app.ok('john', 'POST', '/api/admin/closures', { fields: ['Field A'], from: et(9, 0), to: et(15, 0), reason: 'rain' });
  assert.strictEqual(r.affected, 1);
  assert.strictEqual(await statusOf(over), 'rainout');
  assert.strictEqual(await statusOf(edge), 'scheduled', 'a game ending exactly at the window start is untouched');
  assert.strictEqual(await statusOf(otherField), 'scheduled', 'a game on another field is untouched');
});

test('closing all of Quarry Hills for a day takes every field', async () => {
  const a = await game('Quarry Hills - Field A', et(10), et(12));
  const b = await game('Quarry Hills - Field C', et(13), et(15));
  const r = await app.ok('john', 'POST', '/api/admin/closures', { all: true, date: '2027-05-01', reason: 'City Parks closure' });
  assert.strictEqual(r.affected, 2);
  assert.strictEqual(await statusOf(a), 'rainout');
  assert.strictEqual(await statusOf(b), 'rainout');
});

test('a rainout reaches both coaches, the umpires and their parents, and one comms note — nobody else', async () => {
  const id = await game('Quarry Hills - Field A', et(10), et(12));
  await app.ok('john', 'POST', `/api/admin/games/${id}/assign`, { slot: 'plate', umpireId: 'alice@x.test', force: true });
  await app.ok('john', 'POST', `/api/admin/games/${id}/assign`, { slot: 'field', umpireId: 'bob@x.test', force: true });
  await app.ok('john', 'POST', '/api/admin/closures', { all: true, date: '2027-05-01', reason: 'rain' });

  const out = await H.outbox();
  // Check email recipients (the umpires' and parents' own SMS numbers are theirs too).
  const to = new Set(out.filter(m => m.channel === 'email').map(m => m.to));
  for (const who of ['red@x.test', 'yank@x.test', 'alice@x.test', 'bob@x.test', 'pa@x.test', 'pb@x.test', 'comms@x.test']) {
    assert(to.has(who), `expected a message to ${who}`);
  }
  // No one outside that set (no stray family/director address — not even the
  // Director of Umpires, who is not messaged about rainouts).
  const allowed = new Set(['red@x.test', 'yank@x.test', 'alice@x.test', 'bob@x.test', 'pa@x.test', 'pb@x.test', 'comms@x.test']);
  for (const addr of to) assert(allowed.has(addr), `unexpected recipient ${addr}`);
  // Exactly one comms note listing the game.
  assert.strictEqual(out.filter(m => m.kind === 'comms-rainout').length, 1);
});

test('re-closing the same games sends nothing new', async () => {
  const id = await game('Quarry Hills - Field A', et(10), et(12));
  await app.ok('john', 'POST', '/api/admin/closures', { all: true, date: '2027-05-01', reason: 'rain' });
  const n1 = (await H.outbox()).length;
  const r2 = await app.ok('john', 'POST', '/api/admin/closures', { all: true, date: '2027-05-01', reason: 'still raining' });
  assert.strictEqual(r2.affected, 0, 'the game is already rained out');
  assert.strictEqual((await H.outbox()).length, n1, 'no new messages');
});

test('a rained-out game has no score or pitch prompt', async () => {
  const id = await game('Quarry Hills - Field A', et(10), et(12));
  await app.ok('john', 'POST', '/api/admin/closures', { all: true, date: '2027-05-01' });
  await app.ok('red', 'POST', '/api/auth/signup', { role: 'coach', email: 'red@x.test', pin: '2222', name: 'Coach Red' });
  await app.fails(/rained out/, 'red', 'POST', '/api/coach/score', { gameId: id, homeRuns: 5, awayRuns: 4 });
});

test('reopening restores the games and tells the same people', async () => {
  const id = await game('Quarry Hills - Field A', et(10), et(12));
  await app.ok('john', 'POST', `/api/admin/games/${id}/assign`, { slot: 'plate', umpireId: 'alice@x.test', force: true });
  const r = await app.ok('john', 'POST', '/api/admin/closures', { all: true, date: '2027-05-01', reason: 'rain' });
  // Reopen.
  const back = await app.ok('john', 'POST', `/api/admin/closures/${r.closureId}/reopen`, {});
  assert.strictEqual(back.restored, 1);
  assert.strictEqual(await statusOf(id), 'scheduled', 'the game is back on');
  const out = await H.outbox();
  assert(out.some(m => m.kind === 'reopened' && m.to === 'red@x.test'), 'the coach is told it is back on');
  assert(out.some(m => m.kind === 'reopened' && m.to === 'alice@x.test'), 'the umpire is told it is back on');
  assert.strictEqual(out.filter(m => m.kind === 'comms-reopen').length, 1, 'one comms note');
});

test('only a board admin can close fields', async () => {
  await app.ok('john', 'POST', '/api/admin/people', { role: 'director', email: 'd@x.test', name: 'D', divisions: ['Farm 8'] });
  await app.ok('d', 'POST', '/api/auth/signup', { role: 'director', email: 'd@x.test', pin: '3333', name: 'D' });
  assert.strictEqual((await app.call('d', 'POST', '/api/admin/closures', { all: true, date: '2027-05-01' })).status, 403);
});
