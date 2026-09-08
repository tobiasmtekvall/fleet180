'use strict';

const { page, esc, fmtDateTime } = require('./layout');
const { VEHICLES } = require('../vehicles');
const { FORM_TITLE } = require('../form-def');

function indexPage({ latest }) {
  const rows = VEHICLES.map(v => {
    const l = latest.get(v.plate);
    return `<tr>
      <td class="mono" style="font-size:17px;font-weight:700">${esc(v.plate)}</td>
      <td><span class="chip chip-okq8">OKQ8</span></td>
      <td>${l ? esc(fmtDateTime(l.submitted_at)) : '<span class="muted">—</span>'}</td>
      <td>${l && l.driver_name ? esc(l.driver_name) : '<span class="muted">—</span>'}</td>
      <td><a class="btn btn-primary" href="/v/${esc(v.plate)}">Öppna kontroll</a></td>
    </tr>`;
  }).join('\n');

  const body = `  <div class="page-head">
    <h1>Säkerhetskontroll – OKQ8-fordon</h1>
  </div>
  <p class="lede">${esc(FORM_TITLE)} · ${VEHICLES.length} hyrfordon från OKQ8.
     Skanna fordonets QR-kod, eller välj det i listan.</p>

  <div class="card">
    <div class="card-header">Fordon<span class="step-tag">Senaste registrerade kontroll per fordon</span></div>
    <table class="table">
      <thead><tr><th>Reg.nr</th><th>Ägare</th><th>Senaste kontroll</th><th>Förare</th><th></th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>

  <div class="actions" style="justify-content:flex-start">
    <a class="btn btn-secondary" href="/qr">QR-koder för utskrift</a>
    <a class="btn btn-ghost" href="/admin">Administration</a>
  </div>`;

  return page({ title: 'Säkerhetskontroll – OKQ8-fordon', body, links: [
    { href: '/qr', text: 'QR-koder' }, { href: '/admin', text: 'Admin' }
  ]});
}

module.exports = { indexPage };
