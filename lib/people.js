// People: umpires, coaches and admins live in one collection keyed by email,
// so one person can hold more than one role (a coach who is also an admin).
const store = require('./store');
const { getSettings } = require('./settings');
const { normEmail, validEmail, validPin, hashPin } = require('./auth');

// Small CSV reader: handles quoted fields, commas and line breaks in quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const clean = rows.filter(r => r.some(v => v.trim()));
  if (!clean.length) return [];
  const head = clean[0].map(h => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return clean.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

const pick = (row, ...keys) => { for (const k of keys) if (row[k]) return row[k]; return ''; };
const yes = v => /^(y|yes|true|1|x)$/i.test(String(v || '').trim());

function blankPerson(email) {
  return { email, name: '', mobile: '', registered: false, pinHash: null, createdAt: new Date().toISOString(), umpire: null, coach: null };
}

// Umpire list columns: name, email, mobile, parent_name, parent_email,
// parent_mobile, venmo, plate_qualified (yes/no, optional).
async function importUmpires(csvText) {
  const rows = parseCsv(csvText);
  const out = { added: 0, updated: 0, skipped: [] };
  for (const r of rows) {
    const email = normEmail(pick(r, 'email', 'email_address', 'umpire_email'));
    if (!validEmail(email)) { out.skipped.push(`${pick(r, 'name') || '(no name)'}: missing or bad email`); continue; }
    const p = (await store.get('people', email)) || blankPerson(email);
    const isNew = !p.umpire;
    p.name = p.name || pick(r, 'name', 'umpire_name', 'full_name');
    p.mobile = p.mobile || pick(r, 'mobile', 'phone', 'cell');
    const u = p.umpire || { approved: true, plateQualified: false, active: true };
    u.onRoster = true;
    u.approved = true;
    u.active = u.active !== false;
    u.parentName = u.parentName || pick(r, 'parent_name', 'parent', 'guardian_name');
    u.parentEmail = normEmail(u.parentEmail || pick(r, 'parent_email', 'guardian_email'));
    u.parentMobile = u.parentMobile || pick(r, 'parent_mobile', 'parent_phone', 'guardian_mobile');
    u.venmo = u.venmo || pick(r, 'venmo', 'venmo_handle');
    if ('plate_qualified' in r && r.plate_qualified !== '') u.plateQualified = yes(r.plate_qualified);
    p.umpire = u;
    await store.set('people', email, p);
    isNew ? out.added++ : out.updated++;
  }
  return out;
}

// Coach list columns: name, email, mobile, team, division. One row per team;
// a coach with two teams gets two rows.
async function importCoaches(csvText) {
  const rows = parseCsv(csvText);
  const byEmail = new Map();
  const out = { added: 0, updated: 0, skipped: [] };
  for (const r of rows) {
    const email = normEmail(pick(r, 'email', 'coach_email', 'email_address'));
    const team = pick(r, 'team', 'team_name');
    if (!validEmail(email)) { out.skipped.push(`${pick(r, 'name') || team || '(no name)'}: missing or bad email`); continue; }
    if (!team) { out.skipped.push(`${email}: no team`); continue; }
    const e = byEmail.get(email) || { name: pick(r, 'name', 'coach_name', 'head_coach'), mobile: pick(r, 'mobile', 'phone', 'cell'), teams: [] };
    e.teams.push({ team, division: pick(r, 'division', 'league', 'age_group') });
    byEmail.set(email, e);
  }
  for (const [email, e] of byEmail) {
    const p = (await store.get('people', email)) || blankPerson(email);
    const isNew = !p.coach;
    p.name = p.name || e.name;
    p.mobile = p.mobile || e.mobile;
    const old = p.coach?.teams || [];
    const merged = [...old];
    for (const t of e.teams) if (!merged.some(o => o.team.toLowerCase() === t.team.toLowerCase())) merged.push(t);
    p.coach = { onRoster: true, pending: false, teams: merged };
    await store.set('people', email, p);
    isNew ? out.added++ : out.updated++;
  }
  return out;
}

// Self sign-up. Umpires on the list are approved automatically; coaches on the
// list are linked to their teams automatically; everyone else waits for an admin.
async function signup(body) {
  const email = normEmail(body.email);
  const role = body.role;
  if (!validEmail(email)) throw new Error('Enter a valid email address.');
  if (!validPin(body.pin)) throw new Error('PIN must be 4 to 6 digits.');
  if (!['umpire', 'coach', 'admin'].includes(role)) throw new Error('Choose umpire, coach or board admin.');
  const s = await getSettings();
  const isAdmin = s.adminEmails.includes(email);
  if (role === 'admin' && !isAdmin) throw new Error('That email is not on the board admin list. Ask John to add you.');

  const p = (await store.get('people', email)) || blankPerson(email);
  if (p.registered) throw new Error('You already have a PIN. Sign in instead, or ask an admin to reset it.');
  const name = String(body.name || '').trim();
  const mobile = String(body.mobile || '').trim();
  if (!name) throw new Error('Enter your name.');
  p.name = name;
  p.mobile = mobile || p.mobile;

  if (role === 'umpire') {
    const f = k => String(body[k] || '').trim();
    const missing = ['mobile', 'parentName', 'parentEmail', 'parentMobile', 'venmo'].filter(k => !f(k));
    if (missing.length) throw new Error('Umpires need your mobile, a parent name, parent email, parent mobile and your Venmo.');
    if (!validEmail(normEmail(f('parentEmail')))) throw new Error('Enter a valid parent email.');
    const u = p.umpire || { approved: false, plateQualified: false, active: true, onRoster: false };
    Object.assign(u, {
      parentName: f('parentName'), parentEmail: normEmail(f('parentEmail')),
      parentMobile: f('parentMobile'), venmo: f('venmo').replace(/^@?/, '@')
    });
    u.approved = !!u.onRoster || !!u.approved;
    p.umpire = u;
  }
  if (role === 'coach' && !p.coach) p.coach = { onRoster: false, pending: true, teams: [] };

  p.pinHash = hashPin(body.pin);
  p.registered = true;
  p.registeredAt = new Date().toISOString();
  await store.set('people', email, p);
  return p;
}

// What the browser is allowed to see about the signed-in person.
function selfView(p) {
  return {
    email: p.email, name: p.name, mobile: p.mobile, isAdmin: !!p.isAdmin,
    umpire: p.umpire ? {
      approved: p.umpire.approved, plateQualified: p.umpire.plateQualified, active: p.umpire.active !== false,
      parentName: p.umpire.parentName, parentEmail: p.umpire.parentEmail,
      parentMobile: p.umpire.parentMobile, venmo: p.umpire.venmo
    } : null,
    coach: p.coach ? { pending: !!p.coach.pending, teams: p.coach.teams || [] } : null
  };
}

// Admin view drops only the PIN hash.
function adminView(p) {
  const { pinHash, ...rest } = p;
  return rest;
}

const firstName = n => String(n || '').trim().split(/\s+/)[0] || 'TBD';

module.exports = { parseCsv, importUmpires, importCoaches, signup, selfView, adminView, firstName };
