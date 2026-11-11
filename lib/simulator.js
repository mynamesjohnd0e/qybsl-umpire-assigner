// A practice-season simulator. It replays the 2026 fixture day by day on the
// injectable clock, driving the real app the way scripted coaches, umpires and a
// director would: umpires are assigned, home coaches enter the real scores, away
// coaches confirm or (sometimes) dispute, coaches confirm the umpires worked (or
// a no-show), one Saturday is rained out, and at season end everyone is paid.
//
// It returns a report the end-of-season checks assert against. It drives lib
// functions directly (not HTTP) so a 28-day, 96-game season runs in a moment.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const clock = require('./clock');
const { saveSettings } = require('./settings');
const { runSync } = require('./sync');
const G = require('./games');
const coach = require('./coach');
const scores = require('./scores');
const payouts = require('./payouts');
const closures = require('./closures');
const { parseSeCsv } = require('./secsv');
const { etDateKey, etDayStart, addDaysToKey } = require('./time');

const FIXTURE = () => fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', '2026-farm-schedule-export.csv'), 'utf8');

async function setupLeague(games) {
  const contacts = new Set(['dir@sim.test', 'comms@sim.test', 'admin@sim.test']);
  // One coach per team.
  const teams = new Map();
  for (const g of games) { teams.set(g.home, g.division); teams.set(g.away, g.division); }
  const coachByTeam = {};
  let ci = 0;
  for (const [team, division] of teams) {
    const email = `coach${ci++}@sim.test`;
    const p = { email, name: `Coach ${team}`, mobile: '6170000000', registered: true, coach: { onRoster: true, pending: false, teams: [{ team, division }] } };
    await store.set('people', email, p);
    coachByTeam[team] = p; contacts.add(email);
  }
  // A pool of umpires (the first three are plate-qualified), each with a parent.
  const umps = [];
  for (let i = 0; i < 6; i++) {
    const email = `ump${i}@sim.test`, parentEmail = `parent${i}@sim.test`;
    const p = { email, name: `Ump ${i}`, mobile: `617111000${i}`, registered: true, umpire: { onRoster: true, approved: true, active: true, plateQualified: i < 3, parentName: 'P', parentEmail, parentMobile: `617222000${i}`, venmo: `@u${i}` } };
    await store.set('people', email, p); umps.push(p); contacts.add(email); contacts.add(parentEmail);
  }
  const director = { email: 'dir@sim.test', name: 'Farm Director', registered: true, director: { divisions: ['Farm 8', 'Farm 9'] } };
  await store.set('people', director.email, director);
  return { coachByTeam, umps, director, contacts };
}

