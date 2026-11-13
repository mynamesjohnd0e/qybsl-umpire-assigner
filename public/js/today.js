// Role-aware "Today" home.
import { $, esc, SLOTS, LABEL, S, api, toast, fmtDay, fmtTime, fmtWhen, fmtStamp, keyLabel, weekLabel, matchup, first, money, groupBy, modal, confirmBox } from './core.js';
import { go } from './nav.js';
import { coachNeeds, manageNeeds } from './scores.js';
import { tieClusters } from './standings.js';
import { getBoard } from './umpire.js';

// ── Today: a role-aware home of what needs you now ────────────────────────────
async function viewToday(main) {
  const role = S.activeRole;
  main.innerHTML = `<h2>Hi ${esc(first(S.me.name) || 'there')} 👋</h2><p class="sub">${esc(todaySub(role))}</p><div id="tbody"><p class="muted">Loading…</p></div>`;
  const body = $('#tbody');
  const todays = { umpire: todayUmpire, coach: todayCoach, director: todayDirector, admin: todayAdmin, snack: todaySnack };
  try {
    if (todays[role]) await todays[role](body);
    else body.innerHTML = `<div class="empty">You're all set. Use the buttons at the bottom to get around.</div>`;
  } catch (e) { body.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
}
function todaySub(role) {
  return ({ umpire: 'Your games, open spots and pay at a glance.', coach: 'What needs you for your team right now.',
    director: 'What needs a decision in your division.', admin: 'The league at a glance.', snack: 'Snack Shack sign-ups.' }[role]) || 'Welcome.';
}
function tileGrid(list) { return `<div class="stats">${list.filter(Boolean).join('')}</div>`; }
function tile(n, label, dest, cls) {
  return `<div class="stat ${dest ? 'click' : ''}"${dest ? ` data-go="${dest}"` : ''}><div class="n ${cls || ''}">${n}</div><div class="l">${esc(label)}</div></div>`;
}
function soonNote(body, text) { body.insertAdjacentHTML('beforeend', `<p class="small muted mt">${esc(text)}</p>`); }
function bindGo(root) { root.querySelectorAll('[data-go]').forEach(el => { el.onclick = () => go(el.dataset.go); }); }

async function todayUmpire(body) {
  const d = await getBoard();
  const mine = d.board.filter(g => g.mine && g.mine.length);
  const openSpots = d.board.reduce((n, g) => n + SLOTS.filter(k => g.slots[k].status === 'open').length, 0);
  const reconfirm = mine.filter(g => g.mine.some(k => g.slots[k].state === 'reconfirm')).length;
  const owed = (d.pay || []).filter(p => p.status !== 'paid');
  const owedAmt = owed.reduce((t, p) => t + (p.amount || 0), 0);
  body.innerHTML = tileGrid([
    tile(mine.length, "Games you're on", 'mine'),
    tile(openSpots, 'Open spots to grab', 'open'),
    reconfirm ? tile(reconfirm, 'Need you to reconfirm', 'mine', 'bad') : '',
    tile(owed.length, 'Games awaiting pay' + (owedAmt ? ` · ${money(owedAmt)}` : ''), 'pay')
  ]);
  bindGo(body);
}
async function todayCoach(body) {
  const [d, sd] = await Promise.all([api('GET', '/api/coach/games'), api('GET', '/api/coach/scores')]);
  if (d.pending) { body.innerHTML = `<div class="note info">We're linking your account to your team. An admin will confirm you shortly.</div>`; return; }
  const now = Date.now();
  const toConfirm = d.games.filter(g => new Date(g.start) <= now && SLOTS.some(k => g.slots[k].umpire && !g.slots[k].worked)).length;
  const scoreTasks = (sd.games || []).filter(coachNeeds).length;
  const upcoming = d.games.filter(g => new Date(g.start) > now).length;
  body.innerHTML = tileGrid([
    tile(scoreTasks, 'Scores to enter or confirm', 'scores', scoreTasks ? 'bad' : ''),
    tile(toConfirm, 'Umpires to confirm worked', 'coach', toConfirm ? 'bad' : ''),
    tile(upcoming, 'Upcoming games', 'coach')
  ]);
  bindGo(body);
  soonNote(body, 'Open a game from Scores to log pitchers and check who can pitch.');
}
async function todayDirector(body) {
  const [d, sd, vd] = await Promise.all([api('GET', '/api/admin/overview'), api('GET', '/api/standings'), api('GET', '/api/admin/pitching/violations')]);
  const c = d.counts || {};
  const scoreNeeds = (d.games || []).filter(manageNeeds).length;
  const myDivs = (S.me.director && S.me.director.divisions) || [];
  const ties = myDivs.reduce((n, dv) => n + tieClusters((sd.standings || {})[dv] || []).length, 0);
  const alerts = (vd.violations || []).length;
  body.innerHTML = tileGrid([
    tile(scoreNeeds, 'Scores needing you', 'scores', scoreNeeds ? 'bad' : ''),
    alerts ? tile(alerts, 'Pitch-count alerts', 'violations', 'bad') : '',
    ties ? tile(ties, 'Ties to break (coin toss)', 'standings', 'bad') : '',
    tile(c.open || 0, 'Games still needing umpires', 'cov'),
    tile(c.unconfirmed || 0, 'Past games, umpires unconfirmed', 'cov')
  ]);
  bindGo(body);
  soonNote(body, 'Snack Shack sign-ups arrive in the next update.');
}
async function todayAdmin(body) {
  const [d, sd, vd] = await Promise.all([api('GET', '/api/admin/overview'), api('GET', '/api/standings'), api('GET', '/api/admin/pitching/violations')]);
  const c = d.counts || {};
  const pending = (c.approvals || 0) + (c.coaches || 0);
  const scoreNeeds = (d.games || []).filter(manageNeeds).length;
  const ties = Object.values(sd.standings || {}).reduce((n, rows) => n + tieClusters(rows).length, 0);
  const alerts = (vd.violations || []).length;
  body.innerHTML = tileGrid([
    tile(scoreNeeds, 'Scores needing you', 'scores', scoreNeeds ? 'bad' : ''),
    alerts ? tile(alerts, 'Pitch-count alerts', 'violations', 'bad') : '',
    ties ? tile(ties, 'Ties to break (coin toss)', 'standings', 'bad') : '',
    tile(c.open || 0, 'Games needing umpires', 'cov'),
    tile(pending, 'People awaiting approval', 'people', pending ? 'bad' : '')
  ]);
  bindGo(body);
  soonNote(body, `Last schedule sync: ${d.lastRun ? fmtStamp(d.lastRun.at) : 'never'}. Snack Shack screens arrive in the next update.`);
}
async function todaySnack(body) {
  let d;
  try { d = await api('GET', '/api/admin/snack'); } catch (e) { body.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; return; }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const upcoming = (d.shifts || []).filter(s => !s.cancelled && s.date >= today);
  const unfilled = upcoming.filter(s => (s.spotsLeft || 0) > 0).length;
  body.innerHTML = tileGrid([
    tile(unfilled, 'Shifts needing volunteers', 'snack', unfilled ? 'bad' : ''),
    tile(upcoming.length, 'Upcoming shifts', 'snack')
  ]);
  bindGo(body);
}

export { viewToday };
