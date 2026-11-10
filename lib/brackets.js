// Playoff brackets. Every team qualifies and is seeded from the standings; the
// higher seed is always home. Minors is a 5-team single elimination; Farm 8,
// Farm 9 and Babe Ruth are single elimination too; Majors is a 6-team double
// elimination with an "if needed" second final.
//
// A bracket is a set of matches. A match's two sides are each either a seed, the
// winner of another match, or the loser of another match. As matches are played,
// the seeds flow into the matches that depend on them. The lower seed number is
// always the home team.

// Standard seeding positions for a power-of-two bracket: 1 plays the last seed,
// 2 plays the second-last, and so on, laid out so higher seeds can only meet
// later. Seeds beyond the real team count are byes.
function seedPositions(size) {
  let s = [1];
  while (s.length < size) {
    const m = s.length * 2 + 1;
    const next = [];
    for (const x of s) { next.push(x); next.push(m - x); }
    s = next;
  }
  return s;
}

const FORMAT = { 'Minors': 'single', 'Farm 8': 'single', 'Farm 9': 'single', 'Babe Ruth': 'single', 'Majors': 'double' };
function formatFor(division) { return FORMAT[division] || 'single'; }

// The seed number on one side of a match, or: null for a bye, undefined when the
// feeding match hasn't been decided yet.
function sideSeed(b, side) {
  if (!side || side.bye) return null;
  if (side.seed != null) return side.seed;
  const m = b.matches[side.win != null ? side.win : side.lose];
  if (!m || m.winnerSeed == null) return undefined;
  if (side.win != null) return m.winnerSeed;
  // Loser of a decided match = the side that isn't the winner.
  return m.homeSeed === m.winnerSeed ? m.awaySeed : m.homeSeed;
}

// Fill in home/away (lower seed is home) for every match whose both sides are
// known, and auto-advance any match where one side is a bye.
function resolve(b) {
  for (const id of b.order) {
    const m = b.matches[id];
    if (m.played) continue;
    const sa = sideSeed(b, m.a), sb = sideSeed(b, m.b);
    // A bye: the real side advances with no game.
    if (sa === null && typeof sb === 'number') { m.winnerSeed = sb; m.played = true; m.bye = true; }
    else if (sb === null && typeof sa === 'number') { m.winnerSeed = sa; m.played = true; m.bye = true; }
    if (typeof sa === 'number' && typeof sb === 'number') {
      m.homeSeed = Math.min(sa, sb); m.awaySeed = Math.max(sa, sb); m.ready = true;
    } else { m.homeSeed = m.awaySeed = null; m.ready = false; }
  }
}

function withTeams(b) {
  const team = s => (s != null && b.seeds[s - 1] != null ? b.seeds[s - 1] : null);
  return b.order.map(id => {
    const m = b.matches[id];
    return {
      id, bracket: m.bracket, round: m.round, name: m.name || null,
      homeSeed: m.homeSeed ?? null, awaySeed: m.awaySeed ?? null,
      home: team(m.homeSeed), away: team(m.awaySeed),
      winnerSeed: m.winnerSeed ?? null, winner: team(m.winnerSeed),
      ready: !!m.ready && m.winnerSeed == null, played: !!m.played, bye: !!m.bye,
      needed: m.needed !== false
    };
  });
}

// ── Single elimination (any number of teams) ──────────────────────────────────
function singleBracket(seeds) {
  const N = seeds.length;
  const size = Math.max(2, 1 << Math.ceil(Math.log2(Math.max(2, N))));
  const pos = seedPositions(size);
  const b = { format: 'single', seeds, N, matches: {}, order: [] };
  let idc = 0;
  const add = m => { b.matches[m.id] = m; b.order.push(m.id); return m; };
  const sideOf = s => (s <= N ? { seed: s } : { bye: true });

  let round = 1, prev = [];
  for (let i = 0; i < size; i += 2) prev.push(add({ id: 'S' + idc++, bracket: 'W', round, a: sideOf(pos[i]), b: sideOf(pos[i + 1]), winnerSeed: null, played: false }));
  while (prev.length > 1) {
    round++;
    const cur = [];
    for (let i = 0; i < prev.length; i += 2) cur.push(add({ id: 'S' + idc++, bracket: 'W', round, a: { win: prev[i].id }, b: { win: prev[i + 1].id }, winnerSeed: null, played: false }));
    prev = cur;
  }
  b.finalId = prev[0].id;
  b.matches[b.finalId].name = 'Championship';
  // Resolve byes, which can cascade several rounds.
  for (let i = 0; i < b.order.length; i++) resolve(b);
  return b;
}

