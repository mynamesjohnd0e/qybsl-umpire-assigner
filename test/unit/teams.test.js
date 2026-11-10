// Team-name matching: normalisation and the unmatched-name report.
const { test } = require('node:test');
const assert = require('node:assert');
const { norm, teamId, unmatched } = require('../../lib/teams');

test('normalisation collapses case and punctuation', () => {
  assert.strictEqual(norm('QCARE  (BUCKLEY)'), 'qcare buckley');
  assert.strictEqual(norm('qcare (buckley)'), 'qcare buckley');
  assert.strictEqual(norm('SINC LAW P.C. (CLARK)'), 'sinc law p c clark');
});

test('team ids are stable across spelling noise but differ for real differences', () => {
  assert.strictEqual(teamId('QCARE  (BUCKLEY)'), teamId('qcare (buckley)'));
  assert.notStrictEqual(teamId('Red Sox'), teamId('Red Soxx'));
});

test('unmatched reports only names absent from the index, and never on an empty index', () => {
  const idx = new Map([['red sox', {}], ['yankees', {}]]);
  assert.deepStrictEqual(unmatched(idx, ['Red Sox', 'Yankees']), []);
  assert.deepStrictEqual(unmatched(idx, ['Red Soxx', 'Yankees']), ['Red Soxx']);
  // Duplicates collapse.
  assert.deepStrictEqual(unmatched(idx, ['Mets', 'Mets']), ['Mets']);
  // No roster yet → nothing is reported (don't flag everything).
  assert.deepStrictEqual(unmatched(new Map(), ['Anything']), []);
});
