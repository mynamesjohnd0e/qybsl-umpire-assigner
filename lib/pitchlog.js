// Pitch logging: each head coach logs their own pitchers for a game (player and
// pitches, plus innings as outs when the pitcher is 12 by league age). A division
// director or admin can log for a coach who can't. League games only. Logging
// always succeeds — the engine warns, it never blocks (docs/PLAN.md). The rules
// themselves live in lib/pitching.js.
const store = require('./store');
const clock = require('./clock');
const notify = require('./notify');
const { getSettings } = require('./settings');
const G = require('./games');
const P = require('./pitching');
const { norm } = require('./teams');
const { etDateKey } = require('./time');

// Log (or correct) one pitcher's line for a game. Returns the stored entry and
// the engine's check (ok / check-finished-batter / violation).
async function logPitches(person, body, { asDirector = false } = {}) {
  const limits = await getSettings();
  const game = await store.get('games', body.gameId);
  if (!game) throw new Error('Game not found.');
  if (!G.isLive(game)) throw new Error('This game was cancelled or rained out, so it has no pitch counts.');
  if (new Date(game.start) > clock.now()) throw new Error('You can log pitches once the game has started.');

  const player = await store.get('players', body.playerId);
  if (!player) throw new Error('Player not found. Upload the roster first.');
  if (!asDirector) {
    const teams = (person.coach?.teams || []).map(t => norm(t.team));
    if (!teams.includes(norm(player.team))) throw new Error('You can only log pitches for your own team\'s players.');
  }

  const pitches = Math.max(0, Math.round(Number(body.pitches) || 0));
  const needsInnings = Number(player.leagueAge) === 12; // 12-year-olds log innings (as outs) too
  const outs = needsInnings ? Math.max(0, Math.round(Number(body.outs) || 0)) : null;
  const date = etDateKey(game.start);
  const check = P.checkCount(pitches, player.leagueAge, limits);
  const id = `${game.id}:${player.id}`;
  const entry = {
    id, gameId: game.id, playerId: player.id, playerName: player.name,
    team: player.team, division: game.division, date,
    pitches, outs, leagueAge: player.leagueAge, suspended: !!body.suspended,
    dailyStatus: check.status, loggedBy: person.email, at: clock.now().toISOString()
  };
  await store.set('pitchlogs', id, entry);

  // The 12-year-old team week is recomputed after this count is stored.
  const weekly = needsInnings ? await teamTwelveWeek(player.team, date, limits) : null;
  entry.violation = check.status === 'violation' || !!(weekly && weekly.over);
  await store.set('pitchlogs', id, entry);

  // Alert the division (Cal Ripken) director once per problem; clear when fixed.
  const alerts = await evaluateAlerts(entry, check, weekly);
  G.addHistory(game, `Pitch count logged: ${player.name} ${pitches}${entry.violation ? ' (violation)' : ''}`, person.email);
  await store.set('games', game.id, game);
  return { entry, check, weekly, alerts };
}

// A team's running 12-year-old innings for the week containing `dateKey`.
async function teamTwelveWeek(team, dateKey, limits) {
  const wk = P.weekKeyOf(dateKey);
  const logs = (await store.list('pitchlogs')).filter(l => l.leagueAge === 12 && norm(l.team) === norm(team));
  const outs = P.sumOutsInWeek(logs, wk);
  return { week: wk, ...P.twelveCapStatus(outs, limits.twelveInningWeeklyOuts, limits.twelveInningNearOuts) };
}

