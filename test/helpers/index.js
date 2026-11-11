// Shared test toolkit.
//
// Every test file starts the same way:
//
//   const H = require('../helpers');
//   H.setupEnv();                      // must come before the app is loaded
//   const app = await H.startApp();    // real server on a random port
//
// setupEnv() points the app at a throwaway JSON store and turns real email and
// texting off, so nothing leaves the machine. startApp() loads the server
// lazily (after the env is set) and hands back HTTP helpers that drive the app
// exactly as a browser would: cookies and all. The clock is the one from
// lib/clock, so a test can freeze time and check a deadline on both sides of
// its line.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

// lib/clock reads no env and holds no state tied to the store, so it is safe to
// require up front. Everything else (server, store, settings, auth) reads the
// env or the store file at load time, so those are required lazily, after
// setupEnv() has run.
const clock = require('../../lib/clock');

let tmpDir = null;

// Point the app at a fresh, isolated store and keep real messages from going
// out. Returns the temp directory so a test can drop a feed file next to it.
function setupEnv(opts = {}) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ump-'));
  Object.assign(process.env, {
    LOCAL_DB_FILE: path.join(tmpDir, 'store.json'),
    NOTIFY_DRY: '1',
    ADMIN_EMAILS: opts.adminEmails || 'john@qybsl.test',
    CRON_KEY: opts.cronKey || 'cron-test'
  });
  if (opts.testMode) process.env.TEST_MODE = '1'; else delete process.env.TEST_MODE;
  if (opts.testSendOnly) process.env.TEST_SEND_ONLY = opts.testSendOnly; else delete process.env.TEST_SEND_ONLY;
  delete process.env.FIRESTORE_PROJECT_ID;
  return tmpDir;
}

function tmp(name) {
  if (!tmpDir) throw new Error('call setupEnv() first');
  return path.join(tmpDir, name);
}

// Lazy handles to app internals, so nothing is loaded before setupEnv().
const store = () => require('../../lib/store');
const settings = () => require('../../lib/settings');
const auth = () => require('../../lib/auth');
const jobs = () => require('../../lib/jobs');
const payouts = () => require('../../lib/payouts');
const snackshack = () => require('../../lib/snackshack');
const simulator = () => require('../../lib/simulator');

async function startApp() {
  const app = require('../../server');
  const server = app.listen(0);
  await new Promise(res => server.once('listening', res));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { app, server, base, ...makeClient(base), close: () => new Promise(r => server.close(r)) };
}

// An HTTP client that keeps a separate cookie jar per role name, so several
// signed-in people can act in one test without stepping on each other.
function makeClient(base) {
  const jars = {};
  async function call(who, method, url, body) {
    const headers = { 'Content-Type': typeof body === 'string' ? 'text/csv' : 'application/json' };
    if (jars[who]) headers.Cookie = jars[who];
    const r = await fetch(base + url, {
      method,
      headers,
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
    });
    const sc = r.headers.get('set-cookie');
    if (sc) jars[who] = sc.split(';')[0];
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch (_) { data = text; }
    return { status: r.status, data };
  }
  const ok = async (...a) => {
    const r = await call(...a);
    if (r.status >= 400) throw new Error(`${a[1]} ${a[2]} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  // Assert a request is refused. `re` may be null to accept any error message.
  const fails = async (re, ...a) => {
    const r = await call(...a);
    assert(r.status >= 400, `expected ${a[1]} ${a[2]} to be refused, got ${r.status} ${JSON.stringify(r.data)}`);
    if (re) assert(re.test(r.data && r.data.error || ''), `wrong error for ${a[2]}: ${JSON.stringify(r.data)}`);
    return r.data;
  };
  const clearJars = () => { for (const k of Object.keys(jars)) delete jars[k]; };
  return { call, ok, fails, jars, clearJars };
}

// Wipe every bit of shared state between tests in one file: the store, the
// settings cache, the sign-in lockout counters and the clock.
function reset() {
  store().resetLocal();
  settings().clearCache();
  auth().fails.clear();
  clock.reset();
}

// Read the outbox (every email/text the app tried to send is logged there).
async function outbox() {
  return store().list('outbox');
}

module.exports = {
  setupEnv, tmp, startApp, makeClient, reset, outbox,
  clock, store, settings, auth, jobs, payouts, snackshack, simulator,
  ...require('./feeds'),
  world: (...a) => require('./world').buildWorld(...a)
};
