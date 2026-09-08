'use strict';

/**
 * How well each driver keeps up with their vehicle checks.
 *
 * Two questions, answered separately because they fail differently:
 *
 *   Did they file the check they owed?   -> completion, from assignments
 *   Did they fill it in properly?        -> care, from what they wrote
 *
 * A driver who never files is invisible in the second measure, which is why
 * completion carries most of the weight. Everything here is computed from
 * rows the app already has; nothing is inferred about a person beyond what
 * they typed into a form.
 *
 * Honesty rules baked in:
 *  - a rate over two or three assignments is noise, so anyone under
 *    MIN_ASSIGNMENTS is reported but not ranked;
 *  - "care" is only scored where there was something to be careful about --
 *    a driver whose vehicles were all fine has nothing to measure, and gets
 *    no score rather than a flattering or punishing one;
 *  - extra checks (filed with no assignment) never count against anyone.
 */

const { isAnswerable, isAlerting, COMMENT_CHOICES } = require('./fields');

/** Below this many owed checks, a percentage says more about luck than habit. */
const MIN_ASSIGNMENTS = 5;

/** Words in a comment beyond which more words stop meaning more care. */
const DETAIL_SATURATION = 8;

const WEIGHT_COMPLETION = 0.7;
const WEIGHT_CARE = 0.3;

function normName(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function words(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).length;
}

