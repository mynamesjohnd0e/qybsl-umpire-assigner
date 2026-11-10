// SportsEngine HQ export upload: parsing, sorting, moved-game pairing, date shift, test reset.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ump-csv-'));
Object.assign(process.env, { LOCAL_DB_FILE: path.join(dir, 's.json'), NOTIFY_DRY: '1', ADMIN_EMAILS: 'john@qybsl.test', TEST_MODE: '1', TEST_SEND_ONLY: '^john' });
delete process.env.FIRESTORE_PROJECT_ID;
const app = require('../server');
const store = require('../lib/store');
const { addDaysToKey, etDateKey } = require('../lib/time');

const HEAD = 'Event Type,Event Name,Description,Date,Start Time,End Time,Duration (minutes),All Day Event,Home Team,Away Team,Teams (Events Only),Venue,Status,Last Updated,Timezone,Home Score (Games Only),Away Score (Games Only)';
const row = (date, time, home, away, venue, status = 'scheduled', type = 'game') =>
  `${type},x,,${date},${time},,120,,"${home}","${away}",,${venue},${status},,America/New_York,,`;
const fut = n => { const [y, m, d] = addDaysToKey(etDateKey(new Date()), n).split('-').map(Number); return `${m}/${d}/${y}`; };

(async () => {
  const server = app.listen(0), base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body && JSON.stringify(body) });
    const c = r.headers.get('set-cookie'); if (c) cookie = c.split(';')[0];
    const d = await r.json(); if (!r.ok) throw new Error(d.error); return d;
  };
  await call('POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '1234', name: 'John' });
  assert((await call('GET', '/api/me')).testMode);
  const csv1 = [HEAD,
    row(fut(3), '5:30 PM', 'FARM 8 > JF8- QCARE  (BUCKLEY)', 'FARM 8 > JF8- SINC LAW P.C. (BYRNE)', 'Quarry Hills - Field B > Quarry Hills - Field B'),
    row(fut(10), '5:30 PM', 'FARM 8 > JF8- QCARE  (BUCKLEY)', 'FARM 8 > JF8- SINC LAW P.C. (BYRNE)', 'Quarry Hills - Field C > Quarry Hills - Field C'),
    row(fut(4), '5:30 PM', 'FARM 9 > JF9- QUINCY LOCK (FEENEY)', 'FARM 9 > JF9- HERITAGE COMPANIES (TOLAND)', 'Quarry Hills  > Quarry A'),
    row(fut(5), '5:30 PM', 'MAJORS > Quincy Police', 'MAJORS > Forepoint', 'Quarry Hills - Field C > Quarry Hills - Field C'),
    row(fut(6), '9:00 AM', 'T-BALL > Bees', 'T-BALL > Ants', 'Quarry Hills - Field D > Quarry Hills - Field D'),
    row(fut(7), '5:30 PM', 'FARM 9 > JF9- QUINCY LOCK (FEENEY)', 'FARM 9 > JF9- NOEL DIBONA (CHIRIELEISON)', 'Quarry Hills - Field A > Quarry Hills - Field A', 'cancelled'),
    row(fut(7), '6:00 PM', 'x', 'y', 'z', 'scheduled', 'practice')
  ].join('\n');
  const r1 = await call('POST', '/api/admin/schedule-upload', { text: csv1, filename: 'export.csv', season: 'Test Spring' });
  assert.deepStrictEqual([r1.counts.new, r1.counts.skipped], [4, 1], JSON.stringify(r1.counts));
  let ov = await call('GET', '/api/admin/overview');
  const g1 = ov.games.find(g => g.field === 'Quarry Hills - Field B');
  assert.strictEqual(g1.division, 'Farm 8'); assert.strictEqual(g1.home, 'QCARE (BUCKLEY)'); assert.strictEqual(g1.away, 'SINC LAW P.C. (BYRNE)');
  assert(ov.games.some(g => g.field === 'Quarry Hills - Quarry A'));
  assert.strictEqual(ov.games.find(g => g.division === 'Majors').track, 'patched');

  // Put an umpire on game 1, then re-upload with game 1 moved a day later and the Farm 9 game dropped.
  await call('POST', '/api/admin/roster/umpires', { csv: 'name,email\nAmy Ump,amy@x.test' });
  await call('POST', `/api/admin/games/${g1.id}/assign`, { slot: 'field', umpireId: 'amy@x.test', force: true });
  const csv2 = csv1.split('\n').filter(l => !l.includes('HERITAGE')).map(l => l.startsWith(`game,x,,${fut(3)}`) ? l.replace(fut(3), fut(4)).replace('5:30 PM', '6:00 PM') : l).join('\n');
  const r2 = await call('POST', '/api/admin/schedule-upload', { text: csv2, filename: 'export2.csv', season: 'Test Spring' });
  assert.strictEqual(r2.counts.moved, 1, 'moved: ' + JSON.stringify(r2.counts)); assert.strictEqual(r2.counts.new, 0); assert.strictEqual(r2.counts.cancelled, 1);
  ov = await call('GET', '/api/admin/overview');
  const moved = ov.games.find(g => g.id === g1.id);
  assert.strictEqual(moved.slots.field.state, 'reconfirm'); assert.strictEqual(moved.slots.field.umpireId, 'amy@x.test');
  assert.strictEqual(ov.games.filter(g => g.track === 'student' && g.status !== 'cancelled').length, 2, 'the rematch 10 days out is untouched');

  // Test-copy guard: amy's reconfirm messages were held back.
  const out = await store.list('outbox');
  assert(out.filter(m => m.to === 'amy@x.test').every(m => m.status.includes('test copy')));

  // Date shift (test copy only): same file shifted a week lands 7 days later.
  const r3 = await call('POST', '/api/admin/test/reset', {});
  assert(r3.games >= 4);
  assert.strictEqual((await call('GET', '/api/admin/overview')).games.length, 0);
  await call('POST', '/api/admin/schedule-upload', { text: csv1, filename: 'e.csv', season: 'Test', shiftDays: 7 });
  ov = await call('GET', '/api/admin/overview');
  const shifted = ov.games.find(g => g.field === 'Quarry Hills - Field B');
  assert.strictEqual(etDateKey(shifted.start), addDaysToKey(etDateKey(new Date()), 10));
  assert.strictEqual(new Date(shifted.start).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }), '5:30 PM');

  console.log('CSV upload checks passed.');
  server.close(); process.exit(0);
})().catch(e => { console.error('TEST FAILED:', e.stack); process.exit(1); });
