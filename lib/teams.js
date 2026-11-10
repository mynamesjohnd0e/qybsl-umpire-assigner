// Teams and divisions as records. The five divisions in scope are fixed; teams
// are records built from the head-coach list (name → division → head coach),
// with names spelled exactly as they appear in the SportsEngine schedule export
// so games can be matched to them.
const store = require('./store');

// The divisions this app covers (docs/PLAN.md). These are the division strings
// the sorting rules produce, so game.division and team.division use the same set.
const DIVISIONS = ['Farm 8', 'Farm 9', 'Minors', 'Majors', 'Babe Ruth'];

// Normalise a team name for matching: lower-case, punctuation to spaces. So
// "QCARE  (BUCKLEY)" and "qcare (buckley)" are the same team.
const norm = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const teamId = name => 't_' + norm(name).replace(/\s+/g, '-');

async function upsertTeam({ name, division, headCoachEmail }) {
  const id = teamId(name);
  if (!id || id === 't_') return null;
  const existing = await store.get('teams', id);
  const team = {
    id, name: String(name).trim(), normName: norm(name),
    division: division || existing?.division || '',
    headCoachEmail: headCoachEmail || existing?.headCoachEmail || ''
  };
  await store.set('teams', id, team);
  return team;
}

// name (normalised) → team record.
async function teamsIndex() {
  const idx = new Map();
  for (const t of await store.list('teams')) idx.set(t.normName || norm(t.name), t);
  return idx;
}

// Given a team-name index and a list of names, return the names that match no
// team record (misspelled or not yet on the coach list). Empty index means "no
// roster to match against", so nothing is reported.
function unmatched(idx, names) {
  if (!idx.size) return [];
  const out = [];
  const seen = new Set();
  for (const n of names) {
    const key = norm(n);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!idx.has(key)) out.push(String(n).trim());
  }
  return out;
}

module.exports = { DIVISIONS, norm, teamId, upsertTeam, teamsIndex, unmatched };
