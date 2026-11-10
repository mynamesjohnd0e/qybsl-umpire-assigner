// League age: the age on April 30 of the season year. Tested on both sides of
// the April 30 / May 1 cutoff, with Feb 29 birthdays, plus a property.
const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');
const { leagueAge, parseBirth } = require('../../lib/roster');

test('April 30 vs May 1 land in different league ages', () => {
  assert.strictEqual(leagueAge('2014-04-30', 2027), 13, 'born Apr 30 has had their birthday by the cutoff');
  assert.strictEqual(leagueAge('2014-05-01', 2027), 12, 'born May 1 has not');
});

test('the cutoff is exact to the day', () => {
  assert.strictEqual(leagueAge('2015-04-30', 2027), 12);
  assert.strictEqual(leagueAge('2015-05-01', 2027), 11);
  // A January birthday is well before the cutoff.
  assert.strictEqual(leagueAge('2015-01-01', 2027), 12);
  // A December birthday is well after it.
  assert.strictEqual(leagueAge('2014-12-31', 2027), 12);
});

test('Feb 29 birthdays work in a non-leap season year', () => {
  // 2027 is not a leap year; the calculation must not crash and must be sensible.
  assert.strictEqual(leagueAge('2016-02-29', 2027), 11);
});

test('several date formats parse to the same age', () => {
  assert.strictEqual(leagueAge('2014-04-30', 2027), 13);
  assert.strictEqual(leagueAge('4/30/2014', 2027), 13);
  assert.strictEqual(leagueAge('04-30-2014', 2027), 13);
});

test('an unreadable birthdate is null, not a wrong age', () => {
  assert.strictEqual(leagueAge('not a date', 2027), null);
  assert.strictEqual(leagueAge('', 2027), null);
  assert.strictEqual(parseBirth('garbage'), null);
});

test('property: born a day later is never older, and the cutoff shifts age by exactly one', () => {
  fc.assert(fc.property(
    fc.integer({ min: 2008, max: 2020 }),
    fc.integer({ min: 2025, max: 2030 }),
    (birthYear, seasonYear) => {
      const apr30 = leagueAge({ y: birthYear, m: 4, d: 30 }, seasonYear);
      const may1 = leagueAge({ y: birthYear, m: 5, d: 1 }, seasonYear);
      assert.strictEqual(apr30 - may1, 1, 'Apr 30 is exactly one league-age older than May 1');
      // Later birth year is never an older age.
      const older = leagueAge({ y: birthYear - 1, m: 4, d: 30 }, seasonYear);
      assert(older >= apr30, 'an earlier birth year is at least as old');
    }
  ));
});
