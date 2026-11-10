// Standings, end to end. The real 2026 Farm schedule is the oracle: the app's
// standings must match a separate, simpler calculation of the same scores, team
// by team, including runs allowed.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const H = require('../helpers');
const { parseSeCsv } = require('../../lib/secsv');
H.setupEnv();

const FIXTURE = fs.readFileSync(path.join(__dirname, '../fixtures/2026-farm-schedule-export.csv'), 'utf8');

// A deliberately simple, independent standings calc for the oracle, for one
// division (the fixture has both Farm 8 and Farm 9 games).
function independent(csvText, division) {
  const rec = {};
  const get = n => (rec[n] ||= { w: 0, l: 0, t: 0, rs: 0, ra: 0, gp: 0 });
  for (const e of parseSeCsv(csvText)) {
    if (!e.importedScore) continue;
    if (String(e.categories).toLowerCase() !== division.toLowerCase()) continue;
    const h = get(e.home), a = get(e.away), { homeRuns: hr, awayRuns: ar } = e.importedScore;
    h.gp++; a.gp++; h.rs += hr; a.rs += ar; h.ra += ar; a.ra += hr;
    if (hr > ar) { h.w++; a.l++; } else if (ar > hr) { a.w++; h.l++; } else { h.t++; a.t++; }
  }
  return rec;
}

let app;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => {
  H.reset(); app.clearJars();
  await app.ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '4321', name: 'John' });
});

test('the 2026 real scores reproduce the 2026 standings, team by team', async () => {
  const sync = await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: FIXTURE, filename: '2026.csv', season: 'Spring 2026' });
  assert(sync.counts.scored >= 90, 'the completed games imported their scores');

  const all = (await app.ok('john', 'GET', '/api/standings')).standings;
  assert(all['Farm 8'] && all['Farm 9'], 'both divisions appear');

  let totalTeams = 0;
  for (const division of Object.keys(all)) {
    const rows = all[division];
    const oracle = independent(FIXTURE, division);
    assert.strictEqual(rows.length, Object.keys(oracle).length, `team count for ${division}`);
    totalTeams += rows.length;
    for (const row of rows) {
      const ref = oracle[row.team];
      assert(ref, `oracle has ${row.team} in ${division}`);
      assert.deepStrictEqual(
        [row.wins, row.losses, row.ties, row.runsScored, row.runsAllowed],
        [ref.w, ref.l, ref.t, ref.rs, ref.ra],
        `record mismatch for ${row.team} in ${division}`
      );
      const pct = ref.gp ? Math.round(((ref.w + 0.5 * ref.t) / ref.gp) * 1000) / 1000 : 0;
      assert.strictEqual(row.winPct, pct, `win% mismatch for ${row.team} in ${division}`);
    }
  }
  assert(totalTeams >= 14, 'every team is standing somewhere');
});

test('the standings come back sorted best record first', async () => {
  await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: FIXTURE, filename: '2026.csv', season: 'Spring 2026' });
  const rows = (await app.ok('john', 'GET', '/api/standings')).standings['Farm 8'];
  for (let i = 1; i < rows.length; i++) {
    assert(rows[i - 1].winPct >= rows[i].winPct, 'win% never increases down the table');
    assert(rows[i - 1].rank <= rows[i].rank, 'ranks never decrease');
  }
});

test('coaches can see the standings; a guest cannot', async () => {
  await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: FIXTURE, filename: '2026.csv', season: 'Spring 2026' });
  await app.ok('john', 'POST', '/api/admin/roster/coaches', 'name,email,team,division\nCoach X,x@x.test,Some Team,Farm 8\n');
  await app.ok('x', 'POST', '/api/auth/signup', { role: 'coach', email: 'x@x.test', pin: '2222', name: 'Coach X' });
  const seen = (await app.ok('x', 'GET', '/api/standings')).standings;
  assert(seen['Farm 8']?.length > 0 && seen['Farm 9']?.length > 0, 'a coach sees the standings');
  assert.strictEqual((await app.call('guest', 'GET', '/api/standings')).status, 401);
});

test('only the division\'s director (or an admin) records a coin toss', async () => {
  await app.ok('john', 'POST', '/api/admin/people', { role: 'director', email: 'f8@x.test', name: 'F8 Dir', divisions: ['Farm 8'] });
  await app.ok('john', 'POST', '/api/admin/people', { role: 'director', email: 'f9@x.test', name: 'F9 Dir', divisions: ['Farm 9'] });
  await app.ok('f8', 'POST', '/api/auth/signup', { role: 'director', email: 'f8@x.test', pin: '3333', name: 'F8 Dir' });
  await app.ok('f9', 'POST', '/api/auth/signup', { role: 'director', email: 'f9@x.test', pin: '3333', name: 'F9 Dir' });

  await app.ok('f8', 'POST', '/api/admin/standings/coin-toss', { division: 'Farm 8', order: ['Team A', 'Team B'] });
  assert.strictEqual((await app.call('f9', 'POST', '/api/admin/standings/coin-toss', { division: 'Farm 8', order: ['Team A', 'Team B'] })).status, 403,
    'a Farm 9 director cannot record a Farm 8 coin toss');
});
