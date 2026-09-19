'use strict';
/**
 * The attention report: one page that says what is wrong with the vans.
 *
 * Read standing up, usually first thing, usually on a phone. So it is a list
 * of vehicles and under each one a list of sentences, worst first, and every
 * sentence carries the three things somebody needs before they can act on it:
 * what is wrong, how long it has been wrong, and who said so. Nothing is
 * behind a tab and nothing needs a second page load to read -- the only thing
 * folded away is what has already been dealt with.
 *
 * Vans with nothing wrong are named at the bottom rather than drawn as empty
 * cards. "Nothing to report on these eleven" is information; eleven empty
 * boxes between the ones that matter is not.
 */

const { page, esc } = require('./layout');
const { SEVERITY_LABEL, KIND_LABEL, WINDOW_DAYS } = require('../attention');
const { ownerChip } = require('./index');

const LINKS = [
  { href: '/', text: 'Vehicles' },
  { href: '/qr', text: 'QR codes' },
  { href: '/admin', text: 'Admin' }
];

/* Drawn, not emoji: Windows has no font for a good many of them and the
   admin side is read on whatever is to hand. Same rule as the flags. */
const ICON = {
  lamp: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
    '<path d="M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3z" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
    '<path d="M10 20h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  damage: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
    '<path d="M13 2 4 13h6l-1 9 9-11h-6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
    '<path d="M12 4l9 16H3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
    '<path d="M12 10v4M12 17v.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  nocheck: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
    '<rect x="4" y="3.5" width="16" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
    '<path d="M9 10l6 6M15 10l-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  tyre: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
    '<circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  tyredue: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
    '<path d="M12 7v5.2l3.4 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  shop: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
    '<path d="M3 17h18M5 17V9l7-4 7 4v8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
    '<path d="M10 17v-4h4v4" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>'
};

function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? '?' + s : '';
}

/**
 * Where a Fixed button comes back to.
 *
 * Carried in the form rather than taken from the Referer, which is dropped by
 * enough phone browsers that half the presses would land on an unfiltered
 * page with the item nowhere near where the person was looking.
 */
function ret(filters) {
  return '/admin/attention' + qs(filters);
}

/**
 * What the date on the right-hand end of the meta line MEANS.
 *
 * A tyre was not "last reported" and a van at the workshop was not reported
 * at all; both arrived here from somewhere that is not a driver saying
 * something. One noun per kind is the cheapest way to stop the page reading
 * as though it were generated.
 */
const LAST_WORD = {
  check: 'last reported', lamp: 'last reported', damage: 'last reported',
  nocheck: 'last out', tyre: 'measured', tyredue: 'due since', shop: 'in since'
};

/** "Reported 3 times on 2 days by Simon B, Ali K", when that is the truth. */
function saidBy(item) {
  const who = item.drivers.length
    ? ' by ' + item.drivers.slice(0, 4).map(esc).join(', ') +
      (item.drivers.length > 4 ? ` and ${item.drivers.length - 4} more` : '')
    : '';
  // Their own notes say it better: how many days a van went out unchecked,
  // how long it has been in the shop, how long a reading has been overdue.
  if (item.kind === 'nocheck' || item.kind === 'shop' || item.kind === 'tyredue') return '';
  if (item.kind === 'tyre') return who ? `Gauged${who}` : '';
  if (item.reports <= 1) return `Reported once${who}`;
  const days = item.days === item.reports ? '' : ` on ${item.days} days`;
  return `Reported ${item.reports} times${days}${who}`;
}

/** The little form under an item. A name, because one login is not a person. */
function fixForm(item, filters) {
  const id = 'fix-' + item.key.replace(/[^\w-]/g, '-');
  return `<details class="att-fix no-print" id="${esc(id)}">
    <summary>Mark as done</summary>
    <form method="post" action="/admin/attention/clear" class="att-fix-body">
      <input type="hidden" name="key" value="${esc(item.key)}">
      <input type="hidden" name="plate" value="${esc(item.plate)}">
      <input type="hidden" name="kind" value="${esc(item.kind)}">
      <input type="hidden" name="title" value="${esc(item.title)}">
      <input type="hidden" name="covers" value="${esc(item.lastSightingAt)}">
      <input type="hidden" name="ret" value="${esc(ret(filters))}">
      <label><span>Your name</span>
        <input class="form-control" name="who" required minlength="2" maxlength="120"
               autocomplete="name" placeholder="Who dealt with it"></label>
      <label class="att-grow"><span>What was done (optional)</span>
        <input class="form-control" name="note" maxlength="500"
               placeholder="New bulb fitted, booked in for Thursday…"></label>
      <button class="btn btn-primary btn-sm" type="submit">Done</button>
    </form>
    <p class="att-fix-hint">It comes straight back if a driver reports it again.</p>
  </details>`;
}

