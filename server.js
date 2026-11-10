// QYBSL Umpire Assigner — web server.
const express = require('express');
const path = require('path');
const store = require('./lib/store');
const clock = require('./lib/clock');
const auth = require('./lib/auth');
const people = require('./lib/people');
const G = require('./lib/games');
const coach = require('./lib/coach');
const payouts = require('./lib/payouts');
const jobs = require('./lib/jobs');
const { runSync } = require('./lib/sync');
const { getSettings, saveSettings } = require('./lib/settings');
const { weekKey, etDateKey } = require('./lib/time');

const TEST_MODE = process.env.TEST_MODE === '1';
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));
app.use(auth.loadUser);

// Wrap async handlers so errors become clean JSON messages.
const h = fn => async (req, res) => {
  try { const out = await fn(req, res); if (!res.headersSent) res.json(out ?? { ok: true }); }
  catch (e) {
    if (!e.message || e.stack?.includes('TypeError')) console.error(e);
    res.status(e.status || 400).json({ error: e.message || 'Something went wrong.', needsForce: !!e.needsForce });
  }
};

app.get('/health', (_req, res) => res.send('ok'));

// ── Sign up / sign in ────────────────────────────────────────────────────────
app.post('/api/auth/signup', h(async (req, res) => {
  const p = await people.signup(req.body || {});
  auth.setCookie(res, await auth.makeToken(p.email));
  const s = await getSettings();
  p.isAdmin = s.adminEmails.includes(p.email);
  return { me: people.selfView(p) };
}));

app.post('/api/auth/login', h(async (req, res) => {
  const email = auth.normEmail(req.body?.email);
  if (auth.lockedOut(email)) throw new Error('Too many tries. Wait 15 minutes, or ask an admin to reset your PIN.');
  const p = await store.get('people', email);
  if (!p?.registered) throw new Error('No PIN set for that email yet. Tap "First time? Sign up".');
  if (!auth.checkPin(req.body?.pin, p.pinHash)) { auth.noteFail(email); throw new Error('Email or PIN is wrong.'); }
  auth.fails.delete(email);
  auth.setCookie(res, await auth.makeToken(email));
  const s = await getSettings();
  p.isAdmin = s.adminEmails.includes(email);
  return { me: people.selfView(p) };
}));

app.post('/api/auth/logout', h(async (_req, res) => { auth.clearCookie(res); }));

app.get('/api/me', h(async req => {
  const s = await getSettings();
  let director = null;
  if (req.user && s.directorEmail) {
    const d = await store.get('people', s.directorEmail);
    director = { name: d?.name || 'Director of Umpires', email: s.directorEmail, mobile: d?.mobile || '' };
  }
  return { me: req.user ? people.selfView(req.user) : null, season: s.seasonLabel, weeklyCap: s.weeklyCap, payRate: s.payRate, director, testMode: TEST_MODE };
}));

app.put('/api/me', auth.requireUser, h(async req => {
  const b = req.body || {};
  const p = await store.get('people', req.user.email);
  if (b.name) p.name = String(b.name).trim();
  if (b.mobile !== undefined) p.mobile = String(b.mobile).trim();
  if (p.umpire) for (const k of ['parentName', 'parentEmail', 'parentMobile', 'venmo']) if (b[k] !== undefined) p.umpire[k] = String(b[k]).trim();
  if (b.newPin) {
    if (!auth.validPin(b.newPin)) throw new Error('PIN must be 4 to 6 digits.');
    p.pinHash = auth.hashPin(b.newPin);
  }
  await store.set('people', p.email, p);
  return { me: people.selfView({ ...p, isAdmin: req.user.isAdmin }) };
}));

