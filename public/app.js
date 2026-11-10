// Quincy Youth Baseball - League Operations — browser app (vanilla JS).
'use strict';

const TZ = 'America/New_York';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SLOTS = ['plate', 'field'];
const LABEL = { plate: 'Plate', field: 'Field' };

const S = { me: null, info: {}, tab: null, signup: false, role: 'umpire', cache: {}, filters: { umpire: { onlyMine: true, division: '' }, cov: { week: 'upcoming', division: '', track: '', status: '', q: '' } } };

// ── Helpers ──────────────────────────────────────────────────────────────────
async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || `Error ${r.status}`); e.data = data; e.status = r.status; throw e; }
  return data;
}
let toastTimer;
function toast(msg, bad) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), bad ? 5000 : 2800);
}
const fmtDay = iso => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
const fmtTime = iso => new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const fmtWhen = iso => `${fmtDay(iso)} · ${fmtTime(iso)}`;
const fmtStamp = iso => iso ? new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const keyLabel = k => new Date(k + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const weekLabel = k => `Week of ${keyLabel(k)}`;
const matchup = g => g.away && g.home ? `${g.away} at ${g.home}` : g.summary;
const first = n => String(n || '').trim().split(/\s+/)[0];
const money = n => '$' + Number(n || 0).toLocaleString('en-US');
const groupBy = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); (m[k] ||= []).push(x); return m; }, {});

function modal(title, html, onSubmit, { submitLabel = 'Save', danger = false } = {}) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-bg"><form class="modal"><h2>${esc(title)}</h2>${html}
    <div class="foot"><button type="button" class="btn ghost" data-close>Cancel</button>${onSubmit ? `<button class="btn ${danger ? 'red' : ''}">${esc(submitLabel)}</button>` : ''}</div></form></div>`;
  const form = root.querySelector('form');
  const close = () => { root.innerHTML = ''; };
  root.querySelector('[data-close]').onclick = close;
  root.querySelector('.modal-bg').addEventListener('mousedown', e => { if (e.target.classList.contains('modal-bg')) close(); });
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('.foot .btn:not(.ghost)');
    if (btn) btn.disabled = true;
    try { if (await onSubmit(Object.fromEntries(new FormData(form)), form) !== false) close(); }
    catch (err) { toast(err.message, true); }
    finally { if (btn) btn.disabled = false; }
  };
  form.querySelector('input,select,textarea')?.focus();
  return form;
}
const confirmBox = (title, text, label, danger) => new Promise(res => {
  modal(title, `<p>${text}</p>`, () => { res(true); }, { submitLabel: label, danger });
  $('#modal-root [data-close]').addEventListener('click', () => res(false));
});

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
  S.tab = S.tab || defaultTab();
  renderShell();
  await loadTab();
}

function tabsFor(me) {
  const t = [];
  if (me.umpire) t.push(['g', 'Umpire'], ['open', 'Open games'], ['mine', 'My games'], ['pay', 'My pay']);
  if (me.coach) t.push(['g', 'Coach'], ['coach', 'My team\'s games']);
  if (me.isAdmin) t.push(['g', 'Admin'], ['cov', 'Coverage'], ['people', 'People'], ['ratings', 'Ratings'], ['payouts', 'Payouts'], ['sync', 'Schedule sync'], ['msgs', 'Messages'], ['settings', 'Settings']);
  t.push(['g', ''], ['account', 'My account']);
  return t;
}
function defaultTab() {
  if (S.me.isAdmin) return 'cov';
  if (S.me.umpire) return 'open';
  if (S.me.coach) return 'coach';
  return 'account';
}

function testBanner() {
  if (!S.info.testMode || document.querySelector('.test-banner')) return;
  const b = document.createElement('div');
  b.className = 'note warn test-banner';
  b.style.cssText = 'margin:0;border-radius:0;text-align:center';
  b.innerHTML = '<b>TEST COPY</b> · practice data only. Messages only go to John\'s addresses.';
  document.querySelector('.stripe').after(b);
}

function renderShell() {
  $('#who').innerHTML = `<span>${esc(S.me.name)}</span><button id="logout">Sign out</button>`;
  $('#logout').onclick = async () => { await api('POST', '/api/auth/logout'); S.me = null; S.tab = null; S.cache = {}; boot(); };
  const tabs = tabsFor(S.me);
  const groups = tabs.filter(t => t[0] === 'g' && t[1]).length;
  $('#tabs').hidden = false;
  $('#main').classList.remove('solo');
  testBanner();
  $('#tabs').innerHTML = tabs.map(([k, l]) => k === 'g' ? (groups > 1 && l ? `<span class="tab-group">${esc(l)}</span>` : '') :
    `<button class="tab ${S.tab === k ? 'active' : ''}" data-tab="${k}">${esc(l)}<span data-badge="${k}"></span></button>`).join('');
  $('#tabs').onclick = e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    S.tab = b.dataset.tab;
    $('#tabs').querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b));
    loadTab();
  };
}

function setBadge(tab, n, cls = 'b-red') {
  const el = document.querySelector(`[data-badge="${tab}"]`);
  if (el) el.innerHTML = n ? ` <span class="badge ${cls}">${n}</span>` : '';
}

async function loadTab() {
  const main = $('#main');
  const views = { open: viewOpen, mine: viewMine, pay: viewPay, coach: viewCoach, cov: viewCoverage, people: viewPeople, ratings: viewRatings, payouts: viewPayouts, sync: viewSync, msgs: viewMessages, settings: viewSettings, account: viewAccount };
  try { await (views[S.tab] || viewAccount)(main); }
  catch (e) {
    if (e.status === 401) { S.me = null; return renderAuth(); }
    main.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
  }
}

// ── Sign in / sign up ────────────────────────────────────────────────────────
function renderAuth() {
  $('#who').innerHTML = '';
  testBanner();
  $('#tabs').hidden = true;
  const main = $('#main');
  main.classList.add('solo');
  const r = S.role;
  main.innerHTML = `<div class="auth">
    <div class="brand"><b>${S.signup ? 'First time? Set up your PIN' : 'Sign in'}</b><span>Quincy Youth Baseball &amp; Softball umpire scheduling</span></div>
    ${S.signup ? `
      <form class="form" id="auth-form" style="max-width:none">
        <div class="seg" role="tablist">
          ${[['umpire', 'Umpire'], ['coach', 'Coach'], ['admin', 'Board admin']].map(([k, l]) => `<button type="button" data-role="${k}" class="${r === k ? 'on' : ''}">${l}</button>`).join('')}
        </div>
        <p class="small muted">${r === 'umpire' ? 'Student umpires: if the league already has you on the umpire list, you can sign up for games right away. Otherwise an admin will approve you.' :
          r === 'coach' ? 'Head coaches: use the email the league has for you and we\'ll link you to your team automatically.' :
          'Only the board members on the admin list can sign up here.'}</p>
        <div class="grid2">
          <label>Your name<input name="name" required autocomplete="name"></label>
          <label>Email<input name="email" type="email" required autocomplete="email"></label>
          <label>Mobile${r === 'umpire' ? '' : ' (optional)'}<input name="mobile" type="tel" ${r === 'umpire' ? 'required' : ''} autocomplete="tel"></label>
          <label>Choose a PIN (4–6 digits)<input name="pin" inputmode="numeric" pattern="\\d{4,6}" required autocomplete="new-password"></label>
        </div>
        ${r === 'umpire' ? `<fieldset><legend>Parent or guardian</legend>
          <p class="small muted" style="margin-top:-4px">Your parent gets a copy of every reminder.</p>
          <div class="grid2">
            <label>Parent name<input name="parentName" required></label>
            <label>Parent mobile<input name="parentMobile" type="tel" required></label>
          </div>
          <label>Parent email<input name="parentEmail" type="email" required></label>
        </fieldset>
        <label>Your Venmo (for pay)<input name="venmo" placeholder="@your-venmo" required></label>` : ''}
        <button class="btn block">Create my PIN</button>
        <p class="small" style="text-align:center">Already set up? <button type="button" class="link" id="toggle-auth">Sign in</button></p>
      </form>` : `
      <form class="form" id="auth-form" style="margin:0 auto">
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        <label>PIN<input name="pin" type="password" inputmode="numeric" required autocomplete="current-password"></label>
        <button class="btn block">Sign in</button>
        <p class="small" style="text-align:center">First time here? <button type="button" class="link" id="toggle-auth">Sign up</button></p>
        <p class="small muted" style="text-align:center">Forgot your PIN? Ask the Director of Umpires or John to reset it.</p>
      </form>`}
  </div>`;
  $('#toggle-auth').onclick = () => { S.signup = !S.signup; renderAuth(); };
  main.querySelectorAll('[data-role]').forEach(b => b.onclick = () => {
    const keep = Object.fromEntries(new FormData($('#auth-form')));
    S.role = b.dataset.role; renderAuth();
    for (const [k, v] of Object.entries(keep)) { const el = $(`#auth-form [name="${k}"]`); if (el) el.value = v; }
  });
  $('#auth-form').onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector('.btn.block');
    btn.disabled = true;
    try {
      if (S.signup) await api('POST', '/api/auth/signup', { ...body, role: S.role });
      else await api('POST', '/api/auth/login', body);
      S.signup = false; S.tab = null;
      await boot();
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  };
}

