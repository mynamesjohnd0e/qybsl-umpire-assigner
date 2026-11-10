// Scores: the home coach enters the final score, the away coach confirms or
// disputes it, and after 24 hours with no answer it auto-confirms. Disputes and
// other-town games go to the division director, who can also mark a forfeit
// (6–0) or enter a score for a coach who can't. Confirmed scores land on the
// "enter in SE" list that directors copy into SportsEngine by hand.
//
// The score lives on the game as `game.score`. A game with no score has none.
const store = require('./store');
const clock = require('./clock');
const notify = require('./notify');
const { getSettings } = require('./settings');
const G = require('./games');
const { coachSide } = require('./coach');
const { teamsIndex, norm } = require('./teams');
const { HOUR, fmtGame, etDateKey } = require('./time');

const FORFEIT_RUNS = 6; // a forfeit counts as a 6–0 win

// The opponent's name when this is an inter-town game (exactly one team is on
// our coach list), else null — intra-league, or we can't tell yet.
function otherTownOpponent(game, idx) {
  if (!idx || !idx.size) return null;
  const homeKnown = idx.has(norm(game.home)), awayKnown = idx.has(norm(game.away));
  if (homeKnown && !awayKnown) return game.away;
  if (awayKnown && !homeKnown) return game.home;
  return null;
}

// Why a score can't be touched on this game yet (cancelled, or not started).
function notScoreable(game) {
  if (!game) return 'Game not found.';
  if (!G.isLive(game)) return 'This game was cancelled or rained out, so it has no score.';
  if (new Date(game.start) > clock.now()) return 'You can enter a score once the game has started.';
  return null;
}

const runs = v => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new Error('Each score must be a whole number from 0 to 99.');
  return n;
};
const names = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(x => String(x).trim()).filter(Boolean).slice(0, 30);

async function loadDivisionDirectors(division) {
  const people = await store.list('people');
  return people.filter(p => p.director?.divisions?.includes(division));
}

// Tell the division's director(s) something about a game's score.
async function tellDirectors(game, msg) {
  const dirs = await loadDivisionDirectors(game.division);
  const foot = await notify.footer();
  await Promise.allSettled(dirs.map(d => notify.toAdult(d, { ...msg, text: `${msg.text}${foot}` })));
}

// ── Home coach (or a director on their behalf) enters / corrects the score ────
async function enterScore(person, gameId, body, { asDirector = false } = {}) {
  const s = await getSettings();
  const idx = await teamsIndex();
  const homeRuns = runs(body.homeRuns), awayRuns = runs(body.awayRuns);
  const homeHR = names(body.homeHR), awayHR = names(body.awayHR);
  const game = await store.transact(async tx => {
    const g = await tx.get('games', gameId);
    const why = notScoreable(g);
    if (why) throw new Error(why);
    if (!asDirector && coachSide(person, g) !== 'home') {
      throw new Error(coachSide(person, g) === 'away'
        ? 'The home coach enters the score; you confirm or dispute it.'
        : 'You can only enter scores for your own team\'s home games.');
    }
    const cur = g.score;
    if (cur) {
      if (cur.status === 'final' && !asDirector) throw new Error('This score is final. Ask your division director to change it.');
      if (cur.status === 'disputed' && !asDirector) throw new Error('This score is in dispute. Your division director will settle it.');
    }
    const opp = otherTownOpponent(g, idx);
    const now = clock.now();
    g.score = {
      ...(cur || { homeHR: [], awayHR: [] }),
      homeRuns, awayRuns, homeHR, awayHR,
      rev: (cur?.rev || 0) + 1,
      enteredBy: person.email, enteredByRole: asDirector ? 'director' : 'home', enteredAt: now.toISOString(),
      otherTown: !!opp, opponentTown: opp || null,
      forfeit: false, forfeitWinner: null,
      disputedBy: null, disputedAt: null, disputeNote: null,
      enteredInSE: cur?.enteredInSE || false,
      status: opp ? 'approval' : 'entered',
      autoConfirmBy: opp ? null : new Date(now.getTime() + s.scoreAutoConfirmHours * HOUR).toISOString(),
      confirmedBy: null, confirmedAt: null, confirmedHow: null
    };
    G.addHistory(g, `Score ${homeRuns}–${awayRuns} entered${asDirector ? ' by director' : ''}`, person.email);
    tx.set('games', gameId, g);
    return g;
  });
  // Nudge the away side / director about what to do next.
  if (game.score.status === 'approval') {
    await tellDirectors(game, { kind: 'score-approve', gameId, subject: `Approve a score: ${fmtGame(game.start)}`, text: `An out-of-town game needs your approval before it's final:\n\n${describe(game)}\nEntered: ${scoreLine(game)}` });
  }
  return game;
}

