'use strict';

/**
 * Incidents and Expenses.
 *
 * Since 2026-09-15 this is two tabs. Incidents is the intake: the damage
 * drivers reported that nobody has opened a case for, and the form for a new
 * entry. Expenses is the ledger below, with the SM check and the CSV. A row is
 * either a damage case or a spare-part purchase; spare parts never visit a
 * workshop, so their date fields are switched off rather than left blank.
 *
 * The ledger:
 *
 * One line per damage: which van, when, what happened, when it was at the body
 * shop, what it cost, the photos and the invoice, and the Site Manager's
 * sign-off. Everything on the line is editable in place, because the natural
 * life of one of these rows is weeks: the van goes in on Monday, comes out on
 * Thursday, and the invoice turns up a fortnight later. A page that made you
 * open a detail view for each of those three edits would be a page nobody
 * keeps up to date.
 *
 * The table scrolls sideways below about 1100 px rather than wrapping: eleven
 * columns folded onto three lines stop being a line, and this is a desk page.
 */

const { page, esc, fmtDateTime } = require('./layout');

/* Drawn, like every other icon in this app. A camera and a sheet of paper at
   16 px; anything more detailed is a smudge, and an emoji is a font the
   machine may not have. */
const ICON = {
  camera: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
    '<path d="M3.5 8h4l1.5-2h6L16.5 8h4v11h-17z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  invoice: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
    '<path d="M5.5 3.5h9l4 4v13h-13z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<path d="M14 3.5v4.5h4.5M8.5 12h7M8.5 15.5h7M8.5 19h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
};

const LINKS = [
  { href: '/', text: 'Vehicles' },
  { href: '/qr', text: 'QR codes' },
  { href: '/admin', text: 'Admin' }
];

const EXPENSE_LABEL = { damage: 'Damage', parts: 'Spare parts' };
const HANDLER_LABEL = { okq8: 'OKQ8', inhouse: 'In-house' };

/** 12400 -> "12 400 kr". Space as the thousands separator; the money is SEK. */
function kr(n) {
  if (n === null || n === undefined || n === '') return '';
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  const whole = Math.round(v * 100) / 100;
  const [a, b] = whole.toFixed(2).split('.');
  const grouped = a.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return b === '00' ? `${grouped} kr` : `${grouped},${b} kr`;
}

/** The value an <input type="number"> wants: a plain dot-decimal, or empty. */
function numValue(n) {
  if (n === null || n === undefined || n === '') return '';
  const v = Number(n);
  return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '';
}

/**
 * Days off the road.
 *
 * Inclusive of both days: a van that went in on Monday and came out on Monday
 * was off the road for a day, not for none. Still at the shop counts up to
 * today and says so, because "how long has this been going on" is the question
 * that makes somebody ring the workshop.
 */
function days(inDate, outDate, today) {
  if (!inDate) return { text: '', open: false };
  const start = Date.parse(inDate + 'T00:00:00Z');
  const end = Date.parse((outDate || today) + 'T00:00:00Z');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return { text: '', open: false };
  const n = Math.round((end - start) / 86400000) + 1;
  return { text: outDate ? `${n} d` : `${n} d…`, open: !outDate, n };
}

function fileChip(f) {
  const label = f.kind === 'invoice' ? 'Invoice' : 'Photo';
  const name = f.filename || label;
  const size = f.byte_size ? ` (${Math.max(1, Math.round(f.byte_size / 1024))} kB)` : '';
  return `<span class="filechip file-${esc(f.kind)}">
      <a href="/admin/incidents/file/${esc(f.id)}" target="_blank" rel="noopener"
         title="${esc(name + size)}">${esc(label)}</a>
      <button class="filex" type="submit" title="Remove ${esc(name)}"
              formaction="/admin/incidents/file/${esc(f.id)}/delete">×</button>
    </span>`;
}

