'use strict';

const { page, esc, fmtDateTime } = require('./layout');
const { VEHICLES } = require('../vehicles');
const { FIELDS } = require('../form-def');

const LINKS = [
  { href: '/', text: 'Fordon' },
  { href: '/qr', text: 'QR-koder' },
  { href: '/admin', text: 'Admin' }
];

function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? '?' + s : '';
}

function adminListPage({ rows, total, filters, limit, offset }) {
  const options = ['<option value="">Alla fordon</option>'].concat(
    VEHICLES.map(v =>
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

  <form class="filters" method="get" action="/admin">
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

function adminDetailPage({ s }) {
  const answers = s.answers || {};
  const rows = FIELDS.map(f => {
    if (f.kind === 'file') {
      const pics = (s.photos || []).filter(p => p.field === f.name);
      const grid = pics.length
        ? `<div class="photo-grid">${pics.map(p =>
            `<a href="/admin/photo/${esc(p.id)}" target="_blank" rel="noopener">
               <img src="/admin/photo/${esc(p.id)}" alt="${esc(p.filename || 'foto')}"></a>`).join('')}</div>`
        : '<span class="muted">—</span>';
      return `<tr><td>${esc(f.label)}</td><td>${grid}</td></tr>`;
    }
    const a = (answers[f.name] || '').trim() || '—';
    return `<tr><td>${esc(f.label)}</td><td>${esc(a)}</td></tr>`;
  }).join('\n');

  const html = `  <div class="page-head">
    <h1>Kontroll #${esc(s.id)}</h1>
    <div class="plate">${esc(s.plate)}</div>
  </div>
  <p class="lede">${esc(fmtDateTime(s.submitted_at))} · förare ${esc(s.driver_name || '—')} ·
     rutt ${esc(s.route || '—')} · miltal ${esc(s.odometer || '—')}</p>

  <div class="card">
    <div class="card-header">Svar<span class="step-tag">${esc(s.form_key)}</span></div>
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

module.exports = { adminListPage, adminDetailPage };
