// Player rosters (Minors and Majors). We take the SportsEngine roster export —
// name, jersey number, birthdate — turn the birthdate into a league age, and
// then throw the birthdate away. Players are minors: we keep only their name,
// number and league age (per docs/PLAN.md and CLAUDE.md). No birthdate is ever
// stored, and no contact details.
const store = require('./store');
const clock = require('./clock');
const { getSettings } = require('./settings');
const { parseCsv } = require('./people');

const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const pick = (row, ...keys) => { for (const k of keys) if (row[k]) return row[k]; return ''; };

// Birthdate as { y, m, d }, from 'YYYY-MM-DD', 'M/D/YYYY' or 'M-D-YYYY'. Returns
// null if it can't be read — the only place a birthdate is ever looked at.
function parseBirth(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return { y: +m[3], m: +m[1], d: +m[2] };
  return null;
}

// League age = age on April 30 of the season year (rulebook window May 1–Apr 30).
// A player born on or before April 30 has already had their birthday by the
// cutoff; one born May 1 or later has not. Accepts a birthdate string or a
// parsed { y, m, d }. Returns null if the birthdate can't be read.
function leagueAge(birth, seasonYear) {
  const b = (birth && typeof birth === 'object') ? birth : parseBirth(birth);
  if (!b || !b.y || !b.m || !b.d) return null;
  let age = seasonYear - b.y;
  if (b.m > 4 || (b.m === 4 && b.d > 30)) age -= 1; // birthday falls after April 30
  return age;
}

const playerId = (season, name) => `${season}:${norm(name)}`;

// Columns: name, number (jersey), birthdate (dob), team, division. One row per
// player. Idempotent: re-uploading the same roster changes nothing. A player who
// moves teams keeps their record (and anything attached to it, like a future
// pitch log). A player missing from a later upload is flagged, never deleted.
async function importPlayers(csvText, opts = {}) {
  const s = await getSettings();
  const season = String(opts.season || s.seasonLabel).trim();
  const seasonYear = Number(opts.seasonYear || s.seasonYear);
  const rows = parseCsv(csvText);
  const out = { added: 0, updated: 0, skipped: [], missing: [], restored: 0, teams: new Set() };
  const seen = new Set();

  for (const r of rows) {
    const name = pick(r, 'name', 'player_name', 'player', 'full_name');
    const team = pick(r, 'team', 'team_name');
    const birth = parseBirth(pick(r, 'birthdate', 'dob', 'date_of_birth', 'birth_date'));
    if (!name) { out.skipped.push('(a row with no player name)'); continue; }
    if (!team) { out.skipped.push(`${name}: no team`); continue; }
    if (!birth) { out.skipped.push(`${name}: missing or unreadable birthdate`); continue; }

    const age = leagueAge(birth, seasonYear);
    const id = playerId(season, name);
    seen.add(id);
    const existing = await store.get('players', id);
    const wasMissing = existing?.missing;
    // Start from the existing record so attached data (e.g. a future pitch log)
    // survives a team change; never copy a birthdate forward.
    const player = { ...(existing || {}) };
    delete player.birthdate; delete player.dob;
    Object.assign(player, {
      id, season, name: String(name).trim(),
      number: String(pick(r, 'number', 'jersey', 'jersey_number', 'uniform') || '').trim(),
      leagueAge: age,
      team: String(team).trim(),
      division: String(pick(r, 'division', 'league', 'age_group') || existing?.division || '').trim(),
      missing: false
    });
    await store.set('players', id, player);
    out.teams.add(player.team);
    if (!existing) out.added++;
    else { out.updated++; if (wasMissing) out.restored++; }
  }

  // Flag players from this season who were not in this upload — don't delete.
  for (const p of await store.list('players')) {
    if (p.season === season && !seen.has(p.id) && !p.missing) {
      await store.set('players', p.id, { ...p, missing: true, missingSince: clock.now().toISOString() });
      out.missing.push(p.name);
    }
  }
  out.teams = [...out.teams];
  return out;
}

module.exports = { leagueAge, parseBirth, importPlayers, playerId };