/**
 * The sign-off cell.
 *
 * Not a checkbox. A checkbox says "someone ticked this" and nothing else,
 * and the whole point of this column is that somebody put their name to a
 * figure. Approving is therefore: type a name, press OK -- and the row then
 * shows the name and the moment, which is what an auditor, an insurer or a
 * disagreement three months from now actually needs.
 */
function smCell(inc) {
  const history = inc.events && inc.events.length
    ? inc.events.map(e => {
        const what = e.action === 'ok' ? 'OK' :
          e.action === 'withdrawn' ? 'withdrawn' : 'reset (the cost changed)';
        return `${fmtDateTime(e.happened_at)} ${what}${e.who ? ' – ' + e.who : ''}`;
      }).join('\n')
    : '';
  const histAttr = history ? ` title="${esc(history)}"` : '';

  if (inc.sm_ok) {
    return `<div class="sm sm-ok"${histAttr}>
        <span class="sm-tick" aria-hidden="true">✓</span>
        <span class="sm-who">${esc(inc.sm_by || 'OK')}</span>
        <span class="sm-when">${esc(fmtDateTime(inc.sm_at))}</span>
        <button class="btn btn-ghost btn-sm" type="submit"
                formaction="/admin/incidents/${esc(inc.id)}/sm/withdraw">Undo</button>
      </div>`;
  }

  // No cost, no signature: approving an unknown amount is not an approval.
  if (inc.cost_sek === null) {
    return `<div class="sm sm-blocked"${histAttr}>
        <span class="muted">Waiting for cost</span>
      </div>`;
  }

  return `<div class="sm"${histAttr}>
      <input class="form-control sm-name" type="text" name="smBy" placeholder="Your name"
             autocomplete="name" maxlength="120">
      <button class="btn btn-primary btn-sm" type="submit"
              formaction="/admin/incidents/${esc(inc.id)}/sm">OK</button>
    </div>`;
}

function plateSelect(name, plates, current) {
  const opts = ['<option value="">Vehicle…</option>'].concat(plates.map(p =>
    `<option value="${esc(p)}"${p === current ? ' selected' : ''}>${esc(p)}</option>`)).join('');
  return `<select class="form-control inc-plate mono" name="${esc(name)}" required>${opts}</select>`;
}

function categorySelect(current) {
  return `<select class="form-control inc-cat" name="category" title="Damage or spare parts">${
    Object.entries(EXPENSE_LABEL).map(([v, l]) =>
      `<option value="${v}"${v === (current || 'damage') ? ' selected' : ''}>${esc(l)}</option>`).join('')
  }</select>`;
}

/* Blank until somebody picks. Deliberately not filled from the van's owner:
   a van rented from OKQ8 can still be repaired in-house, and a guessed value
   next to an invoice is worse than an empty one. */
function handlerSelect(current) {
  const opts = [['', '—'], ...Object.entries(HANDLER_LABEL)];
  return `<select class="form-control inc-by" name="handledBy" title="Who did the work">${
    opts.map(([v, l]) =>
      `<option value="${v}"${v === (current || '') ? ' selected' : ''}>${esc(l)}</option>`).join('')
  }</select>`;
}

/** The two workshop dates, switched off for spare parts. */
function shopDates(inc) {
  const parts = inc.category === 'parts';
  const off = parts ? ' disabled' : '';
  return `<input class="form-control inc-date inc-shop" type="date" name="shopIn" value="${esc(parts ? '' : inc.shop_in)}"
               title="${parts ? 'Spare parts have no workshop dates' : 'In at the workshop'}"${off}>
        <input class="form-control inc-date inc-shop" type="date" name="shopOut" value="${esc(parts ? '' : inc.shop_out)}"
               title="${parts ? 'Spare parts have no workshop dates' : 'Out of the workshop'}"${off}>`;
}

