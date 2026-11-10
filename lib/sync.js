// Pulls the SportsEngine schedule (iCal feed or an uploaded HQ export) and
// reconciles it with stored games. iCal games match by the feed's permanent
// event ID; exported games match by teams + date + time, and a game that
// disappeared is paired with a new one between the same two teams as a move.
const fs = require('fs');
const crypto = require('crypto');
const store = require('./store');
const notify = require('./notify');
const { getSettings } = require('./settings');
const { parseIcs } = require('./ical');
const { parseSeCsv, looksLikeSeCsv } = require('./secsv');
const clock = require('./clock');
const G = require('./games');
const { teamsIndex, unmatched } = require('./teams');
const { fmtGame, HOUR, zoneParts, zonedToUtc } = require('./time');

async function fetchFeed(url) {
  if (url.startsWith('upload:')) {
    const doc = await store.get('uploads', url.slice(7));
    if (!doc?.text) throw new Error('The uploaded schedule is missing. Upload it again.');
    return doc.text;
  }
  if (url.startsWith('file:')) return fs.readFileSync(url.replace(/^file:(\/\/)?/, ''), 'utf8');
  const u = url.replace(/^webcal:/i, 'https:');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(u, { signal: ctrl.signal, headers: { 'User-Agent': 'QYBSL-Umpire-Assigner' } });
    if (!r.ok) throw new Error(`Feed returned HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(timer); }
}

// Move a time by whole days on the Eastern wall clock (testing only).
function shiftIso(iso, days) {
  if (!iso || !days) return iso;
  const p = zoneParts(iso);
  return zonedToUtc(p.y, p.m, p.d + Number(days), p.hh, p.mm, p.ss).toISOString();
}

function parseSchedule(text, feed) {
  if (looksLikeSeCsv(text)) return parseSeCsv(text, { shiftDays: feed.shiftDays || 0 });
  const evs = parseIcs(text);
  if (feed.shiftDays) for (const e of evs) { e.start = shiftIso(e.start, feed.shiftDays); e.end = shiftIso(e.end, feed.shiftDays); }
  return evs;
}

const feedName = f => f.url.startsWith('upload:') ? 'Uploaded schedule' : f.url;

const normField = f => String(f || '').toLowerCase().replace(/\s+/g, ' ').trim();
const looksCancelled = ev => ev.status === 'CANCELLED' || /^\s*\(?\s*cancel+ed\b/i.test(ev.summary);

// Run one sync. Returns a summary. opts.by = who started it.
async function runSync(opts = {}) {
  const s = await getSettings();
  const runId = `r_${clock.now().getTime()}_${crypto.randomBytes(2).toString('hex')}`;
  const now = clock.now();
  const counts = { new: 0, moved: 0, cancelled: 0, reinstated: 0, unchanged: 0, skipped: 0, unsorted: 0 };
  const errors = [], warnings = [], logs = [];
  const unsortedSamples = [];
  const log = (g, change, before, after) => logs.push({ gameId: g.id, summary: g.summary, start: g.start, change, before: before ?? null, after: after ?? null });

  const feeds = opts.feeds || s.feeds || [];
  if (!feeds.length) return { runId, ok: false, message: 'No SportsEngine feed set up yet. Add one in Settings.' };

  const games = await store.list('games');
  const byUid = new Map(games.filter(g => g.uid).map(g => [g.uid, g]));
  const firstImport = games.filter(g => g.source === 'feed').length === 0;
  const teams = await G.teamIndex();
  const changed = new Map();          // id → game to save
  const openings = [];                // [{ game, slot }] to announce
  const movedNotices = [];            // [{ game, slot, email, before }]
  const cancelNotices = [];           // [{ game, email }]
  const seen = new Set();
  const teamNamesSeen = new Set();    // team names on classified games, to match to team records

  for (const feed of feeds) {
    let events;
    try { events = parseSchedule(await fetchFeed(feed.url), feed); }
    catch (e) { errors.push(`${feedName(feed)}: ${e.message}`); continue; }
    if (!events.length) { warnings.push(`${feedName(feed)}: no games found, nothing changed.`); continue; }

    // Exported schedules have no permanent IDs: pair each new-looking game with
    // a vanished game between the same two teams (closest date) and treat it as moved.
    const evUids = new Set(events.map(e => e.uid));
    const orphans = [...byUid.values()].filter(g => g.feedUrl === feed.url && G.isLive(g) && g.pairKey && !evUids.has(g.uid));
    const used = new Set();
    for (const ev of events) {
      if (!ev.pairKey || byUid.has(ev.uid) || looksCancelled(ev)) continue;
      let best = null;
      for (const g of orphans) {
        if (used.has(g.id) || g.pairKey !== ev.pairKey) continue;
        const diff = Math.abs(new Date(g.start) - new Date(ev.start));
        if (!best || diff < best.diff) best = { g, diff };
      }
      if (best) { used.add(best.g.id); ev.uid = best.g.uid; }
    }

    const fromThisFeed = new Set();
    for (const ev of events) {
      const cls = G.classify(ev, s, teams);
      if (cls.track === 'skip') { counts.skipped++; continue; }
      if (cls.track === 'none') { counts.unsorted++; if (unsortedSamples.length < 8) unsortedSamples.push(ev.summary); continue; }
      fromThisFeed.add(ev.uid); seen.add(ev.uid);
      if (ev.home) teamNamesSeen.add(ev.home);
      if (ev.away) teamNamesSeen.add(ev.away);
      const end = ev.end && ev.end > ev.start ? ev.end : null;
      let g = byUid.get(ev.uid);

      if (looksCancelled(ev)) {
        const worked = g?.slots && G.SLOTS.some(k => g.slots[k].worked);
        if (g && G.isLive(g) && !worked) { cancelGame(g, 'cancelled in SportsEngine', cancelNotices); log(g, 'cancelled'); counts.cancelled++; changed.set(g.id, g); }
        continue;
      }

      if (!g) {
        g = G.newGame({ ...ev, end, season: feed.season || s.seasonLabel, feedUrl: feed.url, division: cls.division }, cls.track);
        if (ev.pairKey) g.pairKey = ev.pairKey;
        G.addHistory(g, 'Added from SportsEngine');
        byUid.set(ev.uid, g); changed.set(g.id, g); counts.new++;
        if (!firstImport) log(g, 'new', null, { start: g.start, field: g.field });
        if (!firstImport && g.track === 'student' && new Date(g.start) > now) G.SLOTS.forEach(k => openings.push({ game: g, slot: k }));
        continue;
      }

      const snapshot = JSON.stringify(g);
      g.summary = ev.summary; g.home = ev.home; g.away = ev.away;
      if (g.track !== cls.track && !(g.slots && G.SLOTS.some(k => g.slots[k].umpireId))) {
        // Sorting rules changed: switch tracks only if nobody is assigned yet.
        g.track = cls.track;
        if (cls.track === 'student') { g.slots = { plate: G.emptySlot(), field: G.emptySlot() }; delete g.patchedStatus; }
        else { delete g.slots; g.patchedStatus = 'Not requested'; g.patchedNote = ''; }
      }
      g.division = cls.division;

      if (!G.isLive(g)) {
        g.status = 'scheduled'; g.cancelledAt = null; g.cancelReason = null;
        Object.assign(g, { start: ev.start, end, field: ev.location });
        G.addHistory(g, 'Back on the SportsEngine schedule');
        log(g, 'reinstated'); counts.reinstated++; changed.set(g.id, g);
        if (g.track === 'student' && new Date(g.start) > now) G.SLOTS.forEach(k => openings.push({ game: g, slot: k }));
        continue;
      }

      const before = { start: g.start, field: g.field };
      const timeChanged = new Date(ev.start).getTime() !== new Date(g.start).getTime();
      const fieldChanged = normField(ev.location) !== normField(g.field);
      const upcoming = new Date(ev.start) > now || new Date(g.start) > now;
      if ((timeChanged || fieldChanged) && upcoming) {
        Object.assign(g, { start: ev.start, end, field: ev.location, movedAt: now.toISOString() });
        const what = [timeChanged && 'time', fieldChanged && 'field'].filter(Boolean).join(' and ');
        G.addHistory(g, `Moved (${what}) in SportsEngine`);
        if (g.track === 'student' && new Date(g.start) > now) {
          for (const k of G.SLOTS) {
            const sl = g.slots[k];
            if (sl.umpireId) {
              sl.state = 'reconfirm';
              sl.reconfirmBy = new Date(now.getTime() + s.reconfirmHours * HOUR).toISOString();
              movedNotices.push({ game: g, slot: k, email: sl.umpireId, before });
            }
          }
        } else if (g.patchedStatus !== 'Not requested') {
          g.patchedStatus = 'Requested';
          g.patchedMoved = true;
        }
        log(g, 'moved', before, { start: g.start, field: g.field });
        counts.moved++; changed.set(g.id, g);
      } else {
        if (g.end !== end && end) g.end = end;
        counts.unchanged++;
        if (JSON.stringify(g) !== snapshot) changed.set(g.id, g);
      }
    }

    // Upcoming games from this feed that disappeared → cancelled.
    // Guard: if more than half would vanish at once, assume a bad feed.
    const missing = [...byUid.values()].filter(g => g.feedUrl === feed.url && G.isLive(g) && new Date(g.start) > now && !fromThisFeed.has(g.uid));
    const upcomingFromFeed = [...byUid.values()].filter(g => g.feedUrl === feed.url && G.isLive(g) && new Date(g.start) > now).length;
    if (missing.length && missing.length > Math.max(5, upcomingFromFeed / 2)) {
      warnings.push(`${missing.length} upcoming games vanished from ${feedName(feed)} at once. Not cancelling them; check the schedule.`);
    } else {
      for (const g of missing) { cancelGame(g, 'removed from SportsEngine', cancelNotices); log(g, 'removed'); counts.cancelled++; changed.set(g.id, g); }
    }
  }

  // Match each game's teams to the team records (from the coach list). A name
  // that matches none is reported, never silently dropped, so a misspelled team
  // in the schedule gets noticed instead of quietly going unsorted.
  const teamRecs = await teamsIndex();
  const unmatchedTeams = unmatched(teamRecs, [...teamNamesSeen]);
  if (unmatchedTeams.length) warnings.push(`${unmatchedTeams.length} team name(s) on the schedule match no team on the coach list: ${unmatchedTeams.join(', ')}. Check the spelling or add the coach.`);

  // Save games, swaps closed by cancellations, and the log.
  for (const g of changed.values()) await store.set('games', g.id, g);
  for (const c of cancelNotices) if (c.swapId) await store.update('swaps', c.swapId, { state: 'cancelled', closedAt: now.toISOString() });
  for (const [i, l] of logs.entries()) await store.set('syncLog', `${runId}_${String(i).padStart(4, '0')}`, { runId, at: now.toISOString(), ...l });
  const summary = {
    id: runId, at: now.toISOString(), by: opts.by || 'scheduled', counts, errors, warnings, unsortedSamples, unmatchedTeams,
    firstImport, ok: !errors.length || Object.values(counts).some(Boolean)
  };
  await store.set('syncRuns', runId, summary);
  await store.update('settings', 'jobs', { lastSyncAt: now.toISOString(), lastSyncId: runId });

  // Messages go out after everything is saved.
  const foot = await notify.footer();
  for (const m of movedNotices) {
    const p = await store.get('people', m.email);
    if (!p) continue;
    await notify.toUmpire(p, {
      kind: 'reconfirm', gameId: m.game.id, subject: `Game moved: please reconfirm by ${fmtGame(m.game.slots[m.slot].reconfirmBy)}`,
      text: `A game you're umpiring was moved.\n\nWas: ${fmtGame(m.before.start)} · ${m.before.field || 'TBD'}\nNow: ${fmtGame(m.game.start)} · ${m.game.field || 'TBD'}\n\nYou're still on it. Open the app and tap Confirm or Can't make it within ${s.reconfirmHours} hours. If we don't hear back, the spot opens to other umpires.${foot}`,
      sms: `QYBSL: your game moved to ${fmtGame(m.game.start)} at ${m.game.field || 'TBD'}. Reconfirm in the umpire app within ${s.reconfirmHours} hrs.`
    });
  }
  for (const c of cancelNotices) {
    const p = await store.get('people', c.email);
    if (!p) continue;
    await notify.toUmpire(p, {
      kind: 'cancelled', gameId: c.game.id, subject: `Cancelled: ${fmtGame(c.game.start)}`,
      text: `This game was cancelled, so you're off it (no pay for cancelled games):\n\n${G.describe(c.game)}${foot}`,
      sms: `QYBSL: your ${fmtGame(c.game.start)} game was cancelled. You're off it.`
    });
  }
  await G.announceOpenings(openings);
  return summary;
}

function cancelGame(g, reason, notices) {
  g.status = 'cancelled';
  g.cancelledAt = clock.now().toISOString();
  g.cancelReason = reason;
  if (g.slots) {
    for (const k of G.SLOTS) {
      const sl = g.slots[k];
      if (sl.umpireId) notices.push({ game: g, email: sl.umpireId, swapId: sl.swapId });
      g.slots[k] = G.emptySlot();
    }
  }
  G.addHistory(g, `Cancelled: ${reason}`);
}

module.exports = { runSync, fetchFeed, parseSchedule, shiftIso };
