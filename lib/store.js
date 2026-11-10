// Storage layer. Firestore on Cloud Run (when FIRESTORE_PROJECT_ID is set),
// a local JSON file otherwise (local testing). Same pattern as the practice
// scheduler. Every collection name gets the `ump_` prefix so this app never
// collides with the other QYBSL tools sharing the project.
const fs = require('fs');
const path = require('path');

const PREFIX = 'ump_';
const USE_FIRESTORE = !!process.env.FIRESTORE_PROJECT_ID;

let fsdb = null;
if (USE_FIRESTORE) {
  const { Firestore } = require('@google-cloud/firestore');
  fsdb = new Firestore({
    projectId: process.env.FIRESTORE_PROJECT_ID,
    databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)',
    ignoreUndefinedProperties: true
  });
}

// ── Local JSON backend ───────────────────────────────────────────────────────
const LOCAL_FILE = process.env.LOCAL_DB_FILE || path.join(__dirname, '..', 'data', 'store.json');
let mem = null;
function loadLocal() {
  if (mem) return mem;
  try { mem = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')); } catch (_) { mem = {}; }
  return mem;
}
function saveLocal() {
  fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
  const tmp = LOCAL_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(mem, null, 1));
  fs.renameSync(tmp, LOCAL_FILE);
}
const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));

// One-at-a-time lock so local transactions behave like Firestore's.
let chain = Promise.resolve();
function withLock(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

const ref = (col, id) => fsdb.collection(PREFIX + col).doc(String(id));

async function get(col, id) {
  if (USE_FIRESTORE) {
    const s = await ref(col, id).get();
    return s.exists ? s.data() : null;
  }
  const db = loadLocal();
  return clone(db[col]?.[id] ?? null);
}

async function list(col) {
  if (USE_FIRESTORE) {
    const s = await fsdb.collection(PREFIX + col).get();
    return s.docs.map(d => d.data());
  }
  const db = loadLocal();
  return Object.values(db[col] || {}).map(clone);
}

async function set(col, id, data) {
  if (USE_FIRESTORE) return void (await ref(col, id).set(data));
  return withLock(() => {
    const db = loadLocal();
    (db[col] ||= {})[id] = clone(data);
    saveLocal();
  });
}

async function update(col, id, patch) {
  if (USE_FIRESTORE) return void (await ref(col, id).set(patch, { merge: true }));
  return withLock(() => {
    const db = loadLocal();
    const cur = (db[col] ||= {})[id] || {};
    db[col][id] = { ...cur, ...clone(patch) };
    saveLocal();
  });
}

async function del(col, id) {
  if (USE_FIRESTORE) return void (await ref(col, id).delete());
  return withLock(() => {
    const db = loadLocal();
    if (db[col]) delete db[col][id];
    saveLocal();
  });
}

// Run `fn(tx)` atomically. tx.get / tx.set / tx.list. Do all reads before any
// writes (a Firestore rule). If fn throws, nothing is written.
async function transact(fn) {
  if (USE_FIRESTORE) {
    return fsdb.runTransaction(async t => {
      const tx = {
        get: async (col, id) => { const s = await t.get(ref(col, id)); return s.exists ? s.data() : null; },
        list: col => list(col),
        set: (col, id, data) => t.set(ref(col, id), data)
      };
      return fn(tx);
    });
  }
  return withLock(async () => {
    const db = loadLocal();
    const writes = [];
    const tx = {
      get: async (col, id) => clone(db[col]?.[id] ?? null),
      list: async col => Object.values(db[col] || {}).map(clone),
      set: (col, id, data) => writes.push([col, id, clone(data)])
    };
    const out = await fn(tx);
    for (const [col, id, data] of writes) (db[col] ||= {})[id] = data;
    if (writes.length) saveLocal();
    return out;
  });
}

// Delete every document in a collection (used by the test-copy reset).
async function clear(col) {
  if (USE_FIRESTORE) {
    const snap = await fsdb.collection(PREFIX + col).get();
    for (let i = 0; i < snap.docs.length; i += 400) {
      const b = fsdb.batch();
      snap.docs.slice(i, i + 400).forEach(d => b.delete(d.ref));
      await b.commit();
    }
    return snap.size;
  }
  return withLock(() => {
    const db = loadLocal();
    const n = Object.keys(db[col] || {}).length;
    delete db[col];
    saveLocal();
    return n;
  });
}

// Test helper: wipe local data.
function resetLocal() { mem = {}; if (!USE_FIRESTORE) saveLocal(); }

module.exports = { get, list, set, update, del, clear, transact, resetLocal, USE_FIRESTORE };
