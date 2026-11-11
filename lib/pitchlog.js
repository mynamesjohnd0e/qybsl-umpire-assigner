// Pitch logging: each head coach logs their own pitchers for a game (player and
// pitches, plus innings as outs when the pitcher is 12 by league age). A division
// director or admin can log for a coach who can't. League games only. Logging
// always succeeds — the engine warns, it never blocks (docs/PLAN.md). The rules
// themselves live in lib/pitching.js.
const store = require('./store');
const clock = require('./clock');
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
  const id = `${game.id}:${player.id}`;
  const entry = {
    id, gameId: game.id, playerId: player.id, playerName: player.name,
    team: player.team, division: game.division, date: etDateKey(game.start),
    pitches, outs, leagueAge: player.leagueAge, suspended: !!body.suspended,
    loggedBy: person.email, at: clock.now().toISOString()
  };
  await store.set('pitchlogs', id, entry);
  const check = P.checkCount(pitches, player.leagueAge, limits);
  G.addHistory(game, `Pitch count logged: ${player.name} ${pitches}${check.status !== 'ok' ? ` (${check.status})` : ''}`, person.email);
  await store.set('games', game.id, game);
  return { entry, check };
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

module.exports = { logPitches, playerOutings, playerEligibility, gameLog };
