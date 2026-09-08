'use strict';

const { page, esc, fmtDateTime } = require('./layout');
const { FORM_TITLE, FIELDS } = require('../form-def');

function receiptPage({ submission }) {
  const answers = submission.answers || {};
  const rows = FIELDS.map(f => {
    let a;
    if (f.kind === 'file') {
      const n = (submission.photos || []).filter(p => p.field === f.name).length;
      a = n ? `${n} foto${n > 1 ? 'n' : ''}` : '—';
    } else {
      a = (answers[f.name] || '').trim() || '—';
    }
    return `<tr><td>${esc(f.label)}</td><td>${esc(a)}</td></tr>`;
  }).join('\n');

  const body = `  <div class="page-head">
    <h1>Kontroll registrerad</h1>
    <div class="plate">${esc(submission.plate)}</div>
  </div>

  <div class="receipt">
    <h2>Tack – kontrollen är sparad</h2>
    <p class="muted" style="margin:0">
      Kvitto nr <strong>${esc(submission.id)}</strong> ·
      ${esc(fmtDateTime(submission.submitted_at))} ·
      ${esc(FORM_TITLE)}
    </p>
  </div>

  <div class="card">
    <div class="card-header">Ifylld kontroll<span class="step-tag">${esc(submission.plate)}</span></div>
    <div class="card-body">
      <table class="kv">
${rows}
      </table>
    </div>
  </div>

  <div class="actions no-print">
    <button type="button" class="btn btn-secondary" onclick="window.print()">Skriv ut / PDF</button>
    <a class="btn btn-ghost" href="/v/${esc(submission.plate)}">Ny kontroll för ${esc(submission.plate)}</a>
    <a class="btn btn-primary" href="/">Alla fordon</a>
  </div>`;

  return page({ title: `Kvitto ${submission.id} – ${submission.plate}`, body,
    links: [{ href: '/', text: 'Alla fordon' }] });
}

module.exports = { receiptPage };
