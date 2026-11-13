// Scores: the role-aware list, the game-detail screen and the score actions.
import { $, esc, SLOTS, LABEL, S, api, toast, fmtDay, fmtTime, fmtWhen, fmtStamp, keyLabel, weekLabel, matchup, first, money, groupBy, modal, confirmBox } from './core.js';
import { go, loadTab, renderBottomNav } from './nav.js';

// ── Scores: list, game detail and the score actions ───────────────────────────
function hasStarted(g) { return g.started != null ? g.started : (g.past != null ? g.past : new Date(g.start) <= Date.now()); }
// Does this game need an action from the signed-in coach?
function coachNeeds(g) {
  const st = g.score ? g.score.status : 'none';
  if (!hasStarted(g)) return false;
  if (g.side === 'home' && st === 'none') return true;
  if (g.side === 'away' && st === 'entered') return true;
  return false;
}
// Does this game need a director/admin decision (dispute or out-of-town)?
function manageNeeds(g) {
  const st = g.score ? g.score.status : 'none';
  return st === 'disputed' || st === 'approval';
}
const SCORE_BADGE = { entered: ['Waiting for away coach', 'b-blue'], approval: ['Needs director approval', 'b-yellow'], disputed: ['Disputed', 'b-red'], final: ['Final', 'b-green'] };
function scoreBadge(sc) {
  if (!sc || sc.status === 'none') return '<span class="badge b-yellow">No score yet</span>';
  if (sc.status === 'final' && sc.enteredInSE) return '<span class="badge b-navy">Entered in SE</span>';
  const [t, c] = SCORE_BADGE[sc.status] || ['', 'b-gray'];
  return `<span class="badge ${c}">${esc(t)}</span>${sc.forfeit ? ' <span class="badge b-gray">Forfeit</span>' : ''}`;
}
function scoreLineHTML(g, sc) {
  return `<span class="matchup"><b>${esc(g.home)}</b> ${sc ? sc.homeRuns : '–'} <span class="muted">vs</span> ${sc ? sc.awayRuns : '–'} <b>${esc(g.away)}</b></span>`;
}

// The Scores list (role-aware). Tapping a game opens its detail.
async function viewScores(main) {
  const coach = S.activeRole === 'coach';
  main.innerHTML = `<h2>Scores</h2><p class="sub">${coach ? 'Enter your home games, confirm or dispute your away games.' : 'Settle disputes, approve out-of-town games and mark forfeits for your division.'}</p><div id="sc-body"><p class="muted">Loading…</p></div>`;
  const body = $('#sc-body');
  let games;
  if (coach) {
    const d = await api('GET', '/api/coach/scores');
    if (d.pending) { body.innerHTML = `<div class="note info">We're still linking you to your team.</div>`; return; }
    games = (d.games || []).map(g => ({ ...g, _needs: coachNeeds(g) }));
  } else {
    const d = await api('GET', '/api/admin/overview');
    games = (d.games || []).filter(g => g.status !== 'cancelled' && g.status !== 'rainout' && (hasStarted(g) || g.score))
      .map(g => ({ ...g, side: null, _needs: manageNeeds(g) }));
  }
  if (!games.length) { body.innerHTML = `<div class="empty">No games to score yet.</div>`; return; }
  const needs = games.filter(g => g._needs);
  const rest = games.filter(g => !g._needs);
  const row = g => `<button class="scrow ${g._needs ? 'needs' : ''}" data-game="${g.id}">
    <span class="scrow-main">${scoreLineHTML(g, g.score)}<span class="small muted block">${esc(fmtWhen(g.start))} · ${esc(g.division)}</span></span>
    <span class="scrow-side">${g._needs ? '<span class="badge b-red">Needs you</span>' : scoreBadge(g.score)}</span></button>`;
  body.innerHTML =
    (needs.length ? `<h3>Needs you</h3><div class="sclist">${needs.map(row).join('')}</div>` : '') +
    (rest.length ? `<h3>${needs.length ? 'Other games' : 'Games'}</h3><div class="sclist">${rest.map(row).join('')}</div>` : '');
  body.querySelectorAll('[data-game]').forEach(b => { b.onclick = () => openGame(b.dataset.game, 'scores'); });
}

