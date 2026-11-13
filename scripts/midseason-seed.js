// Builds a believable MID-SEASON demo across all five divisions, so the whole
// app can be explored as if the season were underway: played games with scores
// and standings, umpire assignments and pay, a score waiting on a coach, a
// dispute for a director to settle, pitch logs (including a violation and the
// 12-year-old innings), Snack Shack shifts with sign-ups, and a rainout.
//
// Usage: LOCAL_DB_FILE=./data/midseason.json node scripts/midseason-seed.js
// Then run the app with the same LOCAL_DB_FILE and ADMIN_EMAILS=john@qybsl.test.
process.env.NOTIFY_DRY = '1';
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || 'john@qybsl.test';

const store = require('../lib/store');
const appServer = require('../server');
const { buildLeague2027, buildCsv, DIVISIONS, coachEmail } = require('../test/helpers/league2027');

const FIELD = {
  'Farm 8': 'Quarry Hills - Field A', 'Farm 9': 'Quarry Hills - Field B',
  'Minors': 'Quarry Hills - Field C', 'Majors': 'Faxon Park Field 1', 'Babe Ruth': 'Adams Field'
};
// Five played dates (past) then three upcoming.
const DAYS = [-16, -13, -9, -6, -2, 2, 6, 9];
const roundRobin = teams => { const p = []; for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) p.push([teams[i], teams[j]]); return p; };
const dayKey = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const etDate = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));
function scoreFor(div, home, away, i) {
  const idx = t => DIVISIONS[div].indexOf(t);
  const hStr = DIVISIONS[div].length - idx(home), aStr = DIVISIONS[div].length - idx(away);
  let hr = 2 + Math.max(0, hStr - aStr) + (i % 3), ar = 2 + Math.max(0, aStr - hStr) + ((i + 1) % 2);
  if (hr === ar) hr += 1;
  return [Math.min(hr, 13), Math.min(ar, 13)];
}

