'use strict';

const { page, esc, fmtDateTime } = require('./layout');
const { KINDS, KIND_LABEL, ROLES, formatAnswer } = require('../fields');
const { OWNER_LABEL, FLEET_LABEL } = require('./index');

const LINKS = [
  { href: '/', text: 'Fordon' },
  { href: '/qr', text: 'QR-koder' },
  { href: '/admin', text: 'Admin' }
];

const TABS = [
  { href: '/admin', text: 'Kontroller', key: 'checks' },
  { href: '/admin/vehicles', text: 'Fordon', key: 'vehicles' },
  { href: '/admin/forms', text: 'Formulär', key: 'forms' }
];

function nav(active) {
  return `<div class="admin-nav no-print">${TABS.map(t =>
    `<a href="${t.href}"${t.key === active ? ' class="on"' : ''}>${esc(t.text)}</a>`).join('')}</div>`;
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
  const options = ['<option value="">Alla fordon</option>'].concat(
    vehicles.map(v =>
      `<option value="${esc(v.plate)}"${filters.plate === v.plate ? ' selected' : ''}>${esc(v.plate)}</option>`)
  ).join('');

  const body = rows.length ? rows.map(r => `<tr>
      <td class="mono">${esc(fmtDateTime(r.submitted_at))}</td>
      <td class="mono" style="font-weight:700">${esc(r.plate)}</td>
      <td>${esc(r.driver_name || '—')}</td>
      <td>${esc(r.route || '—')}</td>
      <td class="mono">${esc(r.odometer || '—')}</td>
      <td>${r.photo_count ? esc(r.photo_count) + ' 📷' : '<span class="muted">—</span>'}</td>
      <td><a href="/admin/s/${esc(r.id)}">Visa</a></td>
    </tr>`).join('\n')
    : `<tr><td colspan="7" class="muted" style="padding:20px">Inga kontroller matchar filtret.</td></tr>`;

  const prev = offset > 0
    ? `<a class="btn btn-ghost" href="/admin${qs({ ...filters, offset: Math.max(0, offset - limit) })}">← Föregående</a>` : '';
  const next = offset + limit < total
    ? `<a class="btn btn-ghost" href="/admin${qs({ ...filters, offset: offset + limit })}">Nästa →</a>` : '';

  const html = `  <div class="page-head">
    <h1>Administration</h1>
    <div class="muted">${esc(total)} kontroller</div>
  </div>
${nav('checks')}

  <form class="filters no-print" method="get" action="/admin">
    <div class="f"><label for="plate">Fordon</label>
      <select class="form-control" id="plate" name="plate">${options}</select></div>
    <div class="f"><label for="from">Från</label>
      <input class="form-control" type="date" id="from" name="from" value="${esc(filters.from || '')}"></div>
    <div class="f"><label for="to">Till</label>
      <input class="form-control" type="date" id="to" name="to" value="${esc(filters.to || '')}"></div>
    <button class="btn btn-primary" type="submit">Filtrera</button>
    <a class="btn btn-ghost" href="/admin">Rensa</a>
    <a class="btn btn-secondary" href="/admin/export.csv${qs(filters)}">Ladda ner CSV</a>
  </form>

  <div class="card">
    <table class="table">
      <thead><tr>
        <th>Tidpunkt</th><th>Reg.nr</th><th>Förare</th><th>Rutt</th><th>Miltal</th><th>Foton</th><th></th>
      </tr></thead>
      <tbody>
${body}
      </tbody>
    </table>
  </div>

  <div class="actions" style="justify-content:space-between">${prev || '<span></span>'}${next || '<span></span>'}</div>`;

  return page({ title: 'Administration – säkerhetskontroller', body: html, links: LINKS });
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
               <img src="/admin/photo/${esc(p.id)}" alt="${esc(p.filename || 'foto')}"></a>`).join('')}</div>`
        : '<span class="muted">—</span>';
      return `<tr><td>${esc(q.label)}</td><td>${grid}</td></tr>`;
    }
    if (q.kind === 'info') return `<tr><td colspan="2" class="muted">${esc(q.label)}</td></tr>`;
    return `<tr><td>${esc(q.label)}</td><td>${esc(formatAnswer(q, answers[q.name]))}</td></tr>`;
  }).join('\n');

  const html = `  <div class="page-head">
    <h1>Kontroll #${esc(s.id)}</h1>
    <div class="plate">${esc(s.plate)}</div>
  </div>
  <p class="lede">${esc(fmtDateTime(s.submitted_at))} · förare ${esc(s.driver_name || '—')} ·
     rutt ${esc(s.route || '—')} · miltal ${esc(s.odometer || '—')}</p>

  <div class="card">
    <div class="card-header">Svar<span class="step-tag">${esc(s.form_title || s.form_key)}</span></div>
    <div class="card-body"><table class="kv">
${rows}
    </table></div>
  </div>

  <div class="card no-print">
    <div class="card-header">Teknisk information</div>
    <div class="card-body"><table class="kv">
      <tr><td>Enhet</td><td style="font-weight:400" class="muted">${esc(s.user_agent || '—')}</td></tr>
      <tr><td>IP</td><td style="font-weight:400" class="muted">${esc(s.client_ip || '—')}</td></tr>
    </table></div>
  </div>

  <div class="actions no-print">
    <button class="btn btn-secondary" type="button" onclick="window.print()">Skriv ut / PDF</button>
    <a class="btn btn-primary" href="/admin">Tillbaka till listan</a>
  </div>`;

  return page({ title: `Kontroll ${s.id} – ${s.plate}`, body: html, links: LINKS });
}

