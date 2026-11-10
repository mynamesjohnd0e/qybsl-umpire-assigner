// Games and umpire slots: classification, sign-up rules, swaps, reconfirming,
// urgent openings and admin overrides.
const crypto = require('crypto');
const store = require('./store');
const notify = require('./notify');
const clock = require('./clock');
const { getSettings } = require('./settings');
const { weekKey, fmtGame, HOUR } = require('./time');
const { firstName } = require('./people');

const SLOTS = ['plate', 'field'];
const SLOT_LABEL = { plate: 'Plate', field: 'Field' };

const gameIdFor = uid => 'g_' + crypto.createHash('sha1').update(String(uid)).digest('hex').slice(0, 16);
const emptySlot = () => ({ umpireId: null, state: 'open', assignedAt: null, reconfirmBy: null, swapId: null, urgent: false, worked: null, confirmedBy: null, confirmedAt: null, paidPayoutId: null });

function newGame(f, track) {
  const now = clock.now().toISOString();
  const g = {
    id: f.id || gameIdFor(f.uid), uid: f.uid, source: f.source || 'feed', feedUrl: f.feedUrl || null,
    season: f.season, division: f.division, track,
    summary: f.summary, home: f.home || '', away: f.away || '',
    field: f.location || f.field || '', start: f.start, end: f.end,
    status: 'scheduled', movedAt: null, cancelledAt: null, cancelReason: null,
    createdAt: now, updatedAt: now, lastSeenAt: now, history: []
  };
  if (track === 'student') g.slots = { plate: emptySlot(), field: emptySlot() };
  else { g.patchedStatus = 'Not requested'; g.patchedNote = ''; }
  return g;
}

function endOf(g, s) {
  if (g.end && g.end > g.start) return g.end;
  return new Date(new Date(g.start).getTime() + (s?.defaultGameMinutes || 120) * 60e3).toISOString();
}

// Decide division and track for a feed event using the settings rules,
// then fall back to the coach list (team name → division).
function classify(ev, settings, teamIndex) {
  const text = [ev.summary, ev.categories, ev.description].filter(Boolean).join(' | ');
  const runRules = t => {
    for (const r of settings.rules || []) {
      const m = new RegExp(r.pattern, 'i').exec(t);
      if (m) return { division: r.division === '$0' ? m[0].toUpperCase().replace(/\s+/g, '') : r.division, track: r.track };
    }
    return null;
  };
  const hit = runRules(text);
  if (hit) return hit;
  for (const name of [ev.home, ev.away]) {
    const team = name && teamIndex.get(name.toLowerCase());
    if (team?.division) {
      const viaDiv = runRules(team.division);
      if (viaDiv) return { division: team.division, track: viaDiv.track };
    }
  }
  return { division: null, track: 'none' };
}

async function teamIndex() {
  const idx = new Map();
  for (const p of await store.list('people')) for (const t of p.coach?.teams || []) idx.set(t.team.toLowerCase(), t);
  return idx;
}

const holds = (g, email) => SLOTS.filter(k => g.slots?.[k]?.umpireId === email);
const isLive = g => g.status !== 'cancelled';

function addHistory(g, what, by) {
  (g.history ||= []).push({ at: clock.now().toISOString(), what, by: by || 'system' });
  if (g.history.length > 40) g.history = g.history.slice(-40);
  g.updatedAt = clock.now().toISOString();
}

// Can this umpire take this slot? Returns a reason string, or null if yes.
// opts.taking: true when the slot is being handed over (swap) rather than open.
function whyNot(person, g, slot, allGames, s, opts = {}) {
  const u = person?.umpire;
  if (!u?.approved) return 'Your umpire account is waiting for approval.';
  if (u.active === false) return 'Your umpire account is inactive.';
  if (g.track !== 'student' || !g.slots?.[slot]) return 'This game does not use student umpires.';
  if (!isLive(g)) return 'This game was cancelled.';
  if (new Date(g.start) <= clock.now()) return 'This game has already started.';
  if (!opts.taking && g.slots[slot].umpireId) return 'That spot was just taken.';
  if (slot === 'plate' && !u.plateQualified) return 'Plate spots are for plate-qualified umpires.';
  if (holds(g, person.email).length) return 'You are already working this game.';
  const wk = weekKey(g.start);
  const mine = allGames.filter(o => o.id !== g.id && isLive(o) && holds(o, person.email).length);
  const inWeek = mine.filter(o => weekKey(o.start) === wk).length;
  if (inWeek >= s.weeklyCap) return `You already have ${s.weeklyCap} games that week (Mon–Sun limit).`;
  const a0 = new Date(g.start), a1 = new Date(endOf(g, s));
  for (const o of mine) {
    const b0 = new Date(o.start), b1 = new Date(endOf(o, s));
    if (a0 < b1 && b0 < a1) return `It overlaps your game at ${fmtGame(o.start)}.`;
  }
  return null;
}

