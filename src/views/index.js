'use strict';

const { page, esc, fmtDateTime } = require('./layout');

const OWNER_LABEL = { own: 'Egen', okq8: 'OKQ8' };
const FLEET_LABEL = { box: 'Boxbilar', home: 'Hemleverans' };

function ownerChip(owner) {
  if (!owner) return '<span class="muted">—</span>';
  const cls = owner === 'okq8' ? 'chip chip-okq8' : 'chip chip-own';
  return `<span class="${cls}">${esc(OWNER_LABEL[owner] || owner)}</span>`;
}

function fleetTable(title, vehicles, latest) {
  if (!vehicles.length) return '';
  const rows = vehicles.map(v => {
    const l = latest.get(v.plate);
    return `<tr>
      <td class="mono" style="font-size:17px;font-weight:700">${esc(v.plate)}</td>
      <td>${ownerChip(v.owner)}</td>
      <td>${l ? esc(fmtDateTime(l.submitted_at)) : '<span class="muted">—</span>'}</td>
      <td>${l && l.driver_name ? esc(l.driver_name) : '<span class="muted">—</span>'}</td>
      <td><a class="btn btn-primary" href="/v/${esc(v.plate)}">Öppna kontroll</a></td>
    </tr>`;
  }).join('\n');

  return `  <div class="card">
    <div class="card-header">${esc(title)}
      <span class="step-tag">${vehicles.length} fordon · senaste registrerade kontroll</span></div>
    <table class="table">
      <thead><tr><th>Reg.nr</th><th>Ägare</th><th>Senaste kontroll</th><th>Förare</th><th></th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>`;
}

function indexPage({ vehicles, latest }) {
  const byFleet = new Map();
  for (const v of vehicles) {
    if (!byFleet.has(v.fleet)) byFleet.set(v.fleet, []);
    byFleet.get(v.fleet).push(v);
  }

  const tables = [...byFleet.entries()]
    .map(([fleet, list]) => fleetTable(FLEET_LABEL[fleet] || fleet, list, latest))
    .join('\n');

  const empty = vehicles.length ? '' :
    `<div class="warn">Inga fordon är upplagda ännu. Lägg till dem under
      <a href="/admin/vehicles">Admin → Fordon</a>.</div>`;

  const body = `  <div class="page-head">
    <h1>Säkerhetskontroll</h1>
  </div>
  <p class="lede">${vehicles.length} fordon. Skanna fordonets QR-kod, eller välj det i listan.</p>
  ${empty}

${tables}

  <div class="actions" style="justify-content:flex-start">
    <a class="btn btn-secondary" href="/qr">QR-koder för utskrift</a>
    <a class="btn btn-ghost" href="/admin">Administration</a>
  </div>`;

  return page({ title: 'Säkerhetskontroll – fordon', body, links: [
    { href: '/qr', text: 'QR-koder' }, { href: '/admin', text: 'Admin' }
  ]});
}

module.exports = { indexPage, ownerChip, OWNER_LABEL, FLEET_LABEL };
