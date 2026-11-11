// Snack Shack volunteer sign-ups. The Snack Shack Director (or an admin) posts
// shifts; parents sign up from a public link with no account. The public page
// shows counts only — never another volunteer's name, email or phone. A shift's
// last spot is handed out atomically, and each sign-up gets an unguessable cancel
// link that reopens the spot. A full Quarry Hills closure cancels that day's
// shifts and tells the volunteers.
const crypto = require('crypto');
const store = require('./store');
const clock = require('./clock');
const notify = require('./notify');
const { getSettings } = require('./settings');
const { etDateKey, addDaysToKey, weekKey, etDayStart, zoneParts } = require('./time');

const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
const toInt = v => Math.max(0, Math.round(Number(v) || 0));
const DAY = 'YYYY-MM-DD';

function cancelUrl(s, signup) {
  return `${s.appUrl || ''}/snack/cancel?s=${signup.id}&t=${signup.token}`;
}

// ── Shifts (managers) ─────────────────────────────────────────────────────────
async function createShift(user, body) {
  const date = String(body.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Give the shift date as YYYY-MM-DD.');
  const peopleNeeded = toInt(body.peopleNeeded);
  if (peopleNeeded < 1) throw new Error('A shift needs at least one volunteer.');
  const id = 'sh_' + crypto.randomBytes(6).toString('hex');
  const shift = {
    id, date, start: String(body.start || '').trim(), end: String(body.end || '').trim(),
    peopleNeeded, title: String(body.title || 'Snack Shack').trim(), location: String(body.location || '').trim(),
    filled: 0, cancelled: false, by: user.email, at: clock.now().toISOString()
  };
  await store.set('shifts', id, shift);
  return shift;
}

// Copy a week's shifts to another week (e.g. "copy last week"). Weeks are Monday
// keys; each shift's weekday is kept.
async function copyWeek(user, fromMonday, toMonday) {
  const offset = Math.round((Date.parse(toMonday + 'T12:00:00Z') - Date.parse(fromMonday + 'T12:00:00Z')) / 864e5);
  if (!offset) throw new Error('The source and target weeks are the same.');
  const shifts = (await store.list('shifts')).filter(s => !s.cancelled && weekKey(etDayStart(s.date)) === fromMonday);
  let made = 0;
  for (const src of shifts) {
    await createShift(user, { ...src, date: addDaysToKey(src.date, offset) });
    made++;
  }
  return { copied: made };
}

// ── Public (no account) ───────────────────────────────────────────────────────
// Upcoming shifts, counts only — never a volunteer's name, email or phone.
async function publicShifts(now = clock.now()) {
  const today = etDateKey(now);
  return (await store.list('shifts'))
    .filter(s => !s.cancelled && s.date >= today)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    .map(s => ({
      id: s.id, date: s.date, start: s.start, end: s.end, title: s.title, location: s.location,
      peopleNeeded: s.peopleNeeded, filled: s.filled, spotsLeft: Math.max(0, s.peopleNeeded - s.filled)
    }));
}

// Sign up for a shift. The last spot is handed out atomically: two people racing
// for it, one gets it and the other is told it's full.
async function signUp(body) {
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const mobile = String(body.mobile || '').trim();
  if (!name) throw new Error('Please enter your name.');
  if (!validEmail(email)) throw new Error('Please enter a valid email.');
  if (!mobile) throw new Error('Please enter a mobile number.');
  const token = crypto.randomBytes(16).toString('hex');
  const id = 'su_' + crypto.randomBytes(8).toString('hex');
  const result = await store.transact(async tx => {
    const shift = await tx.get('shifts', body.shiftId);
    if (!shift || shift.cancelled) throw new Error('That shift is not open.');
    if (shift.filled >= shift.peopleNeeded) throw new Error('That shift is full.');
    const signup = { id, shiftId: shift.id, date: shift.date, name, email, mobile, token, cancelled: false, reminded: false, at: clock.now().toISOString() };
    shift.filled += 1;
    tx.set('shifts', shift.id, shift);
    tx.set('signups', id, signup);
    return { signup, shift };
  });
  const s = await getSettings();
  const link = cancelUrl(s, result.signup);
  await notify.sendEmail(email, 'You\'re signed up for the Snack Shack',
    `Thanks for signing up, ${name}!\n\n${shiftLine(result.shift)}\n\nCan't make it? Cancel here: ${link}`,
    { kind: 'snack-confirm' });
  return { signupId: id, token, cancelUrl: link, shift: result.shift.id };
}

// Cancel a sign-up with its token. Only the right token works; a second use does
// nothing; the spot reopens.
async function cancel(signupId, token) {
  return store.transact(async tx => {
    const signup = await tx.get('signups', signupId);
    if (!signup || signup.token !== token) throw new Error('That cancel link is not valid.');
    if (signup.cancelled) return { alreadyCancelled: true };
    signup.cancelled = true; signup.cancelledAt = clock.now().toISOString();
    tx.set('signups', signupId, signup);
    const shift = await tx.get('shifts', signup.shiftId);
    if (shift && shift.filled > 0) { shift.filled -= 1; tx.set('shifts', shift.id, shift); }
    return { cancelled: true, shiftId: signup.shiftId };
  });
}

// ── Manager view (names/emails/phones) ────────────────────────────────────────
async function managerView() {
  const signups = (await store.list('signups')).filter(s => !s.cancelled);
  const byShift = new Map();
  for (const su of signups) (byShift.get(su.shiftId) || byShift.set(su.shiftId, []).get(su.shiftId)).push({ name: su.name, email: su.email, mobile: su.mobile });
  return (await store.list('shifts')).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    .map(s => ({ ...s, spotsLeft: Math.max(0, s.peopleNeeded - s.filled), volunteers: byShift.get(s.id) || [] }));
}

const shiftLine = s => `${s.title} — ${s.date}${s.start ? ` ${s.start}${s.end ? `–${s.end}` : ''}` : ''}${s.location ? ` · ${s.location}` : ''}`;

// ── A full closure cancels that day's shifts ──────────────────────────────────
async function cancelShiftsForClosure(closure) {
  if (!closure.all) return 0;
  const from = etDateKey(closure.fromTs), to = etDateKey(closure.toTs);
  const shifts = (await store.list('shifts')).filter(s => !s.cancelled && s.date >= from && s.date <= to);
  const foot = await notify.footer();
  let cancelled = 0;
  for (const shift of shifts) {
    shift.cancelled = true; shift.cancelReason = closure.reason || 'field closed';
    await store.set('shifts', shift.id, shift);
    cancelled++;
    const signups = (await store.list('signups')).filter(su => su.shiftId === shift.id && !su.cancelled);
    for (const su of signups) {
      await notify.sendEmail(su.email, 'Snack Shack shift cancelled',
        `Your Snack Shack shift is cancelled because the field is closed:\n\n${shiftLine(shift)}\n\nThanks for signing up — no action needed.${foot}`,
        { kind: 'snack-cancelled' });
    }
  }
  return cancelled;
}

// ── Jobs ──────────────────────────────────────────────────────────────────────
// Day-before reminder: exactly one per active sign-up, with the cancel link.
// Cancelled shifts get no reminder (their volunteers got a cancellation notice).
async function reminders(now, s) {
  if (zoneParts(now).hh < s.snackReminderHour) return 0;
  const tomorrow = addDaysToKey(etDateKey(now), 1);
  const shifts = (await store.list('shifts')).filter(x => !x.cancelled && x.date === tomorrow);
  if (!shifts.length) return 0;
  const openIds = new Set(shifts.map(x => x.id));
  const due = (await store.list('signups')).filter(su => !su.cancelled && !su.reminded && openIds.has(su.shiftId));
  const byShift = new Map(shifts.map(x => [x.id, x]));
  let sent = 0;
  for (const su of due) {
    const shift = byShift.get(su.shiftId);
    await notify.sendEmail(su.email, `Reminder: your Snack Shack shift tomorrow`,
      `Reminder, ${su.name}: you're on the Snack Shack tomorrow.\n\n${shiftLine(shift)}\n\nCan't make it? Cancel here: ${cancelUrl(s, su)}`,
      { kind: 'snack-reminder' });
    await store.set('signups', su.id, { ...su, reminded: true });
    sent++;
  }
  return sent;
}

// Weekly email to the Snack Shack Director(s) listing the coming week's shifts
// that still need volunteers.
async function unfilledEmail(now) {
  const nextMon = addDaysToKey(weekKey(etDayStart(etDateKey(now))), 7);
  const shifts = (await store.list('shifts')).filter(s => !s.cancelled && weekKey(etDayStart(s.date)) === nextMon && s.filled < s.peopleNeeded);
  if (!shifts.length) return 0;
  const directors = (await store.list('people')).filter(p => p.snack);
  if (!directors.length) return 0;
  const foot = await notify.footer();
  const lines = shifts.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    .map(s => `• ${shiftLine(s)} — needs ${s.peopleNeeded - s.filled} more`).join('\n');
  let sent = 0;
  for (const d of directors) {
    await notify.toAdult(d, { kind: 'snack-unfilled', subject: `Snack Shack: ${shifts.length} shift${shifts.length > 1 ? 's' : ''} still need volunteers`, text: `These shifts next week still need volunteers:\n\n${lines}${foot}` });
    sent++;
  }
  return sent;
}

module.exports = {
  createShift, copyWeek, publicShifts, signUp, cancel, managerView,
  cancelShiftsForClosure, reminders, unfilledEmail, shiftLine
};