// ── Umpires ──────────────────────────────────────────────────────────────────
app.get('/api/umpire/board', auth.requireUser, h(async req => {
  const s = await getSettings();
  const me = req.user;
  const [all, swaps, dir] = await Promise.all([store.list('games'), store.list('swaps'), store.list('people')]);
  const games = all;
  const nameOf = new Map(dir.map(p => [p.email, p.name]));
  const now = clock.now();
  const upcoming = games.filter(g => g.track === 'student' && G.isLive(g) && new Date(g.start) > now)
    .sort((a, b) => a.start.localeCompare(b.start));
  const weekCounts = {};
  for (const g of all) if (G.isLive(g) && G.holds(g, me.email).length) weekCounts[weekKey(g.start)] = (weekCounts[weekKey(g.start)] || 0) + 1;
  const board = upcoming.map(g => {
    const mineSlots = G.holds(g, me.email);
    const slots = {};
    for (const k of G.SLOTS) {
      const sl = g.slots[k];
      const sw = sl.swapId && swaps.find(x => x.id === sl.swapId && x.state === 'open');
      let status = 'open', why = null;
      if (sl.umpireId === me.email) status = 'mine';
      else if (sl.umpireId && sw) { status = 'swap'; why = G.whyNot(me, g, k, all, s, { taking: true }); }
      else if (sl.umpireId) status = 'taken';
      else why = G.whyNot(me, g, k, all, s);
      slots[k] = { status, canTake: (status === 'open' || status === 'swap') && !why, why, swapId: sw ? sw.id : null, urgent: !!sl.urgent, state: sl.state, reconfirmBy: sl.reconfirmBy };
    }
    let partner = null;
    if (mineSlots.length) {
      const other = g.slots[mineSlots[0] === 'plate' ? 'field' : 'plate'].umpireId;
      partner = other ? people.firstName(nameOf.get(other)) : null;
    }
    return { id: g.id, division: g.division, home: g.home, away: g.away, summary: g.summary, field: g.field, start: g.start, end: g.end, movedAt: g.movedAt, week: weekKey(g.start), slots, mine: mineSlots, partner };
  });
  return { board, weekCounts, weeklyCap: s.weeklyCap, pay: me.umpire ? await payouts.myPay(me.email) : [], payRate: s.payRate };
}));

app.post('/api/umpire/claim', auth.requireUmpire, h(async req => { await G.claim(req.user.email, req.body.gameId, req.body.slot); }));
app.post('/api/umpire/swap', auth.requireUmpire, h(async req => G.requestSwap(req.user.email, req.body.gameId, req.body.slot)));
app.post('/api/umpire/swap/:id/cancel', auth.requireUmpire, h(async req => { await G.cancelSwap(req.user.email, req.params.id); }));
app.post('/api/umpire/swap/:id/accept', auth.requireUmpire, h(async req => { await G.acceptSwap(req.user.email, req.params.id); }));
app.post('/api/umpire/reconfirm', auth.requireUmpire, h(async req => { await G.reconfirm(req.user.email, req.body.gameId, req.body.slot, !!req.body.yes); }));

// ── Coaches ──────────────────────────────────────────────────────────────────
app.get('/api/coach/games', auth.requireCoach, h(async req => {
  const games = await coach.coachGames(req.user);
  const dir = new Map((await store.list('people')).map(p => [p.email, p.name]));
  const ratings = (await store.list('ratings')).filter(r => r.coachId === req.user.email && !r.noShow);
  const now = clock.now();
  return {
    pending: !!req.user.coach?.pending, teams: req.user.coach?.teams || [],
    games: games.filter(g => G.isLive(g)).sort((a, b) => b.start.localeCompare(a.start)).map(g => ({
      id: g.id, division: g.division, home: g.home, away: g.away, summary: g.summary, field: g.field, start: g.start,
      started: new Date(g.start) <= now,
      slots: Object.fromEntries(G.SLOTS.map(k => [k, {
        umpire: g.slots[k].umpireId ? dir.get(g.slots[k].umpireId) || g.slots[k].umpireId : null,
        worked: g.slots[k].worked, paid: !!g.slots[k].paidPayoutId,
        myRating: ratings.find(r => r.gameId === g.id && r.slot === k) || null
      }]))
    }))
  };
}));
app.post('/api/coach/confirm', auth.requireCoach, h(async req => { await coach.confirmGame(req.user, req.body.gameId, req.body.results); }));
app.post('/api/coach/rate', auth.requireCoach, h(async req => { await coach.rate(req.user, req.body.gameId, req.body.slot, req.body.score, req.body.comment); }));

// ── Admins and division directors ────────────────────────────────────────────
const A = auth.requireAdmin;
const DA = auth.requireDirectorOrAdmin;

