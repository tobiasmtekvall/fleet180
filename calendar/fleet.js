/* Weekly vehicle maintenance matrix — the screen half.
 *
 * Opened from the 🔧 Vehicles button on any week row in the month view. One
 * record per ISO week, stored server-side in data/fleet-checks.json, entirely
 * separate from the day/week/month checklists in checklists.json.
 *
 * THREE THINGS THIS FILE IS CAREFUL ABOUT
 * ---------------------------------------
 * 1. It never re-renders the whole matrix on a click. With every group expanded
 *    the table is 21 rows by 122 columns; rebuilding it would throw away the
 *    scroll position mid-walk-around, which is the one thing a fleet manager
 *    holding a torch will not forgive. Clicks patch the single cell, its row
 *    tally and the toolbar counters.
 * 2. One delegated listener on the table, not one per cell. 2,562 listeners is
 *    how a page starts feeling slow.
 * 3. It re-reads the server before opening a week, the same discipline
 *    openSlot() learned the hard way: a page left open overnight holds a stale
 *    picture, and saving from a stale picture overwrites somebody's morning.
 */

import {
  FLEETS, GROUPS, CHECKPOINTS, SPARE_PARTS, STATE_META, OWNER_LABEL,
  allVehicles, cellState, cellStamp, setCell, markAllOk, resetOkToPending,
  setComment, addPart, removePart, vehicleTally, groupTally, matrixTally,
  normalizeRecord, emptyRecord, buildReport, nextState, previousState
} from './fleet-model.js';

const EXPANDED_KEY = 'fleet-matrix-expanded-groups-v1';
const MIRROR_KEY = 'fleet-matrix-mirror-v1';

const fleetState = {
  weekKey: '',
  weekLabel: '',
  record: null,
  expanded: loadExpanded(),
  persistence: 'server',
  saveTimer: null,
  savePending: false,
  view: 'matrix',
  report: null,
  dialog: null,
  nodes: {}
};

/* ------------------------------------------------------------------ *
 * Opening
 * ------------------------------------------------------------------ */
export async function openFleetWeek(weekKey, weekLabel) {
  fleetState.weekKey = weekKey;
  fleetState.weekLabel = weekLabel || weekKey;
  fleetState.view = 'matrix';
  ensureDialog();
  fleetState.record = await loadRecord(weekKey);
  renderAll();
  if (!fleetState.dialog.open) fleetState.dialog.showModal();
  fleetState.nodes.scroller.scrollLeft = 0;
}