// ── Away coach confirms the version they saw (that version becomes final) ──────
async function confirmScore(person, gameId, body) {
  // The away coach confirms the exact numbers they were shown. If the home coach
  // corrected the score at the same moment, the version the away coach saw is
  // the one that becomes final (per the spec).
  const seenHome = runs(body.homeRuns), seenAway = runs(body.awayRuns);
  return store.transact(async tx => {
    const g = await tx.get('games', gameId);
    const why = notScoreable(g);
    if (why) throw new Error(why);
    if (coachSide(person, g) !== 'away') {
      throw new Error(coachSide(person, g) === 'home'
        ? 'The home coach can\'t confirm their own score — the away coach does.'
        : 'You can only confirm scores for your own team\'s away games.');
    }
    const sc = g.score;
    if (!sc || sc.status === 'none') throw new Error('There is no score to confirm yet.');
    if (sc.status === 'approval') throw new Error('This game is between towns; your division director approves the score.');
    if (sc.status === 'disputed') throw new Error('This score is in dispute. Your division director will settle it.');
    if (sc.status === 'final') throw new Error('This score is already final.');
    sc.homeRuns = seenHome; sc.awayRuns = seenAway;
    sc.status = 'final'; sc.confirmedBy = person.email; sc.confirmedHow = 'away'; sc.confirmedAt = clock.now().toISOString();
    sc.autoConfirmBy = null;
    G.addHistory(g, `Score ${seenHome}–${seenAway} confirmed by away coach`, person.email);
    tx.set('games', gameId, g);
    return g;
  });
}

// ── Away coach disputes (stops auto-confirm for good; director settles) ───────
async function disputeScore(person, gameId, note) {
  const game = await store.transact(async tx => {
    const g = await tx.get('games', gameId);
    const why = notScoreable(g);
    if (why) throw new Error(why);
    if (coachSide(person, g) !== 'away') throw new Error('Only the away coach disputes a score.');
    const sc = g.score;
    if (!sc || sc.status === 'none') throw new Error('There is no score to dispute yet.');
    if (sc.status === 'final') throw new Error('This score is already final.');
    if (sc.status === 'approval') throw new Error('This game is between towns; your division director approves the score.');
    sc.status = 'disputed'; sc.disputedBy = person.email; sc.disputedAt = clock.now().toISOString();
    sc.disputeNote = String(note || '').slice(0, 500); sc.autoConfirmBy = null;
    G.addHistory(g, 'Score disputed by away coach', person.email);
    tx.set('games', gameId, g);
    return g;
  });
  await tellDirectors(game, { kind: 'score-dispute', gameId, subject: `Disputed score: ${fmtGame(game.start)}`, text: `A score was disputed and needs you to settle it:\n\n${describe(game)}\nEntered: ${scoreLine(game)}\nNote: ${game.score.disputeNote || '(none)'}` });
  return game;
}

// ── Director/admin: settle a dispute or correct a final score ──────────────────
async function settleScore(person, gameId, body) {
  const homeRuns = runs(body.homeRuns), awayRuns = runs(body.awayRuns);
  return store.transact(async tx => {
    const g = await tx.get('games', gameId);
    const why = notScoreable(g);
    if (why) throw new Error(why);
    const sc = g.score || { homeHR: [], awayHR: [], rev: 0, enteredInSE: false };
    Object.assign(sc, {
      homeRuns, awayRuns, status: 'final', forfeit: false, forfeitWinner: null,
      settledBy: person.email, settledAt: clock.now().toISOString(),
      disputedBy: null, disputedAt: null, autoConfirmBy: null, rev: (sc.rev || 0) + 1
    });
    g.score = sc;
    G.addHistory(g, `Score settled ${homeRuns}–${awayRuns} by director`, person.email);
    tx.set('games', gameId, g);
    return g;
  });
}

// ── Director approves an out-of-town game's score ──────────────────────────────
async function approveScore(person, gameId) {
  return store.transact(async tx => {
    const g = await tx.get('games', gameId);
    if (!g) throw new Error('Game not found.');
    const sc = g.score;
    if (!sc || sc.status !== 'approval') throw new Error('That game is not waiting for approval.');
    sc.status = 'final'; sc.approvedBy = person.email; sc.approvedAt = clock.now().toISOString();
    G.addHistory(g, `Out-of-town score approved ${sc.homeRuns}–${sc.awayRuns}`, person.email);
    tx.set('games', gameId, g);
    return g;
  });
}

