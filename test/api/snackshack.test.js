// Snack Shack: shifts, the public (no-account) sign-up that leaks nothing, the
// atomic last spot, cancel links, reminders, the weekly unfilled email, and a
// full closure cancelling shifts.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
const { etDateKey, addDaysToKey, etDayStart, weekKey } = require('../../lib/time');
H.setupEnv();

let app;
const soon = (days = 3) => addDaysToKey(etDateKey(new Date()), days);
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => {
  H.reset(); app.clearJars();
  await app.ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '4321', name: 'John' });
});

const makeShift = (over = {}) => app.ok('john', 'POST', '/api/admin/snack/shifts', { date: soon(), start: '9:00 AM', end: '12:00 PM', peopleNeeded: 2, title: 'Saturday morning', ...over });
const publicShifts = async () => (await app.ok('pub', 'GET', '/api/public/snack/shifts')).shifts;
const signUp = (shiftId, name, email, mobile = '6175551212') => app.call('pub', 'POST', '/api/public/snack/signup', { shiftId, name, email, mobile });

test('the public page shows counts only — never a volunteer\'s name, email or phone', async () => {
  const sh = await makeShift();
  await app.ok('pub', 'POST', '/api/public/snack/signup', { shiftId: sh.id, name: 'Jane Parent', email: 'jane@x.test', mobile: '6175550000' });
  const shifts = await publicShifts();
  const row = shifts.find(s => s.id === sh.id);
  assert.strictEqual(row.spotsLeft, 1, 'one of two spots is taken');
  const blob = JSON.stringify(shifts);
  for (const leak of ['Jane Parent', 'jane@x.test', '6175550000', 'volunteers']) {
    assert(!blob.includes(leak), `public page must not leak ${leak}`);
  }
});

test('the last spot is handed out atomically: one gets it, the other is told it is full', async () => {
  const sh = await makeShift({ peopleNeeded: 1 });
  const [a, b] = await Promise.all([signUp(sh.id, 'A', 'a@x.test'), signUp(sh.id, 'B', 'b@x.test')]);
  const oks = [a, b].filter(r => r.status < 400);
  const fulls = [a, b].filter(r => r.status >= 400);
  assert.strictEqual(oks.length, 1, 'exactly one sign-up succeeds');
  assert.strictEqual(fulls.length, 1);
  assert.match(fulls[0].data.error, /full/i);
  assert.strictEqual((await publicShifts()).find(s => s.id === sh.id).spotsLeft, 0);
});

test('a cancel link cancels only its own sign-up, a guessed one is refused, and a second use does nothing', async () => {
  const sh = await makeShift({ peopleNeeded: 1 });
  const me = (await signUp(sh.id, 'Me', 'me@x.test')).data;
  // A wrong token is refused.
  await app.fails(/not valid/, 'pub', 'POST', '/api/public/snack/cancel', { s: me.signupId, t: 'deadbeef' });
  // The right token cancels and reopens the spot.
  const c1 = await app.ok('pub', 'POST', '/api/public/snack/cancel', { s: me.signupId, t: me.token });
  assert.strictEqual(c1.cancelled, true);
  assert.strictEqual((await publicShifts()).find(s => s.id === sh.id).spotsLeft, 1, 'the spot reopened');
  // A second use does nothing.
  const c2 = await app.ok('pub', 'POST', '/api/public/snack/cancel', { s: me.signupId, t: me.token });
  assert.strictEqual(c2.alreadyCancelled, true);
  assert.strictEqual((await publicShifts()).find(s => s.id === sh.id).spotsLeft, 1, 'still one spot, not two');
});

test('the manager sees volunteer details; a signed-out visitor and a coach cannot', async () => {
  const sh = await makeShift();
  await signUp(sh.id, 'Jane', 'jane@x.test');
  const view = (await app.ok('john', 'GET', '/api/admin/snack')).shifts.find(s => s.id === sh.id);
  assert.strictEqual(view.volunteers[0].email, 'jane@x.test', 'the manager sees emails');
  // A guest and a coach are refused.
  assert.strictEqual((await app.call('pub', 'GET', '/api/admin/snack')).status, 401);
  await app.ok('john', 'POST', '/api/admin/roster/coaches', 'name,email,team,division\nC,c@x.test,T,Farm 8\n');
  await app.ok('c', 'POST', '/api/auth/signup', { role: 'coach', email: 'c@x.test', pin: '2222', name: 'C' });
  assert.strictEqual((await app.call('c', 'POST', '/api/admin/snack/shifts', { date: soon(), peopleNeeded: 1 })).status, 403);
});

