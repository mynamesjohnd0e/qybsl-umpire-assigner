// Standings. Winning percentage with a tie counting as half a win. Ties in the
// standings are broken, in order, by:
//   1. head-to-head (record among only the tied teams),
//   2. fewest runs allowed over the full season,
//   3. a coin toss the division director records.
// A tie that none of these breaks is held — the teams share a rank and are
// flagged as needing a coin toss — until the director records one.
//
// Pure functions over a list of final games, so the same inputs always give the
// same standings and a separate test can check them.

const norm = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const round = (v, p = 6) => Math.round(v * 10 ** p) / 10 ** p;
const winPct = r => (r.gp ? (r.w + 0.5 * r.t) / r.gp : 0);

// Win/loss/tie, runs scored and runs allowed for every team in the final games.
function computeRecords(games) {
  const rec = new Map();
  const get = name => {
    const k = norm(name);
    if (!rec.has(k)) rec.set(k, { team: name, norm: k, gp: 0, w: 0, l: 0, t: 0, rs: 0, ra: 0 });
    return rec.get(k);
  };
  for (const g of games) {
    const sc = g.score;
    if (!sc || sc.status !== 'final' || g.status === 'cancelled') continue;
    if (!g.home || !g.away) continue;
    const h = get(g.home), a = get(g.away);
    const hr = sc.homeRuns, ar = sc.awayRuns;
    h.gp++; a.gp++; h.rs += hr; a.rs += ar; h.ra += ar; a.ra += hr;
    if (hr > ar) { h.w++; a.l++; } else if (ar > hr) { a.w++; h.l++; } else { h.t++; a.t++; }
  }
  return [...rec.values()];
}

// Win % among only the teams in `group` (head-to-head). Teams who didn't play
// each other score a neutral 0.5 so an incomplete head-to-head doesn't decide.
function headToHeadPct(team, group, games) {
  const names = new Set(group.map(t => t.norm));
  let w = 0, l = 0, t = 0, gp = 0;
  for (const g of games) {
    const sc = g.score;
    if (!sc || sc.status !== 'final') continue;
    const hn = norm(g.home), an = norm(g.away);
    if (!names.has(hn) || !names.has(an)) continue;
    if (hn !== team.norm && an !== team.norm) continue;
    const home = hn === team.norm;
    const me = home ? sc.homeRuns : sc.awayRuns, opp = home ? sc.awayRuns : sc.homeRuns;
    gp++; if (me > opp) w++; else if (opp > me) l++; else t++;
  }
  return gp ? (w + 0.5 * t) / gp : 0.5;
}

// The team's finishing position in a coin toss that covers the whole tied group,
// or null if no recorded coin toss covers these teams.
function coinTossRank(team, group, coinTosses) {
  const names = group.map(t => t.norm);
  for (const ct of coinTosses || []) {
    const order = (ct.order || []).map(norm);
    if (names.every(n => order.includes(n))) return order.indexOf(team.norm);
  }
  return null;
}

// Split a set of still-tied teams by the tiebreaker at `level`, recursing into
// any sub-ties. Returns an ordered list of clusters; a cluster with more than
// one team is an unbroken tie.
function orderTeams(teams, level, ctx) {
  if (teams.length <= 1) return [teams];
  if (level > 3) return [teams];

  if (level === 3) {
    // Coin toss: only usable if one recorded toss covers every tied team.
    if (teams.some(t => coinTossRank(t, teams, ctx.coinTosses) === null)) return [teams];
  }
  const keyOf = t => {
    if (level === 0) return winPct(t);
    if (level === 1) return headToHeadPct(t, teams, ctx.games);
    if (level === 2) return -t.ra;                                   // fewer runs allowed ranks higher
    return -coinTossRank(t, teams, ctx.coinTosses);                 // earlier in the toss ranks higher
  };
  const keyed = teams.map(t => ({ t, k: round(keyOf(t)) }));
  const keys = [...new Set(keyed.map(x => x.k))].sort((a, b) => b - a);
  const out = [];
  for (const k of keys) out.push(...orderTeams(keyed.filter(x => x.k === k).map(x => x.t), level + 1, ctx));
  return out;
}

// Full standings: ranked rows, best first. Tied teams share a rank and carry
// needsCoinToss until the director records one.
function standings(games, { coinTosses = [] } = {}) {
  const recs = computeRecords(games);
  const clusters = orderTeams(recs, 0, { games, coinTosses });
  const rows = [];
  let rank = 1;
  for (const cluster of clusters) {
    const tied = cluster.length > 1;
    for (const r of cluster) {
      rows.push({
        rank, team: r.team, gamesPlayed: r.gp, wins: r.w, losses: r.l, ties: r.t,
        winPct: round(winPct(r), 3), runsScored: r.rs, runsAllowed: r.ra,
        tied, needsCoinToss: tied
      });
    }
    rank += cluster.length;
  }
  return rows;
}

// The tied clusters that still need a coin toss (for the director's to-do).
function unresolvedTies(games, { coinTosses = [] } = {}) {
  return orderTeams(computeRecords(games), 0, { games, coinTosses })
    .filter(c => c.length > 1)
    .map(c => c.map(t => t.team));
}

module.exports = { norm, computeRecords, winPct, headToHeadPct, coinTossRank, standings, unresolvedTies };