function describe(g) {
  const teams = g.home && g.away ? `${g.away} at ${g.home}` : g.summary;
  return `${g.division} · ${teams}\n${fmtGame(g.start)} · ${g.field || 'Field TBD'}`;
}

async function eligibleUmpires(g, slot, allGames, s, exclude = []) {
  const people = await store.list('people');
  return people.filter(p => p.registered && p.umpire && !exclude.includes(p.email) && !whyNot(p, g, slot, allGames, s));
}

// Tell eligible umpires about open spots. `items` = [{ game, slot }].
async function announceOpenings(items, { urgent = false } = {}) {
  if (!items.length) return;
  const s = await getSettings();
  const all = await store.list('games');
  const people = (await store.list('people')).filter(p => p.registered && p.umpire?.approved && p.umpire.active !== false);
  const foot = await notify.footer();
  await Promise.allSettled(people.map(async p => {
    const mine = items.filter(({ game, slot }) => !whyNot(p, game, slot, all, s));
    if (!mine.length) return;
    const lines = mine.map(({ game, slot }) => `• ${SLOT_LABEL[slot]} – ${describe(game).replace('\n', ' – ')}`).join('\n');
    const subject = urgent ? 'URGENT: umpire needed' : (mine.length === 1 ? 'Umpire spot open' : `${mine.length} umpire spots open`);
    const lead = urgent ? 'An umpire is needed on short notice. First to sign up gets it.' : 'These spots are open. First come, first served.';
    await notify.toUmpire(p, {
      kind: urgent ? 'urgent' : 'opening', gameId: mine[0].game.id, subject,
      text: `${lead}\n\n${lines}${foot}`,
      sms: urgent ? `QYBSL URGENT: ${SLOT_LABEL[mine[0].slot]} umpire needed ${fmtGame(mine[0].game.start)} at ${mine[0].game.field || 'TBD'}. Sign up in the umpire app.`
        : `QYBSL: ${mine.length} umpire spot${mine.length > 1 ? 's' : ''} open. Sign up in the umpire app.`
    });
  }));
}

function release(g, slot, why, by) {
  const prev = g.slots[slot].umpireId;
  g.slots[slot] = emptySlot();
  addHistory(g, `${SLOT_LABEL[slot]} released${prev ? ` (${prev})` : ''}: ${why}`, by);
  return prev;
}

// ── Umpire actions ───────────────────────────────────────────────────────────
async function claim(email, gameId, slot) {
  const s = await getSettings();
  const g = await store.transact(async tx => {
    const game = await tx.get('games', gameId);
    const me = await tx.get('people', email);
    const all = await tx.list('games');
    if (!game) throw new Error('Game not found.');
    const why = whyNot(me, game, slot, all, s);
    if (why) throw new Error(why);
    game.slots[slot] = { ...emptySlot(), umpireId: email, state: 'assigned', assignedAt: clock.now().toISOString() };
    addHistory(game, `${SLOT_LABEL[slot]} claimed by ${email}`, email);
    tx.set('games', gameId, game);
    tx.set('people', email, { ...me, lastClaimAt: clock.now().toISOString() });
    return game;
  });
  const me = await store.get('people', email);
  await notify.toUmpire(me, {
    kind: 'claimed', gameId, subject: `You're umpiring ${fmtGame(g.start)}`,
    text: `You signed up for ${SLOT_LABEL[slot].toLowerCase()} umpire:\n\n${describe(g)}\n\nIf you can't make it, request a swap in the app. You stay responsible until someone takes it.${await notify.footer()}`
  });
  return g;
}

