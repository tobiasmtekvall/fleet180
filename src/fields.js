'use strict';

/**
 * Question types, and the one place that knows how an answer of each type
 * is read from a request, checked, and written out again. Views, the
 * submit handler and the CSV export all go through here, so a new type
 * needs adding in exactly one file.
 */

// Only for reading a stored lamp code back as a name -- see pickName().
// telltales requires nothing from here, so there is no cycle.
const telltales = require('./telltales');

const KINDS = [
  // Labels and hints are admin-facing (the form editor), so English.
  { value: 'text',   label: 'Free text',          hint: 'One line of text.' },
  { value: 'select', label: 'Dropdown',           hint: 'The driver picks from a list. Write the options one per line, or choose the driver list as the source.' },
  { value: 'yesno',  label: 'Yes / No / Other',   hint: 'Three buttons. A comment is required on "Other" and can be given on "No".' },
  { value: 'photo',  label: 'Photo',              hint: 'Opens the camera. Several pictures allowed.' },
  { value: 'info',   label: 'Information text',   hint: 'Only text for the driver, no answer.' }
];

/** Where a dropdown's options come from. */
const SOURCES = [
  { value: '',        label: 'Own options' },
  { value: 'drivers', label: 'The driver list (synced from Route Suite)' },
  { value: 'routes',  label: "Today's routes (from the assignment)" }
];

const KIND_VALUES = KINDS.map(k => k.value);
const KIND_LABEL = Object.fromEntries(KINDS.map(k => [k.value, k.label]));

const CHOICES = [
  { value: 'ja',    label: 'Ja' },
  { value: 'nej',   label: 'Nej' },
  { value: 'annat', label: 'Annat' }
];
const CHOICE_LABEL = Object.fromEntries(CHOICES.map(c => [c.value, c.label]));
/* The same three words for the admin side. The stored values and the
   driver's receipt stay Swedish; see formatAnswer's `lang`. */
const CHOICE_LABEL_EN = { ja: 'Yes', nej: 'No', annat: 'Other' };

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

/**
 * The follow-up list for a question, if it has one.
 *
 * A yesno question may carry a list of things that could be wrong ("which
 * lamp?"). The driver picks one and may still type a detail beside it; the
 * VALUE stored is always the Swedish one from this list, whatever language
 * they read it in.
 */
function commentOptionsFor(field) {
  const list = (field && (field.comment_options || field.commentOptions)) || [];
  return Array.isArray(list) ? list.filter(Boolean).map(String) : [];
}

/**
 * What a question *is*, as opposed to what it asks.
 *
 * `damage` is what the incident ledger looks for. It is a role rather than a
 * list of question names because a form can be copied and its wording edited,
 * and an incident page that found damage reports by matching a Swedish
 * sentence would quietly stop finding them the first time somebody rephrased
 * the question.
 */
const ROLES = [
  { value: '',         label: '—' },
  { value: 'driver',   label: "Driver's name" },
  { value: 'route',    label: 'Route' },
  { value: 'odometer', label: 'Odometer' },
  { value: 'damage',   label: 'Damage (shown on Incidents)' }
];

/** Answers as posted -> the shape stored in the answers JSONB column. */
function readAnswer(field, body) {
  if (field.kind === 'text' || field.kind === 'select') {
    return String(body[field.name] ?? '').trim().slice(0, 2000);
  }
  if (field.kind === 'yesno') {
    const choice = String(body[field.name] ?? '').trim().toLowerCase();
    const comment = String(body[field.name + '__comment'] ?? '').trim().slice(0, 2000);
    const opens = commentChoices(field).has(choice);
    // The picked item is kept as its own value rather than glued into the
    // comment: the workshop can then count "how many brake lights this month"
    // without parsing free text, and the comment stays what the driver wrote.
    const options = commentOptionsFor(field);
    const raw = String(body[field.name + '__pick'] ?? '').trim();
    const pick = opens && options.includes(raw) ? raw : '';
    if (!choice && !comment && !pick) return null;
    const value = {
      choice: CHOICE_LABEL[choice] ? choice : '',
      comment: opens ? comment : ''
    };
    if (pick) value.pick = pick;
    return value;
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
    // A question that offers a list wants one picked when the answer flags:
    // "something is wrong" without saying what is the answer that costs the
    // workshop a phone call.
    if (commentOptionsFor(field).length && commentChoices(field).has(choice) &&
        !String((value && value.pick) || '').trim()) return 'chooseError';
    if (choice === 'annat' && !String(value.comment || '').trim()) return 'commentRequired';
    return null;
  }
  return null;
}

/**
 * What a picked follow-up item is CALLED, from the code that was stored.
 *
 * Most lists store their own Swedish wording, so the value is already the
 * name and comes back untouched. The dashboard-lights list is the exception:
 * it stores a language-free code ("brakeAssistOff"), because the same lamp
 * has four names and a stored value cannot be reworded. Without this, every
 * reader except the receipt printed the raw code — the daily mail to the
 * workshop, the admin check detail, the CSV export, the extension's day view
 * and the description copied into an incident all said "Ja: brakeAssistOff".
 *
 * The question's own snapshot is asked first, so a check filed last month
 * reads back in the words that were on the form that day; telltales is the
 * fallback for a snapshot that predates the translations, and the raw value
 * is the last resort — never an empty cell.
 */
function pickName(field, pick, lang = 'sv') {
  const value = String(pick || '').trim();
  if (!value) return '';
  const list = (field && (field.comment_options || field.commentOptions)) || [];
  const i = list.indexOf(value);
  if (i >= 0) {
    const blob = (field.i18n || {})[lang] || {};
    const translated = (blob.commentOptions || [])[i];
    if (translated && String(translated).trim()) return String(translated).trim();
  }
  const lamp = telltales.LAMPS[value];
  if (lamp) return lamp[lang] || lamp.sv;
  return value;
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
function formatAnswer(field, value, lang = 'sv') {
  if (value === null || value === undefined) return '—';

  if (typeof value === 'string') return value.trim() || '—';

  if (typeof value === 'object') {
    // "Nej: Halvljus – höger fram": the picked item first, then whatever the
    // driver added. Old answers have no pick and read exactly as before.
    const detail = [pickName(field, value.pick, lang), String(value.comment || '').trim()]
      .filter(Boolean).join(' – ');
    if (!value.choice) return detail || '—';
    const label = (lang === 'en' ? CHOICE_LABEL_EN : CHOICE_LABEL)[value.choice] || value.choice;
    return detail ? `${label}: ${detail}` : label;
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

/**
 * Options a dropdown offers: a live source, or its own list.
 *
 * A live source that comes back empty falls back to the question's own
 * options rather than leaving the driver with nothing to pick. That matters
 * for the route list: it is built from the assignments, and the morning the
 * assigner has not run yet it would otherwise be empty on a required
 * question, which is a form nobody can submit.
 */
function optionsFor(field, sources) {
  const own = Array.isArray(field.options) ? field.options : [];
  if (field.source) {
    const live = sources && sources[field.source];
    return (Array.isArray(live) && live.length) ? live : own;
  }
  return own;
}

module.exports = {
  KINDS, KIND_VALUES, KIND_LABEL, SOURCES, CHOICES, CHOICE_LABEL, CHOICE_LABEL_EN, COMMENT_CHOICES, commentChoices,
  ROLES, readAnswer, answerProblem, formatAnswer, pickName, isAnswerable, isAlerting, optionsFor,
  commentOptionsFor
};
