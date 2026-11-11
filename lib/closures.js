// Field closures and rainouts. A board admin (admins only) closes a field,
// several fields, or all of Quarry Hills, for a day or a time window (including
// a planned closure like an infield rebuild). Every game on those fields in that
// window is rained out: no score, no pitch log, no umpire pay, not in standings
// (G.isLive is false for a rainout). Both coaches, the assigned umpires and their
// parents are told, and the Communications Director gets one ready-to-post note.
const crypto = require('crypto');
const store = require('./store');
const clock = require('./clock');
const notify = require('./notify');
const { getSettings } = require('./settings');
const G = require('./games');
const { coachOwns } = require('./coach');
const { norm } = require('./teams');
const { fmtGame, etDayStart, addDaysToKey } = require('./time');

function buildClosure(body, admin) {
  const id = 'cl_' + clock.now().getTime() + '_' + crypto.randomBytes(2).toString('hex');
  let fromTs, toTs;
  if (body.date && !body.from) {            // a whole Eastern day
    fromTs = etDayStart(body.date).toISOString();
    toTs = etDayStart(addDaysToKey(body.date, 1)).toISOString();
  } else {
    if (!body.from || !body.to) throw new Error('Give a day, or a start and end time.');
    fromTs = new Date(body.from).toISOString();
    toTs = new Date(body.to).toISOString();
  }
  const all = !!body.all;
  const fields = all ? null : (body.fields || []).map(norm).filter(Boolean);
  if (!all && !fields.length) throw new Error('Choose a field, several fields, or all of Quarry Hills.');
  return {
    id, all, fields, fromTs, toTs,
    reason: String(body.reason || 'rainout').trim(), note: String(body.note || '').trim(),
    by: admin.email, at: clock.now().toISOString(), gameIds: [], reopenedAt: null
  };
}

// Does this game fall on a closed field within the closed window? Half-open in
// time: a game ending exactly when the window starts is not affected.
function overlapsClosure(g, closure, s) {
  const field = norm(g.field);
  const onField = closure.all ? field.includes('quarry hills') : closure.fields.some(f => field.includes(f));
  if (!onField) return false;
  const gs = new Date(g.start).getTime(), ge = new Date(G.endOf(g, s)).getTime();
  const cf = new Date(closure.fromTs).getTime(), ct = new Date(closure.toTs).getTime();
  return gs < ct && cf < ge;
}

// Close field(s) and rain out the games in the window.
async function closeFields(admin, body) {
  const s = await getSettings();
  const closure = buildClosure(body, admin);
  const games = await store.list('games');
  // Only scheduled games are newly rained out, so re-closing sends nothing new.
  const affected = games.filter(g => g.status === 'scheduled' && overlapsClosure(g, closure, s));
  for (const g of affected) {
    g.status = 'rainout';
    g.rainout = { closureId: closure.id, reason: closure.reason, at: closure.at };
    G.addHistory(g, `Rained out: ${closure.reason}`, admin.email);
    await store.set('games', g.id, g);
  }
  closure.gameIds = affected.map(g => g.id);
  await store.set('closures', closure.id, closure);
  await notifyClosure(affected, { reopened: false, closure });
  return { closureId: closure.id, affected: closure.gameIds.length, games: closure.gameIds };
}

// Lift a closure: restore its games and tell the same people.
async function reopen(admin, closureId) {
  const closure = await store.get('closures', closureId);
  if (!closure) throw new Error('Closure not found.');
  if (closure.reopenedAt) throw new Error('That closure was already lifted.');
  const restored = [];
  for (const gid of closure.gameIds || []) {
    const g = await store.get('games', gid);
    if (g && g.status === 'rainout' && g.rainout?.closureId === closureId) {
      g.status = 'scheduled'; delete g.rainout;
      G.addHistory(g, 'Field reopened — game back on', admin.email);
      await store.set('games', gid, g);
      restored.push(g);
    }
  }
  closure.reopenedAt = clock.now().toISOString();
  await store.set('closures', closureId, closure);
  await notifyClosure(restored, { reopened: true, closure });
  return { closureId, restored: restored.length };
}

const gameLine = g => `${g.division} · ${g.away && g.home ? `${g.away} at ${g.home}` : g.summary} — ${fmtGame(g.start)} · ${g.field || 'field TBD'}`;

// Notices: both coaches, the assigned umpires (parents copied), and one note to
// the Communications Director listing each game once. No other address.
async function notifyClosure(games, { reopened, closure }) {
  if (!games.length) return;
  const s = await getSettings();
  const foot = await notify.footer();
  const people = await store.list('people');
  const verb = reopened ? 'is back on' : 'is rained out';
  for (const g of games) {
    const body = `This game ${verb}${reopened ? '' : ` (${closure.reason})`}:\n\n${gameLine(g)}`;
    for (const c of people.filter(p => p.coach?.teams?.length && coachOwns(p, g))) {
      await notify.toAdult(c, { kind: reopened ? 'reopened' : 'rainout', gameId: g.id, subject: reopened ? `Back on: ${fmtGame(g.start)}` : `Rained out: ${fmtGame(g.start)}`, text: `${body}${foot}` });
    }
    for (const k of G.SLOTS) {
      const email = g.slots?.[k]?.umpireId;
      if (!email) continue;
      const u = await store.get('people', email);
      if (u) await notify.toUmpire(u, {
        kind: reopened ? 'reopened' : 'rainout', gameId: g.id,
        subject: reopened ? `Back on: ${fmtGame(g.start)}` : `Rained out: ${fmtGame(g.start)} (no pay)`,
        text: `${body}\n\n${reopened ? 'You are on it again.' : 'You are off it (rained-out games are not paid).'}${foot}`,
        sms: reopened ? `QYBSL: your ${fmtGame(g.start)} game is back on.` : `QYBSL: your ${fmtGame(g.start)} game is rained out (no pay).`
      });
    }
  }
  if (s.commsDirectorEmail) {
    const lines = games.map(g => `• ${gameLine(g)}`).join('\n');
    await notify.sendEmail(
      s.commsDirectorEmail,
      reopened ? 'Games back on after reopening' : 'Rainout note to post in SportsEngine',
      `${reopened ? 'These games are back on:' : 'These games are rained out:'}\n\n${lines}\n\nPlease post this to families in SportsEngine.${foot}`,
      { kind: reopened ? 'comms-reopen' : 'comms-rainout' }
    );
  }
}

async function listClosures() {
  return (await store.list('closures')).sort((a, b) => b.at.localeCompare(a.at));
}

module.exports = { closeFields, reopen, overlapsClosure, listClosures, buildClosure };