function row(inc, plates, today, ret) {
  const parts = inc.category === 'parts';
  const d = parts ? { text: '', open: false } : days(inc.shop_in, inc.shop_out, today);
  const photos = inc.files.filter(f => f.kind !== 'invoice');
  const invoices = inc.files.filter(f => f.kind === 'invoice');

  return `<div class="inc-line${inc.sm_ok ? ' inc-done' : ''}${parts ? ' inc-parts' : ''}">
      <form class="inc-row" method="post" enctype="multipart/form-data"
            action="/admin/incidents/${esc(inc.id)}">
        <input type="hidden" name="ret" value="${esc(ret)}">
        ${plateSelect('plate', plates, inc.plate)}
        ${categorySelect(inc.category)}
        <input class="form-control inc-date" type="date" name="occurredOn" value="${esc(inc.occurred_on)}" required>
        <input class="form-control inc-desc" type="text" name="description" maxlength="600"
               value="${esc(inc.description)}" placeholder="${parts ? 'Which part?' : 'What happened?'}" title="${esc(inc.description)}">
        <input class="form-control inc-driver" type="text" name="driverName" maxlength="120"
               value="${esc(inc.driver_name)}" placeholder="Driver" title="${esc(inc.driver_name)}">
        ${shopDates(inc)}
        <span class="inc-days${d.open ? ' open' : ''}" title="${parts ? 'Not applicable to spare parts' : d.open ? 'Still at the workshop' : 'Days off the road'}">${esc(d.text || '–')}</span>
        ${handlerSelect(inc.handled_by)}
        <input class="form-control inc-cost" type="number" name="cost" step="0.01" min="0"
               value="${esc(numValue(inc.cost_sek))}" placeholder="kr" title="Cost in SEK">
        <span class="inc-files">
          ${photos.map(fileChip).join('')}${invoices.map(fileChip).join('')}
          <label class="addfile" title="Add photo – choose a file, then press Save">${ICON.camera}<input type="file" name="photos" accept="image/*" multiple hidden></label>
          <label class="addfile" title="Add invoice – choose a file, then press Save">${ICON.invoice}<input type="file" name="invoices" accept="application/pdf,image/*" multiple hidden></label>
        </span>
        <span class="inc-sm">${smCell(inc)}</span>
        <span class="inc-actions">
          ${inc.submission_id ? `<a class="btn btn-ghost btn-sm" title="The check the damage was reported in"
             href="/admin/s/${esc(inc.submission_id)}" target="_blank" rel="noopener">Check</a>` : ''}
          <button class="btn btn-primary btn-sm" type="submit">Save</button>
          <button class="btn btn-danger btn-sm" type="submit"
                  formaction="/admin/incidents/${esc(inc.id)}/delete">Delete</button>
        </span>
      </form>
  </div>`;
}

/**
 * The column headings.
 *
 * Built from the same widths as the line rather than as a table header, which
 * is what they were at first: a <thead> over a flex row lines up for about a
 * week, and then somebody widens the cost field and "Files" is sitting over
 * the SM check. Same classes, same order, one place to change.
 */
function head() {
  return `<div class="inc-row inc-head">
      <span class="inc-plate">Vehicle</span>
      <span class="inc-cat">Category</span>
      <span class="inc-date">Date</span>
      <span class="inc-desc">Description</span>
      <span class="inc-driver">Driver</span>
      <span class="inc-date">Workshop in</span>
      <span class="inc-date">Out</span>
      <span class="inc-days">Days</span>
      <span class="inc-by">Handled by</span>
      <span class="inc-cost">Cost</span>
      <span class="inc-files">Files</span>
      <span class="inc-sm">SM check</span>
      <span class="inc-actions"></span>
    </div>`;
}