// Throw a 403 unless the user (admin, or a director of the game's division) may
// manage this game.
function ensureManages(user, game) {
  if (!auth.managesDivision(user, game.division)) {
    const e = new Error(`You manage only your division, not ${game.division || 'this'} games.`);
    e.status = 403;
    throw e;
  }
}

app.get('/api/admin/overview', DA, h(async req => {
  const [games, ppl, swaps, runs, jobState] = await Promise.all([
    store.list('games'), store.list('people'), store.list('swaps'), store.list('syncRuns'), store.get('settings', 'jobs')
  ]);
  const s = await getSettings();
  const isAdmin = req.user.isAdmin;
  const dir = new Map(ppl.map(p => [p.email, p.name]));
  const now = clock.now();
  const lastRun = runs.sort((a, b) => b.at.localeCompare(a.at))[0] || null;
  const view = games.sort((a, b) => a.start.localeCompare(b.start)).map(g => {
    let coverage;
    if (g.status === 'cancelled') coverage = 'Cancelled';
    else if (g.track === 'patched') coverage = g.patchedStatus;
    else if (G.SLOTS.some(k => g.slots[k].state === 'reconfirm')) coverage = 'Needs reconfirm';
    else coverage = G.SLOTS.every(k => g.slots[k].umpireId) ? 'Covered' : 'Open';
    return {
      id: g.id, track: g.track, division: g.division, season: g.season, home: g.home, away: g.away, summary: g.summary,
      field: g.field, start: g.start, end: g.end, status: g.status, week: weekKey(g.start), coverage,
      movedAt: g.movedAt, cancelReason: g.cancelReason, source: g.source,
      patchedStatus: g.patchedStatus, patchedNote: g.patchedNote, patchedMoved: !!g.patchedMoved,
      past: new Date(g.start) <= now,
      slots: g.slots ? Object.fromEntries(G.SLOTS.map(k => [k, { ...g.slots[k], name: g.slots[k].umpireId ? dir.get(g.slots[k].umpireId) || g.slots[k].umpireId : null }])) : null,
      history: (g.history || []).slice(-12)
    };
  });
  // A division director sees only their division's games (and the umpires they
  // need to staff them); the board admin sees everything.
  const scoped = isAdmin ? view : view.filter(g => auth.managesDivision(req.user, g.division));
  const peopleOut = isAdmin
    ? ppl.map(people.adminView).map(p => ({ ...p, isAdmin: s.adminEmails.includes(p.email) }))
    : ppl.filter(p => p.umpire).map(people.adminView);
  const unconfirmed = scoped.filter(g => g.track === 'student' && g.status !== 'cancelled' && g.past &&
    G.SLOTS.some(k => g.slots[k].umpireId && !g.slots[k].worked)).length;
  return {
    games: scoped,
    people: peopleOut,
    swaps: swaps.filter(x => x.state === 'open').map(x => ({ ...x, fromName: dir.get(x.fromId) })),
    lastRun, jobs: jobState || {}, today: etDateKey(now), scope: isAdmin ? 'all' : (req.user.director?.divisions || []),
    counts: {
      approvals: isAdmin ? ppl.filter(p => p.registered && p.umpire && !p.umpire.approved).length : 0,
      coaches: isAdmin ? ppl.filter(p => p.registered && p.coach?.pending).length : 0,
      unconfirmed,
      open: scoped.filter(g => g.track === 'student' && g.status !== 'cancelled' && !g.past && g.coverage !== 'Covered').length
    }
  };
}));

