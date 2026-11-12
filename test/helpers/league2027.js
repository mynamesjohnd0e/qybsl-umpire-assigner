// The whole-league synthetic dataset for the Sprint 10 dress rehearsal: all five
// divisions at once, with made-up names only (no real SportsEngine export or
// roster ever lives in the repo). It sets up the people, teams and player
// rosters through the real API, and hands back an ICS schedule covering every
// division so the end-to-end walk can import it and then drive every feature.
//
// League ages are pinned to season year 2027 (age on April 30). The player
// birthdates are chosen to land on known ages, including the April 30 boundary
// (a 12-year-old born Apr 30 vs an 11-year-old born May 1) and two 12-year-olds
// on one team for the weekly-innings cap.
const { seCsv, seRow, fut } = require('./feeds');

// Teams per division. Farm 8 / Farm 9 take student umpires; Minors, Majors and
// Babe Ruth are patched (an assignor staffs them). All made-up sponsor names.
const DIVISIONS = {
  'Farm 8': ['Granite Co', 'Harborside HVAC', 'Marina Bay Dental', 'Furnace Brook Golf'],
  'Farm 9': ['Adams Press', 'Neponset Bank', 'Wollaston Wine', 'Squantum Yacht'],
  'Minors': ['Balduccis', 'Colonial Fed', 'Hancock Tavern', 'Curry Hardware'],
  'Majors': ['Keohanes', 'Boston Property', 'Quincy Police', 'Fours Pub', 'Craig Electric', 'Blacks Creek'],
  'Babe Ruth': ['Quincy Legion', 'Morrisette Post']
};

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const coachEmail = team => `coach.${slug(team)}@qyb.test`;

// Student umpires (Farm): name, email, plate-qualified. Each gets a parent, who
// is the one family address the league ever messages.
const UMPS = [
  { name: 'Alice Reed', email: 'alice@ump.test', plate: 'yes' },
  { name: 'Ben Ortiz', email: 'ben@ump.test', plate: 'no' },
  { name: 'Cara Lin', email: 'cara@ump.test', plate: 'yes' },
  { name: 'Don Pak', email: 'don@ump.test', plate: 'yes' },
  { name: 'Eve Shah', email: 'eve@ump.test', plate: 'no' }
];

// Players (Minors + Majors). Birthdates chosen for known league ages in 2027.
const PLAYERS = [
  // Balduccis (Minors) — the pitching team. Two 12-year-olds for the weekly cap,
  // plus the April 30 boundary pair.
  { name: 'Theo B', number: 7, birth: '2015-04-30', team: 'Balduccis', div: 'Minors' },  // 12 (born on the cutoff)
  { name: 'Gus B', number: 9, birth: '2014-06-15', team: 'Balduccis', div: 'Minors' },   // 12
  { name: 'Ivo B', number: 11, birth: '2015-05-01', team: 'Balduccis', div: 'Minors' },  // 11 (a day past the cutoff)
  { name: 'Max B', number: 3, birth: '2016-06-15', team: 'Balduccis', div: 'Minors' },   // 10
  { name: 'Rhys B', number: 5, birth: '2017-06-15', team: 'Balduccis', div: 'Minors' },  // 9
  // Colonial Fed (Minors) — the opponent.
  { name: 'Sol C', number: 4, birth: '2016-06-15', team: 'Colonial Fed', div: 'Minors' },// 10
  { name: 'Vic C', number: 8, birth: '2015-06-15', team: 'Colonial Fed', div: 'Minors' },// 11
  // A couple of Majors players, so Majors has a roster too.
  { name: 'Ace K', number: 1, birth: '2014-06-15', team: 'Keohanes', div: 'Majors' },    // 12
  { name: 'Rio P', number: 2, birth: '2014-09-01', team: 'Boston Property', div: 'Majors' }// 12
];

// The season schedule as SportsEngine HQ CSV rows — the real export format, the
// one that carries makeup pairing. Each spec is a game two-plus weeks out; the
// T-ball game is there to be skipped. The division token (FARM 8, MINORS, …) is
// what the sorting rules read.
const DIV_TOKEN = { 'Farm 8': 'FARM 8', 'Farm 9': 'FARM 9', 'Minors': 'MINORS', 'Majors': 'MAJORS', 'Babe Ruth': 'BABE RUTH', 'T-Ball': 'T-BALL' };
const SCHEDULE = [
  { div: 'Farm 8', home: 'Granite Co', away: 'Harborside HVAC', day: 3, time: '5:30 PM', field: 'Quarry Hills - Field A' },
  { div: 'Farm 9', home: 'Adams Press', away: 'Neponset Bank', day: 4, time: '5:30 PM', field: 'Quarry Hills - Field B' },
  { div: 'Minors', home: 'Balduccis', away: 'Colonial Fed', day: 5, time: '5:45 PM', field: 'Quarry Hills - Field C' },
  { div: 'Majors', home: 'Keohanes', away: 'Boston Property', day: 5, time: '5:45 PM', field: 'Faxon Park Field 1' },
  { div: 'Babe Ruth', home: 'Quincy Legion', away: 'Morrisette Post', day: 6, time: '10:00 AM', field: 'Adams Field' },
  { div: 'T-Ball', home: 'Bees', away: 'Ants', day: 6, time: '9:00 AM', field: 'Quarry Hills - Field D' }
];

