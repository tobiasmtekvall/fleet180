'use strict';
/**
 * License control (Box) -- one admin tab. Pick a route from the newest day's
 * box assignment and open the "Arrival Inspection Box" Google form with the
 * terminal, plate, route, courier and the seven inspection answers filled in.
 *
 * Works without JavaScript: the table under the picker has a ready link per
 * route. The script only keeps the big button in step with the picker and
 * the four editable fields.
 */

const { page, esc, fmtDateTime } = require('./layout');
const licence = require('../licence');

const LINKS = [
  { href: '/', text: 'Vehicles' },
  { href: '/qr', text: 'QR codes' },
  { href: '/admin', text: 'Admin' }
];

// JSON inside a <script>: a "</script>" in a driver name must not end it.
const json = v => JSON.stringify(v).replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function optionLabel(o) {
  return `${o.route || '(no route)'} — ${o.plate} — ${o.courier || o.driver}`;
}

function licencePage({ days, date, options, message, nav, newest, today }) {
  const first = options[0] || null;
  const firstValues = first ? {
    terminal: first.terminal, registration: first.plate, route: first.route, courier: first.courier
  } : {};
  const dayInfo = days.find(d => d.date === date);
  const notNewest = newest && date !== newest;

  const dayMenu = days.length ? `
  <form class="filters dl-day no-print" method="get" action="/admin/license">
    <div class="f"><label for="dl-day">Day</label>
      <select class="form-control" id="dl-day" name="date" onchange="this.form.submit()">
        ${days.map(d => `<option value="${esc(d.date)}"${d.date === date ? ' selected' : ''}>${
          esc(d.date)}${d.date === newest ? ' (newest)' : ''} · ${esc(d.n)} ${d.n === 1 ? 'route' : 'routes'}</option>`).join('')}
      </select></div>
    <noscript><button class="btn btn-primary" type="submit">Show</button></noscript>
  </form>` : '';

  const picker = first ? `
  <div class="card dl-card">
    <div class="card-header">Fill the form for one route
      <span class="step-tag">${esc(date)}${dayInfo && dayInfo.pushed_at ? ' · pushed ' + esc(fmtDateTime(dayInfo.pushed_at)) : ''}</span></div>
    <div class="card-body">
      ${notNewest ? `<p class="dl-warn">This is not the newest day Fleet 180 has (${esc(newest)}).</p>` : ''}
      ${today && date !== today ? `<p class="dl-warn">These are the routes for <strong>${esc(date)}</strong>,
        not today (${esc(today)})${date > today ? ' – the plan for a coming day' : ''}. Pick another day above if
        that is not the one you are checking.</p>` : ''}
      <div class="dl-grid">
        <label for="dl-route">Route</label>
        <select class="form-control" id="dl-route">
          ${options.map((o, i) => `<option value="${i}">${esc(optionLabel(o))}</option>`).join('')}
        </select>
        <label for="dl-terminal">Terminal</label>
        <select class="form-control" id="dl-terminal">
          <option value="">— not set (Terminal will be left empty) —</option>
          ${licence.TERMINALS.map(t => `<option value="${esc(t)}"${t === firstValues.terminal ? ' selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
        <label for="dl-registration">Registration number</label>
        <input class="form-control mono" id="dl-registration" type="text" maxlength="16" autocomplete="off"
               value="${esc(firstValues.registration)}">
        <label for="dl-route-no">Route number</label>
        <input class="form-control mono" id="dl-route-no" type="text" maxlength="60" autocomplete="off"
               value="${esc(firstValues.route)}">
        <label for="dl-courier">Courier/Company name</label>
        <input class="form-control" id="dl-courier" type="text" maxlength="200" autocomplete="off"
               value="${esc(firstValues.courier)}">
      </div>
      <p class="dl-hint muted" id="dl-hint"></p>
      <p><a class="btn btn-primary" id="dl-go" target="_blank" rel="noopener"
            href="${esc(licence.prefillUrl(firstValues))}">Open prefilled form</a></p>
      <p class="dl-warn">The seven inspection questions – the two tailgate-lift questions included –
        are answered <strong>Yes</strong> in the link. They are your judgement about the driver and the
        van in front of you, not data Fleet 180 holds: read each one on the form and correct any that is
        wrong before <em>Skicka</em>. Nothing is ever sent from here.</p>
      <p class="muted dl-small">If the form opens showing an earlier draft instead of these values,
        Google has ignored the link – that happens when your Google account already has a draft of this
        form. Clear it with <em>Rensa formulär</em> at the bottom of the form, then open the link again.</p>
    </div>
  </div>` : `
  <div class="card"><div class="card-body">
    <p><strong>No box assignment has reached Fleet 180${days.length ? ' for this day' : ' yet'}.</strong>
       In Route Suite, open <em>Vehicles → Assign routes</em>, run the day and tick
       <em>Send this list to Fleet 180</em>. The routes appear here as soon as it arrives.</p>
  </div></div>`;

  const table = options.length ? `
  <div class="card">
    <div class="card-header">Every route on ${esc(date)}
      <span class="step-tag">${esc(options.length)} with a van</span></div>
    <div class="dl-scroll"><table class="table dl-table">
      <thead><tr><th>Route</th><th>Registration</th><th>Courier/Company</th><th>Terminal</th><th></th></tr></thead>
      <tbody>${options.map(o => `<tr>
        <td class="mono">${esc(o.route || '—')}</td>
        <td class="mono" style="font-weight:700">${esc(o.plate)}</td>
        <td>${esc(o.courier || o.driver)}</td>
        <td>${o.terminal ? esc(o.terminal) : '<span class="muted">—</span>'}</td>
        <td><a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="${esc(licence.prefillUrl({
          terminal: o.terminal, registration: o.plate, route: o.route, courier: o.courier }))}">Open form</a></td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="card-body muted dl-small">Only routes that were given a van are listed – a 3PL route drives
      its own vehicle and is not in the assignment. Open the form from here and type its plate.</div>
  </div>` : '';

  const html = `  <div class="page-head">
    <h1>License control – Box</h1>
    <div class="muted">Arrival Inspection Box · pre-filled from the box assignment</div>
  </div>
${nav}
${message ? `<div class="ok-msg no-print">${esc(message)}</div>` : ''}
  <p class="lede">Pick a route and press <strong>Open prefilled form</strong>. The routes, vans and drivers
    are the box assignment Route Suite sent for the day – the newest day opens first. Terminal comes from
    the route (JKP → Jönköping), the courier is the name Planday has on the route with its staffing
    company, and every field can be changed before the form is opened.</p>
${dayMenu}
${picker}
${table}`;

  const script = first ? `<script>
(function () {
  var OPTS = ${json(options)};
  var BASE = ${json(licence.FORM_BASE)};
  var ENTRY = ${json(licence.ENTRY)};
  var YES = ${json(licence.INSPECTION.map(q => q.entryId))};
  var TERMINALS = ${json(licence.TERMINALS)};
  var $ = function (id) { return document.getElementById(id); };
  var sel = $('dl-route'), term = $('dl-terminal'), reg = $('dl-registration'),
      route = $('dl-route-no'), cour = $('dl-courier'), go = $('dl-go'), hint = $('dl-hint');
  function url() {
    var p = new URLSearchParams();
    p.set('usp', 'pp_url');
    if (TERMINALS.indexOf(term.value) >= 0) p.set('entry.' + ENTRY.terminal, term.value);
    if (reg.value.trim()) p.set('entry.' + ENTRY.registration, reg.value.trim());
    if (route.value.trim()) p.set('entry.' + ENTRY.route, route.value.trim());
    if (cour.value.trim()) p.set('entry.' + ENTRY.courier, cour.value.trim());
    YES.forEach(function (id) { p.set('entry.' + id, 'Yes'); });
    return BASE + '?' + p.toString();
  }
  function refresh() {
    go.href = url();
    var missing = [];
    if (!term.value) missing.push('Terminal');
    if (!reg.value.trim()) missing.push('Registration number (the form requires it)');
    hint.textContent = missing.length ? 'Not set: ' + missing.join(', ') + '.' : '';
    hint.className = 'dl-hint ' + (missing.length ? 'dl-warn' : 'muted');
  }
  sel.addEventListener('change', function () {
    var o = OPTS[+sel.value]; if (!o) return;
    term.value = o.terminal || '';
    reg.value = o.plate || '';
    route.value = o.route || '';
    cour.value = o.courier || o.driver || '';
    refresh();
  });
  [term, reg, route, cour].forEach(function (el) {
    el.addEventListener('input', refresh); el.addEventListener('change', refresh);
  });
  refresh();
})();
</script>` : '';

  return page({
    title: 'License control – admin', body: html, links: LINKS,
    lang: 'en', admin: true, scripts: script
  });
}

module.exports = { licencePage };
