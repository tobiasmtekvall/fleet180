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
// Who did the work on a van. 'inhouse' was renamed 'own' on 2026-09-16.
const HANDLER_LABEL = { okq8: 'OKQ8', own: 'Own' };
// The three sections of Expenses. Only Vehicles has plates and workshops.
const SCOPE_LABEL = { vehicle: 'Vehicles', tool: 'Tools', misc: 'Misc' };
const SCOPES = Object.keys(SCOPE_LABEL);
const DESC_HINT = {
  damage: 'What happened?', parts: 'Which part?',
  tool: 'Which tool? e.g. torque wrench, repaired', misc: 'What was it for?'
};

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

/* OKQ8 or Own. Blank until somebody picks, and deliberately not filled from
   the van's owner: a guessed value next to an invoice is worse than none. */
function handlerSelect(current, id = '') {
  const opts = [['', '—'], ...Object.entries(HANDLER_LABEL)];
  return `<select class="form-control inc-by" name="handledBy"${id ? ` id="${id}"` : ''} title="OKQ8 or Own">${
    opts.map(([v, l]) =>
      `<option value="${v}"${v === (current || '') ? ' selected' : ''}>${esc(l)}</option>`).join('')
  }</select>`;
}

/** The two workshop dates, switched off for spare parts. */
function shopDates(inc, ids = ['', '']) {
  const parts = inc.category === 'parts';
  const off = parts ? ' disabled' : '';
  const id = i => (ids[i] ? ` id="${ids[i]}"` : '');
  return [
    `<input class="form-control inc-date inc-shop" type="date" name="shopIn"${id(0)} value="${esc(parts ? '' : inc.shop_in)}"
               title="${parts ? 'Spare parts have no workshop dates' : 'In at the workshop'}"${off}>`,
    `<input class="form-control inc-date inc-shop" type="date" name="shopOut"${id(1)} value="${esc(parts ? '' : inc.shop_out)}"
               title="${parts ? 'Spare parts have no workshop dates' : 'Out of the workshop'}"${off}>`
  ];
}

function filesCell(inc) {
  const photos = inc.files.filter(f => f.kind !== 'invoice');
  const invoices = inc.files.filter(f => f.kind === 'invoice');
  return `<span class="inc-files">
          ${photos.map(fileChip).join('')}${invoices.map(fileChip).join('')}
          <label class="addfile" title="Add photo – choose a file, then press Save">${ICON.camera}<input type="file" name="photos" accept="image/*" multiple hidden></label>
          <label class="addfile" title="Add invoice – choose a file, then press Save">${ICON.invoice}<input type="file" name="invoices" accept="application/pdf,image/*" multiple hidden></label>
        </span>`;
}

function actionsCell(inc) {
  return `<span class="inc-actions">
          ${inc.submission_id ? `<a class="btn btn-ghost btn-sm" title="The check the damage was reported in"
             href="/admin/s/${esc(inc.submission_id)}" target="_blank" rel="noopener">Check</a>` : ''}
          <button class="btn btn-primary btn-sm" type="submit">Save</button>
          <button class="btn btn-danger btn-sm" type="submit"
                  formaction="/admin/incidents/${esc(inc.id)}/delete">Delete</button>
        </span>`;
}

/**
 * The fold-out under a line: what does not fit on it. It posts with the
 * line's own Save. The summary says what is filled in, so a line with an
 * invoice number does not look like one without.
 */
function moreCell(inc, withSupplier) {
  const filled = [];
  if (withSupplier && inc.supplier) filled.push(inc.supplier);
  if (withSupplier && inc.invoice_no) filled.push('inv. ' + inc.invoice_no);
  if (inc.note) filled.push('note');
  const label = withSupplier ? 'Supplier, invoice no. and note' : 'Note';
  return `<details class="inc-more">
        <summary>${esc(label)}${filled.length ? ` <span class="muted">· ${esc(filled.join(' · '))}</span>` : ''}</summary>
        <div class="inc-more-body">
          ${withSupplier ? `<label class="nf-field"><span>Supplier / workshop</span>
            <input class="form-control" type="text" name="supplier" maxlength="160" value="${esc(inc.supplier)}"></label>
          <label class="nf-field"><span>Invoice no.</span>
            <input class="form-control" type="text" name="invoiceNo" maxlength="80" value="${esc(inc.invoice_no)}"></label>` : ''}
          <label class="nf-field nf-grow"><span>Note</span>
            <textarea class="form-control" name="note" rows="2" maxlength="2000">${esc(inc.note)}</textarea></label>
        </div>
      </details>`;
}