/** The second meta line, left out entirely when it would say nothing. */
function metaLine(item) {
  const photos = item.photos ? `${item.photos} photo${item.photos === 1 ? '' : 's'}` : '';
  const line = [saidBy(item), photos].filter(Boolean).join(' · ');
  return line ? `<div class="att-meta">${line}</div>` : '';
}

function itemRow(item, filters) {
  const kind = KIND_LABEL[item.kind] || item.kind;
  const last = item.sightings[item.sightings.length - 1];

  const tags = [
    `<span class="att-kind">${ICON[item.kind] || ICON.check}${esc(kind)}</span>`,
    item.newToday ? '<span class="att-tag att-new">New today</span>' : '',
    item.reopened ? '<span class="att-tag att-reopened">Reported again after being cleared</span>' : '',
    item.incidentId
      ? `<a class="att-tag att-case" href="/admin/expenses#row-${esc(item.incidentId)}">Case #${esc(item.incidentId)}</a>`
      : ''
  ].filter(Boolean).join('');

  /* The link is to the check itself, because the next question after "what
     is wrong" is always "let me see what they wrote" -- and the photos are
     on that page. Items that did not come from a check have no id and get
     no dead link. */
  const source = last.submissionId
    ? `<a href="/admin/s/${esc(last.submissionId)}">the check</a>`
    : '';

  return `<li class="att-item sev-${esc(item.severity)}">
    <div class="att-line">
      <span class="att-dot" title="${esc(SEVERITY_LABEL[item.severity] || '')}"></span>
      <div class="att-main">
        <div class="att-title">${esc(item.title)}</div>
        <div class="att-tags">${tags}</div>
        <div class="att-meta">Open ${esc(item.age)} · since ${esc(item.firstDay)}${
          item.lastDay !== item.firstDay
            ? ` · ${esc(LAST_WORD[item.kind] || 'last reported')} ${esc(item.lastDay)}` : ''
        }${source ? ' – ' + source : ''}</div>
        <div class="att-said">${esc(last.answer || '')}</div>
        ${metaLine(item)}
        ${item.note ? `<div class="att-note">${esc(item.note)}</div>` : ''}
        ${item.severity === 'info' ? '' : fixForm(item, filters)}
      </div>
    </div>
  </li>`;
}

function doneRow(item, filters) {
  const c = item.clear || {};
  const when = String(c.cleared_at ? new Date(c.cleared_at).toISOString().slice(0, 10) : '');
  return `<li class="att-done-row">
    <div>
      <strong>${esc(item.title)}</strong>
      <div class="att-meta">Done by ${esc(c.cleared_by || '—')} on ${esc(when)}${
        c.note ? ' · ' + esc(c.note) : ''}</div>
    </div>
    <form method="post" action="/admin/attention/clear/${esc(c.id)}/withdraw" class="att-undo no-print">
      <input type="hidden" name="ret" value="${esc(ret(filters))}">
      <input class="form-control" name="who" required minlength="2" maxlength="120" placeholder="Your name">
      <button class="btn btn-ghost btn-sm" type="submit">Reopen</button>
    </form>
  </li>`;
}

function vehicleCard(v, filters) {
  const badge = v.counts.high
    ? `<span class="att-count att-count-high">${esc(v.counts.high)} to act on now</span>`
    : v.counts.action
      ? `<span class="att-count att-count-normal">${esc(v.counts.action)} open</span>`
      : v.counts.open
        ? '<span class="att-count att-count-info">for information</span>'
        // The card is here for what was signed off, not for what is wrong.
        : '<span class="att-count att-count-info">nothing open</span>';

  const done = v.done.length
    ? `<details class="att-done no-print"><summary>${esc(v.done.length)} dealt with in the last 30 days</summary>
         <ul class="att-done-list">${v.done.map(i => doneRow(i, filters)).join('')}</ul></details>`
    : '';

  return `<div class="card att-card" id="v-${esc(v.plate)}">
    <div class="card-header att-head">
      <span class="att-plate mono">${esc(v.plate)}</span>
      ${ownerChip(v.owner)}
      ${badge}
      ${v.counts.newToday ? `<span class="att-tag att-new">${esc(v.counts.newToday)} new today</span>` : ''}
      <span class="att-head-links no-print">
        <a href="/admin?plate=${esc(v.plate)}">Checks</a>
        <a href="/admin/wheels?plate=${esc(v.plate)}">Tyres</a>
        <a href="/admin/expenses?plate=${esc(v.plate)}">Expenses</a>
      </span>
    </div>
    <ul class="att-list">${v.items.map(i => itemRow(i, filters)).join('')}</ul>
    ${done}
  </div>`;
}

