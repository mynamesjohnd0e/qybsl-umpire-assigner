// Admin data & go-live screens: teams + player rosters (with league ages), and
// backup / health-check / restore.
import { $, esc, S, api, toast, modal, confirmBox, fmtStamp } from './core.js';

const normTeam = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ── Teams & players ───────────────────────────────────────────────────────────
async function viewTeams(main) {
  const [t, pl, st] = await Promise.all([api('GET', '/api/admin/teams'), api('GET', '/api/admin/players'), api('GET', '/api/admin/settings')]);
  const byTeam = {};
  (pl.players || []).forEach(p => { (byTeam[normTeam(p.team)] || (byTeam[normTeam(p.team)] = [])).push(p); });
  const teamsByDiv = {};
  (t.teams || []).forEach(tm => { (teamsByDiv[tm.division] || (teamsByDiv[tm.division] = [])).push(tm); });
  const divs = (t.divisions || []).filter(d => teamsByDiv[d]);
  const seasonYear = st.seasonYear || (new Date().getFullYear() + 1);
  main.innerHTML = `<div class="spread"><div><h2>Teams &amp; players</h2><p class="sub">Teams come from the schedule. Upload Minors and Majors rosters to get league ages — birthdates are used only to compute the age, then discarded.</p></div><button class="btn sm" id="roster-up">Upload roster</button></div>
    <div id="roster-out"></div>
    ${(t.teams && t.teams.length) ? divs.map(d => `<h3>${esc(d)}</h3>${teamsByDiv[d].map(tm => teamCard(tm, byTeam[normTeam(tm.name)] || [])).join('')}`).join('') : '<div class="empty">No teams yet. Upload a schedule under Schedule sync.</div>'}`;
  $('#roster-up').onclick = () => rosterModal(main, seasonYear);
}
function teamCard(tm, players) {
  const sorted = players.slice().sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="scrow static" style="flex-direction:column;align-items:stretch;gap:6px">
    <div class="spread"><span class="scrow-main"><b>${esc(tm.name)}</b><span class="small muted block">${tm.headCoach ? `Coach: ${esc(tm.headCoach)}` : 'No head coach linked'}</span></span><span class="badge b-gray">${players.length} player${players.length === 1 ? '' : 's'}</span></div>
    ${players.length ? `<div class="tbl-wrap"><table><tr><th class="num">#</th><th>Player</th><th class="num">League age</th></tr>${sorted.map(p => `<tr><td class="num">${p.number ? esc(p.number) : '—'}</td><td>${esc(p.name)}</td><td class="num">${p.leagueAge != null ? esc(p.leagueAge) : '—'}</td></tr>`).join('')}</table></div>` : ''}
  </div>`;
}
function rosterModal(main, seasonYear) {
  modal('Upload a player roster', `<p class="small muted">Paste the SportsEngine roster export (CSV: name, number, birthdate, team, division), or choose the file. Birthdates become league ages and are then discarded.</p>
    <input type="file" id="roster-file" accept=".csv,text/csv">
    <textarea name="csv" placeholder="…or paste the CSV here" style="min-height:90px"></textarea>
    <label>Season year (for the April 30 league-age cutoff)<input name="seasonYear" type="number" value="${esc(seasonYear)}"></label>`, async v => {
    const file = document.getElementById('roster-file').files[0];
    const csv = file ? await file.text() : v.csv;
    if (!csv || !csv.trim()) { toast('Choose a file or paste the CSV.', true); return false; }
    const r = await api('POST', '/api/admin/roster/players', { csv, seasonYear: Number(v.seasonYear) });
    toast(`Roster: ${r.added} added, ${r.updated} updated.`);
    await viewTeams(main);
    const out = $('#roster-out');
    if (out) out.innerHTML = `<div class="note good"><b>Roster uploaded.</b> ${r.added} added, ${r.updated} updated${r.restored ? `, ${r.restored} restored` : ''}. League ages were computed and the birthdates discarded — no birthdate is stored.
      ${r.skipped && r.skipped.length ? `<div class="small mt"><b>Skipped (fix and re-upload):</b> ${r.skipped.map(esc).join('; ')}</div>` : ''}
      ${r.missing && r.missing.length ? `<div class="small mt"><b>Not in this upload (kept, not deleted):</b> ${r.missing.map(esc).join(', ')}</div>` : ''}</div>`;
  }, { submitLabel: 'Upload roster' });
}

// ── Backup, health check and restore ──────────────────────────────────────────
async function viewBackup(main) {
  let chk;
  try { chk = await api('GET', '/api/admin/selfcheck'); } catch (e) { main.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; return; }
  const test = S.info.testMode;
  main.innerHTML = `<h2>Backup &amp; safety</h2><p class="sub">Download a full backup, check the app is healthy, and (on the test copy) restore from a backup file.</p>
    <h3>Backup</h3>
    <p class="small muted">Downloads every record as one JSON file. Keep it somewhere safe.</p>
    <div><a class="btn" href="/api/admin/backup" download="qybsl-backup.json">Download backup</a></div>
    <h3>Health check</h3>
    <div class="sclist mt">
      ${checkRow('Settings loaded', chk.settingsLoaded)}
      ${checkRow('Admins configured', chk.adminConfigured)}
      ${checkRow('Schedule feed set up', chk.feedConfigured)}
      <div class="scrow static"><span class="scrow-main"><b>Games in the system</b></span><span>${chk.games}</span></div>
      <div class="scrow static"><span class="scrow-main"><b>Storage</b></span><span>${esc(chk.storage)}</span></div>
      <div class="scrow static"><span class="scrow-main"><b>Last nightly sync</b></span><span class="small muted">${chk.lastSyncAt ? esc(fmtStamp(chk.lastSyncAt)) : 'never'}</span></div>
    </div>
    ${test ? `<h3>Restore (test copy)</h3><p class="small muted">Replaces all data on the test copy with a backup file. The live app can't be restored from here.</p>
      <input type="file" id="restore-file" accept="application/json,.json"><div class="mt"><button class="btn red" id="restore-btn">Restore from file</button></div>`
      : '<div class="note info mt">Restore is only available on the test copy.</div>'}`;
  const rb = $('#restore-btn');
  if (rb) rb.onclick = async () => {
    const file = $('#restore-file').files[0];
    if (!file) return toast('Choose a backup file first.', true);
    if (!(await confirmBox('Restore the test copy?', 'This replaces every record on the test copy with the backup. It cannot be undone.', 'Restore', true))) return;
    try { const data = JSON.parse(await file.text()); await api('POST', '/api/admin/restore', data); toast('Restored.'); viewBackup(main); }
    catch (e) { toast(e.message, true); }
  };
}
function checkRow(label, ok) {
  return `<div class="scrow static"><span class="scrow-main"><b>${esc(label)}</b></span><span class="badge ${ok ? 'b-green' : 'b-red'}">${ok ? 'OK' : 'Check'}</span></div>`;
}

export { viewTeams, viewBackup };
