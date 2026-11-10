// Parsing an iCal feed and pulling team names out of summaries.
const { test } = require('node:test');
const assert = require('node:assert');
const { parseIcs, parseTeams } = require('../../lib/ical');
const { ics } = require('../helpers/feeds');
const { zoneParts } = require('../../lib/time');

test('parseTeams reads "vs", "@" and "at", and strips a division prefix', () => {
  assert.deepStrictEqual(parseTeams('Farm 8: Red Sox vs. Yankees'), { home: 'Red Sox', away: 'Yankees' });
  assert.deepStrictEqual(parseTeams('Orioles @ Rays'), { home: 'Rays', away: 'Orioles' }, '@ puts the first team away');
  assert.deepStrictEqual(parseTeams('Game - Cubs at Mets'), { home: 'Mets', away: 'Cubs' });
  assert.deepStrictEqual(parseTeams('Mystery Game'), { home: '', away: '' });
});

test('a VEVENT becomes an event with Eastern times and team names', () => {
  const cal = ics([{ uid: 'e1@se', summary: 'Farm 8: Red Sox vs. Yankees', start: '20270610T173000', end: '20270610T193000', loc: 'Quarry Hills Field A' }]);
  const [e] = parseIcs(cal);
  assert.strictEqual(e.uid, 'e1@se');
  assert.strictEqual(e.home, 'Red Sox');
  assert.strictEqual(e.away, 'Yankees');
  assert.strictEqual(e.location, 'Quarry Hills Field A');
  const p = zoneParts(e.start);
  assert.deepStrictEqual([p.y, p.m, p.d, p.hh, p.mm], [2027, 6, 10, 17, 30]);
});

test('a cancelled event keeps its STATUS for the sync to act on', () => {
  const cal = ics([{ uid: 'c@se', summary: 'Farm 9: A vs B', start: '20270610T173000', end: '20270610T193000', status: 'CANCELLED' }]);
  const [e] = parseIcs(cal);
  assert.strictEqual(e.status, 'CANCELLED');
});

test('events with no usable start are dropped', () => {
  // A VEVENT with no DTSTART should not survive.
  const cal = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:nostart@se', 'SUMMARY:No Start', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  assert.strictEqual(parseIcs(cal).length, 0);
});
