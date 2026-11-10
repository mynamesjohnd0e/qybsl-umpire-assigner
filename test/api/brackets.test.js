// Playoff brackets end to end: seeding, higher-seed-home, a full Majors double
// elimination playing out from real game results, and director scoping.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const H = require('../helpers');
H.setupEnv();

const FIXTURE = fs.readFileSync(path.join(__dirname, '../fixtures/2026-farm-schedule-export.csv'), 'utf8');
const MAJORS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];

let app;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => {
  H.reset(); app.clearJars();
  await app.ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '4321', name: 'John' });
});

const getBracket = div => app.ok('john', 'GET', `/api/admin/bracket?division=${encodeURIComponent(div)}`);

// Create a final playoff game with the home (higher) seed winning.
async function playGame(division, home, away) {
  const start = new Date(Date.now() - 3 * 3600e3).toISOString();
  const { id } = await app.ok('john', 'POST', '/api/admin/games', { division, home, away, start });
  await app.ok('john', 'POST', `/api/admin/games/${id}/score/settle`, { homeRuns: 5, awayRuns: 3 });
}

test('Majors seeds into a 6-team double-elimination, higher seed home', async () => {
  await app.ok('john', 'POST', '/api/admin/bracket/seeds', { division: 'Majors', order: MAJORS });
  const bk = await getBracket('Majors');
  assert.strictEqual(bk.format, 'double');
  const r1 = bk.matches.filter(m => m.bracket === 'W' && m.round === 1);
  assert.deepStrictEqual(r1.map(m => `${m.home}v${m.away}`).sort(), ['M3vM6', 'M4vM5'].sort());
  for (const m of bk.matches) if (m.home && m.away) assert(bk.seeds.indexOf(m.home) < bk.seeds.indexOf(m.away), 'higher seed is home');
});

test('a full Majors bracket plays out to the top seed, with an if-needed-final slot', async () => {
  await app.ok('john', 'POST', '/api/admin/bracket/seeds', { division: 'Majors', order: MAJORS });
  let guard = 0;
  while (guard++ < 30) {
    const bk = await getBracket('Majors');
    if (bk.complete) break;
    const ready = bk.matches.filter(m => m.ready);
    if (!ready.length) break;
    for (const m of ready) await playGame('Majors', m.home, m.away);
  }
  const bk = await getBracket('Majors');
  assert.strictEqual(bk.complete, true, 'the bracket finished');
  assert.strictEqual(bk.champion, 'M1', 'the top seed wins when the higher seed always wins');
  // GF2 is present as a slot but was not needed (the winners-bracket team won GF1).
  assert(bk.matches.some(m => m.id === 'GF2'), 'the if-needed final is in the bracket');
  assert.strictEqual(bk.matches.find(m => m.id === 'GF2').needed, false);
  // Every team appears somewhere.
  const seen = new Set(bk.matches.flatMap(m => [m.home, m.away]).filter(Boolean));
  for (const t of MAJORS) assert(seen.has(t), `${t} appears in the bracket`);
});

test('Minors seeds from the standings into a single-elimination bracket', async () => {
  // Give Minors a tiny season so the standings, and thus the seeds, are real.
  const games = [['A', 'B', 5, 1], ['A', 'C', 5, 1], ['A', 'D', 5, 1], ['B', 'C', 5, 1], ['B', 'D', 5, 1], ['C', 'D', 5, 1], ['E', 'A', 0, 9], ['E', 'B', 0, 9]];
  for (const [h, a, hr, ar] of games) {
    const start = new Date(Date.now() - 3 * 3600e3).toISOString();
    const { id } = await app.ok('john', 'POST', '/api/admin/games', { division: 'Minors', home: h, away: a, start });
    await app.ok('john', 'POST', `/api/admin/games/${id}/score/settle`, { homeRuns: hr, awayRuns: ar });
  }
  const bk = await getBracket('Minors');
  assert.strictEqual(bk.format, 'single');
  assert.strictEqual(bk.seeds.length, 5, 'all five teams qualify');
  const byes = bk.matches.filter(m => m.bye);
  assert.strictEqual(byes.length, 3, 'the top three seeds get a bye');
  assert.strictEqual(bk.seeds[0], 'A', 'the best record is the top seed');
});

test('a director can see only their division\'s bracket', async () => {
  await app.ok('john', 'POST', '/api/admin/people', { role: 'director', email: 'f8@x.test', name: 'F8', divisions: ['Farm 8'] });
  await app.ok('f8', 'POST', '/api/auth/signup', { role: 'director', email: 'f8@x.test', pin: '3333', name: 'F8' });
  await app.ok('john', 'POST', '/api/admin/bracket/seeds', { division: 'Farm 8', order: ['X', 'Y'] });
  await app.ok('f8', 'GET', '/api/admin/bracket?division=Farm%208'); // allowed
  assert.strictEqual((await app.call('f8', 'GET', '/api/admin/bracket?division=Majors')).status, 403);
  assert.strictEqual((await app.call('f8', 'POST', '/api/admin/bracket/seeds', { division: 'Majors', order: ['X', 'Y'] })).status, 403);
});

test('the real 2026 schedule yields a single-elimination Farm 8 bracket with every team', async () => {
  await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: FIXTURE, filename: '2026.csv', season: 'Spring 2026' });
  const bk = await getBracket('Farm 8');
  assert.strictEqual(bk.format, 'single');
  assert(bk.seeds.length >= 6, 'the Farm 8 teams are seeded');
  // The seed order matches the standings order (best record first).
  const st = (await app.ok('john', 'GET', '/api/standings')).standings['Farm 8'];
  assert.deepStrictEqual(bk.seeds, st.map(r => r.team));
});