/** The form for a new entry, used on both tabs. */
function newEntry(plates, today, ret) {
  return `<div class="card">
    <div class="card-header">New entry
      <span class="step-tag">Damage or spare parts · lands on Expenses</span></div>
    <div class="card-body">
      <form class="inc-row" method="post" action="/admin/incidents" enctype="multipart/form-data">
        <input type="hidden" name="ret" value="${esc(ret)}">
        ${plateSelect('plate', plates, '')}
        ${categorySelect('damage')}
        <input class="form-control inc-date" type="date" name="occurredOn" value="${esc(today)}" required>
        <input class="form-control inc-desc" type="text" name="description" maxlength="600"
               placeholder="What happened?">
        <input class="form-control inc-driver" type="text" name="driverName" maxlength="120"
               placeholder="Driver">
        ${shopDates({ category: 'damage', shop_in: '', shop_out: '' })}
        ${handlerSelect('')}
        <input class="form-control inc-cost" type="number" name="cost" step="0.01" min="0" placeholder="kr">
        <span class="inc-files">
          <label class="addfile" title="Photos">${ICON.camera}<input type="file" name="photos" accept="image/*" multiple hidden></label>
          <label class="addfile" title="Invoices">${ICON.invoice}<input type="file" name="invoices" accept="application/pdf,image/*" multiple hidden></label>
        </span>
        <button class="btn btn-primary" type="submit">Add</button>
      </form>
    </div>
  </div>`;
}

/** The damage a driver reported that nobody has opened a case for yet. */
function pending(list) {
  if (!list.length) {
    return `<div class="card">
    <div class="card-header">Reported damage without an incident</div>
    <div class="card-body"><p class="muted" style="margin:0">Nothing waiting – every damage
      report from the drivers' checks in the last 60 days has an incident.</p></div>
  </div>`;
  }
  const rows = list.map(p => `<li>
      <form method="post" action="/admin/incidents/from-check/${esc(p.id)}" class="pending-row">
        <span class="mono pending-plate">${esc(p.plate)}</span>
        <span class="pending-date">${esc(p.day)}</span>
        <span class="pending-who">${esc(p.driver || '—')}</span>
        <span class="pending-what" title="${esc(p.text)}">${esc(p.text)}</span>
        ${p.photos ? `<span class="chip">${esc(p.photos)} ${p.photos === 1 ? 'photo' : 'photos'}</span>` : ''}
        <a class="btn btn-ghost btn-sm" href="/admin/s/${esc(p.id)}" target="_blank" rel="noopener">The check</a>
        <button class="btn btn-primary btn-sm" type="submit">Create incident</button>
      </form>
    </li>`).join('\n');

  return `<div class="card card-warn">
    <div class="card-header">Reported damage without an incident
      <span class="step-tag">${list.length} – from the drivers' checks in the last 60 days</span></div>
    <ul class="pending-list">
${rows}
    </ul>
  </div>`;
}

/* The only script on these pages, and it earns its place twice over.
   A file input that has been filled in looks exactly like an empty one, so
   somebody picks an invoice, sees nothing change, and never presses Save:
   this marks the button. And choosing Spare parts switches the two workshop
   dates off on that line. It only disables them -- a mis-click switched back
   to Damage must not lose dates already typed; the server is what clears
   them when a row is actually saved as spare parts. Everything still works
   without it. */
const SCRIPT = `<script>
(function () {
  var labels = document.querySelectorAll('.addfile');
  Array.prototype.forEach.call(labels, function (label) {
    var input = label.querySelector('input[type="file"]');
    if (!input) return;
    var original = label.getAttribute('title') || '';
    input.addEventListener('change', function () {
      var n = input.files ? input.files.length : 0;
      label.classList.toggle('staged', n > 0);
      label.setAttribute('title', n
        ? n + ' file(s) chosen – press Save to attach'
        : original);
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('select.inc-cat'), function (sel) {
    sel.addEventListener('change', function () {
      var form = sel.form, parts = sel.value === 'parts';
      Array.prototype.forEach.call(form.querySelectorAll('.inc-shop'), function (el) {
        el.disabled = parts;
        el.title = parts ? 'Spare parts have no workshop dates'
          : el.name === 'shopIn' ? 'In at the workshop' : 'Out of the workshop';
      });
      var desc = form.querySelector('.inc-desc');
      if (desc) desc.placeholder = parts ? 'Which part?' : 'What happened?';
    });
  });
})();
</script>`;

