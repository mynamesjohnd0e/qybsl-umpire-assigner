// End-to-end flow test against a local server with a throwaway data file.
// Run: npm test
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ump-test-'));
process.env.LOCAL_DB_FILE = path.join(dir, 'store.json');
process.env.NOTIFY_DRY = '1';
process.env.ADMIN_EMAILS = 'john@qybsl.test';
process.env.CRON_KEY = 'cron-test';
delete process.env.FIRESTORE_PROJECT_ID;

const app = require('../server');
const store = require('../lib/store');
const jobs = require('../lib/jobs');
const { clearCache } = require('../lib/settings');
const { weekKey, addDaysToKey, etDayStart, etDateKey } = require('../lib/time');

let base, server;
const jars = {};
async function call(who, method, url, body) {
  const headers = { 'Content-Type': typeof body === 'string' ? 'text/csv' : 'application/json' };
  if (jars[who]) headers.Cookie = jars[who];
  const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const sc = r.headers.get('set-cookie');
  if (sc) jars[who] = sc.split(';')[0];
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: r.status, data };
}
const ok = async (...a) => { const r = await call(...a); if (r.status >= 400) throw new Error(`${a[1]} ${a[2]} → ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
const fails = async (re, ...a) => { const r = await call(...a); assert(r.status >= 400, `expected failure for ${a[2]}`); assert(re.test(r.data.error), `wrong error: ${r.data.error}`); return r.data; };

// ── Feed builder ─────────────────────────────────────────────────────────────
const nextMon = addDaysToKey(weekKey(new Date()), 14);   // a week safely in the future
const at = (dayOffset, hh, mm = 0) => {                   // Eastern wall clock → ICS UTC stamp
  const d = new Date(etDayStart(addDaysToKey(nextMon, dayOffset)).getTime() + (hh * 60 + mm) * 60e3);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
};
function ics(events) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-TIMEZONE:America/New_York',
    ...events.flatMap(e => ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART:${e.start}`, `DTEND:${e.end}`,
      `SUMMARY:${e.summary}`, `LOCATION:${e.loc || 'Quarry Hills Field A'}`, ...(e.status ? [`STATUS:${e.status}`] : []), 'END:VEVENT']),
    'END:VCALENDAR'].join('\r\n');
}
const feedFile = path.join(dir, 'feed.ics');
const baseEvents = () => [
  { uid: 'e1@se', summary: 'Farm 8: Red Sox vs. Yankees', start: at(1, 17, 30), end: at(1, 19, 30) },
  { uid: 'e2@se', summary: 'Farm 8: Cubs vs. Mets', start: at(2, 17, 30), end: at(2, 19, 30) },
  { uid: 'e3@se', summary: 'Farm 9: Orioles @ Rays', start: at(3, 17, 30), end: at(3, 19, 30) },
  { uid: 'e4@se', summary: 'Majors: Quincy Police vs Forepoint', start: at(1, 17, 30), end: at(1, 19, 30), loc: 'Quarry Hills Field C' },
  { uid: 'e5@se', summary: 'T-Ball: Bees vs Ants', start: at(5, 8), end: at(5, 9) },
  { uid: 'e6@se', summary: 'Mystery Game', start: at(5, 10), end: at(5, 12) },
  { uid: 'e7@se', summary: 'Pirates vs Giants', start: at(4, 17, 30), end: at(4, 19, 30) }, // division only via coach list
  { uid: 'e8@se', summary: '9A: Quincy 9A vs Braintree', start: at(6, 10), end: at(6, 12) },
  { uid: 'e9@se', summary: '11B: Quincy 11B vs Milton', start: at(6, 12), end: at(6, 14) }
];