// ── Umpire: open games ───────────────────────────────────────────────────────
async function getBoard() { S.cache.board = await api('GET', '/api/umpire/board'); return S.cache.board; }

function slotBox(g, k) {
  const s = g.slots[k];
  if (s.status === 'mine') {
    return `<div class="slot me"><div class="k">${LABEL[k]}</div><div class="v">You</div>${s.state === 'reconfirm' ? '<span class="badge b-yellow">Reconfirm</span>' : ''}</div>`;
  }
  if (s.status === 'taken') return `<div class="slot filled"><div class="k">${LABEL[k]}</div><div class="v muted">Filled</div></div>`;
  const label = s.status === 'swap' ? 'Swap offered' : (s.urgent ? 'Urgent' : 'Open');
  const btn = s.canTake
    ? `<button class="btn sm ${s.urgent ? 'red' : 'green'}" data-act="${s.status === 'swap' ? 'take-swap' : 'claim'}" data-game="${g.id}" data-slot="${k}" data-swap="${s.swapId || ''}">${s.status === 'swap' ? 'Take it' : 'Sign up'}</button>`
    : `<div class="why">${esc(s.why || '')}</div>`;
  return `<div class="slot open"><div class="k">${LABEL[k]}</div><div class="v">${label}</div>${btn}</div>`;
}

function gameCard(g, extra = '') {
  const urgent = SLOTS.some(k => g.slots[k].urgent && g.slots[k].status === 'open');
  return `<div class="game ${g.mine.length ? 'mine' : ''} ${urgent ? 'urgent' : ''}">
    <div>
      <div class="when">${fmtWhen(g.start)} ${g.movedAt ? '<span class="badge b-yellow">Moved</span>' : ''}</div>
      <div class="what">${esc(g.division)} · ${esc(matchup(g))}</div>
      <div class="where">${esc(g.field || 'Field TBD')}${g.mine.length ? ` · Partner: <b>${esc(g.partner || 'not filled yet')}</b>` : ''}</div>
      ${extra}
    </div>
    <div class="slots">${SLOTS.map(k => slotBox(g, k)).join('')}</div>
  </div>`;
}

async function viewOpen(main) {
  const d = await getBoard();
  const f = S.filters.umpire;
  const me = S.me.umpire;
  const divisions = [...new Set(d.board.map(g => g.division))].sort();
  let games = d.board.filter(g => !f.division || g.division === f.division);
  if (f.onlyMine) games = games.filter(g => g.mine.length || SLOTS.some(k => g.slots[k].canTake));
  const weeks = groupBy(games, g => g.week);
  const openCount = d.board.reduce((n, g) => n + SLOTS.filter(k => g.slots[k].canTake).length, 0);
  setBadge('open', openCount, 'b-green');
  main.innerHTML = `
    ${!me.approved ? '<div class="note warn">Your account is waiting for approval from the league. You can look around, but you can\'t sign up for games yet.</div>' : ''}
    <div class="spread"><div><h2>Open games</h2><p class="sub">First come, first served. Limit ${d.weeklyCap} games per week (Mon–Sun). ${me.plateQualified ? 'You can take plate or field.' : 'You can take field spots. Plate spots open up once the league marks you plate-qualified.'}</p></div></div>
    <div class="filters">
      <select id="f-div"><option value="">All divisions</option>${divisions.map(x => `<option ${f.division === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" id="f-mine" ${f.onlyMine ? 'checked' : ''}> Only spots I can take</label>
    </div>
    ${Object.keys(weeks).length ? Object.entries(weeks).map(([wk, list]) => {
      const n = d.weekCounts[wk] || 0;
      return `<section class="week"><div class="week-h"><b>${weekLabel(wk)}</b><span class="small ${n >= d.weeklyCap ? '' : 'muted'}">You have ${n} of ${d.weeklyCap}</span></div>
        <div class="cards">${list.map(g => gameCard(g)).join('')}</div></section>`;
    }).join('') : `<div class="empty">${f.onlyMine ? 'No spots you can take right now. Untick "Only spots I can take" to see the full schedule.' : 'No upcoming games yet.'}</div>`}`;
  $('#f-div').onchange = e => { f.division = e.target.value; viewOpen(main); };
  $('#f-mine').onchange = e => { f.onlyMine = e.target.checked; viewOpen(main); };
  bindUmpireActions(main);
}

function bindUmpireActions(main) {
  main.onclick = async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const { act: a, game, slot, swap } = b.dataset;
    const g = S.cache.board?.board.find(x => x.id === game);
    const what = g ? `${LABEL[slot]} umpire, ${fmtWhen(g.start)}, ${g.division} at ${g.field || 'field TBD'}` : '';
    if (a === 'claim') {
      if (!(await confirmBox('Sign up for this game?', `${esc(what)}.<br><br>Once you sign up you're responsible for this game. If something comes up, you can post a swap, but you stay on it until another umpire takes it.`, 'Sign me up'))) return;
      act(() => api('POST', '/api/umpire/claim', { gameId: game, slot }), 'You\'re on it. Check your email for the details.');
    }
    if (a === 'take-swap') {
      if (!(await confirmBox('Take this swap?', `${esc(what)}.<br><br>You'll be responsible for this game.`, 'Take it'))) return;
      act(() => api('POST', `/api/umpire/swap/${swap}/accept`), 'Swap done. The game is yours.');
    }
    if (a === 'swap') {
      if (!(await confirmBox('Request a swap?', `We'll offer your spot to every umpire who can take it.<br><br><b>You're still responsible for this game until someone accepts.</b> If it's the day of the game and nobody has taken it, contact the Director of Umpires right away.`, 'Post swap'))) return;
      act(() => api('POST', '/api/umpire/swap', { gameId: game, slot }), r => `Swap posted to ${r.offeredTo} umpire${r.offeredTo === 1 ? '' : 's'}.`);
    }
    if (a === 'cancel-swap') act(() => api('POST', `/api/umpire/swap/${swap}/cancel`), 'Swap withdrawn. You\'re still on the game.');
    if (a === 'reconfirm-yes') act(() => api('POST', '/api/umpire/reconfirm', { gameId: game, slot, yes: true }), 'Thanks, you\'re confirmed for the new time.');
    if (a === 'reconfirm-no') {
      if (!(await confirmBox('Can\'t make the new time?', 'We\'ll take you off this game and open the spot to other umpires.', 'Take me off', true))) return;
      act(() => api('POST', '/api/umpire/reconfirm', { gameId: game, slot, yes: false }), 'Got it. You\'re off the game.');
    }
  };
}

// ── Umpire: my games ─────────────────────────────────────────────────────────
async function viewMine(main) {
  const d = await getBoard();
  const mine = d.board.filter(g => g.mine.length);
  const swaps = d.board.filter(g => !g.mine.length && SLOTS.some(k => g.slots[k].status === 'swap'));
  const needs = mine.filter(g => g.mine.some(k => g.slots[k].state === 'reconfirm')).length;
  setBadge('mine', needs, 'b-yellow');
  const dir = S.info.director;
  main.innerHTML = `
    <h2>My games</h2>
    <p class="sub">Need out of a game? Post a swap. You stay on the game until another umpire takes it.</p>
    ${mine.length ? `<div class="cards">${mine.map(g => g.mine.map(k => {
      const s = g.slots[k];
      let extra = '';
      if (s.state === 'reconfirm') extra = `<div class="note warn mt" style="margin-bottom:0">This game moved. Can you still make it? Answer by ${fmtStamp(s.reconfirmBy)} or the spot opens up.
        <div class="row mt"><button class="btn sm green" data-act="reconfirm-yes" data-game="${g.id}" data-slot="${k}">Yes, I'll be there</button><button class="btn sm ghost" data-act="reconfirm-no" data-game="${g.id}" data-slot="${k}">Can't make it</button></div></div>`;
      else if (s.swapId) extra = `<div class="row mt"><span class="badge b-yellow">Swap posted, waiting for a taker</span><button class="btn sm ghost" data-act="cancel-swap" data-swap="${s.swapId}">Withdraw swap</button></div>`;
      else extra = `<div class="row mt"><span class="badge b-navy">${LABEL[k]}</span><button class="btn sm ghost" data-act="swap" data-game="${g.id}" data-slot="${k}">Request swap</button></div>`;
      return gameCard(g, extra);
    }).join('')).join('')}</div>` : '<div class="empty">You don\'t have any upcoming games. Head to Open games to sign up.</div>'}
    ${swaps.length ? `<h3>Swaps other umpires posted</h3><div class="cards">${swaps.map(g => gameCard(g)).join('')}</div>` : ''}
    <div class="note info mt">Same-day emergency and nobody has taken your swap? Contact the Director of Umpires right away${dir ? `: <b>${esc(dir.name)}</b>${dir.mobile ? `, ${esc(dir.mobile)}` : ''} (${esc(dir.email)})` : ''}.</div>`;
  bindUmpireActions(main);
}