function openGame(id, from) { S.game = { id }; S.gameFrom = from || 'today'; S.tab = 'game'; renderBottomNav(); loadTab(); }

async function loadGameCtx(id) {
  if (S.activeRole === 'coach') {
    const d = await api('GET', '/api/coach/scores');
    const g = (d.games || []).find(x => x.id === id);
    if (g) return { g, side: g.side, manage: false };
  }
  if (S.activeRole === 'director' || S.activeRole === 'admin') {
    const d = await api('GET', '/api/admin/overview');
    const g = (d.games || []).find(x => x.id === id);
    if (g) return { g: { ...g, side: null }, side: null, manage: true };
  }
  const cd = await api('GET', '/api/coach/scores');
  const cg = (cd.games || []).find(x => x.id === id);
  if (cg) return { g: cg, side: cg.side, manage: false };
  throw new Error('That game is no longer available.');
}

async function viewGame(main) {
  const id = S.game && S.game.id;
  main.innerHTML = `<button class="link gd-back" id="gd-back">‹ Back</button><div id="gd"><p class="muted">Loading…</p></div>`;
  $('#gd-back').onclick = () => go(S.gameFrom || 'today');
  let ctx;
  try { ctx = await loadGameCtx(id); } catch (e) { $('#gd').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; return; }
  const { g, side, manage } = ctx;
  $('#gd').innerHTML = `
    <div class="gd-head">
      <div class="gd-teams">${esc(g.away)} <span class="muted">at</span> ${esc(g.home)}</div>
      <div class="small muted">${esc(fmtWhen(g.start))} · ${esc(g.division)}${g.field ? ' · ' + esc(g.field) : ''}</div>
    </div>
    <div class="gd-sec"><h3>Score</h3>${scoreSection(g, side, manage)}</div>
    <div class="gd-sec gd-soon"><h3>Pitchers</h3><p class="muted small">Logging pitch counts arrives in the pitching update.</p></div>
    <div class="gd-sec gd-soon"><h3>Who can pitch</h3><p class="muted small">Pre-game eligibility arrives in the pitching update.</p></div>
    ${g.slots ? `<div class="gd-sec"><h3>Umpires</h3>${umpiresSection(g)}</div>` : ''}`;
  $('#gd').querySelectorAll('[data-score]').forEach(b => { b.onclick = () => scoreAction(b.dataset.score, g, side, manage); });
}

function umpiresSection(g) {
  return `<div class="row">${SLOTS.map(k => {
    const s = g.slots[k] || {};
    const who = s.name || s.umpire;
    return `<div class="slot ${who ? 'filled' : 'open'}"><div class="k">${LABEL[k]}</div><div class="v">${who ? esc(who) : 'Open'}</div></div>`;
  }).join('')}</div>`;
}

