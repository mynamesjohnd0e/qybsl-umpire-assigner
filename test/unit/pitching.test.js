// The pitch-count rules engine, pinned at every rulebook boundary, plus the
// invariants. The exact day a rested pitcher returns is the Cal Ripken
// Director's open question, so that one assertion is left as a todo.
const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');
const P = require('../../lib/pitching');
const { DEFAULTS } = require('../../lib/settings');

const L = DEFAULTS; // the real Settings limits
const outing = (date, pitches) => ({ date, pitches });

// ── Rest days: each bracket edge is its own case ──────────────────────────────
test('rest days: 20 → 0, 21 → 1', () => {
  assert.strictEqual(P.restDays(20, L.pitchRestBrackets), 0);
  assert.strictEqual(P.restDays(21, L.pitchRestBrackets), 1);
});
test('rest days: 35 → 1, 36 → 2', () => {
  assert.strictEqual(P.restDays(35, L.pitchRestBrackets), 1);
  assert.strictEqual(P.restDays(36, L.pitchRestBrackets), 2);
});
test('rest days: 50 → 2, 51 → 3', () => {
  assert.strictEqual(P.restDays(50, L.pitchRestBrackets), 2);
  assert.strictEqual(P.restDays(51, L.pitchRestBrackets), 3);
});
test('rest days: 65 → 3, 66 → 4', () => {
  assert.strictEqual(P.restDays(65, L.pitchRestBrackets), 3);
  assert.strictEqual(P.restDays(66, L.pitchRestBrackets), 4);
});
test('rest days: 0 and 1 pitch need no rest', () => {
  assert.strictEqual(P.restDays(0, L.pitchRestBrackets), 0);
  assert.strictEqual(P.restDays(1, L.pitchRestBrackets), 0);
});

// ── Daily max by league age: each edge its own case ───────────────────────────
test('daily max is 75 for 9–10 and 85 for 11–12', () => {
  assert.strictEqual(P.dailyMax(9, L.pitchDailyMax), 75);
  assert.strictEqual(P.dailyMax(10, L.pitchDailyMax), 75);
  assert.strictEqual(P.dailyMax(11, L.pitchDailyMax), 85);
  assert.strictEqual(P.dailyMax(12, L.pitchDailyMax), 85);
});
test('daily max: 75 is allowed and 76 is over for a 10-year-old', () => {
  assert.strictEqual(P.checkCount(75, 10, L).status, 'ok');
  assert.notStrictEqual(P.checkCount(76, 10, L).status, 'ok', '76 is over the 75 max');
});
test('daily max: 85 is allowed and 86 is over for a 12-year-old', () => {
  assert.strictEqual(P.checkCount(85, 12, L).status, 'ok');
  assert.notStrictEqual(P.checkCount(86, 12, L).status, 'ok', '86 is over the 85 max');
});

// ── Finish-the-batter tolerance ───────────────────────────────────────────────
test('a small overage is "finished the batter"; a large one is a violation', () => {
  // Age 10, max 75, tolerance 15.
  assert.strictEqual(P.checkCount(80, 10, L).status, 'check-finished-batter');
  assert.strictEqual(P.checkCount(90, 10, L).status, 'check-finished-batter', 'exactly max + tolerance is still a check');
  assert.strictEqual(P.checkCount(91, 10, L).status, 'violation', 'one past the tolerance is a violation');
});

// ── Two games in a day combine ────────────────────────────────────────────────
test('two games in a day: 40 + 40 is allowed and rest is set by the 80 total', () => {
  const day = '2027-05-01';
  // Before the second game, the 11-year-old has 45 pitches left today.
  const afterGame1 = P.eligibility([outing(day, 40)], day, 11, L);
  assert.strictEqual(afterGame1.pitchesLeftToday, 45);
  assert.strictEqual(afterGame1.available, true, 'can still pitch the second game');
  // After both games, the day's 80 total means 4 days of rest.
  assert.strictEqual(P.restDays(P.pitchesOnDay([outing(day, 40), outing(day, 40)], day), L.pitchRestBrackets), 4);
});

test('suspended-game pitches count toward the day total', () => {
  const day = '2027-05-01';
  const outings = [{ date: day, pitches: 30 }, { date: day, pitches: 40, suspended: true }];
  assert.strictEqual(P.pitchesOnDay(outings, day), 70);
  assert.strictEqual(P.restDays(70, L.pitchRestBrackets), 4);
});

// ── Resting / availability ────────────────────────────────────────────────────
test('a 66-pitch outing leaves the pitcher resting the next day, and never eligible before the day pitched', () => {
  const sat = '2027-05-01';
  const outings = [outing(sat, 66)];
  assert.strictEqual(P.restDays(66, L.pitchRestBrackets), 4);
  const until = P.restingUntil(outings, L);
  assert(until > sat, 'the next eligible day is after the outing, never before');
  // Clearly still resting the day after a 66-pitch outing (whatever the exact
  // return day turns out to be).
  assert.strictEqual(P.eligibility(outings, '2027-05-02', 11, L).available, false);
});