async function loadRecord(weekKey) {
  try {
    const response = await fetch(`/api/fleet/${encodeURIComponent(weekKey)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('unavailable');
    const data = await response.json();
    fleetState.persistence = 'server';
    return normalizeRecord(data.record || data, weekKey);
  } catch {
    fleetState.persistence = 'local';
    try {
      const mirror = JSON.parse(localStorage.getItem(MIRROR_KEY) || '{}');
      if (mirror[weekKey]) return normalizeRecord(mirror[weekKey], weekKey);
    } catch { /* an unreadable mirror is not worth a crash */ }
    return emptyRecord(weekKey);
  }
}

/* ------------------------------------------------------------------ *
 * Saving — debounced, last-write-wins on a record only this dialog edits.
 * ------------------------------------------------------------------ */
function scheduleSave(immediate = false) {
  fleetState.savePending = true;
  paintSaveState('Saving…');
  clearTimeout(fleetState.saveTimer);
  if (immediate) return saveNow();
  fleetState.saveTimer = setTimeout(saveNow, 600);
}

async function saveNow() {
  clearTimeout(fleetState.saveTimer);
  if (!fleetState.record) return;
  const payload = JSON.parse(JSON.stringify(fleetState.record));
  writeMirror(payload);
  if (fleetState.persistence !== 'server') {
    fleetState.savePending = false;
    return paintSaveState('Saved in this browser');
  }
  try {
    const response = await fetch('/api/fleet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error('save failed');
    fleetState.savePending = false;
    paintSaveState(`Saved ${formatTime(new Date().toISOString())}`);
  } catch {
    fleetState.persistence = 'local';
    fleetState.savePending = false;
    paintSaveState('Server unavailable — saved in this browser');
  }
}

function writeMirror(record) {
  try {
    const mirror = JSON.parse(localStorage.getItem(MIRROR_KEY) || '{}');
    mirror[record.key] = record;
    localStorage.setItem(MIRROR_KEY, JSON.stringify(mirror));
  } catch { /* quota or private mode; the server copy is the real one */ }
}

function paintSaveState(text) {
  if (fleetState.nodes.saveState) fleetState.nodes.saveState.textContent = text;
}

/* ------------------------------------------------------------------ *
 * Dialog scaffolding — built once, in JS, so index.html stays small.
 * ------------------------------------------------------------------ */
function ensureDialog() {
  if (fleetState.dialog) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'fleet-dialog';
  dialog.id = 'fleetDialog';
  dialog.innerHTML = `
    <div class="fleet-shell">
      <header class="fleet-toolbar">
        <div class="fleet-title-block">
          <p class="fleet-period" id="fleetPeriod"></p>
          <p class="fleet-sub" id="fleetSub"></p>
        </div>
        <div class="fleet-tallies" id="fleetTallies"></div>
        <div class="fleet-actions" id="fleetMatrixActions">
          <button class="button button-primary" type="button" data-act="all-ok">Mark all yellow as OK</button>
          <button class="button button-quiet" type="button" data-act="reset-ok">Reset OK → yellow</button>
          <button class="button button-quiet" type="button" data-act="report">Weekly report</button>
          <button class="icon-button" type="button" data-act="close" aria-label="Close">×</button>
        </div>
        <div class="fleet-actions" id="fleetReportActions">
          <button class="button button-quiet" type="button" data-act="back">← Back to matrix</button>
          <button class="button button-quiet" type="button" data-act="print">Print</button>
          <button class="button button-primary" type="button" data-act="download">Download report</button>
          <button class="icon-button" type="button" data-act="close" aria-label="Close">×</button>
        </div>
      </header>

      <div class="fleet-controls" id="fleetControls">
        <div class="fleet-legend">
          <span class="legend-chip state-pending">Not inspected</span>
          <span class="legend-chip state-ok">OK</span>
          <span class="legend-chip state-minor">Minor</span>
          <span class="legend-chip state-urgent">Urgent</span>
          <span class="legend-hint">Click a box to step it on · right-click to step back</span>
        </div>
        <div class="fleet-groupbar" id="fleetGroupBar"></div>
        <div class="fleet-save" id="fleetSaveState"></div>
      </div>

      <div class="fleet-body" id="fleetScroller"></div>
    </div>`;
  document.body.append(dialog);

  fleetState.dialog = dialog;
  fleetState.nodes = {
    period: dialog.querySelector('#fleetPeriod'),
    sub: dialog.querySelector('#fleetSub'),
    tallies: dialog.querySelector('#fleetTallies'),
    matrixActions: dialog.querySelector('#fleetMatrixActions'),
    reportActions: dialog.querySelector('#fleetReportActions'),
    controls: dialog.querySelector('#fleetControls'),
    groupBar: dialog.querySelector('#fleetGroupBar'),
    saveState: dialog.querySelector('#fleetSaveState'),
    scroller: dialog.querySelector('#fleetScroller')
  };

  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeFleet(); });
  dialog.addEventListener('click', onToolbarClick);
  fleetState.nodes.scroller.addEventListener('click', onBodyClick);
  fleetState.nodes.scroller.addEventListener('contextmenu', onBodyContextMenu);
  fleetState.nodes.scroller.addEventListener('input', onBodyInput);
  fleetState.nodes.scroller.addEventListener('change', onBodyChange);
  fleetState.nodes.groupBar.addEventListener('click', onGroupBarClick);
}

async function closeFleet() {
  if (fleetState.savePending) await saveNow();
  if (fleetState.dialog?.open) fleetState.dialog.close();
  document.dispatchEvent(new CustomEvent('fleet-week-closed', { detail: { weekKey: fleetState.weekKey } }));
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */
function renderAll() {
  const record = fleetState.record;
  fleetState.nodes.period.textContent = `Vehicle maintenance — ${fleetState.weekLabel}`;
  fleetState.nodes.sub.textContent = `${allVehicles().length} vehicles · ${CHECKPOINTS.length} checkpoints · ${GROUPS.length} groups`;
  paintSaveState(record.updatedAt && record.events.length ? `Last change ${formatStamp(record.updatedAt)}` : 'No entries yet this week');
  renderGroupBar();
  renderTallies();
  const showReport = fleetState.view === 'report';
  fleetState.nodes.matrixActions.classList.toggle('is-hidden', showReport);
  fleetState.nodes.reportActions.classList.toggle('is-hidden', !showReport);
  fleetState.nodes.controls.classList.toggle('is-hidden', showReport);
  if (showReport) fleetState.nodes.scroller.innerHTML = renderReportHtml(fleetState.report);
  else renderMatrix();
}

function renderTallies() {
  const totals = matrixTally(fleetState.record);
  fleetState.nodes.tallies.innerHTML = `
    <span class="tally-pill state-ok" title="Checkpoints marked OK">${totals.ok} OK</span>
    <span class="tally-pill state-minor" title="Minor faults">${totals.minor} minor</span>
    <span class="tally-pill state-urgent" title="Urgent faults">${totals.urgent} urgent</span>
    <span class="tally-pill state-pending" title="Never inspected this week">${totals.pending} left</span>
    <span class="tally-pill neutral" title="Vehicles with every checkpoint inspected">${totals.vehiclesComplete}/${totals.vehicles} done</span>`;
}

function renderGroupBar() {
  const expandedCount = GROUPS.filter((group) => fleetState.expanded.has(group.id)).length;
  fleetState.nodes.groupBar.innerHTML = `
    <span class="groupbar-label">Groups</span>
    ${GROUPS.map((group) => `<button class="group-chip${fleetState.expanded.has(group.id) ? ' open' : ''}" type="button" data-group="${escapeAttr(group.id)}" title="${escapeAttr(group.title)} — ${group.checkpoints.length} checkpoints">
      ${escapeHtml(group.short)} <b>${group.checkpoints.length}</b>
    </button>`).join('')}
    <button class="group-chip bulk" type="button" data-group-all="${expandedCount === GROUPS.length ? 'collapse' : 'expand'}">${expandedCount === GROUPS.length ? 'Collapse all' : 'Expand all'}</button>`;
}

function renderMatrix() {
  const record = fleetState.record;
  const columns = visibleColumns();

  let head = `<thead>
    <tr class="group-row">
      <th class="sticky sticky-1 corner" rowspan="2">Vehicle</th>
      <th class="sticky sticky-2 corner" rowspan="2">Spare parts needed</th>
      <th class="sticky sticky-3 corner" rowspan="2">Comments</th>
      ${GROUPS.map((group) => {
        const open = fleetState.expanded.has(group.id);
        const span = open ? group.checkpoints.length : 1;
        return `<th class="group-head${open ? ' open' : ''}" colspan="${span}" data-group-head="${escapeAttr(group.id)}" title="${escapeAttr(open ? 'Collapse' : 'Expand')} ${escapeAttr(group.title)}">
          <span class="group-head-inner">${escapeHtml(open ? group.title : group.short)}<span class="group-caret">${open ? '−' : '+'}</span></span>
        </th>`;
      }).join('')}
    </tr>
    <tr class="checkpoint-row">
      ${columns.map((column) => column.kind === 'summary'
        ? `<th class="cp-head summary-head" data-group-head="${escapeAttr(column.group)}" title="${escapeAttr(column.title)} — ${column.count} checkpoints, click to expand"><span class="cp-label">${column.count} checks</span></th>`
        : `<th class="cp-head${column.form ? ' form' : ''}" title="${escapeAttr(column.label)}${column.form ? ' · on the driver’s daily safety form' : ''}"><span class="cp-label">${escapeHtml(column.label)}</span></th>`).join('')}
    </tr>
  </thead>`;

  let body = '<tbody>';
  for (const fleet of FLEETS) {
    body += `<tr class="fleet-divider"><td class="sticky sticky-1 fleet-divider-cell" colspan="3">
        <strong>${escapeHtml(fleet.title)}</strong><span>${escapeHtml(fleet.note)}</span>
      </td>${columns.map(() => '<td class="fleet-divider-fill"></td>').join('')}</tr>`;
    for (const vehicle of fleet.vehicles) {
      body += renderRow(record, vehicle, columns);
    }
  }
  body += '</tbody>';

  const { scrollLeft, scrollTop } = fleetState.nodes.scroller;
  const anyExpanded = GROUPS.some((group) => fleetState.expanded.has(group.id));
  fleetState.nodes.scroller.innerHTML = `<div class="fleet-table-wrap"><table class="fleet-table${anyExpanded ? ' has-expanded' : ''}">${head}${body}</table></div>`;
  // Rebuilding the table sends the scroller back to 0,0. Put it back: expanding
  // a group or pressing "all OK" must not lose the fleet manager's place in a
  // 122-column row.
  fleetState.nodes.scroller.scrollLeft = scrollLeft;
  fleetState.nodes.scroller.scrollTop = Math.min(scrollTop, Math.max(0, fleetState.nodes.scroller.scrollHeight - fleetState.nodes.scroller.clientHeight));
}

function renderRow(record, vehicle, columns) {
  const tally = vehicleTally(record, vehicle.plate);
  const parts = record.parts[vehicle.plate] || [];
  return `<tr data-plate="${escapeAttr(vehicle.plate)}">
    <th class="sticky sticky-1 vehicle-cell" scope="row">
      <span class="plate">${escapeHtml(vehicle.plate)}</span>
      <span class="owner-chip owner-${escapeAttr(vehicle.owner || 'unset')}">${escapeHtml(OWNER_LABEL[vehicle.owner] ?? '—')}</span>
      ${renderRowTally(tally)}
      <button class="row-ok" type="button" data-row-ok="${escapeAttr(vehicle.plate)}" title="Mark every remaining yellow box on ${escapeAttr(vehicle.plate)} as OK">Row OK</button>
    </th>
    <td class="sticky sticky-2 parts-cell">
      <div class="part-chips" data-parts-for="${escapeAttr(vehicle.plate)}">${parts.map((part) => renderPartChip(vehicle.plate, part)).join('') || '<span class="parts-empty">None</span>'}</div>
      <select class="part-select" data-part-select="${escapeAttr(vehicle.plate)}" aria-label="Add a spare part for ${escapeAttr(vehicle.plate)}">
        <option value="">+ Add spare part…</option>
        ${SPARE_PARTS.map((group) => `<optgroup label="${escapeAttr(group.group)}">${group.items.map((item) => `<option value="${escapeAttr(item)}">${escapeHtml(item)}</option>`).join('')}</optgroup>`).join('')}
      </select>
    </td>
    <td class="sticky sticky-3 comment-cell">
      <textarea data-comment-for="${escapeAttr(vehicle.plate)}" rows="3" placeholder="Notes, workshop bookings, damage…">${escapeHtml(record.comments[vehicle.plate] || '')}</textarea>
    </td>
    ${columns.map((column) => column.kind === 'summary'
      ? renderSummaryCell(record, vehicle.plate, column.group)
      : renderCell(record, vehicle.plate, column)).join('')}
  </tr>`;
}

function renderRowTally(tally) {
  return `<span class="row-tally" data-row-tally>
    <span class="rt ok">${tally.ok}</span><span class="rt minor">${tally.minor}</span><span class="rt urgent">${tally.urgent}</span><span class="rt pending">${tally.pending}</span>
  </span>`;
}

function renderPartChip(plate, part) {
  return `<span class="part-chip">${escapeHtml(part)}<button type="button" data-part-remove="${escapeAttr(part)}" data-part-plate="${escapeAttr(plate)}" aria-label="Remove ${escapeAttr(part)}">×</button></span>`;
}

function renderCell(record, plate, column) {
  const state = cellState(record, plate, column.id);
  const stamp = cellStamp(record, plate, column.id);
  return `<td class="cell-td"><button class="cell state-${state}" type="button"
    data-cell="${escapeAttr(column.id)}"
    aria-label="${escapeAttr(plate)} — ${escapeAttr(column.label)}: ${escapeAttr(STATE_META[state].label)}"
    title="${escapeAttr(cellTitle(plate, column.label, state, stamp))}"></button></td>`;
}

function renderSummaryCell(record, plate, groupId) {
  const tally = groupTally(record, plate, groupId);
  const group = GROUPS.find((entry) => entry.id === groupId);
  const detail = tally.faults
    ? `${tally.urgent} urgent, ${tally.minor} minor`
    : tally.pending
      ? `${tally.pending} of ${tally.total} not inspected`
      : 'all inspected, no faults';
  return `<td class="cell-td summary-td"><button class="cell summary state-${tally.worst}" type="button"
    data-group-head="${escapeAttr(groupId)}"
    title="${escapeAttr(`${plate} — ${group.title}: ${detail}. Click to expand the group.`)}">
    <span class="summary-figure">${tally.faults ? tally.faults : tally.pending ? tally.pending : '✓'}</span>
  </button></td>`;
}

function cellTitle(plate, label, state, stamp) {
  const base = `${plate} — ${label}\n${STATE_META[state].label}`;
  return stamp ? `${base}\nSet ${formatStamp(stamp)}` : `${base}\nNot recorded yet`;
}

function visibleColumns() {
  return GROUPS.flatMap((group) => fleetState.expanded.has(group.id)
    ? group.checkpoints.map((cp) => ({ kind: 'cell', group: group.id, ...cp }))
    : [{ kind: 'summary', group: group.id, short: group.short, title: group.title, count: group.checkpoints.length }]);
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */
function onToolbarClick(event) {
  const button = event.target.closest('[data-act]');
  if (!button || !fleetState.dialog.contains(button)) return;
  const action = button.dataset.act;
  if (action === 'close') return void closeFleet();
  if (action === 'all-ok') return bulkOk();
  if (action === 'reset-ok') return bulkReset();
  if (action === 'report') return showReport();
  if (action === 'back') { fleetState.view = 'matrix'; return renderAll(); }
  if (action === 'print') return printReport();
  if (action === 'download') return downloadReport();
}

function onGroupBarClick(event) {
  const bulk = event.target.closest('[data-group-all]');
  if (bulk) {
    if (bulk.dataset.groupAll === 'expand') GROUPS.forEach((group) => fleetState.expanded.add(group.id));
    else fleetState.expanded.clear();
    saveExpanded();
    renderGroupBar();
    return renderMatrix();
  }
  const chip = event.target.closest('[data-group]');
  if (!chip) return;
  toggleGroup(chip.dataset.group);
}

function toggleGroup(groupId) {
  if (fleetState.expanded.has(groupId)) fleetState.expanded.delete(groupId);
  else fleetState.expanded.add(groupId);
  saveExpanded();
  renderGroupBar();
  renderMatrix();
}

function onBodyClick(event) {
  const groupHead = event.target.closest('[data-group-head]');
  if (groupHead) return toggleGroup(groupHead.dataset.groupHead);

  const partRemove = event.target.closest('[data-part-remove]');
  if (partRemove) {
    const plate = partRemove.dataset.partPlate;
    if (removePart(fleetState.record, plate, partRemove.dataset.partRemove)) {
      repaintParts(plate);
      scheduleSave();
    }
    return;
  }

  const rowOk = event.target.closest('[data-row-ok]');
  if (rowOk) {
    const plate = rowOk.dataset.rowOk;
    const changed = markAllOk(fleetState.record, { plates: [plate] });
    if (changed) {
      repaintRow(plate);
      renderTallies();
      scheduleSave();
      toast(`${changed} checkpoint${changed === 1 ? '' : 's'} on ${plate} marked OK.`);
    } else {
      toast(`Nothing left yellow on ${plate}.`);
    }
    return;
  }

  const cell = event.target.closest('[data-cell]');
  if (cell) stepCell(cell, 1);
}

function onBodyContextMenu(event) {
  const cell = event.target.closest('[data-cell]');
  if (!cell) return;
  event.preventDefault();
  stepCell(cell, -1);
}

function stepCell(button, direction) {
  const plate = button.closest('[data-plate]')?.dataset.plate;
  const checkpointId = button.dataset.cell;
  if (!plate || !checkpointId) return;
  const current = cellState(fleetState.record, plate, checkpointId);
  const target = direction > 0 ? nextState(current) : previousState(current);
  if (!setCell(fleetState.record, plate, checkpointId, target)) return;
  const state = cellState(fleetState.record, plate, checkpointId);
  const stamp = cellStamp(fleetState.record, plate, checkpointId);
  const label = CHECKPOINTS.find((cp) => cp.id === checkpointId)?.label || checkpointId;
  button.className = `cell state-${state}`;
  button.title = cellTitle(plate, label, state, stamp);
  button.setAttribute('aria-label', `${plate} — ${label}: ${STATE_META[state].label}`);
  repaintRowTally(plate);
  renderTallies();
  scheduleSave();
}

function onBodyInput(event) {
  const textarea = event.target.closest('[data-comment-for]');
  if (!textarea) return;
  setComment(fleetState.record, textarea.dataset.commentFor, textarea.value);
  scheduleSave();
}

function onBodyChange(event) {
  const select = event.target.closest('[data-part-select]');
  if (!select || !select.value) return;
  const plate = select.dataset.partSelect;
  const added = addPart(fleetState.record, plate, select.value);
  select.value = '';
  if (!added) return toast('That part is already on the list.');
  repaintParts(plate);
  scheduleSave();
}

function bulkOk() {
  const changed = markAllOk(fleetState.record);
  if (!changed) return toast('Every checkpoint has already been looked at.');
  renderMatrix();
  renderTallies();
  scheduleSave(true);
  toast(`${changed} yellow checkpoint${changed === 1 ? '' : 's'} marked OK. Faults were left alone.`);
}

function bulkReset() {
  const green = matrixTally(fleetState.record).ok;
  if (!green) return toast('Nothing is marked OK.');
  if (!confirm(`Put ${green} OK checkpoint${green === 1 ? '' : 's'} back to yellow? Minor and urgent faults are kept.`)) return;
  const changed = resetOkToPending(fleetState.record);
  renderMatrix();
  renderTallies();
  scheduleSave(true);
  toast(`${changed} checkpoint${changed === 1 ? '' : 's'} reset to yellow.`);
}

/* ------------------------------------------------------------------ *
 * Targeted repaints — never a full re-render on a click.
 * ------------------------------------------------------------------ */
function rowNode(plate) {
  return fleetState.nodes.scroller.querySelector(`tr[data-plate="${cssEscape(plate)}"]`);
}

function repaintRowTally(plate) {
  const row = rowNode(plate);
  if (!row) return;
  const holder = row.querySelector('[data-row-tally]');
  if (holder) holder.outerHTML = renderRowTally(vehicleTally(fleetState.record, plate));
}

function repaintRow(plate) {
  const row = rowNode(plate);
  if (!row) return;
  const columns = visibleColumns();
  row.querySelectorAll('.cell-td').forEach((td, index) => {
    const column = columns[index];
    if (!column) return;
    td.outerHTML = column.kind === 'summary'
      ? renderSummaryCell(fleetState.record, plate, column.group)
      : renderCell(fleetState.record, plate, column);
  });
  repaintRowTally(plate);
}

function repaintParts(plate) {
  const holder = fleetState.nodes.scroller.querySelector(`[data-parts-for="${cssEscape(plate)}"]`);
  if (!holder) return;
  const parts = fleetState.record.parts[plate] || [];
  holder.innerHTML = parts.map((part) => renderPartChip(plate, part)).join('') || '<span class="parts-empty">None</span>';
}

/* ------------------------------------------------------------------ *
 * The weekly report
 * ------------------------------------------------------------------ */
function showReport() {
  fleetState.report = buildReport(fleetState.record, {
    weekKey: fleetState.weekKey,
    weekLabel: fleetState.weekLabel
  });
  fleetState.view = 'report';
  renderAll();
  fleetState.nodes.scroller.scrollTop = 0;
}

function renderReportHtml(report) {
  const statusWord = {
    'not-started': 'NOT STARTED',
    incomplete: 'INCOMPLETE',
    'complete-with-faults': 'COMPLETE — faults open',
    complete: 'COMPLETE'
  };

  const summary = `<section class="rep-summary">
    <div class="rep-tile"><b>${report.totals.vehicles}</b><span>vehicles</span></div>
    <div class="rep-tile"><b>${report.totals.total}</b><span>checkpoints</span></div>
    <div class="rep-tile ok"><b>${report.totals.ok}</b><span>OK</span></div>
    <div class="rep-tile minor"><b>${report.totals.minor}</b><span>minor faults</span></div>
    <div class="rep-tile urgent"><b>${report.totals.urgent}</b><span>urgent faults</span></div>
    <div class="rep-tile pending"><b>${report.totals.pending}</b><span>not inspected</span></div>
    <div class="rep-tile"><b>${report.totals.percent}%</b><span>coverage</span></div>
  </section>`;

  const faults = report.faults.length
    ? `<table class="rep-table">
        <thead><tr><th>Vehicle</th><th>Severity</th><th>Checkpoint</th><th>Group</th><th>Marked at</th></tr></thead>
        <tbody>${report.faults.map((fault) => `<tr class="sev-${fault.state}">
          <td class="mono">${escapeHtml(fault.plate)}</td>
          <td><span class="sev-chip state-${fault.state}">${escapeHtml(STATE_META[fault.state].short)}</span></td>
          <td>${escapeHtml(fault.label)}</td>
          <td class="muted">${escapeHtml(fault.group)}</td>
          <td class="mono">${escapeHtml(formatStamp(fault.at))}</td>
        </tr>`).join('')}</tbody>
      </table>`
    : '<p class="rep-none">No faults were recorded this week.</p>';

  const overview = `<table class="rep-table">
    <thead><tr><th>Vehicle</th><th>Owner</th><th>Inspected</th><th>OK</th><th>Minor</th><th>Urgent</th><th>First worked</th><th>Last worked</th><th>Status</th></tr></thead>
    <tbody>${report.vehicles.map((vehicle) => `<tr>
      <td class="mono">${escapeHtml(vehicle.plate)}</td>
      <td class="muted">${escapeHtml(vehicle.ownerLabel)}</td>
      <td class="mono">${vehicle.tally.inspected}/${vehicle.tally.total}</td>
      <td class="mono">${vehicle.tally.ok}</td>
      <td class="mono">${vehicle.tally.minor || ''}</td>
      <td class="mono">${vehicle.tally.urgent || ''}</td>
      <td class="mono">${escapeHtml(formatStamp(vehicle.firstCheckedAt))}</td>
      <td class="mono">${escapeHtml(formatStamp(vehicle.lastCheckedAt))}</td>
      <td><span class="sev-chip state-${vehicle.status === 'complete' ? 'ok' : vehicle.status === 'not-started' ? 'pending' : vehicle.status === 'complete-with-faults' ? 'minor' : 'pending'}">${escapeHtml(statusWord[vehicle.status])}</span></td>
    </tr>`).join('')}</tbody>
  </table>`;

  const notDone = report.notCompleted.length
    ? `<table class="rep-table">
        <thead><tr><th>Vehicle</th><th>Status</th><th>Inspected</th><th>Still not inspected</th></tr></thead>
        <tbody>${report.notCompleted.map((vehicle) => `<tr>
          <td class="mono">${escapeHtml(vehicle.plate)}</td>
          <td><span class="sev-chip state-${vehicle.tally.inspected === 0 ? 'pending' : 'minor'}">${escapeHtml(statusWord[vehicle.status])}</span></td>
          <td class="mono">${vehicle.tally.inspected}/${vehicle.tally.total}</td>
          <td>${vehicle.outstandingByGroup.map((entry) => `${escapeHtml(entry.group)} (${entry.count})`).join(', ')}</td>
        </tr>`).join('')}</tbody>
      </table>`
    : '<p class="rep-none">Every checkpoint on every vehicle was inspected this week.</p>';

  const parts = report.partsRequested.length
    ? `<ul class="rep-parts">${report.partsRequested.map((entry) => `<li><b class="mono">${escapeHtml(entry.plate)}</b> ${entry.parts.map((part) => `<span class="part-chip static">${escapeHtml(part)}</span>`).join('')}</li>`).join('')}</ul>`
    : '<p class="rep-none">No spare parts were requested.</p>';

  const comments = report.vehicles.filter((vehicle) => vehicle.comment.trim());
  const commentBlock = comments.length
    ? `<dl class="rep-comments">${comments.map((vehicle) => `<dt class="mono">${escapeHtml(vehicle.plate)}</dt><dd>${escapeHtml(vehicle.comment).replace(/\n/g, '<br>')}</dd>`).join('')}</dl>`
    : '<p class="rep-none">No comments were written.</p>';

  const log = report.events.length
    ? `<table class="rep-table rep-log">
        <thead><tr><th>Time</th><th>Vehicle</th><th>Item</th><th>Change</th></tr></thead>
        <tbody>${report.events.map((event) => `<tr>
          <td class="mono">${escapeHtml(formatStamp(event.t))}</td>
          <td class="mono">${escapeHtml(eventVehicleLabel(event))}</td>
          <td>${escapeHtml(eventItemLabel(event))}</td>
          <td>${escapeHtml(describeEvent(event))}</td>
        </tr>`).join('')}</tbody>
      </table>`
    : '<p class="rep-none">Nothing has been clicked in this week yet.</p>';

  return `<article class="fleet-report" id="fleetReportPaper">
    <header class="rep-head">
      <h1>Vehicle maintenance report</h1>
      <p class="rep-week">${escapeHtml(report.weekLabel)}</p>
      <p class="rep-generated">Generated ${escapeHtml(formatStamp(report.generatedAt))} · ${report.totals.vehiclesComplete} of ${report.totals.vehicles} vehicles fully inspected</p>
    </header>
    ${summary}
    <h2>1 · Faults to fix</h2>
    ${faults}
    <h2>2 · Every vehicle, and when it was worked on</h2>
    ${overview}
    <h2>3 · Not completed this week</h2>
    ${notDone}
    <h2>4 · Spare parts requested</h2>
    ${parts}
    <h2>5 · Comments</h2>
    ${commentBlock}
    <h2>6 · Full activity log (${report.events.length} ${report.events.length === 1 ? 'entry' : 'entries'})</h2>
    ${log}
  </article>`;
}

function describeEvent(event) {
  if (event.src === 'part-add') return 'Spare part added';
  if (event.src === 'part-remove') return 'Spare part removed';
  const from = STATE_META[event.from]?.short || event.from;
  const to = STATE_META[event.to]?.short || event.to;
  if (event.src === 'bulk-ok' || event.src === 'bulk-reset') {
    const what = event.src === 'bulk-ok' ? 'marked OK' : 'reset to Not inspected';
    return `${event.count} checkpoint${event.count === 1 ? '' : 's'} ${what} in one action (${event.scope || 'whole matrix'})`;
  }
  return `${from} → ${to}`;
}

function eventItemLabel(event) {
  if (event.label) return event.label;
  if (event.part) return `Spare part: ${event.part}`;
  if (event.src === 'bulk-ok' || event.src === 'bulk-reset') return 'Bulk action';
  return '—';
}

function eventVehicleLabel(event) {
  return event.plate === 'ALL' ? 'All vehicles' : event.plate;
}

function reportDocument() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Vehicle maintenance report — ${escapeHtml(fleetState.weekLabel)}</title><style>${reportStyles()}</style></head><body>${renderReportHtml(fleetState.report)}</body></html>`;
}

function printReport() {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return toast('Allow pop-ups to print, or use Download report.');
  printWindow.opener = null;
  printWindow.document.write(reportDocument());
  printWindow.document.close();
  printWindow.addEventListener('load', () => { printWindow.focus(); printWindow.print(); });
}

function downloadReport() {
  const blob = new Blob([reportDocument()], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `vehicle-maintenance-${fleetState.weekKey}.html`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast('Report downloaded.');
}

function reportStyles() {
  return `:root{--ink:#111827;--muted:#6b7280;--line:#e5e7eb;--ok:#1a7f37;--warn:#b26a00;--danger:#c0392b}
*{box-sizing:border-box}body{margin:0;padding:28px;font:13px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--ink);background:#fff}
.fleet-report{max-width:1000px;margin:0 auto}
.rep-head{border-bottom:2px solid var(--ink);padding-bottom:12px;margin-bottom:18px}
h1{font-size:21px;margin:0 0 4px;letter-spacing:.02em}
.rep-week{margin:0;font-weight:700}.rep-generated{margin:4px 0 0;color:var(--muted);font-size:12px}
h2{font-size:14px;margin:26px 0 10px;padding-bottom:5px;border-bottom:1px solid var(--line);letter-spacing:.04em;text-transform:uppercase}
.rep-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px;margin-bottom:6px}
.rep-tile{border:1px solid var(--line);padding:9px 10px}
.rep-tile b{display:block;font-size:19px;line-height:1.1}.rep-tile span{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.rep-tile.ok b{color:var(--ok)}.rep-tile.minor b{color:var(--warn)}.rep-tile.urgent b{color:var(--danger)}.rep-tile.pending b{color:#8a6d1f}
.rep-table{width:100%;border-collapse:collapse;font-size:12px}
.rep-table th{text-align:left;border-bottom:1px solid var(--ink);padding:6px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.rep-table td{border-bottom:1px solid var(--line);padding:6px 8px;vertical-align:top}
.rep-table tr{break-inside:avoid}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}
.muted{color:var(--muted)}
.sev-chip{display:inline-block;padding:1px 7px;border:1px solid currentColor;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.sev-chip.state-urgent{color:var(--danger)}.sev-chip.state-minor{color:var(--warn)}.sev-chip.state-pending{color:#8a6d1f}.sev-chip.state-ok{color:var(--ok)}
.rep-none{color:var(--muted);font-style:italic;margin:0}
.rep-parts{list-style:none;margin:0;padding:0}.rep-parts li{padding:5px 0;border-bottom:1px solid var(--line)}
.part-chip.static{display:inline-block;border:1px solid var(--line);padding:1px 7px;margin:2px 4px 2px 0;font-size:11px}
.rep-comments{margin:0}.rep-comments dt{font-weight:700;margin-top:8px}.rep-comments dd{margin:2px 0 0 0;padding-left:12px;border-left:2px solid var(--line)}
.rep-log td:first-child{width:150px}
@page{size:A4;margin:14mm}
@media print{body{padding:0}h2{break-after:avoid}}`;
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */
function loadExpanded() {
  try {
    const saved = JSON.parse(localStorage.getItem(EXPANDED_KEY) || '[]');
    return new Set(Array.isArray(saved) ? saved.filter((id) => GROUPS.some((group) => group.id === id)) : []);
  } catch {
    return new Set();
  }
}

function saveExpanded() {
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...fleetState.expanded])); } catch { /* not important enough to fail on */ }
}

function formatStamp(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function toast(message) {
  const node = document.querySelector('#toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
}

function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

function escapeAttr(value) { return escapeHtml(value).replace(/'/g, '&#39;'); }

/* Exposed for the tests and for anything that wants the week summary without
 * opening the dialog (the calendar badge uses it). */
export { matrixTally, buildReport, normalizeRecord };
