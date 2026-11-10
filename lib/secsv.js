// Reads the schedule export from SportsEngine HQ (CSV) into the same event
// shape the iCal reader produces. The export has no permanent event ID, so
// each game gets an ID from its teams, date and time; the sync then pairs up
// moved games by matchup (see sync.js).
const crypto = require('crypto');
const { parseCsv } = require('./people');
const { zonedToUtc, TZ } = require('./time');

const looksLikeSeCsv = text => /^﻿?\s*"?Event Type"?,/i.test(String(text || ''));

// "FARM 8 > JF8- EARLEY LAW GROUP (TRAFT)" → { division: 'FARM 8', team: 'EARLEY LAW GROUP (TRAFT)' }
function splitTeam(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  const i = s.indexOf('>');
  const division = i >= 0 ? s.slice(0, i).trim() : '';
  let team = (i >= 0 ? s.slice(i + 1) : s).trim();
  team = team.replace(/^[A-Z]{1,3}\d{1,2}[A-Z]?\s*-\s*/i, ''); // drop "JF8- " style prefixes
  return { division, team };
}

// "Quarry Hills - Field B > Quarry Hills - Field B" → "Quarry Hills - Field B"
// "Quarry Hills > Quarry A" → "Quarry Hills - Quarry A"
function venue(raw) {
  const parts = String(raw || '').split('>').map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!parts.length) return '';
  const [a, b] = parts;
  if (!b || b === a) return a;
  if (b.toLowerCase().startsWith(a.toLowerCase())) return b;
  return `${a} - ${b}`;
}

function parseTime(t) {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
  if (!m) return null;
  let h = +m[1] % 12;
  if (m[3] && m[3].toUpperCase() === 'PM') h += 12;
  if (!m[3]) h = +m[1];
  return { h, mi: +m[2] };
}

function parseSeCsv(text, { shiftDays = 0 } = {}) {
  const rows = parseCsv(text);
  const events = [];
  for (const r of rows) {
    if ((r.event_type || '').toLowerCase() !== 'game') continue;
    const dm = String(r.date || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const st = parseTime(r.start_time);
    if (!dm || !st) continue;
    let tz = r.timezone || TZ;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch (_) { tz = TZ; }
    // Shift on the wall clock (keeps 5:30 PM at 5:30 PM across daylight saving).
    const base = new Date(Date.UTC(+dm[3], +dm[1] - 1, +dm[2] + Number(shiftDays || 0), 12));
    const y = base.getUTCFullYear(), mo = base.getUTCMonth() + 1, d = base.getUTCDate();
    const start = zonedToUtc(y, mo, d, st.h, st.mi, 0, tz);
    const et = parseTime(r.end_time);
    let end = et ? zonedToUtc(y, mo, d, et.h, et.mi, 0, tz) : null;
    if (!end || end <= start) end = new Date(start.getTime() + (Number(r.duration_minutes) || 120) * 60e3);
    const home = splitTeam(r.home_team), away = splitTeam(r.away_team);
    const division = home.division || away.division;
    const id = crypto.createHash('sha1').update([home.team, away.team, r.date, r.start_time].join('|').toLowerCase()).digest('hex').slice(0, 20);
    events.push({
      uid: `secsv:${id}`,
      summary: `${division ? division + ': ' : ''}${away.team} at ${home.team}`,
      description: r.description || '',
      location: venue(r.venue),
      categories: division,
      status: /cancel/i.test(r.status || '') ? 'CANCELLED' : '',
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: false,
      home: home.team,
      away: away.team,
      pairKey: `${home.team}|${away.team}`.toLowerCase()
    });
  }
  return events;
}

module.exports = { parseSeCsv, looksLikeSeCsv, splitTeam, venue };
