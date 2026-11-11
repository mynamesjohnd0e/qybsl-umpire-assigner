// Proves the test suite actually bites. For each deliberately planted bug, this
// breaks one rule in the real code, runs the tests that cover it, and checks
// they go red — then restores the code. If a break does NOT turn a test red, the
// suite has a hole and this script fails the build. This is the Sprint 0
// promise: a pushed bug is blocked from deploying.
//
// Run: npm run planted-bugs
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const file = p => path.join(ROOT, p);

// Each bug: a single, surgical edit to a rule, and the tests that must catch it.
const BUGS = [
  {
    name: 'weekly game limit off by one',
    file: 'lib/games.js',
    find: 'if (inWeek >= s.weeklyCap)',
    replace: 'if (inWeek > s.weeklyCap)',
    tests: ['test/unit/games-rules.test.js', 'test/api/claim.test.js']
  },
  {
    name: 'plate-qualified rule removed',
    file: 'lib/games.js',
    find: "if (slot === 'plate' && !u.plateQualified)",
    replace: "if (slot === 'plate' && false)",
    tests: ['test/unit/games-rules.test.js', 'test/api/claim.test.js']
  },
  {
    name: 'reconfirm expiry ignores game start',
    file: 'lib/jobs.js',
    find: 'if (new Date(cur.start) <= now) {',
    replace: 'if (false) {',
    tests: ['test/api/reconfirm.test.js', 'test/api/sync-csv.test.js']
  },
  {
    name: 'payout includes no-shows',
    file: 'lib/payouts.js',
    find: "if (sl.worked === 'worked') {",
    replace: "if (sl.worked === 'worked' || sl.worked === 'noshow') {",
    tests: ['test/api/payouts.test.js']
  },
  {
    name: 'parent copy dropped from umpire messages',
    file: 'lib/notify.js',
    find: 'u.parentEmail ? sendEmail(u.parentEmail,',
    replace: 'false ? sendEmail(u.parentEmail,',
    tests: ['test/api/messaging.test.js']
  },
  // Sprint 1 rules.
  {
    name: 'league age ignores the April 30 cutoff',
    file: 'lib/roster.js',
    find: 'if (b.m > 4 || (b.m === 4 && b.d > 30)) age -= 1;',
    replace: 'if (false) age -= 1;',
    tests: ['test/unit/roster.test.js', 'test/api/roster-players.test.js']
  },
  {
    name: 'a missing player is deleted instead of flagged',
    file: 'lib/roster.js',
    find: "await store.set('players', p.id, { ...p, missing: true, missingSince: clock.now().toISOString() });",
    replace: "await store.del('players', p.id);",
    tests: ['test/api/roster-players.test.js']
  },
  {
    name: 'division director scope removed (can manage any division)',
    file: 'lib/auth.js',
    find: '(division && u.director && (u.director.divisions || []).includes(division))',
    replace: 'true',
    tests: ['test/api/director.test.js']
  },
  {
    name: 'unmatched team names never reported',
    file: 'lib/teams.js',
    find: 'if (!idx.has(key)) out.push(String(n).trim());',
    replace: 'if (false) out.push(String(n).trim());',
    tests: ['test/unit/teams.test.js', 'test/api/teams.test.js']
  },
  // Sprint 2 rules.
  {
    name: 'the away coach can enter the score',
    file: 'lib/scores.js',
    find: "if (!asDirector && coachSide(person, g) !== 'home') {",
    replace: 'if (false) {',
    tests: ['test/api/scores.test.js']
  },
  {
    name: 'the home coach can confirm their own score',
    file: 'lib/scores.js',
    find: "if (coachSide(person, g) !== 'away') {",
    replace: 'if (false) {',
    tests: ['test/api/scores.test.js']
  },
  {
    name: 'a forfeit is not 6-0',
    file: 'lib/scores.js',
    find: 'const FORFEIT_RUNS = 6;',
    replace: 'const FORFEIT_RUNS = 5;',
    tests: ['test/api/scores.test.js', 'test/unit/scores.test.js']
  },
  {
    name: 'an out-of-town game auto-confirms instead of waiting for approval',
    file: 'lib/scores.js',
    find: "status: opp ? 'approval' : 'entered',",
    replace: "status: 'entered',",
    tests: ['test/api/scores-othertown.test.js']
  },
  // Sprint 3 rules.
  {
    name: 'a standings tie counts as a full win, not half',
    file: 'lib/standings.js',
    find: 'const winPct = r => (r.gp ? (r.w + 0.5 * r.t) / r.gp : 0);',
    replace: 'const winPct = r => (r.gp ? (r.w + 1 * r.t) / r.gp : 0);',
    tests: ['test/unit/standings.test.js']
  },
  {
    name: 'runs allowed is miscounted',
    file: 'lib/standings.js',
    find: 'h.ra += ar; a.ra += hr;',
    replace: 'h.ra += 0; a.ra += hr;',
    tests: ['test/unit/standings.test.js', 'test/api/standings.test.js']
  },
  {
    name: 'head-to-head is skipped as a tiebreaker',
    file: 'lib/standings.js',
    find: 'if (level === 1) return headToHeadPct(t, teams, ctx.games);',
    replace: 'if (level === 1) return 0;',
    tests: ['test/unit/standings.test.js']
  },
  {
    name: 'the higher seed is not made home',
    file: 'lib/brackets.js',
    find: 'm.homeSeed = Math.min(sa, sb); m.awaySeed = Math.max(sa, sb); m.ready = true;',
    replace: 'm.homeSeed = Math.max(sa, sb); m.awaySeed = Math.min(sa, sb); m.ready = true;',
    tests: ['test/unit/brackets.test.js', 'test/api/brackets.test.js']
  },
  {
    name: 'the "if needed" final is never triggered',
    file: 'lib/brackets.js',
    find: 'if (winnerSeed !== wbSeed) { b.matches.GF2.needed = true; b.finalId = \'GF2\'; }',
    replace: 'if (false) { b.matches.GF2.needed = true; b.finalId = \'GF2\'; }',
    tests: ['test/unit/brackets.test.js']
  },
  {
    name: 'imported scores are not marked final',
    file: 'lib/sync.js',
    find: "status: 'final', source: 'import', enteredByRole: 'import', otherTown: false,",
    replace: "status: 'entered', source: 'import', enteredByRole: 'import', otherTown: false,",
    tests: ['test/api/standings.test.js']
  },
  // Sprint 4 rules.
  {
    name: 'rest-day bracket boundary off by one',
    file: 'lib/pitching.js',
    find: 'return brackets.filter(b => pitches > b).length;',
    replace: 'return brackets.filter(b => pitches >= b).length;',
    tests: ['test/unit/pitching.test.js']
  },
  {
    name: 'finish-the-batter tolerance swallows real violations',
    file: 'lib/pitching.js',
    find: "if (over <= (limits.finishBatterTolerance ?? 0)) return { status: 'check-finished-batter', max, over };",
    replace: "if (over <= 1000) return { status: 'check-finished-batter', max, over };",
    tests: ['test/unit/pitching.test.js', 'test/api/pitching.test.js']
  },
  {
    name: 'two games in a day do not combine',
    file: 'lib/pitching.js',
    find: 'return outings.reduce((n, o) => (o.date === dateKey ? n + (o.pitches || 0) : n), 0);',
    replace: 'return outings.reduce((n, o) => (o.date === dateKey ? o.pitches || 0 : n), 0);',
    tests: ['test/unit/pitching.test.js']
  },
  {
    name: 'a rested pitcher is shown as available',
    file: 'lib/pitching.js',
    find: 'if (r > 0) {',
    replace: 'if (false) {',
    tests: ['test/unit/pitching.test.js', 'test/api/pitching.test.js']
  },
  // Sprint 5 rules.
  {
    name: 'the 12-year-old weekly cap never reads as over',
    file: 'lib/pitching.js',
    find: 'over: outs > capOuts,',
    replace: 'over: false,',
    tests: ['test/unit/pitching.test.js', 'test/api/eligibility.test.js']
  },
  {
    name: 'a violation alert is sent on every edit, not once per problem',
    file: 'lib/pitchlog.js',
    find: 'if (active && !existing) {',
    replace: 'if (active) {',
    tests: ['test/api/eligibility.test.js']
  },
  {
    name: 'a corrected violation never clears',
    file: 'lib/pitchlog.js',
    find: '} else if (!active && existing) {',
    replace: '} else if (false) {',
    tests: ['test/api/eligibility.test.js']
  },
  {
    name: 'the opposing coach can change another team\'s logs',
    file: 'lib/pitchlog.js',
    find: '!teams.includes(norm(player.team))',
    replace: 'false',
    tests: ['test/api/eligibility.test.js', 'test/api/pitching.test.js']
  },
  // Sprint 6 rules.
  {
    name: 'a rainout window catches a game ending exactly as it starts',
    file: 'lib/closures.js',
    find: 'return gs < ct && cf < ge;',
    replace: 'return gs < ct && cf <= ge;',
    tests: ['test/api/closures.test.js']
  },
  {
    name: 'a rained-out game is still treated as live',
    file: 'lib/games.js',
    find: "const isLive = g => g.status !== 'cancelled' && g.status !== 'rainout';",
    replace: "const isLive = g => g.status !== 'cancelled';",
    tests: ['test/api/closures.test.js']
  },
  {
    name: 're-closing re-notifies already rained-out games',
    file: 'lib/closures.js',
    find: "g.status === 'scheduled' && overlapsClosure(g, closure, s)",
    replace: 'overlapsClosure(g, closure, s)',
    tests: ['test/api/closures.test.js']
  },
  {
    name: 'makeups are not paired to their original',
    file: 'lib/sync.js',
    find: 'if (original) {',
    replace: 'if (false) {',
    tests: ['test/api/makeups.test.js']
  }
];

// Returns true if the test run passed (exit 0), false if it failed (red).
function testsPass(tests) {
  try {
    execFileSync('node', ['--test', ...tests], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

let gaps = 0;
for (const bug of BUGS) {
  const full = file(bug.file);
  const original = fs.readFileSync(full, 'utf8');
  if (!original.includes(bug.find)) {
    console.error(`SETUP ERROR: could not find the line to break for "${bug.name}" in ${bug.file}.`);
    console.error('  The code changed; update scripts/planted-bugs.js to match.');
    process.exit(2);
  }
  let caught;
  try {
    fs.writeFileSync(full, original.replace(bug.find, bug.replace));
    caught = !testsPass(bug.tests); // broken code should make the tests fail
  } finally {
    fs.writeFileSync(full, original); // always restore
  }
  if (caught) {
    console.log(`  caught: ${bug.name}`);
  } else {
    gaps++;
    console.error(`  MISSED: ${bug.name} — the tests stayed green with the rule broken!`);
  }
}

if (gaps) {
  console.error(`\n${gaps} planted bug(s) slipped past the tests. Add coverage before closing the sprint.`);
  process.exit(1);
}
console.log(`\nAll ${BUGS.length} planted bugs were caught. The suite blocks a broken rule from deploying.`);
