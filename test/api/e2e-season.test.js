// Sprint 10 — the whole-app dress rehearsal. One synthetic league across all
// five divisions, walked through a season in the order a real season uses the
// features, as the real roles, checking each feature's outcome AND the handoff
// to the next. Where a per-feature test file proves a rule to its boundaries,
// this proves the features work together on one dataset.
//
// Phases run in order and share state (the league is built once in before()).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
const { buildLeague2027, coachEmail } = require('../helpers/league2027');
const { etDateKey, addDaysToKey } = require('../../lib/time');
H.setupEnv({ adminEmails: 'john@qybsl.test' });

let app, L;
const G = {}; // game ids discovered along the way

before(async () => {
  app = await H.startApp();
  H.reset();
  L = await buildLeague2027(app);
});
after(() => app.close());

// Find an imported game by a substring of its summary or a team name.
async function overview() { return (await app.ok('john', 'GET', '/api/admin/overview')).games; }
function find(games, sub) {
  const g = games.find(x => (x.summary || '').includes(sub) || (x.home || '').includes(sub) || (x.away || '').includes(sub));
  if (!g) throw new Error(`no game matching "${sub}"`);
  return g;
}
// Create a completed (past) game directly, the way a game that has been played
// sits in the schedule. Returns its id.
async function playedGame(division, home, away, hoursAgo = 3, field = 'Quarry Hills Field A') {
  const start = new Date(Date.now() - hoursAgo * 3600e3).toISOString();
  const { id } = await app.ok('john', 'POST', '/api/admin/games', { start, division, home, away, field });
  return id;
}

// ── Phase 1 · Import the season schedule ─────────────────────────────────────

test('phase 1 · a multi-division schedule previews true and imports clean', async () => {
  const prev = await app.ok('john', 'POST', '/api/admin/schedule-upload/preview', { text: L.scheduleText, season: 'Spring 2027' });
  const act = await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: L.scheduleText, filename: 'season.csv', season: 'Spring 2027' });

  // Preview told the truth.
  assert.deepStrictEqual(prev.counts, act.counts, `preview ${JSON.stringify(prev.counts)} vs actual ${JSON.stringify(act.counts)}`);
  // Five divisions imported; the T-ball game was skipped, not imported.
  assert.strictEqual(act.counts.new, 5, JSON.stringify(act.counts));
  assert(act.counts.skipped >= 1, 'T-ball skipped');
  // Every Quincy team matched the coach list.
  assert.deepStrictEqual(act.unmatchedTeams, [], JSON.stringify(act.unmatchedTeams));

  const games = await overview();
  for (const div of ['Farm 8', 'Farm 9', 'Minors', 'Majors', 'Babe Ruth']) {
    assert(games.some(g => g.division === div), `a ${div} game was imported`);
  }
  assert(!games.some(g => /T-?Ball/i.test(g.summary || '')), 'the T-ball game is not on the board');
  // Farm games take student umpires; the rest are patched.
  assert.strictEqual(find(games, 'Granite Co').track, 'student');
  assert.strictEqual(find(games, 'Keohanes').track, 'patched');

  G.farm8 = find(games, 'Granite Co').id;
  G.farm9 = find(games, 'Adams Press').id;
  G.majors = find(games, 'Keohanes').id;
});

// ── Phase 2 · Rosters became league ages (birthdates discarded) ──────────────

test('phase 2 · player rosters load as league ages, with no birthdate kept', async () => {
  const players = Object.fromEntries((await app.ok('john', 'GET', '/api/admin/players')).players.map(p => [p.name, p]));
  // The April 30 boundary: born on the cutoff is 12; a day later is 11.
  assert.strictEqual(players['Theo B'].leagueAge, 12, 'born Apr 30 → 12');
  assert.strictEqual(players['Ivo B'].leagueAge, 11, 'born May 1 → 11');
  assert.strictEqual(players['Gus B'].leagueAge, 12);
  assert.strictEqual(players['Max B'].leagueAge, 10);
  assert.strictEqual(players['Rhys B'].leagueAge, 9);
  // Players are minors: no birthdate, no contact details are kept.
  for (const p of Object.values(players)) {
    assert(!('birthdate' in p) && !('birth' in p) && !('dob' in p), `no birthdate kept for ${p.name}`);
    assert(!('email' in p) && !('mobile' in p), `no contact kept for ${p.name}`);
  }
});

// ── Phase 3 · Umpires staff the games ────────────────────────────────────────

