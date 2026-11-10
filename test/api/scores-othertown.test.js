// Out-of-town games (e.g. Babe Ruth vs South Boston): our coach enters, but the
// score is final only once the division director approves it — it never
// auto-confirms, and only that division's director can approve.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
H.setupEnv();

let app;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => {
  H.reset(); app.clearJars();
  await app.ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '4321', name: 'John' });
  // A Babe Ruth team on our coach list; "South Boston" is deliberately NOT a
  // team record, which is what marks the game as out-of-town.
  await app.ok('john', 'POST', '/api/admin/roster/coaches',
    'name,email,team,division\nCoach BR,br@x.test,Quincy BR,Babe Ruth\n');
  await app.ok('br', 'POST', '/api/auth/signup', { role: 'coach', email: 'br@x.test', pin: '2222', name: 'Coach BR' });
  // A Babe Ruth director and a Farm 8 director.
  await app.ok('john', 'POST', '/api/admin/people', { role: 'director', email: 'brdir@x.test', name: 'BR Director', divisions: ['Babe Ruth'] });
  await app.ok('john', 'POST', '/api/admin/people', { role: 'director', email: 'f8dir@x.test', name: 'Farm Director', divisions: ['Farm 8'] });
  await app.ok('brdir', 'POST', '/api/auth/signup', { role: 'director', email: 'brdir@x.test', pin: '3333', name: 'BR Director' });
  await app.ok('f8dir', 'POST', '/api/auth/signup', { role: 'director', email: 'f8dir@x.test', pin: '3333', name: 'Farm Director' });
});

async function otherTownGame() {
  const start = new Date(Date.now() - 3 * 3600e3).toISOString();
  const { id } = await app.ok('john', 'POST', '/api/admin/games',
    { start, division: 'Babe Ruth', home: 'Quincy BR', away: 'South Boston', field: 'Adams Field' });
  return id;
}
const scoreOf = async id => (await app.ok('john', 'GET', '/api/admin/overview')).games.find(g => g.id === id).score;

test('our coach enters an out-of-town score; it waits for approval, not auto-confirm', async () => {
  const id = await otherTownGame();
  const sc = await app.ok('br', 'POST', '/api/coach/score', { gameId: id, homeRuns: 5, awayRuns: 3 });
  assert.strictEqual(sc.status, 'approval');
  assert.strictEqual(sc.otherTown, true);
  assert.strictEqual(sc.autoConfirmBy, null, 'no 24-hour clock on an out-of-town game');

  // Even long after 24 hours, it never auto-confirms.
  const n = await H.jobs().scoreAutoConfirm(new Date(Date.now() + 72 * 3600e3));
  assert.strictEqual(n, 0);
  assert.strictEqual((await scoreOf(id)).status, 'approval');
});

test('only the Babe Ruth director can approve it', async () => {
  const id = await otherTownGame();
  await app.ok('br', 'POST', '/api/coach/score', { gameId: id, homeRuns: 5, awayRuns: 3 });

  // The Farm director is refused.
  assert.strictEqual((await app.call('f8dir', 'POST', `/api/admin/games/${id}/score/approve`, {})).status, 403);
  assert.strictEqual((await scoreOf(id)).status, 'approval', 'still not final');

  // The Babe Ruth director approves.
  const sc = await app.ok('brdir', 'POST', `/api/admin/games/${id}/score/approve`, {});
  assert.strictEqual(sc.status, 'final');
  assert(sc.enteredInSE === false);
  assert((await app.ok('brdir', 'GET', '/api/admin/enter-se')).list.some(x => x.id === id), 'now on the BR director\'s enter-in-SE list');
});

test('an away-town coach has no app account, so nobody can confirm it in-app', async () => {
  const id = await otherTownGame();
  await app.ok('br', 'POST', '/api/coach/score', { gameId: id, homeRuns: 5, awayRuns: 3 });
  // Our coach is the home side, and the away town has no account — so there is
  // no in-app confirm path; only the director's approval makes it final.
  await app.fails(/can't confirm their own/, 'br', 'POST', '/api/coach/score/confirm', { gameId: id, homeRuns: 5, awayRuns: 3 });
});