// Turn game specs into a SportsEngine CSV. `day` is a number of days out, or a
// pre-made date string.
function buildCsv(specs) {
  return seCsv(specs.map(g => {
    const date = typeof g.day === 'number' ? fut(g.day) : g.day;
    const venue = `${g.field} > ${g.field}`;
    return seRow(date, g.time, `${DIV_TOKEN[g.div]} > ${g.home}`, `${DIV_TOKEN[g.div]} > ${g.away}`, venue);
  }));
}

const umpBody = (email, name) => ({
  role: 'umpire', email, pin: '1111', name, mobile: '6175559999',
  parentName: `${name} Parent`, parentEmail: `parent.${slug(name)}@fam.test`, parentMobile: '6175558888', venmo: `@${slug(name)}`
});

// Build the whole league against a started app. Returns rich handles the walk
// uses; it does NOT upload the schedule — the walk previews then uploads it, so
// it can prove the preview matches the real import.
async function buildLeague2027(app, opts = {}) {
  const { ok } = app;
  const ref = opts.ref || new Date();

  // Admin and league settings.
  await ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'john@qybsl.test', pin: '4321', name: 'John Higgins' });
  await ok('john', 'PUT', '/api/admin/settings', {
    seasonLabel: 'Spring 2027', seasonYear: 2027, directorEmail: 'umpdir@qybsl.test', commsDirectorEmail: 'comms@qybsl.test'
  });

  // Coaches and teams across all five divisions.
  const coachRows = ['name,email,mobile,team,division'];
  const coaches = {};
  for (const [div, teams] of Object.entries(DIVISIONS)) {
    coaches[div] = [];
    for (const team of teams) {
      const email = coachEmail(team);
      coachRows.push(`Coach ${team},${email},,${team},${div}`);
      coaches[div].push({ team, email, name: `Coach ${team}` });
    }
  }
  await ok('john', 'POST', '/api/admin/roster/coaches', coachRows.join('\n'));

  // Student umpires (Farm), auto-approved from the roster.
  await ok('john', 'POST', '/api/admin/roster/umpires',
    ['Name,Email,Mobile,Parent Name,Parent Email,Parent Mobile,Venmo,Plate Qualified',
      ...UMPS.map(u => `${u.name},${u.email},6175550000,${u.name} Parent,parent.${slug(u.name)}@fam.test,6175558888,@${slug(u.name)},${u.plate}`)
    ].join('\n'));

  // Player rosters (Minors + Majors). Birthdate → league age, then discarded.
  await ok('john', 'POST', '/api/admin/roster/players',
    ['name,number,birthdate,team,division',
      ...PLAYERS.map(p => `${p.name},${p.number},${p.birth},${p.team},${p.div}`)
    ].join('\n'));

  // Division directors: Farm 8, Minors (Cal Ripken — hears pitch violations),
  // Babe Ruth (approves out-of-town scores).
  const directors = {
    'Farm 8': 'f8dir@qybsl.test', 'Minors': 'mdir@qybsl.test', 'Babe Ruth': 'brdir@qybsl.test'
  };
  for (const [div, email] of Object.entries(directors)) {
    await ok('john', 'POST', '/api/admin/people', { role: 'director', email, name: `${div} Director`, divisions: [div] });
  }

  // Everyone who acts in the walk signs in (gets a session/PIN).
  for (const list of Object.values(coaches)) for (const c of list) {
    await ok(c.email, 'POST', '/api/auth/signup', { role: 'coach', email: c.email, pin: '2222', name: c.name });
  }
  for (const u of UMPS) await ok(u.email, 'POST', '/api/auth/signup', umpBody(u.email, u.name));
  for (const [div, email] of Object.entries(directors)) {
    await ok(email, 'POST', '/api/auth/signup', { role: 'director', email, pin: '3333', name: `${div} Director` });
  }

  // The player id map (ids are needed to log pitch counts).
  const players = Object.fromEntries((await ok('john', 'GET', '/api/admin/players')).players.map(p => [p.name, p]));

  // The schedule as SportsEngine CSV text (not uploaded yet). `schedule` and
  // `buildCsv` let the walk rebuild the feed — e.g. drop a rained-out game and
  // add its makeup.
  const scheduleText = buildCsv(SCHEDULE);

  return { DIVISIONS, coaches, coachEmail, umps: UMPS, players, directors, scheduleText, schedule: SCHEDULE, buildCsv };
}

module.exports = { buildLeague2027, buildCsv, SCHEDULE, DIVISIONS, coachEmail, slug };