test('phase 3 · students claim and swap Farm games; a director assigns a patched Majors game', async () => {
  // Farm 8 is a student game with a plate and a field slot.
  await app.fails(/plate-qualified/, 'ben@ump.test', 'POST', '/api/umpire/claim', { gameId: G.farm8, slot: 'plate' });
  await app.ok('alice@ump.test', 'POST', '/api/umpire/claim', { gameId: G.farm8, slot: 'plate' });
  await app.ok('ben@ump.test', 'POST', '/api/umpire/claim', { gameId: G.farm8, slot: 'field' });

  // Alice offers her plate spot. Ben (not plate-qualified) can't take it; Cara can.
  const sw = await app.ok('alice@ump.test', 'POST', '/api/umpire/swap', { gameId: G.farm8, slot: 'plate' });
  await app.fails(/plate-qualified/, 'ben@ump.test', 'POST', `/api/umpire/swap/${sw.swapId}/accept`);
  await app.ok('cara@ump.test', 'POST', `/api/umpire/swap/${sw.swapId}/accept`);

  let games = await overview();
  const f8 = find(games, 'Granite Co');
  assert.strictEqual(f8.slots.plate.umpireId, 'cara@ump.test', 'the plate spot swapped to Cara');
  assert.strictEqual(f8.slots.field.umpireId, 'ben@ump.test', 'Ben still has the field spot');

  // The Majors game is patched: it carries an assignor status, not sign-up slots.
  const maj = find(games, 'Keohanes');
  assert.strictEqual(maj.track, 'patched');
  assert(!maj.slots, 'a patched game has no student slots');
  await app.ok('john', 'POST', `/api/admin/games/${G.majors}/patched`, { status: 'Confirmed', note: '2 from the assignor' });
  games = await overview();
  assert.strictEqual(find(games, 'Keohanes').patchedStatus, 'Confirmed', 'the assignor marked it confirmed');

  // An urgent opening on the Farm 9 game asks the umpire pool to fill it.
  const before = (await H.outbox()).length;
  await app.ok('john', 'POST', `/api/admin/games/${G.farm9}/urgent`, { slot: 'plate' });
  assert((await H.outbox()).length > before, 'the urgent opening messaged the umpires');
});

// ── Phase 4 · Scores run every path to final ─────────────────────────────────

async function gameById(id) {
  const g = (await overview()).find(x => x.id === id);
  if (!g) throw new Error(`no game with id ${id}`);
  return g;
}
async function scoreOf(id) { return (await gameById(id)).score; }

test('phase 4 · scores go final by confirm, settle, forfeit, approval and auto-confirm', async () => {
  // (a) Home enters, away confirms → final.
  G.scoreA = await playedGame('Minors', 'Balduccis', 'Colonial Fed');
  await app.ok(coachEmail('Balduccis'), 'POST', '/api/coach/score', { gameId: G.scoreA, homeRuns: 5, awayRuns: 3 });
  await app.ok(coachEmail('Colonial Fed'), 'POST', '/api/coach/score/confirm', { gameId: G.scoreA, homeRuns: 5, awayRuns: 3 });
  assert.strictEqual((await scoreOf(G.scoreA)).status, 'final');

  // (b) Away disputes, the Minors director settles → final at the settled score.
  G.scoreB = await playedGame('Minors', 'Hancock Tavern', 'Curry Hardware');
  await app.ok(coachEmail('Hancock Tavern'), 'POST', '/api/coach/score', { gameId: G.scoreB, homeRuns: 2, awayRuns: 1 });
  await app.ok(coachEmail('Curry Hardware'), 'POST', '/api/coach/score/dispute', { gameId: G.scoreB, note: 'we had 3' });
  assert.strictEqual((await scoreOf(G.scoreB)).status, 'disputed');
  await app.ok('mdir@qybsl.test', 'POST', `/api/admin/games/${G.scoreB}/score/settle`, { homeRuns: 3, awayRuns: 1 });
  assert.strictEqual((await scoreOf(G.scoreB)).status, 'final');

  // (c) A forfeit is 6–0 to the winner.
  G.scoreC = await playedGame('Minors', 'Colonial Fed', 'Curry Hardware');
  await app.ok('mdir@qybsl.test', 'POST', `/api/admin/games/${G.scoreC}/score/forfeit`, { winner: 'home' });
  let sc = await scoreOf(G.scoreC);
  assert.strictEqual(sc.status, 'final');
  assert.deepStrictEqual([sc.homeRuns, sc.awayRuns, sc.forfeit], [6, 0, true]);

  // (d) An out-of-town game waits for the division director's approval — it never
  // auto-confirms.
  G.scoreD = await playedGame('Babe Ruth', 'Quincy Legion', 'South Boston', 3, 'Adams Field');
  const dEnter = await app.ok(coachEmail('Quincy Legion'), 'POST', '/api/coach/score', { gameId: G.scoreD, homeRuns: 7, awayRuns: 4 });
  assert.strictEqual(dEnter.status, 'approval');
  assert.strictEqual(dEnter.autoConfirmBy, null);
  await app.ok('brdir@qybsl.test', 'POST', `/api/admin/games/${G.scoreD}/score/approve`, {});
  assert.strictEqual((await scoreOf(G.scoreD)).status, 'final');

  // (e) Home enters, the away coach never responds → the 24-hour job confirms it.
  G.scoreE = await playedGame('Minors', 'Balduccis', 'Curry Hardware');
  await app.ok(coachEmail('Balduccis'), 'POST', '/api/coach/score', { gameId: G.scoreE, homeRuns: 8, awayRuns: 2 });
  assert.strictEqual((await scoreOf(G.scoreE)).status, 'entered');
  const n = await H.jobs().scoreAutoConfirm(new Date(Date.now() + 25 * 3600e3));
  assert(n >= 1, 'the auto-confirm job confirmed at least the waiting score');
  const e = await scoreOf(G.scoreE);
  assert.strictEqual(e.status, 'final');
  assert.strictEqual(e.confirmedHow, 'auto');
});

