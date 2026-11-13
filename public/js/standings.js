// Standings and playoff brackets.
import { $, esc, SLOTS, LABEL, S, api, toast, fmtDay, fmtTime, fmtWhen, fmtStamp, keyLabel, weekLabel, matchup, first, money, groupBy, modal, confirmBox } from './core.js';
import { loadTab } from './nav.js';

// ── Standings and playoffs ────────────────────────────────────────────────────
const DIVISIONS = ['Farm 8', 'Farm 9', 'Minors', 'Majors', 'Babe Ruth'];
function canManageDiv(division) {
  return !!(S.me && (S.me.isAdmin || (S.me.director && (S.me.director.divisions || []).includes(division))));
}
function managesAsActive(division) {
  return (S.activeRole === 'admin' || S.activeRole === 'director') && canManageDiv(division);
}
function pctStr(v) { return v >= 1 ? '1.000' : Number(v || 0).toFixed(3).replace(/^0/, ''); }
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
// Teams that share a rank are tied and need a coin toss.
function tieClusters(rows) {
  const by = {};
  (rows || []).forEach(r => { (by[r.rank] || (by[r.rank] = [])).push(r); });
  return Object.values(by).filter(c => c.length > 1);
}

async function viewStandings(main) {
  const d = await api('GET', '/api/standings');
  const divs = Object.keys(d.standings || {}).sort((a, b) => DIVISIONS.indexOf(a) - DIVISIONS.indexOf(b));
  main.innerHTML = `<h2>Standings</h2><p class="sub">Win percentage; a tie counts as half a win. Families see standings on SportsEngine — this is the league's working view.</p>${divs.length ? '<div id="st-body"></div>' : '<div class="empty">No final scores yet. Standings appear once games are played.</div>'}`;
  const body = $('#st-body');
  if (!body) return;
  body.innerHTML = divs.map(div => standingsTable(div, d.standings[div])).join('');
  body.querySelectorAll('[data-tiebreak]').forEach(b => { b.onclick = () => toast('Tiebreakers: head-to-head, then fewest runs allowed all season, then a coin toss recorded by the director.'); });
  body.querySelectorAll('[data-toss]').forEach(b => { b.onclick = () => coinTossModal(b.dataset.toss, JSON.parse(b.dataset.teams)); });
}
function standingsTable(div, rows) {
  const manage = managesAsActive(div);
  const ties = tieClusters(rows);
  return `<h3>${esc(div)}</h3>
    <div class="tbl-wrap"><table><tr><th>#</th><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num">T</th><th class="num">Win%</th><th class="num">RA</th></tr>
    ${rows.map(r => `<tr><td>${r.rank}</td><td><b>${esc(r.team)}</b></td><td class="num">${r.wins}</td><td class="num">${r.losses}</td><td class="num">${r.ties}</td><td class="num">${pctStr(r.winPct)}</td><td class="num">${r.runsAllowed}</td></tr>`).join('')}
    </table></div>
    <div class="row mt"><button class="link" data-tiebreak="1">How ties are broken</button></div>
    ${ties.map(c => `<div class="note warn mt"><b>Tie for ${ordinal(c[0].rank)}:</b> ${c.map(r => esc(r.team)).join(', ')}.${manage ? ` <button class="btn sm" data-toss="${esc(div)}" data-teams='${esc(JSON.stringify(c.map(r => r.team)))}'>Record coin toss</button>` : ' Your division director records the coin toss.'}</div>`).join('')}`;
}
function coinTossModal(division, teams) {
  modal(`Coin toss — ${esc(division)}`, `<p class="small muted">Put the tied teams in the finishing order the coin toss decided. First = higher seed.</p><div id="ct-list">${orderListHTML(teams)}</div>`, async () => {
    const order = [...document.querySelectorAll('#ct-list [data-team]')].map(x => x.dataset.team);
    await api('POST', '/api/admin/standings/coin-toss', { division, order });
    toast('Coin toss recorded.'); loadTab();
  }, { submitLabel: 'Save order' });
  wireOrderList($('#modal-root'));
}

// A small up/down reorder list used for coin tosses and seeds.
function orderListHTML(items) {
  return `<ul class="ol">${items.map((t, i) => `<li data-team="${esc(t)}"><span class="ol-pos">${i + 1}</span><span class="ol-name">${esc(t)}</span><span class="ol-btns"><button type="button" class="link" data-up aria-label="Move up">▲</button><button type="button" class="link" data-down aria-label="Move down">▼</button></span></li>`).join('')}</ul>`;
}
function wireOrderList(root) {
  const ul = (root || document).querySelector('.ol');
  if (!ul) return;
  ul.addEventListener('click', e => {
    const li = e.target.closest('li'); if (!li) return;
    if (e.target.closest('[data-up]') && li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling);
    else if (e.target.closest('[data-down]') && li.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li);
    else return;
    [...ul.children].forEach((x, i) => { x.querySelector('.ol-pos').textContent = i + 1; });
  });
}

