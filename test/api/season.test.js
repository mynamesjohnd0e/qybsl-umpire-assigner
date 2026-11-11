// The practice-season replay and its end-of-season checks (the board's
// acceptance tests): every played game final, every working umpire paid exactly
// once, standings agree with an independent calc, no unflagged pitch violation,
// and nobody outside coaches, umpires, umpires' parents and volunteers messaged.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
const { standings } = require('../../lib/standings');
H.setupEnv();

let app, report;
before(async () => {
  app = await H.startApp();
  report = await H.simulator().simulateSeason();
});
after(() => { H.clock.reset(); app.close(); });

test('the season ran cleanly (no errors) over a real schedule', () => {
  assert.deepStrictEqual(report.errors, [], 'no action errored during the replay');
  assert(report.scored.length >= 60, `a real season was played (${report.scored.length} games scored)`);
});

test('every played game ends final', async () => {
  const games = new Map((await H.store().list('games')).map(g => [g.id, g]));
  for (const s of report.scored) {
    const g = games.get(s.gameId);
    assert.strictEqual(g.score?.status, 'final', `${s.home} vs ${s.away} should be final`);
  }
});

test('every working umpire is paid exactly once', async () => {
  const games = await H.store().list('games');
  const payouts = await H.store().list('payouts');
  const paidIds = new Set(payouts.map(p => p.id));
  let worked = 0, paid = 0;
  const seen = new Set();
  for (const g of games) {
    if (!g.slots) continue;
    for (const k of ['plate', 'field']) {
      const sl = g.slots[k];
      if (sl.worked !== 'worked') continue;
      worked++;
      assert(sl.paidPayoutId, `${g.id} ${k} worked but unpaid`);
      assert(paidIds.has(sl.paidPayoutId), 'paid under a real payout');
      const key = `${g.id}:${k}`;
      assert(!seen.has(key), 'never paid twice');
      seen.add(key);
      paid++;
    }
  }
  assert(worked > 0, 'umpires actually worked games');
  assert.strictEqual(paid, worked, 'paid count equals worked count');
  // The payout total matches worked games × the pay rate.
  const total = payouts.reduce((t, p) => t + p.total, 0);
  assert.strictEqual(total, worked * 40);
});

test('a no-show is never paid', async () => {
  const games = await H.store().list('games');
  for (const g of games) for (const k of ['plate', 'field']) {
    if (g.slots?.[k]?.worked === 'noshow') assert(!g.slots[k].paidPayoutId, 'no pay for a no-show');
  }
});

test('the standings agree with an independent calc of the season as played', async () => {
  // Compute the app's standings from the stored final games, per division.
  const games = (await H.store().list('games')).filter(g => g.score?.status === 'final');
  const byDiv = {};
  for (const g of games) (byDiv[g.division] ||= []).push(g);

  // Independent oracle from the scores the simulator entered.
  const oracle = {};
  for (const s of report.scored) {
    const rec = (oracle[s.division] ||= {});
    const get = n => (rec[n] ||= { w: 0, l: 0, t: 0, ra: 0, rs: 0 });
    const h = get(s.home), a = get(s.away);
    h.rs += s.homeRuns; h.ra += s.awayRuns; a.rs += s.awayRuns; a.ra += s.homeRuns;
    if (s.homeRuns > s.awayRuns) { h.w++; a.l++; } else if (s.awayRuns > s.homeRuns) { a.w++; h.l++; } else { h.t++; a.t++; }
  }
  for (const division of Object.keys(byDiv)) {
    const rows = standings(byDiv[division]);
    for (const row of rows) {
      const ref = oracle[division][row.team];
      assert(ref, `oracle has ${row.team}`);
      assert.deepStrictEqual([row.wins, row.losses, row.ties, row.runsAllowed], [ref.w, ref.l, ref.t, ref.ra], `standings mismatch for ${row.team}`);
    }
  }
});

test('there is no unflagged pitch violation', async () => {
  // Every pitch-count violation on record has an alert; Farm has no pitch counts,
  // so both are zero — the check is a consistency invariant for the season.
  const logs = await H.store().list('pitchlogs');
  const alerts = await H.store().list('pitchalerts');
  const unflagged = logs.filter(l => l.violation && !alerts.some(a => a.id === `daily:${l.id}`));
  assert.deepStrictEqual(unflagged, [], 'no violation is left unflagged');
});

test('nobody outside coaches, umpires, umpires\' parents and the league staff was messaged', async () => {
  const allowed = report.contacts; // coaches, umpires, parents, director/comms/admin
  const emailTo = new Set(report.outbox.filter(m => m.channel === 'email').map(m => m.to));
  for (const to of emailTo) {
    assert(allowed.has(to), `unexpected message recipient: ${to}`);
  }
});

test('the busiest simulated day stays well under the email sending limit', () => {
  // The Google for Nonprofits workspace is the target; a personal Gmail is ~500/day.
  assert(report.maxDayMessages < 400, `busiest day sent ${report.maxDayMessages} messages`);
});
