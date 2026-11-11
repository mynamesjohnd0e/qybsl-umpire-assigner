// Pre-game eligibility for both teams, violation alerts to the division (Cal
// Ripken) director (one per problem), the weekly 12-year-old cap, the director
// dashboard, and read-only access for the opposing coach.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
const { etDateKey, addDaysToKey, etDayStart } = require('../../lib/time');
H.setupEnv();

let app, players;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => {
  H.reset(); app.clearJars();
  await app.ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '4321', name: 'John' });
  await app.ok('john', 'POST', '/api/admin/roster/coaches',
    'name,email,team,division\nCoach Q,q@x.test,QCARE,Minors\nCoach S,s@x.test,SINC,Minors\n');
  await app.ok('q', 'POST', '/api/auth/signup', { role: 'coach', email: 'q@x.test', pin: '2222', name: 'Coach Q' });
  await app.ok('s', 'POST', '/api/auth/signup', { role: 'coach', email: 's@x.test', pin: '2222', name: 'Coach S' });
  // The Cal Ripken (Minors) director, plus a Farm director who should hear nothing.
  await app.ok('john', 'POST', '/api/admin/people', { role: 'director', email: 'mdir@x.test', name: 'Minors Dir', divisions: ['Minors'] });
  await app.ok('john', 'POST', '/api/admin/people', { role: 'director', email: 'fdir@x.test', name: 'Farm Dir', divisions: ['Farm 8'] });
  await app.ok('mdir', 'POST', '/api/auth/signup', { role: 'director', email: 'mdir@x.test', pin: '3333', name: 'Minors Dir' });
  await app.ok('john', 'POST', '/api/admin/roster/players',
    'name,number,birthdate,team,division\n' +
    'Sam Q,12,2016-06-15,QCARE,Minors\n' +   // age 10
    'Pat Q,7,2014-06-15,QCARE,Minors\n' +    // age 12 (logs outs)
    'Rey S,9,2015-06-15,SINC,Minors\n');     // age 11, other team
  players = Object.fromEntries((await app.ok('john', 'GET', '/api/admin/players')).players.map(p => [p.name, p]));
});

async function pastGame(home = 'QCARE', away = 'SINC', hoursAgo = 3) {
  const start = new Date(Date.now() - hoursAgo * 3600e3).toISOString();
  const { id } = await app.ok('john', 'POST', '/api/admin/games', { start, division: 'Minors', home, away, field: 'Quarry Hills Field A' });
  return id;
}
const pitchDaily = async () => (await H.outbox()).filter(m => m.kind === 'pitch-daily');
const pitchWeekly = async () => (await H.outbox()).filter(m => m.kind === 'pitch-weekly');

test('pre-game eligibility shows both teams; the opposing coach can see it', async () => {
  const id = await pastGame();
  await app.ok('q', 'POST', '/api/coach/pitches', { gameId: id, playerId: players['Sam Q'].id, pitches: 66 });
  // The away coach (SINC) can read the home team's pitchers.
  const elig = await app.ok('s', 'GET', `/api/games/${id}/eligibility`);
  assert.deepStrictEqual(elig.home.pitchers.map(p => p.name).sort(), ['Pat Q', 'Sam Q']);
  assert.deepStrictEqual(elig.away.pitchers.map(p => p.name), ['Rey S']);
  const sam = elig.home.pitchers.find(p => p.name === 'Sam Q');
  assert.strictEqual(sam.pitchedToday, 66);
});

test('the screen agrees with the engine for a given pitcher', async () => {
  const id = await pastGame();
  await app.ok('q', 'POST', '/api/coach/pitches', { gameId: id, playerId: players['Sam Q'].id, pitches: 40 });
  const date = etDateKey(new Date());
  const fromScreen = (await app.ok('q', 'GET', `/api/games/${id}/eligibility`)).home.pitchers.find(p => p.name === 'Sam Q');
  const fromEngine = await app.ok('q', 'GET', `/api/pitching/eligibility?playerId=${encodeURIComponent(players['Sam Q'].id)}&date=${date}`);
  assert.strictEqual(fromScreen.available, fromEngine.available);
  assert.strictEqual(fromScreen.pitchesLeftToday, fromEngine.pitchesLeftToday);
  assert.strictEqual(fromScreen.restingUntil, fromEngine.restingUntil);
});

test('the opposing coach can look but cannot change the other team\'s logs', async () => {
  const id = await pastGame();
  await app.ok('s', 'GET', `/api/games/${id}/eligibility`); // allowed
  await app.fails(/your own team/, 's', 'POST', '/api/coach/pitches', { gameId: id, playerId: players['Sam Q'].id, pitches: 10 });
});