async function viewPay(main) {
  const d = await getBoard();
  const owed = d.pay.filter(p => p.status.startsWith('Confirmed')).reduce((t, p) => t + p.amount, 0);
  const paid = d.pay.filter(p => p.status === 'Paid').reduce((t, p) => t + p.amount, 0);
  main.innerHTML = `<h2>My pay</h2>
    <p class="sub">${money(d.payRate)} per game, paid by Venmo every two weeks once a coach confirms you worked the game.</p>
    <div class="stats"><div class="stat"><div class="n">${money(paid)}</div><div class="l">Paid so far</div></div>
      <div class="stat"><div class="n">${money(owed)}</div><div class="l">Coming in the next payout</div></div>
      <div class="stat"><div class="n">${d.pay.filter(p => p.status.startsWith('Waiting')).length}</div><div class="l">Waiting on a coach</div></div></div>
    ${d.pay.length ? `<div class="tbl-wrap"><table><tr><th>Game</th><th>Spot</th><th>Status</th><th class="num">Amount</th></tr>
      ${d.pay.map(p => `<tr><td>${esc(p.when)}<div class="small muted">${esc(p.division)}</div></td><td>${LABEL[p.slot]}</td>
        <td><span class="badge ${p.status === 'Paid' ? 'b-green' : p.status.startsWith('Confirmed') ? 'b-blue' : p.status.startsWith('Marked') ? 'b-red' : 'b-gray'}">${esc(p.status)}</span>${p.paidAt ? `<div class="small muted">${fmtStamp(p.paidAt)}</div>` : ''}</td>
        <td class="num">${p.amount ? money(p.amount) : '—'}</td></tr>`).join('')}</table></div>` : '<div class="empty">No games worked yet.</div>'}
    <p class="small muted mt">Venmo on file: ${esc(S.me.umpire.venmo || 'none')}. You can change it under My account.</p>`;
}

// ── Coach ────────────────────────────────────────────────────────────────────
async function viewCoach(main) {
  const d = await api('GET', '/api/coach/games');
  if (d.pending) {
    main.innerHTML = `<h2>My team's games</h2><div class="note warn">We couldn't match your email to a team on the coach list. An admin will link you to your team shortly.</div>`;
    return;
  }
  const toConfirm = d.games.filter(g => g.started && SLOTS.some(k => g.slots[k].umpire && !g.slots[k].worked));
  const done = d.games.filter(g => g.started && !toConfirm.includes(g));
  const upcoming = d.games.filter(g => !g.started).reverse();
  setBadge('coach', toConfirm.length);
  const confirmCard = g => `<div class="game" style="grid-template-columns:1fr">
    <div><div class="when">${fmtWhen(g.start)}</div><div class="what">${esc(g.division)} · ${esc(matchup(g))}</div><div class="where">${esc(g.field || '')}</div></div>
    <form data-confirm="${g.id}" style="display:grid;gap:10px">
      ${SLOTS.filter(k => g.slots[k].umpire).map(k => {
        const s = g.slots[k];
        const val = s.worked || 'worked';
        return `<div style="border-top:1px solid var(--line);padding-top:10px">
          <div class="spread"><div><span class="badge b-gray">${LABEL[k]}</span> <b>${esc(s.umpire)}</b></div>
            <div class="seg" data-seg="${k}">${[['worked', 'Worked'], ['noshow', 'No-show']].map(([v, l]) => `<button type="button" data-v="${v}" class="${val === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          <div class="row mt"><span class="small muted">Rate (optional, only the league sees this):</span>
            <span class="stars" data-stars="${k}" data-score="${s.myRating?.score || ''}">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" class="${(s.myRating?.score || 0) >= n ? 'on' : ''}">★</button>`).join('')}</span></div>
          <input name="comment-${k}" placeholder="Comment (optional)" class="mt" value="${esc(s.myRating?.comment || '')}">
        </div>`;
      }).join('')}
      <div><button class="btn">Save</button></div>
    </form></div>`;
  main.innerHTML = `<h2>My team's games</h2>
    <p class="sub">After each game, confirm the umpires showed up. That's what gets them paid, and one coach per game is enough. Ratings are optional and only the league sees them.</p>
    ${toConfirm.length ? `<h3>Needs confirming (${toConfirm.length})</h3><div class="cards">${toConfirm.map(confirmCard).join('')}</div>` : '<div class="note good">You\'re all caught up. Nothing to confirm.</div>'}
    ${upcoming.length ? `<h3>Upcoming</h3><div class="tbl-wrap"><table><tr><th>Game</th><th>Plate</th><th>Field</th></tr>${upcoming.map(g => `<tr><td><b>${fmtWhen(g.start)}</b><div class="small muted">${esc(matchup(g))} · ${esc(g.field || '')}</div></td>${SLOTS.map(k => `<td>${g.slots[k].umpire ? esc(g.slots[k].umpire) : '<span class="badge b-yellow">Open</span>'}</td>`).join('')}</tr>`).join('')}</table></div>` : ''}
    ${done.length ? `<h3>Confirmed</h3><div class="cards">${done.slice(0, 20).map(g => `<details class="game" style="display:block"><summary><b>${fmtWhen(g.start)}</b> · ${esc(matchup(g))} ${SLOTS.filter(k => g.slots[k].umpire).map(k => `<span class="badge ${g.slots[k].worked === 'worked' ? 'b-green' : 'b-red'}">${LABEL[k]}: ${g.slots[k].worked === 'worked' ? 'Worked' : 'No-show'}</span>`).join(' ')}</summary>
      ${SLOTS.some(k => g.slots[k].umpire && !g.slots[k].paid) ? confirmCard(g) : '<p class="small muted mt">Paid. Locked.</p>'}</details>`).join('')}</div>` : ''}`;
  main.onclick = e => {
    const segBtn = e.target.closest('[data-seg] button');
    if (segBtn) segBtn.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === segBtn));
    const star = e.target.closest('[data-stars] button');
    if (star) {
      const wrap = star.parentElement, n = +star.dataset.n;
      const cur = +wrap.dataset.score || 0;
      const next = cur === n ? 0 : n;
      wrap.dataset.score = next || '';
      wrap.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.n <= next));
    }
  };
  main.querySelectorAll('form[data-confirm]').forEach(f => f.onsubmit = async e => {
    e.preventDefault();
    const gameId = f.dataset.confirm;
    const results = {};
    f.querySelectorAll('[data-seg]').forEach(s => { results[s.dataset.seg] = s.querySelector('.on').dataset.v; });
    try {
      await api('POST', '/api/coach/confirm', { gameId, results });
      for (const s of f.querySelectorAll('[data-stars]')) {
        const score = +s.dataset.score;
        if (score && results[s.dataset.stars] === 'worked') await api('POST', '/api/coach/rate', { gameId, slot: s.dataset.stars, score, comment: f.querySelector(`[name="comment-${s.dataset.stars}"]`).value });
      }
      toast('Saved. Thanks, coach.');
      loadTab();
    } catch (err) { toast(err.message, true); }
  });
}

// ── Admin: coverage ──────────────────────────────────────────────────────────
const covBadge = c => ({ Covered: 'b-green', Confirmed: 'b-green', Open: 'b-red', 'Not requested': 'b-red', 'Needs reconfirm': 'b-yellow', Requested: 'b-yellow', Cancelled: 'b-gray' }[c] || 'b-gray');