function vehicleRow(inc, plates, today, ret) {
  const parts = inc.category === 'parts';
  const d = parts ? { text: '', open: false } : days(inc.shop_in, inc.shop_out, today);
  const [shopIn, shopOut] = shopDates(inc);
  return `<div class="inc-line${inc.sm_ok ? ' inc-done' : ''}${parts ? ' inc-parts' : ''}">
      <form class="inc-form" method="post" enctype="multipart/form-data"
            action="/admin/incidents/${esc(inc.id)}">
        <input type="hidden" name="ret" value="${esc(ret)}">
        <div class="inc-row">
        ${plateSelect('plate', plates, inc.plate)}
        ${categorySelect(inc.category)}
        <input class="form-control inc-date" type="date" name="occurredOn" value="${esc(inc.occurred_on)}" required>
        <input class="form-control inc-desc" type="text" name="description" maxlength="600"
               value="${esc(inc.description)}" placeholder="${DESC_HINT[parts ? 'parts' : 'damage']}" title="${esc(inc.description)}">
        <input class="form-control inc-driver" type="text" name="driverName" maxlength="120"
               value="${esc(inc.driver_name)}" placeholder="Driver" title="${esc(inc.driver_name)}">
        ${shopIn}
        ${shopOut}
        <span class="inc-days${d.open ? ' open' : ''}" title="${parts ? 'Not applicable to spare parts' : d.open ? 'Still at the workshop' : 'Days off the road'}">${esc(d.text || '–')}</span>
        ${handlerSelect(inc.handled_by)}
        <input class="form-control inc-cost" type="number" name="cost" step="0.01" min="0"
               value="${esc(numValue(inc.cost_sek))}" placeholder="kr" title="Cost in SEK">
        ${filesCell(inc)}
        <span class="inc-sm">${smCell(inc)}</span>
        ${actionsCell(inc)}
        </div>
        ${moreCell(inc, true)}
      </form>
  </div>`;
}

function otherRow(inc, scope, ret) {
  return `<div class="inc-line${inc.sm_ok ? ' inc-done' : ''}">
      <form class="inc-form" method="post" enctype="multipart/form-data"
            action="/admin/incidents/${esc(inc.id)}">
        <input type="hidden" name="ret" value="${esc(ret)}">
        <div class="inc-row">
        <input class="form-control inc-date" type="date" name="occurredOn" value="${esc(inc.occurred_on)}" required>
        <input class="form-control inc-desc" type="text" name="description" maxlength="600" required
               value="${esc(inc.description)}" placeholder="${DESC_HINT[scope]}" title="${esc(inc.description)}">
        <input class="form-control inc-supplier" type="text" name="supplier" maxlength="160"
               value="${esc(inc.supplier)}" placeholder="Supplier" title="${esc(inc.supplier)}">
        <input class="form-control inc-inv" type="text" name="invoiceNo" maxlength="80"
               value="${esc(inc.invoice_no)}" placeholder="Invoice no." title="${esc(inc.invoice_no)}">
        <input class="form-control inc-cost" type="number" name="cost" step="0.01" min="0"
               value="${esc(numValue(inc.cost_sek))}" placeholder="kr" title="Cost in SEK">
        ${filesCell(inc)}
        <span class="inc-sm">${smCell(inc)}</span>
        ${actionsCell(inc)}
        </div>
        ${moreCell(inc, false)}
      </form>
  </div>`;
}

/**
 * The column headings, one set per section.
 *
 * Built from the same widths as the line rather than as a table header: a
 * <thead> over a flex row lines up for about a week. Same classes, same
 * order, one place to change.
 */
