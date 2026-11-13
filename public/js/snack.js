// Snack Shack — staff screen (Snack Shack Director or admin): post shifts, copy a
// week, and see who has signed up. Parents sign up on the separate public page.
import { $, esc, S, api, toast, modal } from './core.js';
import { loadTab } from './nav.js';

const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
function fmtTime(t) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim()); if (!m) return String(t || '').trim(); let h = +m[1]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${m[2]} ${ap}`; }
const timeRange = s => { const a = fmtTime(s.start), b = fmtTime(s.end); return a ? (b ? `${a}–${b}` : a) : ''; };
const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const addDays = (key, n) => { const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = key => { const d = new Date(key + 'T12:00:00Z'); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10); };

async function viewSnack(main) {
  const [d, st] = await Promise.all([api('GET', '/api/admin/snack'), api('GET', '/api/admin/settings')]);
  const link = (st.appUrl ? st.appUrl.replace(/\/$/, '') : '') + '/snack-shack';
  const shifts = d.shifts || [];
  main.innerHTML = `<div class="spread"><div><h2>Snack Shack</h2><p class="sub">Post shifts and see who's signed up. Parents sign up from the public link — no account needed.</p></div>
      <div class="row"><button class="btn ghost sm" id="sn-copy">Copy a week</button><button class="btn sm" id="sn-add">Add shift</button></div></div>
    <div class="note info">Public sign-up link: <b>${esc(link)}</b> <button class="link" id="sn-link">copy</button></div>
    ${shifts.length ? `<div class="sclist">${shifts.map(shiftRow).join('')}</div>` : '<div class="empty">No shifts yet. Add one, or copy a previous week.</div>'}`;
  $('#sn-add').onclick = () => addShiftModal(main);
  $('#sn-copy').onclick = () => copyWeekModal(main);
  $('#sn-link').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Link copied.'); } catch (_) { toast('Select and copy the link.', true); } };
}

function shiftRow(s) {
  const badge = s.cancelled ? '<span class="badge b-gray">Cancelled</span>'
    : s.spotsLeft > 0 ? `<span class="badge b-yellow">${s.spotsLeft} open</span>`
    : '<span class="badge b-green">Full</span>';
  return `<div class="scrow static" style="flex-direction:column;align-items:stretch;gap:6px">
    <div class="spread"><span class="scrow-main"><b>${esc(fmtDate(s.date))}</b> <span class="small muted">${esc(timeRange(s))}</span><span class="small muted block">${esc(s.title || 'Snack Shack')}${s.location ? ` · ${esc(s.location)}` : ''} · ${s.filled}/${s.peopleNeeded} filled</span></span><span>${badge}</span></div>
    ${s.volunteers && s.volunteers.length ? `<div class="hist">${s.volunteers.map(v => `<div>${esc(v.name)} · ${esc(v.email)}${v.mobile ? ` · ${esc(v.mobile)}` : ''}</div>`).join('')}</div>` : '<div class="small muted">No sign-ups yet.</div>'}
  </div>`;
}

function addShiftModal(main) {
  modal('Add a shift', `<label>Date<input name="date" type="date" value="${todayKey()}" required></label>
    <div class="grid2"><label>Start<input name="start" type="time" value="09:00"></label><label>End<input name="end" type="time" value="12:00"></label></div>
    <div class="grid2"><label>People needed<input name="peopleNeeded" type="number" inputmode="numeric" min="1" value="2" required></label><label>Title<input name="title" value="Snack Shack"></label></div>
    <label>Location<input name="location" placeholder="e.g. Quarry Hills"></label>`, async v => {
    await api('POST', '/api/admin/snack/shifts', { date: v.date, start: v.start, end: v.end, peopleNeeded: Number(v.peopleNeeded), title: v.title, location: v.location });
    toast('Shift added.'); viewSnack(main);
  }, { submitLabel: 'Add shift' });
}

function copyWeekModal(main) {
  const thisMon = mondayOf(todayKey()), lastMon = addDays(thisMon, -7);
  modal('Copy a week of shifts', `<p class="small muted">Copies every shift from one week to another, keeping the weekday and time. Pick any day in each week.</p>
    <div class="grid2"><label>From the week of<input name="from" type="date" value="${lastMon}" required></label><label>To the week of<input name="to" type="date" value="${thisMon}" required></label></div>`, async v => {
    const r = await api('POST', '/api/admin/snack/copy-week', { fromMonday: mondayOf(v.from), toMonday: mondayOf(v.to) });
    toast(`${r.copied} shift${r.copied === 1 ? '' : 's'} copied.`); viewSnack(main);
  }, { submitLabel: 'Copy shifts' });
}

export { viewSnack };
