// Backup, restore and a post-deploy self-check.
//
// A daily Firestore backup is really an ops job (gcloud firestore export; see the
// README). These helpers back the app up at the data layer so a restore can be
// rehearsed into the test copy and checked record for record, and so the board
// can keep an off-Firestore copy. Restore only runs on the test copy.
const store = require('./store');
const clock = require('./clock');
const { getSettings } = require('./settings');

// Every collection the app writes.
const COLLECTIONS = [
  'settings', 'people', 'teams', 'players', 'games', 'swaps', 'ratings', 'payouts',
  'cointosses', 'bracketseeds', 'pitchlogs', 'pitchalerts', 'closures', 'shifts',
  'signups', 'uploads', 'syncRuns', 'syncLog', 'outbox'
];

// Export every collection, keeping document ids.
async function exportAll() {
  const collections = {};
  let records = 0;
  for (const c of COLLECTIONS) {
    const es = await store.entries(c);
    if (!es.length) continue;
    collections[c] = Object.fromEntries(es);
    records += es.length;
  }
  return { at: clock.now().toISOString(), records, collections };
}

// Restore a backup. By default each restored collection is cleared first, so the
// result matches the backup record for record.
async function importAll(data, { clear = true } = {}) {
  const out = {};
  for (const [c, docs] of Object.entries(data?.collections || {})) {
    if (clear) await store.clear(c);
    let n = 0;
    for (const [id, doc] of Object.entries(docs)) { await store.set(c, id, doc); n++; }
    out[c] = n;
  }
  return { restored: out };
}

// A post-deploy health check: are the settings loaded, is an admin and a feed
// configured, and when did the jobs and sync last run?
async function selfCheck() {
  const s = await getSettings();
  const jobs = (await store.get('settings', 'jobs')) || {};
  const checks = {
    settingsLoaded: !!s.seasonLabel,
    adminConfigured: (s.adminEmails || []).length > 0,
    feedConfigured: (s.feeds || []).length > 0,
    lastSyncAt: jobs.lastSyncAt || null,
    lastTickAt: jobs.lastTickAt || null,
    games: (await store.list('games')).length,
    storage: store.USE_FIRESTORE ? 'firestore' : 'local'
  };
  checks.ok = checks.settingsLoaded && checks.adminConfigured;
  return checks;
}

module.exports = { exportAll, importAll, selfCheck, COLLECTIONS };