test('copy last week clones its shifts into the next week', async () => {
  const wkA = weekKey(etDayStart(soon(2)));
  const wkB = addDaysToKey(wkA, 7);
  await app.ok('john', 'POST', '/api/admin/snack/shifts', { date: soon(2), start: '9:00 AM', peopleNeeded: 3, title: 'Copy me' });
  const r = await app.ok('john', 'POST', '/api/admin/snack/copy-week', { fromMonday: wkA, toMonday: wkB });
  assert.strictEqual(r.copied, 1);
  const inB = (await app.ok('john', 'GET', '/api/admin/snack')).shifts.filter(s => weekKey(etDayStart(s.date)) === wkB);
  assert.strictEqual(inB.length, 1);
  assert.strictEqual(inB[0].title, 'Copy me');
});

test('a reminder goes out once per sign-up the day before, with a cancel link', async () => {
  const tomorrow = addDaysToKey(etDateKey(new Date()), 1);
  const sh = await app.ok('john', 'POST', '/api/admin/snack/shifts', { date: tomorrow, start: '9:00 AM', peopleNeeded: 2 });
  await app.ok('pub', 'POST', '/api/public/snack/signup', { shiftId: sh.id, name: 'Jane', email: 'jane@x.test', mobile: '6175550000' });
  const s = await H.settings().getSettings();
  const now = new Date(etDayStart(etDateKey(new Date())).getTime() + s.snackReminderHour * 3600e3);
  assert.strictEqual(await H.snackshack().reminders(now, s), 1, 'one reminder');
  const rem = (await H.outbox()).filter(m => m.kind === 'snack-reminder');
  assert.strictEqual(rem.length, 1);
  assert(rem[0].body.includes('/snack/cancel?'), 'the reminder carries a cancel link');
  assert.strictEqual(await H.snackshack().reminders(now, s), 0, 'not a second time for the same sign-up');
});

test('the Snack Shack Director gets a weekly email about unfilled shifts', async () => {
  await app.ok('john', 'POST', '/api/admin/people', { role: 'snack', email: 'snack@x.test', name: 'Snack Dir' });
  const nextMon = addDaysToKey(weekKey(etDayStart(etDateKey(new Date()))), 7);
  await app.ok('john', 'POST', '/api/admin/snack/shifts', { date: addDaysToKey(nextMon, 1), start: '9:00 AM', peopleNeeded: 3 });
  const n = await H.snackshack().unfilledEmail(new Date());
  assert(n >= 1, 'the director is emailed');
  assert((await H.outbox()).some(m => m.kind === 'snack-unfilled' && m.to === 'snack@x.test'));
});

test('a full Quarry Hills closure cancels that day\'s shifts and tells the volunteers; no reminder follows', async () => {
  const tomorrow = addDaysToKey(etDateKey(new Date()), 1);
  const sh = await app.ok('john', 'POST', '/api/admin/snack/shifts', { date: tomorrow, start: '9:00 AM', peopleNeeded: 2 });
  await app.ok('pub', 'POST', '/api/public/snack/signup', { shiftId: sh.id, name: 'Jane', email: 'jane@x.test', mobile: '6175550000' });

  const r = await app.ok('john', 'POST', '/api/admin/closures', { all: true, date: tomorrow, reason: 'storm' });
  assert.strictEqual(r.shiftsCancelled, 1);
  assert(( await H.outbox()).some(m => m.kind === 'snack-cancelled' && m.to === 'jane@x.test'), 'the volunteer is told');
  // The cancelled shift is off the public page and gets no reminder.
  assert(!(await publicShifts()).some(s => s.id === sh.id), 'cancelled shift is hidden');
  const s = await H.settings().getSettings();
  const now = new Date(etDayStart(etDateKey(new Date())).getTime() + s.snackReminderHour * 3600e3);
  assert.strictEqual(await H.snackshack().reminders(now, s), 0, 'no reminder for a closure-cancelled shift');
});