async function viewCoverage(main) {
  const d = S.cache.ov = await api('GET', '/api/admin/overview');
  const f = S.filters.cov;
  setBadge('people', d.counts.approvals + d.counts.coaches);
  setBadge('cov', d.counts.open);
  const weeks = [...new Set(d.games.filter(g => !g.past).map(g => g.week))].sort();
  const divisions = [...new Set(d.games.map(g => g.division))].sort();
  const q = f.q.toLowerCase();
  const games = d.games.filter(g => {
    if (f.week === 'upcoming' && g.past) return false;
    if (f.week === 'past' && !g.past) return false;
    if (!['upcoming', 'past', 'all'].includes(f.week) && g.week !== f.week) return false;
    if (f.division && g.division !== f.division) return false;
    if (f.track && g.track !== f.track) return false;
    if (f.status === 'unconfirmed') { if (!(g.track === 'student' && g.past && g.status !== 'cancelled' && SLOTS.some(k => g.slots[k].umpireId && !g.slots[k].worked))) return false; }
    else if (f.status && g.coverage !== f.status) return false;
    if (q && !`${g.summary} ${g.field} ${g.division} ${g.slots ? SLOTS.map(k => g.slots[k].name).join(' ') : ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  if (f.week === 'past') games.reverse();
  const reconfirm = d.games.filter(g => !g.past && g.coverage === 'Needs reconfirm').length;
  const patchedOpen = d.games.filter(g => !g.past && g.track === 'patched' && g.status !== 'cancelled' && g.patchedStatus !== 'Confirmed').length;
  main.innerHTML = `
    <div class="spread"><div><h2>Coverage</h2><p class="sub">Last schedule sync: ${d.lastRun ? `${fmtStamp(d.lastRun.at)}${d.lastRun.errors?.length ? ' <span class="badge b-red">had errors</span>' : ''}` : 'never'}</p></div>
      <div class="row"><button class="btn ghost sm" data-act="add-game">Add game</button><button class="btn sm" data-act="sync">Sync now</button></div></div>
    <div class="stats">
      <div class="stat click" data-quick="Open"><div class="n ${d.counts.open ? 'bad' : ''}">${d.counts.open}</div><div class="l">Farm games still needing umpires</div></div>
      <div class="stat click" data-quick="Needs reconfirm"><div class="n">${reconfirm}</div><div class="l">Waiting on reconfirm</div></div>
      <div class="stat click" data-quick="unconfirmed"><div class="n">${d.counts.unconfirmed}</div><div class="l">Played, not confirmed by coach</div></div>
      <div class="stat click" data-quick="patched"><div class="n">${patchedOpen}</div><div class="l">Patched games not confirmed</div></div>
    </div>
    ${d.swaps.length ? `<div class="note warn"><b>Open swaps:</b> ${d.swaps.map(s => { const g = d.games.find(x => x.id === s.gameId); return g ? `${esc(s.fromName || s.fromId)} (${LABEL[s.slot]}, ${fmtWhen(g.start)}) <button class="link" data-act="admin-cancel-swap" data-swap="${s.id}">withdraw</button>` : ''; }).filter(Boolean).join(' · ')}</div>` : ''}
    <div class="filters">
      <select id="c-week"><option value="upcoming">All upcoming</option><option value="past">Past games</option><option value="all">Everything</option>${weeks.map(w => `<option value="${w}">${weekLabel(w)}</option>`).join('')}</select>
      <select id="c-div"><option value="">All divisions</option>${divisions.map(x => `<option>${esc(x)}</option>`).join('')}</select>
      <select id="c-track"><option value="">Farm + patched</option><option value="student">Farm (student umps)</option><option value="patched">Patched umps</option></select>
      <select id="c-status"><option value="">Any status</option>${['Open', 'Covered', 'Needs reconfirm', 'Not requested', 'Requested', 'Confirmed', 'Cancelled'].map(s => `<option>${s}</option>`).join('')}<option value="unconfirmed">Not confirmed by coach</option></select>
      <input id="c-q" placeholder="Search team, field, umpire" value="${esc(f.q)}">
    </div>
    ${games.length ? Object.entries(groupBy(games, g => g.week)).map(([wk, list]) => `<section class="week"><div class="week-h"><b>${weekLabel(wk)}</b><span class="small muted">${list.length} game${list.length > 1 ? 's' : ''}</span></div>${list.map(adminRow).join('')}</section>`).join('')
      : `<div class="empty">${d.games.length ? 'No games match these filters.' : 'No games yet. Upload your SportsEngine schedule under Schedule sync.'}</div>`}`;
  for (const [id, key] of [['c-week', 'week'], ['c-div', 'division'], ['c-track', 'track'], ['c-status', 'status']]) {
    $('#' + id).value = f[key];
    $('#' + id).onchange = e => { f[key] = e.target.value; viewCoverage(main); };
  }
  let t; $('#c-q').oninput = e => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; viewCoverage(main).then(() => { const el = $('#c-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); }, 300); };
  main.querySelectorAll('[data-quick]').forEach(el => el.onclick = () => {
    const v = el.dataset.quick;
    Object.assign(f, { division: '', q: '' });
    if (v === 'patched') Object.assign(f, { week: 'upcoming', track: 'patched', status: '' });
    else if (v === 'unconfirmed') Object.assign(f, { week: 'past', track: 'student', status: 'unconfirmed' });
    else Object.assign(f, { week: 'upcoming', track: 'student', status: v });
    viewCoverage(main);
  });
  main.onclick = adminCoverageClick;
  main.onchange = async e => {
    const sel = e.target.closest('[data-patched]');
    if (sel) act(() => api('POST', `/api/admin/games/${sel.dataset.patched}/patched`, { status: sel.value }), 'Saved.');
  };
}

function adminRow(g) {
  let body = '';
  if (g.track === 'student' && g.slots) {
    body = SLOTS.map(k => {
      const s = g.slots[k];
      const who = s.umpireId ? `<b>${esc(s.name)}</b>` : `<span class="badge ${s.urgent ? 'b-red' : 'b-yellow'}">${s.urgent ? 'Urgent opening' : 'Open'}</span>`;
      const state = s.state === 'reconfirm' ? ` <span class="badge b-yellow">reconfirm by ${fmtStamp(s.reconfirmBy)}</span>` : '';
      const swap = s.swapId ? ' <span class="badge b-blue">swap posted</span>' : '';
      const worked = g.past && s.umpireId ? ` <span class="badge ${s.worked === 'worked' ? 'b-green' : s.worked === 'noshow' ? 'b-red' : 'b-gray'}">${s.worked === 'worked' ? 'worked' : s.worked === 'noshow' ? 'no-show' : 'not confirmed'}</span>${s.paidPayoutId ? ' <span class="badge b-green">paid</span>' : ''}` : '';
      const acts = g.status === 'cancelled' ? '' : g.past
        ? (s.umpireId && !s.paidPayoutId ? `<button class="link" data-act="admin-worked" data-game="${g.id}" data-slot="${k}">mark…</button>` : '')
        : `<button class="link" data-act="assign" data-game="${g.id}" data-slot="${k}">${s.umpireId ? 'change' : 'assign'}</button>
           ${s.umpireId ? `<button class="link" data-act="unassign" data-game="${g.id}" data-slot="${k}">remove</button>` : ''}
           <button class="link" data-act="urgent" data-game="${g.id}" data-slot="${k}" style="color:var(--red)">urgent</button>`;
      return `<div class="aslot"><span class="k">${LABEL[k]}</span>${who}${state}${swap}${worked} ${acts}</div>`;
    }).join('');
  } else if (g.track === 'patched' && g.status !== 'cancelled') {
    body = `<div class="aslot"><span class="k">Assignor</span>
      <select data-patched="${g.id}" style="width:auto;padding:4px 8px;font-size:12px">${['Not requested', 'Requested', 'Confirmed'].map(s => `<option ${g.patchedStatus === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      ${g.patchedMoved ? '<span class="badge b-yellow">moved: re-notify assignor</span>' : ''}
      <button class="link" data-act="patched-note" data-game="${g.id}">${g.patchedNote ? esc(g.patchedNote) : 'add note'}</button></div>`;
  }
  return `<div class="arow ${g.status === 'cancelled' ? 'game cancelled' : ''}" style="${g.status === 'cancelled' ? 'opacity:.6' : ''}">
    <div><div class="when">${fmtWhen(g.start)}</div><div class="small muted">${esc(g.field || 'Field TBD')}</div></div>
    <div><div class="what"><b>${esc(g.division)}</b> · ${esc(matchup(g))} ${g.track === 'patched' ? '<span class="badge b-gray">patched</span>' : ''} ${g.movedAt && g.status !== 'cancelled' ? '<span class="badge b-yellow">moved</span>' : ''}</div>
      ${body}
      ${g.cancelReason ? `<div class="small muted">${esc(g.cancelReason)}</div>` : ''}
      ${g.history?.length ? `<details class="mt"><summary>History</summary><div class="hist">${g.history.slice().reverse().map(h => `<div>${fmtStamp(h.at)} · ${esc(h.what)}</div>`).join('')}</div></details>` : ''}</div>
    <div class="acts"><span class="badge ${covBadge(g.coverage)}">${esc(g.coverage)}</span>
      ${g.status !== 'cancelled' && !g.past ? `<button class="link" data-act="cancel-game" data-game="${g.id}">cancel game</button>` : ''}</div>
  </div>`;
}

async function adminCoverageClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const { act: a, game, slot } = b.dataset;
  const d = S.cache.ov;
  const g = d.games.find(x => x.id === game);
  if (a === 'sync') { b.disabled = true; b.textContent = 'Syncing…'; return act(() => api('POST', '/api/admin/sync'), syncMsg).catch(() => {}); }
  if (a === 'add-game') return addGameModal();
  if (a === 'admin-cancel-swap') return act(() => api('POST', `/api/admin/swaps/${b.dataset.swap}/cancel`), 'Swap withdrawn.');
  if (a === 'assign') return assignModal(g, slot);
  if (a === 'unassign') {
    if (await confirmBox('Remove umpire?', `Take ${esc(g.slots[slot].name)} off ${LABEL[slot].toLowerCase()} for ${fmtWhen(g.start)}? They'll get an email. The spot will show as open, but other umpires won't be alerted unless you post an urgent opening.`, 'Remove', true))
      act(() => api('POST', `/api/admin/games/${game}/assign`, { slot, umpireId: null }), 'Removed.');
  }
  if (a === 'urgent') {
    if (await confirmBox('Post an urgent opening?', `${g.slots[slot].umpireId ? `This takes <b>${esc(g.slots[slot].name)}</b> off the game, then ` : 'This '}emails and texts every umpire who can take ${LABEL[slot].toLowerCase()} for ${fmtWhen(g.start)}. First to sign up gets it.`, 'Post urgent opening', true))
      act(() => api('POST', `/api/admin/games/${game}/urgent`, { slot }), 'Urgent opening sent.');
  }
  if (a === 'cancel-game') {
    if (await confirmBox('Cancel this game?', `Use this for games that aren't in SportsEngine (games added by hand). If the game is in SportsEngine, cancel it there and the nightly sync will pick it up. Assigned umpires will be told.`, 'Cancel game', true))
      act(() => api('POST', `/api/admin/games/${game}/cancel`), 'Game cancelled.');
  }
  if (a === 'patched-note') {
    modal('Assignor note', `<label>Note (umpire names, assignor reply)<input name="note" value="${esc(g.patchedNote || '')}"></label>`,
      v => act(() => api('POST', `/api/admin/games/${game}/patched`, { status: g.patchedStatus, note: v.note }), 'Saved.'));
  }
  if (a === 'admin-worked') {
    modal(`Did ${first(g.slots[slot].name)} work this game?`, `<p class="small muted">${fmtWhen(g.start)} · ${esc(matchup(g))}</p>
      <label class="mt">Result<select name="r"><option value="worked">Worked</option><option value="noshow">No-show</option></select></label>`,
      v => act(() => api('POST', `/api/admin/games/${game}/confirm`, { results: { [slot]: v.r } }), 'Saved.'));
  }
}

function syncMsg(r) {
  if (r.message) return r.message;
  const c = r.counts || {};
  const bits = [['new', 'new'], ['moved', 'moved'], ['cancelled', 'cancelled'], ['reinstated', 'back on']].filter(([k]) => c[k]).map(([k, l]) => `${c[k]} ${l}`);
  return `Sync done${bits.length ? ': ' + bits.join(', ') : ', no changes'}.${r.errors?.length ? ' Some feeds had errors, see Schedule sync.' : ''}`;
}

function assignModal(g, slot) {
  const umps = S.cache.ov.people.filter(p => p.umpire && p.umpire.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const other = g.slots[slot === 'plate' ? 'field' : 'plate'].umpireId;
  const opts = umps.filter(p => p.email !== other).map(p => `<option value="${esc(p.email)}" ${g.slots[slot].umpireId === p.email ? 'selected' : ''}>${esc(p.name || p.email)}${slot === 'plate' && !p.umpire.plateQualified ? ' (not plate-qualified)' : ''}${!p.umpire.approved ? ' (not approved)' : ''}${!p.registered ? ' (hasn\'t signed up)' : ''}</option>`).join('');
  modal(`Assign ${LABEL[slot].toLowerCase()} umpire`, `<p class="small muted">${fmtWhen(g.start)} · ${esc(g.division)} · ${esc(matchup(g))}</p>
    <label class="mt">Umpire<select name="u" required><option value="">Choose…</option>${opts}</select></label>
    <p class="small muted mt">Admins can override the weekly limit and other rules. You'll be warned first.</p>`, async v => {
    try { await api('POST', `/api/admin/games/${g.id}/assign`, { slot, umpireId: v.u }); }
    catch (e) {
      if (!e.data?.needsForce) throw e;
      $('#modal-root').innerHTML = '';
      if (!(await confirmBox('Assign anyway?', `${esc(e.message)}<br><br>Assign them anyway?`, 'Assign anyway'))) return false;
      await api('POST', `/api/admin/games/${g.id}/assign`, { slot, umpireId: v.u, force: true });
    }
    toast('Assigned. They\'ve been notified.');
    loadTab();
  }, { submitLabel: 'Assign' });
}

function addGameModal() {
  modal('Add a game by hand', `<p class="small muted">For games that aren't in SportsEngine (makeups, scrimmages). Games in SportsEngine come in on their own.</p>
    <div class="grid2 mt">
      <label>Date and start time<input name="start" type="datetime-local" required></label>
      <label>Division<input name="division" required placeholder="Farm 8"></label>
      <label>Home team<input name="home"></label>
      <label>Away team<input name="away"></label>
      <label>Field<input name="field" placeholder="Quarry Hills Field A"></label>
      <label>Umpires<select name="track"><option value="student">Student umpires (sign-up)</option><option value="patched">Patched (assignor)</option></select></label>
    </div>
    <label class="check mt"><input type="checkbox" name="announce" checked> Tell umpires the spots are open</label>`, v => {
    // datetime-local is Eastern wall-clock; convert using the browser's offset for that date in New York.
    const start = easternToIso(v.start);
    return act(() => api('POST', '/api/admin/games', { ...v, start, announce: !!v.announce }), 'Game added.');
  }, { submitLabel: 'Add game' });
}

function easternToIso(local) {
  const [d, t] = local.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, day, hh, mm);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(guess)).map(x => [x.type, x.value]));
  const off = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - guess;
  return new Date(guess - off).toISOString();
}

// ── Admin: people ────────────────────────────────────────────────────────────
async function viewPeople(main) {
  const d = S.cache.ov = await api('GET', '/api/admin/overview');
  const ppl = d.people.slice().sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  const umps = ppl.filter(p => p.umpire), coaches = ppl.filter(p => p.coach);
  const waitingUmps = umps.filter(p => p.registered && !p.umpire.approved);
  const waitingCoaches = coaches.filter(p => p.registered && p.coach.pending);
  setBadge('people', waitingUmps.length + waitingCoaches.length);
  const yn = (ok, label = ok ? 'Yes' : 'No') => `<span class="badge ${ok ? 'b-green' : 'b-gray'}">${label}</span>`;
  main.innerHTML = `
    <div class="spread"><div><h2>People</h2><p class="sub">Umpires on your list are approved the moment they sign up. Coaches on your list are linked to their team automatically.</p></div>
      <div class="row"><button class="btn ghost sm" data-act="add-person">Add one person</button><button class="btn sm" data-act="upload">Upload lists (CSV)</button></div></div>
    ${waitingUmps.length ? `<div class="note warn"><b>Umpires waiting for approval</b> (not on your list):<div class="mt" style="display:grid;gap:6px">${waitingUmps.map(p => `<div class="spread"><span>${esc(p.name)} · ${esc(p.email)} · parent ${esc(p.umpire.parentName)}</span><span class="row"><button class="btn sm green" data-act="approve" data-email="${esc(p.email)}">Approve</button><button class="btn sm ghost" data-act="remove" data-email="${esc(p.email)}">Remove</button></span></div>`).join('')}</div></div>` : ''}
    ${waitingCoaches.length ? `<div class="note warn"><b>Coaches who need a team</b> (email wasn't on the coach list):<div class="mt" style="display:grid;gap:6px">${waitingCoaches.map(p => `<div class="spread"><span>${esc(p.name)} · ${esc(p.email)}</span><button class="btn sm" data-act="teams" data-email="${esc(p.email)}">Link team</button></div>`).join('')}</div></div>` : ''}
    <h3>Umpires (${umps.length})</h3>
    ${umps.length ? `<div class="tbl-wrap"><table><tr><th>Name</th><th>Contact</th><th>Parent</th><th>Venmo</th><th>Signed up</th><th>Approved</th><th>Plate</th><th>Active</th><th></th></tr>
      ${umps.map(p => `<tr><td><b>${esc(p.name || '—')}</b>${p.isAdmin ? ' <span class="badge b-navy">admin</span>' : ''}</td>
        <td class="small">${esc(p.email)}<br>${esc(p.mobile || '')}</td>
        <td class="small">${esc(p.umpire.parentName || '')}<br>${esc(p.umpire.parentEmail || '')}<br>${esc(p.umpire.parentMobile || '')}</td>
        <td class="small">${esc(p.umpire.venmo || '')}</td>
        <td>${yn(p.registered)}</td>
        <td><button class="link" data-act="toggle" data-email="${esc(p.email)}" data-k="approved">${yn(p.umpire.approved)}</button></td>
        <td><button class="link" data-act="toggle" data-email="${esc(p.email)}" data-k="plateQualified">${yn(p.umpire.plateQualified)}</button></td>
        <td><button class="link" data-act="toggle" data-email="${esc(p.email)}" data-k="active">${yn(p.umpire.active !== false)}</button></td>
        <td class="small" style="white-space:nowrap">${p.registered ? `<button class="link" data-act="reset" data-email="${esc(p.email)}">reset PIN</button> · ` : ''}<button class="link" data-act="remove" data-email="${esc(p.email)}">remove</button></td></tr>`).join('')}
    </table></div>` : '<div class="empty">No umpires yet. Upload your umpire list to get started.</div>'}
    <p class="small muted mt">Tap Yes/No to flip it. New umpires can only take field spots until you mark them plate-qualified.</p>
    <h3>Coaches (${coaches.length})</h3>
    ${coaches.length ? `<div class="tbl-wrap"><table><tr><th>Name</th><th>Contact</th><th>Team(s)</th><th>Signed up</th><th></th></tr>
      ${coaches.map(p => `<tr><td><b>${esc(p.name || '—')}</b>${p.isAdmin ? ' <span class="badge b-navy">admin</span>' : ''}</td><td class="small">${esc(p.email)}<br>${esc(p.mobile || '')}</td>
        <td>${(p.coach.teams || []).map(t => `${esc(t.team)} <span class="small muted">${esc(t.division)}</span>`).join('<br>') || '<span class="badge b-yellow">none</span>'}</td>
        <td>${yn(p.registered)}</td>
        <td class="small" style="white-space:nowrap"><button class="link" data-act="teams" data-email="${esc(p.email)}">edit teams</button>${p.registered ? ` · <button class="link" data-act="reset" data-email="${esc(p.email)}">reset PIN</button>` : ''} · <button class="link" data-act="remove" data-email="${esc(p.email)}">remove</button></td></tr>`).join('')}
    </table></div>` : '<div class="empty">No coaches yet. Upload your head coach list.</div>'}`;
  main.onclick = async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const p = ppl.find(x => x.email === b.dataset.email);
    const a = b.dataset.act;
    if (a === 'upload') return uploadModal();
    if (a === 'add-person') return addPersonModal();
    if (a === 'approve') return act(() => api('PUT', `/api/admin/people/${encodeURIComponent(p.email)}`, { umpire: { approved: true } }), `${first(p.name)} approved.`);
    if (a === 'toggle') {
      const k = b.dataset.k;
      const cur = k === 'active' ? p.umpire.active !== false : !!p.umpire[k];
      return act(() => api('PUT', `/api/admin/people/${encodeURIComponent(p.email)}`, { umpire: { [k]: !cur } }), 'Saved.');
    }
    if (a === 'reset') {
      if (await confirmBox('Reset PIN?', `${esc(p.name)} will sign up again with the same email to choose a new PIN. Their games, ratings and pay history stay.`, 'Reset PIN'))
        act(() => api('POST', `/api/admin/people/${encodeURIComponent(p.email)}/reset-pin`), r => r.message);
    }
    if (a === 'remove') {
      if (await confirmBox('Remove this person?', `Remove ${esc(p.name || p.email)} from the app? Past games and ratings keep their record.`, 'Remove', true))
        act(() => api('DELETE', `/api/admin/people/${encodeURIComponent(p.email)}`), 'Removed.');
    }
    if (a === 'teams') return teamsModal(p);
  };
}

function uploadModal() {
  const form = modal('Upload lists', `<p class="small muted">Export from SportsEngine or a spreadsheet and save as CSV. The first row must be the column names. Uploading again updates people already in the app and never touches anyone's PIN.</p>
    <label class="mt">Which list?<select name="kind"><option value="umpires">Umpires</option><option value="coaches">Head coaches</option></select></label>
    <p class="small mt" id="cols"></p>
    <label class="mt">CSV file<input type="file" name="file" accept=".csv,text/csv"></label>
    <label class="mt">…or paste it<textarea name="csv" placeholder="name,email,..."></textarea></label>`, async (v, f) => {
    let text = v.csv;
    const file = f.querySelector('[name=file]').files[0];
    if (file) text = await file.text();
    if (!text?.trim()) throw new Error('Choose a file or paste the list.');
    const r = await api('POST', `/api/admin/roster/${v.kind}`, { csv: text });
    toast(`${r.added} added, ${r.updated} updated${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}.`);
    if (r.skipped.length) setTimeout(() => modal('Some rows were skipped', `<div class="mono">${r.skipped.map(esc).join('\n')}</div>`), 50);
    loadTab();
  }, { submitLabel: 'Upload' });
  const cols = { umpires: 'Columns: <b>name, email, mobile, parent_name, parent_email, parent_mobile, venmo, plate_qualified</b> (yes/no). Only name and email are required; umpires fill in the rest when they sign up.', coaches: 'Columns: <b>name, email, mobile, team, division</b>. One row per team. Team names should match how they appear in SportsEngine.' };
  const kind = form.querySelector('[name=kind]');
  const show = () => { form.querySelector('#cols').innerHTML = cols[kind.value]; };
  kind.onchange = show; show();
}

function addPersonModal() {
  const form = modal('Add one person', `<div class="seg" id="ap-role"><button type="button" data-v="umpire" class="on">Umpire</button><button type="button" data-v="coach">Coach</button></div>
    <input type="hidden" name="role" value="umpire">
    <div class="grid2 mt"><label>Name<input name="name" required></label><label>Email<input name="email" type="email" required></label>
    <label>Mobile<input name="mobile"></label><span></span></div>
    <div id="ap-ump" class="mt"><label class="check"><input type="checkbox" name="plateQualified"> Plate-qualified</label></div>
    <div id="ap-coach" class="grid2 mt" hidden><label>Team<input name="team"></label><label>Division<input name="division" placeholder="Farm 8"></label></div>
    <p class="small muted mt">They'll still sign up themselves with this email to set a PIN.</p>`, v =>
    act(() => api('POST', '/api/admin/people', { ...v, plateQualified: !!v.plateQualified }), 'Added.'), { submitLabel: 'Add' });
  form.querySelector('#ap-role').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    form.querySelectorAll('#ap-role button').forEach(x => x.classList.toggle('on', x === b));
    form.querySelector('[name=role]').value = b.dataset.v;
    form.querySelector('#ap-ump').hidden = b.dataset.v !== 'umpire';
    form.querySelector('#ap-coach').hidden = b.dataset.v !== 'coach';
  };
}

