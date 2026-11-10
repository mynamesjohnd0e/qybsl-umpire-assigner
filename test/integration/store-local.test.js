// The store contract and the claim race against the local JSON store. This runs
// everywhere (npm test and the integration run), and proves the local store's
// one-at-a-time lock serialises transactions the way Firestore's do.
const { test, beforeEach } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.LOCAL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ump-int-')), 'store.json');
process.env.NOTIFY_DRY = '1';
delete process.env.FIRESTORE_PROJECT_ID;

const store = require('../../lib/store');
const games = require('../../lib/games');
const settings = require('../../lib/settings');
const { storeContract, claimRace } = require('./shared');

storeContract(test, beforeEach, store, 'local');
claimRace(test, beforeEach, { store, games, settings }, 'local');
