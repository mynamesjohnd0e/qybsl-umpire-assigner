// The injectable clock itself.
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const clock = require('../../lib/clock');

afterEach(() => clock.reset());

test('by default now() tracks the real wall clock', () => {
  assert.strictEqual(clock.isFrozen(), false);
  const a = clock.now().getTime();
  const b = Date.now();
  assert(Math.abs(a - b) < 1000, 'within a second of the real clock');
});

test('setNow freezes time at a chosen moment', () => {
  clock.setNow('2027-03-15T12:00:00Z');
  assert.strictEqual(clock.isFrozen(), true);
  assert.strictEqual(clock.now().toISOString(), '2027-03-15T12:00:00.000Z');
  // Still frozen on the next read.
  assert.strictEqual(clock.now().toISOString(), '2027-03-15T12:00:00.000Z');
});

test('now() hands back a fresh Date each call, safe to mutate', () => {
  clock.setNow(0);
  const d = clock.now();
  d.setFullYear(1999);
  assert.strictEqual(clock.now().getUTCFullYear(), 1970, 'mutation did not leak back');
});

test('setNow accepts a Date, an ISO string and epoch ms alike', () => {
  clock.setNow(new Date('2027-01-02T03:04:05Z'));
  assert.strictEqual(clock.now().toISOString(), '2027-01-02T03:04:05.000Z');
  clock.setNow(1000);
  assert.strictEqual(clock.now().getTime(), 1000);
});

test('reset returns to the real clock', () => {
  clock.setNow(0);
  clock.reset();
  assert.strictEqual(clock.isFrozen(), false);
  assert(Math.abs(clock.now().getTime() - Date.now()) < 1000);
});

test('setNow(null) and setNow(undefined) unfreeze, like reset', () => {
  clock.setNow(0);
  assert.strictEqual(clock.isFrozen(), true);
  clock.setNow(null);
  assert.strictEqual(clock.isFrozen(), false, 'null unfreezes');
  assert(Math.abs(clock.now().getTime() - Date.now()) < 1000);

  clock.setNow(0);
  assert.strictEqual(clock.isFrozen(), true);
  clock.setNow(undefined);
  assert.strictEqual(clock.isFrozen(), false, 'undefined unfreezes');
  assert(Math.abs(clock.now().getTime() - Date.now()) < 1000);
});