app.post('/api/admin/roster/umpires', A, h(async req => people.importUmpires(typeof req.body === 'string' ? req.body : req.body.csv)));
app.post('/api/admin/roster/coaches', A, h(async req => people.importCoaches(typeof req.body === 'string' ? req.body : req.body.csv)));
app.post('/api/admin/roster/players', A, h(async req => {
  const roster = require('./lib/roster');
  const b = typeof req.body === 'string' ? { csv: req.body } : (req.body || {});
  return roster.importPlayers(b.csv, { season: b.season, seasonYear: b.seasonYear });
}));
app.get('/api/admin/players', A, h(async () => ({ players: (await store.list('players')).sort((a, b) => (a.team + a.name).localeCompare(b.team + b.name)) })));
app.get('/api/admin/teams', A, h(async () => {
  const { DIVISIONS } = require('./lib/teams');
  const ppl = new Map((await store.list('people')).map(p => [p.email, p.name]));
  const teams = (await store.list('teams')).sort((a, b) => (a.division + a.name).localeCompare(b.division + b.name))
    .map(t => ({ ...t, headCoach: t.headCoachEmail ? ppl.get(t.headCoachEmail) || t.headCoachEmail : null }));
  return { teams, divisions: DIVISIONS };
}));

app.post('/api/admin/people', A, h(async req => {
  const b = req.body || {};
  const email = auth.normEmail(b.email);
  if (!auth.validEmail(email)) throw new Error('Enter a valid email.');
  if (await store.get('people', email)) throw new Error('That email is already in the list.');
  const p = { email, name: String(b.name || '').trim(), mobile: String(b.mobile || '').trim(), registered: false, pinHash: null, createdAt: clock.now().toISOString(), umpire: null, coach: null };
  if (b.role === 'umpire') p.umpire = { onRoster: true, approved: true, active: true, plateQualified: !!b.plateQualified, parentName: b.parentName || '', parentEmail: auth.normEmail(b.parentEmail), parentMobile: b.parentMobile || '', venmo: b.venmo || '' };
  if (b.role === 'coach') p.coach = { onRoster: true, pending: false, teams: b.team ? [{ team: b.team, division: b.division || '' }] : [] };
  if (b.role === 'director') p.director = { divisions: cleanDivisions(b.divisions || (b.division ? [b.division] : [])) };
  await store.set('people', email, p);
}));

// Keep only real division names (guards against typos granting nothing useful).
function cleanDivisions(list) {
  const { DIVISIONS } = require('./lib/teams');
  const want = (Array.isArray(list) ? list : [list]).map(d => String(d || '').trim());
  const bad = want.filter(d => d && !DIVISIONS.includes(d));
  if (bad.length) throw new Error(`Not a division: ${bad.join(', ')}. Use one of: ${DIVISIONS.join(', ')}.`);
  return [...new Set(want.filter(Boolean))];
}

app.put('/api/admin/people/:email', A, h(async req => {
  const email = auth.normEmail(req.params.email);
  const p = await store.get('people', email);
  if (!p) throw new Error('Not found.');
  const b = req.body || {};
  if (b.name !== undefined) p.name = String(b.name).trim();
  if (b.mobile !== undefined) p.mobile = String(b.mobile).trim();
  if (b.umpire && p.umpire) {
    for (const k of ['approved', 'plateQualified', 'active']) if (k in b.umpire) p.umpire[k] = !!b.umpire[k];
    for (const k of ['parentName', 'parentEmail', 'parentMobile', 'venmo']) if (k in b.umpire) p.umpire[k] = String(b.umpire[k]).trim();
  }
  if (b.coach) {
    p.coach = p.coach || { onRoster: true, teams: [] };
    if (Array.isArray(b.coach.teams)) p.coach.teams = b.coach.teams.filter(t => t.team).map(t => ({ team: String(t.team).trim(), division: String(t.division || '').trim() }));
    p.coach.pending = false;
  }
  // Grant, change or clear division-director status. An empty list removes it.
  if (b.director !== undefined) {
    const divisions = cleanDivisions(b.director?.divisions ?? b.director ?? []);
    p.director = divisions.length ? { divisions } : null;
  }
  await store.set('people', email, p);
}));

app.post('/api/admin/people/:email/reset-pin', A, h(async req => {
  const email = auth.normEmail(req.params.email);
  const p = await store.get('people', email);
  if (!p) throw new Error('Not found.');
  p.registered = false; p.pinHash = null;
  await store.set('people', email, p);
  return { message: `${p.name || email} can now sign up again with a new PIN.` };
}));

app.delete('/api/admin/people/:email', A, h(async req => {
  const email = auth.normEmail(req.params.email);
  const games = await store.list('games');
  if (games.some(g => G.isLive(g) && new Date(g.start) > clock.now() && G.holds(g, email).length)) throw new Error('Take them off their upcoming games first.');
  await store.del('people', email);
}));

