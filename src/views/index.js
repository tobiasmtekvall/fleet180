'use strict';

const { page, esc, fmtDateTime } = require('./layout');

// Admin-facing (the fleet list sits behind the admin login), so English.
const OWNER_LABEL = { own: 'Own', okq8: 'OKQ8' };
const FLEET_LABEL = { box: 'Box vans', home: 'Home delivery' };

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
      <td><a class="btn btn-primary" href="/v/${esc(v.plate)}">Open check</a></td>
    </tr>`;
  }).join('\n');

  return `  <div class="card">
    <div class="card-header">${esc(title)}
      <span class="step-tag">${vehicles.length} ${vehicles.length === 1 ? 'vehicle' : 'vehicles'} · latest recorded check</span></div>
    <table class="table">
      <thead><tr><th>Reg. no.</th><th>Owner</th><th>Latest check</th><th>Driver</th><th></th></tr></thead>
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
    `<div class="warn">No vehicles have been added yet. Add them under
      <a href="/admin/vehicles">Admin → Vehicles</a>.</div>`;

  const body = `  <div class="page-head">
    <h1>Safety check</h1>
  </div>
  <p class="lede">${vehicles.length} ${vehicles.length === 1 ? 'vehicle' : 'vehicles'}. Scan the vehicle's QR code, or pick it from the list.</p>
  ${empty}

${tables}

  <div class="actions" style="justify-content:flex-start">
    <a class="btn btn-secondary" href="/qr">QR codes for printing</a>
    <a class="btn btn-ghost" href="/admin">Admin</a>
  </div>`;

  return page({ title: 'Safety check – vehicles', body, lang: 'en', admin: true, links: [
    { href: '/qr', text: 'QR codes' }, { href: '/admin', text: 'Admin' }
  ]});
}

module.exports = { indexPage, ownerChip, OWNER_LABEL, FLEET_LABEL };
