'use strict';

/**
 * Question types, and the one place that knows how an answer of each type
 * is read from a request, checked, and written out again. Views, the
 * submit handler and the CSV export all go through here, so a new type
 * needs adding in exactly one file.
 */

const KINDS = [
  { value: 'text',   label: 'Fritext',           hint: 'En rad text.' },
  { value: 'select', label: 'Rullgardin',        hint: 'Föraren väljer ur en lista. Skriv alternativen ett per rad, eller välj förarlistan som källa.' },
  { value: 'yesno',  label: 'Ja / Nej / Annat',  hint: 'Tre knappar. Kommentar krävs vid "Annat" och kan fyllas i vid "Nej".' },
  { value: 'photo',  label: 'Foto',              hint: 'Öppnar kameran. Flera bilder tillåtna.' },
  { value: 'info',   label: 'Informationstext',  hint: 'Bara text till föraren, inget svar.' }
];

/** Where a dropdown's options come from. */
const SOURCES = [
  { value: '',        label: 'Egna alternativ' },
  { value: 'drivers', label: 'Förarlistan (synkas från Route Suite)' }
];

const KIND_VALUES = KINDS.map(k => k.value);
const KIND_LABEL = Object.fromEntries(KINDS.map(k => [k.value, k.label]));

const CHOICES = [
  { value: 'ja',    label: 'Ja' },
  { value: 'nej',   label: 'Nej' },
  { value: 'annat', label: 'Annat' }
];
const CHOICE_LABEL = Object.fromEntries(CHOICES.map(c => [c.value, c.label]));

/** Fallback for questions with no alert polarity of their own. */
const COMMENT_CHOICES = new Set(['nej', 'annat']);

/**
 * Which answers open the comment box for this question.
 *
 * It follows the question's own polarity rather than a fixed Nej/Annat:
 * "have you damaged the vehicle?" flags on Ja, and Ja is exactly where the
 * driver needs to write what happened. Getting this wrong silently discards
 * what they typed, which is worse than not asking.
 */
function commentChoices(field) {
  const on = Array.isArray(field && field.alert_on) ? field.alert_on
    : Array.isArray(field && field.alertOn) ? field.alertOn : [];
  const set = new Set(on.length ? on : COMMENT_CHOICES);
  set.add('annat');           // "Annat" always needs saying what
  return set;
}

const ROLES = [
  { value: '',         label: '—' },
  { value: 'driver',   label: 'Förarens namn' },
  { value: 'route',    label: 'Rutt' },
  { value: 'odometer', label: 'Miltal' }
];

/** Answers as posted -> the shape stored in the answers JSONB column. */
function readAnswer(field, body) {
  if (field.kind === 'text' || field.kind === 'select') {
    return String(body[field.name] ?? '').trim().slice(0, 2000);
  }
  if (field.kind === 'yesno') {
    const choice = String(body[field.name] ?? '').trim().toLowerCase();
    const comment = String(body[field.name + '__comment'] ?? '').trim().slice(0, 2000);
    if (!choice && !comment) return null;
    return {
      choice: CHOICE_LABEL[choice] ? choice : '',
      comment: commentChoices(field).has(choice) ? comment : ''
    };
  }
  return null; // photo and info carry no posted value
}

/** null when the answer is acceptable, otherwise why it is not. */
function answerProblem(field, value, allowed) {
  if (field.kind === 'text') {
    if (field.required && !String(value || '').trim()) return 'required';
    return null;
  }
  if (field.kind === 'select') {
    const v = String(value || '').trim();
    if (!v) return field.required ? 'choose' : null;
    // A dropdown may only carry one of its own options: the list is the
    // whole point, and a posted value outside it is either a stale page
    // or someone editing the request.
    if (allowed && allowed.length && !allowed.includes(v)) return 'notInList';
    return null;
  }
  if (field.kind === 'yesno') {
    const choice = value && value.choice;
    if (!choice) return field.required ? 'chooseYesNo' : null;
    if (!CHOICE_LABEL[choice]) return 'invalid';
    if (choice === 'annat' && !String(value.comment || '').trim()) return 'commentRequired';
    return null;
  }
  return null;
}

/**
 * One line for a receipt, the admin detail table or a CSV cell.
 *
 * Tolerant of the other shape on purpose: checks submitted before the form
 * editor existed stored every answer as plain text, including the ones now
 * asked as Ja/Nej/Annat. Those rows must keep reading correctly forever, so
 * a string where an object is expected is shown as the string, and vice
 * versa -- never as an empty cell.
 */
function formatAnswer(field, value) {
  if (value === null || value === undefined) return '—';

  if (typeof value === 'string') return value.trim() || '—';

  if (typeof value === 'object') {
    if (!value.choice) {
      const comment = String(value.comment || '').trim();
      return comment || '—';
    }
    const label = CHOICE_LABEL[value.choice] || value.choice;
    const comment = String(value.comment || '').trim();
    return comment ? `${label}: ${comment}` : label;
  }

  return String(value);
}

/** Does this question hold an answer at all? (info and photo do not.) */
function isAnswerable(field) {
  return field.kind === 'text' || field.kind === 'select' || field.kind === 'yesno';
}

/**
 * Does this answer mean something needs attention?
 *
 * The polarity is per question, not global: "does the tail lift work" is a
 * problem on Nej, "is there new damage" is a problem on Ja. `alert_on`
 * carries that per field, so the daily mail and the extension's day view
 * flag the right rows instead of guessing from the wording.
 */
function isAlerting(field, value) {
  const on = Array.isArray(field.alert_on) ? field.alert_on
    : Array.isArray(field.alertOn) ? field.alertOn : [];
  if (!on.length) return false;
  if (field.kind === 'yesno') {
    if (value && typeof value === 'object') return !!value.choice && on.includes(value.choice);
    // Legacy free text from before the editor: "Nej, trasig lampa" should
    // still flag, so match on how the answer opens rather than exactly.
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!text) return false;
    return on.some(choice => text === choice || text.startsWith(choice + ' ') ||
      text.startsWith(choice + ',') || text.startsWith(choice + '.'));
  }
  const v = typeof value === 'string' ? value.trim() : '';
  return !!v && on.includes(v);
}

/** Options a dropdown offers: its own list, or a live source. */
function optionsFor(field, sources) {
  if (field.source === 'drivers') return (sources && sources.drivers) || [];
  return Array.isArray(field.options) ? field.options : [];
}

module.exports = {
  KINDS, KIND_VALUES, KIND_LABEL, SOURCES, CHOICES, CHOICE_LABEL, COMMENT_CHOICES, commentChoices,
  ROLES, readAnswer, answerProblem, formatAnswer, isAnswerable, isAlerting, optionsFor
};