function head(scope) {
  if (scope !== 'vehicle') {
    return `<div class="inc-row inc-head">
      <span class="inc-date">Date</span>
      <span class="inc-desc">${scope === 'tool' ? 'Tool' : 'Expense'}</span>
      <span class="inc-supplier">Supplier</span>
      <span class="inc-inv">Invoice no.</span>
      <span class="inc-cost">Cost</span>
      <span class="inc-files">Files</span>
      <span class="inc-sm">SM check</span>
      <span class="inc-actions"></span>
    </div>`;
  }
  return `<div class="inc-row inc-head">
      <span class="inc-plate">Vehicle</span>
      <span class="inc-cat">Category</span>
      <span class="inc-date">Date</span>
      <span class="inc-desc">Description</span>
      <span class="inc-driver">Driver</span>
      <span class="inc-date">Workshop in</span>
      <span class="inc-date">Out</span>
      <span class="inc-days">Days</span>
      <span class="inc-by">OKQ8 / Own</span>
      <span class="inc-cost">Cost</span>
      <span class="inc-files">Files</span>
      <span class="inc-sm">SM check</span>
      <span class="inc-actions"></span>
    </div>`;
}

const field = (label, control, cls = '') =>
  `<label class="nf-field${cls ? ' ' + cls : ''}"><span>${label}</span>${control}</label>`;

/**
 * The form for a new entry: a proper card with a label on every field,
 * rather than one cramped line. Vehicles ask for the van, the category, the
 * driver, the workshop visit and OKQ8/Own; Tools and Misc do not.
 */
