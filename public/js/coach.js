// Coach screen: confirm the umpires who worked.
import { $, esc, SLOTS, LABEL, S, api, toast, fmtDay, fmtTime, fmtWhen, fmtStamp, keyLabel, weekLabel, matchup, first, money, groupBy, modal, confirmBox } from './core.js';
import { setBadge, loadTab } from './nav.js';

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

export { viewCoach };