// One alert per problem: a problem that is active and not yet alerted sends an
// email and is recorded; a problem that has cleared is removed (so a later
// recurrence alerts again). A daily violation keys on the entry; a weekly-cap
// violation keys on the team's week.
async function evaluateAlerts(entry, check, weekly) {
  const fired = [];
  await evalProblem(`daily:${entry.id}`, check.status === 'violation', {
    kind: 'daily', division: entry.division,
    subject: `Pitch-count violation: ${entry.playerName}`,
    text: `${entry.playerName} (${entry.team}) was logged at ${entry.pitches} pitches — over the daily max of ${check.max}.`
  }, fired);
  if (weekly) {
    await evalProblem(`week:${entry.division}:${norm(entry.team)}:${weekly.week}`, weekly.over, {
      kind: 'weekly', division: entry.division,
      subject: `12-year-old innings over the weekly cap: ${entry.team}`,
      text: `${entry.team}'s 12-year-olds have pitched ${weekly.innings} innings this Mon–Sun week — over the ${P.outsToInnings(weekly.capOuts)}-inning cap.`
    }, fired);
  }
  return fired;
}

async function evalProblem(id, active, info, fired) {
  const existing = await store.get('pitchalerts', id);
  if (active && !existing) {
    await store.set('pitchalerts', id, { id, kind: info.kind, division: info.division, detail: info.text, at: clock.now().toISOString() });
    await tellDivisionDirectors(info.division, { kind: `pitch-${info.kind}`, subject: info.subject, text: info.text });
    fired.push({ id, action: 'alerted' });
  } else if (!active && existing) {
    await store.del('pitchalerts', id);
    fired.push({ id, action: 'cleared' });
  }
}

async function tellDivisionDirectors(division, msg) {
  const dirs = (await store.list('people')).filter(p => p.director?.divisions?.includes(division));
  const foot = await notify.footer();
  await Promise.allSettled(dirs.map(d => notify.toAdult(d, { ...msg, text: `${msg.text}${foot}` })));
}

// Pre-game eligibility for both teams' pitchers, as of the game's date. Pitch
// history carries into playoffs because every outing counts, whatever the game.
async function gameEligibility(game) {
  const limits = await getSettings();
  const date = etDateKey(game.start);
  const [allPlayers, allLogs] = await Promise.all([store.list('players'), store.list('pitchlogs')]);
  const side = teamName => ({
    team: teamName,
    pitchers: allPlayers.filter(p => norm(p.team) === norm(teamName)).map(pl => {
      const outings = allLogs.filter(l => l.playerId === pl.id).map(l => ({ date: l.date, pitches: l.pitches, outs: l.outs, suspended: l.suspended }));
      return { id: pl.id, name: pl.name, number: pl.number, leagueAge: pl.leagueAge, ...P.eligibility(outings, date, pl.leagueAge, limits) };
    }).sort((a, b) => a.name.localeCompare(b.name))
  });
  return { gameId: game.id, division: game.division, date, home: side(game.home), away: side(game.away) };
}

// Active pitch-count problems for a director's divisions (the dashboard).
async function violationsFor(user) {
  return (await store.list('pitchalerts'))
    .filter(a => user.isAdmin || (user.director?.divisions || []).includes(a.division))
    .sort((a, b) => b.at.localeCompare(a.at));
}

// Every outing for a player, shaped for the rules engine.
async function playerOutings(playerId) {
  const logs = await store.list('pitchlogs');
  return logs.filter(l => l.playerId === playerId)
    .map(l => ({ date: l.date, pitches: l.pitches, outs: l.outs, suspended: l.suspended }));
}

// A player's eligibility for a date (defaults to today, Eastern).
async function playerEligibility(playerId, dateKey) {
  const limits = await getSettings();
  const player = await store.get('players', playerId);
  if (!player) throw new Error('Player not found.');
  const day = dateKey || etDateKey(clock.now());
  const outings = await playerOutings(playerId);
  return {
    player: { id: player.id, name: player.name, team: player.team, leagueAge: player.leagueAge },
    ...P.eligibility(outings, day, player.leagueAge, limits)
  };
}

// The logged lines for one game (for the admin/director view).
async function gameLog(gameId) {
  return (await store.list('pitchlogs')).filter(l => l.gameId === gameId)
    .sort((a, b) => a.playerName.localeCompare(b.playerName));
}

module.exports = { logPitches, playerOutings, playerEligibility, gameLog, gameEligibility, violationsFor, teamTwelveWeek };
