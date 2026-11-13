// Field closures and rainouts (board admins only): close a field, several, or
// all of Quarry Hills for a day or a time window; see which games are hit before
// confirming; reopen to restore. The affected-games preview is computed here
// (mirroring the server's half-open overlap rule); the server is authoritative
// when you confirm.
import { $, esc, S, api, toast, modal, confirmBox, fmtWhen, fmtStamp } from './core.js';
import { loadTab } from './nav.js';
import { easternToIso } from './admin.js';

const TZ = 'America/New_York';
const normField = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const addDay = key => { const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const gameLine = g => `${g.division} · ${g.away && g.home ? `${g.away} at ${g.home}` : g.summary} — ${fmtWhen(g.start)} · ${g.field || 'field TBD'}`;

let CTX = { games: [], defMin: 120, fields: [] };

async function viewClosures(main) {
  const [clist, st, ov] = await Promise.all([
    api('GET', '/api/admin/closures'), api('GET', '/api/admin/settings'), api('GET', '/api/admin/overview')
  ]);
  CTX.games = (ov.games || []).filter(g => g.status === 'scheduled');
  CTX.defMin = st.defaultGameMinutes || 120;
  CTX.fields = [...new Set((ov.games || []).map(g => g.field).filter(Boolean))].sort();
  main.innerHTML = `<h2>Field closures &amp; rainouts</h2>
    <p class="sub">Close a field, several, or all of Quarry Hills for a day or a time window. Every game in the window is rained out — no score, no pitch log, no umpire pay, out of the standings — and both coaches, the assigned umpires and their parents are told.</p>
    <form id="cl-form" class="form" style="max-width:640px">
      <fieldset><legend>What to close</legend>
        <label class="check"><input type="radio" name="scope" value="all" checked> All of Quarry Hills</label>
        <label class="check"><input type="radio" name="scope" value="fields"> Specific fields</label>
        <div id="cl-fields" hidden style="padding-left:24px;display:grid;gap:4px">${CTX.fields.map(f => `<label class="check"><input type="checkbox" name="field" value="${esc(f)}"> ${esc(f)}</label>`).join('') || '<span class="small muted">No fields in the schedule yet.</span>'}</div>
      </fieldset>
      <fieldset><legend>When</legend>
        <label class="check"><input type="radio" name="when" value="day" checked> Whole day</label>
        <label class="check"><input type="radio" name="when" value="window"> A time window</label>
        <div class="grid2">
          <label>Date<input type="date" name="date" value="${todayKey()}"></label>
          <div id="cl-window" hidden><div class="grid2"><label>From<input type="time" name="from" value="09:00"></label><label>To<input type="time" name="to" value="15:00"></label></div></div>
        </div>
      </fieldset>
      <label>Reason<input name="reason" value="rainout"></label>
      <label>Note for families (optional)<textarea name="note" style="min-height:60px"></textarea></label>
      <div id="cl-preview" class="note info">Choose what and when to see which games are affected.</div>
      <div><button type="button" class="btn red" id="cl-go">Close and rain out these games</button></div>
    </form>
    <h3>Closures</h3>
    <div id="cl-list">${closuresList(clist.closures)}</div>`;
  const form = $('#cl-form');
  const refresh = () => {
    $('#cl-fields').hidden = form.scope.value !== 'fields';
    $('#cl-window').hidden = form.when.value !== 'window';
    renderPreview(form);
  };
  form.oninput = refresh;
  form.onchange = refresh;
  refresh();
  $('#cl-go').onclick = () => submitClosure(form, main);
  wireReopen(main);
}

function scopeFrom(form) {
  const all = form.scope.value === 'all';
  const fields = [...form.querySelectorAll('input[name=field]:checked')].map(x => normField(x.value));
  const date = form.date.value;
  if (!date) return null;
  const whole = form.when.value === 'day';
  let fromTs, toTs;
  if (whole) { fromTs = easternToIso(`${date}T00:00`); toTs = easternToIso(`${addDay(date)}T00:00`); }
  else {
    if (!form.from.value || !form.to.value) return null;
    fromTs = easternToIso(`${date}T${form.from.value}`); toTs = easternToIso(`${date}T${form.to.value}`);
  }
  return { all, fields, fromTs, toTs, whole, date };
}

function affectedGames(scope) {
  if (!scope || (!scope.all && !scope.fields.length)) return [];
  const cf = new Date(scope.fromTs).getTime(), ct = new Date(scope.toTs).getTime();
  return CTX.games.filter(g => {
    const f = normField(g.field);
    const onField = scope.all ? f.includes('quarry hills') : scope.fields.some(x => f.includes(x));
    if (!onField) return false;
    const gs = new Date(g.start).getTime();
    const ge = g.end ? new Date(g.end).getTime() : gs + CTX.defMin * 60000;
    return gs < ct && cf < ge; // half-open: a game ending exactly at the window start is safe
  }).sort((a, b) => a.start.localeCompare(b.start));
}

function renderPreview(form) {
  const scope = scopeFrom(form);
  const games = affectedGames(scope);
  const el = $('#cl-preview');
  if (!scope || (!scope.all && !scope.fields.length)) { el.className = 'note info'; el.textContent = 'Choose a field (or all of Quarry Hills) and a day.'; return; }
  if (!games.length) { el.className = 'note info'; el.textContent = 'No scheduled games fall in that window.'; return; }
  el.className = 'note warn';
  el.innerHTML = `<b>${games.length} game${games.length > 1 ? 's' : ''} will be rained out:</b><div class="hist mt">${games.map(g => `<div>${esc(gameLine(g))}</div>`).join('')}</div>`;
}

async function submitClosure(form, main) {
  const scope = scopeFrom(form);
  if (!scope || (!scope.all && !scope.fields.length)) return toast('Choose what to close and a day.', true);
  const games = affectedGames(scope);
  const chosen = [...form.querySelectorAll('input[name=field]:checked')].map(x => x.value);
  const what = scope.all ? 'all of Quarry Hills' : chosen.join(', ');
  if (!(await confirmBox('Close and rain these games out?', `This rains out <b>${games.length}</b> game${games.length === 1 ? '' : 's'} on ${esc(what)}. Coaches, umpires and their parents will be told, and the games leave the standings. You can reopen later.`, 'Rain them out', true))) return;
  const body = { all: scope.all, fields: scope.all ? [] : chosen, reason: form.reason.value.trim() || 'rainout', note: form.note.value.trim() };
  if (scope.whole) body.date = scope.date; else { body.from = scope.fromTs; body.to = scope.toTs; }
  try {
    const r = await api('POST', '/api/admin/closures', body);
    toast(`${r.affected} game${r.affected === 1 ? '' : 's'} rained out.`);
    showCommsNote(main, games.filter(g => (r.games || []).includes(g.id)), r);
  } catch (e) { toast(e.message, true); }
}

async function showCommsNote(main, games, r) {
  await viewClosures(main); // refresh the list first, so the note modal is the last thing rendered
  const note = `These games are rained out — please post to families in SportsEngine:\n\n${games.map(g => `• ${gameLine(g)}`).join('\n')}`;
  const extra = r.shiftsCancelled ? `<p class="small muted">${r.shiftsCancelled} Snack Shack shift${r.shiftsCancelled === 1 ? '' : 's'} that day were also cancelled.</p>` : '';
  modal('Rained out — note to post', `<p class="small muted">Copy this into SportsEngine for families. (The Communications Director was also emailed, if one is set.)</p><textarea id="cl-note-out" readonly style="min-height:150px">${esc(note)}</textarea>${extra}`, null);
  const foot = $('#modal-root .foot');
  if (foot && games.length) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.textContent = 'Copy note';
    b.onclick = async () => { try { await navigator.clipboard.writeText(note); toast('Copied.'); } catch (_) { const t = $('#cl-note-out'); if (t) { t.focus(); t.select(); } toast('Select the text to copy.', true); } };
    foot.appendChild(b);
  }
}