function newEntry(scope, plates, today, ret) {
  const vehicle = scope === 'vehicle';
  const u = scope;   // keeps ids unique if two forms ever share a page
  const [shopIn, shopOut] = shopDates({ category: 'damage', shop_in: '', shop_out: '' },
    [`nf-in-${u}`, `nf-out-${u}`]);
  const title = vehicle ? 'New vehicle entry' : scope === 'tool' ? 'New tool expense' : 'New misc expense';
  const tag = vehicle ? 'Damage or spare parts · fields marked * are required'
    : scope === 'tool' ? 'A tool bought, repaired or replaced · fields marked * are required'
    : 'Anything that is neither a vehicle nor a tool · fields marked * are required';

  const vehicleFields = vehicle ? `
          ${field('Vehicle *', plateSelect('plate', plates, ''))}
          ${field('Category', categorySelect('damage'))}` : '';
  const vehicleFields2 = vehicle ? `
          ${field('Driver', `<input class="form-control" type="text" name="driverName" maxlength="120" placeholder="Who had the van">`)}
          ${field('OKQ8 / Own', handlerSelect(''))}
          ${field('In at the workshop', shopIn)}
          ${field('Out of the workshop', shopOut)}` : '';

  return `<div class="card nf-card">
    <div class="card-header">${title}
      <span class="step-tag">${tag}</span></div>
    <div class="card-body">
      <form class="nf" method="post" action="/admin/incidents" enctype="multipart/form-data">
        <input type="hidden" name="ret" value="${esc(ret)}">
        <input type="hidden" name="scope" value="${esc(scope)}">
        <div class="nf-grid">${vehicleFields}
          ${field('Date *', `<input class="form-control" type="date" name="occurredOn" value="${esc(today)}" required>`)}${vehicleFields2}
          ${field('Supplier / workshop', `<input class="form-control" type="text" name="supplier" maxlength="160" placeholder="${vehicle ? 'e.g. the body shop' : 'e.g. the store'}">`)}
          ${field('Invoice no.', `<input class="form-control" type="text" name="invoiceNo" maxlength="80">`)}
          ${field('Cost (SEK)', `<input class="form-control" type="number" name="cost" step="0.01" min="0" placeholder="kr">`)}
          ${field('Photos', `<input class="form-control nf-file" type="file" name="photos" accept="image/*" multiple>`)}
          ${field('Invoices (PDF or image)', `<input class="form-control nf-file" type="file" name="invoices" accept="application/pdf,image/*" multiple>`)}
          ${field(vehicle ? 'Description' : 'What was it? *',
            `<textarea class="form-control nf-desc" name="description" rows="3" maxlength="600"
                      placeholder="${DESC_HINT[vehicle ? 'damage' : scope]}"${vehicle ? '' : ' required'}></textarea>`, 'nf-half')}
          ${field('Note', `<textarea class="form-control" name="note" rows="3" maxlength="2000"
                      placeholder="Anything else worth keeping – who approved it, warranty, follow-up"></textarea>`, 'nf-half')}
        </div>
        <div class="actions" style="justify-content:flex-start;margin-top:14px">
          <button class="btn btn-primary" type="submit">Add ${vehicle ? 'entry' : scope === 'tool' ? 'tool expense' : 'misc expense'}</button>
        </div>
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
      var desc = form.querySelector('.inc-desc, .nf-desc');
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

${newEntry('vehicle', plates, today, '/admin/incidents')}

  <div class="card">
    <div class="card-header">Vehicle expenses
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

/** Vehicles · Tools · Misc, each with its count and total. */
function sectionTabs(active, sections, filters) {
  // The period and the SM filter follow you between sections; the vehicle
  // filters do not, they mean nothing on Tools and Misc.
  const keep = ['from', 'to', 'sm'].filter(k => filters[k])
    .map(k => `&${k}=${encodeURIComponent(filters[k])}`).join('');
  return `<div class="exp-tabs no-print">${SCOPES.map(s => {
    const x = sections[s] || { n: 0, cost: 0, waiting: 0 };
    return `<a href="/admin/expenses?scope=${s}${esc(keep)}"${s === active ? ' class="on"' : ''}>
      <strong>${esc(SCOPE_LABEL[s])}</strong>
      <span>${esc(x.n)} · ${esc(kr(x.cost) || '0 kr')}${x.waiting ? ` · <em>${esc(x.waiting)} to approve</em>` : ''}</span></a>`;
  }).join('')}</div>`;
}

function expensesPage({ incidents, plates, filters, totals, sections = {}, today, message, nav }) {
  const scope = filters.scope;
  const vehicle = scope === 'vehicle';
  const ret = '/admin/expenses' + (filters.query || '');
  const rows = incidents.map(i => vehicle ? vehicleRow(i, plates, today, ret) : otherRow(i, scope, ret)).join('\n');
  const opt = (v, l, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`;

  const vehicleFilters = vehicle ? `
    <div class="f"><label for="plate">Vehicle</label>
      <select class="form-control" id="plate" name="plate">
        <option value="">All</option>
        ${plates.map(p => opt(p, p, filters.plate)).join('')}
      </select></div>
    <div class="f"><label for="category">Category</label>
      <select class="form-control" id="category" name="category">
        ${opt('', 'All', filters.category)}${Object.entries(EXPENSE_LABEL).map(([v, l]) => opt(v, l, filters.category)).join('')}
      </select></div>
    <div class="f"><label for="by">OKQ8 / Own</label>
      <select class="form-control" id="by" name="by">
        ${opt('', 'All', filters.handledBy)}${Object.entries(HANDLER_LABEL).map(([v, l]) => opt(v, l, filters.handledBy)).join('')}${opt('none', 'Not set', filters.handledBy)}
      </select></div>` : '';

  const summary = vehicle
    ? `${esc(totals.withCost)} with cost · ${esc(kr(totals.cost) || '0 kr')} total
        (damage ${esc(kr(totals.damageCost) || '0 kr')} · spare parts ${esc(kr(totals.partsCost) || '0 kr')}) ·
        ${esc(totals.waiting)} waiting for the SM check${totals.atShop ? ` · ${esc(totals.atShop)} at the workshop now` : ''}`
    : `${esc(totals.withCost)} with cost · ${esc(kr(totals.cost) || '0 kr')} total ·
        ${esc(totals.waiting)} waiting for the SM check`;

  const lede = {
    vehicle: `What the vans cost, one line each: damage with its workshop visit, and spare parts
     bought for them. New damage reports arrive on <a href="/admin/incidents">Incidents</a>.`,
    tool: "Tools bought, repaired or replaced – one line each, with the supplier, the invoice and the Site Manager's approval.",
    misc: 'Everything else the site pays for that is neither a vehicle nor a tool.'
  }[scope];

  const html = `  <div class="page-head">
    <h1>Expenses</h1>
    <div class="muted">${esc(SCOPE_LABEL[scope])} · ${esc(incidents.length)} ${incidents.length === 1 ? 'entry' : 'entries'}</div>
  </div>
${nav}
${message ? `<div class="ok-msg no-print">${esc(message)}</div>` : ''}
${sectionTabs(scope, sections, filters)}

  <p class="lede">${lede} Every line can be edited at any time – the invoice often comes last
     of all. Click the small link under a line to add ${vehicle ? 'the supplier, invoice number or a note' : 'a note'}.</p>

  <form class="filters no-print" method="get" action="/admin/expenses">
    <input type="hidden" name="scope" value="${esc(scope)}">${vehicleFilters}
    <div class="f"><label for="from">From</label>
      <input class="form-control" type="date" id="from" name="from" value="${esc(filters.from)}"></div>
    <div class="f"><label for="to">To</label>
      <input class="form-control" type="date" id="to" name="to" value="${esc(filters.to)}"></div>
    <div class="f"><label for="sm">SM check</label>
      <select class="form-control" id="sm" name="sm">
        ${opt('', 'All', filters.sm)}${opt('no', 'Waiting for OK', filters.sm)}${opt('yes', 'Approved', filters.sm)}
      </select></div>
    <button class="btn btn-primary" type="submit">Show</button>
    <a class="btn btn-ghost" href="/admin/expenses?scope=${esc(scope)}">Everything</a>
    <a class="btn btn-secondary" href="/admin/expenses.csv${esc(filters.query)}">Download CSV</a>
    <a class="btn btn-ghost" href="/admin/expenses.csv?scope=all" title="Vehicles, tools and misc in one file">CSV, all sections</a>
  </form>

${newEntry(scope, plates, today, ret)}

  <div class="card">
    <div class="card-header">All ${({ vehicle: 'vehicle', tool: 'tool', misc: 'misc' })[scope]} expenses
      <span class="step-tag">${summary}</span></div>
    <div class="inc-scroll">
      <div class="inc-list${vehicle ? '' : ' inc-list-other'}">
${head(scope)}
${rows || `<p class="muted" style="padding:20px">No entries match. Add one above${vehicle ? ' – or create one from a reported damage on Incidents' : ''}.</p>`}
      </div>
    </div>
  </div>

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
      <p><strong>Vehicles</strong> carry the registration number, the driver, the workshop visit and
         <strong>OKQ8 / Own</strong>, which stays blank until somebody picks. <strong>Spare
         parts</strong> have no workshop visit, so their dates are switched off.
         <strong>Tools</strong> and <strong>Misc</strong> belong to no van and have none of that.</p>
      <p class="muted">Both OKs and withdrawn OKs are kept with their time. Hover over the
         SM box to see the history.</p>
    </div>
  </div>`;

  return page({
    title: `Expenses – ${SCOPE_LABEL[scope]} – admin`, body: html, links: LINKS,
    // Wider than the rest of the app: see body.wide in app.css.
    bodyClass: 'wide', scripts: SCRIPT, lang: 'en', admin: true
  });
}

