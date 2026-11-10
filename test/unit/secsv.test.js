// Parsing the SportsEngine HQ CSV export into events.
const { test } = require('node:test');
const assert = require('node:assert');
const { parseSeCsv, looksLikeSeCsv, splitTeam, venue } = require('../../lib/secsv');
const { SE_HEAD, seRow, seCsv } = require('../helpers/feeds');
const { zoneParts } = require('../../lib/time');

test('it recognises the export by its header, and rejects other text', () => {
  assert.strictEqual(looksLikeSeCsv(SE_HEAD + '\n'), true);
  assert.strictEqual(looksLikeSeCsv('BEGIN:VCALENDAR'), false);
  assert.strictEqual(looksLikeSeCsv(''), false);
});

test('splitTeam drops the division prefix and the "JF8- " code', () => {
  assert.deepStrictEqual(splitTeam('FARM 8 > JF8- QCARE  (BUCKLEY)'), { division: 'FARM 8', team: 'QCARE (BUCKLEY)' });
  assert.deepStrictEqual(splitTeam('MAJORS > Quincy Police'), { division: 'MAJORS', team: 'Quincy Police' });
});

test('venue collapses a repeated name and joins a sub-field', () => {
  assert.strictEqual(venue('Quarry Hills - Field B > Quarry Hills - Field B'), 'Quarry Hills - Field B');
  assert.strictEqual(venue('Quarry Hills  > Quarry A'), 'Quarry Hills - Quarry A');
});

test('a game row becomes an event with teams, division and an Eastern start', () => {
  const text = seCsv([seRow('6/10/2027', '5:30 PM', 'FARM 8 > JF8- QCARE (BUCKLEY)', 'FARM 8 > JF8- SINC LAW (BYRNE)', 'Quarry Hills - Field B > Quarry Hills - Field B')]);
  const [e] = parseSeCsv(text);
  assert.strictEqual(e.home, 'QCARE (BUCKLEY)');
  assert.strictEqual(e.away, 'SINC LAW (BYRNE)');
  assert.strictEqual(e.categories, 'FARM 8');
  const p = zoneParts(e.start);
  assert.deepStrictEqual([p.y, p.m, p.d, p.hh, p.mm], [2027, 6, 10, 17, 30], '5:30 PM Eastern');
});

test('AM/PM parsing: noon and midnight land on the right hour', () => {
  const noon = parseSeCsv(seCsv([seRow('6/10/2027', '12:00 PM', 'A > A', 'B > B', 'X > X')]))[0];
  const mid = parseSeCsv(seCsv([seRow('6/10/2027', '12:00 AM', 'A > A', 'B > B', 'X > X')]))[0];
  assert.strictEqual(zoneParts(noon.start).hh, 12);
  assert.strictEqual(zoneParts(mid.start).hh, 0);
});

test('cancelled rows are flagged; non-game rows are dropped', () => {
  const text = seCsv([
    seRow('6/10/2027', '5:30 PM', 'FARM 9 > A', 'FARM 9 > B', 'X > X', 'cancelled'),
    seRow('6/11/2027', '6:00 PM', 'p', 'q', 'z', 'scheduled', 'practice')
  ]);
  const events = parseSeCsv(text);
  assert.strictEqual(events.length, 1, 'only the game row survives');
  assert.strictEqual(events[0].status, 'CANCELLED');
});
