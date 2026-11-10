// Messaging policy: an umpire's parent is copied on umpire messages (the one
// family exception), and texts stay off until Twilio is approved. Ported from
// flow.test.js; the parent-copy check is one of the planted-bug targets.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const H = require('../helpers');
H.setupEnv();

let app, W;
before(async () => { app = await H.startApp(); });
after(() => app.close());
beforeEach(async () => { H.reset(); app.clearJars(); W = await H.world(app); });

test('an umpire message is copied to their parent', async () => {
  await app.ok('alice', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'plate' });
  const out = await H.outbox();
  assert(out.some(m => m.to === 'alice@x.test' && m.channel === 'email'), 'the umpire is emailed');
  assert(out.some(m => m.to === 'p@x.test' && m.subject.startsWith('[Parent copy]')),
    'the parent gets a copy');
});

test('texts are not sent while texting is turned off', async () => {
  // Urgent openings carry an SMS, so this produces text-channel outbox rows.
  await app.ok('dan', 'POST', '/api/umpire/claim', { gameId: W.games.orioles, slot: 'plate' });
  await app.ok('john', 'POST', `/api/admin/games/${W.games.orioles}/urgent`, { slot: 'plate' });
  const texts = (await H.outbox()).filter(m => m.channel === 'text');
  assert(texts.length > 0, 'there are texts to check');
  assert(texts.every(m => m.status.startsWith('not sent')), 'every text is held back');
});

test('no non-umpire family address is ever messaged', async () => {
  // Drive a few umpire actions, then confirm the only family address that
  // appears is the umpire parent copy — never a coach/player family address.
  await app.ok('alice', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'plate' });
  await app.ok('bob', 'POST', '/api/umpire/claim', { gameId: W.games.redSox, slot: 'field' });
  const recipients = new Set((await H.outbox()).map(m => m.to));
  // Parent copies are allowed; p@x.test is the umpire parents. Coaches/directors
  // are league staff, not family. Assert no stray address slipped in.
  const allowed = new Set(['alice@x.test', 'bob@x.test', 'p@x.test', 'john@qybsl.test', 'director@qybsl.test']);
  for (const to of recipients) assert(allowed.has(to), `unexpected recipient ${to}`);
});