function scoreSection(g, side, manage) {
  const sc = g.score;
  const live = hasStarted(g);
  const st = sc ? sc.status : 'none';
  let h = '<div class="scorebox">';
  if (sc && st !== 'none') {
    h += `<div class="score-big"><b>${esc(g.home)}</b> <span class="sc">${sc.homeRuns}</span> – <span class="sc">${sc.awayRuns}</span> <b>${esc(g.away)}</b></div>`;
    h += `<div class="row mt">${scoreBadge(sc)}</div>`;
    if ((sc.homeHR && sc.homeHR.length) || (sc.awayHR && sc.awayHR.length)) h += `<div class="small muted mt">Home runs — ${esc(g.home)}: ${sc.homeHR && sc.homeHR.length ? esc(sc.homeHR.join(', ')) : 'none'} · ${esc(g.away)}: ${sc.awayHR && sc.awayHR.length ? esc(sc.awayHR.join(', ')) : 'none'}</div>`;
    if (st === 'entered' && sc.autoConfirmBy) h += `<div class="note info mt">If the away coach doesn't respond, this becomes final on its own around ${esc(fmtStamp(sc.autoConfirmBy))}.</div>`;
    if (st === 'disputed' && sc.disputeNote) h += `<div class="note warn mt">Dispute note: ${esc(sc.disputeNote)}</div>`;
  } else {
    h += `<div class="muted">No score entered yet.</div>`;
  }
  if (!live) { h += `<div class="note mt">Scores open once the game has started.</div>`; return h + '</div>'; }
  const acts = [];
  if (st === 'none' || st === 'entered') {
    if (side === 'home' || manage) acts.push(sbtn(sc && st === 'entered' ? 'Correct score' : 'Enter score', 'enter', 'btn'));
    if (side === 'away' && st === 'entered') { acts.push(sbtn('Confirm score', 'confirm', 'btn green')); acts.push(sbtn('Dispute', 'dispute', 'btn ghost')); }
  }
  if (st === 'approval' && manage) acts.push(sbtn('Approve score', 'approve', 'btn green'));
  if (st === 'disputed' && manage) acts.push(sbtn('Settle to final', 'settle', 'btn'));
  if (st === 'final' && manage) { acts.push(sbtn('Correct score', 'settle', 'btn ghost')); if (!sc.enteredInSE) acts.push(sbtn('Mark entered in SE', 'enteredse', 'btn ghost')); }
  if (manage && live && st !== 'final' && st !== 'approval') acts.push(sbtn('Mark forfeit', 'forfeit', 'btn ghost'));
  if (acts.length) h += `<div class="row mt gd-acts">${acts.join('')}</div>`;
  else if (side === 'away' && st === 'approval') h += `<div class="note mt">This is an out-of-town game — your division director approves the score.</div>`;
  else if (side && st === 'disputed') h += `<div class="note mt">This score is in dispute. Your division director will settle it.</div>`;
  else if (side === 'away' && st === 'none') h += `<div class="note mt">Waiting for the home coach to enter the score.</div>`;
  else if (st === 'final') h += `<div class="note good mt">This score is final.</div>`;
  return h + '</div>';
}
function sbtn(label, act, cls) { return `<button class="${cls}" data-score="${act}">${esc(label)}</button>`; }

async function scoreAction(act, g, side, manage) {
  const id = g.id;
  const base = `/api/admin/games/${id}/score`;
  try {
    if (act === 'enter' || act === 'settle' || act === 'dispute' || act === 'forfeit') { scoreForm(g, act, manage); return; }
    if (act === 'confirm') {
      if (!await confirmBox('Confirm this score?', `${esc(g.home)} ${g.score.homeRuns} – ${g.score.awayRuns} ${esc(g.away)}. Once you confirm, this becomes the final score.`, 'Confirm score')) return;
      await api('POST', '/api/coach/score/confirm', { gameId: id, homeRuns: g.score.homeRuns, awayRuns: g.score.awayRuns });
      toast('Score confirmed.'); return loadTab();
    }
    if (act === 'approve') {
      if (!await confirmBox('Approve this score?', `${esc(g.home)} ${g.score.homeRuns} – ${g.score.awayRuns} ${esc(g.away)}. This marks the out-of-town game final.`, 'Approve')) return;
      await api('POST', `${base}/approve`); toast('Score approved.'); return loadTab();
    }
    if (act === 'enteredse') {
      if (!await confirmBox('Mark entered in SportsEngine?', 'Tick this once you have copied the score into SportsEngine.', 'Mark entered')) return;
      await api('POST', `${base}/entered-se`); toast('Marked entered in SE.'); return loadTab();
    }
  } catch (e) { toast(e.message, true); }
}

