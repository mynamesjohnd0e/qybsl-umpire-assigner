// League settings, stored in one document and editable from the admin page.
const store = require('./store');
const clock = require('./clock');

const DEFAULTS = {
  seasonLabel: 'Spring 2027',
  seasonYear: 2027,          // league age is the age on April 30 of this year
  weeklyCap: 2,              // games per umpire per Mon–Sun week
  payRate: 40,               // dollars per confirmed game
  payoutAnchor: '2027-04-05',// a Monday; payout periods run 14 days from here
  payoutDays: 14,
  reconfirmHours: 24,        // time to reconfirm a moved game
  gapAlertHours: 72,         // alert when a student game this close has an open slot
  weeklyReminderHour: 18,    // Sunday, Eastern
  dayBeforeHour: 17,         // day-before reminder, Eastern
  coachNudgeHour: 9,         // daily confirm nudge to coaches, Eastern
  defaultGameMinutes: 120,   // used when the feed has no end time
  textsEnabled: false,       // flip on once Twilio 10DLC registration is approved
  appUrl: '',                // public link used in messages
  adminEmails: [],           // up to 4 board admins
  directorEmail: '',         // Director of Umpires (gets emergencies and gap alerts)
  feeds: [],                 // [{ url, season }]
  // How games are sorted from the feed. Checked top to bottom; first match wins.
  // track: student (two student umpires), patched (assignor), skip (no umpires).
  // division "$0" means "use the matched text", e.g. 8A.
  rules: [
    { pattern: '\\bfall\\s*ball\\b', division: 'Fall Ball', track: 'skip' },
    { pattern: '\\b(t-?ball|tee\\s*ball|instructional)\\b', division: 'Instructional', track: 'skip' },
    { pattern: '\\bfarm\\s*8\\b', division: 'Farm 8', track: 'student' },
    { pattern: '\\bfarm\\s*9\\b', division: 'Farm 9', track: 'student' },
    { pattern: '\\bminors\\b', division: 'Minors', track: 'patched' },
    { pattern: '\\bmajors\\b', division: 'Majors', track: 'patched' },
    { pattern: '\\bbabe\\s*ruth\\b', division: 'Babe Ruth', track: 'patched' },
    { pattern: '\\b[89][AB]\\b|\\b[89]U\\b', division: '$0', track: 'student' },
    { pattern: '\\b1[0-6][AB]\\b|\\b1[0-6]U\\b', division: '$0', track: 'patched' }
  ]
};

let cache = null, cacheAt = 0;

async function getSettings() {
  if (cache && clock.now().getTime() - cacheAt < 5000) return cache;
  const saved = (await store.get('settings', 'main')) || {};
  const envAdmins = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  cache = { ...DEFAULTS, ...saved };
  cache.adminEmails = [...new Set([...(cache.adminEmails || []).map(e => e.toLowerCase()), ...envAdmins])];
  if (!saved.appUrl && process.env.APP_URL) cache.appUrl = process.env.APP_URL;
  cacheAt = clock.now().getTime();
  return cache;
}

async function saveSettings(patch) {
  const allowed = Object.keys(DEFAULTS);
  const clean = {};
  for (const k of allowed) if (k in patch) clean[k] = patch[k];
  if (clean.rules) {
    for (const r of clean.rules) {
      new RegExp(r.pattern, 'i'); // throws on a bad pattern
      if (!['student', 'patched', 'skip'].includes(r.track)) throw new Error(`Bad track "${r.track}"`);
    }
  }
  if (clean.adminEmails) clean.adminEmails = clean.adminEmails.map(e => String(e).trim().toLowerCase()).filter(Boolean);
  await store.update('settings', 'main', clean);
  cache = null;
  return getSettings();
}

function clearCache() { cache = null; }

module.exports = { getSettings, saveSettings, clearCache, DEFAULTS };