// ── Phase 5 · Standings and playoff brackets ─────────────────────────────────

test('phase 5 · Minors standings add up, and a director records a coin toss', async () => {
  const rows = (await app.ok('john', 'GET', '/api/standings')).standings['Minors'];
  const names = rows.map(r => r.team).sort();
  assert.deepStrictEqual(names, ['Balduccis', 'Colonial Fed', 'Curry Hardware', 'Hancock Tavern']);
  // The ledger balances: every win is someone's loss.
  assert.strictEqual(rows.reduce((n, r) => n + r.wins, 0), rows.reduce((n, r) => n + r.losses, 0));
  // Win% never increases and rank never decreases down the table.
  for (let i = 1; i < rows.length; i++) {
    assert(rows[i - 1].winPct >= rows[i].winPct, 'win% sorted');
    assert(rows[i - 1].rank <= rows[i].rank, 'rank sorted');
  }
  // The division director can record a coin toss; a coach cannot.
  await app.ok('mdir@qybsl.test', 'POST', '/api/admin/standings/coin-toss', { division: 'Minors', order: ['Balduccis', 'Hancock Tavern'] });
  await app.fails(null, coachEmail('Balduccis'), 'POST', '/api/admin/standings/coin-toss', { division: 'Minors', order: ['Balduccis', 'Hancock Tavern'] });
});

test('phase 5 · Majors seeds a double-elimination bracket; Farm 8 a single', async () => {
  await app.ok('john', 'POST', '/api/admin/bracket/seeds', { division: 'Majors', order: L.DIVISIONS['Majors'] });
  const maj = await app.ok('john', 'GET', '/api/admin/bracket?division=Majors');
  assert.strictEqual(maj.seeds.length, 6, 'all six Majors teams seeded');
  assert(maj.matches.some(m => m.id === 'GF2'), 'the if-needed final marks a double-elimination bracket');
  // Higher seed is home in the first round.
  for (const m of maj.matches.filter(m => m.round === 1 && m.home && m.away)) {
    assert(maj.seeds.indexOf(m.home) < maj.seeds.indexOf(m.away), 'higher seed is home');
  }

  await app.ok('john', 'POST', '/api/admin/bracket/seeds', { division: 'Farm 8', order: L.DIVISIONS['Farm 8'] });
  const f8 = await app.ok('john', 'GET', '/api/admin/bracket?division=Farm%208');
  assert.strictEqual(f8.seeds.length, 4);
  assert(!f8.matches.some(m => m.id === 'GF2'), 'Farm 8 is single elimination');

  // Division directors see only their own bracket.
  await app.ok('f8dir@qybsl.test', 'GET', '/api/admin/bracket?division=Farm%208');
  assert.strictEqual((await app.call('f8dir@qybsl.test', 'GET', '/api/admin/bracket?division=Majors')).status, 403);
});

// ── Phase 6 · Pitch counts, rest and the 12-year-old weekly cap ───────────────

const bald = coachEmail('Balduccis');
const pid = name => encodeURIComponent(L.players[name].id);

