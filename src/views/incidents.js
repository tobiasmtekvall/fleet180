'use strict';

/**
 * Händelser — the incident ledger.
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
  { href: '/', text: 'Fordon' },
  { href: '/qr', text: 'QR-koder' },
  { href: '/admin', text: 'Admin' }
];

/** 12400 -> "12 400 kr". Space as the thousands separator, as Swedish does. */
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
  const label = f.kind === 'invoice' ? 'Faktura' : 'Foto';
  const name = f.filename || label;
  const size = f.byte_size ? ` (${Math.max(1, Math.round(f.byte_size / 1024))} kB)` : '';
  return `<span class="filechip file-${esc(f.kind)}">
      <a href="/admin/incidents/file/${esc(f.id)}" target="_blank" rel="noopener"
         title="${esc(name + size)}">${esc(label)}</a>
      <button class="filex" type="submit" title="Ta bort ${esc(name)}"
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
          e.action === 'withdrawn' ? 'ångrad' : 'nollställd (kostnaden ändrades)';
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
                formaction="/admin/incidents/${esc(inc.id)}/sm/withdraw">Ångra</button>
      </div>`;
  }

  // No cost, no signature: approving an unknown amount is not an approval.
  if (inc.cost_sek === null) {
    return `<div class="sm sm-blocked"${histAttr}>
        <span class="muted">Väntar på kostnad</span>
      </div>`;
  }

  return `<div class="sm"${histAttr}>
      <input class="form-control sm-name" type="text" name="smBy" placeholder="Ditt namn"
             autocomplete="name" maxlength="120">
      <button class="btn btn-primary btn-sm" type="submit"
              formaction="/admin/incidents/${esc(inc.id)}/sm">OK</button>
    </div>`;
}

function plateSelect(name, plates, current) {
  const opts = ['<option value="">Bil…</option>'].concat(plates.map(p =>
    `<option value="${esc(p)}"${p === current ? ' selected' : ''}>${esc(p)}</option>`)).join('');
  return `<select class="form-control inc-plate mono" name="${esc(name)}" required>${opts}</select>`;
}

function row(inc, plates, today) {
  const d = days(inc.shop_in, inc.shop_out, today);
  const photos = inc.files.filter(f => f.kind !== 'invoice');
  const invoices = inc.files.filter(f => f.kind === 'invoice');

  return `<div class="inc-line${inc.sm_ok ? ' inc-done' : ''}">
      <form class="inc-row" method="post" enctype="multipart/form-data"
            action="/admin/incidents/${esc(inc.id)}">
        ${plateSelect('plate', plates, inc.plate)}
        <input class="form-control inc-date" type="date" name="occurredOn" value="${esc(inc.occurred_on)}" required>
        <input class="form-control inc-desc" type="text" name="description" maxlength="600"
               value="${esc(inc.description)}" placeholder="Vad hände?" title="${esc(inc.description)}">
        <input class="form-control inc-driver" type="text" name="driverName" maxlength="120"
               value="${esc(inc.driver_name)}" placeholder="Förare" title="${esc(inc.driver_name)}">
        <input class="form-control inc-date" type="date" name="shopIn" value="${esc(inc.shop_in)}" title="Inne på verkstad">
        <input class="form-control inc-date" type="date" name="shopOut" value="${esc(inc.shop_out)}" title="Ute från verkstad">
        <span class="inc-days${d.open ? ' open' : ''}" title="${d.open ? 'Fortfarande på verkstad' : 'Dagar borta'}">${esc(d.text || '–')}</span>
        <input class="form-control inc-cost" type="number" name="cost" step="0.01" min="0"
               value="${esc(numValue(inc.cost_sek))}" placeholder="kr" title="Kostnad i kronor">
        <span class="inc-files">
          ${photos.map(fileChip).join('')}${invoices.map(fileChip).join('')}
          <label class="addfile" title="Lägg till foto – välj fil, tryck sedan Spara">${ICON.camera}<input type="file" name="photos" accept="image/*" multiple hidden></label>
          <label class="addfile" title="Lägg till faktura – välj fil, tryck sedan Spara">${ICON.invoice}<input type="file" name="invoices" accept="application/pdf,image/*" multiple hidden></label>
        </span>
        <span class="inc-sm">${smCell(inc)}</span>
        <span class="inc-actions">
          ${inc.submission_id ? `<a class="btn btn-ghost btn-sm" title="Kontrollen som skadan rapporterades i"
             href="/admin/s/${esc(inc.submission_id)}" target="_blank" rel="noopener">Kontroll</a>` : ''}
          <button class="btn btn-primary btn-sm" type="submit">Spara</button>
          <button class="btn btn-danger btn-sm" type="submit"
                  formaction="/admin/incidents/${esc(inc.id)}/delete">Ta bort</button>
        </span>
      </form>
  </div>`;
}