function scoreForm(g, kind, manage) {
  const id = g.id, sc = g.score;
  if (kind === 'dispute') {
    modal('Dispute this score', `<p class="small muted">Tell your division director what's wrong; they'll settle it.</p><label>What's wrong?<textarea name="note" style="min-height:90px" placeholder="e.g. the final was 7–5, not 5–7"></textarea></label>`, async v => {
      await api('POST', '/api/coach/score/dispute', { gameId: id, note: v.note }); toast('Dispute sent to your director.'); loadTab();
    }, { submitLabel: 'Send dispute', danger: true });
    return;
  }
  if (kind === 'forfeit') {
    modal('Mark a forfeit', `<p class="small muted">A forfeit is recorded as 6–0 to the winning team.</p><label>Who won?<select name="winner"><option value="home">${esc(g.home)} (home)</option><option value="away">${esc(g.away)} (away)</option></select></label>`, async v => {
      await api('POST', `/api/admin/games/${id}/score/forfeit`, { winner: v.winner }); toast('Forfeit recorded.'); loadTab();
    }, { submitLabel: 'Record forfeit' });
    return;
  }
  const isSettle = kind === 'settle';
  const hr = isSettle ? '' : `<fieldset><legend>Who hit home runs? (optional)</legend>
    <label>${esc(g.home)}<input name="homeHR" value="${sc && sc.homeHR ? esc(sc.homeHR.join(', ')) : ''}" placeholder="names, comma separated"></label>
    <label>${esc(g.away)}<input name="awayHR" value="${sc && sc.awayHR ? esc(sc.awayHR.join(', ')) : ''}" placeholder="names, comma separated"></label></fieldset>`;
  modal(isSettle ? 'Set the final score' : (sc && sc.status !== 'none' ? 'Correct the score' : 'Enter the final score'),
    `<div class="grid2">
      <label>${esc(g.home)} (home)<input name="homeRuns" type="number" inputmode="numeric" min="0" max="99" required value="${sc && sc.status !== 'none' ? sc.homeRuns : ''}"></label>
      <label>${esc(g.away)} (away)<input name="awayRuns" type="number" inputmode="numeric" min="0" max="99" required value="${sc && sc.status !== 'none' ? sc.awayRuns : ''}"></label>
    </div>${hr}${!isSettle && !manage ? '<p class="small muted">The away coach confirms or disputes within 24 hours, or it confirms on its own.</p>' : ''}`,
    async v => {
      const bodyData = { gameId: id, homeRuns: Number(v.homeRuns), awayRuns: Number(v.awayRuns) };
      if (!isSettle) { bodyData.homeHR = v.homeHR || ''; bodyData.awayHR = v.awayHR || ''; }
      if (manage) await api('POST', `/api/admin/games/${id}/score/${isSettle ? 'settle' : 'enter'}`, bodyData);
      else await api('POST', '/api/coach/score', bodyData);
      toast('Score saved.'); loadTab();
    }, { submitLabel: 'Save score' });
}

// Director/admin: the "enter in SE" hand-off list.
async function viewEnterSE(main) {
  const d = await api('GET', '/api/admin/enter-se');
  main.innerHTML = `<h2>Enter in SportsEngine</h2><p class="sub">Final scores not yet copied into SportsEngine. Copy each into SE, then tick it off.</p>
    ${d.list.length ? `<div class="sclist">${d.list.map(x => `<div class="scrow static">
      <span class="scrow-main"><b>${esc(x.score)}</b><span class="small muted block">${esc(x.when)} · ${esc(x.division)}${x.forfeit ? ' · forfeit' : ''}</span></span>
      <span class="scrow-side"><button class="btn sm" data-se="${x.id}">Mark entered</button></span></div>`).join('')}</div>` : '<div class="empty">Nothing waiting — every final score is in SportsEngine.</div>'}`;
  main.querySelectorAll('[data-se]').forEach(b => { b.onclick = async () => {
    try { await api('POST', `/api/admin/games/${b.dataset.se}/score/entered-se`); toast('Marked entered.'); viewEnterSE(main); }
    catch (e) { toast(e.message, true); }
  }; });
}

export { viewScores, viewGame, viewEnterSE, coachNeeds, manageNeeds };