/** The confirmation page, as for every other delete in the app. */
function incidentDeletePage({ inc, ret, nav }) {
  const back = ret || '/admin/expenses';
  const html = `  <div class="page-head">
    <h1>Delete this entry?</h1>
    <div class="muted mono">${esc([({ vehicle: 'Vehicle', tool: 'Tool', misc: 'Misc' })[inc.scope], inc.plate, EXPENSE_LABEL[inc.category], inc.occurred_on].filter(Boolean).join(' · '))}</div>
  </div>
${nav}

  <div class="card card-warn">
    <div class="card-header">This will be removed</div>
    <div class="card-body">
      <p>${esc(inc.description || '(no description)')}</p>
      <p>${esc(inc.files.length)} ${inc.files.length === 1 ? 'file' : 'files'} (photos and invoices)
         are deleted with the entry, as is the approval history.
         ${inc.sm_ok ? `<strong>This entry was approved by ${esc(inc.sm_by)} ${esc(fmtDateTime(inc.sm_at))}.</strong>` : ''}</p>
      ${inc.submission_id ? '<p>The check the damage was reported in is not affected – only this line.</p>' : ''}
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

module.exports = { incidentsPage, expensesPage, incidentDeletePage, kr, EXPENSE_LABEL, HANDLER_LABEL, SCOPE_LABEL };