function median(xs) {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * What one submission tells us about care.
 *
 * `chances` counts the moments where care was possible -- an answer that
 * flags a problem, or a photo question following a reported problem. If a
 * check has no chances, it is not evidence either way.
 */
function careOf(submission, fallback) {
  const questions = (submission.questions && submission.questions.length
    ? submission.questions : fallback);
  const answers = submission.answers || {};

  let chances = 0, taken = 0;
  const commentLengths = [];
  let flagged = 0;

  for (const q of questions) {
    if (!isAnswerable(q)) continue;
    const value = answers[q.name];
    if (!isAlerting(q, value)) continue;
    flagged++;

    // Something is wrong here: did they say what?
    const choice = value && typeof value === 'object' ? value.choice : '';
    const comment = value && typeof value === 'object' ? String(value.comment || '').trim()
      : typeof value === 'string' ? String(value).trim() : '';
    const commentOffered = !choice || COMMENT_CHOICES.has(choice);
    if (!commentOffered) continue;

    chances++;
    if (comment && words(comment) >= 2) {
      taken++;
      commentLengths.push(words(comment));
    }
  }

  // A photo when damage or a warning light was reported is the other half of
  // "did you tell us what you saw".
  const photos = submission.photo_count || 0;
  if (flagged > 0) {
    chances++;
    if (photos > 0) taken++;
  }

  return { chances, taken, commentLengths, flagged, photos };
}

function ratio(a, b) { return b > 0 ? a / b : null; }

/**
 * Build the whole table.
 *
 * `assignments` and `submissions` cover the same span. Matching is on the
 * driver's name and the day: the vehicle can legitimately differ from the
 * one assigned (vans get swapped in the yard), and punishing that would
 * measure the yard, not the driver.
 */
function buildDriverStats({ assignments, submissions, fallback = [], drivers = [] }) {
  const rows = new Map();

  const row = name => {
    const key = normName(name);
    if (!rows.has(key)) {
      rows.set(key, {
        name, key,
        expected: 0, done: 0, extra: 0,
        assignedDays: new Set(), checkedDays: new Set(),
        plates: new Set(),
        chances: 0, taken: 0, commentLengths: [], flags: 0, photos: 0,
        lastCheck: null, firstAssigned: null, lastAssigned: null
      });
    }
    return rows.get(key);
  };

  // Expected: one per (day, vehicle) the assigner handed out.
  const owed = new Map();                 // "name|date" -> count
  for (const a of assignments) {
    const r = row(a.driver);
    r.expected++;
    r.assignedDays.add(a.date);
    r.plates.add(a.plate);
    if (!r.firstAssigned || a.date < r.firstAssigned) r.firstAssigned = a.date;
    if (!r.lastAssigned || a.date > r.lastAssigned) r.lastAssigned = a.date;
    const k = `${r.key}|${a.date}`;
    owed.set(k, (owed.get(k) || 0) + 1);
  }

  // Done: a check filed by that driver on a day they were owed one.
  const credited = new Map();
  for (const s of submissions) {
    if (!s.driver_name) continue;
    const r = row(s.driver_name);
    const date = s.day;
    r.checkedDays.add(date);
    if (!r.lastCheck || s.submitted_at > r.lastCheck) r.lastCheck = s.submitted_at;

    const k = `${r.key}|${date}`;
    const owedHere = owed.get(k) || 0;
    const already = credited.get(k) || 0;
    if (already < owedHere) { r.done++; credited.set(k, already + 1); }
    else r.extra++;

    const care = careOf(s, fallback);
    r.chances += care.chances;
    r.taken += care.taken;
    r.commentLengths.push(...care.commentLengths);
    r.flags += care.flagged;
    r.photos += care.photos;
  }

  // Drivers on the roster who neither were assigned nor filed anything are
  // left out entirely: nothing is known about them, and a zero would be a
  // claim, not a measurement.
  const out = [];
  for (const r of rows.values()) {
    const completion = ratio(r.done, r.expected);

    const commentRate = ratio(r.taken, r.chances);
    const depth = r.commentLengths.length
      ? Math.min(1, median(r.commentLengths) / DETAIL_SATURATION) : null;
    const care = commentRate === null ? null
      : depth === null ? commentRate
      : 0.6 * commentRate + 0.4 * depth;

    const ranked = r.expected >= MIN_ASSIGNMENTS && completion !== null;
    const score = !ranked ? null
      : care === null ? completion
      : WEIGHT_COMPLETION * completion + WEIGHT_CARE * care;

    out.push({
      name: r.name,
      expected: r.expected,
      done: r.done,
      missed: Math.max(0, r.expected - r.done),
      extra: r.extra,
      completion,
      care,
      careBasis: r.chances,
      commentRate,
      medianWords: r.commentLengths.length ? median(r.commentLengths) : null,
      flags: r.flags,
      photos: r.photos,
      checks: r.checkedDays.size,
      vehicles: [...r.plates].sort(),
      lastCheck: r.lastCheck,
      firstAssigned: r.firstAssigned,
      lastAssigned: r.lastAssigned,
      ranked,
      score,
      // Said plainly on the page rather than hidden in a tooltip.
      note: !r.expected ? 'inga tilldelningar i perioden'
        : !ranked ? `bara ${r.expected} ${r.expected === 1 ? 'tilldelning' : 'tilldelningar'} – för lite underlag`
        : care === null ? 'inget att rapportera, omsorg går inte att mäta'
        : ''
    });
  }

  out.sort((a, b) => {
    if (a.ranked !== b.ranked) return a.ranked ? -1 : 1;
    if (a.ranked) return (b.score - a.score) || (b.expected - a.expected);
    return (b.expected - a.expected) || a.name.localeCompare(b.name, 'sv');
  });

  const rankedRows = out.filter(r => r.ranked);
  const totals = {
    drivers: out.length,
    ranked: rankedRows.length,
    expected: out.reduce((n, r) => n + r.expected, 0),
    done: out.reduce((n, r) => n + r.done, 0),
    extra: out.reduce((n, r) => n + r.extra, 0),
    flags: out.reduce((n, r) => n + r.flags, 0)
  };
  totals.completion = ratio(totals.done, totals.expected);

  return { rows: out, totals, minAssignments: MIN_ASSIGNMENTS };
}

module.exports = { buildDriverStats, careOf, normName, MIN_ASSIGNMENTS };
