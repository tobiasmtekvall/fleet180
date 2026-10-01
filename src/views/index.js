'use strict';

const { maskName } = require('../mask');

const { page, esc, fmtDateTime, fmtDate } = require('./layout');
const vstatus = require('../vehicle-status');

// Admin-facing (the fleet list sits behind the admin login), so English.
const OWNER_LABEL = { own: 'Own', okq8: 'OKQ8' };
const FLEET_LABEL = { box: 'Box vans', home: 'Home delivery' };

function ownerChip(owner) {
  if (!owner) return '<span class="muted">—</span>';
  const cls = owner === 'okq8' ? 'chip chip-okq8' : 'chip chip-own';
  return `<span class="${cls}">${esc(OWNER_LABEL[owner] || owner)}</span>`;
}

/** The status as a coloured word. Green is the only one that means "usable". */
function statusChip(v) {
  const s = vstatus.normalise(v.status);
  return `<span class="chip st-chip st-${esc(s)}" title="${esc(vstatus.STATUS_HINT[s])}">${
    esc(vstatus.STATUS_LABEL[s])}</span>`;
}

/**
 * The status, plus the one line of why and the day it started.
 *
 * Both halves belong to a van that is NOT ready: they answer "why can it not
 * take a route", and a van that can has nothing to answer. Saving a van back
 * into service already clears the note, so this only catches a row written
 * before that rule existed -- but "In service \u00b7 tailgate, back Thursday" is a
 * sentence no page should ever print.
 */
function statusCell(v) {
  const s = vstatus.normalise(v.status);
  /* READY, not CAN_WORK: a hire car is working and still has something to say
     for itself -- which van it is covering, and until when. */
  if (s === vstatus.READY) return statusChip(v);
  const since = v.status_at ? fmtDate(v.status_at) : '';
  const tail = [v.status_note, since ? `since ${since}` : ''].filter(Boolean).join(' \u00b7 ');
  return `${statusChip(v)}${tail ? `<em class="st-why">${esc(tail)}</em>` : ''}`;
}

/**
 * The answer to "how many routes can we run?", per fleet, at the top of both
 * vehicle pages.
 *
 * The big figure is vans that can be given a route. The small print names the
 * ones that cannot and says what each is doing, because a Team Manager who
 * reads "15 of 18" immediately asks which three -- and scrolling a list of
 * twenty-two rows hunting for the answer is how the figure stops being used.
 */
function readinessBar(vehicles, { inactiveKnown = false } = {}) {
  const entries = [...vstatus.readiness(vehicles).entries()];
  // No vans, no cards. A green "every van is in service" about a fleet that
  // does not exist is worse than saying nothing.
  if (!entries.length) return '';
  const cards = entries.map(([fleet, r]) => {
    const held = r.out.map(o =>
      `<span class="fleet-held"><em class="st-dot st-${esc(o.status)}"></em>${esc(o.plates.length)}
        ${esc(o.label.toLowerCase())} <span class="mono">${esc(o.plates.join(', '))}</span></span>`).join('');
    return `<div class="fleet-card${r.notReady ? ' fleet-short' : ''}${
      r.active ? '' : ' fleet-empty'}">
      <div class="fleet-name">${esc(FLEET_LABEL[fleet] || fleet)}</div>
      <div class="fleet-ready"><strong>${esc(r.ready)}</strong>
        <span>of ${esc(r.active)} ready</span></div>
      <div class="fleet-held-list">${r.rented.length
        ? `<span class="fleet-rented"><em class="st-dot st-rental"></em>${esc(r.rented.length)} of
            ${r.rented.length === 1 ? 'those is' : 'those are'} on temporary hire
            <span class="mono">${esc(r.rented.join(', '))}</span></span>` : ''}${held || (r.active
        /* Not "every van is in service": two of them may be hire cars, named
           on the line above. What this line actually says is that nothing is
           being kept off the road. */
        ? '<span class="fleet-ok">Nothing is off the road.</span>'
        : '<span class="fleet-inactive">No active vans in this fleet.</span>')}${
        inactiveKnown && r.inactive
          ? `<span class="fleet-inactive">${esc(r.inactive)} not active, not counted</span>` : ''}</div>
    </div>`;
  }).join('');

  return `  <div class="fleetbar">${cards}</div>`;
}

function fleetTable(title, vehicles, latest) {
  if (!vehicles.length) return '';
  const ready = vehicles.filter(vstatus.isReady).length;
  const rows = vehicles.map(v => {
    const l = latest.get(v.plate);
    // The stripe down the left of a held row takes the status's own colour,
    // so the rows a reader wants to skip are skippable at a glance. A working
    // hire car gets no stripe: it is not one of the rows to skip.
    return `<tr${vstatus.isReady(v) ? '' : ` class="row-held st-${esc(vstatus.normalise(v.status))}"`}>
      <td class="mono" style="font-size:17px;font-weight:700">${esc(v.plate)}</td>
      <td>${ownerChip(v.owner)}</td>
      <td>${statusCell(v)}</td>
      <td>${l ? esc(fmtDateTime(l.submitted_at)) : '<span class="muted">\u2014</span>'}</td>
      <td>${l && l.driver_name ? esc(maskName(l.driver_name)) : '<span class="muted">\u2014</span>'}</td>
      <td><a class="btn btn-primary" href="/v/${esc(v.plate)}">Open check</a></td>
    </tr>`;
  }).join('\n');

  /* Six columns since Status arrived, and the Status cell carries a chip plus
     a line of free text. On a phone the table scrolls inside its own card
     rather than pushing the page sideways. */
  return `  <div class="card">
    <div class="card-header">${esc(title)}
      <span class="step-tag">${vehicles.length} ${vehicles.length === 1 ? 'vehicle' : 'vehicles'} \u00b7
        ${ready} ready for a route \u00b7 latest recorded check</span></div>
    <div class="table-scroll">
    <table class="table">
      <thead><tr><th>Reg. no.</th><th>Owner</th><th>Status</th><th>Latest check</th><th>Driver</th><th></th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
    </div>
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
  <p class="lede">${vehicles.length} ${vehicles.length === 1 ? 'vehicle' : 'vehicles'}. Scan the vehicle's QR code, or pick it from the list.
     <strong>Ready</strong> below is how many can be given a route today \u2013 our own vans in
     service, and any working hire cars standing in for them; a van's status is set on
     <a href="/admin/vehicles">Admin \u2192 Vehicles</a>.</p>
  ${empty}

${vehicles.length ? readinessBar(vehicles) : ''}

${tables}

  <div class="actions" style="justify-content:flex-start">
    <a class="btn btn-secondary" href="/qr">QR codes for printing</a>
    <a class="btn btn-ghost" href="/admin">Admin</a>
  </div>`;

  return page({ title: 'Safety check – vehicles', body, lang: 'en', admin: true, links: [
    { href: '/qr', text: 'QR codes' }, { href: '/admin', text: 'Admin' }
  ]});
}

module.exports = { indexPage, ownerChip, statusChip, statusCell, readinessBar,
  OWNER_LABEL, FLEET_LABEL };
