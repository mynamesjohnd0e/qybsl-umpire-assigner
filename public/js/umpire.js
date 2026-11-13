// Umpire screens: open games, my games, my pay.
import { $, esc, SLOTS, LABEL, S, api, toast, fmtDay, fmtTime, fmtWhen, fmtStamp, keyLabel, weekLabel, matchup, first, money, groupBy, modal, confirmBox } from './core.js';
import { setBadge, act } from './nav.js';

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

export { viewOpen, viewMine, viewPay, getBoard };
