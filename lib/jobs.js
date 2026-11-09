// Timed jobs, run by Cloud Scheduler hitting /api/cron/tick every 15 minutes.
// Each job remembers when it last ran, so running the tick more often is safe.
const store = require('./store');
const notify = require('./notify');
const { getSettings } = require('./settings');
const G = require('./games');
const { coachOwns } = require('./coach');
const { zoneParts, etDateKey, addDaysToKey, weekKey, fmtGame, HOUR } = require('./time');

async function jobState() { return (await store.get('settings', 'jobs')) || {}; }
async function saveJobState(patch) { await store.update('settings', 'jobs', patch); }

// 1. Moved games nobody reconfirmed in time → spot reopens.
async function expireReconfirms(now) {
  const games = await store.list('games');
  const openings = [], dropped = [];
  for (const g of games) {
    if (!g.slots || !G.isLive(g)) continue;
    for (const k of G.SLOTS) {
      const sl = g.slots[k];
      if (sl.state !== 'reconfirm' || !sl.reconfirmBy || new Date(sl.reconfirmBy) > now) continue;
      const updated = await store.transact(async tx => {
        const cur = await tx.get('games', g.id);
        const c = cur.slots[k];
        if (c.state !== 'reconfirm' || new Date(c.reconfirmBy) > now) return null;
        const who = G.release(cur, k, 'did not reconfirm moved game in time', 'system');
        tx.set('games', g.id, cur);
        return { cur, who };
      });
      if (updated) { dropped.push({ game: updated.cur, slot: k, email: updated.who }); if (new Date(g.start) > now) openings.push({ game: updated.cur, slot: k }); }
    }
  }
  const foot = await notify.footer();
  for (const d of dropped) {
    const p = await store.get('people', d.email);
    if (p) await notify.toUmpire(p, { kind: 'reconfirm-expired', gameId: d.game.id, subject: `You're off the moved ${fmtGame(d.game.start)} game`, text: `We didn't get your reconfirmation in time, so this spot opened to other umpires:\n\n${G.describe(d.game)}${foot}` });
    await notify.toAlerts({ kind: 'reconfirm-expired', gameId: d.game.id, subject: `Spot reopened: no reconfirm from ${p?.name || d.email}`, text: `${G.SLOT_LABEL[d.slot]} – ${G.describe(d.game)}` });
  }
  await G.announceOpenings(openings);
  return dropped.length;
}

// 2. Day-before reminders.
async function dayBefore(now, s) {
  const p = zoneParts(now);
  if (p.hh < s.dayBeforeHour) return 0;
  const tomorrow = addDaysToKey(etDateKey(now), 1);
  const games = (await store.list('games')).filter(g => g.slots && G.isLive(g) && etDateKey(g.start) === tomorrow && !g.dayBeforeSent);
  let sent = 0;
  const foot = await notify.footer();
  for (const g of games) {
    for (const k of G.SLOTS) {
      const sl = g.slots[k];
      if (!sl.umpireId) continue;
      const person = await store.get('people', sl.umpireId);
      const other = g.slots[k === 'plate' ? 'field' : 'plate'].umpireId;
      const partner = other ? (await store.get('people', other))?.name?.split(' ')[0] : null;
      const extra = sl.state === 'reconfirm' ? '\n\nThis game was moved and you haven\'t reconfirmed yet. Please do that in the app.' : '';
      await notify.toUmpire(person, {
        kind: 'day-before', gameId: g.id, subject: `Tomorrow: ${G.SLOT_LABEL[k].toLowerCase()} umpire ${fmtGame(g.start)}`,
        text: `Reminder: you're umpiring tomorrow.\n\n${G.SLOT_LABEL[k]} – ${G.describe(g)}\nPartner: ${partner || 'not filled yet'}${extra}${foot}`,
        sms: `QYBSL reminder: ${G.SLOT_LABEL[k].toLowerCase()} umpire tomorrow ${fmtGame(g.start)} at ${g.field || 'TBD'}.`
      });
      sent++;
    }
    await store.update('games', g.id, { dayBeforeSent: true });
  }
  return sent;
}

// 3. Sunday evening "your games this week" digest.
async function weekly(now, s, state) {
  const p = zoneParts(now);
  const today = etDateKey(now);
  if (p.dow !== 0 || p.hh < s.weeklyReminderHour || state.lastWeekly === today) return 0;
  const nextMon = addDaysToKey(today, 1);
  const games = (await store.list('games')).filter(g => g.track === 'student' && G.isLive(g) && weekKey(g.start) === nextMon)
    .sort((a, b) => a.start.localeCompare(b.start));
  const openCount = games.reduce((n, g) => n + G.SLOTS.filter(k => !g.slots[k].umpireId).length, 0);
  const people = (await store.list('people')).filter(x => x.registered && x.umpire?.approved && x.umpire.active !== false);
  const foot = await notify.footer();
  let sent = 0;
  for (const person of people) {
    const mine = games.flatMap(g => G.SLOTS.filter(k => g.slots[k].umpireId === person.email).map(k => ({ g, k })));
    if (!mine.length && !openCount) continue;
    const lines = [];
    for (const { g, k } of mine) {
      const other = g.slots[k === 'plate' ? 'field' : 'plate'].umpireId;
      const partner = other ? (await store.get('people', other))?.name?.split(' ')[0] : 'open';
      lines.push(`• ${G.SLOT_LABEL[k]} – ${G.describe(g).replace('\n', ' – ')} (partner: ${partner})`);
    }
    const body = mine.length ? `Your games this week:\n\n${lines.join('\n')}` : 'You have no games this week.';
    const open = openCount ? `\n\n${openCount} spot${openCount > 1 ? 's are' : ' is'} still open this week if you want more games (limit ${s.weeklyCap} per week).` : '';
    await notify.toUmpire(person, {
      kind: 'weekly', subject: mine.length ? `Your umpire games this week (${mine.length})` : 'Umpire spots open this week',
      text: `${body}${open}${foot}`,
      sms: mine.length ? `QYBSL: you have ${mine.length} umpire game${mine.length > 1 ? 's' : ''} this week. First: ${fmtGame(mine[0].g.start)} at ${mine[0].g.field || 'TBD'}.` : undefined
    });
    sent++;
  }
  await saveJobState({ lastWeekly: today });
  return sent;
}

