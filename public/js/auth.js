// Sign in / sign up screen.
import { $, esc, SLOTS, LABEL, S, api, toast, fmtDay, fmtTime, fmtWhen, fmtStamp, keyLabel, weekLabel, matchup, first, money, groupBy, modal, confirmBox } from './core.js';
import { boot, closeSheet, testBanner } from './nav.js';

function renderAuth() {
  $('#who').innerHTML = '';
  testBanner();
  document.body.classList.remove('signed-in');
  closeSheet();
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


export { renderAuth };