function incidentsPage({ plates, pendingChecks, counts, today, message, nav }) {
  const html = `  <div class="page-head">
    <h1>Incidents</h1>
    <div class="muted">${esc(pendingChecks.length)} ${pendingChecks.length === 1 ? 'damage report' : 'damage reports'} waiting</div>
  </div>
${nav}
${message ? `<div class="ok-msg no-print">${esc(message)}</div>` : ''}

  <p class="lede">The intake. Damage the drivers reported in their checks shows up here until
     somebody opens an incident for it; new entries can also be added by hand. Everything that
     follows – workshop dates, cost, invoices and the Site Manager's approval – is kept on
     <a href="/admin/expenses">Expenses</a>.</p>

${pending(pendingChecks)}

${newEntry(plates, today, '/admin/incidents')}

  <div class="card">
    <div class="card-header">On Expenses
      <span class="step-tag">${esc(counts.total)} ${counts.total === 1 ? 'entry' : 'entries'} ·
        ${esc(counts.waiting)} waiting for the SM check${counts.atShop ? ` · ${esc(counts.atShop)} at the workshop now` : ''}</span></div>
    <div class="card-body">
      <a class="btn btn-secondary" href="/admin/expenses">Open Expenses</a>
    </div>
  </div>`;

  return page({
    title: 'Incidents – admin', body: html, links: LINKS,
    bodyClass: 'wide', scripts: SCRIPT, lang: 'en', admin: true
  });
}