test('phase 6 · an over-limit count warns once and rest is enforced on the 5th day', async () => {
  // Max B (age 10, 75 max) throws 100 — over by more than the finish-the-batter
  // tolerance, so it's a violation. The Minors director hears once, even on an edit.
  const gv = await playedGame('Minors', 'Balduccis', 'Colonial Fed');
  const r1 = await app.ok(bald, 'POST', '/api/coach/pitches', { gameId: gv, playerId: L.players['Max B'].id, pitches: 100 });
  assert.strictEqual(r1.check.status, 'violation');
  const daily = async () => (await H.outbox()).filter(m => m.kind === 'pitch-daily' && m.to === 'mdir@qybsl.test');
  assert.strictEqual((await daily()).length, 1, 'the Minors director is emailed once');
  await app.ok(bald, 'POST', '/api/coach/pitches', { gameId: gv, playerId: L.players['Max B'].id, pitches: 110 });
  assert.strictEqual((await daily()).length, 1, 'still one email for the one problem');
  // The count still saved — the app warns, never blocks.
  const line = (await app.ok('john', 'GET', `/api/admin/games/${gv}/pitchlog`)).log.find(l => l.playerName === 'Max B');
  assert.strictEqual(line.pitches, 110);
  assert.strictEqual(line.violation, true);

  // Rhys B (age 9) throws 66 → four days rest → eligible on the fifth day (John's
  // ruling: pitch today, eligible on day five).
  const gr = await playedGame('Minors', 'Balduccis', 'Hancock Tavern');
  await app.ok(bald, 'POST', '/api/coach/pitches', { gameId: gr, playerId: L.players['Rhys B'].id, pitches: 66 });
  const pitchDay = etDateKey(new Date((await gameById(gr)).start));
  const elig = d => app.ok(bald, 'GET', `/api/pitching/eligibility?playerId=${pid('Rhys B')}&date=${d}`);
  const day4 = await elig(addDaysToKey(pitchDay, 4));
  const day5 = await elig(addDaysToKey(pitchDay, 5));
  assert.strictEqual(day4.available, false, 'still resting on day four');
  assert.strictEqual(day5.available, true, 'eligible on the fifth day');
  assert.strictEqual(day4.restingUntil, addDaysToKey(pitchDay, 5), 'rests until the fifth day');

  // That rest shows on a later playoff game's pre-game eligibility screen.
  const playoff = await playedGame('Minors', 'Balduccis', 'Curry Hardware', -72); // three days out
  const screen = await app.ok(bald, 'GET', `/api/games/${playoff}/eligibility`);
  const rhys = screen.home.pitchers.find(p => p.name === 'Rhys B');
  assert.strictEqual(rhys.available, false, 'Rhys is still resting at the playoff game');
});

test('phase 6 · two 12-year-olds combine toward the weekly innings cap', async () => {
  // Theo (6 innings = 18 outs) + Gus (6 = 18) = 12 innings, exactly at the cap.
  const w1 = await playedGame('Minors', 'Balduccis', 'Colonial Fed', 5);
  const w2 = await playedGame('Minors', 'Balduccis', 'Hancock Tavern', 4); // same week
  await app.ok(bald, 'POST', '/api/coach/pitches', { gameId: w1, playerId: L.players['Theo B'].id, pitches: 30, outs: 18 });
  const atCap = await app.ok(bald, 'POST', '/api/coach/pitches', { gameId: w1, playerId: L.players['Gus B'].id, pitches: 30, outs: 18 });
  assert.strictEqual(atCap.weekly.over, false, 'twelve innings is at the cap, not over');
  // One more inning from Gus pushes the team's 12-year-olds over 12 innings.
  const over = await app.ok(bald, 'POST', '/api/coach/pitches', { gameId: w2, playerId: L.players['Gus B'].id, pitches: 10, outs: 3 });
  assert.strictEqual(over.weekly.over, true, 'thirteen combined innings is over the cap');
  const weekly = (await H.outbox()).filter(m => m.kind === 'pitch-weekly' && m.to === 'mdir@qybsl.test');
  assert(weekly.length >= 1, 'the Minors director was emailed about the weekly cap');
});

// ── Phase 7 · Rainouts and makeups ───────────────────────────────────────────

