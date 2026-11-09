// Time helpers. All league logic runs on Eastern time (America/New_York),
// while dates are stored as UTC ISO strings.
const TZ = 'America/New_York';
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
});
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Wall-clock parts of a moment in a given zone.
function zoneParts(date, tz = TZ) {
  const fmt = tz === TZ ? partsFmt : new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
  });
  const p = {};
  for (const { type, value } of fmt.formatToParts(new Date(date))) p[type] = value;
  return {
    y: +p.year, m: +p.month, d: +p.day,
    hh: +p.hour % 24, mm: +p.minute, ss: +p.second,
    dow: DOW[p.weekday]
  };
}

function tzOffsetMs(date, tz) {
  const p = zoneParts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - Math.floor(new Date(date).getTime() / 1000) * 1000;
}

// Convert a wall-clock time in `tz` to a UTC Date.
function zonedToUtc(y, m, d, hh = 0, mm = 0, ss = 0, tz = TZ) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz); // second pass handles DST boundaries
  return new Date(t);
}

const pad = n => String(n).padStart(2, '0');

// 'YYYY-MM-DD' of the Eastern calendar day.
function etDateKey(date) {
  const p = zoneParts(date);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

function addDaysToKey(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n, 12));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// Monday (Eastern) of the Mon–Sun week containing `date`, as 'YYYY-MM-DD'.
function weekKey(date) {
  const p = zoneParts(date);
  const back = (p.dow + 6) % 7;
  return addDaysToKey(`${p.y}-${pad(p.m)}-${pad(p.d)}`, -back);
}

// Start of an Eastern calendar day as a UTC Date.
function etDayStart(key) {
  const [y, m, d] = key.split('-').map(Number);
  return zonedToUtc(y, m, d, 0, 0, 0);
}

function fmtGame(iso) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}

module.exports = {
  TZ, DAY, HOUR, zoneParts, zonedToUtc, etDateKey, addDaysToKey,
  weekKey, etDayStart, fmtGame
};
