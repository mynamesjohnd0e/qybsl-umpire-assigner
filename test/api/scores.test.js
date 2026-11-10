// Scores, intra-league: the home coach enters, the away coach confirms or
// disputes, 24h auto-confirms, the director settles or forfeits, and confirmed
// scores land on the "enter in SE" list. Every move is checked allowed and
// refused, and the deadline is tested on both sides.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
const { etDayStart, etDateKey, addDaysToKey } = require('../../lib/time');
H.setupEnv();

let app, W;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => {
  H.reset(); app.clearJars(); W = await H.world(app);
  // Red Sox (home) and Yankees (away) coaches — both on the world's coach list.
  await app.ok('red', 'POST', '/api/auth/signup', { role: 'coach', email: 'red@x.test', pin: '2222', name: 'Coach Red' });
  await app.ok('yank', 'POST', '/api/auth/signup', { role: 'coach', email: 'yank@x.test', pin: '2222', name: 'Coach Yank' });
});

async function pastGame(hoursAgo = 3) {
  const start = new Date(Date.now() - hoursAgo * 3600e3).toISOString();
  const { id } = await app.ok('john', 'POST', '/api/admin/games',
    { start, division: 'Farm 8', home: 'Red Sox', away: 'Yankees', field: 'Quarry Hills Field A' });
  return id;
}
const scoreOf = async id => (await app.ok('john', 'GET', '/api/admin/overview')).games.find(g => g.id === id).score;

test('home enters, away confirms → final, and it lands on the enter-in-SE list', async () => {
  const id = await pastGame();
  const entered = await app.ok('red', 'POST', '/api/coach/score', { gameId: id, homeRuns: 7, awayRuns: 4 });
  assert.strictEqual(entered.status, 'entered');
  assert.strictEqual(entered.homeRuns, 7);
  const final = await app.ok('yank', 'POST', '/api/coach/score/confirm', { gameId: id, homeRuns: 7, awayRuns: 4 });
  assert.strictEqual(final.status, 'final');
  assert.strictEqual(final.confirmedHow, 'away');
  const list = (await app.ok('john', 'GET', '/api/admin/enter-se')).list;
  assert(list.some(x => x.id === id), 'the final score is on the enter-in-SE list');
});

test('the away coach cannot enter the score', async () => {
  const id = await pastGame();
  await app.fails(/home coach enters/, 'yank', 'POST', '/api/coach/score', { gameId: id, homeRuns: 1, awayRuns: 0 });
});