/* ------------------------------------------------------------------ *
 * Vehicles                                                            *
 * ------------------------------------------------------------------ */

const OWNER_OPTIONS = [
  { value: '', label: '— (ej angivet)' },
  { value: 'own', label: OWNER_LABEL.own },
  { value: 'okq8', label: OWNER_LABEL.okq8 }
];
const FLEET_OPTIONS = Object.entries(FLEET_LABEL).map(([value, label]) => ({ value, label }));

function adminVehiclesPage({ vehicles, forms, message, counts }) {
  const formOptions = [{ value: '', label: 'Standardformulär' }]
    .concat(forms.filter(f => !f.is_default).map(f => ({ value: String(f.id), label: f.title })));

  const rows = vehicles.map(v => `<tr>
      <td colspan="7" style="padding:0">
        <form class="row-form" method="post" action="/admin/vehicles/${esc(v.id)}" style="padding:9px 10px;border:0">
          <input class="form-control mono" type="text" name="plate" value="${esc(v.plate)}"
                 style="font-weight:700;width:110px" maxlength="16" required>
          ${select('owner', OWNER_OPTIONS, v.owner)}
          ${select('fleet', FLEET_OPTIONS, v.fleet)}
          ${select('formId', formOptions, v.form_id ? String(v.form_id) : '', 'grow')}
          <label class="check"><input type="checkbox" name="active" value="1"${v.active ? ' checked' : ''}> Aktiv</label>
          <span class="muted" style="font-size:13px">${esc(counts.get(v.plate) || 0)} kontroller</span>
          <button class="btn btn-primary btn-sm" type="submit">Spara</button>
          <a class="btn btn-ghost btn-sm" href="/qr/${esc(v.plate)}.png" target="_blank" rel="noopener">QR</a>
          <button class="btn btn-danger btn-sm" type="submit" formaction="/admin/vehicles/${esc(v.id)}/delete">Ta bort</button>
        </form>
      </td>
    </tr>`).join('\n');

  const html = `  <div class="page-head">
    <h1>Fordon</h1>
    <div class="muted">${vehicles.length} st</div>
  </div>
${nav('vehicles')}
${flash(message)}

  <p class="lede">Ett fordon som läggs upp här får omedelbart en egen sida och en egen QR-kod
     på <a href="/qr">QR-sidan</a>. Ett fordon som inte längre används bockas ur som
     <em>Aktivt</em> – då försvinner det från listor och QR-arket, men dess gamla kontroller
     finns kvar. <em>Ta bort</em> går bara på fordon utan registrerade kontroller.</p>

  <div class="card">
    <div class="card-header">Nytt fordon</div>
    <div class="card-body">
      <form class="row-form" method="post" action="/admin/vehicles">
        <input class="form-control mono" type="text" name="plate" placeholder="REG.NR"
               style="font-weight:700;width:130px" maxlength="16" required>
        ${select('owner', OWNER_OPTIONS, '')}
        ${select('fleet', FLEET_OPTIONS, 'box')}
        ${select('formId', formOptions, '', 'grow')}
        <button class="btn btn-primary" type="submit">Lägg till</button>
      </form>
    </div>
  </div>

  <div class="card">
    <div class="card-header">Alla fordon<span class="step-tag">Reg.nr · ägare · flotta · formulär</span></div>
    <table class="table"><tbody>
${rows || '<tr><td class="muted" style="padding:20px">Inga fordon ännu.</td></tr>'}
    </tbody></table>
  </div>`;

  return page({ title: 'Fordon – administration', body: html, links: LINKS });
}

