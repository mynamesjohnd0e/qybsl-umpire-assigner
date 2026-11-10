// Pure score helpers: out-of-town detection, the "can this game be scored yet"
// guard, and the forfeit constant.
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const clock = require('../../lib/clock');
const { otherTownOpponent, notScoreable, scoreLine, FORFEIT_RUNS } = require('../../lib/scores');

afterEach(() => clock.reset());

const idx = (...names) => new Map(names.map(n => [n, {}]));

test('out-of-town is detected only when exactly one team is on our list', () => {
  const g = { home: 'Quincy BR', away: 'South Boston' };
  assert.strictEqual(otherTownOpponent(g, idx('quincy br')), 'South Boston', 'the unknown away team');
  assert.strictEqual(otherTownOpponent({ home: 'South Boston', away: 'Quincy BR' }, idx('quincy br')), 'South Boston');
  assert.strictEqual(otherTownOpponent({ home: 'Quincy BR', away: 'Quincy Lock' }, idx('quincy br', 'quincy lock')), null, 'both known → intra-league');
  assert.strictEqual(otherTownOpponent(g, idx()), null, 'no roster yet → cannot tell');
  assert.strictEqual(otherTownOpponent({ home: 'A', away: 'B' }, idx('c')), null, 'both unknown → cannot tell');
});

test('a game is scoreable only once it has started and is not cancelled', () => {
  clock.setNow('2027-06-10T22:00:00Z');
  assert.match(notScoreable(null), /not found/i);
  assert.match(notScoreable({ status: 'cancelled', start: '2027-06-10T20:00:00Z' }), /cancelled|rained/i);
  assert.match(notScoreable({ status: 'scheduled', start: '2027-06-11T00:00:00Z' }), /once the game has started/);
  assert.strictEqual(notScoreable({ status: 'scheduled', start: '2027-06-10T20:00:00Z' }), null, 'started and live → ok');
});

test('a forfeit is 6 runs, and the score line reads naturally', () => {
  assert.strictEqual(FORFEIT_RUNS, 6);
  assert.strictEqual(scoreLine({ home: 'Red Sox', away: 'Yankees', score: { homeRuns: 7, awayRuns: 4 } }), 'Red Sox 7 – 4 Yankees');
  assert.match(scoreLine({ home: 'A', away: 'B', score: { homeRuns: 6, awayRuns: 0, forfeit: true } }), /forfeit/);
});