app.post('/api/admin/games', A, h(async req => {
  const b = req.body || {};
  if (!b.start || !b.division) throw new Error('Date/time and division are required.');
  const track = ['student', 'patched'].includes(b.track) ? b.track : 'student';
  const s = await getSettings();
  const uid = `manual-${clock.now().getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  const start = new Date(b.start).toISOString();
  const end = b.end ? new Date(b.end).toISOString() : new Date(new Date(start).getTime() + s.defaultGameMinutes * 60e3).toISOString();
  const g = G.newGame({ uid, source: 'manual', season: b.season || s.seasonLabel, division: b.division, summary: b.summary || `${b.away || ''} at ${b.home || ''}`.trim(), home: b.home, away: b.away, location: b.field, start, end }, track);
  G.addHistory(g, 'Added by admin', req.user.email);
  await store.set('games', g.id, g);
  if (track === 'student' && b.announce) await G.announceOpenings(G.SLOTS.map(k => ({ game: g, slot: k })));
  return { id: g.id };
}));

app.post('/api/admin/games/:id/cancel', A, h(async req => {
  const g = await store.get('games', req.params.id);
  if (!g) throw new Error('Not found.');
  const who = g.slots ? G.SLOTS.map(k => g.slots[k].umpireId).filter(Boolean) : [];
  g.status = 'cancelled'; g.cancelledAt = clock.now().toISOString(); g.cancelReason = 'cancelled by admin';
  if (g.slots) G.SLOTS.forEach(k => { g.slots[k] = G.emptySlot(); });
  G.addHistory(g, 'Cancelled by admin', req.user.email);
  await store.set('games', g.id, g);
  const notify = require('./lib/notify');
  for (const e of who) {
    const p = await store.get('people', e);
    if (p) await notify.toUmpire(p, { kind: 'cancelled', gameId: g.id, subject: 'Game cancelled', text: `This game was cancelled, so you're off it:\n\n${G.describe(g)}`, sms: 'QYBSL: one of your umpire games was cancelled. Check the app.' });
  }
}));

app.post('/api/admin/games/:id/assign', DA, h(async req => {
  const g = await store.get('games', req.params.id);
  if (!g) throw new Error('Game not found.');
  ensureManages(req.user, g);
  await G.adminAssign(req.user.email, req.params.id, req.body.slot, req.body.umpireId || null, !!req.body.force);
}));
app.post('/api/admin/games/:id/urgent', DA, h(async req => {
  const g = await store.get('games', req.params.id);
  if (!g) throw new Error('Game not found.');
  ensureManages(req.user, g);
  await G.urgentOpening(req.user.email, req.params.id, req.body.slot);
}));
app.post('/api/admin/games/:id/patched', A, h(async req => { await G.setPatched(req.user.email, req.params.id, req.body.status, req.body.note); }));
app.post('/api/admin/games/:id/confirm', A, h(async req => { await coach.confirmGame(req.user, req.params.id, req.body.results); }));
app.post('/api/admin/swaps/:id/cancel', A, h(async req => { await G.cancelSwap(req.user.email, req.params.id, { admin: true }); }));

app.post('/api/admin/sync', A, h(async req => runSync({ by: req.user.email })));

// Upload the schedule exported from SportsEngine HQ (CSV) or an .ics file.
// Each upload replaces the last one and is synced right away; later uploads
// work like a feed refresh (moved and cancelled games are handled the same way).
app.post('/api/admin/schedule-upload', A, h(async req => {
  const b = req.body || {};
  const text = String(b.text || '');
  if (text.length < 20) throw new Error('That file looks empty.');
  const { looksLikeSeCsv } = require('./lib/secsv');
  if (!looksLikeSeCsv(text) && !text.includes('BEGIN:VCALENDAR')) throw new Error('This doesn\'t look like a SportsEngine schedule export (CSV) or a calendar (.ics) file.');
  const shiftDays = TEST_MODE ? Math.round(Number(b.shiftDays) || 0) : 0;
  const s = await getSettings();
  const season = String(b.season || s.seasonLabel).trim();
  await store.set('uploads', 'main', { text, season, shiftDays, filename: String(b.filename || ''), uploadedAt: clock.now().toISOString(), by: req.user.email });
  const feeds = (s.feeds || []).filter(f => f.url !== 'upload:main').concat([{ url: 'upload:main', season, shiftDays }]);
  await saveSettings({ feeds });
  return runSync({ by: req.user.email });
}));