// Playoffs: seeds (editable by the director) and the bracket as it plays out.
async function viewBrackets(main) {
  const divs = S.me.isAdmin ? DIVISIONS.slice() : ((S.me.director && S.me.director.divisions) || []);
  if (!divs.length) { main.innerHTML = `<h2>Playoffs</h2><div class="empty">No divisions to manage.</div>`; return; }
  if (!S.bracketDiv || !divs.includes(S.bracketDiv)) S.bracketDiv = divs[0];
  main.innerHTML = `<h2>Playoffs</h2><p class="sub">Every team qualifies; the higher seed is home. Seeds come from the standings — adjust them before the games are played. Playoff games are uploaded with the schedule and drive the bracket.</p>
    <div class="filters"><select id="br-div">${divs.map(x => `<option ${x === S.bracketDiv ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
    <div id="br-body"><p class="muted">Loading…</p></div>`;
  $('#br-div').onchange = e => { S.bracketDiv = e.target.value; viewBrackets(main); };
  const body = $('#br-body');
  let d;
  try { d = await api('GET', `/api/admin/bracket?division=${encodeURIComponent(S.bracketDiv)}`); }
  catch (e) { body.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; return; }
  body.innerHTML = bracketHTML(d);
  const edit = $('#br-seeds'); if (edit) edit.onclick = () => seedsModal(d.division, d.seeds);
}
function bracketHTML(d) {
  const fmt = d.format === 'double' ? '6-team double elimination' : 'single elimination';
  let h = `<div class="spread"><div class="small muted">${esc(d.division)} · ${fmt}</div>${d.seeds && d.seeds.length ? `<button class="btn sm ghost" id="br-seeds">Edit seed order</button>` : ''}</div>`;
  if (d.seeds && d.seeds.length) h += `<h3>Seeds</h3><ol class="seedlist">${d.seeds.map(t => `<li>${esc(t)}</li>`).join('')}</ol>`;
  if (!d.ready) { h += `<div class="note warn mt">${esc(d.note || 'Not enough teams to build the bracket yet.')}</div>`; return h; }
  if (d.champion) h += `<div class="note good mt">🏆 Champion: <b>${esc(d.champion)}</b></div>`;
  h += bracketTree(d);
  return h;
}
function bracketTree(d) {
  const matches = d.matches || [];
  const groups = d.format === 'double'
    ? [["Winners' bracket", matches.filter(m => m.bracket === 'W')], ["Losers' bracket", matches.filter(m => m.bracket === 'L')], ['Championship', matches.filter(m => m.bracket === 'GF')]]
    : [['Bracket', matches]];
  return groups.map(([label, ms]) => {
    if (!ms.length) return '';
    const rounds = {};
    ms.forEach(m => { (rounds[m.round] || (rounds[m.round] = [])).push(m); });
    const cols = Object.keys(rounds).sort((a, b) => a - b).map(r => `<div class="br-col">${rounds[r].map(matchCard).join('')}</div>`).join('');
    return `<h3>${esc(label)}</h3><div class="br-scroll">${cols}</div>`;
  }).join('');
}
function matchCard(m) {
  if (m.needed === false && !m.played) return `<div class="bm muted-card"><div class="bm-name">${esc(m.name || '')}</div><div class="small muted">Only if needed</div></div>`;
  const side = (seed, team, win) => `<div class="bm-side ${win ? 'win' : ''}">${seed != null ? `<span class="seedn">${seed}</span>` : '<span class="seedn blank"></span>'}<span>${team ? esc(team) : 'TBD'}</span></div>`;
  if (m.bye) return `<div class="bm done"><div class="bm-name">${esc(m.name || ('Round ' + m.round))}</div>${side(m.winnerSeed, m.winner, true)}<div class="bm-status">Bye — advances</div></div>`;
  const status = m.played ? 'Final' : m.ready ? 'Ready to play' : 'Waiting';
  return `<div class="bm ${m.played ? 'done' : m.ready ? 'ready' : 'pending'}">
    <div class="bm-name">${esc(m.name || ('Round ' + m.round))}</div>
    ${side(m.homeSeed, m.home, m.winner && m.winner === m.home)}
    ${side(m.awaySeed, m.away, m.winner && m.winner === m.away)}
    <div class="bm-status">${status}</div></div>`;
}
function seedsModal(division, seeds) {
  modal(`Seed order — ${esc(division)}`, `<p class="small muted">Use the arrows to reorder. Seed 1 is the top team and is home every round.</p><div id="seed-list">${orderListHTML(seeds)}</div>`, async () => {
    const order = [...document.querySelectorAll('#seed-list [data-team]')].map(x => x.dataset.team);
    await api('POST', '/api/admin/bracket/seeds', { division, order });
    toast('Seed order saved.'); viewBrackets($('#main'));
  }, { submitLabel: 'Save seeds' });
  wireOrderList($('#modal-root'));
}


export { viewStandings, viewBrackets, tieClusters };
