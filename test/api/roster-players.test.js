// Player roster upload: league ages are stored, birthdates are discarded, and
// re-uploads are safe (idempotent; a trade moves the record; a missing player is
// flagged, not deleted).
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
H.setupEnv();

let app;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => {
  H.reset(); app.clearJars();
  await app.ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '1234', name: 'John' });
});

const roster = (rows) => 'name,number,birthdate,team,division\n' + rows.join('\n');
const base = () => roster([
  'Sam Minor,12,2015-06-15,QCARE,Minors',
  'Pat Minor,7,2014-04-30,QCARE,Minors',
  'Alex Minor,3,2014-05-01,SINC LAW,Minors'
]);
const players = async () => (await app.ok('john', 'GET', '/api/admin/players')).players;

test('upload stores league ages (not birthdates)', async () => {
  const r = await app.ok('john', 'POST', '/api/admin/roster/players', { csv: base() });
  assert.strictEqual(r.added, 3);
  const byName = Object.fromEntries((await players()).map(p => [p.name, p]));
  assert.strictEqual(byName['Pat Minor'].leagueAge, 13, 'Apr 30 2014 → 13 for 2027');
  assert.strictEqual(byName['Alex Minor'].leagueAge, 12, 'May 1 2014 → 12 for 2027');
  assert.strictEqual(byName['Sam Minor'].leagueAge, 11);
  assert.strictEqual(byName['Pat Minor'].number, '7');
});

test('no birthdate survives anywhere in the stored players', async () => {
  await app.ok('john', 'POST', '/api/admin/roster/players', { csv: base() });
  const all = await players();
  for (const p of all) {
    for (const k of Object.keys(p)) assert(!/birth|dob/i.test(k), `player ${p.name} still has field ${k}`);
  }
  // And the raw uploaded birthdate strings appear nowhere in storage.
  const blob = JSON.stringify(all);
  for (const d of ['2015-06-15', '2014-04-30', '2014-05-01']) assert(!blob.includes(d), `birthdate ${d} leaked`);
});

test('re-uploading the same roster changes nothing', async () => {
  await app.ok('john', 'POST', '/api/admin/roster/players', { csv: base() });
  const r2 = await app.ok('john', 'POST', '/api/admin/roster/players', { csv: base() });
  assert.strictEqual(r2.added, 0);
  assert.strictEqual(r2.updated, 3);
  assert.strictEqual(r2.missing.length, 0);
  assert.strictEqual((await players()).length, 3, 'still three players, no duplicates');
});

test('a traded player moves teams on the same record, keeping attached data', async () => {
  await app.ok('john', 'POST', '/api/admin/roster/players', { csv: base() });
  // Simulate attached data that must survive a trade (stands in for a pitch log).
  const alexId = (await players()).find(p => p.name === 'Alex Minor').id;
  await H.store().update('players', alexId, { pitchLog: [{ game: 'g1', pitches: 40 }] });

  // Alex is traded from SINC LAW to QCARE.
  const traded = roster([
    'Sam Minor,12,2015-06-15,QCARE,Minors',
    'Pat Minor,7,2014-04-30,QCARE,Minors',
    'Alex Minor,3,2014-05-01,QCARE,Minors'
  ]);
  const r = await app.ok('john', 'POST', '/api/admin/roster/players', { csv: traded });
  assert.strictEqual(r.added, 0, 'no new player is created for a trade');
  const alex = (await players()).find(p => p.name === 'Alex Minor');
  assert.strictEqual(alex.team, 'QCARE', 'the team moved');
  assert.deepStrictEqual(alex.pitchLog, [{ game: 'g1', pitches: 40 }], 'attached history survived the trade');
  assert.strictEqual((await players()).length, 3, 'no duplicate record');
});

test('a player missing from a later upload is flagged, not deleted', async () => {
  await app.ok('john', 'POST', '/api/admin/roster/players', { csv: base() });
  // Re-upload without Alex.
  const shorter = roster([
    'Sam Minor,12,2015-06-15,QCARE,Minors',
    'Pat Minor,7,2014-04-30,QCARE,Minors'
  ]);
  const r = await app.ok('john', 'POST', '/api/admin/roster/players', { csv: shorter });
  assert.deepStrictEqual(r.missing, ['Alex Minor']);
  const alex = (await players()).find(p => p.name === 'Alex Minor');
  assert(alex, 'Alex is still there');
  assert.strictEqual(alex.missing, true, 'but flagged missing');
  assert.strictEqual((await players()).length, 3);

  // Bringing Alex back clears the flag.
  const r2 = await app.ok('john', 'POST', '/api/admin/roster/players', { csv: base() });
  assert.strictEqual(r2.restored, 1);
  assert.strictEqual((await players()).find(p => p.name === 'Alex Minor').missing, false);
});

test('a row with an unreadable birthdate is skipped and reported', async () => {
  const r = await app.ok('john', 'POST', '/api/admin/roster/players', {
    csv: roster(['Good Kid,5,2015-03-03,QCARE,Minors', 'Bad Date,9,not-a-date,QCARE,Minors'])
  });
  assert.strictEqual(r.added, 1);
  assert.strictEqual(r.skipped.length, 1);
  assert.match(r.skipped[0], /Bad Date/);
});