function expensesPage({ incidents, plates, filters, totals, today, message, nav }) {
  const ret = '/admin/expenses' + (filters.query || '');
  const rows = incidents.map(i => row(i, plates, today, ret)).join('\n');
  const opt = (v, l, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`;

  const html = `  <div class="page-head">
    <h1>Expenses</h1>
    <div class="muted">${esc(incidents.length)} ${incidents.length === 1 ? 'entry' : 'entries'}</div>
  </div>
${nav}
${message ? `<div class="ok-msg no-print">${esc(message)}</div>` : ''}

  <p class="lede">What the vans cost, one line each: damage with its workshop visit, and spare
     parts bought for them. Every line can be edited at any time – a case lives for weeks, and
     the invoice comes last of all. New damage reports arrive on <a href="/admin/incidents">Incidents</a>.</p>

  <form class="filters no-print" method="get" action="/admin/expenses">
    <div class="f"><label for="plate">Vehicle</label>
      <select class="form-control" id="plate" name="plate">
        <option value="">All</option>
        ${plates.map(p => opt(p, p, filters.plate)).join('')}
      </select></div>
    <div class="f"><label for="category">Category</label>
      <select class="form-control" id="category" name="category">
        ${opt('', 'All', filters.category)}${Object.entries(EXPENSE_LABEL).map(([v, l]) => opt(v, l, filters.category)).join('')}
      </select></div>
    <div class="f"><label for="by">Handled by</label>
      <select class="form-control" id="by" name="by">
        ${opt('', 'All', filters.handledBy)}${Object.entries(HANDLER_LABEL).map(([v, l]) => opt(v, l, filters.handledBy)).join('')}${opt('none', 'Not set', filters.handledBy)}
      </select></div>
    <div class="f"><label for="from">From</label>
      <input class="form-control" type="date" id="from" name="from" value="${esc(filters.from)}"></div>
    <div class="f"><label for="to">To</label>
      <input class="form-control" type="date" id="to" name="to" value="${esc(filters.to)}"></div>
    <div class="f"><label for="sm">SM check</label>
      <select class="form-control" id="sm" name="sm">
        ${opt('', 'All', filters.sm)}${opt('no', 'Waiting for OK', filters.sm)}${opt('yes', 'Approved', filters.sm)}
      </select></div>
    <button class="btn btn-primary" type="submit">Show</button>
    <a class="btn btn-ghost" href="/admin/expenses">Everything</a>
    <a class="btn btn-secondary" href="/admin/expenses.csv${esc(filters.query)}">Download CSV</a>
  </form>

  <div class="card">
    <div class="card-header">All expenses
      <span class="step-tag">${esc(totals.withCost)} with cost · ${esc(kr(totals.cost))} total
        (damage ${esc(kr(totals.damageCost) || '0 kr')} · spare parts ${esc(kr(totals.partsCost) || '0 kr')}) ·
        ${esc(totals.waiting)} waiting for the SM check${totals.atShop ? ` · ${esc(totals.atShop)} at the workshop now` : ''}</span></div>
    <div class="inc-scroll">
      <div class="inc-list">
${head()}
${rows || '<p class="muted" style="padding:20px">No entries match. Add one below – or create one from a reported damage on Incidents.</p>'}
      </div>
    </div>
  </div>

${newEntry(plates, today, ret)}

  <div class="card">
    <div class="card-header">About the SM check</div>
    <div class="card-body">
      <p>The Site Manager types their name and presses OK. The line keeps <strong>who</strong>
         and <strong>when</strong>, not just that somebody ticked it – the app has one shared
         admin login and cannot tell who is clicking, so the name is the only thing that makes
         the approval somebody's.</p>
      <p><strong>No cost, no approval.</strong> An OK on an unknown amount is not an approval.
         And if the cost is changed afterwards, the check is reset automatically – an approval
         holds for the amount that stood there when it was given.</p>
      <p><strong>Spare parts</strong> have no workshop visit, so their workshop dates are
         switched off and they never count as "at the workshop". <strong>Handled by</strong>
         says who did the work, OKQ8 or in-house; it stays blank until somebody picks.</p>
      <p class="muted">Both OKs and withdrawn OKs are kept with their time. Hover over the
         SM box to see the history.</p>
    </div>
  </div>`;

  return page({
    title: 'Expenses – admin', body: html, links: LINKS,
    // Wider than the rest of the app: see body.wide in app.css.
    bodyClass: 'wide', scripts: SCRIPT, lang: 'en', admin: true
  });
}

/** The confirmation page, as for every other delete in the app. */
function incidentDeletePage({ inc, ret, nav }) {
  const back = ret || '/admin/expenses';
  const html = `  <div class="page-head">
    <h1>Delete this entry?</h1>
    <div class="muted mono">${esc(inc.plate)} · ${esc(EXPENSE_LABEL[inc.category] || inc.category)} · ${esc(inc.occurred_on)}</div>
  </div>
${nav}

  <div class="card card-warn">
    <div class="card-header">This will be removed</div>
    <div class="card-body">
      <p>${esc(inc.description || '(no description)')}</p>
      <p>${esc(inc.files.length)} ${inc.files.length === 1 ? 'file' : 'files'} (photos and invoices)
         are deleted with the entry, as is the approval history.
         ${inc.sm_ok ? `<strong>This entry was approved by ${esc(inc.sm_by)} ${esc(fmtDateTime(inc.sm_at))}.</strong>` : ''}</p>
      <p>The check the damage was reported in is not affected – only this line.</p>
    </div>
  </div>

  <form method="post" action="/admin/incidents/${esc(inc.id)}/delete?confirm=1">
    <input type="hidden" name="ret" value="${esc(back)}">
    <div class="actions" style="justify-content:flex-start">
      <a class="btn btn-ghost" href="${esc(back)}">Cancel</a>
      <button class="btn btn-danger" type="submit">Delete the entry</button>
    </div>
  </form>`;

  return page({ title: 'Delete entry', body: html, links: LINKS, lang: 'en', admin: true });
}

module.exports = { incidentsPage, expensesPage, incidentDeletePage, kr, EXPENSE_LABEL, HANDLER_LABEL };