test('"4 days rest" means eligible on the 5th day (confirmed by John/Cal Ripken)', () => {
  // John's ruling: a pitcher with 4 days of rest is eligible on the 5th day —
  // pitch Monday, eligible Saturday.
  const mon = '2027-05-03'; // a Monday
  assert.strictEqual(P.restDays(66, L.pitchRestBrackets), 4);
  assert.strictEqual(P.restingUntil([outing(mon, 66)], L), '2027-05-08', 'eligible the following Saturday');
  assert.strictEqual(P.eligibility([outing(mon, 66)], '2027-05-07', 11, L).available, false, 'still resting Friday');
  assert.strictEqual(P.eligibility([outing(mon, 66)], '2027-05-08', 11, L).available, true, 'eligible Saturday');
  // And a Saturday outing is eligible the following Thursday.
  assert.strictEqual(P.restingUntil([outing('2027-05-01', 66)], L), '2027-05-06');
});

// ── Innings stored as outs ────────────────────────────────────────────────────
test('innings are stored and read back as outs (thirds)', () => {
  assert.strictEqual(P.inningsToOuts(1, 1), 4);            // 1⅓
  assert.strictEqual(P.inningsToOuts(1, 2) + P.inningsToOuts(1, 1), 9, '1⅔ + 1⅓ = 3 innings (9 outs)');
  assert.strictEqual(P.outsToInnings(36), '12');          // 12-year-old weekly cap, as outs
  assert.strictEqual(P.outsToInnings(4), '1⅓');
  assert.strictEqual(P.outsToInnings(5), '1⅔');
});

// ── 12-year-old weekly innings cap (Mon–Sun) ──────────────────────────────────
test('the 12-year-old weekly cap: 3+4+4 innings nears it, 2 more on Saturday goes over', () => {
  // One Mon–Sun week (starts Mon Apr 26 2027).
  const week = [
    { date: '2027-04-27', outs: 9 },  // 3 innings
    { date: '2027-04-29', outs: 12 }, // 4 innings
    { date: '2027-04-30', outs: 12 }  // 4 innings  → 11 innings, 33 outs
  ];
  const wk = P.weekKeyOf('2027-04-27');
  const before = P.twelveCapStatus(P.sumOutsInWeek(week, wk), L.twelveInningWeeklyOuts, L.twelveInningNearOuts);
  assert.strictEqual(before.outs, 33);
  assert.strictEqual(before.near, true, 'nearing the cap after 11 innings');
  assert.strictEqual(before.over, false);

  const sat = [...week, { date: '2027-05-01', outs: 6 }]; // +2 innings on Saturday → 13 innings
  const after = P.twelveCapStatus(P.sumOutsInWeek(sat, wk), L.twelveInningWeeklyOuts, L.twelveInningNearOuts);
  assert.strictEqual(after.over, true, '13 innings is over the 12-inning cap');
});

test('the weekly cap resets Monday: the same 2 innings the next week are fine', () => {
  const nextMon = [{ date: '2027-05-03', outs: 6 }]; // Monday, 2 innings, new week
  const wk = P.weekKeyOf('2027-05-03');
  assert.notStrictEqual(wk, P.weekKeyOf('2027-05-01'), 'Saturday and the next Monday are different weeks');
  const s = P.twelveCapStatus(P.sumOutsInWeek(nextMon, wk), L.twelveInningWeeklyOuts, L.twelveInningNearOuts);
  assert.strictEqual(s.over, false);
  assert.strictEqual(s.near, false, 'a fresh week, well under the cap');
});

test('thirds add up exactly and 36 outs is 12 innings', () => {
  assert.strictEqual(P.inningsToOuts(1, 1) + P.inningsToOuts(1, 2), 9, '1⅓ + 1⅔ = 3 innings');
  assert.strictEqual(P.outsToInnings(36), '12');
  assert.strictEqual(P.twelveCapStatus(36, L.twelveInningWeeklyOuts, L.twelveInningNearOuts).over, false, 'exactly 12 innings is not over');
  assert.strictEqual(P.twelveCapStatus(37, L.twelveInningWeeklyOuts, L.twelveInningNearOuts).over, true, 'one out past is over');
});

// ── Invariants ────────────────────────────────────────────────────────────────
test('property: more pitches never means fewer rest days', () => {
  fc.assert(fc.property(fc.nat({ max: 150 }), fc.nat({ max: 150 }), (a, b) => {
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    assert(P.restDays(hi, L.pitchRestBrackets) >= P.restDays(lo, L.pitchRestBrackets));
  }));
});

test('no hard-coded numbers: changing the Settings changes the answers', () => {
  const tight = { ...L, pitchRestBrackets: [10, 20], pitchDailyMax: [{ lo: 9, hi: 12, max: 50 }] };
  assert.strictEqual(P.restDays(25, tight.pitchRestBrackets), 2, 'new brackets, new rest');
  assert.strictEqual(P.restDays(25, L.pitchRestBrackets), 1, 'default brackets unchanged');
  assert.strictEqual(P.dailyMax(10, tight.pitchDailyMax), 50);
  assert.strictEqual(P.checkCount(70, 10, tight).status, 'violation', 'over the new 50 max by more than the 15 tolerance');
});
