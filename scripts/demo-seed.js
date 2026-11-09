// Builds a local demo: sample umpires, coaches and a fake SportsEngine feed.
// Usage: LOCAL_DB_FILE=./data/demo.json node scripts/demo-seed.js
// Then: LOCAL_DB_FILE=./data/demo.json ADMIN_EMAILS=john@demo.test npm start
// Sign in as john@demo.test / 1234 (admin), alice@demo.test / 1111 (umpire),
// coach.red@demo.test / 2222 (coach).
const fs = require('fs');
const path = require('path');
process.env.NOTIFY_DRY = '1';
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || 'john@demo.test';
const store = require('../lib/store');
const app = require('../server');
const { weekKey, addDaysToKey, etDayStart } = require('../lib/time');

const feedPath = path.resolve(path.dirname(process.env.LOCAL_DB_FILE || 'data/x'), 'demo-feed.ics');
const mon = addDaysToKey(weekKey(new Date()), 7);
const stamp = (day, hh, mm = 0) => new Date(etDayStart(addDaysToKey(mon, day)).getTime() + (hh * 60 + mm) * 60e3).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const teams8 = ['Quincy Police', 'Forepoint Retirement', 'Colonial Federal', 'Black\'s Creek BBQ', 'Granite City Electric', 'Jersey Mike\'s'];
const teams9 = ['Laborers Local 133', 'McDonald Insurance', 'Hancock Tavern', 'Curry Hardware', 'DiMarzio Ortho', 'Quincy Credit Union', 'Brewster Ambulance', 'The Fours'];
const fields = ['Quarry Hills Field A', 'Quarry Hills Field B', 'Quarry Hills Field D', 'Faxon Park Field 1'];
const events = [];
let n = 0;
for (let wk = 0; wk < 3; wk++) {
  for (const [day, div, teams] of [[0, 'Farm 8', teams8], [2, 'Farm 9', teams9], [5, 'Farm 8', teams8], [5, 'Farm 9', teams9]]) {
    for (let i = 0; i < 2; i++) {
      const d = wk * 7 + day, hh = day === 5 ? 9 + i * 2 : 17 + (i ? 0 : 0), mm = day === 5 ? 0 : 45;
      const t = teams.slice((wk + i * 2) % teams.length).concat(teams);
      events.push({ uid: `demo-${++n}@se`, summary: `${div}: ${t[0]} vs. ${t[1]}`, start: stamp(d, hh, mm), end: stamp(d, hh + 2, mm), loc: fields[(n + i) % 4] });
    }
  }
  events.push({ uid: `demo-maj-${wk}@se`, summary: `Majors: Keohane's vs Boston Property Group`, start: stamp(wk * 7 + 1, 17, 45), end: stamp(wk * 7 + 1, 19, 45), loc: 'Quarry Hills Field C' });
  events.push({ uid: `demo-min-${wk}@se`, summary: `Minors: Balducci's vs SINC Law`, start: stamp(wk * 7 + 3, 17, 45), end: stamp(wk * 7 + 3, 19, 45), loc: 'Quarry Hills Field C' });
}
const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-TIMEZONE:America/New_York', ...events.flatMap(e => ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART:${e.start}`, `DTEND:${e.end}`, `SUMMARY:${e.summary}`, `LOCATION:${e.loc}`, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