function closuresList(list) {
  if (!list.length) return '<div class="empty">No closures yet.</div>';
  return `<div class="sclist">${list.map(c => {
    const scope = c.all ? 'All of Quarry Hills' : (c.fields || []).join(', ');
    const n = (c.gameIds || []).length;
    return `<div class="scrow static"><span class="scrow-main"><b>${esc(scope)}</b> <span class="small muted">${esc(c.reason)}</span><span class="small muted block">${esc(fmtStamp(c.fromTs))} – ${esc(fmtStamp(c.toTs))} · ${n} game${n === 1 ? '' : 's'} · by ${esc(c.by)}</span>${c.reopenedAt ? `<span class="small muted block">Reopened ${esc(fmtStamp(c.reopenedAt))}</span>` : ''}</span><span class="scrow-side">${c.reopenedAt ? '<span class="badge b-gray">Reopened</span>' : `<button class="btn sm ghost" data-reopen="${esc(c.id)}">Reopen</button>`}</span></div>`;
  }).join('')}</div>`;
}

function wireReopen(main) {
  document.querySelectorAll('[data-reopen]').forEach(b => {
    b.onclick = async () => {
      if (!(await confirmBox('Reopen and put these games back on?', 'The rained-out games go back on the schedule, and the same coaches, umpires and parents are told.', 'Reopen'))) return;
      try { const r = await api('POST', `/api/admin/closures/${b.dataset.reopen}/reopen`); toast(`${r.restored} game${r.restored === 1 ? '' : 's'} back on.`); viewClosures(main); }
      catch (e) { toast(e.message, true); }
    };
  });
}

export { viewClosures };
