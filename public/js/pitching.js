// Pitch counts: logging, pre-game eligibility ("who can pitch"), and the
// director's alert list. Logging always saves — the engine warns, never blocks.
import { $, esc, S, api, toast, modal, keyLabel, fmtStamp } from './core.js';

const outsToInnings = o => `${Math.floor((o || 0) / 3)}${['', '⅓', '⅔'][(o || 0) % 3] || ''}`;
function gameStarted(g) { return g.started != null ? g.started : (g.past != null ? g.past : new Date(g.start) <= Date.now()); }

// Warning text from the last log, shown once on the next render (warn-never-block).
let lastWarn = null;

// Fill the #gd-pitch container inside the game detail with the pitch log and the
// "who can pitch" eligibility for both teams.
async function renderPitching(container, g, side, manage) {
  const sec = container.querySelector('#gd-pitch');
  if (!sec) return;
  sec.innerHTML = `<div class="gd-sec"><h3>Pitch counts</h3><p class="muted small">Loading…</p></div>`;
  let elig, log = null;
  try {
    elig = await api('GET', `/api/games/${g.id}/eligibility`);
    if (manage) log = (await api('GET', `/api/admin/games/${g.id}/pitchlog`)).log;
  } catch (e) {
    sec.innerHTML = `<div class="gd-sec"><h3>Pitch counts</h3><div class="note bad">${esc(e.message)}</div></div>`;
    return;
  }
  const warn = lastWarn; lastWarn = null;
  sec.innerHTML =
    `<div class="gd-sec">${pitchLogBlock(g, elig, log, side, manage, warn)}</div>` +
    `<div class="gd-sec">${eligibilityBlock(elig)}</div>`;
  const btn = sec.querySelector('#pitch-log-btn');
  if (btn) btn.onclick = () => pitchLogModal(container, g, elig, side, manage);
}

function pitchLogBlock(g, elig, log, side, manage, warn) {
  const started = gameStarted(g);
  const canLog = started && (manage || side === 'home' || side === 'away');
  let h = `<div class="spread"><h3>Pitch log</h3>${canLog ? `<button class="btn sm" id="pitch-log-btn">Log a pitcher</button>` : ''}</div>`;
  if (warn) h += `<div class="note warn">${esc(warn)}</div>`;
  if (!started) { h += `<p class="small muted">Pitch counts open once the game has started.</p>`; return h; }
  if (manage && log) {
    h += log.length ? `<div class="sclist mt">${log.map(logRow).join('')}</div>` : `<p class="small muted">No pitchers logged yet.</p>`;
  } else {
    const mine = side === 'home' ? elig.home : side === 'away' ? elig.away : null;
    const pitched = mine ? mine.pitchers.filter(p => p.pitchedToday > 0) : [];
    h += pitched.length
      ? `<div class="sclist mt">${pitched.map(p => `<div class="scrow static"><span class="scrow-main"><b>${esc(p.name)}</b><span class="small muted block">${p.pitchedToday} pitches today</span></span></div>`).join('')}</div>`
      : `<p class="small muted">No pitchers logged yet for your team.</p>`;
  }
  return h;
}
function logRow(e) {
  const badge = e.violation ? '<span class="badge b-red">Violation</span>'
    : e.dailyStatus === 'check-finished-batter' ? '<span class="badge b-yellow">Check</span>'
    : '<span class="badge b-green">OK</span>';
  return `<div class="scrow static"><span class="scrow-main"><b>${esc(e.playerName)}</b> <span class="small muted">${esc(e.team)}</span><span class="small muted block">${e.pitches} pitches${e.outs != null ? ` · ${outsToInnings(e.outs)} innings` : ''}${e.suspended ? ' · suspended game' : ''}</span></span><span class="scrow-side">${badge}</span></div>`;
}

function eligibilityBlock(elig) {
  return `<h3>Who can pitch</h3><p class="small muted">As of ${esc(keyLabel(elig.date))}. Opponents included; read-only.</p>${[elig.home, elig.away].map(teamElig).join('')}`;
}
function teamElig(t) {
  if (!t.pitchers.length) return `<div class="mt"><b>${esc(t.team)}</b> <span class="small muted">— no roster uploaded</span></div>`;
  return `<div class="mt"><b>${esc(t.team)}</b><div class="elig mt">${t.pitchers.map(eligRow).join('')}</div></div>`;
}
function eligRow(p) {
  let badge, note = '';
  if (p.restingUntil) badge = `<span class="badge b-yellow">Resting until ${esc(keyLabel(p.restingUntil))}</span>`;
  else if (p.available) { badge = `<span class="badge b-green">Available</span>`; if (p.pitchesLeftToday != null) note = `${p.pitchesLeftToday} left today`; }
  else badge = `<span class="badge b-red">At limit today</span>`;
  return `<div class="elig-row"><span class="elig-name">${p.number ? `<span class="jersey">${esc(p.number)}</span>` : ''}${esc(p.name)}${p.leagueAge ? ` <span class="small muted">age ${p.leagueAge}</span>` : ''}</span><span class="elig-stat">${badge}${note ? ` <span class="small muted">${esc(note)}</span>` : ''}</span></div>`;
}