/**
 * The column headings.
 *
 * Built from the same widths as the line rather than as a table header, which
 * is what they were at first: a <thead> over a flex row lines up for about a
 * week, and then somebody widens the cost field and "Filer" is sitting over
 * the SM check. Same classes, same order, one place to change.
 */
function head() {
  return `<div class="inc-row inc-head">
      <span class="inc-plate">Bil</span>
      <span class="inc-date">Datum</span>
      <span class="inc-desc">Beskrivning</span>
      <span class="inc-driver">Förare</span>
      <span class="inc-date">Verkstad in</span>
      <span class="inc-date">Ut</span>
      <span class="inc-days">Dagar</span>
      <span class="inc-cost">Kostnad</span>
      <span class="inc-files">Filer</span>
      <span class="inc-sm">SM-check</span>
      <span class="inc-actions"></span>
    </div>`;
}

/** The damage a driver reported that nobody has opened a case for yet. */
function pending(list) {
  if (!list.length) return '';
  const rows = list.map(p => `<li>
      <form method="post" action="/admin/incidents/from-check/${esc(p.id)}" class="pending-row">
        <span class="mono pending-plate">${esc(p.plate)}</span>
        <span class="pending-date">${esc(p.day)}</span>
        <span class="pending-who">${esc(p.driver || '—')}</span>
        <span class="pending-what" title="${esc(p.text)}">${esc(p.text)}</span>
        ${p.photos ? `<span class="chip">${esc(p.photos)} foto</span>` : ''}
        <a class="btn btn-ghost btn-sm" href="/admin/s/${esc(p.id)}" target="_blank" rel="noopener">Kontrollen</a>
        <button class="btn btn-primary btn-sm" type="submit">Skapa händelse</button>
      </form>
    </li>`).join('\n');

  return `<div class="card card-warn">
    <div class="card-header">Rapporterade skador utan händelse
      <span class="step-tag">${list.length} st – från förarnas kontroller de senaste 60 dagarna</span></div>
    <ul class="pending-list">
${rows}
    </ul>
  </div>`;
}