function attentionPage({ report, filters = {}, message = '', nav = '' }) {
  const c = report.counts;

  /* A van whose last fault was signed off this morning still gets a card, so
     that what was done is where somebody would look for it -- and so that
     taking a sign-off back does not first require guessing which of the
     "nothing to report" vans it was hiding under. */
  const busy = report.vehicles.filter(v => v.counts.open || v.done.length);
  const clear = report.vehicles.filter(v => !v.counts.open && !v.done.length);

  const cards = busy.length
    ? busy.map(v => vehicleCard(v, filters)).join('\n')
    : `<div class="card"><div class="card-body att-none">
         Nothing open on any of the ${esc(c.fleet)} vehicles.
         Everything the drivers have flagged in the last ${esc(WINDOW_DAYS)} days has been dealt with.
       </div></div>`;

  const clearLine = clear.length
    ? `<p class="att-clear">Nothing to report on ${clear.length} of ${esc(c.fleet)}:
        ${clear.map(v => `<span class="mono">${esc(v.plate)}</span>`).join(' ')}</p>`
    : '';

  /* The one thing on this page that is about right now rather than about
     what is outstanding. Deliberately not items: a van assigned at seven
     whose driver has not scanned yet is not a fault, and a report that cries
     wolf every morning is a report nobody reads by Thursday. */
  const today = report.todayOutstanding.length
    ? `<div class="warn att-today no-print">
         <strong>${esc(report.todayOutstanding.length)} of today's vans have not been checked yet</strong> —
         ${report.todayOutstanding.map(t =>
           `<span class="mono">${esc(t.plate)}</span>${t.driver ? ' (' + esc(t.driver) + ')' : ''}`).join(', ')}.
         <span class="muted">Counted as a fault only once the day is over.</span>
       </div>`
    : '';

  const tallies = [
    { key: '', label: 'Everything', n: c.open },
    { key: 'high', label: 'Act now', n: c.high },
    { key: 'action', label: 'Needs action', n: c.action },
    { key: 'new', label: 'New today', n: c.newToday }
  ].map(t => `<a class="att-tally${filters.show === t.key || (!filters.show && !t.key) ? ' on' : ''}"
      href="/admin/attention${qs({ ...filters, show: t.key })}">
      <strong>${esc(t.n)}</strong><span>${esc(t.label)}</span></a>`).join('');

  const plateOptions = ['<option value="">All vehicles</option>'].concat(
    report.vehicles.map(v =>
      `<option value="${esc(v.plate)}"${filters.plate === v.plate ? ' selected' : ''}>${esc(v.plate)}${
        v.counts.open ? ` (${v.counts.open})` : ''}</option>`)).join('');

  const body = `  <div class="page-head">
    <h1>What needs attention</h1>
    <div class="muted">${esc(report.today)}</div>
  </div>
${nav}
${message ? `<div class="ok-msg no-print">${esc(message)}</div>` : ''}

  <p class="lede">Everything still outstanding on the vans, built from the safety checks the
    drivers file, the days a van went out unchecked, the workshop and the tread readings.
    An item stays here until somebody marks it done, and comes back if it is reported again.</p>

  <div class="att-tallies">${tallies}</div>
  ${today}

  <form class="filters no-print" method="get" action="/admin/attention">
    <input type="hidden" name="show" value="${esc(filters.show || '')}">
    <div class="f"><label for="plate">Vehicle</label>
      <select class="form-control" id="plate" name="plate">${plateOptions}</select></div>
    <button class="btn btn-primary" type="submit">Filter</button>
    <a class="btn btn-ghost" href="/admin/attention">Clear</a>
    <a class="btn btn-secondary" href="/admin/attention.csv${qs(filters)}">Download CSV</a>
    <button class="btn btn-ghost" type="button" onclick="window.print()">Print</button>
  </form>

  <p class="att-window muted">${esc(c.open)} open on ${esc(c.vehicles)} of ${esc(c.fleet)} vehicles${
    c.newToday ? ` · ${esc(c.newToday)} first reported today` : ''}${
    c.reopened ? ` · ${esc(c.reopened)} reported again after being cleared` : ''}${
    c.done ? ` · ${esc(c.done)} dealt with in the last 30 days` : ''}.
    Reports are read ${esc(WINDOW_DAYS)} days back (from ${esc(report.window.from)}).</p>

${cards}

${clearLine}`;

  return page({
    title: `What needs attention – ${report.today}`,
    body, links: LINKS, lang: 'en', admin: true, bodyClass: 'wide'
  });
}

module.exports = { attentionPage };
