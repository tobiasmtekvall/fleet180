'use strict';

const { page, esc, fmtDateTime } = require('./layout');
const { KINDS, KIND_LABEL, ROLES, SOURCES, CHOICES, CHOICE_LABEL_EN, formatAnswer } = require('../fields');
const i18n = require('../i18n');
const { OWNER_LABEL, FLEET_LABEL } = require('./index');
const telltales = require('../telltales');

const LINKS = [
  { href: '/', text: 'Vehicles' },
  { href: '/qr', text: 'QR codes' },
  { href: '/admin', text: 'Admin' }
];

const TABS = [
  { href: '/admin', text: 'Checks', key: 'checks' },
  { href: '/admin/vehicles', text: 'Vehicles', key: 'vehicles' },
  { href: '/admin/forms', text: 'Forms', key: 'forms' },
  { href: '/admin/drivers', text: 'Drivers', key: 'drivers' },
  { href: '/admin/incidents', text: 'Incidents', key: 'incidents' },
  // The ledger, the SM check and the CSV, split off Incidents 2026-09-15.
  { href: '/admin/expenses', text: 'Expenses', key: 'expenses' },
  { href: '/admin/stats', text: 'Statistics', key: 'stats' },
  { href: '/admin/daily-summary', text: 'Daily email', key: 'mail' },
  // Not an /admin page -- it is the Checklist Calendar, mounted whole at
  // /kalender behind a login of its OWN (superuser). It sits in this row
  // because that is where he will look for it, and it says so on hover: a
  // tab that asks for a password the admin has not got should warn first.
  { href: '/kalender', text: 'Calendar', key: 'calendar',
    title: 'The calendar has its own login (superuser)' }
];

function nav(active) {
  return `<div class="admin-nav no-print">${TABS.map(t =>
    `<a href="${t.href}"${t.key === active ? ' class="on"' : ''}${
      t.title ? ` title="${esc(t.title)}"` : ''}>${esc(t.text)}</a>`).join('')}</div>`;
}

function flash(message) {
  return message ? `<div class="ok-msg no-print">${esc(message)}</div>` : '';
}

function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? '?' + s : '';
}

