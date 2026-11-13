// My account screen.
import { $, esc, SLOTS, LABEL, S, api, toast, fmtDay, fmtTime, fmtWhen, fmtStamp, keyLabel, weekLabel, matchup, first, money, groupBy, modal, confirmBox } from './core.js';
import { renderShell } from './nav.js';

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

export { viewAccount };
