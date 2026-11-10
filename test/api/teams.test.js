// Teams as records, built from the coach list and matched to the schedule's
// team names. The real 2026 Farm schedule is the oracle: all 14 of its teams
// must map to exactly one team, and a misspelled name must be reported.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const H = require('../helpers');
const { parseSeCsv } = require('../../lib/secsv');
H.setupEnv();

const FIXTURE = fs.readFileSync(path.join(__dirname, '../fixtures/2026-farm-schedule-export.csv'), 'utf8');
const fixtureTeams = [...new Set(parseSeCsv(FIXTURE).flatMap(e => [e.home, e.away]))];

let app;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => {
  H.reset(); app.clearJars();
  await app.ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '1234', name: 'John' });
});

test('the coach list creates a team record per team, with division and head coach', async () => {
  await app.ok('john', 'POST', '/api/admin/roster/coaches',
    'name,email,team,division\nCoach Red,red@x.test,Red Sox,Farm 8\nCoach Yank,yank@x.test,Yankees,Farm 8\n');
  const { teams, divisions } = await app.ok('john', 'GET', '/api/admin/teams');
  assert.strictEqual(teams.length, 2);
  const red = teams.find(t => t.name === 'Red Sox');
  assert.strictEqual(red.division, 'Farm 8');
  assert.strictEqual(red.headCoach, 'Coach Red');
  assert(divisions.includes('Farm 8') && divisions.includes('Majors'), 'the five divisions are known');
});

test('all 14 teams in the real 2026 schedule map to exactly one team', async () => {
  // Seed the 14 teams via the coach list (names spelled as the export has them).
  const coachCsv = 'name,email,team,division\n' +
    fixtureTeams.map((t, i) => `Coach ${i},coach${i}@x.test,"${t.replace(/"/g, '')}",Farm 8`).join('\n');
  await app.ok('john', 'POST', '/api/admin/roster/coaches', coachCsv);
  assert.strictEqual((await app.ok('john', 'GET', '/api/admin/teams')).teams.length, 14, 'exactly 14 team records');

  // Upload the real schedule; every team name should match a record.
  const r = await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: FIXTURE, filename: '2026.csv', season: 'Spring 2026' });
  assert.deepStrictEqual(r.unmatchedTeams, [], 'no unmatched teams: ' + JSON.stringify(r.unmatchedTeams));
});

test('the coach list covers all five divisions', async () => {
  const csv = 'name,email,team,division\n' +
    'C1,c1@x.test,Farm8 Team,Farm 8\n' +
    'C2,c2@x.test,Farm9 Team,Farm 9\n' +
    'C3,c3@x.test,Minors Team,Minors\n' +
    'C4,c4@x.test,Majors Team,Majors\n' +
    'C5,c5@x.test,BabeRuth Team,Babe Ruth\n';
  await app.ok('john', 'POST', '/api/admin/roster/coaches', csv);
  const { teams } = await app.ok('john', 'GET', '/api/admin/teams');
  const byDiv = Object.fromEntries(teams.map(t => [t.division, t.name]));
  for (const d of ['Farm 8', 'Farm 9', 'Minors', 'Majors', 'Babe Ruth']) {
    assert(byDiv[d], `a team exists in ${d}`);
  }
});

test('a misspelled team on the schedule is reported, never silently dropped', async () => {
  await app.ok('john', 'POST', '/api/admin/roster/coaches',
    'name,email,team,division\nCoach Red,red@x.test,Red Sox,Farm 8\nCoach Yank,yank@x.test,Yankees,Farm 8\n');
  const csv = [
    H.SE_HEAD,
    H.seRow(H.fut(3), '5:30 PM', 'FARM 8 > Red Sox', 'FARM 8 > Yankees', 'Quarry Hills - Field A > Quarry Hills - Field A'),
    H.seRow(H.fut(4), '5:30 PM', 'FARM 8 > Red Soxx', 'FARM 8 > Yankees', 'Quarry Hills - Field A > Quarry Hills - Field A')
  ].join('\n');
  const r = await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: csv, filename: 's.csv', season: 'Spring 2027' });
  assert(r.unmatchedTeams.includes('Red Soxx'), 'the misspelled team is reported: ' + JSON.stringify(r.unmatchedTeams));
  assert(!r.unmatchedTeams.includes('Red Sox'), 'the correctly spelled team is not');
  assert(r.warnings.some(w => /Red Soxx/.test(w)), 'and it shows up in the warnings');
});
