// Coach side: confirm the umpires worked, rate them (optional), and the
// admin-only rating summaries.
const store = require('./store');
const { getSettings } = require('./settings');
const clock = require('./clock');
const G = require('./games');

const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function coachOwns(person, g) {
  const teams = (person.coach?.teams || []).map(t => norm(t.team)).filter(Boolean);
  if (!teams.length) return false;
  const sides = [norm(g.home), norm(g.away)].filter(Boolean);
  const summary = norm(g.summary);
  return teams.some(t => sides.some(s => s === t || s.includes(t) || t.includes(s)) || (` ${summary} `).includes(` ${t} `));
}

const sideMatches = (teams, side) => {
  const s = norm(side);
  return !!s && teams.some(t => s === t || s.includes(t) || t.includes(s));
};

// Which side of the game is this coach on? 'home', 'away', or null when it's
// neither or (rarely) both. Used by score entry, where home and away do
// different things.
function coachSide(person, g) {
  const teams = (person.coach?.teams || []).map(t => norm(t.team)).filter(Boolean);
  if (!teams.length) return null;
  const home = sideMatches(teams, g.home), away = sideMatches(teams, g.away);
  if (home && !away) return 'home';
  if (away && !home) return 'away';
  return null;
}

async function coachGames(person) {
  const all = await store.list('games');
  return all.filter(g => g.track === 'student' && coachOwns(person, g));
}

// Every game this coach owns, any division/track (scores apply league-wide, not
// just to student-umpire games).
async function coachAllGames(person) {
  return (await store.list('games')).filter(g => coachOwns(person, g));
}

// results: { plate: 'worked'|'noshow', field: 'worked'|'noshow' }
async function confirmGame(person, gameId, results) {
  const s = await getSettings();
  const g = await store.transact(async tx => {
    const game = await tx.get('games', gameId);
    if (!game || game.track !== 'student') throw new Error('Game not found.');
    if (!person.isAdmin && !coachOwns(person, game)) throw new Error('You can only confirm your own team\'s games.');
    if (!G.isLive(game)) throw new Error('This game was cancelled.');
    if (new Date(game.start) > clock.now()) throw new Error('You can confirm once the game has started.');
    for (const k of G.SLOTS) {
      const r = results?.[k];
      const sl = game.slots[k];
      if (!r || !sl.umpireId) continue;
      if (!['worked', 'noshow'].includes(r)) throw new Error('Choose Worked or No-show.');
      if (sl.paidPayoutId) continue; // already paid, locked
      sl.worked = r; sl.confirmedBy = person.email; sl.confirmedAt = clock.now().toISOString();
      G.addHistory(game, `${G.SLOT_LABEL[k]} marked ${r === 'worked' ? 'worked' : 'no-show'}`, person.email);
      const id = `${gameId}_${k}_noshow`;
      if (r === 'noshow') tx.set('ratings', id, { id, gameId, slot: k, umpireId: sl.umpireId, coachId: person.email, score: null, comment: 'No-show (logged automatically)', noShow: true, season: game.season || s.seasonLabel, at: clock.now().toISOString() });
    }
    tx.set('games', gameId, game);
    return game;
  });
  // A worked mark replaces an earlier no-show mark for the same spot.
  for (const k of G.SLOTS) if (results?.[k] === 'worked') {
    const id = `${gameId}_${k}_noshow`;
    if (await store.get('ratings', id)) await store.del('ratings', id);
  }
  return g;
}

async function rate(person, gameId, slot, score, comment) {
  const game = await store.get('games', gameId);
  if (!game?.slots?.[slot]?.umpireId) throw new Error('No umpire in that spot.');
  if (!person.isAdmin && !coachOwns(person, game)) throw new Error('You can only rate umpires at your own games.');
  if (new Date(game.start) > clock.now()) throw new Error('You can rate once the game has started.');
  const n = Number(score);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error('Rating must be 1 to 5.');
  const s = await getSettings();
  const id = `${gameId}_${slot}_${person.email}`;
  const team = (person.coach?.teams || []).find(t => [game.home, game.away].some(x => norm(x).includes(norm(t.team))))?.team || '';
  await store.set('ratings', id, {
    id, gameId, slot, umpireId: game.slots[slot].umpireId, coachId: person.email, coachTeam: team,
    score: n, comment: String(comment || '').slice(0, 500), noShow: false,
    season: game.season || s.seasonLabel, at: clock.now().toISOString()
  });
}

async function myRatings(person, gameId) {
  const all = await store.list('ratings');
  return all.filter(r => r.gameId === gameId && r.coachId === person.email && !r.noShow);
}

// Admin-only: per-umpire season and all-time numbers, plus every rating so
// one-sided scores from a single coach stand out.
async function ratingSummary() {
  const s = await getSettings();
  const [ratings, people, games] = await Promise.all([store.list('ratings'), store.list('people'), store.list('games')]);
  const avg = a => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  return people.filter(p => p.umpire).map(p => {
    const mine = ratings.filter(r => r.umpireId === p.email);
    const scored = mine.filter(r => !r.noShow);
    const season = scored.filter(r => r.season === s.seasonLabel);
    let worked = 0, workedSeason = 0;
    for (const g of games) for (const k of G.SLOTS) if (g.slots?.[k]?.umpireId === p.email && g.slots[k].worked === 'worked') {
      worked++; if ((g.season || s.seasonLabel) === s.seasonLabel) workedSeason++;
    }
    return {
      email: p.email, name: p.name,
      seasonAvg: avg(season.map(r => r.score)), seasonCount: season.length,
      allTimeAvg: avg(scored.map(r => r.score)), allTimeCount: scored.length,
      noShows: mine.filter(r => r.noShow).length,
      noShowsSeason: mine.filter(r => r.noShow && r.season === s.seasonLabel).length,
      gamesWorked: worked, gamesWorkedSeason: workedSeason,
      ratings: mine.sort((a, b) => b.at.localeCompare(a.at))
    };
  });
}

module.exports = { coachOwns, coachSide, coachGames, coachAllGames, confirmGame, rate, myRatings, ratingSummary };
