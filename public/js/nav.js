// App shell: boot, roles, destinations (DEST), bottom nav and the "More" sheet.
import { $, esc, SLOTS, LABEL, S, api, toast, fmtDay, fmtTime, fmtWhen, fmtStamp, keyLabel, weekLabel, matchup, first, money, groupBy, modal, confirmBox } from './core.js';
import { renderAuth } from './auth.js';
import { viewToday } from './today.js';
import { viewScores, viewGame, viewEnterSE } from './scores.js';
import { viewStandings, viewBrackets } from './standings.js';
import { viewOpen, viewMine, viewPay } from './umpire.js';
import { viewCoach } from './coach.js';
import { viewCoverage, viewPeople, viewRatings, viewPayouts, viewSync, viewMessages, viewSettings } from './admin.js';
import { viewAccount } from './account.js';
import { viewViolations } from './pitching.js';

async function act(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); await loadTab(); return r; }
  catch (e) { toast(e.message, true); throw e; }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  const info = await api('GET', '/api/me');
  S.info = info; S.me = info.me;
  $('#season').textContent = info.season ? ` · ${info.season}` : '';
  if (!S.me) return renderAuth();
  const roles = rolesFor(S.me);
  if (!S.activeRole || !(roles.includes(S.activeRole) || S.activeRole === 'account')) S.activeRole = defaultRole(roles);
  S.tab = 'today';
  renderShell();
  await loadTab();
}

// ── Roles, destinations and icons ─────────────────────────────────────────────
const ROLE_NAMES = { umpire: 'Umpire', coach: 'Coach', director: 'Division director', admin: 'Board admin', snack: 'Snack Shack' };
function rolesFor(me) {
  const r = [];
  if (me.umpire) r.push('umpire');
  if (me.coach) r.push('coach');
  if (me.director && (me.director.divisions || []).length) r.push('director');
  if (me.isAdmin) r.push('admin');
  if (me.snack) r.push('snack');
  return r;
}
function defaultRole(roles) {
  for (const r of ['admin', 'director', 'coach', 'umpire', 'snack']) if (roles.includes(r)) return r;
  return roles[0] || 'account';
}

// Which destinations each role shows: up to four in the bottom bar, the rest
// behind "More". "Account" is always reachable from More.
const ROLE_NAV = {
  umpire:   { bar: ['today', 'open', 'mine', 'pay'], more: ['standings'] },
  coach:    { bar: ['today', 'coach', 'scores', 'standings'] },
  director: { bar: ['today', 'cov', 'scores', 'standings'], more: ['brackets', 'violations', 'entersse'] },
  admin:    { bar: ['today', 'cov', 'scores', 'standings'], more: ['brackets', 'violations', 'people', 'entersse', 'ratings', 'payouts', 'sync', 'msgs', 'settings'] },
  snack:    { bar: ['today'] },
  account:  { bar: ['today'] }
};
function navFor(role) {
  const n = ROLE_NAV[role] || ROLE_NAV.account;
  const bar = n.bar.slice();
  const more = (n.more || []).slice();
  if (!bar.includes('account') && !more.includes('account')) more.push('account');
  return { bar, more };
}

// Every destination: its label, bottom-bar icon and the view that draws it.
const DEST = {
  today:    { label: 'Today',    icon: 'home',      view: viewToday },
  open:     { label: 'Open',     icon: 'list',      view: viewOpen },
  mine:     { label: 'My games', icon: 'calendar',  view: viewMine },
  pay:      { label: 'Pay',      icon: 'dollar',    view: viewPay },
  coach:    { label: 'My team',  icon: 'calendar',  view: viewCoach },
  cov:      { label: 'Coverage', icon: 'clipboard', view: viewCoverage },
  people:   { label: 'People',   icon: 'people',    view: viewPeople },
  ratings:  { label: 'Ratings',  icon: 'star',      view: viewRatings },
  payouts:  { label: 'Payouts',  icon: 'dollar',    view: viewPayouts },
  sync:     { label: 'Schedule', icon: 'sync',      view: viewSync },
  msgs:     { label: 'Messages', icon: 'mail',      view: viewMessages },
  settings: { label: 'Settings', icon: 'gear',      view: viewSettings },
  account:  { label: 'Account',  icon: 'user',      view: viewAccount },
  scores:   { label: 'Scores',   icon: 'score',     view: viewScores },
  standings:{ label: 'Standings', icon: 'rank',     view: viewStandings },
  brackets: { label: 'Playoffs', icon: 'trophy',    view: viewBrackets },
  entersse: { label: 'Enter in SE', icon: 'send',   view: viewEnterSE },
  violations:{ label: 'Pitch alerts', icon: 'warn', view: viewViolations },
  game:     { label: 'Game',     icon: 'calendar',  view: viewGame }
};

