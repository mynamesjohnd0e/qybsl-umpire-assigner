// Eastern-time helpers. Weeks run Monday–Sunday; all day math is done on the
// Eastern wall clock so daylight saving never shifts a game to the wrong day.
const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');
const { weekKey, etDateKey, addDaysToKey, zonedToUtc, zoneParts } = require('../../lib/time');

// A noon-Eastern Date on a given calendar day (safe from DST edges).
const etNoon = key => zonedToUtc(...key.split('-').map(Number), 12, 0, 0);

test('the week line falls between Sunday and Monday', () => {
  // Monday Mar 15 2027 and the Sunday before it.
  assert.strictEqual(weekKey(etNoon('2027-03-15')), '2027-03-15', 'Monday is its own week start');
  assert.strictEqual(weekKey(etNoon('2027-03-21')), '2027-03-15', 'the Sunday still belongs to that week');
  assert.strictEqual(weekKey(etNoon('2027-03-22')), '2027-03-22', 'the next Monday starts a new week');
});

test('league ages hinge on April 30 vs May 1 (the date math behind the cutoff)', () => {
  // The cutoff rule is Sprint 1, but the day arithmetic it rests on is here.
  assert.strictEqual(addDaysToKey('2027-04-30', 1), '2027-05-01');
  assert.strictEqual(addDaysToKey('2027-05-01', -1), '2027-04-30');
  // Different sides of the line are genuinely different days.
  assert.notStrictEqual('2027-04-30', '2027-05-01');
});

test('addDaysToKey crosses the spring DST boundary without drift', () => {
  // DST begins Sun Mar 14 2027. Stepping a day across it still lands on the
  // next calendar day.
  assert.strictEqual(addDaysToKey('2027-03-13', 1), '2027-03-14');
  assert.strictEqual(addDaysToKey('2027-03-14', 1), '2027-03-15');
  assert.strictEqual(addDaysToKey('2027-03-14', -1), '2027-03-13');
});

test('etDateKey reports the Eastern calendar day, not UTC', () => {
  // 1:30am UTC on Mar 15 is still the evening of Mar 14 in Eastern time.
  assert.strictEqual(etDateKey('2027-03-15T01:30:00Z'), '2027-03-14');
});

test('property: weekKey always returns a Monday within the prior 6 days', () => {
  fc.assert(fc.property(fc.date({ min: new Date('2024-01-01'), max: new Date('2030-12-31'), noInvalidDate: true }), d => {
    const wk = weekKey(d);
    assert.strictEqual(zoneParts(etNoon(wk)).dow, 1, 'week start is a Monday');
    const gap = (Date.parse(etDateKey(d) + 'T12:00:00Z') - Date.parse(wk + 'T12:00:00Z')) / 864e5;
    assert(gap >= 0 && gap <= 6, `day is 0..6 after its Monday, got ${gap}`);
  }));
});

test('property: stepping n days forward then back returns the same day key', () => {
  fc.assert(fc.property(
    fc.date({ min: new Date('2024-01-01'), max: new Date('2030-12-31'), noInvalidDate: true }),
    fc.integer({ min: -400, max: 400 }),
    (d, n) => {
      const key = etDateKey(d);
      assert.strictEqual(addDaysToKey(addDaysToKey(key, n), -n), key);
    }
  ));
});