function teamsModal(p) {
  const teams = (p.coach?.teams || []).concat([{ team: '', division: '' }]);
  const row = (t, i) => `<div class="grid2"><label>Team<input name="team${i}" value="${esc(t.team)}"></label><label>Division<input name="div${i}" value="${esc(t.division)}"></label></div>`;
  modal(`Teams for ${p.name || p.email}`, `<p class="small muted">Use the team name as it appears in SportsEngine. Leave a row blank to remove it.</p><div style="display:grid;gap:8px" class="mt">${teams.map(row).join('')}</div>`, v => {
    const out = teams.map((_, i) => ({ team: v['team' + i]?.trim(), division: v['div' + i]?.trim() })).filter(t => t.team);
    return act(() => api('PUT', `/api/admin/people/${encodeURIComponent(p.email)}`, { coach: { teams: out } }), 'Teams saved.');
  });
}

// ── Admin: ratings ───────────────────────────────────────────────────────────
async function viewRatings(main) {
  const d = await api('GET', '/api/admin/ratings');
  const rows = d.rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const avg = (v, n) => v == null ? '<span class="muted">—</span>' : `<b>${v.toFixed(1)}</b> <span class="small muted">(${n})</span>`;
  main.innerHTML = `<h2>Ratings</h2>
    <p class="sub">Admins only. Umpires and coaches never see these. Both coaches can rate the same game, so a score that only one team gives stands out. No-shows are logged here automatically; nothing happens to an umpire's account on its own.</p>
    ${rows.length ? `<div class="tbl-wrap"><table><tr><th>Umpire</th><th class="num">This season</th><th class="num">All time</th><th class="num">No-shows (season / all)</th><th class="num">Games worked (season / all)</th><th></th></tr>
      ${rows.map(r => `<tr><td><b>${esc(r.name)}</b></td><td class="num">${avg(r.seasonAvg, r.seasonCount)}</td><td class="num">${avg(r.allTimeAvg, r.allTimeCount)}</td>
        <td class="num">${r.noShowsSeason ? `<span class="badge b-red">${r.noShowsSeason}</span>` : 0} / ${r.noShows}</td><td class="num">${r.gamesWorkedSeason} / ${r.gamesWorked}</td>
        <td>${r.ratings.length ? `<button class="link" data-r="${esc(r.email)}">details</button>` : ''}</td></tr>`).join('')}</table></div>` : '<div class="empty">No umpires yet.</div>'}`;
  main.onclick = e => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    const r = rows.find(x => x.email === b.dataset.r);
    modal(`${r.name}: all feedback`, `<div class="tbl-wrap"><table><tr><th>Game</th><th>From</th><th class="num">Score</th></tr>${r.ratings.map(x => `<tr><td class="small">${esc(x.game)}<div class="muted">${LABEL[x.slot]} · ${esc(x.season)}</div></td><td class="small">${esc(x.coachName)}${x.coachTeam ? `<div class="muted">${esc(x.coachTeam)}</div>` : ''}</td>
      <td class="num">${x.noShow ? '<span class="badge b-red">No-show</span>' : '★'.repeat(x.score)}${x.comment && !x.noShow ? `<div class="small muted" style="text-align:left">${esc(x.comment)}</div>` : ''}</td></tr>`).join('')}</table></div>`);
  };
}