test('a violation emails the Cal Ripken director once per problem, and clears when corrected', async () => {
  const id = await pastGame();
  // Over the 75 max by more than the tolerance → a violation.
  const r1 = await app.ok('q', 'POST', '/api/coach/pitches', { gameId: id, playerId: players['Sam Q'].id, pitches: 100 });
  assert.strictEqual(r1.check.status, 'violation');
  assert.strictEqual((await pitchDaily()).filter(m => m.to === 'mdir@x.test').length, 1, 'the Minors director is emailed once');
  assert.strictEqual((await pitchDaily()).filter(m => m.to === 'fdir@x.test').length, 0, 'the Farm director is not');

  // Editing it, still over → no second email.
  await app.ok('q', 'POST', '/api/coach/pitches', { gameId: id, playerId: players['Sam Q'].id, pitches: 110 });
  assert.strictEqual((await pitchDaily()).length, 1, 'still just one email for the one problem');

  // Correcting below the max clears the flag.
  await app.ok('q', 'POST', '/api/coach/pitches', { gameId: id, playerId: players['Sam Q'].id, pitches: 50 });
  const viol = (await app.ok('mdir', 'GET', '/api/admin/pitching/violations')).violations;
  assert.strictEqual(viol.length, 0, 'the violation cleared once the count was corrected');
});

test('an over-limit count still saves (warn, never block)', async () => {
  const id = await pastGame();
  await app.ok('q', 'POST', '/api/coach/pitches', { gameId: id, playerId: players['Sam Q'].id, pitches: 100 });
  const log = (await app.ok('john', 'GET', `/api/admin/games/${id}/pitchlog`)).log;
  const line = log.find(l => l.playerName === 'Sam Q');
  assert.strictEqual(line.pitches, 100, 'saved as entered');
  assert.strictEqual(line.violation, true, 'and shown as a violation');
});

test('the 12-year-old weekly innings cap alerts the director when the team goes over', async () => {
  const g1 = await pastGame('QCARE', 'SINC', 4);
  const g2 = await pastGame('QCARE', 'HERITAGE', 2); // same week
  // Pat Q (12) throws 6 + 7 innings = 13 innings (39 outs) > the 12-inning cap.
  await app.ok('q', 'POST', '/api/coach/pitches', { gameId: g1, playerId: players['Pat Q'].id, pitches: 40, outs: 18 });
  const r2 = await app.ok('q', 'POST', '/api/coach/pitches', { gameId: g2, playerId: players['Pat Q'].id, pitches: 40, outs: 21 });
  assert.strictEqual(r2.weekly.over, true);
  const weekly = (await pitchWeekly()).filter(m => m.to === 'mdir@x.test');
  assert.strictEqual(weekly.length, 1, 'one weekly-cap email to the Minors director');
});

test('the director dashboard is scoped to their division', async () => {
  const id = await pastGame();
  await app.ok('q', 'POST', '/api/coach/pitches', { gameId: id, playerId: players['Sam Q'].id, pitches: 100 });
  // The Minors director sees the violation.
  assert.strictEqual((await app.ok('mdir', 'GET', '/api/admin/pitching/violations')).violations.length, 1);
  // A Farm director sees none of it.
  await app.ok('fdir', 'POST', '/api/auth/signup', { role: 'director', email: 'fdir@x.test', pin: '3333', name: 'Farm Dir' });
  assert.strictEqual((await app.ok('fdir', 'GET', '/api/admin/pitching/violations')).violations.length, 0);
});

test('coaches are nudged when pitch counts are not in within 24 hours, then not', async () => {
  const old = await pastGame('QCARE', 'SINC', 30); // yesterday, no log
  const s = await H.settings().getSettings();
  const now = new Date(etDayStart(etDateKey(new Date())).getTime() + s.pitchLogNudgeHour * 3600e3);
  const sent = await H.jobs().pitchLogNudges(now, s, {});
  assert(sent >= 1, 'at least one coach nudged');
  const qBefore = (await H.outbox()).filter(m => m.kind === 'pitch-nudge' && m.to === 'q@x.test').length;
  assert(qBefore >= 1, 'the QCARE coach was nudged');

  // Once QCARE logs its pitchers, that coach is no longer nudged for the game.
  await app.ok('q', 'POST', '/api/coach/pitches', { gameId: old, playerId: players['Sam Q'].id, pitches: 20 });
  await H.jobs().pitchLogNudges(now, s, {});
  const qAfter = (await H.outbox()).filter(m => m.kind === 'pitch-nudge' && m.to === 'q@x.test').length;
  assert.strictEqual(qAfter, qBefore, 'no further nudge to the coach who logged');
});

test('pitch history carries into the playoffs', async () => {
  const reg = await pastGame('QCARE', 'SINC', 30); // a regular-season game, yesterday
  await app.ok('q', 'POST', '/api/coach/pitches', { gameId: reg, playerId: players['Sam Q'].id, pitches: 66 });
  // A playoff game today: the same pitcher is still resting.
  const playoff = await pastGame('QCARE', 'SINC', 2);
  const elig = await app.ok('q', 'GET', `/api/games/${playoff}/eligibility`);
  const sam = elig.home.pitchers.find(p => p.name === 'Sam Q');
  assert.strictEqual(sam.available, false, 'yesterday\'s 66 pitches still rest him today');
});
