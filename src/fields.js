'use strict';

/**
 * Question types, and the one place that knows how an answer of each type
 * is read from a request, checked, and written out again. Views, the
 * submit handler and the CSV export all go through here, so a new type
 * needs adding in exactly one file.
 */

const KINDS = [
  { value: 'text',  label: 'Fritext',            hint: 'En rad text.' },
  { value: 'yesno', label: 'Ja / Nej / Annat',   hint: 'Tre knappar. Kommentar krävs vid "Annat" och kan fyllas i vid "Nej".' },
  { value: 'photo', label: 'Foto',               hint: 'Öppnar kameran. Flera bilder tillåtna.' },
  { value: 'info',  label: 'Informationstext',   hint: 'Bara text till föraren, inget svar.' }
];

const KIND_VALUES = KINDS.map(k => k.value);
const KIND_LABEL = Object.fromEntries(KINDS.map(k => [k.value, k.label]));

const CHOICES = [
  { value: 'ja',    label: 'Ja' },
  { value: 'nej',   label: 'Nej' },
  { value: 'annat', label: 'Annat' }
];
const CHOICE_LABEL = Object.fromEntries(CHOICES.map(c => [c.value, c.label]));

/** Comment box is offered for these choices; required only for "Annat". */
const COMMENT_CHOICES = new Set(['nej', 'annat']);

const ROLES = [
  { value: '',         label: '—' },
  { value: 'driver',   label: 'Förarens namn' },
  { value: 'route',    label: 'Rutt' },
  { value: 'odometer', label: 'Miltal' }
];

/** Answers as posted -> the shape stored in the answers JSONB column. */
function readAnswer(field, body) {
  if (field.kind === 'text') {
    return String(body[field.name] ?? '').trim().slice(0, 2000);
  }
  if (field.kind === 'yesno') {
    const choice = String(body[field.name] ?? '').trim().toLowerCase();
    const comment = String(body[field.name + '__comment'] ?? '').trim().slice(0, 2000);
    if (!choice && !comment) return null;
    return {
      choice: CHOICE_LABEL[choice] ? choice : '',
      comment: COMMENT_CHOICES.has(choice) ? comment : ''
    };
  }
  return null; // photo and info carry no posted value
}

/** null when the answer is acceptable, otherwise why it is not. */
function answerProblem(field, value) {
  if (field.kind === 'text') {
    if (field.required && !String(value || '').trim()) return 'Fältet är obligatoriskt.';
    return null;
  }
  if (field.kind === 'yesno') {
    const choice = value && value.choice;
    if (!choice) return field.required ? 'Välj Ja, Nej eller Annat.' : null;
    if (!CHOICE_LABEL[choice]) return 'Ogiltigt svar.';
    if (choice === 'annat' && !String(value.comment || '').trim()) {
      return 'Skriv en kommentar när du svarar Annat.';
    }
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
  return field.kind === 'text' || field.kind === 'yesno';
}

module.exports = {
  KINDS, KIND_VALUES, KIND_LABEL, CHOICES, CHOICE_LABEL, COMMENT_CHOICES,
  ROLES, readAnswer, answerProblem, formatAnswer, isAnswerable
};