// ── Admin: payouts ───────────────────────────────────────────────────────────
async function viewPayouts(main, end) {
  const [rep, hist] = await Promise.all([api('GET', `/api/admin/payouts/preview${end ? `?end=${end}` : ''}`), api('GET', '/api/admin/payouts')]);
  main.innerHTML = `<h2>Payouts</h2>
    <p class="sub">${money(rep.payRate)} per game. Only games a coach marked Worked are paid. Unconfirmed games are held and roll into the next payout once confirmed.</p>
    <div class="filters"><label class="check">Pay period ending <input type="date" id="p-end" value="${rep.periodEnd}" style="width:auto"></label>
      <span class="small muted" style="align-self:center">${keyLabel(rep.periodStart)} – ${keyLabel(rep.periodEnd)} (and anything older not yet paid)</span></div>
    <div class="stats"><div class="stat"><div class="n">${money(rep.total)}</div><div class="l">To pay (${rep.lines.length} umpire${rep.lines.length === 1 ? '' : 's'})</div></div>
      <div class="stat"><div class="n ${rep.held.length ? 'bad' : ''}">${rep.held.length}</div><div class="l">Games held (no coach confirmation yet)</div></div></div>
    ${rep.lines.length ? `<div class="tbl-wrap"><table><tr><th>Umpire</th><th>Venmo</th><th class="num">Games</th><th class="num">Amount</th></tr>
      ${rep.lines.map(l => `<tr><td><b>${esc(l.name)}</b><div class="small muted">${l.games.map(g => `${esc(keyLabel(g.date))} ${LABEL[g.slot].toLowerCase()}`).join(', ')}</div></td><td>${esc(l.venmo || '—')}</td><td class="num">${l.games.length}</td><td class="num"><b>${money(l.amount)}</b></td></tr>`).join('')}
      <tr><td colspan="3"><b>Total</b></td><td class="num"><b>${money(rep.total)}</b></td></tr></table></div>
      <div class="row mt"><a class="btn ghost" href="/api/admin/payouts/csv?end=${rep.periodEnd}">Download CSV</a><button class="btn" id="p-pay">I've sent these Venmo payments: mark paid</button></div>`
      : '<div class="empty">Nothing to pay for this period.</div>'}
    ${rep.held.length ? `<h3>Held until a coach confirms</h3><div class="tbl-wrap"><table><tr><th>Game</th><th>Umpire</th></tr>${rep.held.map(h => `<tr><td>${esc(h.when)}<div class="small muted">${esc(h.game)}</div></td><td>${esc(h.name)} <span class="small muted">${LABEL[h.slot]}</span></td></tr>`).join('')}</table></div>` : ''}
    <h3>Paid</h3>
    ${hist.payouts.length ? `<div class="tbl-wrap"><table><tr><th>Period</th><th>Marked paid</th><th class="num">Umpires</th><th class="num">Total</th><th></th></tr>${hist.payouts.map(p => `<tr><td>${keyLabel(p.periodStart)} – ${keyLabel(p.periodEnd)}</td><td>${fmtStamp(p.paidAt)}<div class="small muted">${esc(p.by)}</div></td><td class="num">${p.lines.length}</td><td class="num">${money(p.total)}</td><td><a class="link" href="/api/admin/payouts/csv?id=${p.id}">CSV</a></td></tr>`).join('')}</table></div>` : '<p class="muted small">No payouts yet.</p>'}`;
  $('#p-end').onchange = e => viewPayouts(main, e.target.value);
  const pay = $('#p-pay');
  if (pay) pay.onclick = async () => {
    if (!(await confirmBox('Mark this period paid?', `This locks ${rep.lines.reduce((t, l) => t + l.games.length, 0)} games (${money(rep.total)}) as paid so they won't show up again. Do this after you've sent the Venmo payments.`, 'Mark paid'))) return;
    try { await api('POST', '/api/admin/payouts/pay', { end: rep.periodEnd }); toast('Marked paid.'); viewPayouts(main, rep.periodEnd); }
    catch (e) { toast(e.message, true); }
  };
}

// ── Admin: schedule sync ─────────────────────────────────────────────────────
async function viewSync(main) {
  const [st, log, up] = await Promise.all([api('GET', '/api/admin/settings'), api('GET', '/api/admin/synclog'), api('GET', '/api/admin/schedule-upload')]);
  const last = log.runs[0];
  const changeBadge = { new: 'b-blue', moved: 'b-yellow', cancelled: 'b-red', removed: 'b-red', reinstated: 'b-green' };
  const test = S.info.testMode;
  const linkFeeds = st.feeds.filter(f => !f.url.startsWith('upload:'));
  main.innerHTML = `<div class="spread"><div><h2>Schedule sync</h2><p class="sub">Games come from SportsEngine: an uploaded schedule export, a calendar feed link, or both. The app checks again every night and whenever you tap Sync now.</p></div><button class="btn" id="s-now">Sync now</button></div>
    <h3>Upload the schedule from SportsEngine HQ</h3>
    <p class="small muted">In SportsEngine HQ, export the season's game schedule as CSV and upload it here. Upload a fresh export whenever games change: moved and cancelled games are picked up just like a feed, and umpires on moved games are asked to reconfirm.</p>
    ${up.uploadedAt ? `<p class="small mt">Current upload: <b>${esc(up.filename || 'schedule')}</b> · ${fmtStamp(up.uploadedAt)} by ${esc(up.by)} · ${esc(up.season)}${up.shiftDays ? ` · <span class="badge b-yellow">dates moved ${up.shiftDays} days for testing</span>` : ''}</p>` : ''}
    <form id="upload" class="mt" style="display:grid;gap:10px;max-width:640px">
      <div class="row"><input type="file" name="file" accept=".csv,.ics,text/csv,text/calendar" style="flex:2;min-width:220px"><input name="season" value="${esc(up.season || st.seasonLabel)}" placeholder="Season" style="flex:1;min-width:120px"></div>
      ${test ? `<label>Move dates forward by this many days (test copy only)<input name="shiftDays" type="number" value="${esc(up.shiftDays || 0)}" style="max-width:160px"><span class="small muted" style="font-weight:400">Use a multiple of 7 to keep games on the same weekday. 217 turns April 11, 2026 into Saturday, November 14.</span></label>` : ''}
      <textarea name="text" placeholder="…or paste the file's contents here" style="min-height:70px"></textarea>
      <div><button class="btn sm">Upload and sync</button></div>
    </form>
    ${test ? `<div class="note warn mt"><b>Test copy.</b> Start over with a clean slate: <button class="link" id="t-reset">clear all practice games, people and messages</button> (admins and settings stay).</div>` : ''}
    <h3>Calendar feed links (optional)</h3>
    <p class="small muted">If a team or league calendar in SportsEngine offers Subscribe, paste its iCal link here.</p>
    <form id="feeds" style="display:grid;gap:8px" class="mt">
      ${linkFeeds.concat([{ url: '', season: st.seasonLabel }]).map((f, i) => `<div class="row"><input name="url${i}" value="${esc(f.url)}" placeholder="webcal://… or https://…ics" style="flex:3;min-width:220px"><input name="season${i}" value="${esc(f.season)}" placeholder="Season" style="flex:1;min-width:120px"></div>`).join('')}
      <div><button class="btn ghost sm">Save feeds</button></div>
    </form>
    ${last ? `<h3>Last sync · ${fmtStamp(last.at)} <span class="small muted">by ${esc(last.by)}</span></h3>
      <div class="row">${Object.entries(last.counts).map(([k, v]) => `<span class="badge ${v && changeBadge[k] ? changeBadge[k] : 'b-gray'}">${v} ${k}</span>`).join('')}</div>
      ${last.errors.map(e => `<div class="note bad mt">${esc(e)}</div>`).join('')}
      ${last.warnings.map(e => `<div class="note warn mt">${esc(e)}</div>`).join('')}
      ${last.counts.unsorted ? `<div class="note warn mt"><b>${last.counts.unsorted} event${last.counts.unsorted > 1 ? 's' : ''} didn't match a division</b>, so they were left out. Examples: ${last.unsortedSamples.map(s => `"${esc(s)}"`).join(', ')}. Fix this by adding the coach for that team on the People page, or a sorting rule under Settings.</div>` : ''}` : '<div class="empty mt">No syncs yet.</div>'}
    <h3>What changed</h3>
    ${log.changes.length ? `<div class="tbl-wrap"><table><tr><th>When</th><th>Change</th><th>Game</th><th>Before → after</th></tr>${log.changes.slice(0, 200).map(c => `<tr><td class="small">${fmtStamp(c.at)}</td><td><span class="badge ${changeBadge[c.change] || 'b-gray'}">${esc(c.change)}</span></td><td class="small">${esc(c.summary)}<div class="muted">${c.start ? fmtWhen(c.start) : ''}</div></td>
      <td class="small">${c.before ? `${fmtWhen(c.before.start)} · ${esc(c.before.field || '')}<br>→ ${fmtWhen(c.after.start)} · ${esc(c.after.field || '')}` : ''}</td></tr>`).join('')}</table></div>` : '<p class="muted small">Nothing yet.</p>'}`;
  $('#s-now').onclick = async e => { e.target.disabled = true; e.target.textContent = 'Syncing…'; try { toast(syncMsg(await api('POST', '/api/admin/sync'))); } catch (err) { toast(err.message, true); } viewSync(main); };
  $('#upload').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const file = f.querySelector('[name=file]').files[0];
    const text = file ? await file.text() : f.querySelector('[name=text]').value;
    if (!text.trim()) return toast('Choose the exported file first.', true);
    const btn = f.querySelector('.btn'); btn.disabled = true; btn.textContent = 'Uploading…';
    try {
      const r = await api('POST', '/api/admin/schedule-upload', { text, filename: file?.name || 'pasted schedule', season: f.season.value, shiftDays: f.shiftDays ? Number(f.shiftDays.value) : 0 });
      toast(syncMsg(r));
    } catch (err) { toast(err.message, true); }
    viewSync(main);
  };
  const reset = $('#t-reset');
  if (reset) reset.onclick = async () => {
    if (!(await confirmBox('Clear the test copy?', 'This deletes every practice game, umpire, coach, rating, payout and message on the test copy. Admin accounts and settings stay. The real app is not touched.', 'Clear test data', true))) return;
    try { await api('POST', '/api/admin/test/reset', {}); toast('Test copy cleared.'); } catch (err) { toast(err.message, true); }
    viewSync(main);
  };
  $('#feeds').onsubmit = async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target));
    const feeds = [];
    for (let i = 0; `url${i}` in v; i++) if (v[`url${i}`].trim()) feeds.push({ url: v[`url${i}`].trim(), season: v[`season${i}`].trim() || st.seasonLabel });
    feeds.push(...st.feeds.filter(f => f.url.startsWith('upload:')));
    try { await api('PUT', '/api/admin/settings', { feeds }); toast('Feeds saved. Tap Sync now to pull games.'); viewSync(main); } catch (err) { toast(err.message, true); }
  };
}

// ── Admin: messages ──────────────────────────────────────────────────────────
async function viewMessages(main, filter = '') {
  const d = await api('GET', '/api/admin/outbox');
  const notSent = d.messages.filter(m => m.status !== 'sent');
  const emailOff = d.messages.some(m => m.status === 'not sent (email not set up)');
  const textOff = d.messages.find(m => m.channel === 'text' && m.status.startsWith('not sent'));
  const list = filter ? d.messages.filter(m => filter === 'problems' ? m.status !== 'sent' : m.channel === filter) : d.messages;
  main.innerHTML = `<h2>Messages</h2><p class="sub">Every email and text the app sends, newest first. Parents get a copy of everything sent to their umpire.</p>
    ${emailOff ? '<div class="note warn">Email isn\'t connected yet, so messages are logged here but not delivered. See the setup guide (README) for the Gmail app password step.</div>' : ''}
    ${textOff ? `<div class="note info">Texts are not going out: ${esc(textOff.status.replace('not sent ', ''))}. Emails still go out. Texts start once Twilio registration is approved and you switch texts on in Settings.</div>` : ''}
    <div class="filters"><select id="m-f"><option value="">All (${d.messages.length})</option><option value="email">Email</option><option value="text">Text</option><option value="problems">Not delivered (${notSent.length})</option></select></div>
    ${list.length ? `<div class="tbl-wrap"><table><tr><th>When</th><th>To</th><th>Message</th><th>Status</th></tr>${list.map(m => `<tr><td class="small" style="white-space:nowrap">${fmtStamp(m.at)}<div class="muted">${esc(m.channel)}</div></td><td class="small">${esc(m.to)}</td>
      <td class="small"><details><summary>${esc(m.subject || m.body.slice(0, 70))}</summary><div class="mono mt">${esc(m.body)}</div></details></td>
      <td><span class="badge ${m.status === 'sent' ? 'b-green' : m.status === 'failed' ? 'b-red' : 'b-gray'}">${esc(m.status)}</span>${m.error ? `<div class="small muted">${esc(m.error)}</div>` : ''}</td></tr>`).join('')}</table></div>` : '<div class="empty">No messages yet.</div>'}`;
  $('#m-f').value = filter;
  $('#m-f').onchange = e => viewMessages(main, e.target.value);
}

// ── Admin: settings ──────────────────────────────────────────────────────────
async function viewSettings(main) {
  const s = await api('GET', '/api/admin/settings');
  const num = (k, l, hint = '') => `<label>${l}<input name="${k}" type="number" value="${esc(s[k])}">${hint ? `<span class="small muted" style="font-weight:400">${hint}</span>` : ''}</label>`;
  const hours = k => `<select name="${k}">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${+s[k] === h ? 'selected' : ''}>${new Date(Date.UTC(2020, 0, 1, h)).toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric' })}</option>`).join('')}</select>`;
  main.innerHTML = `<h2>Settings</h2><p class="sub">Changes apply right away.</p>
  <form id="set" class="form" style="max-width:640px">
    <fieldset><legend>Season</legend><div class="grid2">
      <label>Season name<input name="seasonLabel" value="${esc(s.seasonLabel)}"><span class="small muted" style="font-weight:400">Ratings roll up per season by this name.</span></label>
      ${num('weeklyCap', 'Games per umpire per week', 'Mon–Sun')}
    </div></fieldset>
    <fieldset><legend>Pay</legend><div class="grid2">
      ${num('payRate', 'Pay per game ($)')}
      <label>First payout period starts<input name="payoutAnchor" type="date" value="${esc(s.payoutAnchor)}"><span class="small muted" style="font-weight:400">Pick a Monday. Periods run every ${s.payoutDays} days from here.</span></label>
    </div></fieldset>
    <fieldset><legend>People</legend>
      <label>Board admins (up to 4, comma separated)<input name="adminEmails" value="${esc(s.adminEmails.join(', '))}"></label>
      <label>Director of Umpires email<input name="directorEmail" type="email" value="${esc(s.directorEmail)}"><span class="small muted" style="font-weight:400">Gets emergencies and coverage alerts, along with the admins. Shown to umpires as the emergency contact.</span></label>
    </fieldset>
    <fieldset><legend>Reminders and alerts (Eastern time)</legend><div class="grid2">
      <label>Sunday weekly schedule at${hours('weeklyReminderHour')}</label>
      <label>Day-before reminder at${hours('dayBeforeHour')}</label>
      <label>Daily coach confirm nudge at${hours('coachNudgeHour')}</label>
      ${num('reconfirmHours', 'Hours to reconfirm a moved game')}
      ${num('gapAlertHours', 'Coverage alert window (hours)')}
      ${num('defaultGameMinutes', 'Game length if the feed has none (min)')}
    </div>
    <label class="check"><input type="checkbox" name="textsEnabled" ${s.textsEnabled ? 'checked' : ''}> Send texts (turn on once Twilio registration is approved)</label>
    <label>App link used in messages<input name="appUrl" value="${esc(s.appUrl)}" placeholder="https://…run.app"></label>
    </fieldset>
    <details><summary>Advanced: how feed games are sorted into divisions</summary>
      <p class="small muted mt">Checked top to bottom; the first match wins. <b>pattern</b> is matched against the game title. <b>track</b> is student (Farm, two student umpires), patched (assignor) or skip (no umpires). Division "$0" means use the matched text (for example 9A).</p>
      <textarea name="rules" style="min-height:260px">${esc(JSON.stringify(s.rules, null, 2))}</textarea>
    </details>
    <div class="row"><button class="btn">Save settings</button><button type="button" class="btn ghost" id="run-jobs">Run reminders and alerts now</button></div>
  </form>`;
  $('#set').onsubmit = async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target));
    const body = {
      seasonLabel: v.seasonLabel.trim(), payoutAnchor: v.payoutAnchor, appUrl: v.appUrl.trim(), directorEmail: v.directorEmail.trim().toLowerCase(),
      adminEmails: v.adminEmails.split(/[,\s]+/).filter(Boolean), textsEnabled: !!v.textsEnabled
    };
    for (const k of ['weeklyCap', 'payRate', 'reconfirmHours', 'gapAlertHours', 'defaultGameMinutes', 'weeklyReminderHour', 'dayBeforeHour', 'coachNudgeHour']) body[k] = Number(v[k]);
    if (body.adminEmails.length > 4) return toast('Four admin seats at most.', true);
    if (!body.adminEmails.includes(S.me.email) && !(await confirmBox('Remove yourself as admin?', 'Your email is not in the admin list, so you\'ll lose access to these pages.', 'Save anyway', true))) return;
    try { body.rules = JSON.parse(v.rules); } catch (_) { return toast('The sorting rules aren\'t valid JSON.', true); }
    try { await api('PUT', '/api/admin/settings', body); toast('Settings saved.'); boot(); } catch (err) { toast(err.message, true); }
  };
  $('#run-jobs').onclick = async () => {
    try { const r = await api('POST', '/api/admin/run-jobs'); toast(`Done. Reminders: ${r.dayBefore}, weekly: ${r.weekly}, alerts: ${r.gapAlerts}, coach nudges: ${r.coachNudges}.`); } catch (e) { toast(e.message, true); }
  };
}

