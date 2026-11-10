// The umpire sign-up rule (games.whyNot) at every edge: approval, plate
// qualification, already-taken, the game-start line, the weekly cap and the
// overlap window. This is rules code, so each numeric/date edge is tested on
// both sides and backed by a property. whyNot is pure apart from the clock,
// which we freeze.
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');
const G = require('../../lib/games');
const clock = require('../../lib/clock');
const { DEFAULTS } = require('../../lib/settings');

const s = { ...DEFAULTS }; // weeklyCap 2, defaultGameMinutes 120
afterEach(() => clock.reset());

const ump = (o = {}) => ({
  email: o.email || 'u@x.test', registered: true,
  umpire: { approved: o.approved !== false, active: o.active !== false, plateQualified: o.plate !== false }
});
const emptySlots = () => ({ plate: { umpireId: null }, field: { umpireId: null } });
const game = (id, start, end, slots) => ({ id, track: 'student', status: 'scheduled', start, end: end || null, slots: slots || emptySlots() });

// A fresh future time on 2027-06-10 (well after the frozen "now" the tests use).
const at = (hh, mm = 0) => `2027-06-10T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`;
const before = () => clock.setNow('2027-06-01T00:00:00Z');

test('an unapproved or inactive umpire is turned away', () => {
  before();
  const g = game('g', at(20), at(22));
  assert.match(G.whyNot(ump({ approved: false }), g, 'field', [g], s), /approval/);
  assert.match(G.whyNot(ump({ active: false }), g, 'field', [g], s), /inactive/);
});

test('plate spots require plate qualification; field spots do not', () => {
  before();
  const g = game('g', at(20), at(22));
  assert.match(G.whyNot(ump({ plate: false }), g, 'plate', [g], s), /plate-qualified/);
  assert.strictEqual(G.whyNot(ump({ plate: false }), g, 'field', [g], s), null);
});

test('a filled spot is not claimable, but is offerable as a swap', () => {
  before();
  const slots = { plate: { umpireId: 'other@x.test' }, field: { umpireId: null } };
  const g = game('g', at(20), at(22), slots);
  assert.match(G.whyNot(ump(), g, 'plate', [g], s), /just taken/);
  assert.strictEqual(G.whyNot(ump(), g, 'plate', [g], s, { taking: true }), null, 'a swap can target a filled spot');
});

test('the game-start line: equal is started, a millisecond earlier is not', () => {
  const start = at(20);
  const g = game('g', start, at(22));
  clock.setNow(Date.parse(start));                 // exactly at start
  assert.match(G.whyNot(ump(), g, 'field', [g], s), /already started/);
  clock.setNow(Date.parse(start) - 1);             // one ms before
  assert.strictEqual(G.whyNot(ump(), g, 'field', [g], s), null);
});

test('the weekly cap: a third game in the week is refused, a second is allowed', () => {
  before();
  const me = 'me@x.test';
  const held = hh => game('h' + hh, at(hh), at(hh + 1), { plate: { umpireId: me }, field: { umpireId: null } });
  const target = game('g', at(20), at(22));
  // One held game that week → the next is fine.
  assert.strictEqual(G.whyNot(ump({ email: me }), target, 'field', [held(8), target], s), null);
  // Two held games that week → the third is refused.
  assert.match(G.whyNot(ump({ email: me }), target, 'field', [held(8), held(10), target], s), /2 games that week/);
});

test('the overlap window: touching end-to-start is fine, one second of overlap is not', () => {
  before();
  const me = 'me@x.test';
  const held = game('h', at(12), at(14), { plate: { umpireId: me }, field: { umpireId: null } });
  const touching = game('g', at(14), at(16)); // starts exactly when the held game ends
  assert.strictEqual(G.whyNot(ump({ email: me }), touching, 'field', [held, touching], s), null);
  const overlapping = game('g', '2027-06-10T13:59:59Z', at(16));
  assert.match(G.whyNot(ump({ email: me }), overlapping, 'field', [held, overlapping], s), /overlaps/);
});

test('you cannot take a second spot on a game you already work', () => {
  before();
  const me = 'me@x.test';
  const g = game('g', at(20), at(22), { plate: { umpireId: me }, field: { umpireId: null } });
  assert.match(G.whyNot(ump({ email: me }), g, 'field', [g], s), /already working/);
});

test('property: an otherwise-eligible umpire may claim iff their week holds fewer than the cap', () => {
  before();
  const me = 'me@x.test';
  fc.assert(fc.property(fc.integer({ min: 0, max: 5 }), held => {
    // `held` non-overlapping games that week, all before the target's window.
    const all = [];
    for (let i = 0; i < held; i++) all.push(game('h' + i, at(8 + i), at(8 + i, 40), { plate: { umpireId: me }, field: { umpireId: null } }));
    const target = game('g', at(20), at(22));
    all.push(target);
    const why = G.whyNot(ump({ email: me }), target, 'field', all, s);
    if (held < s.weeklyCap) assert.strictEqual(why, null, `held=${held} should be allowed`);
    else assert.match(why, /games that week/, `held=${held} should hit the cap`);
  }));
});