async function requestSwap(email, gameId, slot) {
  const swapId = 's_' + crypto.randomBytes(6).toString('hex');
  const g = await store.transact(async tx => {
    const game = await tx.get('games', gameId);
    if (!game || game.slots?.[slot]?.umpireId !== email) throw new Error('That spot is not yours.');
    if (!isLive(game) || new Date(game.start) <= clock.now()) throw new Error('This game has already started or was cancelled.');
    if (game.slots[slot].swapId) throw new Error('A swap is already posted for this spot.');
    game.slots[slot].swapId = swapId;
    addHistory(game, `${SLOT_LABEL[slot]} swap requested by ${email}`, email);
    tx.set('games', gameId, game);
    tx.set('swaps', swapId, { id: swapId, gameId, slot, fromId: email, toId: null, state: 'open', createdAt: clock.now().toISOString() });
    return game;
  });
  const s = await getSettings();
  const all = await store.list('games');
  const takers = (await store.list('people')).filter(p => p.registered && p.umpire && p.email !== email && !whyNot(p, g, slot, all, s, { taking: true }));
  const foot = await notify.footer();
  await Promise.allSettled(takers.map(p => notify.toUmpire(p, {
    kind: 'swap-offered', gameId, subject: 'Swap available: can you take this game?',
    text: `Another umpire needs someone to take this game:\n\n${SLOT_LABEL[slot]} – ${describe(g)}\n\nAccept it in the app.${foot}`,
    sms: `QYBSL: swap available, ${SLOT_LABEL[slot].toLowerCase()} umpire ${fmtGame(g.start)}. Accept in the umpire app.`
  })));
  return { swapId, offeredTo: takers.length };
}

async function cancelSwap(email, swapId, { admin = false } = {}) {
  await store.transact(async tx => {
    const sw = await tx.get('swaps', swapId);
    if (!sw || sw.state !== 'open') throw new Error('That swap is no longer open.');
    if (!admin && sw.fromId !== email) throw new Error('Not your swap.');
    const game = await tx.get('games', sw.gameId);
    if (game?.slots?.[sw.slot]?.swapId === swapId) {
      game.slots[sw.slot].swapId = null;
      addHistory(game, `${SLOT_LABEL[sw.slot]} swap withdrawn`, email);
      tx.set('games', game.id, game);
    }
    tx.set('swaps', swapId, { ...sw, state: 'cancelled', closedAt: clock.now().toISOString() });
  });
}

async function acceptSwap(email, swapId) {
  const s = await getSettings();
  const { game, sw } = await store.transact(async tx => {
    const sw = await tx.get('swaps', swapId);
    if (!sw || sw.state !== 'open') throw new Error('Someone already took that swap.');
    const game = await tx.get('games', sw.gameId);
    const me = await tx.get('people', email);
    const all = await tx.list('games');
    if (game?.slots?.[sw.slot]?.umpireId !== sw.fromId) throw new Error('That swap is no longer valid.');
    const why = whyNot(me, game, sw.slot, all, s, { taking: true });
    if (why) throw new Error(why);
    game.slots[sw.slot] = { ...emptySlot(), umpireId: email, state: 'assigned', assignedAt: clock.now().toISOString() };
    addHistory(game, `${SLOT_LABEL[sw.slot]} swapped ${sw.fromId} → ${email}`, email);
    tx.set('games', game.id, game);
    const done = { ...sw, toId: email, state: 'accepted', closedAt: clock.now().toISOString() };
    tx.set('swaps', swapId, done);
    tx.set('people', email, { ...me, lastClaimAt: clock.now().toISOString() });
    return { game, sw: done };
  });
  const from = await store.get('people', sw.fromId);
  const to = await store.get('people', email);
  const what = `${SLOT_LABEL[sw.slot]} – ${describe(game)}`;
  const foot = await notify.footer();
  await Promise.allSettled([
    from && notify.toUmpire(from, { kind: 'swap-done', gameId: game.id, subject: 'Your swap went through', text: `${to.name} took your game. You're off it now.\n\n${what}${foot}`, sms: `QYBSL: ${firstName(to.name)} took your ${fmtGame(game.start)} game. You're off it.` }),
    notify.toUmpire(to, { kind: 'swap-done', gameId: game.id, subject: `You took a swap: ${fmtGame(game.start)}`, text: `You're now on this game:\n\n${what}${foot}` }),
    notify.toAlerts({ kind: 'swap-done', gameId: game.id, subject: `Swap: ${from?.name || sw.fromId} → ${to.name}`, text: what })
  ].filter(Boolean));
  return game;
}

async function reconfirm(email, gameId, slot, yes) {
  const g = await store.transact(async tx => {
    const game = await tx.get('games', gameId);
    const sl = game?.slots?.[slot];
    if (!sl || sl.umpireId !== email || sl.state !== 'reconfirm') throw new Error('Nothing to reconfirm here.');
    if (yes) { sl.state = 'assigned'; sl.reconfirmBy = null; addHistory(game, `${SLOT_LABEL[slot]} reconfirmed by ${email}`, email); }
    else release(game, slot, 'declined new time', email);
    tx.set('games', gameId, game);
    return game;
  });
  if (!yes) {
    const me = await store.get('people', email);
    await notify.toAlerts({ kind: 'declined', gameId, subject: `${me.name} can't make the moved game`, text: `${SLOT_LABEL[slot]} is open again:\n\n${describe(g)}` });
    await announceOpenings([{ game: g, slot }]);
  }
  return g;
}