function pitchLogModal(container, g, elig, side, manage) {
  const teams = (manage ? [elig.home, elig.away] : [side === 'home' ? elig.home : side === 'away' ? elig.away : null]).filter(Boolean);
  const opts = teams.flatMap(t => t.pitchers.map(p => `<option value="${esc(p.id)}" data-age="${p.leagueAge || ''}">${esc(t.team)} — ${p.number ? '#' + esc(p.number) + ' ' : ''}${esc(p.name)}${p.leagueAge ? ` (age ${p.leagueAge})` : ''}</option>`)).join('');
  const form = modal('Log a pitcher', `
    <label>Pitcher<select name="playerId" required><option value="">Choose…</option>${opts}</select></label>
    <div class="grid2"><label>Pitches thrown<input name="pitches" type="number" inputmode="numeric" min="0" max="250" required></label>
      <div id="innings-wrap" style="display:none"><label>Innings (12-year-olds)</label><div class="row"><input name="innWhole" type="number" inputmode="numeric" min="0" max="12" style="max-width:80px" placeholder="0"><select name="innThirds" style="max-width:88px"><option value="0">+0</option><option value="1">+⅓</option><option value="2">+⅔</option></select></div></div></div>
    <label class="check"><input type="checkbox" name="suspended"> This was a suspended game</label>
    <p class="small muted">The count is always saved. If it breaks a rule you'll see a warning and the division director is notified.</p>`, async v => {
    const sel = form.querySelector('select[name=playerId]');
    const age = sel.selectedOptions[0] && sel.selectedOptions[0].dataset.age;
    const body = { gameId: g.id, playerId: v.playerId, pitches: Number(v.pitches), suspended: !!v.suspended };
    if (String(age) === '12') body.outs = (Number(v.innWhole) || 0) * 3 + (Number(v.innThirds) || 0);
    const r = manage ? await api('POST', `/api/admin/games/${g.id}/pitches`, body) : await api('POST', '/api/coach/pitches', body);
    lastWarn = pitchWarning(r);
    toast(lastWarn ? 'Saved — see the warning.' : 'Pitch count saved.', !!lastWarn);
    renderPitching(container, g, side, manage);
    return true;
  }, { submitLabel: 'Save count' });
  const sel = form.querySelector('select[name=playerId]');
  sel.onchange = () => { const age = sel.selectedOptions[0] && sel.selectedOptions[0].dataset.age; form.querySelector('#innings-wrap').style.display = String(age) === '12' ? 'block' : 'none'; };
}
function pitchWarning(r) {
  const msgs = [];
  if (r.check) {
    if (r.check.status === 'violation') msgs.push(`Over the daily max of ${r.check.max} by ${r.check.over}. Saved, and the director has been notified.`);
    else if (r.check.status === 'check-finished-batter') msgs.push(`At the daily max of ${r.check.max} (+${r.check.over}). Allowed only if finishing the batter.`);
  }
  if (r.weekly) {
    if (r.weekly.over) msgs.push(`${r.entry.team}'s 12-year-olds are over the ${outsToInnings(r.weekly.capOuts)}-inning weekly cap (now ${r.weekly.innings}).`);
    else if (r.weekly.near) msgs.push(`${r.entry.team}'s 12-year-olds are nearing the weekly cap (${r.weekly.innings} of ${outsToInnings(r.weekly.capOuts)} innings).`);
  }
  return msgs.length ? msgs.join(' ') : null;
}

// Director/admin dashboard: active pitch-count alerts in their division(s).
async function viewViolations(main) {
  const d = await api('GET', '/api/admin/pitching/violations');
  main.innerHTML = `<h2>Pitch alerts</h2><p class="sub">Active pitch-count problems in your division. Each is emailed once and clears when the count is fixed.</p>
    ${d.violations.length ? `<div class="sclist">${d.violations.map(v => `<div class="scrow static"><span class="scrow-main"><b>${esc(v.detail)}</b><span class="small muted block">${esc(v.division)} · ${esc(fmtStamp(v.at))}</span></span><span class="scrow-side"><span class="badge b-red">${v.kind === 'weekly' ? 'Weekly cap' : 'Daily max'}</span></span></div>`).join('')}</div>` : '<div class="empty">No active pitch-count problems.</div>'}`;
}

export { renderPitching, viewViolations };
