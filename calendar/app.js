import { createChecklistPdf } from './pdf.js';
import { openFleetWeek } from './fleet.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const STORAGE_KEY = 'substitute-checklist-calendar-v1';
const today = new Date();

const state = {
  currentYear: today.getFullYear(),
  currentMonth: today.getMonth(),
  view: 'month',
  checklists: new Map(),
  activeChecklist: null,
  activePeriodLabel: '',
  activeIsNew: false,
  persistence: 'server',
  commentTimer: null,
  // week key -> { totals } for the vehicle matrix badge on each week row.
  fleetWeeks: new Map()
};

const elements = {
  storageStatus: document.querySelector('#storageStatus'),
  exportButton: document.querySelector('#exportButton'),
  importInput: document.querySelector('#importInput'),
  previousButton: document.querySelector('#previousButton'),
  todayButton: document.querySelector('#todayButton'),
  nextButton: document.querySelector('#nextButton'),
  monthSelect: document.querySelector('#monthSelect'),
  yearInput: document.querySelector('#yearInput'),
  monthlyChecklistButton: document.querySelector('#monthlyChecklistButton'),
  monthViewButton: document.querySelector('#monthViewButton'),
  yearViewButton: document.querySelector('#yearViewButton'),
  monthView: document.querySelector('#monthView'),
  yearView: document.querySelector('#yearView'),
  dialog: document.querySelector('#checklistDialog'),
  dialogPeriod: document.querySelector('#dialogPeriod'),
  dialogModeLabel: document.querySelector('#dialogModeLabel'),
  useActions: document.querySelector('#useActions'),
  editActions: document.querySelector('#editActions'),
  useView: document.querySelector('#checklistUseView'),
  editor: document.querySelector('#checklistEditor'),
  editButton: document.querySelector('#editButton'),
  downloadButton: document.querySelector('#downloadButton'),
  printButton: document.querySelector('#printButton'),
  closeButton: document.querySelector('#closeButton'),
  deleteButton: document.querySelector('#deleteButton'),
  cancelEditButton: document.querySelector('#cancelEditButton'),
  saveButton: document.querySelector('#saveButton'),
  closeEditButton: document.querySelector('#closeEditButton'),
  toast: document.querySelector('#toast')
};

init();

async function init() {
  populateMonthSelect();
  bindEvents();
  await Promise.all([loadChecklists(), loadFleetSummaries()]);
  render();
}

/**
 * One summary per week for the vehicle matrix badges on the week rows.
 *
 * Cheap — the server derives it from the file it already reads — and
 * failure-tolerant: with no summaries the week rows simply show an unbadged
 * button, which is what an untouched week looks like anyway.
 */
