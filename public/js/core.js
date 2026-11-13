// Shared helpers, browser state and UI primitives.

const TZ = 'America/New_York';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SLOTS = ['plate', 'field'];
const LABEL = { plate: 'Plate', field: 'Field' };

const S = { me: null, info: {}, tab: null, activeRole: null, game: null, gameFrom: null, bracketDiv: null, signup: false, role: 'umpire', cache: {}, filters: { umpire: { onlyMine: true, division: '' }, cov: { week: 'upcoming', division: '', track: '', status: '', q: '' } } };

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

export { TZ, $, esc, SLOTS, LABEL, S, api, toast, fmtDay, fmtTime, fmtWhen, fmtStamp, keyLabel, weekLabel, matchup, first, money, groupBy, modal, confirmBox };
