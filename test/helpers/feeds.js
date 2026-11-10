// Builders for the two schedule formats the app imports: an iCal feed and a
// SportsEngine HQ CSV export. Both are pure string builders, used to feed the
// sync the same way SportsEngine would.
const { addDaysToKey, weekKey, etDayStart, etDateKey } = require('../../lib/time');

// ── iCal ─────────────────────────────────────────────────────────────────────

// The Monday of a week two weeks out from `ref`, so games land safely in the
// future. Pass clock.now() when the clock is frozen.
function nextMonday(ref = new Date()) {
  return addDaysToKey(weekKey(ref), 14);
}

// An Eastern wall-clock time on day `dayOffset` of the week starting `monKey`,
// formatted as the UTC stamp an .ics DTSTART uses.
function icsStamp(monKey, dayOffset, hh, mm = 0) {
  const d = new Date(etDayStart(addDaysToKey(monKey, dayOffset)).getTime() + (hh * 60 + mm) * 60e3);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function ics(events) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-TIMEZONE:America/New_York',
    ...events.flatMap(e => ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART:${e.start}`, `DTEND:${e.end}`,
      `SUMMARY:${e.summary}`, `LOCATION:${e.loc || 'Quarry Hills Field A'}`,
      ...(e.status ? [`STATUS:${e.status}`] : []), 'END:VEVENT']),
    'END:VCALENDAR'].join('\r\n');
}

// A little builder bound to one reference date: `at(day, hh, mm)` gives a stamp
// and `calendar(events)` wraps them. `mon` is the Monday those days count from.
function icsBuilder(ref = new Date()) {
  const mon = nextMonday(ref);
  return { mon, at: (d, hh, mm = 0) => icsStamp(mon, d, hh, mm), calendar: ics };
}

// ── SportsEngine HQ CSV export ───────────────────────────────────────────────

const SE_HEAD = 'Event Type,Event Name,Description,Date,Start Time,End Time,Duration (minutes),All Day Event,Home Team,Away Team,Teams (Events Only),Venue,Status,Last Updated,Timezone,Home Score (Games Only),Away Score (Games Only)';

const seRow = (date, time, home, away, venue, status = 'scheduled', type = 'game') =>
  `${type},x,,${date},${time},,120,,"${home}","${away}",,${venue},${status},,America/New_York,,`;

// `n` days from `ref`, as the M/D/YYYY string the export uses.
function fut(n, ref = new Date()) {
  const [y, m, d] = addDaysToKey(etDateKey(ref), n).split('-').map(Number);
  return `${m}/${d}/${y}`;
}

function seCsv(rows) { return [SE_HEAD, ...rows].join('\n'); }

module.exports = { nextMonday, icsStamp, ics, icsBuilder, SE_HEAD, seRow, fut, seCsv };