(async () => {
  store.resetLocal();
  fs.writeFileSync(feedPath, ics);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = {};
  const call = async (who, method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(jar[who] ? { Cookie: jar[who] } : {}) }, body: body && JSON.stringify(body) });
    const c = r.headers.get('set-cookie'); if (c) jar[who] = c.split(';')[0];
    const d = await r.json(); if (!r.ok) throw new Error(`${url}: ${d.error}`); return d;
  };
  await call('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@demo.test', pin: '1234', name: 'John Higgins', mobile: '617-555-0100' });
  await call('john', 'PUT', '/api/admin/settings', { feeds: [{ url: 'file:' + feedPath, season: 'Spring 2027' }], directorEmail: 'director@demo.test', seasonLabel: 'Spring 2027' });
  const umps = [['Alice Murphy', 'yes'], ['Ben Carter', 'no'], ['Chloe Nguyen', 'yes'], ['Danny Walsh', 'no'], ['Ella Brooks', 'yes'], ['Finn O\'Brien', 'no'], ['Grace Lee', 'no'], ['Henry Chen', 'yes']];
  await call('john', 'POST', '/api/admin/roster/umpires', { csv: 'name,email,mobile,parent_name,parent_email,parent_mobile,venmo,plate_qualified\n' +
    umps.map(([nm, pq], i) => `${nm},${nm.split(' ')[0].toLowerCase()}@demo.test,617555${String(1000 + i)},Parent ${nm.split(' ')[1]},parent${i}@demo.test,617555${2000 + i},@${nm.split(' ')[0].toLowerCase()},${pq}`).join('\n') });
  await call('john', 'POST', '/api/admin/roster/coaches', { csv: 'name,email,mobile,team,division\n' +
    teams8.map((t, i) => `Coach ${i + 1},${i === 0 ? 'coach.red' : 'c8_' + i}@demo.test,,${t},Farm 8`).join('\n') + '\n' + teams9.map((t, i) => `Coach9 ${i + 1},c9_${i}@demo.test,,${t},Farm 9`).join('\n') });
  await call('john', 'POST', '/api/admin/sync');
  // Umpires sign up and take games.
  for (const [nm] of umps.slice(0, 6)) {
    const e = nm.split(' ')[0].toLowerCase() + '@demo.test';
    await call(e, 'POST', '/api/auth/signup', { role: 'umpire', email: e, pin: '1111', name: nm, mobile: '6175551234', parentName: 'Parent', parentEmail: `p.${e}`, parentMobile: '6175554321', venmo: '@' + nm.split(' ')[0].toLowerCase() });
  }
  await call('newkid', 'POST', '/api/auth/signup', { role: 'umpire', email: 'newkid@demo.test', pin: '1111', name: 'Owen Kelly', mobile: '6175550000', parentName: 'Mary Kelly', parentEmail: 'mary@demo.test', parentMobile: '6175550001', venmo: '@owen' });
  const ov = await call('john', 'GET', '/api/admin/overview');
  const farm = ov.games.filter(g => g.track === 'student');
  const take = async (who, i, slot) => { try { await call(who, 'POST', '/api/umpire/claim', { gameId: farm[i].id, slot }); } catch (_) {} };
  await take('alice@demo.test', 0, 'plate'); await take('ben@demo.test', 0, 'field');
  await take('chloe@demo.test', 1, 'plate'); await take('danny@demo.test', 1, 'field');
  await take('ella@demo.test', 2, 'plate'); await take('alice@demo.test', 3, 'plate'); await take('finn@demo.test', 3, 'field');
  await take('chloe@demo.test', 5, 'plate'); await take('ben@demo.test', 6, 'field');
  await call('ben@demo.test', 'POST', '/api/umpire/swap', { gameId: farm[6].id, slot: 'field' });
  const maj = ov.games.find(g => g.track === 'patched');
  await call('john', 'POST', `/api/admin/games/${maj.id}/patched`, { status: 'Confirmed', note: 'Two from the assignor' });
  // A game from yesterday for the coach to confirm.
  const y = new Date(Date.now() - 26 * 3600e3).toISOString();
  const { id: past } = await call('john', 'POST', '/api/admin/games', { start: y, division: 'Farm 8', home: 'Quincy Police', away: 'Colonial Federal', field: 'Quarry Hills Field A' });
  await call('john', 'POST', `/api/admin/games/${past}/assign`, { slot: 'plate', umpireId: 'alice@demo.test', force: true });
  await call('john', 'POST', `/api/admin/games/${past}/assign`, { slot: 'field', umpireId: 'danny@demo.test', force: true });
  await call('coach.red@demo.test', 'POST', '/api/auth/signup', { role: 'coach', email: 'coach.red@demo.test', pin: '2222', name: 'Mike Sullivan' });
  // Move one game to show the reconfirm flow.
  fs.writeFileSync(feedPath, ics.replace(events[0].start, stamp(0, 18, 30)));
  await call('john', 'POST', '/api/admin/sync');
  server.close();
  console.log('Demo data ready.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
