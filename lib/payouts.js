// Biweekly payout reports. Only coach-confirmed "worked" games are paid;
// unconfirmed games are held and roll into the next period once confirmed.
const crypto = require('crypto');
const store = require('./store');
const { getSettings } = require('./settings');
const G = require('./games');
const clock = require('./clock');
const { etDateKey, addDaysToKey, fmtGame } = require('./time');

const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);

// The payout period containing a given Eastern date.
function periodFor(dateKey, s) {
  const k = Math.floor(daysBetween(s.payoutAnchor, dateKey) / s.payoutDays);
  const start = addDaysToKey(s.payoutAnchor, k * s.payoutDays);
  return { start, end: addDaysToKey(start, s.payoutDays - 1) };
}

// Most recent period that has fully ended.
function lastClosedPeriod(s, now = clock.now()) {
  const cur = periodFor(etDateKey(now), s);
  return periodFor(addDaysToKey(cur.start, -1), s);
}

async function preview(endKey) {
  const s = await getSettings();
  const end = endKey || lastClosedPeriod(s).end;
  const [games, people] = await Promise.all([store.list('games'), store.list('people')]);
  const who = new Map(people.map(p => [p.email, p]));
  const lines = new Map(), held = [];
  for (const g of games) {
    if (g.track !== 'student' || !g.slots) continue;
    const day = etDateKey(g.start);
    if (day > end || new Date(g.start) > clock.now()) continue;
    for (const k of G.SLOTS) {
      const sl = g.slots[k];
      if (!sl.umpireId || sl.paidPayoutId || !G.isLive(g)) continue;
      const item = { gameId: g.id, slot: k, date: day, when: fmtGame(g.start), game: `${g.division} · ${g.away && g.home ? `${g.away} at ${g.home}` : g.summary}` };
      if (sl.worked === 'worked') {
        const p = who.get(sl.umpireId);
        const line = lines.get(sl.umpireId) || { umpireId: sl.umpireId, name: p?.name || sl.umpireId, venmo: p?.umpire?.venmo || '', games: [], amount: 0 };
        line.games.push(item); line.amount += s.payRate;
        lines.set(sl.umpireId, line);
      } else if (!sl.worked) {
        held.push({ ...item, umpireId: sl.umpireId, name: who.get(sl.umpireId)?.name || sl.umpireId });
      }
    }
  }
  const list = [...lines.values()].sort((a, b) => a.name.localeCompare(b.name));
  list.forEach(l => l.games.sort((a, b) => a.date.localeCompare(b.date)));
  return {
    periodEnd: end, periodStart: periodFor(end, s).start, payRate: s.payRate,
    lines: list, total: list.reduce((t, l) => t + l.amount, 0),
    held: held.sort((a, b) => a.date.localeCompare(b.date))
  };
}

// Admin has sent the Venmo payments: lock these games as paid.
async function markPaid(endKey, adminEmail) {
  const rep = await preview(endKey);
  if (!rep.lines.length) throw new Error('Nothing to pay for that period.');
  const id = `p_${rep.periodEnd}_${crypto.randomBytes(2).toString('hex')}`;
  const byGame = new Map();
  for (const l of rep.lines) for (const it of l.games) (byGame.get(it.gameId) || byGame.set(it.gameId, []).get(it.gameId)).push(it.slot);
  for (const [gameId, slots] of byGame) {
    await store.transact(async tx => {
      const g = await tx.get('games', gameId);
      for (const k of slots) if (g.slots[k].worked === 'worked' && !g.slots[k].paidPayoutId) g.slots[k].paidPayoutId = id;
      tx.set('games', gameId, g);
    });
  }
  const doc = { id, periodStart: rep.periodStart, periodEnd: rep.periodEnd, paidAt: clock.now().toISOString(), by: adminEmail, payRate: rep.payRate, lines: rep.lines, total: rep.total };
  await store.set('payouts', id, doc);
  return doc;
}

function toCsv(rep) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Umpire', 'Venmo', 'Games', 'Amount', 'Game dates']];
  for (const l of rep.lines) rows.push([l.name, l.venmo, l.games.length, l.amount, l.games.map(g => `${g.date} ${g.slot}`).join('; ')]);
  rows.push(['TOTAL', '', rep.lines.reduce((t, l) => t + l.games.length, 0), rep.total, '']);
  return rows.map(r => r.map(esc).join(',')).join('\n');
}

// What an umpire sees about their own pay.
async function myPay(email) {
  const [games, payouts] = await Promise.all([store.list('games'), store.list('payouts')]);
  const s = await getSettings();
  const out = [];
  for (const g of games) for (const k of G.SLOTS) {
    const sl = g.slots?.[k];
    if (sl?.umpireId !== email || new Date(g.start) > clock.now() || !G.isLive(g)) continue;
    const paid = sl.paidPayoutId ? payouts.find(p => p.id === sl.paidPayoutId) : null;
    out.push({
      gameId: g.id, slot: k, when: fmtGame(g.start), date: etDateKey(g.start), division: g.division,
      status: sl.paidPayoutId ? 'Paid' : sl.worked === 'worked' ? 'Confirmed, next payout' : sl.worked === 'noshow' ? 'Marked no-show' : 'Waiting for coach to confirm',
      amount: sl.worked === 'worked' ? s.payRate : 0, paidAt: paid?.paidAt || null
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

module.exports = { periodFor, lastClosedPeriod, preview, markPaid, toCsv, myPay };
