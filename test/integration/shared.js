// The store contract and the claim race, written once and run against both
// storage backends: the local JSON file (always) and the Firestore emulator
// (when FIRESTORE_EMULATOR_HOST is set). The same assertions must hold on both,
// which is the whole point of Sprint 0's integration layer — the race in
// particular only means something against a real transactional store.
const assert = require('node:assert');

// Register the store CRUD + transaction contract.
function storeContract(test, beforeEach, store, label) {
  const col = 'kv';
  beforeEach(async () => { await store.clear(col); });

  test(`[${label}] set then get round-trips a document`, async () => {
    await store.set(col, 'a', { id: 'a', n: 1 });
    assert.deepStrictEqual(await store.get(col, 'a'), { id: 'a', n: 1 });
    assert.strictEqual(await store.get(col, 'missing'), null);
  });

  test(`[${label}] update merges fields, del removes, list returns all`, async () => {
    await store.set(col, 'a', { id: 'a', n: 1, keep: true });
    await store.update(col, 'a', { n: 2 });
    assert.deepStrictEqual(await store.get(col, 'a'), { id: 'a', n: 2, keep: true });
    await store.set(col, 'b', { id: 'b', n: 9 });
    assert.strictEqual((await store.list(col)).length, 2);
    await store.del(col, 'a');
    assert.strictEqual(await store.get(col, 'a'), null);
    assert.strictEqual((await store.list(col)).length, 1);
  });

  test(`[${label}] a transaction that throws writes nothing`, async () => {
    await store.set(col, 'a', { id: 'a', n: 1 });
    await assert.rejects(store.transact(async tx => {
      tx.set(col, 'a', { id: 'a', n: 999 });
      throw new Error('boom');
    }));
    assert.strictEqual((await store.get(col, 'a')).n, 1, 'the write was rolled back');
  });

  test(`[${label}] a transaction commits all its writes together`, async () => {
    await store.transact(async tx => {
      tx.set(col, 'x', { id: 'x', n: 1 });
      tx.set(col, 'y', { id: 'y', n: 2 });
    });
    assert.strictEqual((await store.get(col, 'x')).n, 1);
    assert.strictEqual((await store.get(col, 'y')).n, 2);
  });
}

// Register the 20-umpires-one-slot race.
function claimRace(test, beforeEach, { store, games, settings }, label) {
  test(`[${label}] 20 umpires claim one slot: exactly one wins, the slot holds one assignment`, async () => {
    settings.clearCache();
    await store.clear('games');
    await store.clear('people');
    await store.clear('swaps');

    const start = new Date(Date.now() + 7 * 864e5).toISOString();
    const g = games.newGame({ uid: 'race@se', season: 'Spring 2027', division: 'Farm 8', summary: 'Race: A vs B', home: 'A', away: 'B', location: 'Quarry Hills Field A', start, end: new Date(Date.parse(start) + 2 * 3600e3).toISOString() }, 'student');
    await store.set('games', g.id, g);

    const emails = Array.from({ length: 20 }, (_, i) => `ump${i}@x.test`);
    await Promise.all(emails.map(email => store.set('people', email, {
      email, name: email, registered: true, mobile: '',
      umpire: { approved: true, active: true, plateQualified: true }
    })));

    // Everyone grabs the field spot at once.
    const results = await Promise.allSettled(emails.map(email => games.claim(email, g.id, 'field')));
    const won = results.filter(r => r.status === 'fulfilled');
    const lost = results.filter(r => r.status === 'rejected');
    assert.strictEqual(won.length, 1, 'exactly one claim succeeds');
    assert.strictEqual(lost.length, 19, 'the other 19 are refused');
    assert(lost.every(r => /just taken|already/i.test(r.reason.message)), 'losers are told the spot was taken');

    const stored = await store.get('games', g.id);
    const holders = ['plate', 'field'].map(k => stored.slots[k].umpireId).filter(Boolean);
    assert.strictEqual(holders.length, 1, 'the database holds exactly one assignment');
  });
}

module.exports = { storeContract, claimRace };