(async () => {
  store.resetLocal();
  const server = appServer.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = {};
  const call = async (who, method, url, body) => {
    const isStr = typeof body === 'string';
    const r = await fetch(base + url, {
      method, headers: { 'Content-Type': isStr ? 'text/csv' : 'application/json', ...(jar[who] ? { Cookie: jar[who] } : {}) },
      body: body == null ? undefined : (isStr ? body : JSON.stringify(body))
    });
    const c = r.headers.get('set-cookie'); if (c) jar[who] = c.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    const d = ct.includes('json') ? await r.json().catch(() => ({})) : await r.text();
    if (!r.ok) throw new Error(`${method} ${url}: ${(d && d.error) || r.status}`);
    return d;
  };

  // People, teams, rosters, directors (Farm 8, Minors, Babe Ruth).
  const built = await buildLeague2027({ ok: call }, {});
  const players = built.players;

  // A Snack Shack Director who can sign in.
  await call('john', 'POST', '/api/admin/people', { role: 'snack', email: 'snackdir@qybsl.test', name: 'Snack Director' });
  await call('snackdir', 'POST', '/api/auth/signup', { role: 'snack', email: 'snackdir@qybsl.test', pin: '5555', name: 'Snack Director' });

  // A multi-week schedule across every division, then import it.
  const specs = [];
  for (const [div, teams] of Object.entries(DIVISIONS)) {
    const seq = roundRobin(teams);
    DAYS.forEach((day, i) => {
      const [a, b] = seq[i % seq.length];
      const home = i % 2 ? b : a, away = i % 2 ? a : b;
      specs.push({ div, home, away, day, time: day >= 2 && day % 7 <= 1 ? '10:00 AM' : '5:45 PM', field: FIELD[div] });
    });
  }
  await call('john', 'POST', '/api/admin/schedule-upload', { text: buildCsv(specs), filename: 'mid-season.csv', season: 'Spring 2027' });

  const ov = await call('john', 'GET', '/api/admin/overview');
  const games = ov.games;
  const past = games.filter(g => g.past && g.status === 'scheduled');

  // Reserve one game for a coach-entered score still waiting, and one for a dispute.
  const waiting = past.find(g => g.division === 'Farm 8');
  const pitchGame = past.find(g => g.division === 'Minors' && (g.home === 'Balduccis' || g.away === 'Balduccis'));
  const dispute = past.find(g => g.division === 'Minors' && g.id !== (pitchGame && pitchGame.id));

  // Coach enters a home score and waits (the away coach has a task).
  if (waiting) await call(coachEmail(waiting.home), 'POST', '/api/coach/score', { gameId: waiting.id, homeRuns: 5, awayRuns: 3, homeHR: 'Sam P, Alex R' });
  // A disputed score for the Minors director to settle.
  if (dispute) {
    await call(coachEmail(dispute.home), 'POST', '/api/coach/score', { gameId: dispute.id, homeRuns: 7, awayRuns: 2 });
    await call(coachEmail(dispute.away), 'POST', '/api/coach/score/dispute', { gameId: dispute.id, note: 'We had it 7–5 — please check the book.' });
  }
  // Settle the rest via the director/admin so standings fill; mark about half as entered in SE.
  let k = 0;
  for (const g of past) {
    if (g.id === (waiting && waiting.id) || g.id === (dispute && dispute.id)) continue;
    const [hr, ar] = scoreFor(g.division, g.home, g.away, k);
    await call('john', 'POST', `/api/admin/games/${g.id}/score/settle`, { homeRuns: hr, awayRuns: ar });
    if (k % 2 === 0) await call('john', 'POST', `/api/admin/games/${g.id}/score/entered-se`, {});
    k++;
  }

  // Umpires: staff the Farm (student) games. Past ones are confirmed worked (so
  // they show pay); upcoming ones are left open for an umpire to grab.
  const plateU = ['alice@ump.test', 'cara@ump.test', 'don@ump.test'];
  const fieldU = ['ben@ump.test', 'eve@ump.test', 'alice@ump.test'];
  const farm = games.filter(g => g.track === 'student');
  let fi = 0;
  for (const g of farm) {
    if (g.past) {
      await call('john', 'POST', `/api/admin/games/${g.id}/assign`, { slot: 'plate', umpireId: plateU[fi % 3], force: true });
      await call('john', 'POST', `/api/admin/games/${g.id}/assign`, { slot: 'field', umpireId: fieldU[fi % 3], force: true });
      await call('john', 'POST', `/api/admin/games/${g.id}/confirm`, { results: { plate: 'worked', field: 'worked' } });
    } else if (fi % 2 === 0) {
      // staff the plate on some upcoming games, leaving the field open to grab
      await call('john', 'POST', `/api/admin/games/${g.id}/assign`, { slot: 'plate', umpireId: plateU[fi % 3], force: true });
    }
    fi++;
  }

  // Patched divisions (Minors/Majors/Babe Ruth): mark the assignor confirmed.
  for (const g of games.filter(g => g.track === 'patched' && g.status !== 'cancelled')) {
    await call('john', 'POST', `/api/admin/games/${g.id}/patched`, { status: 'Confirmed', note: 'Staffed by the assignor' });
  }

  // Pitch counts on a played Minors game: two 12-year-olds (innings) and an
  // over-the-limit outing (a violation the Minors/Cal Ripken director sees).
  if (pitchGame) {
    const log = (name, pitches, outs) => call('john', 'POST', `/api/admin/games/${pitchGame.id}/pitches`, { playerId: players[name].id, pitches, outs });
    if (players['Theo B']) await log('Theo B', 68, 15); // 12yo, 5 innings, 4 days rest
    if (players['Gus B']) await log('Gus B', 44, 12);  // 12yo, 4 innings
    if (players['Max B']) await call('john', 'POST', `/api/admin/games/${pitchGame.id}/pitches`, { playerId: players['Max B'].id, pitches: 82 }); // 10yo over the 75 max
  }

  // Snack Shack: a few upcoming shifts, a couple already signed up for.
  await call('john', 'POST', '/api/admin/snack/shifts', { date: dayKey(3), start: '09:00', end: '12:00', peopleNeeded: 3, title: 'Saturday morning', location: 'Quarry Hills' });
  await call('john', 'POST', '/api/admin/snack/shifts', { date: dayKey(3), start: '12:00', end: '15:00', peopleNeeded: 3, title: 'Saturday afternoon', location: 'Quarry Hills' });
  await call('john', 'POST', '/api/admin/snack/shifts', { date: dayKey(10), start: '09:00', end: '12:00', peopleNeeded: 2, title: 'Saturday morning', location: 'Quarry Hills' });
  const shifts = (await call('pub', 'GET', '/api/public/snack/shifts')).shifts;
  if (shifts[0]) {
    await call('pub', 'POST', '/api/public/snack/signup', { shiftId: shifts[0].id, name: 'Dana Fox', email: 'dana@example.com', mobile: '6175551212' });
    await call('pub', 'POST', '/api/public/snack/signup', { shiftId: shifts[0].id, name: 'Pat Gomez', email: 'pat@example.com', mobile: '6175551313' });
  }

  // A rainout: close an upcoming Farm 8 field for its day.
  const f8future = games.find(g => g.division === 'Farm 8' && !g.past && /quarry hills/i.test(g.field || ''));
  if (f8future) await call('john', 'POST', '/api/admin/closures', { date: etDate(f8future.start), fields: [f8future.field], reason: 'rain in the forecast' });

  const se = await call('john', 'GET', '/api/admin/selfcheck');
  server.close();
  console.log(`Mid-season demo ready: ${se.games} games, standings across 5 divisions.`);
  console.log('Sign in: admin john@qybsl.test/4321 · Minors director mdir@qybsl.test/3333 · coach coach.balduccis@qyb.test/2222 · umpire alice@ump.test/1111 · snack snackdir@qybsl.test/5555');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