app.get('/api/admin/schedule-upload', A, h(async () => {
  const d = await store.get('uploads', 'main');
  return d ? { filename: d.filename, uploadedAt: d.uploadedAt, by: d.by, season: d.season, shiftDays: d.shiftDays, size: d.text.length } : {};
}));

// Test copy only: wipe practice data and start over.
app.post('/api/admin/test/reset', A, h(async req => {
  if (!TEST_MODE) throw new Error('Reset is only available on the test copy.');
  const out = {};
  for (const c of ['games', 'swaps', 'ratings', 'payouts', 'syncLog', 'syncRuns', 'outbox', 'uploads']) out[c] = await store.clear(c);
  if (!req.body?.keepPeople) {
    const s = await getSettings();
    for (const p of await store.list('people')) if (!s.adminEmails.includes(p.email)) await store.del('people', p.email);
  }
  await store.update('settings', 'jobs', { lastWeekly: null, lastGapAlert: null, lastNudge: null });
  const s = await getSettings();
  await saveSettings({ feeds: (s.feeds || []).filter(f => f.url !== 'upload:main') });
  return out;
}));
app.get('/api/admin/synclog', A, h(async () => {
  const [runs, log] = await Promise.all([store.list('syncRuns'), store.list('syncLog')]);
  return {
    runs: runs.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30),
    changes: log.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300)
  };
}));

app.get('/api/admin/ratings', A, h(async () => {
  const dir = new Map((await store.list('people')).map(p => [p.email, p.name]));
  const games = new Map((await store.list('games')).map(g => [g.id, g]));
  const rows = await coach.ratingSummary();
  for (const r of rows) for (const x of r.ratings) {
    x.coachName = dir.get(x.coachId) || x.coachId;
    const g = games.get(x.gameId);
    x.game = g ? `${g.division} · ${g.away && g.home ? `${g.away} at ${g.home}` : g.summary} · ${etDateKey(g.start)}` : x.gameId;
  }
  return { rows };
}));

app.get('/api/admin/payouts/preview', A, h(async req => payouts.preview(req.query.end)));
app.post('/api/admin/payouts/pay', A, h(async req => payouts.markPaid(req.body.end, req.user.email)));
app.get('/api/admin/payouts', A, h(async () => ({ payouts: (await store.list('payouts')).sort((a, b) => b.paidAt.localeCompare(a.paidAt)) })));
app.get('/api/admin/payouts/csv', A, async (req, res) => {
  try {
    const rep = req.query.id ? await store.get('payouts', req.query.id) : await payouts.preview(req.query.end);
    if (!rep) return res.status(404).send('Not found');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="QYBSL_Umpire_Payout_${rep.periodEnd}.csv"`);
    res.send(payouts.toCsv(rep));
  } catch (e) { res.status(400).send(e.message); }
});

app.get('/api/admin/settings', A, h(async () => getSettings()));
app.put('/api/admin/settings', A, h(async req => saveSettings(req.body || {})));
app.get('/api/admin/outbox', A, h(async () => ({ messages: (await store.list('outbox')).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300) })));
app.post('/api/admin/run-jobs', A, h(async () => jobs.tick()));

// ── Scheduled jobs (Cloud Scheduler) ─────────────────────────────────────────
function cronAuth(req, res, next) {
  const key = process.env.CRON_KEY;
  if (!key || req.headers['x-cron-key'] !== key) return res.status(403).json({ error: 'Bad cron key.' });
  next();
}
app.post('/api/cron/sync', cronAuth, h(async () => runSync({ by: 'nightly' })));
app.post('/api/cron/tick', cronAuth, h(async () => jobs.tick()));

app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Umpire Assigner on :${PORT} (storage: ${store.USE_FIRESTORE ? 'Firestore' : 'local file'})`));
}

module.exports = app;
