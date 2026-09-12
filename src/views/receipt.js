'use strict';

const { page, esc, fmtDateTime } = require('./layout');
const { formatAnswer } = require('../fields');
const i18n = require('../i18n');

/**
 * A submission is rendered from the questions it was answered against --
 * `questions`, snapshotted at submit time -- not from today's form. A
 * question deleted last week still shows on last month's check. Rows
 * written before the form editor existed have no snapshot; those fall
 * back to the form passed in.
 */
function answerRows(submission, fallbackFields, lang = 'sv') {
  const questions = submission.questions && submission.questions.length
    ? submission.questions
    : (fallbackFields || []);
  const answers = submission.answers || {};

  return questions.map(q => {
    const label = i18n.fieldText(q, lang);
    let text;
    if (q.kind === 'photo') {
      const n = (submission.photos || []).filter(p => p.field === q.name).length;
      text = n ? `${n} foto${n > 1 ? 'n' : ''}` : '—';
    } else if (q.kind === 'info') {
      return `<tr><td colspan="2" class="muted">${esc(label)}</td></tr>`;
    } else {
      const value = answers[q.name];
      // Ja/Nej/Annat reads back in the language the receipt is shown in;
      // the comment stays in whatever the driver typed.
      if (q.kind === 'yesno' && value && typeof value === 'object' && value.choice) {
        const key = value.choice === 'ja' ? 'yes' : value.choice === 'nej' ? 'no' : 'other';
        const comment = String(value.comment || '').trim();
        // The picked item is stored in Swedish whatever language it was read
        // in, so a receipt in another language shows that language's wording
        // for it -- from the question's own snapshot, not today's form.
        const detail = [pickText(q, value.pick, lang), comment].filter(Boolean).join(' – ');
        text = detail ? `${i18n.t(lang, key)}: ${detail}` : i18n.t(lang, key);
      } else {
        text = formatAnswer(q, value);
      }
    }
    return `<tr><td>${esc(label)}</td><td>${esc(text)}</td></tr>`;
  }).join('\n');
}

/** One picked follow-up option, in the language the receipt is being read in. */
function pickText(question, pick, lang) {
  const value = String(pick || '').trim();
  if (!value) return '';
  const list = question.comment_options || question.commentOptions || [];
  const i = list.indexOf(value);
  if (i < 0 || lang === i18n.DEFAULT_LANG) return value;
  const translated = ((question.i18n || {})[lang] || {}).commentOptions || [];
  return (translated[i] || '').trim() || value;
}

function receiptPage({ submission, fallbackFields, lang = 'sv' }) {
  const code = i18n.langOf(lang);
  const q = code === i18n.DEFAULT_LANG ? '' : `?lang=${code}`;

  const body = `  <div class="page-head">
    <h1>${esc(i18n.t(code, 'receiptTitle'))}</h1>
    <div class="plate">${esc(submission.plate)}</div>
  </div>

  <div class="receipt">
    <h2>${esc(i18n.t(code, 'receiptThanks'))}</h2>
    <p class="muted" style="margin:0">
      ${esc(i18n.t(code, 'receiptNo'))} <strong>${esc(submission.id)}</strong> ·
      ${esc(fmtDateTime(submission.submitted_at))} ·
      ${esc(submission.form_title || submission.form_key)}
    </p>
  </div>

  <div class="card">
    <div class="card-header">${esc(i18n.t(code, 'filledIn'))}<span class="step-tag">${esc(submission.plate)}</span></div>
    <div class="card-body">
      <table class="kv">
${answerRows(submission, fallbackFields, code)}
      </table>
    </div>
  </div>

  <div class="actions no-print">
    <button type="button" class="btn btn-secondary" onclick="window.print()">${esc(i18n.t(code, 'print'))}</button>
    <a class="btn btn-primary" href="/v/${esc(submission.plate)}${q}">${esc(i18n.t(code, 'newCheck'))} ${esc(submission.plate)}</a>
  </div>`;

  return page({ title: `${i18n.t(code, 'receiptNo')} ${submission.id} – ${submission.plate}`, body,
    lang: code, links: [] });
}

module.exports = { receiptPage, answerRows };