test('phase 7 · closing a field rains its game out, and reopening puts it back', async () => {
  const g = await gameById(G.farm8);
  const date = etDateKey(new Date(g.start));
  const commsBefore = (await H.outbox()).filter(m => m.kind === 'comms-rainout').length;

  const r = await app.ok('john', 'POST', '/api/admin/closures', { fields: [g.field], date, reason: 'rain' });
  assert.strictEqual((await gameById(G.farm8)).status, 'rainout', 'the Farm 8 game is rained out');
  // The assigned umpires were told, and the comms director got one ready-to-post note.
  const out = await H.outbox();
  assert(out.some(m => m.to === 'cara@ump.test'), 'the plate umpire was notified');
  assert.strictEqual(out.filter(m => m.kind === 'comms-rainout').length, commsBefore + 1, 'one comms note');

  await app.ok('john', 'POST', `/api/admin/closures/${r.closureId}/reopen`, {});
  assert.strictEqual((await gameById(G.farm8)).status, 'scheduled', 'reopening puts the game back on');
  assert((await H.outbox()).some(m => m.kind === 'reopened'), 'people were told it is back on');
});

test('phase 7 · a re-upload pairs the makeup to its rained-out original', async () => {
  // Rain it out again, then upload a schedule with the original gone and a later
  // rematch of the same teams in its place.
  const g = await gameById(G.farm8);
  await app.ok('john', 'POST', '/api/admin/closures', { fields: [g.field], date: etDateKey(new Date(g.start)), reason: 'rain' });
  assert.strictEqual((await gameById(G.farm8)).status, 'rainout');

  const specs = L.schedule.filter(s => s.div !== 'Farm 8').concat([
    { div: 'Farm 8', home: 'Granite Co', away: 'Harborside HVAC', day: 12, time: '5:30 PM', field: 'Quarry Hills - Field B' }
  ]);
  const r = await app.ok('john', 'POST', '/api/admin/schedule-upload', { text: L.buildCsv(specs), filename: 'makeup.csv', season: 'Spring 2027' });
  assert.strictEqual(r.counts.makeups, 1, `one makeup paired: ${JSON.stringify(r.counts)}`);

  const games = await overview();
  const makeup = games.find(x => x.makeupOf === G.farm8);
  assert(makeup, 'the makeup links back to the rained-out game');
  assert.strictEqual(games.find(x => x.id === G.farm8).madeUpBy, makeup.id, 'the original records its makeup');
  assert.strictEqual(makeup.slots.field.umpireId, 'ben@ump.test', 'the umpire is carried onto the makeup');
});

// ── Phase 8 · Snack Shack sign-ups ───────────────────────────────────────────

const publicShifts = async () => (await app.ok('pub', 'GET', '/api/public/snack/shifts')).shifts;

test('phase 8 · the public can fill a shift, the page leaks nothing, and the last spot is safe', async () => {
  const day = addDaysToKey(etDateKey(new Date()), 1);
  const sh = await app.ok('john', 'POST', '/api/admin/snack/shifts', { date: day, start: '9:00 AM', end: '12:00 PM', peopleNeeded: 2, title: 'Opening day table' });

  const jane = await app.ok('pub', 'POST', '/api/public/snack/signup', { shiftId: sh.id, name: 'Jane Volunteer', email: 'jane@fam.test', mobile: '6175550000' });
  await app.ok('pub', 'POST', '/api/public/snack/signup', { shiftId: sh.id, name: 'Ravi Volunteer', email: 'ravi@fam.test', mobile: '6175550001' });
  // The shift is full: a third sign-up is turned away.
  await app.fails(/full/i, 'pub', 'POST', '/api/public/snack/signup', { shiftId: sh.id, name: 'Mo Volunteer', email: 'mo@fam.test', mobile: '6175550002' });

  // The public page shows how many spots are left but never a volunteer's details.
  const blob = JSON.stringify(await publicShifts());
  for (const leak of ['Jane Volunteer', 'jane@fam.test', 'ravi@fam.test', '6175550000', 'volunteers']) {
    assert(!blob.includes(leak), `the public page must not leak ${leak}`);
  }
  assert.strictEqual((await publicShifts()).find(s => s.id === sh.id).spotsLeft, 0);
  // The manager, signed in, does see the volunteers.
  const mgr = (await app.ok('john', 'GET', '/api/admin/snack')).shifts.find(s => s.id === sh.id);
  assert(mgr.volunteers.some(v => v.email === 'jane@fam.test'), 'the manager sees emails');

  // Jane cancels with her link; a guessed token is refused.
  await app.fails(/not valid/, 'pub', 'POST', '/api/public/snack/cancel', { s: jane.signupId, t: 'deadbeef' });
  const c = await app.ok('pub', 'POST', '/api/public/snack/cancel', { s: jane.signupId, t: jane.token });
  assert.strictEqual(c.cancelled, true);
  assert.strictEqual((await publicShifts()).find(s => s.id === sh.id).spotsLeft, 1, 'her spot reopened');
});