// 4. Coverage gap alert: student games within 72 hours with an open spot.
// One digest a day to the Director of Umpires and admins.
async function coverageGaps(now, s, state) {
  const today = etDateKey(now);
  if (state.lastGapAlert === today) return 0;
  const horizon = new Date(now.getTime() + s.gapAlertHours * HOUR);
  const gaps = (await store.list('games')).filter(g => g.track === 'student' && G.isLive(g) &&
    new Date(g.start) > now && new Date(g.start) <= horizon &&
    G.SLOTS.some(k => !g.slots[k].umpireId || g.slots[k].state === 'reconfirm'))
    .sort((a, b) => a.start.localeCompare(b.start));
  if (!gaps.length) return 0;
  const lines = gaps.map(g => {
    const need = G.SLOTS.filter(k => !g.slots[k].umpireId).map(k => G.SLOT_LABEL[k]);
    const wait = G.SLOTS.filter(k => g.slots[k].state === 'reconfirm').map(k => `${G.SLOT_LABEL[k]} (waiting on reconfirm)`);
    return `• ${G.describe(g).replace('\n', ' – ')}\n   Needs: ${[...need, ...wait].join(', ')}`;
  });
  await notify.toAlerts({
    kind: 'gap-alert', subject: `Coverage gap: ${gaps.length} game${gaps.length > 1 ? 's' : ''} in the next ${s.gapAlertHours} hours`,
    text: `These games still need umpires:\n\n${lines.join('\n')}\n\nYou can post an urgent opening or assign someone from the admin page.${await notify.footer()}`,
    sms: `QYBSL: ${gaps.length} Farm game${gaps.length > 1 ? 's' : ''} in the next ${s.gapAlertHours} hrs still need umpires. Check the admin page.`
  });
  await saveJobState({ lastGapAlert: today });
  return gaps.length;
}

// 5. Daily nudge to coaches with games that still need confirming.
async function coachNudges(now, s, state) {
  const today = etDateKey(now);
  if (zoneParts(now).hh < s.coachNudgeHour || state.lastNudge === today) return 0;
  const pending = (await store.list('games')).filter(g => g.track === 'student' && G.isLive(g) &&
    new Date(G.endOf(g, s)) < now && G.SLOTS.some(k => g.slots[k].umpireId && !g.slots[k].worked && !g.slots[k].paidPayoutId));
  if (!pending.length) { await saveJobState({ lastNudge: today }); return 0; }
  const coaches = (await store.list('people')).filter(p => p.registered && p.coach?.teams?.length);
  const unregistered = (await store.list('people')).filter(p => !p.registered && p.coach?.teams?.length);
  const foot = await notify.footer();
  let sent = 0;
  for (const c of [...coaches, ...unregistered]) {
    const mine = pending.filter(g => coachOwns(c, g));
    if (!mine.length) continue;
    const lines = mine.map(g => `• ${G.describe(g).replace('\n', ' – ')}`).join('\n');
    const how = c.registered ? 'Sign in and tap Worked or No-show for each umpire.' : 'Sign up in the app with this email (it links you to your team automatically), then tap Worked or No-show.';
    await notify.toAdult(c, {
      kind: 'coach-nudge', subject: `Please confirm your umpires (${mine.length} game${mine.length > 1 ? 's' : ''})`,
      text: `Our student umpires get paid once a coach confirms they showed up. It takes about ten seconds per game.\n\n${lines}\n\n${how} Only one coach per game needs to do this.${foot}`
    });
    sent++;
  }
  await saveJobState({ lastNudge: today });
  return sent;
}

async function tick(now = new Date()) {
  const s = await getSettings();
  const state = await jobState();
  const out = {};
  for (const [name, fn] of [
    ['reconfirmExpired', () => expireReconfirms(now)],
    ['dayBefore', () => dayBefore(now, s)],
    ['weekly', () => weekly(now, s, state)],
    ['gapAlerts', () => coverageGaps(now, s, state)],
    ['coachNudges', () => coachNudges(now, s, state)]
  ]) {
    try { out[name] = await fn(); } catch (e) { out[name] = `error: ${e.message}`; console.error(name, e); }
  }
  await saveJobState({ lastTickAt: now.toISOString() });
  return out;
}

module.exports = { tick, expireReconfirms, dayBefore, weekly, coverageGaps, coachNudges };