async function simulateSeason(opts = {}) {
  const fixture = opts.fixture || FIXTURE();
  const admin = { email: 'admin@sim.test', isAdmin: true };

  // Real scores by game uid, and a scoreless copy to import (coaches enter them).
  const realByUid = new Map();
  for (const e of parseSeCsv(fixture)) if (e.importedScore) realByUid.set(e.uid, e.importedScore);
  const scoreless = fixture.split('\n').map((l, i) => i === 0 ? l : l.replace(/,\s*\d+\s*,\s*\d+\s*$/, ',,')).join('\n');

  await saveSettings({ seasonLabel: 'Spring 2026', seasonYear: 2026, adminEmails: ['admin@sim.test'], directorEmail: 'dir@sim.test', commsDirectorEmail: 'comms@sim.test', payRate: 40 });
  // Import a week before the first game so every game is "upcoming".
  const allEvents = parseSeCsv(fixture);
  const firstDay = allEvents.map(e => etDateKey(e.start)).sort()[0];
  clock.setNow(new Date(etDayStart(addDaysToKey(firstDay, -7)).getTime()));
  await store.set('uploads', 'main', { text: scoreless, season: 'Spring 2026' });
  await saveSettings({ feeds: [{ url: 'upload:main', season: 'Spring 2026' }] });
  await runSync({ by: 'sim' });

  const games = (await store.list('games')).filter(g => g.track === 'student');
  const { coachByTeam, umps, director, contacts } = await setupLeague(games);

  const allDays = [...new Set(games.map(g => etDateKey(g.start)))].sort();
  const lastDay = allDays[allDays.length - 1];
  const rainDay = opts.rainDay || allDays[Math.floor(allDays.length / 2)];
  const plate = umps.filter(u => u.umpire.plateQualified), field = umps;

  const scored = [], messagesPerDay = {}, errors = [];
  let n = 0, ai = 0;

  for (let d = allDays[0]; d <= lastDay; d = addDaysToKey(d, 1)) {
    clock.setNow(new Date(etDayStart(d).getTime() + 20 * 3600e3)); // 8pm Eastern
    const before = (await store.list('outbox')).length;

    // Auto-confirm scores the away coach never answered (yesterday's).
    try { await scores.autoConfirm(clock.now()); } catch (e) { errors.push(`autoconfirm ${d}: ${e.message}`); }

    const today = games.filter(g => etDateKey(g.start) === d && G.isLive(g));

    if (d === rainDay) {
      try { await closures.closeFields(admin, { all: true, date: d, reason: 'rain' }); } catch (e) { errors.push(`rain ${d}: ${e.message}`); }
      messagesPerDay[d] = (await store.list('outbox')).length - before;
      continue;
    }

    for (const g of today) {
      n++;
      // Assign both umpires (admin override; the schedule is dense).
      try {
        await G.adminAssign(admin.email, g.id, 'plate', plate[ai % plate.length].email, true);
        await G.adminAssign(admin.email, g.id, 'field', field[3 + (ai % 3)].email, true); // 3,4,5 — never the plate ump
      } catch (e) { errors.push(`assign ${g.id}: ${e.message}`); }
      ai++;

      // The coach confirms the umpires worked (every 9th game has a field no-show).
      const fieldWorked = n % 9 === 0 ? 'noshow' : 'worked';
      try { await coach.confirmGame(coachByTeam[g.home], g.id, { plate: 'worked', field: fieldWorked }); } catch (e) { errors.push(`confirm ${g.id}: ${e.message}`); }

      // The home coach enters the real final score.
      const real = realByUid.get(g.uid);
      if (!real) continue;
      try {
        await scores.enterScore(coachByTeam[g.home], g.id, { homeRuns: real.homeRuns, awayRuns: real.awayRuns });
        if (n % 7 === 0) {            // the away coach disputes; the director settles
          await scores.disputeScore(coachByTeam[g.away], g.id, 'we had it different');
          await scores.settleScore(director, g.id, { homeRuns: real.homeRuns, awayRuns: real.awayRuns });
        } else if (n % 11 !== 0) {    // the away coach confirms (every 11th is left to auto-confirm)
          await scores.confirmScore(coachByTeam[g.away], g.id, { homeRuns: real.homeRuns, awayRuns: real.awayRuns });
        }
        scored.push({ gameId: g.id, division: g.division, home: g.home, away: g.away, homeRuns: real.homeRuns, awayRuns: real.awayRuns });
      } catch (e) { errors.push(`score ${g.id}: ${e.message}`); }
    }
    messagesPerDay[d] = (await store.list('outbox')).length - before;
  }

  // Final sweep: auto-confirm anything still waiting, then pay everyone once.
  clock.setNow(new Date(etDayStart(addDaysToKey(lastDay, 2)).getTime() + 20 * 3600e3));
  await scores.autoConfirm(clock.now());
  const payoutEnd = addDaysToKey(lastDay, 2);
  let payout = null;
  try { payout = await payouts.markPaid(payoutEnd, admin.email); } catch (e) { errors.push(`payout: ${e.message}`); }

  const outbox = await store.list('outbox');
  const maxDayMessages = Math.max(0, ...Object.values(messagesPerDay));
  return {
    games, scored, errors, payout, contacts, outbox,
    messagesPerDay, maxDayMessages, rainDay, lastDay,
    allPeople: await store.list('people')
  };
}

module.exports = { simulateSeason, setupLeague };