function select(name, options, current, extraClass = '') {
  return `<select class="form-control ${extraClass}" name="${esc(name)}">${
    options.map(o => `<option value="${esc(o.value)}"${
      String(o.value) === String(current ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('')
  }</select>`;
}

/* ------------------------------------------------------------------ *
 * Submissions                                                         *
 * ------------------------------------------------------------------ */

function adminListPage({ rows, total, filters, limit, offset, vehicles }) {
  const options = ['<option value="">All vehicles</option>'].concat(
    vehicles.map(v =>
      `<option value="${esc(v.plate)}"${filters.plate === v.plate ? ' selected' : ''}>${esc(v.plate)}</option>`)
  ).join('');

  const body = rows.length ? rows.map(r => `<tr>
      <td class="mono">${esc(fmtDateTime(r.submitted_at))}</td>
      <td class="mono" style="font-weight:700"><a href="/admin?plate=${esc(r.plate)}"
          title="Only ${esc(r.plate)}">${esc(r.plate)}</a></td>
      <td>${esc(r.driver_name || '—')}</td>
      <td>${esc(r.route || '—')}</td>
      <td class="mono">${esc(r.odometer || '—')}</td>
      <td>${r.photo_count ? esc(r.photo_count) + ' 📷' : '<span class="muted">—</span>'}</td>
      <td><a href="/admin/s/${esc(r.id)}">View</a></td>
    </tr>`).join('\n')
    : `<tr><td colspan="7" class="muted" style="padding:20px">No checks match the filter.</td></tr>`;

  // Ten at a time, newest first, with the window spelled out -- "11-20 of
  // 63" tells you where you are in a way that two bare arrows do not.
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + limit, total);
  const prev = offset > 0
    ? `<a class="btn btn-ghost" href="/admin${qs({ ...filters, offset: Math.max(0, offset - limit) })}">← Newer</a>`
    : '<span class="btn btn-ghost" style="opacity:.4;cursor:default">← Newer</span>';
  const next = offset + limit < total
    ? `<a class="btn btn-ghost" href="/admin${qs({ ...filters, offset: offset + limit })}">Older →</a>`
    : '<span class="btn btn-ghost" style="opacity:.4;cursor:default">Older →</span>';
  const where = `<span class="muted">${total ? `${from}–${to} of ${total}` : 'no matches'}${
    filters.plate ? ' for ' + esc(filters.plate) : ''}</span>`;

  const html = `  <div class="page-head">
    <h1>Administration</h1>
    <div class="muted">${esc(total)} ${total === 1 ? 'check' : 'checks'}</div>
  </div>
${nav('checks')}

  <form class="filters no-print" method="get" action="/admin">
    <div class="f"><label for="plate">Vehicle</label>
      <select class="form-control" id="plate" name="plate">${options}</select></div>
    <div class="f"><label for="from">From</label>
      <input class="form-control" type="date" id="from" name="from" value="${esc(filters.from || '')}"></div>
    <div class="f"><label for="to">To</label>
      <input class="form-control" type="date" id="to" name="to" value="${esc(filters.to || '')}"></div>
    <button class="btn btn-primary" type="submit">Filter</button>
    <a class="btn btn-ghost" href="/admin">Clear</a>
    <a class="btn btn-secondary" href="/admin/export.csv${qs(filters)}">Download CSV</a>
  </form>

  <div class="card">
    <table class="table">
      <thead><tr>
        <th>Time</th><th>Reg. no.</th><th>Driver</th><th>Route</th><th>Odometer</th><th>Photos</th><th></th>
      </tr></thead>
      <tbody>
${body}
      </tbody>
    </table>
  </div>

  <div class="actions" style="justify-content:space-between;align-items:center">
    ${prev}${where}${next}
  </div>`;

  return page({ title: 'Administration – safety checks', body: html, links: LINKS, lang: 'en', admin: true });
}

/**
 * A question as the admin reads it: the English translation when the form has
 * one, with the Swedish the driver actually saw on hover. The questions are
 * form content, edited in Swedish, so a question without a translation is
 * shown as written rather than left blank.
 */
function qLabel(q) {
  const en = q.i18n && q.i18n.en && String(q.i18n.en.label || '').trim();
  return en ? `<span title="${esc(q.label)}">${esc(en)}</span>` : esc(q.label);
}

function adminDetailPage({ s, fallbackFields }) {
  const questions = s.questions && s.questions.length ? s.questions : (fallbackFields || []);
  const answers = s.answers || {};

  const rows = questions.map(q => {
    if (q.kind === 'photo') {
      const pics = (s.photos || []).filter(p => p.field === q.name);
      const grid = pics.length
        ? `<div class="photo-grid">${pics.map(p =>
            `<a href="/admin/photo/${esc(p.id)}" target="_blank" rel="noopener">
               <img src="/admin/photo/${esc(p.id)}" alt="${esc(p.filename || 'photo')}"></a>`).join('')}</div>`
        : '<span class="muted">—</span>';
      return `<tr><td>${qLabel(q)}</td><td>${grid}</td></tr>`;
    }
    if (q.kind === 'info') return `<tr><td colspan="2" class="muted">${qLabel(q)}</td></tr>`;
    return `<tr><td>${qLabel(q)}</td><td>${esc(formatAnswer(q, answers[q.name], 'en'))}</td></tr>`;
  }).join('\n');

  /* Who the van was given to that day, and -- when the check was signed by
     somebody else -- who allowed the change. Read off the check itself, not
     looked up: the assignment it was measured against may have been replaced
     by a later run of the assigner. */
  const assignedBlock = (s.assigned_driver || s.driver_changed) ? `
  <div class="card${s.driver_changed ? ' card-warn' : ''}">
    <div class="card-header">Assignment${s.driver_changed ? '<span class="step-tag">Driver was changed</span>' : ''}</div>
    <div class="card-body"><table class="kv">
      <tr><td>Assigned driver</td><td>${esc(s.assigned_driver || '—')}</td></tr>
      <tr><td>Assigned route</td><td>${esc(s.assigned_route || '—')}</td></tr>
      ${s.driver_changed ? `<tr><td>Check done by</td><td>${esc(s.driver_name || '—')}</td></tr>
      <tr><td>Approved by (OC / Fleet Manager)</td><td>${esc(s.change_approver || '—')}</td></tr>` : ''}
    </table></div>
  </div>
` : '';

  const html = `  <div class="page-head">
    <h1>Check #${esc(s.id)}</h1>
    <div class="plate">${esc(s.plate)}</div>
  </div>
  <p class="lede">${esc(fmtDateTime(s.submitted_at))} · driver ${esc(s.driver_name || '—')} ·
     route ${esc(s.route || '—')} · odometer ${esc(s.odometer || '—')}${
       s.driver_changed ? ' · <strong>vehicle change approved by ' + esc(s.change_approver || '—') + '</strong>' : ''}</p>
${assignedBlock}
  <div class="card">
    <div class="card-header">Answers<span class="step-tag">${esc(s.form_title || s.form_key)}</span></div>
    <div class="card-body"><table class="kv">
${rows}
    </table></div>
  </div>

  <div class="card no-print">
    <div class="card-header">Technical information</div>
    <div class="card-body"><table class="kv">
      <tr><td>Device</td><td style="font-weight:400" class="muted">${esc(s.user_agent || '—')}</td></tr>
      <tr><td>IP</td><td style="font-weight:400" class="muted">${esc(s.client_ip || '—')}</td></tr>
    </table></div>
  </div>

  <div class="actions no-print" style="justify-content:space-between">
    <a class="btn btn-danger" href="/admin/s/${esc(s.id)}/delete">Delete this check</a>
    <span>
      <button class="btn btn-secondary" type="button" onclick="window.print()">Print / PDF</button>
      <a class="btn btn-primary" href="/admin?plate=${esc(s.plate)}">Back to ${esc(s.plate)}</a>
    </span>
  </div>`;

  return page({ title: `Check ${s.id} – ${s.plate}`, body: html, links: LINKS, lang: 'en', admin: true });
}

/* ------------------------------------------------------------------ *
 * Vehicles                                                            *
 * ------------------------------------------------------------------ */

const OWNER_OPTIONS = [
  { value: '', label: '— (not set)' },
  { value: 'own', label: OWNER_LABEL.own },
  { value: 'okq8', label: OWNER_LABEL.okq8 }
];
const FLEET_OPTIONS = Object.entries(FLEET_LABEL).map(([value, label]) => ({ value, label }));

function adminVehiclesPage({ vehicles, forms, message, counts }) {
  const formOptions = [{ value: '', label: 'Default form' }]
    .concat(forms.filter(f => !f.is_default).map(f => ({ value: String(f.id), label: f.title })));

  /* Which van it is. This decides the list of warning lights a driver is
     offered when they report a lamp, so it is set here rather than in the
     form: one form, many models. */
  const modelOptions = [{ value: '', label: 'Model – not set' }].concat(
    telltales.MODEL_KEYS.filter(k => k !== 'generic').map(k => ({
      value: k,
      label: `${telltales.MODELS[k].brand} ${telltales.MODELS[k].name}`.trim()
    })));

  const rows = vehicles.map(v => `<tr>
      <td colspan="7" style="padding:0">
        <form class="row-form" method="post" action="/admin/vehicles/${esc(v.id)}" style="padding:9px 10px;border:0">
          <input class="form-control mono" type="text" name="plate" value="${esc(v.plate)}"
                 style="font-weight:700;width:110px" maxlength="16" required>
          ${select('owner', OWNER_OPTIONS, v.owner)}
          ${select('fleet', FLEET_OPTIONS, v.fleet)}
          ${select('modelKey', modelOptions, v.model_key || '')}
          ${select('formId', formOptions, v.form_id ? String(v.form_id) : '', 'grow')}
          <label class="check"><input type="checkbox" name="active" value="1"${v.active ? ' checked' : ''}> Active</label>
          <span class="muted" style="font-size:13px">${esc(counts.get(v.plate) || 0)} checks</span>
          <button class="btn btn-primary btn-sm" type="submit">Save</button>
          <a class="btn btn-ghost btn-sm" href="/qr/${esc(v.plate)}.png" target="_blank" rel="noopener">QR</a>
          <button class="btn btn-danger btn-sm" type="submit" formaction="/admin/vehicles/${esc(v.id)}/delete">Delete</button>
        </form>
      </td>
    </tr>`).join('\n');

  const html = `  <div class="page-head">
    <h1>Vehicles</h1>
    <div class="muted">${vehicles.length} in total</div>
  </div>
${nav('vehicles')}
${flash(message)}

  <p class="lede">A vehicle added here immediately gets its own page and its own QR code
     on the <a href="/qr">QR page</a>. A vehicle no longer in use is unticked as
     <em>Active</em> – it then disappears from the lists and the QR sheet, but its old checks
     are kept. <em>Delete</em> only works on vehicles with no recorded checks.</p>

  <p class="lede"><strong>The model decides the warning lights.</strong> When a driver answers Yes
     to the dashboard-lights question, they get a list of this particular van's lamps and symbols.
     A vehicle with no model gets a shared list of the lamps every van has.</p>

  <div class="card">
    <div class="card-header">New vehicle</div>
    <div class="card-body">
      <form class="row-form" method="post" action="/admin/vehicles">
        <input class="form-control mono" type="text" name="plate" placeholder="REG. NO."
               style="font-weight:700;width:130px" maxlength="16" required>
        ${select('owner', OWNER_OPTIONS, '')}
        ${select('fleet', FLEET_OPTIONS, 'box')}
        ${select('modelKey', modelOptions, '')}
        ${select('formId', formOptions, '', 'grow')}
        <button class="btn btn-primary" type="submit">Add</button>
      </form>
    </div>
  </div>

  <div class="card">
    <div class="card-header">All vehicles<span class="step-tag">Reg. no. · owner · fleet · model · form</span></div>
    <table class="table"><tbody>
${rows || '<tr><td class="muted" style="padding:20px">No vehicles yet.</td></tr>'}
    </tbody></table>
  </div>`;

  return page({ title: 'Vehicles – admin', body: html, links: LINKS, lang: 'en', admin: true });
}

/* ------------------------------------------------------------------ *
 * Forms                                                               *
 * ------------------------------------------------------------------ */

function adminFormsPage({ forms, message }) {
  const rows = forms.map(f => `<tr>
      <td><a href="/admin/forms/${esc(f.id)}"><strong>${esc(f.title)}</strong></a>
          ${f.is_default ? ' <span class="chip">default</span>' : ''}</td>
      <td class="mono muted">${esc(f.key)}</td>
      <td>${esc(f.field_count)} questions</td>
      <td>${f.is_default ? 'all except those given their own' : esc(f.vehicle_count) + (Number(f.vehicle_count) === 1 ? ' vehicle' : ' vehicles')}</td>
      <td class="mono muted">${esc(fmtDateTime(f.updated_at))}</td>
      <td>
        <form class="row-form" method="post" action="/admin/forms/${esc(f.id)}/duplicate">
          <a class="btn btn-ghost btn-sm" href="/admin/forms/${esc(f.id)}">Edit</a>
          <button class="btn btn-ghost btn-sm" type="submit">Copy</button>
          ${f.is_default ? '' :
            `<button class="btn btn-danger btn-sm" type="submit"
               formaction="/admin/forms/${esc(f.id)}/delete">Delete</button>`}
        </form>
      </td>
    </tr>`).join('\n');

  const copyOptions = [{ value: '', label: 'Empty form' }]
    .concat(forms.map(f => ({ value: String(f.id), label: 'Copy of: ' + f.title })));

  const html = `  <div class="page-head">
    <h1>Forms</h1>
  </div>
${nav('forms')}
${flash(message)}

  <p class="lede">The default form is used by every vehicle that has not been given its own.
     To give a vehicle its own check: make a copy here, change the questions, and choose
     the copy for that vehicle under <a href="/admin/vehicles">Vehicles</a>.
     The questions themselves are what the drivers read, so they stay in Swedish with
     their translations.</p>

  <div class="card">
    <div class="card-header">New form</div>
    <div class="card-body">
      <form class="row-form" method="post" action="/admin/forms">
        <input class="form-control grow" type="text" name="title" placeholder="Name of the form" required>
        ${select('copyFromId', copyOptions, '')}
        <button class="btn btn-primary" type="submit">Create</button>
      </form>
    </div>
  </div>

  <div class="card">
    <table class="table">
      <thead><tr><th>Form</th><th>Key</th><th>Questions</th><th>Used by</th><th>Changed</th><th></th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>`;

  return page({ title: 'Forms – admin', body: html, links: LINKS, lang: 'en', admin: true });
}

const KIND_OPTIONS = KINDS.map(k => ({ value: k.value, label: k.label }));
const ROLE_OPTIONS = ROLES.map(r => ({ value: r.value, label: r.label }));

function fieldRow(form, f, isFirst, isLast) {
  const opts = Array.isArray(f.options) ? f.options : [];
  const alert = Array.isArray(f.alert_on) ? f.alert_on : [];
  const picks = Array.isArray(f.comment_options) ? f.comment_options : [];
  const blob = f.i18n || {};

  /* The extras -- dropdown options, alert polarity, the three translations
     -- live in a <details> so the list of questions stays readable. They
     post through the same form as the row above them, so one Save writes
     everything. */
  const extras = `
        <details class="q-extra">
          <summary>Options, alerts and translations</summary>
          <div class="q-extra-body">
            <div class="q-col">
              <label class="q-lab">Dropdown options (one per line)</label>
              <textarea class="form-control" name="options" rows="4"
                        placeholder="JK-EM-1&#10;JK-EM-2">${esc(opts.join('\n'))}</textarea>
              <label class="q-lab">Take the list from</label>
              ${select('source', SOURCES.map(o => ({ value: o.value, label: o.label })), f.source)}
            </div>
            <div class="q-col">
              <label class="q-lab">Alert when the answer is</label>
              <div class="q-checks">
                ${CHOICES.map(c => `<label class="check"><input type="checkbox" name="alert_${esc(c.value)}" value="1"${
                  alert.includes(c.value) ? ' checked' : ''}> ${esc(CHOICE_LABEL_EN[c.value] || c.label)}</label>`).join('')}
              </div>
              <p class="q-hint">Decides what the daily email and the FLEET180 view highlight.
                 "Does X work?" alerts on No, "Is there new damage?" alerts on Yes.</p>
              <label class="q-lab">Instruction when the answer alerts</label>
              <input class="form-control" type="text" name="alertNotice"
                     value="${esc(f.alert_notice || '')}"
                     placeholder="Swedish, e.g. Städa upp innan du lämnar bilen!">
              <p class="q-hint">Shown to the driver the moment the answer alerts, above the
                 comment box. Use it when the driver should do something on the spot –
                 not when something only needs reporting. Written in Swedish; the
                 translations go below.</p>
              <label class="q-lab">Take the pick list from</label>
              ${select('commentSource', [
                { value: '', label: 'The list below' },
                { value: 'lights', label: "The vehicle's warning lights (per model)" }
              ], f.comment_source || '')}
              <label class="q-lab">Pick list when the answer alerts (one per line, Swedish)</label>
              <textarea class="form-control" name="commentOptions" rows="4"
                        placeholder="Helljus&#10;Halvljus&#10;Bromsljus">${esc(picks.join('\n'))}</textarea>
              <p class="q-hint">The driver picks one of the options and can type
                 details beside it. What is saved is the Swedish text, whatever
                 language the driver reads in.</p>
            </div>
            <div class="q-col q-col-wide">
              ${i18n.CODES.filter(c => c !== 'sv').map(c => {
                const m = i18n.LANGS.find(l => l.code === c);
                return `<label class="q-lab">${m.flag} ${esc(m.label)} – question text</label>
              <input class="form-control" type="text" name="label_${c}" value="${esc((blob[c] && blob[c].label) || '')}"
                     placeholder="(empty = Swedish is shown)">
              <label class="q-lab">${m.flag} section</label>
              <input class="form-control" type="text" name="section_${c}" value="${esc((blob[c] && blob[c].section) || '')}">
              ${picks.length ? `<label class="q-lab">${m.flag} pick list (same order)</label>
              <textarea class="form-control" name="picks_${c}" rows="3"
                        placeholder="(empty = Swedish is shown)">${esc(((blob[c] && blob[c].commentOptions) || []).join('\n'))}</textarea>` : ''}
              ${f.alert_notice ? `<label class="q-lab">${m.flag} instruction</label>
              <input class="form-control" type="text" name="notice_${c}"
                     value="${esc((blob[c] && blob[c].alertNotice) || '')}"
                     placeholder="(empty = Swedish is shown)">` : ''}`;
              }).join('')}
            </div>
          </div>
        </details>`;

  return `<tr>
    <td style="width:46px;white-space:nowrap;padding-right:0;vertical-align:top">
      <form method="post" action="/admin/forms/${esc(form.id)}/fields/${esc(f.id)}/move" class="stack">
        <button class="btn btn-ghost btn-sm" name="dir" value="up" type="submit"${isFirst ? ' disabled' : ''}>▲</button>
        <button class="btn btn-ghost btn-sm" name="dir" value="down" type="submit"${isLast ? ' disabled' : ''}>▼</button>
      </form>
    </td>
    <td colspan="5" style="padding:9px 10px">
      <form method="post" action="/admin/forms/${esc(form.id)}/fields/${esc(f.id)}">
        <div class="row-form">
          <input class="form-control grow" type="text" name="label" value="${esc(f.label)}" required>
          ${select('kind', KIND_OPTIONS, f.kind)}
          <input class="form-control" type="text" name="section" value="${esc(f.section)}"
                 placeholder="Section" style="width:190px">
          ${select('role', ROLE_OPTIONS, f.role)}
          <label class="check"><input type="checkbox" name="required" value="1"${f.required ? ' checked' : ''}> Required</label>
          <span class="q-kind mono">${esc(f.name)}</span>
          <button class="btn btn-primary btn-sm" type="submit">Save</button>
          <button class="btn btn-danger btn-sm" type="submit"
                  formaction="/admin/forms/${esc(form.id)}/fields/${esc(f.id)}/delete">Delete</button>
        </div>
${extras}
      </form>
    </td>
  </tr>`;
}

function adminFormEditorPage({ form, usedBy, message }) {
  const rows = form.fields.map((f, i) =>
    fieldRow(form, f, i === 0, i === form.fields.length - 1)).join('\n');

  const sections = [...new Set(form.fields.map(f => f.section).filter(Boolean))];
  const sectionList = sections.length
    ? `<p class="lede">Sections in order: ${sections.map(s => `<strong>${esc(s)}</strong>`).join(' · ')}.
       Consecutive questions with the same section name end up in the same card.</p>`
    : '';

  const users = usedBy.length
    ? usedBy.map(v => `<a href="/v/${esc(v.plate)}">${esc(v.plate)}</a>`).join(', ')
    : (form.is_default ? 'every vehicle without a form of its own' : '<span class="muted">no vehicles yet</span>');

  const html = `  <div class="page-head">
    <h1>${esc(form.title)}</h1>
    <div class="muted">${form.fields.length} questions</div>
  </div>
${nav('forms')}
${flash(message)}

  <p class="lede">Used by: ${users}.
     Preview: ${i18n.LANGS.map(l =>
       `<a href="/admin/forms/${esc(form.id)}/preview?lang=${l.code}" title="${esc(l.label)}">${l.flag}</a>`).join(' ')}</p>

  <div class="card">
    <div class="card-header">Name of the form</div>
    <div class="card-body">
      <form class="row-form" method="post" action="/admin/forms/${esc(form.id)}">
        <input class="form-control grow" type="text" name="title" value="${esc(form.title)}" required>
        <button class="btn btn-primary" type="submit">Save name</button>
      </form>
    </div>
  </div>

  <div class="card">
    <div class="card-header">Questions
      <span class="step-tag">The order here is the order the driver sees. ▲▼ moves a question.</span></div>
    <table class="table"><tbody>
${rows || '<tr><td class="muted" style="padding:20px">No questions yet – add the first one below.</td></tr>'}
    </tbody></table>
  </div>
  ${sectionList}

  <div class="card">
    <div class="card-header">New question
      <span class="step-tag">${esc(KINDS.map(k => k.label + ': ' + k.hint).join('  ·  '))}</span></div>
    <div class="card-body">
      <form method="post" action="/admin/forms/${esc(form.id)}/fields">
        <div class="row-form">
          <input class="form-control grow" type="text" name="label" placeholder="Question text (Swedish)" required>
          ${select('kind', KIND_OPTIONS, 'yesno')}
          <input class="form-control" type="text" name="section"
                 placeholder="Section" style="width:190px"
                 value="${esc(form.fields.length ? form.fields[form.fields.length - 1].section : '')}">
          ${select('role', ROLE_OPTIONS, '')}
          <label class="check"><input type="checkbox" name="required" value="1" checked> Required</label>
          <button class="btn btn-primary" type="submit">Add question</button>
        </div>
        <div class="row-form" style="margin-top:8px">
          <input class="form-control grow" type="text" name="optionsLine"
                 placeholder="Dropdown: options separated by commas (e.g. 100%, 95%, 90%)">
          ${select('source', SOURCES.map(o => ({ value: o.value, label: o.label })), '')}
          <span class="q-hint">Alerts and translations are set afterwards on the row above.</span>
        </div>
      </form>
    </div>
  </div>

  <div class="actions no-print">
    <a class="btn btn-ghost" href="/admin/forms">Back to the forms</a>
  </div>`;

  return page({ title: `${form.title} – form`, body: html, links: LINKS, lang: 'en', admin: true });
}

/**
 * Deleting a check is irreversible and takes its photos with it, so it gets
 * its own page rather than a button that fires on one stray click.
 */
function adminDeletePage({ s }) {
  const html = `  <div class="page-head">
    <h1>Delete check #${esc(s.id)}?</h1>
    <div class="plate">${esc(s.plate)}</div>
  </div>
${nav('checks')}

  <div class="card">
    <div class="card-header">This will be removed</div>
    <div class="card-body">
      <table class="kv">
        <tr><td>Vehicle</td><td>${esc(s.plate)}</td></tr>
        <tr><td>Driver</td><td>${esc(s.driver_name || '—')}</td></tr>
        <tr><td>Route</td><td>${esc(s.route || '—')}</td></tr>
        <tr><td>Time</td><td>${esc(fmtDateTime(s.submitted_at))}</td></tr>
        <tr><td>Photos</td><td>${esc((s.photos || []).length)}</td></tr>
      </table>
      <p class="lede" style="margin-top:14px">The check and its photos are deleted permanently.
         This cannot be undone, and the statistics are recalculated without it.</p>
      <form method="post" action="/admin/s/${esc(s.id)}/delete" class="actions" style="justify-content:flex-start">
        <button class="btn btn-danger" type="submit">Yes, delete</button>
        <a class="btn btn-ghost" href="/admin/s/${esc(s.id)}">Cancel</a>
      </form>
    </div>
  </div>`;
  return page({ title: `Delete check ${s.id}`, body: html, links: LINKS, lang: 'en', admin: true });
}

function adminDriversPage({ drivers, message, lastSync }) {
  const rows = drivers.length ? drivers.map(d => `<tr>
      <td>${esc(d.name)}</td>
      <td><span class="chip">${esc(d.type || '—')}</span></td>
      <td>${esc(d.fleet || '—')}</td>
      <td>${d.active ? 'Active' : '<span class="muted">Inactive</span>'}</td>
      <td class="mono muted">${esc(fmtDateTime(d.updated_at))}</td>
    </tr>`).join('\n')
    : `<tr><td colspan="5" class="muted" style="padding:20px">
         No drivers synced yet. Run the sync on your computer, or post the list to
         <span class="mono">/api/drivers</span>.</td></tr>`;

  const html = `  <div class="page-head">
    <h1>Drivers</h1>
    <div class="muted">${drivers.filter(d => d.active).length} active of ${drivers.length}</div>
  </div>
${nav('drivers')}
${flash(message)}

  <p class="lede">The list belongs to Route Suite and is overwritten by the sync – it is not edited here.
     The names fill the <em>Namn och efternamn</em> dropdown in the form, in alphabetical order.
     A driver who disappears from the suite is marked inactive instead of deleted, so that a
     check already signed can still be read.
     ${lastSync ? `Last sync: <strong>${esc(fmtDateTime(lastSync))}</strong>.` : ''}</p>

  <div class="card">
    <table class="table">
      <thead><tr><th>Name</th><th>Type</th><th>Fleet</th><th>Status</th><th>Updated</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>`;

  return page({ title: 'Drivers – admin', body: html, links: LINKS, lang: 'en', admin: true });
}

module.exports = {
  nav: nav,
  adminListPage, adminDetailPage, adminVehiclesPage,
  adminFormsPage, adminFormEditorPage, adminDriversPage, adminDeletePage
};
