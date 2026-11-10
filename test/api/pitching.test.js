// Pitch logging end to end: a coach logs their own pitchers, a director can log
// for a coach, eligibility reflects the outings, two games in a day combine, and
// 12-year-olds log innings as outs. Logging warns but never blocks.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
const { etDateKey, addDaysToKey } = require('../../lib/time');
H.setupEnv();

let app, players;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => {
  H.reset(); app.clearJars();
  await app.ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '4321', name: 'John' });
  await app.ok('john', 'POST', '/api/admin/roster/coaches', 'name,email,team,division\nCoach Q,q@x.test,QCARE,Minors\n');
  await app.ok('q', 'POST', '/api/auth/signup', { role: 'coach', email: 'q@x.test', pin: '2222', name: 'Coach Q' });
  await app.ok('john', 'POST', '/api/admin/roster/players',
    'name,number,birthdate,team,division\n' +
    'Sam Q,12,2016-06-15,QCARE,Minors\n' +  // age 10 → daily max 75
    'Pat Q,7,2014-06-15,QCARE,Minors\n' +   // age 12 → logs innings (outs)
    'Alex S,3,2015-06-15,SINC,Minors\n');   // other team
  players = Object.fromEntries((await app.ok('john', 'GET', '/api/admin/players')).players.map(p => [p.name, p]));
});

async function pastGame(home = 'QCARE', away = 'SINC', hoursAgo = 3) {
  const start = new Date(Date.now() - hoursAgo * 3600e3).toISOString();
  const { id } = await app.ok('john', 'POST', '/api/admin/games', { start, division: 'Minors', home, away, field: 'Quarry Hills Field A' });
  return id;
}

test('a coach logs their own pitcher and gets the engine\'s check', async () => {
  const id = await pastGame();
  const r = await app.ok('q', 'POST', '/api/coach/pitches', { gameId: id, playerId: players['Sam Q'].id, pitches: 40 });
  assert.strictEqual(r.entry.pitches, 40);
  assert.strictEqual(r.entry.leagueAge, 10);
  assert.strictEqual(r.check.status, 'ok');
});

test('a coach cannot log another team\'s player', async () => {
  const id = await pastGame();
  await app.fails(/your own team/, 'q', 'POST', '/api/coach/pitches', { gameId: id, playerId: players['Alex S'].id, pitches: 10 });
});

test('a count over the max is warned but still saved (never blocked)', async () => {
  const id = await pastGame();
  const warn = await app.ok('q', 'POST', '/api/coach/pitches', { gameId: id, playerId: players['Sam Q'].id, pitches: 80 });
  assert.strictEqual(warn.check.status, 'check-finished-batter', 'over the 75 max by a little');
  const viol = await app.ok('q', 'POST', '/api/coach/pitches', { gameId: id, playerId: players['Sam Q'].id, pitches: 100 });
  assert.strictEqual(viol.check.status, 'violation');
  // The last count is stored regardless (warn and report, never block).
  const log = (await app.ok('john', 'GET', `/api/admin/games/${id}/pitchlog`)).log;
  assert.strictEqual(log.find(l => l.playerName === 'Sam Q').pitches, 100);
});

test('eligibility reflects a logged outing: 66 pitches → resting the next day', async () => {
  const id = await pastGame();
  await app.ok('q', 'POST', '/api/coach/pitches', { gameId: id, playerId: players['Sam Q'].id, pitches: 66 });
  const today = etDateKey(new Date());
  const tomorrow = addDaysToKey(today, 1);
  const elig = await app.ok('q', 'GET', `/api/pitching/eligibility?playerId=${encodeURIComponent(players['Sam Q'].id)}&date=${tomorrow}`);
  assert.strictEqual(elig.available, false, 'resting the day after a 66-pitch outing');
  assert(elig.restingUntil > today, 'resting until a future day');
  // Same day, before more pitches: 75 max − 66 = 9 left.
  const todayElig = await app.ok('q', 'GET', `/api/pitching/eligibility?playerId=${encodeURIComponent(players['Sam Q'].id)}&date=${today}`);
  assert.strictEqual(todayElig.pitchesLeftToday, 9);
});

test('two games in a day combine for rest', async () => {
  const g1 = await pastGame('QCARE', 'SINC', 4);
  const g2 = await pastGame('QCARE', 'HERITAGE', 2); // same calendar day
  await app.ok('q', 'POST', '/api/coach/pitches', { gameId: g1, playerId: players['Sam Q'].id, pitches: 40 });
  await app.ok('q', 'POST', '/api/coach/pitches', { gameId: g2, playerId: players['Sam Q'].id, pitches: 40 });
  const tomorrow = addDaysToKey(etDateKey(new Date()), 1);
  const elig = await app.ok('q', 'GET', `/api/pitching/eligibility?playerId=${encodeURIComponent(players['Sam Q'].id)}&date=${tomorrow}`);
  assert.strictEqual(elig.available, false, '80 for the day means 4 days of rest');
});

test('a 12-year-old logs innings as outs; a younger player does not', async () => {
  const id = await pastGame();
  const twelve = await app.ok('q', 'POST', '/api/coach/pitches', { gameId: id, playerId: players['Pat Q'].id, pitches: 50, outs: 7 });
  assert.strictEqual(twelve.entry.leagueAge, 12);
  assert.strictEqual(twelve.entry.outs, 7, '12-year-old innings stored as outs');
  const ten = await app.ok('q', 'POST', '/api/coach/pitches', { gameId: id, playerId: players['Sam Q'].id, pitches: 50, outs: 7 });
  assert.strictEqual(ten.entry.outs, null, 'younger players do not log innings');
});

test('a director can log for a coach, scoped to their division', async () => {
  const id = await pastGame();
  // A Farm 8 director cannot log a Minors game.
  await app.ok('john', 'POST', '/api/admin/people', { role: 'director', email: 'f8@x.test', name: 'F8', divisions: ['Farm 8'] });
  await app.ok('f8', 'POST', '/api/auth/signup', { role: 'director', email: 'f8@x.test', pin: '3333', name: 'F8' });
  assert.strictEqual((await app.call('f8', 'POST', `/api/admin/games/${id}/pitches`, { playerId: players['Sam Q'].id, pitches: 20 })).status, 403);
  // The admin (manages every division) can log for the coach.
  const r = await app.ok('john', 'POST', `/api/admin/games/${id}/pitches`, { playerId: players['Alex S'].id, pitches: 20 });
  assert.strictEqual(r.entry.pitches, 20, 'a director/admin may log any player');
});

test('pitches cannot be logged before the game starts', async () => {
  const start = new Date(Date.now() + 3 * 3600e3).toISOString();
  const { id } = await app.ok('john', 'POST', '/api/admin/games', { start, division: 'Minors', home: 'QCARE', away: 'SINC' });
  await app.fails(/once the game has started/, 'q', 'POST', '/api/coach/pitches', { gameId: id, playerId: players['Sam Q'].id, pitches: 10 });
});
