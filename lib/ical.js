// Minimal iCal (.ics) reader for SportsEngine schedule feeds.
const { zonedToUtc, TZ } = require('./time');

function unfold(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function parseLine(line) {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = left.split(';');
  const params = {};
  for (const p of paramParts) {
    const [k, v = ''] = p.split('=');
    params[k.toUpperCase()] = v.replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

// Returns { date: Date, allDay: boolean } or null.
function parseDate(value, params, calTz) {
  const v = value.trim();
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m || params.VALUE === 'DATE') {
    m = m || v.match(/^(\d{4})(\d{2})(\d{2})/);
    return { date: zonedToUtc(+m[1], +m[2], +m[3], 0, 0, 0, TZ), allDay: true };
  }
  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss = '0', z] = m;
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss)), allDay: false };
  let tz = params.TZID || calTz || TZ;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch (_) { tz = TZ; }
  return { date: zonedToUtc(+y, +mo, +d, +hh, +mi, +ss, tz), allDay: false };
}

function parseDuration(v) {
  const m = String(v || '').match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, w = 0, d = 0, h = 0, mi = 0, s = 0] = m.map(x => +x || 0);
  return ((((+w * 7 + +d) * 24 + +h) * 60 + +mi) * 60 + +s) * 1000;
}

// Pull the two team names out of a summary like
// "Farm 8: Red Sox vs. Yankees", "Red Sox @ Yankees" or "Game - Cubs at Mets".
function parseTeams(summary) {
  let s = String(summary || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(game|scrimmage|playoff|championship)\s*[:\-–]\s*/i, '');
  if (s.includes(':')) s = s.slice(s.lastIndexOf(':') + 1).trim();
  s = s.replace(/\((?:home|away|cancel+ed|postponed|rescheduled)[^)]*\)/gi, '').trim();
  let m = s.match(/^(.+?)\s+(?:vs\.?|v\.?|versus)\s+(.+)$/i);
  if (m) return { home: m[1].trim(), away: m[2].trim() };
  m = s.match(/^(.+?)\s+(?:@|at)\s+(.+)$/i);
  if (m) return { home: m[2].trim(), away: m[1].trim() };
  return { home: '', away: '' };
}

function parseIcs(text) {
  const lines = unfold(text);
  const events = [];
  let calTz = null, cur = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    const p = parseLine(line);
    if (!p) continue;
    if (!cur) { if (p.name === 'X-WR-TIMEZONE') calTz = p.value.trim(); continue; }
    cur[p.name] = p;
  }
  return events.map(e => {
    const get = k => (e[k] ? unescapeText(e[k].value).trim() : '');
    const start = e.DTSTART ? parseDate(e.DTSTART.value, e.DTSTART.params, calTz) : null;
    let end = e.DTEND ? parseDate(e.DTEND.value, e.DTEND.params, calTz) : null;
    if (!end && start && e.DURATION) end = { date: new Date(start.date.getTime() + parseDuration(e.DURATION.value)) };
    const rid = e['RECURRENCE-ID'] ? e['RECURRENCE-ID'].value : '';
    const summary = get('SUMMARY');
    return {
      uid: (get('UID') || '') + (rid ? `#${rid}` : ''),
      summary,
      description: get('DESCRIPTION'),
      location: get('LOCATION'),
      categories: get('CATEGORIES'),
      status: get('STATUS').toUpperCase(),
      start: start ? start.date.toISOString() : null,
      end: end ? end.date.toISOString() : null,
      allDay: !!start?.allDay,
      ...parseTeams(summary)
    };
  }).filter(e => e.uid && e.start);
}

module.exports = { parseIcs, parseTeams };
