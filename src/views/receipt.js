'use strict';

const { page, esc, fmtDateTime } = require('./layout');
const { formatAnswer } = require('../fields');

/**
 * A submission is rendered from the questions it was answered against --
 * `questions`, snapshotted at submit time -- not from today's form. A
 * question deleted last week still shows on last month's check. Rows
 * written before the form editor existed have no snapshot; those fall
 * back to the form passed in.
 */
function answerRows(submission, fallbackFields) {
  const questions = submission.questions && submission.questions.length
    ? submission.questions
    : (fallbackFields || []);
  const answers = submission.answers || {};

  return questions.map(q => {
    let text;
    if (q.kind === 'photo') {
      const n = (submission.photos || []).filter(p => p.field === q.name).length;
      text = n ? `${n} foto${n > 1 ? 'n' : ''}` : '—';
    } else if (q.kind === 'info') {
      return `<tr><td colspan="2" class="muted">${esc(q.label)}</td></tr>`;
    } else {
      text = formatAnswer(q, answers[q.name]);
    }
    return `<tr><td>${esc(q.label)}</td><td>${esc(text)}</td></tr>`;
  }).join('\n');
}

function receiptPage({ submission, fallbackFields }) {
  const body = `  <div class="page-head">
    <h1>Kontroll registrerad</h1>
    <div class="plate">${esc(submission.plate)}</div>
  </div>

  <div class="receipt">
    <h2>Tack – kontrollen är sparad</h2>
    <p class="muted" style="margin:0">
      Kvitto nr <strong>${esc(submission.id)}</strong> ·
      ${esc(fmtDateTime(submission.submitted_at))} ·
      ${esc(submission.form_title || submission.form_key)}
    </p>
  </div>

  <div class="card">
    <div class="card-header">Ifylld kontroll<span class="step-tag">${esc(submission.plate)}</span></div>
    <div class="card-body">
      <table class="kv">
${answerRows(submission, fallbackFields)}
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

module.exports = { receiptPage, answerRows };
