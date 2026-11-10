// Playoff brackets: seeding, higher-seed-home, single elimination with byes, and
// the 6-team double elimination with its "if needed" final and "no team out
// before its second loss" guarantee.
const { test } = require('node:test');
const assert = require('node:assert');
const B = require('../../lib/brackets');

const seeds = n => Array.from({ length: n }, (_, i) => `Seed${i + 1}`);
const higherWins = (h, a) => Math.min(h, a); // lower seed number = better seed

// Play a bracket to completion, checking invariants after every match.
function playout(b, decide, afterEach) {
  let guard = 0;
  while (!B.isComplete(b) && guard++ < 200) {
    const m = b.order.map(id => b.matches[id]).find(x => x.ready && !x.played && x.needed !== false);
    if (!m) break;
    const home = m.homeSeed, away = m.awaySeed;
    B.playMatch(b, m.id, decide(home, away));
    if (afterEach) afterEach(b, m.id, { home, away, winner: b.matches[m.id].winnerSeed });
  }
  return b;
}

test('seeding positions keep the top seeds apart until late', () => {
  assert.deepStrictEqual(B.seedPositions(4), [1, 4, 2, 3]);
  assert.deepStrictEqual(B.seedPositions(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test('single elimination (8 teams): higher seed home, every team once, seed 1 wins out', () => {
  const b = B.buildBracket('Farm 8', seeds(8));
  const r1 = B.withTeams(b).filter(m => m.round === 1);
  assert.strictEqual(r1.length, 4);
  assert.deepStrictEqual(r1.map(m => `${m.homeSeed}v${m.awaySeed}`), ['1v8', '4v5', '2v7', '3v6']);
  for (const m of r1) assert(m.homeSeed < m.awaySeed, 'the higher seed (lower number) is home');
  const appeared = new Set(r1.flatMap(m => [m.homeSeed, m.awaySeed]));
  assert.strictEqual(appeared.size, 8, 'every team appears exactly once in round 1');

  playout(b, higherWins, (bb, id, { home, away }) => {
    const m = bb.matches[id];
    assert(m.homeSeed <= m.awaySeed, 'home is always the higher seed');
  });
  assert.strictEqual(B.championSeed(b), 1, 'the top seed wins when the better seed always wins');
});

test('single elimination (5 teams, Minors): the top 3 seeds get a bye', () => {
  const b = B.buildBracket('Minors', seeds(5));
  const r1 = B.withTeams(b).filter(m => m.round === 1);
  const byes = r1.filter(m => m.bye).map(m => m.winnerSeed).sort();
  assert.deepStrictEqual(byes, [1, 2, 3], 'seeds 1-3 bye the first round');
  const real = r1.filter(m => !m.bye);
  assert.deepStrictEqual(real.map(m => `${m.homeSeed}v${m.awaySeed}`), ['4v5']);
  playout(b, higherWins);
  assert.strictEqual(B.championSeed(b), 1);
});

test('Majors double elimination: 11 matches, seed 1 wins out with no second final', () => {
  const b = B.buildBracket('Majors', seeds(6));
  assert.strictEqual(b.format, 'double');
  assert.strictEqual(b.order.length, 11);
  // Every winners'-bracket match's loser feeds a later match (nobody is stranded
  // on one loss).
  for (const w of ['W1', 'W2', 'W3', 'W4', 'W5']) {
    const fed = b.order.some(id => {
      const m = b.matches[id];
      return (m.a && m.a.lose === w) || (m.b && m.b.lose === w);
    });
    assert(fed, `the loser of ${w} drops into the losers' bracket`);
  }
  playout(b, higherWins);
  assert.strictEqual(B.championSeed(b), 1);
  assert.strictEqual(b.matches.GF2.needed, false, 'no second final when the winners-bracket team takes the first');
});

test('Majors: no team is eliminated before its second loss', () => {
  const b = B.buildBracket('Majors', seeds(6));
  // An upset-heavy script: the away (lower) seed wins wherever it can.
  playout(b, (h, a) => Math.max(h, a), (bb, id, { winner }) => {
    const m = bb.matches[id];
    const loser = m.homeSeed === winner ? m.awaySeed : m.homeSeed;
    const losses = B.lossesBySeed(bb);
    if (losses[loser] === 1) {
      // The 1-loss team must still have a game: either already a resolved
      // participant of an unplayed match, or routed there as the loser of the
      // match it just lost (its losers'-bracket drop, not yet ready).
      const stillPlaying = bb.order.some(x => {
        const g = bb.matches[x];
        if (g.played || g.needed === false) return false;
        if (g.homeSeed === loser || g.awaySeed === loser) return true;
        return (g.a && g.a.lose === id) || (g.b && g.b.lose === id);
      });
      assert(stillPlaying, `seed ${loser} has one loss and must still have a game`);
    }
  });
  const finalLosses = B.lossesBySeed(b);
  for (const s of [1, 2, 3, 4, 5, 6]) assert((finalLosses[s] || 0) <= 2, `seed ${s} never exceeds two losses`);
  assert((finalLosses[B.championSeed(b)] || 0) <= 1, 'the champion lost at most once');
});

test('Majors: the "if needed" final happens exactly when the losers-bracket team wins the first', () => {
  const b = B.buildBracket('Majors', seeds(6));
  // Play everything higher-seed-wins until the grand final is ready.
  let guard = 0;
  while (guard++ < 50) {
    const m = b.order.map(id => b.matches[id]).find(x => x.ready && !x.played && x.needed !== false && x.id !== 'GF1');
    if (!m) break;
    B.playMatch(b, m.id, higherWins(m.homeSeed, m.awaySeed));
  }
  const gf1 = b.matches.GF1;
  const wbSeed = b.matches.W5.winnerSeed;         // winners'-bracket champion
  const lbSeed = gf1.homeSeed === wbSeed ? gf1.awaySeed : gf1.homeSeed; // losers'-bracket champion
  // The losers'-bracket team wins GF1 → a second final is needed.
  B.playMatch(b, 'GF1', lbSeed);
  assert.strictEqual(b.matches.GF2.needed, true, 'the if-needed final is on');
  assert.strictEqual(B.isComplete(b), false, 'not decided until GF2 is played');
  B.playMatch(b, 'GF2', wbSeed);
  assert.strictEqual(B.championSeed(b), wbSeed, 'the winners-bracket team takes GF2 and the title');
});