/* ------------------------------------------------------------------ *
 * Forms                                                               *
 * ------------------------------------------------------------------ */

function adminFormsPage({ forms, message }) {
  const rows = forms.map(f => `<tr>
      <td><a href="/admin/forms/${esc(f.id)}"><strong>${esc(f.title)}</strong></a>
          ${f.is_default ? ' <span class="chip">standard</span>' : ''}</td>
      <td class="mono muted">${esc(f.key)}</td>
      <td>${esc(f.field_count)} frågor</td>
      <td>${f.is_default ? 'alla utom särskilt tilldelade' : esc(f.vehicle_count) + ' fordon'}</td>
      <td class="mono muted">${esc(fmtDateTime(f.updated_at))}</td>
      <td>
        <form class="row-form" method="post" action="/admin/forms/${esc(f.id)}/duplicate">
          <a class="btn btn-ghost btn-sm" href="/admin/forms/${esc(f.id)}">Redigera</a>
          <button class="btn btn-ghost btn-sm" type="submit">Kopiera</button>
          ${f.is_default ? '' :
            `<button class="btn btn-danger btn-sm" type="submit"
               formaction="/admin/forms/${esc(f.id)}/delete">Ta bort</button>`}
        </form>
      </td>
    </tr>`).join('\n');

  const copyOptions = [{ value: '', label: 'Tomt formulär' }]
    .concat(forms.map(f => ({ value: String(f.id), label: 'Kopia av: ' + f.title })));

  const html = `  <div class="page-head">
    <h1>Formulär</h1>
  </div>
${nav('forms')}
${flash(message)}

  <p class="lede">Standardformuläret används av alla fordon som inte fått ett eget.
     Vill du att ett fordon ska ha en egen kontroll: gör en kopia här, ändra frågorna,
     och välj kopian för det fordonet under <a href="/admin/vehicles">Fordon</a>.</p>

  <div class="card">
    <div class="card-header">Nytt formulär</div>
    <div class="card-body">
      <form class="row-form" method="post" action="/admin/forms">
        <input class="form-control grow" type="text" name="title" placeholder="Namn på formuläret" required>
        ${select('copyFromId', copyOptions, '')}
        <button class="btn btn-primary" type="submit">Skapa</button>
      </form>
    </div>
  </div>

  <div class="card">
    <table class="table">
      <thead><tr><th>Formulär</th><th>Nyckel</th><th>Frågor</th><th>Används av</th><th>Ändrad</th><th></th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>`;

  return page({ title: 'Formulär – administration', body: html, links: LINKS });
}

const KIND_OPTIONS = KINDS.map(k => ({ value: k.value, label: k.label }));
const ROLE_OPTIONS = ROLES.map(r => ({ value: r.value, label: r.label }));