const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  dollar: '<path d="M12 2v20M17 6a4 4 0 0 0-4-2h-2a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-2a4 4 0 0 1-4-2.5"/>',
  clipboard: '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 6V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1z"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.5a3 3 0 0 1 0 5M21 20a6 6 0 0 0-5-5.9"/>',
  star: '<path d="M12 3l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9 6.75 19l1-5.8L3.5 9.2l5.9-.9z"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14-4.5L4 9M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14 4.5L20 15M20 20v-5h-5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.9 7.9 0 0 0 0-2l2-1.5-2-3.4-2.3 1a8 8 0 0 0-1.7-1l-.4-2.6H9.9l-.4 2.6a8 8 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7.9 7.9 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 1.7 1l.4 2.6h4.2l.4-2.6a8 8 0 0 0 1.7-1l2.3 1 2-3.4z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  score: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M12 6v12"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  rank: '<path d="M4 20h4v-9H4zM10 20h4V4h-4zM16 20h4v-6h-4z"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 5H4v1a3 3 0 0 0 3 3M17 5h3v1a3 3 0 0 1-3 3M9 21h6M12 17v4"/>',
  warn: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17.5v.5"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.home}</svg>`; }

function testBanner() {
  if (!S.info.testMode || document.querySelector('.test-banner')) return;
  const b = document.createElement('div');
  b.className = 'note warn test-banner';
  b.style.cssText = 'margin:0;border-radius:0;text-align:center';
  b.innerHTML = '<b>TEST COPY</b> · practice data only. Messages only go to John\'s addresses.';
  document.querySelector('.stripe').after(b);
}

// ── Shell: header (name + role switch), bottom nav, "More" sheet ──────────────
function renderShell() {
  document.body.classList.add('signed-in');
  $('#main').classList.add('solo');
  testBanner();
  renderWho();
  renderBottomNav();
}
function renderWho() {
  const roles = rolesFor(S.me);
  const sw = roles.length > 1
    ? `<select class="rolesw" id="rolesw" aria-label="Switch role">${roles.map(r => `<option value="${r}" ${S.activeRole === r ? 'selected' : ''}>${esc(ROLE_NAMES[r] || r)}</option>`).join('')}</select>`
    : '';
  $('#who').innerHTML = `${sw}<span class="who-name">${esc(S.me.name)}</span><button id="logout">Sign out</button>`;
  $('#logout').onclick = async () => { await api('POST', '/api/auth/logout'); S.me = null; S.tab = null; S.activeRole = null; S.cache = {}; boot(); };
  const rs = $('#rolesw');
  if (rs) rs.onchange = e => { S.activeRole = e.target.value; S.tab = 'today'; renderBottomNav(); loadTab(); };
}
function renderBottomNav() {
  const { bar, more } = navFor(S.activeRole);
  const nav = $('#bottomnav');
  const moreActive = more.includes(S.tab);
  nav.innerHTML = bar.map(k => navBtn(k, S.tab === k)).join('') +
    (more.length ? `<button class="bn ${moreActive ? 'active' : ''}" data-more="1">${icon('more')}<span>More</span></button>` : '');
  nav.onclick = e => {
    const b = e.target.closest('[data-tab]');
    const m = e.target.closest('[data-more]');
    if (b) go(b.dataset.tab);
    else if (m) openMoreSheet(more);
  };
}
function navBtn(k, active) {
  const d = DEST[k] || {};
  return `<button class="bn ${active ? 'active' : ''}" data-tab="${k}">${icon(d.icon)}<span>${esc(d.label)}</span><span class="bn-badge" data-badge="${k}"></span></button>`;
}
function go(key) { S.tab = key; closeSheet(); renderBottomNav(); loadTab(); }
function openMoreSheet(more) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="sheet-bg"><div class="sheet"><div class="sheet-h">More</div>${more.map(k => {
    const d = DEST[k] || {};
    return `<button class="sh-item ${S.tab === k ? 'active' : ''}" data-tab="${k}">${icon(d.icon)}<span>${esc(d.label)}</span></button>`;
  }).join('')}</div></div>`;
  root.querySelector('.sheet-bg').addEventListener('mousedown', e => { if (e.target.classList.contains('sheet-bg')) closeSheet(); });
  root.onclick = e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); };
}
function closeSheet() { const r = $('#sheet-root'); if (r) r.innerHTML = ''; }

function setBadge(tab, n, cls = 'b-red') {
  const el = document.querySelector(`[data-badge="${tab}"]`);
  if (el) el.innerHTML = n ? `<span class="badge ${cls}">${n}</span>` : '';
}

async function loadTab() {
  const main = $('#main');
  const d = DEST[S.tab] || DEST.today;
  try { await d.view(main); }
  catch (e) {
    if (e.status === 401) { S.me = null; return renderAuth(); }
    main.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
  }
}

export { boot, go, loadTab, setBadge, renderBottomNav, renderShell, act, closeSheet, testBanner };
