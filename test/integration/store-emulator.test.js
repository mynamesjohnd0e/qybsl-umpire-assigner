// The same store contract and claim race against the Firestore emulator. Set
// FIRESTORE_EMULATOR_HOST (e.g. `gcloud beta emulators firestore start`) and run
// `npm run test:integration`. Without it, the file skips so the ordinary test
// run stays self-contained.
const { test, beforeEach } = require('node:test');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  test('Firestore emulator store contract + race (set FIRESTORE_EMULATOR_HOST to run)', { skip: true }, () => {});
} else {
  process.env.FIRESTORE_PROJECT_ID = process.env.FIRESTORE_PROJECT_ID || 'qybsl-test';
  process.env.FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || '(default)';
  process.env.NOTIFY_DRY = '1';

  const store = require('../../lib/store');
  const games = require('../../lib/games');
  const settings = require('../../lib/settings');
  const { storeContract, claimRace } = require('./shared');

  storeContract(test, beforeEach, store, 'emulator');
  claimRace(test, beforeEach, { store, games, settings }, 'emulator');
}