function fieldRow(form, f, isFirst, isLast) {
  return `<tr>
    <td style="width:46px;white-space:nowrap;padding-right:0">
      <form method="post" action="/admin/forms/${esc(form.id)}/fields/${esc(f.id)}/move" class="stack">
        <button class="btn btn-ghost btn-sm" name="dir" value="up" type="submit"${isFirst ? ' disabled' : ''}>▲</button>
        <button class="btn btn-ghost btn-sm" name="dir" value="down" type="submit"${isLast ? ' disabled' : ''}>▼</button>
      </form>
    </td>
    <td colspan="5" style="padding:9px 10px">
      <form class="row-form" method="post" action="/admin/forms/${esc(form.id)}/fields/${esc(f.id)}">
        <input class="form-control grow" type="text" name="label" value="${esc(f.label)}" required>
        ${select('kind', KIND_OPTIONS, f.kind)}
        <input class="form-control" type="text" name="section" value="${esc(f.section)}"
               placeholder="Avsnitt" style="width:190px">
        ${select('role', ROLE_OPTIONS, f.role)}
        <label class="check"><input type="checkbox" name="required" value="1"${f.required ? ' checked' : ''}> Obligatorisk</label>
        <span class="q-kind mono">${esc(f.name)}</span>
        <button class="btn btn-primary btn-sm" type="submit">Spara</button>
        <button class="btn btn-danger btn-sm" type="submit"
                formaction="/admin/forms/${esc(form.id)}/fields/${esc(f.id)}/delete">Ta bort</button>
      </form>
    </td>
  </tr>`;
}

function adminFormEditorPage({ form, usedBy, message }) {
  const rows = form.fields.map((f, i) =>
    fieldRow(form, f, i === 0, i === form.fields.length - 1)).join('\n');

  const sections = [...new Set(form.fields.map(f => f.section).filter(Boolean))];
  const sectionList = sections.length
    ? `<p class="lede">Avsnitt i tur och ordning: ${sections.map(s => `<strong>${esc(s)}</strong>`).join(' · ')}.
       Frågor som står efter varandra med samma avsnittsnamn hamnar i samma kort.</p>`
    : '';

  const users = usedBy.length
    ? usedBy.map(v => `<a href="/v/${esc(v.plate)}">${esc(v.plate)}</a>`).join(', ')
    : (form.is_default ? 'alla fordon utan eget formulär' : '<span class="muted">inga fordon ännu</span>');

  const html = `  <div class="page-head">
    <h1>${esc(form.title)}</h1>
    <div class="muted">${form.fields.length} frågor</div>
  </div>
${nav('forms')}
${flash(message)}

  <p class="lede">Används av: ${users}.
     <a href="/admin/forms/${esc(form.id)}/preview">Förhandsgranska</a></p>

  <div class="card">
    <div class="card-header">Formulärets namn</div>
    <div class="card-body">
      <form class="row-form" method="post" action="/admin/forms/${esc(form.id)}">
        <input class="form-control grow" type="text" name="title" value="${esc(form.title)}" required>
        <button class="btn btn-primary" type="submit">Spara namn</button>
      </form>
    </div>
  </div>

  <div class="card">
    <div class="card-header">Frågor
      <span class="step-tag">Ordningen här är ordningen föraren ser. ▲▼ flyttar en fråga.</span></div>
    <table class="table"><tbody>
${rows || '<tr><td class="muted" style="padding:20px">Inga frågor ännu – lägg till den första nedan.</td></tr>'}
    </tbody></table>
  </div>
  ${sectionList}

  <div class="card">
    <div class="card-header">Ny fråga
      <span class="step-tag">${esc(KINDS.map(k => k.label + ': ' + k.hint).join('  ·  '))}</span></div>
    <div class="card-body">
      <form class="row-form" method="post" action="/admin/forms/${esc(form.id)}/fields">
        <input class="form-control grow" type="text" name="label" placeholder="Frågans text" required>
        ${select('kind', KIND_OPTIONS, 'yesno')}
        <input class="form-control" type="text" name="section"
               placeholder="Avsnitt" style="width:190px"
               value="${esc(form.fields.length ? form.fields[form.fields.length - 1].section : '')}">
        ${select('role', ROLE_OPTIONS, '')}
        <label class="check"><input type="checkbox" name="required" value="1" checked> Obligatorisk</label>
        <button class="btn btn-primary" type="submit">Lägg till fråga</button>
      </form>
    </div>
  </div>

  <div class="actions no-print">
    <a class="btn btn-ghost" href="/admin/forms">Tillbaka till formulären</a>
  </div>`;

  return page({ title: `${form.title} – formulär`, body: html, links: LINKS });
}

module.exports = {
  adminListPage, adminDetailPage, adminVehiclesPage,
  adminFormsPage, adminFormEditorPage
};