test('phase 8 · a full-day closure cancels that day\'s shifts and tells the volunteers', async () => {
  const day = addDaysToKey(etDateKey(new Date()), 2);
  const sh = await app.ok('john', 'POST', '/api/admin/snack/shifts', { date: day, start: '9:00 AM', peopleNeeded: 2 });
  await app.ok('pub', 'POST', '/api/public/snack/signup', { shiftId: sh.id, name: 'Sam Volunteer', email: 'sam@fam.test', mobile: '6175550003' });

  const r = await app.ok('john', 'POST', '/api/admin/closures', { all: true, date: day, reason: 'storm' });
  assert(r.shiftsCancelled >= 1, 'the shift was cancelled with the closure');
  assert((await H.outbox()).some(m => m.kind === 'snack-cancelled' && m.to === 'sam@fam.test'), 'the volunteer was told');
});

// ── Phase 9 · Payouts ────────────────────────────────────────────────────────

test('phase 9 · a worked umpire is paid once; a no-show is not', async () => {
  // A finished Farm 8 game: Alice worked the plate, Ben was a no-show on the field.
  const id = await playedGame('Farm 8', 'Granite Co', 'Harborside HVAC');
  await app.ok('john', 'POST', `/api/admin/games/${id}/assign`, { slot: 'plate', umpireId: 'alice@ump.test', force: true });
  await app.ok('john', 'POST', `/api/admin/games/${id}/assign`, { slot: 'field', umpireId: 'ben@ump.test', force: true });
  await app.ok(coachEmail('Granite Co'), 'POST', '/api/coach/confirm', { gameId: id, results: { plate: 'worked', field: 'noshow' } });

  const end = addDaysToKey(etDateKey(new Date()), 14);
  const pv = await app.ok('john', 'GET', `/api/admin/payouts/preview?end=${end}`);
  const alice = pv.lines.find(l => l.name === 'Alice Reed');
  assert(alice, 'Alice is on the payout');
  assert.strictEqual(alice.amount, 40, 'paid the $40 rate');
  assert(!pv.lines.some(l => l.name === 'Ben Ortiz'), 'the no-show is not paid');

  // Paying locks it, so Alice drops off the next preview — never paid twice.
  await app.ok('john', 'POST', '/api/admin/payouts/pay', { end });
  const pv2 = await app.ok('john', 'GET', `/api/admin/payouts/preview?end=${end}`);
  assert(!pv2.lines.some(l => l.name === 'Alice Reed'), 'already paid, so not on the next run');
});

// ── Phase 10 · Go-live: backup, self-check, and the privacy sweep ─────────────

test('phase 10 · a backup captures the whole league and the self-check reads ok', async () => {
  const backup = await app.ok('john', 'GET', '/api/admin/backup');
  assert(backup.records > 0 && backup.collections.games && backup.collections.players, 'the backup captured games and players');
  // Every division is represented in the saved team records.
  const divs = new Set(Object.values(backup.collections.teams).map(t => t.division));
  for (const d of ['Farm 8', 'Farm 9', 'Minors', 'Majors', 'Babe Ruth']) assert(divs.has(d), `backup has ${d} teams`);

  const c = await app.ok('john', 'GET', '/api/admin/selfcheck');
  assert.strictEqual(c.ok, true, JSON.stringify(c));
  assert.strictEqual(c.feedConfigured, true);
  assert(c.games >= 5, 'the imported season is loaded');
});

test('phase 10 · across the whole season, only allowed people were ever messaged', async () => {
  // Coaches, umpires, umpires\' parents, Snack Shack volunteers and league staff
  // may be emailed. No other family address is ever used — families hear through
  // SportsEngine. Every email the app sent must land on an allowed address.
  const out = await H.outbox();
  const emails = out.filter(m => m.channel === 'email' && m.to);
  assert(emails.length > 20, 'the season really did send a lot of email');
  const allowed = /(@qyb\.test|@ump\.test|@fam\.test|@qybsl\.test)$/; // coaches, umpires, parents+volunteers, staff
  const stray = emails.filter(m => !allowed.test(m.to));
  assert.deepStrictEqual(stray.map(m => m.to), [], `stray recipients: ${JSON.stringify([...new Set(stray.map(m => m.to))])}`);
});
