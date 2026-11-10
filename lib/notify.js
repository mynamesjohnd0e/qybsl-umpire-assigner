// Email and text delivery. Every message is written to the outbox so admins
// can see what went out. If email or texting isn't set up yet, the message
// is still logged (status "not sent") so nothing is lost silently.
//
// Email: GMAIL_USER + GMAIL_APP_PASSWORD, or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS.
// Texts: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM (or
//        TWILIO_MESSAGING_SERVICE_SID), and "texts enabled" on in Settings.
const crypto = require('crypto');
const store = require('./store');
const { getSettings } = require('./settings');

const DRY = process.env.NOTIFY_DRY === '1';
// On the test copy, only addresses/numbers matching this are ever contacted.
const ONLY = process.env.TEST_SEND_ONLY ? new RegExp(process.env.TEST_SEND_ONLY, 'i') : null;
let transport = null;
function mailer() {
  if (transport !== null) return transport;
  const env = process.env;
  try {
    const nodemailer = require('nodemailer');
    if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) {
      transport = nodemailer.createTransport({ service: 'gmail', auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD } });
    } else if (env.SMTP_HOST) {
      transport = nodemailer.createTransport({
        host: env.SMTP_HOST, port: +(env.SMTP_PORT || 587), secure: +(env.SMTP_PORT || 587) === 465,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
      });
    } else transport = false;
  } catch (_) { transport = false; }
  return transport;
}
const fromAddr = () => process.env.MAIL_FROM || process.env.GMAIL_USER || process.env.SMTP_USER || 'umpires@qybsl.local';

const twilioReady = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN &&
  (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID));

// US numbers to E.164 (+1XXXXXXXXXX).
function toE164(n) {
  const d = String(n || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return null;
}

async function logOutbox(entry) {
  const id = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  await store.set('outbox', id, { id, at: new Date().toISOString(), ...entry });
}

async function sendEmail(to, subject, text, meta = {}) {
  if (!to) return;
  let status = 'sent', error = null;
  const t = DRY ? false : mailer();
  if (ONLY && !ONLY.test(to)) status = 'not sent (test copy: only sends to John)';
  else if (!t) status = 'not sent (email not set up)';
  else {
    try { await t.sendMail({ from: `QYBSL Umpires <${fromAddr()}>`, to, subject, text }); }
    catch (e) { status = 'failed'; error = e.message; }
  }
  await logOutbox({ channel: 'email', to, subject, body: text, status, error, ...meta });
}

async function sendText(to, body, meta = {}) {
  const num = toE164(to);
  if (!num) return;
  const s = await getSettings();
  let status = 'sent', error = null;
  if (ONLY && !ONLY.test(num)) status = 'not sent (test copy: only sends to John)';
  else if (!s.textsEnabled) status = 'not sent (texts turned off)';
  else if (DRY || !twilioReady()) status = 'not sent (texting not set up)';
  else {
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const form = new URLSearchParams({ To: num, Body: body });
      if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
      else form.set('From', process.env.TWILIO_FROM);
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64') },
        body: form
      });
      if (!r.ok) { status = 'failed'; error = (await r.text()).slice(0, 300); }
    } catch (e) { status = 'failed'; error = e.message; }
  }
  await logOutbox({ channel: 'text', to: num, body, status, error, ...meta });
}

// Message an umpire, with their parent copied.
// msg: { subject, text, sms (short text; omit for email only), kind, gameId }
async function toUmpire(person, msg) {
  const u = person.umpire || {};
  const meta = { kind: msg.kind, gameId: msg.gameId || null, person: person.email };
  const jobs = [
    sendEmail(person.email, msg.subject, msg.text, meta),
    u.parentEmail ? sendEmail(u.parentEmail, `[Parent copy] ${msg.subject}`, `This is a copy of a message sent to ${person.name}.\n\n${msg.text}`, meta) : null
  ];
  if (msg.sms) {
    jobs.push(sendText(person.mobile, msg.sms, meta));
    if (u.parentMobile) jobs.push(sendText(u.parentMobile, `(Copy for ${person.name.split(' ')[0]}'s parent) ${msg.sms}`, meta));
  }
  await Promise.allSettled(jobs.filter(Boolean));
}

// Message a coach or admin (no parent copy).
async function toAdult(person, msg) {
  const meta = { kind: msg.kind, gameId: msg.gameId || null, person: person.email };
  const jobs = [sendEmail(person.email, msg.subject, msg.text, meta)];
  if (msg.sms && person.mobile) jobs.push(sendText(person.mobile, msg.sms, meta));
  await Promise.allSettled(jobs);
}

// Who hears about emergencies and coverage gaps: the Director of Umpires plus
// the board admins.
async function alertRecipients() {
  const s = await getSettings();
  const emails = [...new Set([s.directorEmail, ...s.adminEmails].map(e => String(e || '').toLowerCase()).filter(Boolean))];
  const out = [];
  for (const e of emails) out.push((await store.get('people', e)) || { email: e, name: e, mobile: '' });
  return out;
}

async function toAlerts(msg) {
  const list = await alertRecipients();
  await Promise.allSettled(list.map(p => toAdult(p, msg)));
}

async function footer() {
  const s = await getSettings();
  return s.appUrl ? `\n\nOpen the umpire app: ${s.appUrl}` : '';
}

module.exports = { sendEmail, sendText, toUmpire, toAdult, toAlerts, alertRecipients, footer, toE164 };