// ── Admin actions ────────────────────────────────────────────────────────────
async function adminAssign(adminEmail, gameId, slot, umpireEmail, force) {
  const s = await getSettings();
  let prev = null;
  const g = await store.transact(async tx => {
    const game = await tx.get('games', gameId);
    if (!game?.slots?.[slot]) throw new Error('Game or spot not found.');
    if (!umpireEmail) {
      prev = release(game, slot, 'removed by admin', adminEmail);
    } else {
      const ump = await tx.get('people', umpireEmail);
      if (!ump?.umpire) throw new Error('That person is not an umpire.');
      const all = await tx.list('games');
      const why = whyNot(ump, game, slot, all, s, { taking: true });
      if (why && !force) { const e = new Error(why); e.needsForce = true; throw e; }
      if (holds(game, umpireEmail).filter(k => k !== slot).length) throw new Error('That umpire already has the other spot on this game.');
      prev = game.slots[slot].umpireId;
      game.slots[slot] = { ...emptySlot(), umpireId: umpireEmail, state: 'assigned', assignedAt: clock.now().toISOString() };
      addHistory(game, `${SLOT_LABEL[slot]} assigned to ${umpireEmail} by admin${why ? ` (override: ${why})` : ''}`, adminEmail);
    }
    tx.set('games', gameId, game);
    return game;
  });
  const foot = await notify.footer();
  if (prev && prev !== umpireEmail) {
    const p = await store.get('people', prev);
    if (p) await notify.toUmpire(p, { kind: 'removed', gameId, subject: `You're off the ${fmtGame(g.start)} game`, text: `An admin took you off this game:\n\n${SLOT_LABEL[slot]} – ${describe(g)}${foot}` });
  }
  if (umpireEmail && prev !== umpireEmail) {
    const p = await store.get('people', umpireEmail);
    await notify.toUmpire(p, { kind: 'assigned', gameId, subject: `You're umpiring ${fmtGame(g.start)}`, text: `An admin put you on this game:\n\n${SLOT_LABEL[slot]} – ${describe(g)}${foot}`, sms: `QYBSL: you're on ${SLOT_LABEL[slot].toLowerCase()} umpire ${fmtGame(g.start)} at ${g.field || 'TBD'}.` });
  }
  return g;
}

// Emergency: free the spot now and blast every eligible umpire.
async function urgentOpening(adminEmail, gameId, slot) {
  let prev = null;
  const g = await store.transact(async tx => {
    const game = await tx.get('games', gameId);
    if (!game?.slots?.[slot]) throw new Error('Game or spot not found.');
    if (game.slots[slot].swapId) {
      const sw = await tx.get('swaps', game.slots[slot].swapId);
      if (sw) tx.set('swaps', sw.id, { ...sw, state: 'cancelled', closedAt: clock.now().toISOString() });
    }
    prev = release(game, slot, 'urgent opening posted', adminEmail);
    game.slots[slot].urgent = true;
    tx.set('games', gameId, game);
    return game;
  });
  if (prev) {
    const p = await store.get('people', prev);
    if (p) await notify.toUmpire(p, { kind: 'removed', gameId, subject: `You're off the ${fmtGame(g.start)} game`, text: `The Director of Umpires released you from this game:\n\n${describe(g)}` });
  }
  await announceOpenings([{ game: g, slot }], { urgent: true });
  return g;
}

async function setPatched(adminEmail, gameId, status, note) {
  if (!['Not requested', 'Requested', 'Confirmed'].includes(status)) throw new Error('Bad status.');
  return store.transact(async tx => {
    const game = await tx.get('games', gameId);
    if (!game || game.track !== 'patched') throw new Error('Not a patched game.');
    game.patchedStatus = status;
    if (note !== undefined) game.patchedNote = String(note).slice(0, 300);
    game.patchedMoved = false;
    addHistory(game, `Patched status → ${status}`, adminEmail);
    tx.set('games', gameId, game);
    return game;
  });
}

module.exports = {
  SLOTS, SLOT_LABEL, gameIdFor, newGame, emptySlot, endOf, classify, teamIndex, holds, isLive,
  addHistory, whyNot, describe, eligibleUmpires, announceOpenings, release,
  claim, requestSwap, cancelSwap, acceptSwap, reconfirm, adminAssign, urgentOpening, setPatched
};
