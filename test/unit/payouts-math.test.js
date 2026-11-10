// Payout period arithmetic: fortnights counted from a fixed Monday anchor. The
// edges (last day of a period vs first of the next) and the "most recent fully
// closed period" are tested, plus invariants over random dates.
const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');
const { periodFor, lastClosedPeriod } = require('../../lib/payouts');

const s = { payoutAnchor: '2027-04-05', payoutDays: 14 }; // anchor is a Monday
const noon = key => new Date(key + 'T16:00:00Z'); // ~noon Eastern

test('a period runs 14 days from the anchor, end inclusive', () => {
  assert.deepStrictEqual(periodFor('2027-04-05', s), { start: '2027-04-05', end: '2027-04-18' });
  assert.deepStrictEqual(periodFor('2027-04-18', s), { start: '2027-04-05', end: '2027-04-18' }, 'last day still in period');
});

test('the day after a period starts the next one', () => {
  assert.deepStrictEqual(periodFor('2027-04-19', s), { start: '2027-04-19', end: '2027-05-02' });
});

test('dates before the anchor still land in a well-formed period', () => {
  const p = periodFor('2027-04-04', s); // one day before the anchor
  assert.deepStrictEqual(p, { start: '2027-03-22', end: '2027-04-04' });
});

test('lastClosedPeriod is the one just before the period holding "now"', () => {
  // now sits in 2027-04-19..05-02, so the last closed is 2027-04-05..04-18.
  assert.deepStrictEqual(lastClosedPeriod(s, noon('2027-04-20')), { start: '2027-04-05', end: '2027-04-18' });
  // On the first day of a period, the closed one is the period that just ended.
  assert.deepStrictEqual(lastClosedPeriod(s, noon('2027-04-19')), { start: '2027-04-05', end: '2027-04-18' });
});

test('property: every date is in exactly one 14-day period that abuts its neighbours', () => {
  fc.assert(fc.property(fc.date({ min: new Date('2026-01-01'), max: new Date('2030-12-31'), noInvalidDate: true }), d => {
    const key = d.toISOString().slice(0, 10);
    const p = periodFor(key, s);
    const days = (Date.parse(p.end + 'T00:00:00Z') - Date.parse(p.start + 'T00:00:00Z')) / 864e5;
    assert.strictEqual(days, s.payoutDays - 1, '14-day span (end inclusive)');
    assert(key >= p.start && key <= p.end, 'the date is inside its own period');
    // The next period starts the day after this one ends.
    const next = periodFor(p.end, s);
    const after = new Date(Date.parse(p.end + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
    assert.strictEqual(periodFor(after, s).start, after, 'periods tile without gaps or overlaps');
    void next;
  }));
});
