// Builds the standard test world: one admin, three roster umpires (Alice is
// plate-qualified, Bob is not, Dan is), one walk-in umpire pending approval,
// two coaches, and a synced iCal schedule with a game for each situation the
// tests need. This is the shared fixture the API tests set up in beforeEach, so
// every test starts from the same known league and one failing test never hides
// the next.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { icsBuilder } = require('./feeds');

// The schedule, two weeks out. Summaries are shaped exactly like SportsEngine's
// so the sorting rules and the coach-list fallback both get exercised.
function standardEvents(at) {
  return [
    { uid: 'e1@se', summary: 'Farm 8: Red Sox vs. Yankees', start: at(1, 17, 30), end: at(1, 19, 30) },
    { uid: 'e2@se', summary: 'Farm 8: Cubs vs. Mets', start: at(2, 17, 30), end: at(2, 19, 30) },
    { uid: 'e3@se', summary: 'Farm 9: Orioles @ Rays', start: at(3, 17, 30), end: at(3, 19, 30) },
    { uid: 'e4@se', summary: 'Majors: Quincy Police vs Forepoint', start: at(1, 17, 30), end: at(1, 19, 30), loc: 'Quarry Hills Field C' },
    { uid: 'e5@se', summary: 'T-Ball: Bees vs Ants', start: at(5, 8), end: at(5, 9) },
    { uid: 'e6@se', summary: 'Mystery Game', start: at(5, 10), end: at(5, 12) },
    { uid: 'e7@se', summary: 'Pirates vs Giants', start: at(4, 17, 30), end: at(4, 19, 30) }, // division only via coach list
    { uid: 'e8@se', summary: '9A: Quincy 9A vs Braintree', start: at(6, 10), end: at(6, 12) },
    { uid: 'e9@se', summary: '11B: Quincy 11B vs Milton', start: at(6, 12), end: at(6, 14) }
  ];
}

const umpBody = (email, name) => ({
  role: 'umpire', email, pin: '1111', name, mobile: '6175559999',
  parentName: 'P', parentEmail: 'p@x.test', parentMobile: '6175558888', venmo: 'v'
});

// Build the world against a started app. `opts.ref` is the date the schedule is
// built around (pass clock.now() when the clock is frozen). `opts.events` lets a
// test supply its own schedule. Returns handles the tests use.
async function buildWorld(app, opts = {}) {
  const { ok } = app;
  const ref = opts.ref || new Date();
  const b = icsBuilder(ref);
  const events = opts.events ? opts.events(b.at) : standardEvents(b.at);
  const feedFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ump-feed-')), 'feed.ics');
  fs.writeFileSync(feedFile, b.calendar(events));

  // Admin signs in and points the app at the feed.
  await ok('john', 'POST', '/api/auth/signup', { role: 'admin', email: 'John@QYBSL.test', pin: '4321', name: 'John Higgins', mobile: '617-555-0100' });
  await ok('john', 'PUT', '/api/admin/settings', { feeds: [{ url: 'file:' + feedFile, season: 'Spring 2027' }], directorEmail: 'director@qybsl.test', seasonLabel: 'Spring 2027' });

  // Rosters.
  await ok('john', 'POST', '/api/admin/roster/umpires',
    'Name,Email,Mobile,Parent Name,Parent Email,Parent Mobile,Venmo,Plate Qualified\n' +
    'Alice Ump,alice@x.test,6175550001,Pat Ump,pat@x.test,6175550002,@alice,yes\n' +
    'Bob Ump,bob@x.test,6175550003,Sam Ump,sam@x.test,6175550004,@bob,no\n' +
    'Dan Ump,dan@x.test,6175550005,Lee Ump,lee@x.test,6175550006,@dan,yes\n');
  await ok('john', 'POST', '/api/admin/roster/coaches',
    'name,email,mobile,team,division\nCoach Red,red@x.test,6175550101,Red Sox,Farm 8\nCoach Yank,yank@x.test,6175550102,Yankees,Farm 8\nCoach Pirate,pirate@x.test,,Pirates,Farm 9\n');

  const sync = await ok('john', 'POST', '/api/admin/sync');

  // Umpire accounts: roster umpires are auto-approved; the walk-in waits.
  if (opts.umpires !== false) {
    await ok('alice', 'POST', '/api/auth/signup', umpBody('alice@x.test', 'Alice Ump'));
    await ok('bob', 'POST', '/api/auth/signup', umpBody('bob@x.test', 'Bob Ump'));
    await ok('dan', 'POST', '/api/auth/signup', umpBody('dan@x.test', 'Dan Ump'));
    await ok('carl', 'POST', '/api/auth/signup', umpBody('carl@x.test', 'Carl New'));
  }

  const overview = await ok('john', 'GET', '/api/admin/overview');
  const gameId = sub => {
    const g = overview.games.find(x => (x.summary || '').includes(sub) || (x.home || '').includes(sub));
    if (!g) throw new Error(`no game matching "${sub}"`);
    return g.id;
  };
  const games = {
    redSox: gameId('Red Sox'), cubs: gameId('Cubs'), orioles: gameId('Orioles'),
    majors: gameId('Majors'), pirates: gameId('Pirates'), g9A: gameId('9A'), g11B: gameId('11B')
  };
  return { feedFile, mon: b.mon, at: b.at, events, sync, overview, gameId, games };
}

module.exports = { buildWorld, standardEvents, umpBody };
