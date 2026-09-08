'use strict';

/**
 * The daily digest: who checked their vehicle, what they flagged, and which
 * vehicles nobody touched. Built here as data so the same figures feed the
 * email, the preview page and the extension's day view -- three renderings
 * of one calculation, never three calculations.
 */

const { isAnswerable, isAlerting, formatAnswer } = require('./fields');
const { normName } = require('./stats');

const STOCKHOLM = 'Europe/Stockholm';

/** YYYY-MM-DD for a date in Swedish local time, not UTC. */
function dayKey(d = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: STOCKHOLM, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
}

function clockTime(d) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: STOCKHOLM, hour: '2-digit', minute: '2-digit'
  }).format(new Date(d));
}

/** The hour, 0-23, in Swedish local time. */
function localHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat('sv-SE', {
    timeZone: STOCKHOLM, hour: '2-digit', hour12: false
  }).format(d));
}

/**
 * One day's picture.
 *
 * `fallback` is the default form's questions, used for checks submitted
 * before the form editor existed and therefore carrying no snapshot.
 */
function buildDay({ date, submissions, vehicles, fallback = [], assignments = [] }) {
  const checks = [];
  const issues = [];

  // Checks saved before the snapshot carried alert_on have no polarity of
  // their own. Rather than reporting them as clean -- which is the dangerous
  // direction to be wrong in -- borrow the rule from today's question of the
  // same name.
  const rules = new Map(fallback.map(f => [f.name, f.alert_on || f.alertOn || []]));
  const withRule = q => (Array.isArray(q.alert_on) && q.alert_on.length)
    ? q : { ...q, alert_on: rules.get(q.name) || [] };

  for (const s of submissions) {
    const questions = (s.questions && s.questions.length ? s.questions : fallback).map(withRule);
    const answers = s.answers || {};
    const flags = [];

    for (const q of questions) {
      if (!isAnswerable(q)) continue;
      const value = answers[q.name];
      if (!isAlerting(q, value)) continue;
      flags.push({ question: q.label, answer: formatAnswer(q, value) });
    }

    const check = {
      id: String(s.id),
      plate: s.plate,
      driver: s.driver_name || '',
      route: s.route || '',
      odometer: s.odometer || '',
      at: s.submitted_at,
      time: clockTime(s.submitted_at),
      photos: s.photo_count || 0,
      lang: s.lang || 'sv',
      flags
    };
    checks.push(check);
    for (const f of flags) issues.push({ ...f, plate: s.plate, driver: check.driver, time: check.time, id: check.id });
  }

  const checkedPlates = new Set(checks.map(c => c.plate));
  const missing = vehicles.filter(v => !checkedPlates.has(v.plate)).map(v => v.plate);
  const doubled = [...checkedPlates].filter(p => checks.filter(c => c.plate === p).length > 1);

  /* The day's assignments, each answered: did that driver file a check?
     Matched on the driver's name rather than the plate, because vans get
     swapped in the yard and the question is whether the person did their
     check, not whether they ended up in the van the planner picked. */
  const byDriver = new Map();
  for (const c of checks) {
    const key = normName(c.driver);
    if (!key) continue;
    if (!byDriver.has(key)) byDriver.set(key, []);
    byDriver.get(key).push(c);
  }
  const seen = new Map();
  const assigned = assignments.map(a => {
    const key = normName(a.driver);
    const filed = byDriver.get(key) || [];
    const used = seen.get(key) || 0;
    const check = filed[used] || null;
    if (check) seen.set(key, used + 1);
    return {
      plate: a.plate, driver: a.driver, route: a.route || '', type: a.type || '',
      done: Boolean(check),
      checkedPlate: check ? check.plate : '',
      time: check ? check.time : '',
      flags: check ? check.flags.length : 0
    };
  });
  const assignedDone = assigned.filter(a => a.done).length;

  return {
    date,
    checks,
    issues,
    missing,
    doubled,
    assigned,
    counts: {
      checks: checks.length,
      vehicles: vehicles.length,
      checked: checkedPlates.size,
      missing: missing.length,
      issues: issues.length,
      photos: checks.reduce((n, c) => n + c.photos, 0),
      assigned: assigned.length,
      assignedDone,
      assignedMissing: assigned.length - assignedDone
    }
  };
}

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** The email body. Deliberately plain: it is read on a phone at 6am. */
function renderHtml(day, baseUrl) {
  const link = (path, text) => `<a href="${esc(baseUrl)}${esc(path)}" style="color:#1b6ec2">${esc(text)}</a>`;

  const issueRows = day.issues.length
    ? day.issues.map(i => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e6e6e6;white-space:nowrap"><strong>${esc(i.plate)}</strong></td>
        <td style="padding:6px 10px;border-bottom:1px solid #e6e6e6">${esc(i.question)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e6e6e6"><strong>${esc(i.answer)}</strong></td>
        <td style="padding:6px 10px;border-bottom:1px solid #e6e6e6;white-space:nowrap">${esc(i.driver)} ${esc(i.time)}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" style="padding:10px;color:#6c757d">Inget att åtgärda rapporterat.</td></tr>`;

  const checkRows = day.checks.length
    ? day.checks.map(c => `<tr>
        <td style="padding:5px 10px;border-bottom:1px solid #eee;white-space:nowrap"><strong>${esc(c.plate)}</strong></td>
        <td style="padding:5px 10px;border-bottom:1px solid #eee">${esc(c.driver || '—')}</td>
        <td style="padding:5px 10px;border-bottom:1px solid #eee">${esc(c.route || '—')}</td>
        <td style="padding:5px 10px;border-bottom:1px solid #eee;white-space:nowrap">${esc(c.time)}</td>
        <td style="padding:5px 10px;border-bottom:1px solid #eee;white-space:nowrap">${c.flags.length ? esc(c.flags.length) + ' ⚠' : ''}${c.photos ? ' ' + esc(c.photos) + ' 📷' : ''}</td>
      </tr>`).join('')
    : `<tr><td colspan="5" style="padding:10px;color:#6c757d">Ingen kontroll inskickad.</td></tr>`;

  const assignedRows = (day.assigned || []).length
    ? day.assigned.map(a => `<tr>
        <td style="padding:5px 10px;border-bottom:1px solid #eee;white-space:nowrap"><strong>${esc(a.plate)}</strong></td>
        <td style="padding:5px 10px;border-bottom:1px solid #eee">${esc(a.driver)}</td>
        <td style="padding:5px 10px;border-bottom:1px solid #eee">${esc(a.route || '—')}</td>
        <td style="padding:5px 10px;border-bottom:1px solid #eee;white-space:nowrap">${a.done
          ? `<span style="color:#256b38">✓ ${esc(a.time)}</span>` +
            (a.checkedPlate && a.checkedPlate !== a.plate ? ` <span style="color:#6c757d">(${esc(a.checkedPlate)})</span>` : '')
          : '<span style="color:#a33">ingen kontroll</span>'}</td>
      </tr>`).join('')
    : '';

  const assignedBlock = (day.assigned || []).length ? `
  <h2 style="font-size:16px;margin:22px 0 8px">Dagens tilldelning
    <span style="font-weight:400;color:#6c757d;font-size:13px">
      – ${esc(day.counts.assignedDone)} av ${esc(day.counts.assigned)} har gjort sin kontroll</span></h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px;background:#fff;border:1px solid #e6e6e6">
    ${assignedRows}
  </table>` : '';

  return `<!DOCTYPE html><html lang="sv"><body style="margin:0;padding:0;background:#f4f5f7">
<div style="max-width:680px;margin:0 auto;padding:20px;font-family:Helvetica,Arial,sans-serif;color:#212529">
  <p style="margin:0 0 4px;font-size:13px;color:#6c757d">Fleet 180 · säkerhetskontroll</p>
  <h1 style="margin:0 0 14px;font-size:22px;font-weight:600">${esc(day.date)}</h1>

  <p style="margin:0 0 18px;font-size:15px;line-height:1.6">
    <strong>${esc(day.counts.checks)}</strong> kontroller från
    <strong>${esc(day.counts.checked)}</strong> av ${esc(day.counts.vehicles)} fordon.
    ${day.counts.issues
      ? `<strong style="color:#a33">${esc(day.counts.issues)} punkter att åtgärda.</strong>`
      : 'Inget rapporterat att åtgärda.'}
    ${day.counts.missing ? `<br>Utan kontroll: <strong>${esc(day.missing.join(', '))}</strong>.` : ''}
    ${day.doubled.length ? `<br>Flera kontroller samma dag: ${esc(day.doubled.join(', '))}.` : ''}
  </p>

  ${assignedBlock}

  <h2 style="font-size:16px;margin:22px 0 8px">Att åtgärda</h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px;background:#fff;border:1px solid #e6e6e6">
    ${issueRows}
  </table>

  <h2 style="font-size:16px;margin:22px 0 8px">Inskickade kontroller</h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px;background:#fff;border:1px solid #e6e6e6">
    ${checkRows}
  </table>

  <p style="margin:22px 0 0;font-size:13px;color:#6c757d">
    ${link('/admin', 'Öppna administrationen')} ·
    ${link('/admin/export.csv?from=' + day.date + '&to=' + day.date, 'Dagens CSV')}
  </p>
</div></body></html>`;
}

/** Plain-text alternative, for mail clients that prefer it. */
function renderText(day) {
  const lines = [
    `Fleet 180 – säkerhetskontroll ${day.date}`,
    `${day.counts.checks} kontroller från ${day.counts.checked} av ${day.counts.vehicles} fordon.`,
    ''
  ];
  if ((day.assigned || []).length) {
    lines.push(`TILLDELNING (${day.counts.assignedDone}/${day.counts.assigned} inlämnade):`);
    for (const a of day.assigned) {
      lines.push(`  ${a.plate}  ${a.driver}  ${a.route || '—'}  ` +
        (a.done ? `OK ${a.time}` : 'INGEN KONTROLL'));
    }
    lines.push('');
  }
  lines.push('ATT ÅTGÄRDA:');
  if (day.issues.length) {
    for (const i of day.issues) lines.push(`  ${i.plate}  ${i.question} -> ${i.answer}  (${i.driver} ${i.time})`);
  } else lines.push('  inget rapporterat');
  lines.push('', 'INSKICKADE:');
  if (day.checks.length) {
    for (const c of day.checks) {
      lines.push(`  ${c.plate}  ${c.driver || '—'}  ${c.route || '—'}  ${c.time}` +
        (c.flags.length ? `  (${c.flags.length} att åtgärda)` : ''));
    }
  } else lines.push('  ingen');
  if (day.missing.length) lines.push('', `UTAN KONTROLL: ${day.missing.join(', ')}`);
  return lines.join('\n');
}

function subject(day) {
  const parts = [`Fleet 180 ${day.date}: ${day.counts.checks} kontroller` +
    (day.counts.assigned ? ` (${day.counts.assignedDone}/${day.counts.assigned} tilldelade)` : '')];
  if (day.counts.issues) parts.push(`${day.counts.issues} att åtgärda`);
  if (day.counts.missing) parts.push(`${day.counts.missing} utan kontroll`);
  return parts.join(', ');
}

module.exports = { buildDay, renderHtml, renderText, subject, dayKey, localHour, clockTime };
