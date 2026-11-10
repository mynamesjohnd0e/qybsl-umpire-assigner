// Standings and tiebreakers, on small controlled schedules so each rule is
// exact, plus invariants over generated seasons.
const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');
const { standings, computeRecords } = require('../../lib/standings');

// A final game between two teams.
const game = (home, away, hr, ar) => ({ home, away, status: 'scheduled', score: { status: 'final', homeRuns: hr, awayRuns: ar } });
const rowFor = (rows, team) => rows.find(r => r.team === team);

test('win % counts a tie as half a win', () => {
  const rows = standings([
    game('A', 'B', 5, 3),   // A beats B
    game('A', 'C', 2, 2),   // A ties C
    game('D', 'A', 4, 1)    // A loses to D
  ]);
  const a = rowFor(rows, 'A');
  assert.deepStrictEqual([a.wins, a.losses, a.ties], [1, 1, 1]);
  assert.strictEqual(a.winPct, 0.5, '(1 + 0.5) / 3');
});

test('runs allowed is the opponents\' runs, forfeits included', () => {
  const rows = standings([
    game('A', 'B', 3, 1),                                             // A allows 1
    { home: 'A', away: 'C', status: 'scheduled', score: { status: 'final', homeRuns: 6, awayRuns: 0, forfeit: true } } // forfeit: A allows 0, C allows 6
  ]);
  assert.strictEqual(rowFor(rows, 'A').runsAllowed, 1);
  assert.strictEqual(rowFor(rows, 'C').runsAllowed, 6, 'the forfeit\'s 6 counts against the loser');
});

test('head-to-head alone breaks a two-way tie (runs allowed equal)', () => {
  // A and B finish 1-1 with identical runs allowed (5 each); the only thing that
  // separates them is that A beat B head-to-head. If head-to-head were ignored
  // this would fall to a coin toss, so the test fails when the rule is broken.
  const rows = standings([
    game('A', 'B', 5, 0),   // A beats B head-to-head (A allows 0, B allows 5)
    game('C', 'A', 5, 0),   // A loses to C (A allows 5)
    game('B', 'D', 5, 0)    // B beats D (B allows 0)
  ]);
  assert.strictEqual(rowFor(rows, 'A').runsAllowed, 5);
  assert.strictEqual(rowFor(rows, 'B').runsAllowed, 5, 'runs allowed are equal, so only head-to-head can decide');
  assert.strictEqual(rowFor(rows, 'C').rank, 1);
  assert(rowFor(rows, 'A').rank < rowFor(rows, 'B').rank, 'A ranks above B on head-to-head');
  assert.strictEqual(rowFor(rows, 'A').needsCoinToss, false);
});

test('a three-way circle falls through head-to-head to fewest runs allowed', () => {
  // A>B, B>C, C>A — head-to-head is a circle, so runs allowed decides.
  const rows = standings([
    game('A', 'B', 3, 1),   // A allows 1
    game('B', 'C', 4, 1),   // B allows 1
    game('C', 'A', 5, 1)    // C allows 1
  ]);
  // runs allowed: A=1+5=6, B=3+1=4, C=4+1=5  → B, C, A
  assert.strictEqual(rowFor(rows, 'B').rank, 1);
  assert.strictEqual(rowFor(rows, 'C').rank, 2);
  assert.strictEqual(rowFor(rows, 'A').rank, 3);
  for (const t of ['A', 'B', 'C']) assert.strictEqual(rowFor(rows, t).winPct, 0.5);
});

test('a dead tie is held until the director records a coin toss', () => {
  const games = [
    game('A', 'C', 5, 0), game('B', 'C', 5, 0),   // A,B each beat C 5-0
    game('D', 'A', 3, 0), game('D', 'B', 3, 0),   // A,B each lose to D 0-3
    game('A', 'B', 2, 2)                           // A ties B
  ];
  const before = standings(games);
  // A and B are identical: same record, same runs allowed, tied head-to-head.
  assert.strictEqual(rowFor(before, 'A').rank, rowFor(before, 'B').rank, 'they share a rank');
  assert.strictEqual(rowFor(before, 'A').needsCoinToss, true);

  const after = standings(games, { coinTosses: [{ order: ['A', 'B'] }] });
  assert(rowFor(after, 'A').rank < rowFor(after, 'B').rank, 'the coin toss puts A first');
  assert.strictEqual(rowFor(after, 'A').needsCoinToss, false);
  assert.strictEqual(rowFor(after, 'B').needsCoinToss, false);
});

// ── Invariants over generated seasons ─────────────────────────────────────────
const genSeason = fc.array(
  fc.record({
    h: fc.integer({ min: 0, max: 5 }), a: fc.integer({ min: 0, max: 5 }),
    hr: fc.integer({ min: 0, max: 12 }), ar: fc.integer({ min: 0, max: 12 })
  }).filter(g => g.h !== g.a),
  { minLength: 1, maxLength: 40 }
).map(list => list.map(g => game(`T${g.h}`, `T${g.a}`, g.hr, g.ar)));

test('property: total wins equals total losses', () => {
  fc.assert(fc.property(genSeason, games => {
    const recs = computeRecords(games);
    const w = recs.reduce((n, r) => n + r.w, 0);
    const l = recs.reduce((n, r) => n + r.l, 0);
    assert.strictEqual(w, l);
  }));
});

test('property: the order games are entered never changes the standings', () => {
  fc.assert(fc.property(genSeason, fc.integer({ min: 1, max: 9999 }), (games, seed) => {
    const base = standings(games);
    const shuffled = [...games].sort(() => (seed = (seed * 48271) % 2147483647) % 2 ? 1 : -1);
    const other = standings(shuffled);
    const rankOf = rows => Object.fromEntries(rows.map(r => [r.team, r.rank]));
    assert.deepStrictEqual(rankOf(other), rankOf(base));
  }));
});

test('property: ranks only tie where a coin toss is still needed', () => {
  fc.assert(fc.property(genSeason, games => {
    const rows = standings(games);
    const byRank = {};
    for (const r of rows) (byRank[r.rank] ||= []).push(r);
    for (const group of Object.values(byRank)) {
      if (group.length > 1) group.forEach(r => assert.strictEqual(r.needsCoinToss, true, 'shared ranks are only unresolved coin tosses'));
    }
  }));
});