(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(feedFile, ics(baseEvents()));

  // Admin signs up and configures.
  await fails(/not on the board admin list/, 'x', 'POST', '/api/auth/signup', { role: 'admin', email: 'nobody@x.test', pin: '1234', name: 'Nope' });
  await ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'John@QYBSL.test', pin: '4321', name: 'John Higgins', mobile: '617-555-0100' });
  const me = await ok('john', 'GET', '/api/me');
  assert(me.me.isAdmin, 'john is admin');
  await ok('john', 'PUT', '/api/admin/settings', { feeds: [{ url: 'file:' + feedFile, season: 'Spring 2027' }], directorEmail: 'director@qybsl.test', seasonLabel: 'Spring 2027' });

  // Rosters.
  const ur = await ok('john', 'POST', '/api/admin/roster/umpires',
    'Name,Email,Mobile,Parent Name,Parent Email,Parent Mobile,Venmo,Plate Qualified\n' +
    'Alice Ump,alice@x.test,6175550001,Pat Ump,pat@x.test,6175550002,@alice,yes\n' +
    'Bob Ump,bob@x.test,6175550003,Sam Ump,sam@x.test,6175550004,@bob,no\n' +
    'Dan Ump,dan@x.test,6175550005,Lee Ump,lee@x.test,6175550006,@dan,yes\n' +
    'Bad Row,,,,,,,\n');
  assert.strictEqual(ur.added, 3); assert.strictEqual(ur.skipped.length, 1);
  await ok('john', 'POST', '/api/admin/roster/coaches',
    'name,email,mobile,team,division\nCoach Red,red@x.test,6175550101,Red Sox,Farm 8\nCoach Yank,yank@x.test,6175550102,Yankees,Farm 8\nCoach Pirate,pirate@x.test,,Pirates,Farm 9\n');

  // Sync.
  const sync1 = await ok('john', 'POST', '/api/admin/sync');
  assert.strictEqual(sync1.counts.new, 7, 'new games: ' + JSON.stringify(sync1.counts));
  assert.strictEqual(sync1.counts.skipped, 1); assert.strictEqual(sync1.counts.unsorted, 1);
  let ov = await ok('john', 'GET', '/api/admin/overview');
  const gid = uid => ov.games.find(g => g.summary.includes(uid)).id;
  const pirates = ov.games.find(g => g.summary.startsWith('Pirates'));
  assert.strictEqual(pirates.division, 'Farm 9'); assert.strictEqual(pirates.track, 'student');
  assert.strictEqual(ov.games.find(g => g.summary.includes('9A')).track, 'student');
  assert.strictEqual(ov.games.find(g => g.summary.includes('11B')).track, 'patched');
  assert.strictEqual(ov.games.find(g => g.summary.includes('Majors')).coverage, 'Not requested');
  const G1 = gid('Red Sox'), G2 = gid('Cubs'), G3 = gid('Orioles'), G7 = pirates.id;

  // Umpire sign-up: roster umpires auto-approved, others wait.
  await fails(/parent/, 'alice', 'POST', '/api/auth/signup', { role: 'umpire', email: 'alice@x.test', pin: '1111', name: 'Alice Ump' });
  const umpBody = (email, name) => ({ role: 'umpire', email, pin: '1111', name, mobile: '6175559999', parentName: 'P', parentEmail: 'p@x.test', parentMobile: '6175558888', venmo: 'v' });
  let a = await ok('alice', 'POST', '/api/auth/signup', umpBody('alice@x.test', 'Alice Ump'));
  assert(a.me.umpire.approved && a.me.umpire.plateQualified);
  await ok('bob', 'POST', '/api/auth/signup', umpBody('bob@x.test', 'Bob Ump'));
  await ok('dan', 'POST', '/api/auth/signup', umpBody('dan@x.test', 'Dan Ump'));
  const c = await ok('carl', 'POST', '/api/auth/signup', umpBody('carl@x.test', 'Carl New'));
  assert(!c.me.umpire.approved, 'carl not on roster → pending');
  await fails(/approval/, 'carl', 'POST', '/api/umpire/claim', { gameId: G1, slot: 'field' });
  await fails(/already have a PIN/, 'x', 'POST', '/api/auth/signup', umpBody('alice@x.test', 'Alice'));
  await fails(/wrong/, 'x', 'POST', '/api/auth/login', { email: 'alice@x.test', pin: '9999' });

  // Claiming rules.
  await fails(/plate-qualified/, 'bob', 'POST', '/api/umpire/claim', { gameId: G1, slot: 'plate' });
  await ok('bob', 'POST', '/api/umpire/claim', { gameId: G1, slot: 'field' });
  await fails(/just taken/, 'dan', 'POST', '/api/umpire/claim', { gameId: G1, slot: 'field' });
  await ok('alice', 'POST', '/api/umpire/claim', { gameId: G1, slot: 'plate' });
  await fails(/already working/, 'alice', 'POST', '/api/umpire/claim', { gameId: G1, slot: 'field' }).catch(e => { if (!/just taken/.test(e.message)) throw e; });
  await ok('alice', 'POST', '/api/umpire/claim', { gameId: G2, slot: 'plate' });
  ov = await ok('john', 'GET', '/api/admin/overview');
  const aliceGames = ov.games.filter(g => g.slots && Object.values(g.slots).some(s => s.umpireId === 'alice@x.test')).length;
  assert.strictEqual(aliceGames, 2, 'alice has two games');
  await fails(/2 games that week/, 'alice', 'POST', '/api/umpire/claim', { gameId: G3, slot: 'plate' });

  // Board view: partner first name and privacy.
  const board = await ok('alice', 'GET', '/api/umpire/board');
  const b1 = board.board.find(g => g.id === G1);
  assert.strictEqual(b1.partner, 'Bob'); assert.deepStrictEqual(b1.mine, ['plate']);
  const bobBoard = await ok('bob', 'GET', '/api/umpire/board');
  assert.strictEqual(bobBoard.board.find(g => g.id === G2).slots.plate.status, 'taken');
  assert(!JSON.stringify(bobBoard).includes('alice@x.test'), 'no other umpire emails on the board');

  // Swap: Alice gives up G2 plate. Bob can't (not plate). Dan accepts.
  const sw = await ok('alice', 'POST', '/api/umpire/swap', { gameId: G2, slot: 'plate' });
  assert.strictEqual(sw.offeredTo, 1, 'only Dan is eligible for plate');
  await fails(/plate-qualified/, 'bob', 'POST', `/api/umpire/swap/${sw.swapId}/accept`);
  await ok('dan', 'POST', `/api/umpire/swap/${sw.swapId}/accept`);
  await fails(/already took/, 'dan', 'POST', `/api/umpire/swap/${sw.swapId}/accept`);
  ov = await ok('john', 'GET', '/api/admin/overview');
  assert.strictEqual(ov.games.find(g => g.id === G2).slots.plate.umpireId, 'dan@x.test');

  // Move G1 in SportsEngine → both umpires must reconfirm; delete G2 → cancelled.
  const moved = baseEvents().filter(e => e.uid !== 'e2@se');
  moved[0] = { ...moved[0], start: at(1, 18, 0), end: at(1, 20, 0), loc: 'Quarry Hills Field B' };
  fs.writeFileSync(feedFile, ics(moved));
  const sync2 = await ok('john', 'POST', '/api/admin/sync');
  assert.strictEqual(sync2.counts.moved, 1); assert.strictEqual(sync2.counts.cancelled, 1);
  ov = await ok('john', 'GET', '/api/admin/overview');
  const g1 = ov.games.find(g => g.id === G1);
  assert.strictEqual(g1.coverage, 'Needs reconfirm'); assert.strictEqual(g1.field, 'Quarry Hills Field B');
  const g2 = ov.games.find(g => g.id === G2);
  assert.strictEqual(g2.status, 'cancelled'); assert(!g2.slots.plate.umpireId);
  await ok('alice', 'POST', '/api/umpire/reconfirm', { gameId: G1, slot: 'plate', yes: true });
  // Bob never answers; 25 hours later the job reopens his spot.
  const dropped = await jobs.expireReconfirms(new Date(Date.now() + 25 * 3600e3));
  assert.strictEqual(dropped, 1);
  ov = await ok('john', 'GET', '/api/admin/overview');
  assert.strictEqual(ov.games.find(g => g.id === G1).slots.plate.state, 'assigned');
  assert(!ov.games.find(g => g.id === G1).slots.field.umpireId, 'bob released');

  // Cancelled-then-back reinstates.
  fs.writeFileSync(feedFile, ics(baseEvents().map((e, i) => i === 0 ? moved[0] : e)));
  const sync3 = await ok('john', 'POST', '/api/admin/sync');
  assert.strictEqual(sync3.counts.reinstated, 1);

  // Safety: an empty-ish feed doesn't wipe the season.
  fs.writeFileSync(feedFile, ics(baseEvents().slice(8)));
  const sync4 = await ok('john', 'POST', '/api/admin/sync');
  assert(sync4.warnings.length && sync4.counts.cancelled === 0, 'mass removal blocked');
  fs.writeFileSync(feedFile, ics(baseEvents().map((e, i) => i === 0 ? moved[0] : e)));

  // Patched coverage status.
  const maj = ov.games.find(g => g.summary.includes('Majors')).id;
  await ok('john', 'POST', `/api/admin/games/${maj}/patched`, { status: 'Confirmed', note: '2 from assignor' });

  // Admin creates a past game, assigns with override, coach confirms and rates.
  const past = new Date(Date.now() - 3 * 3600e3).toISOString();
  const { id: PG } = await ok('john', 'POST', '/api/admin/games', { start: past, division: 'Farm 8', home: 'Red Sox', away: 'Yankees', field: 'Quarry Hills Field A' });
  const needForce = await call('john', 'POST', `/api/admin/games/${PG}/assign`, { slot: 'plate', umpireId: 'alice@x.test' });
  assert(needForce.data.needsForce, 'admin warned about started game');
  await ok('john', 'POST', `/api/admin/games/${PG}/assign`, { slot: 'plate', umpireId: 'alice@x.test', force: true });
  await ok('john', 'POST', `/api/admin/games/${PG}/assign`, { slot: 'field', umpireId: 'bob@x.test', force: true });

  const red = await ok('red', 'POST', '/api/auth/signup', { role: 'coach', email: 'red@x.test', pin: '2222', name: 'Coach Red' });
  assert.strictEqual(red.me.coach.teams[0].team, 'Red Sox', 'coach auto-linked');
  const walkIn = await ok('walk', 'POST', '/api/auth/signup', { role: 'coach', email: 'walk@x.test', pin: '2222', name: 'Walk In' });
  assert(walkIn.me.coach.pending);
  const cg = await ok('red', 'GET', '/api/coach/games');
  assert(cg.games.some(g => g.id === PG) && cg.games.some(g => g.id === G1), 'coach sees own games');
  assert(!cg.games.some(g => g.id === G3), 'not other teams');
  await fails(/once the game has started/, 'red', 'POST', '/api/coach/confirm', { gameId: G1, results: { plate: 'worked' } });
  await fails(/own team/, 'walk', 'POST', '/api/coach/confirm', { gameId: PG, results: { plate: 'worked' } });
  await ok('red', 'POST', '/api/coach/confirm', { gameId: PG, results: { plate: 'worked', field: 'noshow' } });
  await ok('red', 'POST', '/api/coach/rate', { gameId: PG, slot: 'plate', score: 5, comment: 'Great zone' });
  await ok('yank', 'POST', '/api/auth/signup', { role: 'coach', email: 'yank@x.test', pin: '2222', name: 'Coach Yank' });
  await ok('yank', 'POST', '/api/coach/rate', { gameId: PG, slot: 'plate', score: 2, comment: 'Tight on us' });
  await fails(/1 to 5/, 'yank', 'POST', '/api/coach/rate', { gameId: PG, slot: 'plate', score: 9 });
  await fails(/Not allowed/, 'alice', 'GET', '/api/admin/ratings');
  const rt = await ok('john', 'GET', '/api/admin/ratings');
  const ar = rt.rows.find(r => r.email === 'alice@x.test');
  assert.strictEqual(ar.seasonAvg, 3.5); assert.strictEqual(ar.ratings.length, 2);
  assert.strictEqual(rt.rows.find(r => r.email === 'bob@x.test').noShows, 1);
  const aliceBoard = await ok('alice', 'GET', '/api/umpire/board');
  assert(!JSON.stringify(aliceBoard).includes('Great zone'), 'umpires never see ratings');

  // Payouts: Alice's confirmed game is paid; Bob's no-show is not.
  const end = addDaysToKey(etDateKey(new Date()), 14);
  const pv = await ok('john', 'GET', `/api/admin/payouts/preview?end=${end}`);
  assert.strictEqual(pv.lines.length, 1); assert.strictEqual(pv.lines[0].amount, 40); assert.strictEqual(pv.lines[0].venmo, '@v');
  await ok('john', 'POST', '/api/admin/payouts/pay', { end });
  const pv2 = await ok('john', 'GET', `/api/admin/payouts/preview?end=${end}`);
  assert.strictEqual(pv2.lines.length, 0, 'paid games drop off');
  const csv = await call('john', 'GET', `/api/admin/payouts/csv?end=${end}`);
  assert(String(csv.data).startsWith('"Umpire"'));
  const pay = (await ok('alice', 'GET', '/api/umpire/board')).pay;
  assert.strictEqual(pay[0].status, 'Paid');

  // Urgent opening: Dan's G1? Use G3: Dan claims, director posts urgent.
  await ok('dan', 'POST', '/api/umpire/claim', { gameId: G3, slot: 'plate' });
  await ok('john', 'POST', `/api/admin/games/${G3}/urgent`, { slot: 'plate' });
  const urgentMsgs = (await store.list('outbox')).filter(m => m.kind === 'urgent');
  assert(urgentMsgs.length > 0, 'urgent blast logged');
  ov = await ok('john', 'GET', '/api/admin/overview');
  assert(ov.games.find(g => g.id === G3).slots.plate.urgent);

  // Jobs: Sunday evening digest, day-before, gap alert, coach nudge.
  const sundayEve = new Date(etDayStart(addDaysToKey(nextMon, -1)).getTime() + 19 * 3600e3);
  clearCache();
  const t1 = await jobs.tick(sundayEve);
  assert(t1.weekly >= 1, 'weekly sent: ' + JSON.stringify(t1));
  const t1b = await jobs.tick(new Date(sundayEve.getTime() + 15 * 60e3));
  assert.strictEqual(t1b.weekly, 0, 'weekly only once');
  const dayBeforeEve = new Date(etDayStart(nextMon).getTime() + 18 * 3600e3); // Monday 6pm, G1 is Tuesday
  const t2 = await jobs.tick(dayBeforeEve);
  assert(t2.dayBefore >= 1, 'day-before sent');
  assert(t2.gapAlerts >= 1, 'gap alert sent (G1 field open)');
  const nudgeMsgs = (await store.list('outbox')).filter(m => m.kind === 'coach-nudge');
  // PG is fully confirmed, so no nudge for it; nothing else is past.
  assert.strictEqual(nudgeMsgs.length, 0);

  // Parent copies and text gating.
  const out = await store.list('outbox');
  assert(out.some(m => m.to === 'p@x.test' && m.subject.startsWith('[Parent copy]')), 'parent copied');
  assert(out.filter(m => m.channel === 'text').every(m => m.status.startsWith('not sent')), 'texts off by default');

  // Cron endpoint needs the key.
  assert.strictEqual((await call('x', 'POST', '/api/cron/tick')).status, 403);

  console.log(`All checks passed. Outbox has ${out.length} messages.`);
  server.close();
  process.exit(0);
})().catch(e => { console.error('TEST FAILED:', e.message); console.error(e.stack); server?.close(); process.exit(1); });
