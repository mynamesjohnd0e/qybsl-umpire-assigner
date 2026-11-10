// Email + PIN sign-in. PINs are hashed (scrypt); sessions are signed tokens
// kept in a cookie. No passwords, no outside accounts.
const crypto = require('crypto');
const store = require('./store');
const clock = require('./clock');
const { getSettings } = require('./settings');

const COOKIE = 'ump_session';
const SESSION_DAYS = 60;

const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validPin = p => /^\d{4,6}$/.test(String(p || ''));

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}
function checkPin(pin, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pin), salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

// Signing secret: env var, else generated once and kept in storage so
// sessions survive restarts.
let secret = null;
async function getSecret() {
  if (secret) return secret;
  if (process.env.SESSION_SECRET) return (secret = process.env.SESSION_SECRET);
  const doc = await store.get('settings', 'secret');
  if (doc?.value) return (secret = doc.value);
  secret = crypto.randomBytes(32).toString('hex');
  await store.set('settings', 'secret', { value: secret });
  return secret;
}

async function makeToken(email) {
  const body = Buffer.from(JSON.stringify({ e: email, x: clock.now().getTime() + SESSION_DAYS * 864e5 })).toString('base64url');
  const sig = crypto.createHmac('sha256', await getSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
async function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const good = crypto.createHmac('sha256', await getSecret()).update(body).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const data = JSON.parse(Buffer.from(body, 'base64url').toString());
  return data.x > clock.now().getTime() ? data.e : null;
}

// Slow down PIN guessing: 8 misses locks the email for 15 minutes.
const fails = new Map();
function lockedOut(email) {
  const f = fails.get(email);
  return f && f.until > clock.now().getTime();
}
function noteFail(email) {
  const f = fails.get(email) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 8) { f.until = clock.now().getTime() + 15 * 60e3; f.n = 0; }
  fails.set(email, f);
}

function readCookie(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

function setCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' || !!process.env.K_SERVICE;
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}
function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Attaches req.user = person record plus roles, or null.
async function loadUser(req, _res, next) {
  try {
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const email = await readToken(bearer || readCookie(req));
    req.user = null;
    if (email) {
      const person = await store.get('people', email);
      if (person?.registered) {
        const s = await getSettings();
        person.isAdmin = s.adminEmails.includes(email);
        req.user = person;
      }
    }
  } catch (_) { req.user = null; }
  next();
}

const need = check => (req, res, next) =>
  req.user && check(req.user) ? next() : res.status(req.user ? 403 : 401).json({ error: req.user ? 'Not allowed.' : 'Please sign in.' });

const requireUser = need(() => true);
const requireAdmin = need(u => u.isAdmin);
const requireUmpire = (req, res, next) => {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'Please sign in.' });
  if (!u.umpire) return res.status(403).json({ error: 'This account is not set up as an umpire.' });
  if (!u.umpire.approved) return res.status(403).json({ error: 'Your umpire account is waiting for approval from the league.' });
  if (u.umpire.active === false) return res.status(403).json({ error: 'Your umpire account is inactive.' });
  next();
};
const requireCoach = need(u => u.coach || u.isAdmin);

module.exports = {
  normEmail, validEmail, validPin, hashPin, checkPin, makeToken, readToken,
  lockedOut, noteFail, fails, setCookie, clearCookie, loadUser,
  requireUser, requireAdmin, requireUmpire, requireCoach
};