// ── Account ──────────────────────────────────────────────────────────────────
function viewAccount(main) {
  const m = S.me, u = m.umpire;
  main.innerHTML = `<h2>My account</h2><p class="sub">${esc(m.email)}${m.isAdmin ? ' · board admin' : ''}${u ? ` · umpire${u.plateQualified ? ' (plate + field)' : ' (field)'}` : ''}${m.coach ? ` · coach${m.coach.teams.length ? `: ${m.coach.teams.map(t => esc(t.team)).join(', ')}` : ''}` : ''}</p>
    <form id="acct" class="form">
      <div class="grid2"><label>Name<input name="name" value="${esc(m.name)}"></label><label>Mobile<input name="mobile" value="${esc(m.mobile || '')}"></label></div>
      ${u ? `<fieldset><legend>Parent or guardian</legend><div class="grid2"><label>Name<input name="parentName" value="${esc(u.parentName || '')}"></label><label>Mobile<input name="parentMobile" value="${esc(u.parentMobile || '')}"></label></div>
        <label>Email<input name="parentEmail" type="email" value="${esc(u.parentEmail || '')}"></label></fieldset>
        <label>Venmo<input name="venmo" value="${esc(u.venmo || '')}"></label>` : ''}
      <label>New PIN (leave blank to keep yours)<input name="newPin" inputmode="numeric" pattern="\\d{4,6}" autocomplete="new-password"></label>
      <div><button class="btn">Save</button></div>
    </form>`;
  $('#acct').onsubmit = async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target));
    if (!v.newPin) delete v.newPin;
    try { const r = await api('PUT', '/api/me', v); S.me = r.me; toast('Saved.'); renderShell(); viewAccount(main); } catch (err) { toast(err.message, true); }
  };
}

boot().catch(e => { $('#main').innerHTML = `<div class="note bad">Couldn't load the app: ${esc(e.message)}</div>`; });