async function loadFleetSummaries() {
  try {
    const response = await fetch('/api/fleet', { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    state.fleetWeeks = new Map((data.weeks || []).map((week) => [week.key, week]));
  } catch {
    /* keep whatever we already had */
  }
}

function populateMonthSelect() {
  elements.monthSelect.innerHTML = MONTHS.map((month, index) => `<option value="${index}">${month}</option>`).join('');
}

function bindEvents() {
  elements.previousButton.addEventListener('click', () => navigate(-1));
  elements.nextButton.addEventListener('click', () => navigate(1));
  elements.todayButton.addEventListener('click', () => {
    state.currentYear = today.getFullYear();
    state.currentMonth = today.getMonth();
    state.view = 'month';
    render();
  });
  elements.monthSelect.addEventListener('change', () => {
    state.currentMonth = Number(elements.monthSelect.value);
    state.view = 'month';
    render();
  });
  elements.yearInput.addEventListener('change', () => {
    state.currentYear = clamp(Number(elements.yearInput.value) || today.getFullYear(), 1900, 2300);
    render();
  });
  elements.monthViewButton.addEventListener('click', () => { state.view = 'month'; render(); });
  elements.yearViewButton.addEventListener('click', () => { state.view = 'year'; render(); });
  elements.monthlyChecklistButton.addEventListener('click', () => openSlot('month', monthKey(state.currentYear, state.currentMonth), formatMonth(state.currentYear, state.currentMonth)));
  elements.editButton.addEventListener('click', () => showEditor(false));
  elements.downloadButton.addEventListener('click', downloadActivePdf);
  elements.printButton.addEventListener('click', printActiveChecklist);
  elements.closeButton.addEventListener('click', closeDialog);
  elements.closeEditButton.addEventListener('click', closeDialog);
  elements.cancelEditButton.addEventListener('click', cancelEditor);
  elements.saveButton.addEventListener('click', saveEditor);
  elements.deleteButton.addEventListener('click', deleteActiveChecklist);
  elements.exportButton.addEventListener('click', exportBackup);
  elements.importInput.addEventListener('change', importBackup);
  elements.dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
  // The matrix dialog lives in fleet.js and saves on its own; when it closes,
  // re-read the summaries so the week badges match what was just recorded.
  document.addEventListener('fleet-week-closed', async () => {
    await loadFleetSummaries();
    render();
  });
}

async function loadChecklists() {
  try {
    const response = await fetch('/api/checklists', { cache: 'no-store' });
    if (!response.ok) throw new Error('Server storage unavailable');
    const data = await response.json();
    state.checklists = new Map(data.map((entry) => [entry.id, normalizeChecklist(entry)]));
    state.persistence = 'server';
    elements.storageStatus.textContent = 'Server storage active';
    elements.storageStatus.classList.remove('local');
  } catch {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    state.checklists = new Map(saved.map((entry) => [entry.id, normalizeChecklist(entry)]));
    state.persistence = 'local';
    elements.storageStatus.textContent = 'Local browser storage';
    elements.storageStatus.classList.add('local');
  }
}

/**
 * Re-read the server's copy without disturbing anything on screen. Silent by
 * design: if the server cannot be reached the page keeps the records it has and
 * saving falls back to browser storage exactly as before.
 */
async function refreshFromServer() {
  if (state.persistence !== 'server') return;
  try {
    const response = await fetch('/api/checklists', { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    state.checklists = new Map(data.map((entry) => [entry.id, normalizeChecklist(entry)]));
    writeLocalMirror();
    render();
  } catch {
    /* Keep the records already loaded; saveChecklist handles the fallback. */
  }
}

function render() {
  elements.monthSelect.value = String(state.currentMonth);
  elements.yearInput.value = String(state.currentYear);
  elements.monthView.hidden = state.view !== 'month';
  elements.yearView.hidden = state.view !== 'year';
  elements.monthViewButton.classList.toggle('active', state.view === 'month');
  elements.yearViewButton.classList.toggle('active', state.view === 'year');
  renderMonthlySlot();
  if (state.view === 'month') renderMonthView();
  else renderYearView();
}

function renderMonthlySlot() {
  const key = monthKey(state.currentYear, state.currentMonth);
  const checklist = state.checklists.get(`month:${key}`);
  elements.monthlyChecklistButton.className = `month-checklist-button${checklist ? ' has-checklist' : ''}`;
  elements.monthlyChecklistButton.innerHTML = `
    <span class="slot-kicker">MONTHLY CHECKLIST</span>
    <span class="slot-title">${escapeHtml(checklist?.title || `+ Create for ${MONTHS[state.currentMonth]}`)}</span>`;
}

function renderMonthView() {
  const first = new Date(state.currentYear, state.currentMonth, 1);
  const firstIndex = mondayIndex(first);
  const gridStart = new Date(state.currentYear, state.currentMonth, 1 - firstIndex);
  const last = new Date(state.currentYear, state.currentMonth + 1, 0);
  const totalCells = Math.ceil((firstIndex + last.getDate()) / 7) * 7;
  const weeks = Math.max(5, totalCells / 7);

  let html = '<div class="calendar-grid">';
  html += '<div class="calendar-heading week-heading">Week</div>';
  html += DAYS.map((day) => `<div class="calendar-heading">${day.slice(0, 3)}</div>`).join('');

  for (let row = 0; row < weeks; row += 1) {
    const monday = addDays(gridStart, row * 7);
    const weekInfo = isoWeek(monday);
    const wKey = `${weekInfo.year}-W${String(weekInfo.week).padStart(2, '0')}`;
    const weekly = state.checklists.get(`week:${wKey}`);
    // Two buttons cannot nest, so the week cell stops being a button and becomes
    // the box that holds them: the checklist on top, the vehicle matrix beneath.
    const weekLabel = formatWeekLabel(monday);
    html += `<div class="week-slot${weekly ? ' has-checklist' : ''}">
      <button class="week-open" type="button" data-scope="week" data-key="${wKey}" data-label="${escapeAttr(weekLabel)}">
        <span class="week-number">W${String(weekInfo.week).padStart(2, '0')}</span>
        <span class="week-range">${formatShortDate(monday)}–${formatShortDate(addDays(monday, 6))}</span>
        <span class="week-checklist-title">${escapeHtml(weekly?.title || '+ Weekly checklist')}</span>
      </button>
      ${renderWeekFleetButton(wKey, weekLabel)}
    </div>`;

    for (let column = 0; column < 7; column += 1) {
      const date = addDays(monday, column);
      const key = dateKey(date);
      const checklist = state.checklists.get(`day:${key}`);
      const outside = date.getMonth() !== state.currentMonth;
      const isToday = key === dateKey(today);
      const progress = checklistProgress(checklist);
      html += `<button class="day-cell${outside ? ' outside' : ''}${isToday ? ' today' : ''}${checklist ? ' has-checklist' : ''}" type="button" data-scope="day" data-key="${key}" data-label="${escapeAttr(formatLongDate(date))}">
        <span class="date-number">${date.getDate()}</span>
        ${checklist ? `<span class="day-checklist-card${progress.percent === 100 ? ' complete' : ''}">${escapeHtml(checklist.title)}<span class="progress">${progress.done}/${progress.total} checked</span></span>` : '<span class="add-mark">+</span>'}
      </button>`;
    }
  }
  html += '</div>';
  elements.monthView.innerHTML = html;
  elements.monthView.querySelectorAll('[data-scope]').forEach((button) => {
    button.addEventListener('click', () => openSlot(button.dataset.scope, button.dataset.key, button.dataset.label));
  });
  elements.monthView.querySelectorAll('[data-fleet-week]').forEach((button) => {
    button.addEventListener('click', () => openFleetWeek(button.dataset.fleetWeek, button.dataset.fleetLabel));
  });
}

/**
 * The Vehicles button (🔧) under each week's checklist title.
 *
 * The badge says the worst thing true of that week: urgent faults first, then
 * minor, then how much has not been looked at, and a tick only when every
 * checkpoint on every vehicle has been inspected and none is faulty. A week
 * nobody has opened gets no badge at all — an empty week and a clean week must
 * never look the same.
 */
function renderWeekFleetButton(weekKey, weekLabel) {
  const totals = state.fleetWeeks.get(weekKey)?.totals;
  let badge = '';
  if (totals && totals.inspected > 0) {
    if (totals.urgent > 0) badge = `<span class="fleet-badge state-urgent">${totals.urgent} urgent</span>`;
    else if (totals.minor > 0) badge = `<span class="fleet-badge state-minor">${totals.minor} minor</span>`;
    else if (totals.pending > 0) badge = `<span class="fleet-badge state-pending">${totals.pending} left</span>`;
    else badge = '<span class="fleet-badge state-ok">\u2713 all OK</span>';
  }
  return `<button class="week-fleet-button" type="button" data-fleet-week="${escapeAttr(weekKey)}" data-fleet-label="${escapeAttr(weekLabel)}" title="Weekly vehicle maintenance matrix for ${escapeAttr(weekLabel)}">
    <span>\u{1F527} Vehicles</span>${badge}
  </button>`;
}

function renderYearView() {
  let html = '<div class="year-grid">';
  for (let month = 0; month < 12; month += 1) {
    const mKey = monthKey(state.currentYear, month);
    const monthly = state.checklists.get(`month:${mKey}`);
    const first = new Date(state.currentYear, month, 1);
    const blankCount = mondayIndex(first);
    const days = new Date(state.currentYear, month + 1, 0).getDate();
    html += `<article class="year-card">
      <header class="year-card-header">
        <button type="button" class="year-month-button" data-go-month="${month}">${MONTHS[month]}</button>
        <button type="button" class="year-month-checklist${monthly ? ' has-checklist' : ''}" data-month-checklist="${month}">${monthly ? 'Checklist ready' : '+ Checklist'}</button>
      </header>
      <div class="mini-calendar">`;
    for (let blank = 0; blank < blankCount; blank += 1) html += '<span class="mini-day blank"></span>';
    for (let day = 1; day <= days; day += 1) {
      const date = new Date(state.currentYear, month, day);
      const key = dateKey(date);
      const has = state.checklists.has(`day:${key}`);
      html += `<button class="mini-day${has ? ' has-checklist' : ''}" type="button" data-mini-date="${key}" data-label="${escapeAttr(formatLongDate(date))}">${day}</button>`;
    }
    html += '</div></article>';
  }
  html += '</div>';
  elements.yearView.innerHTML = html;
  elements.yearView.querySelectorAll('[data-go-month]').forEach((button) => {
    button.addEventListener('click', () => { state.currentMonth = Number(button.dataset.goMonth); state.view = 'month'; render(); });
  });
  elements.yearView.querySelectorAll('[data-month-checklist]').forEach((button) => {
    const month = Number(button.dataset.monthChecklist);
    button.addEventListener('click', () => openSlot('month', monthKey(state.currentYear, month), formatMonth(state.currentYear, month)));
  });
  elements.yearView.querySelectorAll('[data-mini-date]').forEach((button) => {
    button.addEventListener('click', () => openSlot('day', button.dataset.miniDate, button.dataset.label));
  });
}

function navigate(direction) {
  if (state.view === 'year') {
    state.currentYear += direction;
  } else {
    const next = new Date(state.currentYear, state.currentMonth + direction, 1);
    state.currentYear = next.getFullYear();
    state.currentMonth = next.getMonth();
  }
  render();
}

async function openSlot(scope, key, label) {
  // A page left open overnight still holds yesterday's picture of the data. Ask
  // the server first: that read also runs the rollover, so clicking today both
  // pulls in what rolled over and stops this browser saving over it.
  await refreshFromServer();
  const id = `${scope}:${key}`;
  const existing = state.checklists.get(id);
  state.activePeriodLabel = label;
  state.activeIsNew = !existing;
  state.activeChecklist = existing ? sortOpenFirst(deepClone(existing)) : createTemplate(scope, key);
  elements.dialogPeriod.textContent = label;
  if (existing) showUseView();
  else showEditor(true);
  if (!elements.dialog.open) elements.dialog.showModal();
}

function showUseView() {
  elements.useActions.hidden = false;
  elements.editActions.hidden = true;
  elements.useView.hidden = false;
  elements.editor.hidden = true;
  elements.dialogModeLabel.textContent = `${scopeName(state.activeChecklist.scope)} checklist · use mode`;
  renderUseView();
}

function renderUseView() {
  const checklist = state.activeChecklist;
  const [leftSections, rightSections] = balanceSections(checklist.sections || []);
  elements.useView.innerHTML = `
    <article class="checklist-paper" id="activeChecklistPaper">
      <span class="classification top">RESTRICTED</span>
      <span class="classification bottom">RESTRICTED</span>
      <span class="paper-page">1</span>
      <header class="checklist-header">
        <h2>${escapeHtml(checklist.title.toUpperCase())}</h2>
        <div class="revision">REVISED ${escapeHtml(checklist.revision)}</div>
        <div class="mode">CHECKLIST TYPE: ${escapeHtml(checklist.mode)}</div>
        <div class="primary-role">${escapeHtml(checklist.primaryRole)}</div>
        <div class="secondary-role">${escapeHtml(checklist.secondaryRole)}</div>
        <div class="period-stamp">${escapeHtml(state.activePeriodLabel)}</div>
      </header>
      <div class="checklist-columns">
        <div>${leftSections.map(renderSection).join('')}</div>
        <div>${rightSections.map(renderSection).join('')}</div>
      </div>
      <section class="comments-zone">
        <h3>Comments and handover notes</h3>
        ${(checklist.sections || []).map((section) => `<div class="comment-field">
          <label for="comment-${escapeAttr(section.id)}">${escapeHtml(section.title)}</label>
          <textarea id="comment-${escapeAttr(section.id)}" data-comment-section="${escapeAttr(section.id)}" placeholder="Comments for ${escapeAttr(section.title)}…">${escapeHtml(checklist.comments?.[section.id] || '')}</textarea>
        </div>`).join('')}
        <div id="saveIndicator" class="save-indicator">Saved</div>
      </section>
    </article>`;

  elements.useView.querySelectorAll('[data-item-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const item = findItem(state.activeChecklist, button.dataset.itemId);
      if (!item) return;
      item.done = !item.done;
      await persistActive('Progress saved');
      renderUseView();
      render();
    });
  });
  elements.useView.querySelectorAll('[data-comment-section]').forEach((textarea) => {
    textarea.addEventListener('input', () => {
      state.activeChecklist.comments ||= {};
      state.activeChecklist.comments[textarea.dataset.commentSection] = textarea.value;
      const indicator = document.querySelector('#saveIndicator');
      if (indicator) indicator.textContent = 'Saving…';
      clearTimeout(state.commentTimer);
      state.commentTimer = setTimeout(async () => {
        await persistActive();
        const currentIndicator = document.querySelector('#saveIndicator');
        if (currentIndicator) currentIndicator.textContent = 'Saved';
      }, 450);
    });
  });
}

function renderSection(section) {
  return `<section class="check-section">
    <h3>${escapeHtml(section.title)}</h3>
    <ol>${(section.items || []).map((item) => `<li class="${item.done ? 'done' : ''}${isCarried(item) ? ' carried' : ''}">
      <div class="item-line">
        <span class="item-text ${item.role === 'primary' ? 'primary' : ''}">${escapeHtml(item.action)}—<span class="expected-state">${escapeHtml(item.state)}</span></span>
        <button class="tickbox" type="button" data-item-id="${escapeAttr(item.id)}" aria-label="Mark ${escapeAttr(item.action)} complete" aria-pressed="${item.done ? 'true' : 'false'}"></button>
      </div>
      ${carryTag(item)}
    </li>`).join('')}</ol>
  </section>`;
}

/**
 * Unfinished items to the top, ticked ones to the bottom, original order kept
 * inside each group. Applied once when a day is opened, never while it is on
 * screen: ticking an item must not make the rest of the list jump.
 */
function sortOpenFirst(checklist) {
  for (const section of checklist.sections || []) {
    section.items = [...(section.items || [])].sort((a, b) => Number(Boolean(a.done)) - Number(Boolean(b.done)));
  }
  return checklist;
}

function isCarried(item) {
  return Boolean(item && item.carriedFrom && Number(item.carryCount) > 0);
}

function carryLabel(item) {
  const count = Number(item.carryCount) || 1;
  return `carried from ${formatDayKey(item.carriedFrom)}${count > 1 ? ` \u00d7${count}` : ''}`;
}

function carryTag(item) {
  if (!isCarried(item)) return '';
  const count = Number(item.carryCount) || 1;
  const stale = count >= 3 ? ' stale' : '';
  return `<span class="carry-tag${stale}" title="This item was still open on ${escapeAttr(formatDayKey(item.carriedFrom))} and has rolled forward ${count} working day${count === 1 ? '' : 's'}.">\u21b7 ${escapeHtml(carryLabel(item))}</span>`;
}

function showEditor(isNew) {
  state.activeIsNew = isNew || state.activeIsNew;
  elements.useActions.hidden = true;
  elements.editActions.hidden = false;
  elements.useView.hidden = true;
  elements.editor.hidden = false;
  elements.deleteButton.hidden = state.activeIsNew;
  elements.dialogModeLabel.textContent = `${scopeName(state.activeChecklist.scope)} checklist · ${state.activeIsNew ? 'creator' : 'edit mode'}`;
  renderEditor();
}

function renderEditor() {
  const checklist = state.activeChecklist;
  elements.editor.innerHTML = `
    <div class="editor-sheet">
      <div class="editor-intro">
        <div>
          <h2>${state.activeIsNew ? 'CREATE CHECKLIST' : 'EDIT CHECKLIST'}</h2>
          <p>This ${scopeName(checklist.scope).toLowerCase()} form uses clear pause points, brief action/state wording and role ownership. Aim for five to nine critical items per section.</p>
        </div>
        <span class="scope-chip">${scopeName(checklist.scope)}</span>
      </div>
      <div class="form-grid">
        <label class="field"><span>Checklist title</span><input id="editorTitle" maxlength="180" value="${escapeAttr(checklist.title)}"></label>
        <label class="field"><span>Revision date</span><input id="editorRevision" type="date" value="${escapeAttr(checklist.revision)}"></label>
      </div>
      <div class="form-grid three">
        <label class="field"><span>Checklist type</span><select id="editorMode"><option ${checklist.mode === 'DO-CONFIRM' ? 'selected' : ''}>DO-CONFIRM</option><option ${checklist.mode === 'READ-DO' ? 'selected' : ''}>READ-DO</option></select></label>
        <label class="field"><span>Primary role in red</span><input id="editorPrimaryRole" maxlength="120" value="${escapeAttr(checklist.primaryRole)}"></label>
        <label class="field"><span>Secondary role in black</span><input id="editorSecondaryRole" maxlength="120" value="${escapeAttr(checklist.secondaryRole)}"></label>
      </div>
      <div class="field-label">Pause points / categories</div>
      <div id="editorSections" class="editor-sections">
        ${(checklist.sections || []).map((section, sectionIndex) => renderEditorSection(section, sectionIndex)).join('')}
      </div>
      <div class="editor-footer">
        <button id="addSectionButton" class="button button-quiet" type="button">+ Add category</button>
        <div class="editor-guidance">Each line appears as <strong>ACTION—EXPECTED STATE</strong>, with its tick box at the far right.</div>
      </div>
    </div>`;
  bindEditorDynamicEvents();
}

function renderEditorSection(section, sectionIndex) {
  return `<section class="editor-section" data-section-id="${escapeAttr(section.id)}">
    <header class="editor-section-header">
      <input class="section-title-input" aria-label="Category title" maxlength="100" value="${escapeAttr(section.title)}">
      <div class="row-actions">
        <button class="small-button move-section-up" type="button" title="Move category up" ${sectionIndex === 0 ? 'disabled' : ''}>↑</button>
        <button class="small-button move-section-down" type="button" title="Move category down" ${sectionIndex === state.activeChecklist.sections.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="small-button remove-section" type="button" title="Remove category">×</button>
      </div>
    </header>
    <div class="editor-items">
      ${(section.items || []).map((item) => `<div class="item-row${isCarried(item) ? ' carried' : ''}" data-item-id="${escapeAttr(item.id)}"${isCarried(item) ? ` title="${escapeAttr(carryLabel(item))}"` : ''}>
        <input class="item-action" aria-label="Action" maxlength="220" placeholder="Action" value="${escapeAttr(item.action)}">
        <input class="item-state" aria-label="Expected state" maxlength="90" placeholder="Expected state" value="${escapeAttr(item.state)}">
        <select class="item-role" aria-label="Responsible role"><option value="primary" ${item.role === 'primary' ? 'selected' : ''}>Red role</option><option value="secondary" ${item.role === 'secondary' ? 'selected' : ''}>Black role</option></select>
        <button class="small-button remove-item" type="button" title="Remove item">×</button>
      </div>`).join('')}
    </div>
    <button class="button button-quiet add-item-button" type="button">+ Add item</button>
  </section>`;
}

function bindEditorDynamicEvents() {
  elements.editor.querySelector('#addSectionButton').addEventListener('click', () => {
    syncEditorIntoActive();
    state.activeChecklist.sections.push({ id: uid('section'), title: 'New Category', items: [{ id: uid('item'), action: '', state: 'COMPLETE', role: 'primary', done: false }] });
    renderEditor();
  });
  elements.editor.querySelectorAll('.add-item-button').forEach((button) => button.addEventListener('click', () => {
    syncEditorIntoActive();
    const sectionId = button.closest('[data-section-id]').dataset.sectionId;
    const section = state.activeChecklist.sections.find((entry) => entry.id === sectionId);
    section.items.push({ id: uid('item'), action: '', state: 'COMPLETE', role: 'primary', done: false });
    renderEditor();
  }));
  elements.editor.querySelectorAll('.remove-item').forEach((button) => button.addEventListener('click', () => {
    syncEditorIntoActive();
    const sectionId = button.closest('[data-section-id]').dataset.sectionId;
    const itemId = button.closest('[data-item-id]').dataset.itemId;
    const section = state.activeChecklist.sections.find((entry) => entry.id === sectionId);
    section.items = section.items.filter((item) => item.id !== itemId);
    if (!section.items.length) section.items.push({ id: uid('item'), action: '', state: 'COMPLETE', role: 'primary', done: false });
    renderEditor();
  }));
  elements.editor.querySelectorAll('.remove-section').forEach((button) => button.addEventListener('click', () => {
    syncEditorIntoActive();
    if (state.activeChecklist.sections.length <= 1) return showToast('A checklist needs at least one category.');
    const sectionId = button.closest('[data-section-id]').dataset.sectionId;
    state.activeChecklist.sections = state.activeChecklist.sections.filter((section) => section.id !== sectionId);
    renderEditor();
  }));
  elements.editor.querySelectorAll('.move-section-up, .move-section-down').forEach((button) => button.addEventListener('click', () => {
    syncEditorIntoActive();
    const sectionId = button.closest('[data-section-id]').dataset.sectionId;
    const index = state.activeChecklist.sections.findIndex((section) => section.id === sectionId);
    const target = button.classList.contains('move-section-up') ? index - 1 : index + 1;
    if (target < 0 || target >= state.activeChecklist.sections.length) return;
    [state.activeChecklist.sections[index], state.activeChecklist.sections[target]] = [state.activeChecklist.sections[target], state.activeChecklist.sections[index]];
    renderEditor();
  }));
}

function syncEditorIntoActive() {
  if (elements.editor.hidden || !elements.editor.querySelector('#editorTitle')) return;
  const checklist = state.activeChecklist;
  checklist.title = elements.editor.querySelector('#editorTitle').value.trim();
  checklist.revision = elements.editor.querySelector('#editorRevision').value;
  checklist.mode = elements.editor.querySelector('#editorMode').value;
  checklist.primaryRole = elements.editor.querySelector('#editorPrimaryRole').value.trim();
  checklist.secondaryRole = elements.editor.querySelector('#editorSecondaryRole').value.trim();
  checklist.sections = [...elements.editor.querySelectorAll('[data-section-id]')].map((sectionNode) => {
    const oldSection = checklist.sections.find((section) => section.id === sectionNode.dataset.sectionId);
    return {
      id: sectionNode.dataset.sectionId,
      title: sectionNode.querySelector('.section-title-input').value.trim(),
      items: [...sectionNode.querySelectorAll('[data-item-id]')].map((itemNode) => {
        const oldItem = oldSection?.items.find((item) => item.id === itemNode.dataset.itemId);
        const synced = {
          id: itemNode.dataset.itemId,
          action: itemNode.querySelector('.item-action').value.trim(),
          state: itemNode.querySelector('.item-state').value.trim().toUpperCase(),
          role: itemNode.querySelector('.item-role').value,
          done: oldItem?.done || false
        };
        // The carry-forward chain lives on these fields; editing must keep them.
        if (oldItem?.originId) synced.originId = oldItem.originId;
        if (oldItem?.carriedFrom) synced.carriedFrom = oldItem.carriedFrom;
        if (oldItem?.carriedOn) synced.carriedOn = oldItem.carriedOn;
        if (oldItem?.carryCount) synced.carryCount = oldItem.carryCount;
        if (oldItem?.forwardedTo) synced.forwardedTo = oldItem.forwardedTo;
        return synced;
      })
    };
  });
}

async function saveEditor(event) {
  event?.preventDefault();
  syncEditorIntoActive();
  const checklist = state.activeChecklist;
  checklist.title ||= defaultTitle(checklist.scope);
  checklist.revision ||= new Date().toISOString().slice(0, 10);
  checklist.primaryRole ||= "SUBSTITUTE'S DUTIES IN RED";
  checklist.secondaryRole ||= 'SUPPORT DUTIES IN BLACK';
  checklist.sections = checklist.sections
    .map((section) => ({ ...section, title: section.title || 'Untitled Category', items: section.items.filter((item) => item.action) }))
    .filter((section) => section.items.length);
  if (!checklist.sections.length) return showToast('Add at least one checklist item before saving.');
  checklist.updatedAt = new Date().toISOString();
  checklist.createdAt ||= checklist.updatedAt;
  checklist.comments ||= {};
  await saveChecklist(checklist);
  state.activeIsNew = false;
  showUseView();
  render();
  showToast('Checklist saved.');
}

function cancelEditor() {
  if (state.activeIsNew) return closeDialog();
  state.activeChecklist = deepClone(state.checklists.get(state.activeChecklist.id));
  showUseView();
}

async function deleteActiveChecklist() {
  const checklist = state.activeChecklist;
  if (!checklist || !confirm(`Delete “${checklist.title}”? This cannot be undone.`)) return;
  try {
    if (state.persistence === 'server') {
      const response = await fetch(`/api/checklists/${encodeURIComponent(checklist.id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Delete failed');
    }
    state.checklists.delete(checklist.id);
    writeLocalMirror();
    closeDialog();
    render();
    showToast('Checklist deleted.');
  } catch {
    showToast('Could not delete the checklist.');
  }
}

async function persistActive(message = '') {
  state.activeChecklist.updatedAt = new Date().toISOString();
  await saveChecklist(state.activeChecklist);
  if (message) showToast(message);
}

async function saveChecklist(checklist) {
  const normalized = normalizeChecklist(checklist);
  state.checklists.set(normalized.id, deepClone(normalized));
  state.activeChecklist = deepClone(normalized);
  writeLocalMirror();
  if (state.persistence === 'server') {
    try {
      const response = await fetch('/api/checklists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalized)
      });
      if (!response.ok) throw new Error('Save failed');
    } catch {
      state.persistence = 'local';
      elements.storageStatus.textContent = 'Local browser storage';
      elements.storageStatus.classList.add('local');
      showToast('Server unavailable; saved in this browser.');
    }
  }
}

function writeLocalMirror() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.checklists.values()]));
}

function closeDialog() {
  clearTimeout(state.commentTimer);
  if (elements.dialog.open) elements.dialog.close();
  state.activeChecklist = null;
  state.activeIsNew = false;
}

function createTemplate(scope, key) {
  const headings = {
    day: ['Before Starting', 'Main Duties', 'Handover', 'Before Leaving'],
    week: ['Week Opening', 'Weekly Priorities', 'Midweek Review', 'Week Close'],
    month: ['Month Opening', 'Scheduled Controls', 'Mid-Month Review', 'Month Close']
  }[scope];
  return {
    id: `${scope}:${key}`,
    scope,
    key,
    title: defaultTitle(scope),
    revision: new Date().toISOString().slice(0, 10),
    mode: 'DO-CONFIRM',
    primaryRole: "SUBSTITUTE'S DUTIES IN RED",
    secondaryRole: 'SUPPORT DUTIES IN BLACK',
    sections: headings.map((title, sectionIndex) => ({
      id: uid(`section${sectionIndex}`),
      title,
      items: [{ id: uid('item'), action: '', state: 'COMPLETE', role: sectionIndex % 2 ? 'secondary' : 'primary', done: false }]
    })),
    comments: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizeChecklist(checklist) {
  const normalized = deepClone(checklist);
  normalized.comments ||= {};
  normalized.sections ||= [];
  for (const section of normalized.sections) {
    section.id ||= uid('section');
    section.items ||= [];
    for (const item of section.items) {
      item.id ||= uid('item');
      item.originId ||= item.id;
      item.role = item.role === 'secondary' ? 'secondary' : 'primary';
      item.done = Boolean(item.done);
      if (item.carriedFrom) item.carryCount = Number(item.carryCount) || 1;
      else delete item.carryCount;
    }
  }
  return normalized;
}

function balanceSections(sections) {
  const columns = [[], []];
  const weights = [0, 0];
  for (const section of sections) {
    const weight = 2 + (section.items?.length || 0);
    const index = weights[0] <= weights[1] ? 0 : 1;
    columns[index].push(section);
    weights[index] += weight;
  }
  return columns;
}

function findItem(checklist, itemId) {
  for (const section of checklist.sections || []) {
    const found = section.items.find((item) => item.id === itemId);
    if (found) return found;
  }
  return null;
}

function checklistProgress(checklist) {
  if (!checklist) return { done: 0, total: 0, percent: 0 };
  const items = checklist.sections.flatMap((section) => section.items || []);
  const done = items.filter((item) => item.done).length;
  return { done, total: items.length, percent: items.length ? Math.round(done / items.length * 100) : 0 };
}

function downloadActivePdf() {
  if (!state.activeChecklist) return;
  const bytes = createChecklistPdf(state.activeChecklist, state.activePeriodLabel);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeFilename(state.activeChecklist.title)}-${state.activeChecklist.key}.pdf`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function printActiveChecklist() {
  if (!state.activeChecklist) return;
  const printWindow = window.open('', '_blank');
  if (!printWindow) return showToast('Allow pop-ups to print the checklist.');
  printWindow.opener = null;
  printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(state.activeChecklist.title)}</title><style>${printStyles()}</style></head><body>${printMarkup()}</body></html>`);
  printWindow.document.close();
  printWindow.addEventListener('load', () => { printWindow.focus(); printWindow.print(); });
}

function printMarkup() {
  const checklist = state.activeChecklist;
  const [left, right] = balanceSections(checklist.sections);
  return `<article class="paper"><span class="top">RESTRICTED</span><span class="bottom">RESTRICTED</span>
  <header><h1>${escapeHtml(checklist.title.toUpperCase())}</h1><b>REVISED ${escapeHtml(checklist.revision)}</b><p>CHECKLIST TYPE: ${escapeHtml(checklist.mode)}</p><p class="red">${escapeHtml(checklist.primaryRole)}</p><p>${escapeHtml(checklist.secondaryRole)}</p><small>${escapeHtml(state.activePeriodLabel)}</small></header>
  <div class="columns"><div>${left.map(printSection).join('')}</div><div>${right.map(printSection).join('')}</div></div>
  <section class="comments"><h2>COMMENTS AND HANDOVER NOTES</h2>${checklist.sections.map((section) => `<div class="comment"><b>${escapeHtml(section.title.toUpperCase())}</b><p>${escapeHtml(checklist.comments?.[section.id] || '').replace(/\n/g, '<br>') || '&nbsp;'}</p></div>`).join('')}</section></article>`;
}

function printSection(section) {
  return `<section><h2>${escapeHtml(section.title)}</h2><ol>${section.items.map((item) => `<li class="${item.role === 'primary' ? 'red' : ''}${item.done ? ' done' : ''}"><span>${escapeHtml(item.action)}—${escapeHtml(item.state)}${isCarried(item) ? ` <em>(${escapeHtml(carryLabel(item))})</em>` : ''}</span><i>${item.done ? '✓' : ''}</i></li>`).join('')}</ol></section>`;
}

function printStyles() {
  return `@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#191919}.paper{position:relative;border:4px double #191919;padding:18mm 13mm 14mm;min-height:270mm}.top,.bottom{position:absolute;font-size:7pt;letter-spacing:.32em}.top{right:5mm;top:3mm}.bottom{left:5mm;bottom:3mm}header{text-align:center;margin-bottom:10mm}h1{font-size:15pt;letter-spacing:.18em;margin:0 0 3mm}header b{font-size:7.5pt;letter-spacing:.08em}header p{font-size:8pt;margin:3mm 0 0}header p+p{margin-top:1mm}header small{display:inline-block;margin-top:4mm;border-top:1px solid #aaa;padding-top:2mm;font-size:7pt;letter-spacing:.1em;text-transform:uppercase}.columns{display:grid;grid-template-columns:1fr 1fr;gap:10mm}.columns section{break-inside:avoid;margin-bottom:4mm}h2{font-size:9pt;letter-spacing:.14em;margin:0 0 1.5mm;text-transform:uppercase}ol{margin:0;padding-left:6mm}li{font-size:8pt;line-height:1.35;padding:.4mm 0;display:list-item}li span{display:inline-block;width:calc(100% - 6mm)}li em{font-style:normal;font-size:7pt;letter-spacing:.04em;opacity:.65}li i{float:right;width:3.2mm;height:3.2mm;border:.45mm solid #191919;font-style:normal;text-align:center;line-height:2.4mm;color:#871414}.red{color:#871414}.done span{text-decoration:line-through;opacity:.6}.comments{border-top:.6mm solid #191919;margin-top:7mm;padding-top:4mm;break-before:auto}.comment{break-inside:avoid;margin-bottom:4mm}.comment>b{font-size:7.5pt;letter-spacing:.1em}.comment p{border:.3mm solid #191919;min-height:16mm;margin:1.5mm 0 0;padding:2mm;font-size:8pt;line-height:1.35}@media(max-width:700px){.columns{grid-template-columns:1fr}}`;
}

function exportBackup() {
  const content = JSON.stringify({ exportedAt: new Date().toISOString(), checklists: [...state.checklists.values()] }, null, 2);
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `checklist-calendar-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const imported = Array.isArray(parsed) ? parsed : parsed.checklists;
    if (!Array.isArray(imported)) throw new Error('No checklist array');
    for (const raw of imported) {
      const checklist = normalizeChecklist(raw);
      if (!checklist.id || !checklist.scope || !checklist.key) continue;
      await saveChecklist(checklist);
    }
    render();
    showToast(`${imported.length} checklist records imported.`);
  } catch {
    showToast('That backup file could not be imported.');
  }
}

function formatMonth(year, month) { return `${MONTHS[month]} ${year}`; }
function formatLongDate(date) { return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date); }
function formatDayKey(key) { const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || '')); return parsed ? formatShortDate(new Date(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3]))) : String(key || ''); }
function formatShortDate(date) { return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date); }
function formatWeekLabel(monday) { return `Week ${isoWeek(monday).week}, ${formatShortDate(monday)}–${formatShortDate(addDays(monday, 6))} ${addDays(monday, 6).getFullYear()}`; }
function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function monthKey(year, month) { return `${year}-${String(month + 1).padStart(2, '0')}`; }
function mondayIndex(date) { return (date.getDay() + 6) % 7; }
function addDays(date, days) { const result = new Date(date); result.setDate(result.getDate() + days); return result; }
// The daily checklist was renamed 2026-09-16 (was "Approved Daily Substitute
// Checklist"); weekly and monthly keep their old names.
function defaultTitle(scope) {
  return scope === 'day' ? 'Fleet/Machine/Home Checklist' : `Approved ${scopeName(scope)} Substitute Checklist`;
}

function scopeName(scope) { return ({ day: 'Daily', week: 'Weekly', month: 'Monthly' })[scope] || scope; }
function isoWeek(date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return { year: target.getUTCFullYear(), week: Math.ceil((((target - yearStart) / 86400000) + 1) / 7) };
}
function uid(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function deepClone(value) { return JSON.parse(JSON.stringify(value)); }
function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
function safeFilename(value) { return value.toLowerCase().replace(/[^a-z0-9åäö]+/gi, '-').replace(/^-|-$/g, '') || 'checklist'; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]); }
function escapeAttr(value) { return escapeHtml(value).replace(/'/g, '&#39;'); }
function showToast(message) { elements.toast.textContent = message; elements.toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => elements.toast.classList.remove('show'), 2200); }
