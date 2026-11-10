// Sorting a feed event into a division and track. Rules are checked top to
// bottom (first match wins); if none match, the coach list maps a team name to
// its division. Both paths and the give-up case are tested.
const { test } = require('node:test');
const assert = require('node:assert');
const G = require('../../lib/games');
const { DEFAULTS } = require('../../lib/settings');

const s = { rules: DEFAULTS.rules };
const noTeams = new Map();
const ev = summary => ({ summary, home: '', away: '' });

test('named divisions sort to the right division and track', () => {
  assert.deepStrictEqual(G.classify(ev('Farm 8: Red Sox vs. Yankees'), s, noTeams), { division: 'Farm 8', track: 'student' });
  assert.deepStrictEqual(G.classify(ev('Farm 9: Orioles @ Rays'), s, noTeams), { division: 'Farm 9', track: 'student' });
  assert.deepStrictEqual(G.classify(ev('Majors: Police vs Forepoint'), s, noTeams), { division: 'Majors', track: 'patched' });
  assert.deepStrictEqual(G.classify(ev('Minors: A vs B'), s, noTeams), { division: 'Minors', track: 'patched' });
});

test('instructional and fall ball are skipped (no umpires)', () => {
  assert.strictEqual(G.classify(ev('T-Ball: Bees vs Ants'), s, noTeams).track, 'skip');
  assert.strictEqual(G.classify(ev('Fall Ball scrimmage'), s, noTeams).track, 'skip');
});

test('the $0 age-code rules use the matched text as the division', () => {
  assert.deepStrictEqual(G.classify(ev('9A: Quincy 9A vs Braintree'), s, noTeams), { division: '9A', track: 'student' });
  assert.deepStrictEqual(G.classify(ev('11B: Quincy 11B vs Milton'), s, noTeams), { division: '11B', track: 'patched' });
});

test('an unsortable game falls back to the coach list, then to nothing', () => {
  const teams = new Map([['pirates', { team: 'Pirates', division: 'Farm 9' }]]);
  assert.deepStrictEqual(
    G.classify({ summary: 'Pirates vs Giants', home: 'Pirates', away: 'Giants' }, s, teams),
    { division: 'Farm 9', track: 'student' });
  assert.deepStrictEqual(G.classify(ev('Mystery Game'), s, noTeams), { division: null, track: 'none' });
});

test('the first matching rule wins', () => {
  // "Farm 8" is above the generic age-code rule, so a "Farm 8 ... 8A" game is
  // Farm 8, not 8A.
  assert.strictEqual(G.classify(ev('Farm 8 8A: x vs y'), s, noTeams).division, 'Farm 8');
});