test('the home coach cannot confirm their own score', async () => {
  const id = await pastGame();
  await app.ok('red', 'POST', '/api/coach/score', { gameId: id, homeRuns: 3, awayRuns: 2 });
  await app.fails(/can't confirm their own/, 'red', 'POST', '/api/coach/score/confirm', { gameId: id, homeRuns: 3, awayRuns: 2 });
});

test('no score can be entered before the game starts', async () => {
  await app.fails(/once the game has started/, 'red', 'POST', '/api/coach/score', { gameId: W.games.redSox, homeRuns: 1, awayRuns: 0 });
});

test('no score can be entered on a cancelled game', async () => {
  const id = await pastGame();
  await app.ok('john', 'POST', `/api/admin/games/${id}/cancel`, {});
  await app.fails(/cancelled or rained out/, 'red', 'POST', '/api/coach/score', { gameId: id, homeRuns: 1, awayRuns: 0 });
});

test('the 24-hour line: no auto-confirm before it, confirmed just after', async () => {
  const id = await pastGame();
  const sc = await app.ok('red', 'POST', '/api/coach/score', { gameId: id, homeRuns: 5, awayRuns: 5 });
  const deadline = Date.parse(sc.autoConfirmBy);
  assert.strictEqual(await H.jobs().scoreAutoConfirm(new Date(deadline - 60e3)), 0, 'not before the deadline');
  assert.strictEqual((await scoreOf(id)).status, 'entered');
  assert.strictEqual(await H.jobs().scoreAutoConfirm(new Date(deadline + 60e3)), 1, 'confirmed just after');
  const after = await scoreOf(id);
  assert.strictEqual(after.status, 'final');
  assert.strictEqual(after.confirmedHow, 'auto');
});

test('a dispute stops the auto-confirm for good', async () => {
  const id = await pastGame();
  const sc = await app.ok('red', 'POST', '/api/coach/score', { gameId: id, homeRuns: 2, awayRuns: 1 });
  await app.ok('yank', 'POST', '/api/coach/score/dispute', { gameId: id, note: 'we had 2' });
  assert.strictEqual((await scoreOf(id)).status, 'disputed');
  const n = await H.jobs().scoreAutoConfirm(new Date(Date.parse(sc.autoConfirmBy) + 60e3));
  assert.strictEqual(n, 0, 'a disputed score never auto-confirms');
  assert.strictEqual((await scoreOf(id)).status, 'disputed');
});

test('a simultaneous away-confirm and home-correction keeps the version the away coach saw', async () => {
  const id = await pastGame();
  await app.ok('red', 'POST', '/api/coach/score', { gameId: id, homeRuns: 7, awayRuns: 4 });
  // Home corrects to 8–4 at the same moment the away coach confirms the 7–4 they saw.
  await Promise.allSettled([
    app.call('red', 'POST', '/api/coach/score', { gameId: id, homeRuns: 8, awayRuns: 4 }),
    app.call('yank', 'POST', '/api/coach/score/confirm', { gameId: id, homeRuns: 7, awayRuns: 4 })
  ]);
  const sc = await scoreOf(id);
  assert.strictEqual(sc.status, 'final');
  assert.strictEqual(sc.homeRuns, 7, 'the away-seen 7 is final, not the 8 home tried to correct to');
  assert.strictEqual(sc.awayRuns, 4);
});

test('a director settles a dispute, and only a director changes a final score', async () => {
  const id = await pastGame();
  await app.ok('red', 'POST', '/api/coach/score', { gameId: id, homeRuns: 7, awayRuns: 4 });
  await app.ok('yank', 'POST', '/api/coach/score/dispute', { gameId: id, note: 'actually 6-5' });
  await app.ok('john', 'POST', `/api/admin/games/${id}/score/settle`, { homeRuns: 6, awayRuns: 5 });
  const sc = await scoreOf(id);
  assert.strictEqual(sc.status, 'final');
  assert.strictEqual(sc.homeRuns, 6);
  // The home coach can no longer change it.
  await app.fails(/final/, 'red', 'POST', '/api/coach/score', { gameId: id, homeRuns: 9, awayRuns: 0 });
});

test('a forfeit is 6–0 to the winning side', async () => {
  const id = await pastGame();
  await app.ok('john', 'POST', `/api/admin/games/${id}/score/forfeit`, { winner: 'home' });
  const sc = await scoreOf(id);
  assert.strictEqual(sc.status, 'final');
  assert.strictEqual(sc.forfeit, true);
  assert.deepStrictEqual([sc.homeRuns, sc.awayRuns], [6, 0]);
});

test('marking a game entered in SportsEngine drops it from the list', async () => {
  const id = await pastGame();
  await app.ok('red', 'POST', '/api/coach/score', { gameId: id, homeRuns: 3, awayRuns: 2 });
  await app.ok('yank', 'POST', '/api/coach/score/confirm', { gameId: id, homeRuns: 3, awayRuns: 2 });
  assert((await app.ok('john', 'GET', '/api/admin/enter-se')).list.some(x => x.id === id));
  await app.ok('john', 'POST', `/api/admin/games/${id}/score/entered-se`, {});
  assert(!(await app.ok('john', 'GET', '/api/admin/enter-se')).list.some(x => x.id === id), 'gone once entered in SE');
});

test('a director can enter a score for a coach who can\'t, and the away coach still confirms', async () => {
  const id = await pastGame();
  const sc = await app.ok('john', 'POST', `/api/admin/games/${id}/score/enter`, { homeRuns: 3, awayRuns: 2 });
  assert.strictEqual(sc.status, 'entered');
  assert.strictEqual(sc.enteredByRole, 'director');
  const final = await app.ok('yank', 'POST', '/api/coach/score/confirm', { gameId: id, homeRuns: 3, awayRuns: 2 });
  assert.strictEqual(final.status, 'final');
});

test('a dispute reaches only that division\'s director, and no family address', async () => {
  // A Farm 8 director and a Farm 9 director.
  for (const [jar, email, div] of [['f8', 'f8dir@x.test', 'Farm 8'], ['f9', 'f9dir@x.test', 'Farm 9']]) {
    await app.ok('john', 'POST', '/api/admin/people', { role: 'director', email, name: email, divisions: [div] });
  }
  const id = await pastGame();
  await app.ok('red', 'POST', '/api/coach/score', { gameId: id, homeRuns: 7, awayRuns: 4 });
  await app.ok('yank', 'POST', '/api/coach/score/dispute', { gameId: id, note: 'disagree' });
  const disputes = (await H.outbox()).filter(m => m.kind === 'score-dispute');
  assert(disputes.some(m => m.to === 'f8dir@x.test'), 'the Farm 8 director is told');
  assert(!disputes.some(m => m.to === 'f9dir@x.test'), 'the Farm 9 director is not');
  // No parent/family address anywhere in the outbox.
  assert(!(await H.outbox()).some(m => m.to === 'p@x.test'), 'no umpire-parent copy on score messages');
});

test('a full slate of games ends with every score final and on the enter-in-SE list', async () => {
  // One game goes the full coach route (enter → away confirm); the rest are
  // entered by the director and auto-confirm after 24 hours. All end final.
  const coachGame = await pastGame();
  await app.ok('red', 'POST', '/api/coach/score', { gameId: coachGame, homeRuns: 7, awayRuns: 4 });
  await app.ok('yank', 'POST', '/api/coach/score/confirm', { gameId: coachGame, homeRuns: 7, awayRuns: 4 });

  const dirGames = [];
  for (const [home, away] of [['Bolton', 'Bucks'], ['Heritage', 'Noel'], ['Quincy Lock', 'Sea Street']]) {
    const start = new Date(Date.now() - 3 * 3600e3).toISOString();
    const { id } = await app.ok('john', 'POST', '/api/admin/games', { start, division: 'Farm 8', home, away, field: 'Quarry Hills Field A' });
    await app.ok('john', 'POST', `/api/admin/games/${id}/score/enter`, { homeRuns: 3, awayRuns: 2 });
    dirGames.push(id);
  }
  // 24h later, the director-entered games auto-confirm.
  await H.jobs().scoreAutoConfirm(new Date(Date.now() + 25 * 3600e3));

  const ov = await app.ok('john', 'GET', '/api/admin/overview');
  for (const id of [coachGame, ...dirGames]) {
    assert.strictEqual(ov.games.find(g => g.id === id).score.status, 'final', `game ${id} is final`);
  }
  const list = (await app.ok('john', 'GET', '/api/admin/enter-se')).list;
  for (const id of [coachGame, ...dirGames]) assert(list.some(x => x.id === id), `game ${id} on the enter-in-SE list`);
});

test('home coaches are nudged nightly until a score is entered, then never', async () => {
  const yesterday = new Date(etDayStart(addDaysToKey(etDateKey(new Date()), -1)).getTime() + 12 * 3600e3).toISOString();
  const { id } = await app.ok('john', 'POST', '/api/admin/games', { start: yesterday, division: 'Farm 8', home: 'Red Sox', away: 'Yankees', field: 'Quarry Hills Field A' });
  const s = await H.settings().getSettings();
  const now = new Date(etDayStart(etDateKey(new Date())).getTime() + s.scoreNudgeHour * 3600e3); // today, nudge hour
  const sent = await H.jobs().scoreNudges(now, s, {});
  assert(sent >= 1, 'the home coach is nudged');
  assert((await H.outbox()).some(m => m.kind === 'score-nudge' && m.to === 'red@x.test'), 'nudge went to the Red Sox coach');
  // Enter the score, then a later nudge skips this game.
  await app.ok('red', 'POST', '/api/coach/score', { gameId: id, homeRuns: 1, awayRuns: 0 });
  assert.strictEqual(await H.jobs().scoreNudges(now, s, {}), 0, 'no nudge once the score is in');
});
