// Timed jobs, driven on a controlled clock so each deadline and reminder is
// tested on both sides of its line and proven to fire exactly once. Ported from
// flow.test.js and extended with the daylight-saving case from the sprint plan.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const H = require('../helpers');
const { etDayStart, etDateKey, addDaysToKey, zonedToUtc } = require('../../lib/time');
const feeds = require('../helpers/feeds');
H.setupEnv();

let app, W;
const settings = () => H.settings().getSettings();
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => { H.reset(); app.clearJars(); W = await H.world(app); });

test('the Sunday digest goes out once per week', async () => {
  const sundayEve = new Date(etDayStart(addDaysToKey(W.mon, -1)).getTime() + 19 * 3600e3);
  const t1 = await H.jobs().tick(sundayEve);
  assert(t1.weekly >= 1, 'digest sent: ' + JSON.stringify(t1));
  const t2 = await H.jobs().tick(new Date(sundayEve.getTime() + 15 * 60e3));
  assert.strictEqual(t2.weekly, 0, 'not sent again 15 minutes later');
});

test('the day-before reminder waits for the configured hour, then fires once', async () => {
  await app.ok('alice', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'plate' });
  const s = await settings();
  // Red Sox is on day 1 (Tuesday); the reminder is the evening before (Monday).
  const tooEarly = new Date(etDayStart(W.mon).getTime() + (s.dayBeforeHour - 1) * 3600e3);
  assert.strictEqual(await H.jobs().dayBefore(tooEarly, s), 0, 'nothing an hour before the configured time');

  const onTime = new Date(etDayStart(W.mon).getTime() + s.dayBeforeHour * 3600e3);
  assert(await H.jobs().dayBefore(onTime, s) >= 1, 'fires at the configured hour');
  assert.strictEqual(await H.jobs().dayBefore(onTime, s), 0, 'does not fire twice for the same game');
});

test('a coverage gap alert fires for soon, uncovered games', async () => {
  const s = await settings();
  const mondayEve = new Date(etDayStart(W.mon).getTime() + 18 * 3600e3);
  const n = await H.jobs().coverageGaps(mondayEve, s, {});
  assert(n >= 1, 'at least one open game within the horizon');
});

test('coaches are nudged about an unconfirmed finished game, then not once confirmed', async () => {
  const todayKey = etDateKey(new Date());
  const start = new Date(etDayStart(addDaysToKey(todayKey, -1)).getTime() + 12 * 3600e3).toISOString(); // yesterday noon
  const now = new Date(etDayStart(todayKey).getTime() + 10 * 3600e3);                                   // today 10am ET
  const { id } = await app.ok('john', 'POST', '/api/admin/games',
    { start, division: 'Farm 8', home: 'Red Sox', away: 'Yankees', field: 'Quarry Hills Field A' });
  await app.ok('john', 'POST', `/api/admin/games/${id}/assign`, { slot: 'plate', umpireId: 'alice@x.test', force: true });

  const s = await settings();
  const sent = await H.jobs().coachNudges(now, s, {});
  assert(sent >= 1, 'the owning coach is nudged');
  const nudges = (await H.outbox()).filter(m => m.kind === 'coach-nudge');
  assert(nudges.some(m => m.to === 'red@x.test'), 'nudge went to the Red Sox coach');

  // Once confirmed, the nudge stops.
  await app.ok('red', 'POST', '/api/auth/signup', { role: 'coach', email: 'red@x.test', pin: '2222', name: 'Coach Red' });
  await app.ok('red', 'POST', '/api/coach/confirm', { gameId: id, results: { plate: 'worked' } });
  assert.strictEqual(await H.jobs().coachNudges(now, s, {}), 0, 'no nudge after confirmation');
});

test('the day-before reminder fires once, on Sunday, across the spring DST change', async () => {
  // DST 2027 begins Sunday Mar 14 (clocks jump 2am→3am). A game Monday Mar 15 at
  // 5:30pm must get its day-before reminder on Sunday Mar 14 at the configured
  // hour — once, not zero (clock skipped an hour) and not twice.
  const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const gameStart = zonedToUtc(2027, 3, 15, 17, 30);
  const gameEnd = zonedToUtc(2027, 3, 15, 19, 30);
  // Replace the feed with a single Monday game and re-sync.
  fs.writeFileSync(W.feedFile, feeds.ics([
    { uid: 'dst@se', summary: 'Farm 8: Nighthawks vs. Owls', start: stamp(gameStart), end: stamp(gameEnd) }
  ]));
  await app.ok('john', 'POST', '/api/admin/sync');
  const g = (await app.ok('john', 'GET', '/api/admin/overview')).games.find(x => x.summary.includes('Nighthawks'));
  await app.ok('john', 'POST', `/api/admin/games/${g.id}/assign`, { slot: 'plate', umpireId: 'alice@x.test', force: true });

  const s = await settings();
  const sundayBefore = new Date(etDayStart('2027-03-15').getTime() - 24 * 3600e3 + s.dayBeforeHour * 3600e3);
  assert.strictEqual(etDateKey(sundayBefore), '2027-03-14', 'the reminder day is the Sunday DST starts');
  assert.strictEqual(await H.jobs().dayBefore(sundayBefore, s), 1, 'exactly one reminder on Sunday');
  assert.strictEqual(await H.jobs().dayBefore(sundayBefore, s), 0, 'not a second time');
});