// ── 6-team double elimination (Majors) ────────────────────────────────────────
function doubleBracket6(seeds) {
  if (seeds.length !== 6) throw new Error('Majors double elimination needs exactly 6 teams.');
  const b = { format: 'double', seeds, N: 6, matches: {}, order: [] };
  const add = (id, m) => { b.matches[id] = { id, winnerSeed: null, played: false, ...m }; b.order.push(id); };
  // Winners bracket.
  add('W1', { bracket: 'W', round: 1, a: { seed: 3 }, b: { seed: 6 } });
  add('W2', { bracket: 'W', round: 1, a: { seed: 4 }, b: { seed: 5 } });
  add('W3', { bracket: 'W', round: 2, a: { seed: 1 }, b: { win: 'W2' } });
  add('W4', { bracket: 'W', round: 2, a: { seed: 2 }, b: { win: 'W1' } });
  add('W5', { bracket: 'W', round: 3, a: { win: 'W3' }, b: { win: 'W4' }, name: "Winners' final" });
  // Losers bracket.
  add('L1', { bracket: 'L', round: 1, a: { lose: 'W1' }, b: { lose: 'W2' } });
  add('L2', { bracket: 'L', round: 2, a: { lose: 'W3' }, b: { win: 'L1' } });
  add('L3', { bracket: 'L', round: 3, a: { lose: 'W4' }, b: { win: 'L2' } });
  add('L4', { bracket: 'L', round: 4, a: { lose: 'W5' }, b: { win: 'L3' }, name: "Losers' final" });
  // Grand final, plus an "if needed" second final.
  add('GF1', { bracket: 'GF', round: 1, a: { win: 'W5' }, b: { win: 'L4' }, name: 'Championship' });
  add('GF2', { bracket: 'GF', round: 2, a: { win: 'W5' }, b: { win: 'L4' }, name: 'Championship (if needed)', needed: false });
  b.finalId = 'GF1';
  for (let i = 0; i < b.order.length; i++) resolve(b);
  return b;
}

function buildBracket(division, seedTeams) {
  const format = formatFor(division);
  const b = format === 'double' ? doubleBracket6(seedTeams) : singleBracket(seedTeams);
  b.division = division;
  return b;
}

// Record the winner of a ready match (by seed), then flow it onward.
function playMatch(b, matchId, winnerSeed) {
  const m = b.matches[matchId];
  if (!m) throw new Error('No such match.');
  resolve(b);
  if (m.played) throw new Error('That match is already decided.');
  if (!m.ready) throw new Error('That match is waiting on earlier results.');
  if (winnerSeed !== m.homeSeed && winnerSeed !== m.awaySeed) throw new Error('The winner must be one of the two teams in the match.');
  m.winnerSeed = winnerSeed; m.played = true;
  // Double-elim grand final: if the losers'-bracket team wins GF1, a second
  // final is needed (the winners'-bracket team now has its first loss).
  if (b.format === 'double' && matchId === 'GF1') {
    const wbSeed = b.matches.W5.winnerSeed;
    if (winnerSeed !== wbSeed) { b.matches.GF2.needed = true; b.finalId = 'GF2'; }
    else { b.matches.GF2.needed = false; b.finalId = 'GF1'; }
  }
  resolve(b);
  return b;
}

function isComplete(b) { const f = b.matches[b.finalId]; return !!(f && f.played); }
function championSeed(b) { return isComplete(b) ? b.matches[b.finalId].winnerSeed : null; }
function champion(b) { const s = championSeed(b); return s != null ? b.seeds[s - 1] : null; }

// How many losses each seed has, from played matches (for "no team is out before
// its second loss").
function lossesBySeed(b) {
  const loss = {};
  for (const id of b.order) {
    const m = b.matches[id];
    if (!m.played || m.bye || m.winnerSeed == null) continue;
    const loser = m.homeSeed === m.winnerSeed ? m.awaySeed : m.homeSeed;
    if (loser != null) loss[loser] = (loss[loser] || 0) + 1;
  }
  return loss;
}

// Advance a bracket from real game results. Each ready match is matched to a
// final game between its two teams (the higher seed is home); the winner flows
// on. A game is used at most once, so the two grand-final games map to GF1 then
// GF2. This is how uploaded playoff games drive the bracket.
const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function advanceFromGames(b, games) {
  const finals = games.filter(g => g.score && g.score.status === 'final' && g.status !== 'cancelled');
  const used = new Set();
  let progress = true;
  while (progress) {
    progress = false;
    resolve(b);
    for (const id of b.order) {
      const m = b.matches[id];
      if (!m.ready || m.played || m.needed === false) continue;
      const home = b.seeds[m.homeSeed - 1], away = b.seeds[m.awaySeed - 1];
      const g = finals.find(x => {
        if (used.has(x.id)) return false;
        const s = new Set([normName(x.home), normName(x.away)]);
        return s.has(normName(home)) && s.has(normName(away));
      });
      if (!g || g.score.homeRuns === g.score.awayRuns) continue; // no game yet, or a tie
      const winTeam = g.score.homeRuns > g.score.awayRuns ? g.home : g.away;
      const winnerSeed = b.seeds.findIndex(t => normName(t) === normName(winTeam)) + 1;
      if (winnerSeed === m.homeSeed || winnerSeed === m.awaySeed) {
        used.add(g.id); playMatch(b, id, winnerSeed); progress = true;
      }
    }
  }
  return b;
}

module.exports = {
  seedPositions, formatFor, buildBracket, singleBracket, doubleBracket6,
  playMatch, resolve, withTeams, isComplete, championSeed, champion, lossesBySeed,
  advanceFromGames, FORMAT
};