function incidentsPage({ incidents, plates, pendingChecks, filters, totals, today, message, nav }) {
  const rows = incidents.map(i => row(i, plates, today)).join('\n');

  const html = `  <div class="page-head">
    <h1>Händelser</h1>
    <div class="muted">${esc(incidents.length)} ${incidents.length === 1 ? 'händelse' : 'händelser'}</div>
  </div>
${nav}
${message ? `<div class="ok-msg no-print">${esc(message)}</div>` : ''}

  <p class="lede">Skador på bilarna, en rad var: vad som hände, när bilen var inne på
     verkstad, vad det kostade och Site Managerns godkännande. Raden går att ändra när
     som helst – en händelse lever i veckor, och fakturan kommer sist av allt.</p>

${pending(pendingChecks)}

  <div class="card">
    <div class="card-header">Ny händelse</div>
    <div class="card-body">
      <form class="inc-row" method="post" action="/admin/incidents" enctype="multipart/form-data">
        ${plateSelect('plate', plates, '')}
        <input class="form-control inc-date" type="date" name="occurredOn" value="${esc(today)}" required>
        <input class="form-control inc-desc" type="text" name="description" maxlength="600"
               placeholder="Vad hände?">
        <input class="form-control inc-driver" type="text" name="driverName" maxlength="120"
               placeholder="Förare">
        <input class="form-control inc-date" type="date" name="shopIn" title="Inne på verkstad">
        <input class="form-control inc-date" type="date" name="shopOut" title="Ute från verkstad">
        <input class="form-control inc-cost" type="number" name="cost" step="0.01" min="0" placeholder="kr">
        <span class="inc-files">
          <label class="addfile" title="Foton">${ICON.camera}<input type="file" name="photos" accept="image/*" multiple hidden></label>
          <label class="addfile" title="Fakturor">${ICON.invoice}<input type="file" name="invoices" accept="application/pdf,image/*" multiple hidden></label>
        </span>
        <button class="btn btn-primary" type="submit">Lägg till</button>
      </form>
    </div>
  </div>

  <form class="filters no-print" method="get" action="/admin/incidents">
    <div class="f"><label for="plate">Bil</label>
      <select class="form-control" id="plate" name="plate">
        <option value="">Alla</option>
        ${plates.map(p => `<option value="${esc(p)}"${filters.plate === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}
      </select></div>
    <div class="f"><label for="from">Från</label>
      <input class="form-control" type="date" id="from" name="from" value="${esc(filters.from)}"></div>
    <div class="f"><label for="to">Till</label>
      <input class="form-control" type="date" id="to" name="to" value="${esc(filters.to)}"></div>
    <div class="f"><label for="sm">SM-check</label>
      <select class="form-control" id="sm" name="sm">
        <option value="">Alla</option>
        <option value="no"${filters.sm === 'no' ? ' selected' : ''}>Väntar på OK</option>
        <option value="yes"${filters.sm === 'yes' ? ' selected' : ''}>Godkända</option>
      </select></div>
    <button class="btn btn-primary" type="submit">Visa</button>
    <a class="btn btn-ghost" href="/admin/incidents">Allt</a>
    <a class="btn btn-secondary" href="/admin/incidents.csv${esc(filters.query)}">Ladda ner CSV</a>
  </form>

  <div class="card">
    <div class="card-header">Alla händelser
      <span class="step-tag">${esc(totals.withCost)} med kostnad · ${esc(kr(totals.cost))} totalt ·
        ${esc(totals.waiting)} väntar på SM-check${totals.atShop ? ` · ${esc(totals.atShop)} på verkstad nu` : ''}</span></div>
    <div class="inc-scroll">
      <div class="inc-list">
${head()}
${rows || '<p class="muted" style="padding:20px">Inga händelser ännu. Lägg till den första ovan – eller skapa en från en rapporterad skada.</p>'}
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-header">Om SM-checken</div>
    <div class="card-body">
      <p>Site Managern skriver sitt namn och trycker OK. Raden sparar <strong>vem</strong>
         och <strong>när</strong>, inte bara att någon bockat – appen har ett gemensamt
         admin-login och kan inte se vem som klickar, så namnet är det enda som gör
         godkännandet till någons.</p>
      <p><strong>Utan kostnad går det inte att godkänna.</strong> Ett OK på ett okänt
         belopp är inget godkännande. Och ändras kostnaden efteråt nollställs checken
         automatiskt – ett godkännande gäller den summa som stod där när det gavs.</p>
      <p class="muted">Både OK och ångrade OK sparas med tidpunkt. Håll muspekaren över
         SM-rutan för att se historiken.</p>
    </div>
  </div>`;

  /* The only script on the page, and it earns its place: a file input that
     has been filled in looks exactly like an empty one, so somebody picks an
     invoice, sees nothing change, and never presses Spara. This marks the
     button and says how many are waiting. Everything still works without it —
     the file posts with the row either way. */
  const script = `<script>
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
        ? n + ' fil(er) valda – tryck Spara för att bifoga'
        : original);
    });
  });
})();
</script>`;

  return page({
    title: 'Händelser – administration', body: html, links: LINKS,
    // Wider than the rest of the app: see body.wide in app.css.
    bodyClass: 'wide', scripts: script
  });
}

/** The confirmation page, as for every other delete in the app. */
function incidentDeletePage({ inc, nav }) {
  const html = `  <div class="page-head">
    <h1>Ta bort händelsen?</h1>
    <div class="muted mono">${esc(inc.plate)} · ${esc(inc.occurred_on)}</div>
  </div>
${nav}

  <div class="card card-warn">
    <div class="card-header">Det här försvinner</div>
    <div class="card-body">
      <p>${esc(inc.description || '(ingen beskrivning)')}</p>
      <p>${esc(inc.files.length)} ${inc.files.length === 1 ? 'fil' : 'filer'} (foton och fakturor)
         tas bort med händelsen, liksom godkännandehistoriken.
         ${inc.sm_ok ? `<strong>Händelsen är godkänd av ${esc(inc.sm_by)} ${esc(fmtDateTime(inc.sm_at))}.</strong>` : ''}</p>
      <p>Kontrollen som skadan rapporterades i påverkas inte – bara den här raden.</p>
    </div>
  </div>

  <form method="post" action="/admin/incidents/${esc(inc.id)}/delete?confirm=1">
    <div class="actions" style="justify-content:flex-start">
      <a class="btn btn-ghost" href="/admin/incidents">Avbryt</a>
      <button class="btn btn-danger" type="submit">Ta bort händelsen</button>
    </div>
  </form>`;

  return page({ title: 'Ta bort händelse', body: html, links: LINKS });
}

module.exports = { incidentsPage, incidentDeletePage, kr };
