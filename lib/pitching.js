// The pitch-count rules engine. Pure functions over a player's outings and the
// limits from Settings — no stored state, no clock of its own — so the same
// inputs always give the same answer and a test can pin every boundary.
//
// An "outing" is one game's line for one pitcher: { date (Eastern day key),
// pitches, outs?, suspended? }. Two games on the same day combine for rest, and
// pitches thrown in a suspended game count like any other.
//
// Limits live in Settings (see lib/settings.js): the rest brackets, the daily
// max by league age, the finish-the-batter tolerance, and how a day of rest maps
// to the next eligible day. Nothing here is hard-coded.
const { addDaysToKey } = require('./time');

// Rest days required for a given day's pitch total. brackets = [20,35,50,65]
// means ≤20 → 0 days, ≤35 → 1, ≤50 → 2, ≤65 → 3, over the last → 4.
function restDays(pitches, brackets) {
  return brackets.filter(b => pitches > b).length;
}

// The daily max for a league age, or null when no limit is defined for that age.
function dailyMax(leagueAge, ranges) {
  const r = (ranges || []).find(x => leagueAge >= x.lo && leagueAge <= x.hi);
  return r ? r.max : null;
}

// Total pitches on one Eastern day (all of a player's outings that day).
function pitchesOnDay(outings, dateKey) {
  return outings.reduce((n, o) => (o.date === dateKey ? n + (o.pitches || 0) : n), 0);
}

// date key → total pitches that day (two games a day combine; suspended count).
function dailyTotals(outings) {
  const m = new Map();
  for (const o of outings) m.set(o.date, (m.get(o.date) || 0) + (o.pitches || 0));
  return m;
}

// The first day the pitcher is eligible again, given their outings — the latest
// outing's rest requirement governs. Returns a day key, or null if no rest is
// owed. NOTE: the exact day a "4 days rest" pitcher returns is the open question
// for the Cal Ripken Director; `restEligibleOffset` in Settings controls it.
function restingUntil(outings, limits) {
  let until = null;
  for (const [date, total] of dailyTotals(outings)) {
    const r = restDays(total, limits.pitchRestBrackets);
    if (r > 0) {
      const eligible = addDaysToKey(date, r + (limits.restEligibleOffset ?? 1));
      if (!until || eligible > until) until = eligible;
    }
  }
  return until;
}

// A pitcher's status for a given day: are they available, resting until when, and
// how many pitches they have left today (two games a day share the daily max).
function eligibility(outings, dateKey, leagueAge, limits) {
  const max = dailyMax(leagueAge, limits.pitchDailyMax);
  const prior = outings.filter(o => o.date < dateKey);
  const until = restingUntil(prior, limits);
  const resting = !!(until && dateKey < until);
  const pitchedToday = pitchesOnDay(outings, dateKey);
  const left = max == null ? null : Math.max(0, max - pitchedToday);
  const available = !resting && (max == null || left > 0);
  return {
    date: dateKey, leagueAge, dailyMax: max,
    pitchedToday, pitchesLeftToday: left,
    restingUntil: resting ? until : null, available
  };
}

// Check a logged count against the daily max. Reaching the max and finishing the
// current batter is allowed, so a small overage is a "check" rather than a
// violation. Over the tolerance is a violation. The app warns and reports but
// never blocks saving (see docs/PLAN.md).
function checkCount(pitches, leagueAge, limits) {
  const max = dailyMax(leagueAge, limits.pitchDailyMax);
  if (max == null) return { status: 'ok', max: null };
  const over = pitches - max;
  if (over <= 0) return { status: 'ok', max, over: 0 };
  if (over <= (limits.finishBatterTolerance ?? 0)) return { status: 'check-finished-batter', max, over };
  return { status: 'violation', max, over };
}

// Innings are stored as outs. Helpers to read them back as thirds.
const outsToInnings = outs => `${Math.floor(outs / 3)}${['', '⅓', '⅔'][outs % 3] || ''}`;
const inningsToOuts = (whole, thirds = 0) => whole * 3 + thirds;

module.exports = {
  restDays, dailyMax, pitchesOnDay, dailyTotals, restingUntil, eligibility, checkCount,
  outsToInnings, inningsToOuts
};
