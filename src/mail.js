'use strict';

/**
 * Sending the daily summary through Resend's HTTP API.
 *
 * Deliberately no SMTP library: one fetch to one endpoint, no dependency,
 * and nothing to install. Without RESEND_API_KEY the app runs exactly as
 * before and simply does not send -- the summary is still readable at
 * /admin/daily-summary, so a missing key degrades to "no mail", never to
 * a crash on a form a driver is trying to submit.
 */

const ENDPOINT = 'https://api.resend.com/emails';

function config() {
  return {
    key: (process.env.RESEND_API_KEY || '').trim(),
    to: (process.env.SUMMARY_TO || 'tobias.ekvall@instabee.com').trim(),
    // Resend only accepts a verified sender. onboarding@resend.dev works
    // out of the box but can only deliver to the account's own address, so
    // set MAIL_FROM to an address on your verified domain once you have one.
    from: (process.env.MAIL_FROM || 'Fleet 180 <onboarding@resend.dev>').trim()
  };
}

function isConfigured() {
  return Boolean(config().key);
}

async function send({ subject, html, text }) {
  const { key, to, from } = config();
  if (!key) return { sent: false, reason: 'RESEND_API_KEY saknas' };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, text })
  });

  const body = await res.text();
  if (!res.ok) {
    // The whole reason is worth keeping: Resend's errors say exactly what is
    // wrong (unverified sender, wrong key) and guessing wastes a day.
    return { sent: false, reason: `Resend ${res.status}: ${body.slice(0, 300)}` };
  }
  let id = '';
  try { id = (JSON.parse(body) || {}).id || ''; } catch { /* inte JSON */ }
  return { sent: true, id, to };
}

module.exports = { send, isConfigured, config };