// ── Director marks a forfeit: 6–0 to the winning side ──────────────────────────
async function forfeitScore(person, gameId, winner) {
  if (!['home', 'away'].includes(winner)) throw new Error('Say which side won the forfeit (home or away).');
  return store.transact(async tx => {
    const g = await tx.get('games', gameId);
    if (!g) throw new Error('Game not found.');
    if (!G.isLive(g)) throw new Error('This game was cancelled or rained out.');
    const sc = g.score || { homeHR: [], awayHR: [], rev: 0, enteredInSE: false };
    Object.assign(sc, {
      homeRuns: winner === 'home' ? FORFEIT_RUNS : 0,
      awayRuns: winner === 'away' ? FORFEIT_RUNS : 0,
      homeHR: [], awayHR: [], forfeit: true, forfeitWinner: winner, status: 'final',
      settledBy: person.email, settledAt: clock.now().toISOString(), disputedBy: null, autoConfirmBy: null,
      rev: (sc.rev || 0) + 1
    });
    g.score = sc;
    G.addHistory(g, `Forfeit: ${winner} wins 6–0`, person.email);
    tx.set('games', gameId, g);
    return g;
  });
}

// ── Mark a final score as copied into SportsEngine ─────────────────────────────
async function markEnteredSE(person, gameId) {
  return store.transact(async tx => {
    const g = await tx.get('games', gameId);
    if (!g?.score || g.score.status !== 'final') throw new Error('Only a final score can be marked entered in SportsEngine.');
    g.score.enteredInSE = true; g.score.enteredInSEBy = person.email; g.score.enteredInSEAt = clock.now().toISOString();
    tx.set('games', gameId, g);
    return g;
  });
}

// The "enter in SE" list: final scores not yet copied into SportsEngine. Scoped
// to a director's divisions, or all for an admin.
async function enterSEList(user) {
  const games = await store.list('games');
  return games
    .filter(g => g.score?.status === 'final' && !g.score.enteredInSE && G.isLive(g))
    .filter(g => user.isAdmin || (user.director?.divisions || []).includes(g.division))
    .sort((a, b) => a.start.localeCompare(b.start))
    .map(g => ({ id: g.id, division: g.division, home: g.home, away: g.away, when: fmtGame(g.start), score: scoreLine(g), forfeit: !!g.score.forfeit }));
}

// ── Job: auto-confirm entered intra-league scores past the 24-hour deadline ────
async function autoConfirm(now) {
  const games = await store.list('games');
  let confirmed = 0;
  for (const g of games) {
    const sc = g.score;
    if (!sc || sc.status !== 'entered' || sc.otherTown || !sc.autoConfirmBy) continue;
    if (new Date(sc.autoConfirmBy) > now) continue; // deadline not reached
    const done = await store.transact(async tx => {
      const cur = await tx.get('games', g.id);
      const c = cur.score;
      if (!c || c.status !== 'entered' || c.otherTown || new Date(c.autoConfirmBy) > now) return false;
      c.status = 'final'; c.confirmedHow = 'auto'; c.confirmedAt = now.toISOString(); c.autoConfirmBy = null;
      G.addHistory(cur, 'Score auto-confirmed (no dispute within 24 hours)', 'system');
      tx.set('games', cur.id, cur);
      return true;
    });
    if (done) confirmed++;
  }
  return confirmed;
}

function describe(g) {
  const teams = g.home && g.away ? `${g.away} at ${g.home}` : g.summary;
  return `${g.division} · ${teams}\n${fmtGame(g.start)}`;
}
function scoreLine(g) {
  const sc = g.score; if (!sc) return '(none)';
  return `${g.home} ${sc.homeRuns} – ${sc.awayRuns} ${g.away}${sc.forfeit ? ' (forfeit)' : ''}`;
}

// A safe score view for API responses.
function scoreView(g) {
  const sc = g.score;
  if (!sc || sc.status === 'none') return null;
  return {
    homeRuns: sc.homeRuns, awayRuns: sc.awayRuns, homeHR: sc.homeHR || [], awayHR: sc.awayHR || [],
    status: sc.status, rev: sc.rev, forfeit: !!sc.forfeit, forfeitWinner: sc.forfeitWinner || null,
    otherTown: !!sc.otherTown, enteredByRole: sc.enteredByRole,
    autoConfirmBy: sc.autoConfirmBy || null, confirmedHow: sc.confirmedHow || null,
    disputeNote: sc.status === 'disputed' ? sc.disputeNote : null,
    enteredInSE: !!sc.enteredInSE
  };
}

module.exports = {
  FORFEIT_RUNS, otherTownOpponent, notScoreable, scoreView, scoreLine,
  enterScore, confirmScore, disputeScore, settleScore, approveScore, forfeitScore,
  markEnteredSE, enterSEList, autoConfirm
};
