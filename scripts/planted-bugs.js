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
