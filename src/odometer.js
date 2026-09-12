'use strict';

/**
 * The odometer reading, and how much of it the form can fill in.
 *
 * A driver standing at the van copies six digits off a dashboard into a phone,
 * in the dark, with gloves on. Nearly all of those digits are the same as
 * yesterday's — the van did 180 km, not 180 000 — so the form offers everything
 * except the last three and the driver types the rest.
 *
 * The one case where that is wrong is a reading about to roll over: 207 953
 * offered as "207" would be typed as 207 9xx by somebody who did not look, and
 * a van that passed 208 000 during the day cannot report it. So when the
 * hundreds digit is a 9, one digit fewer is offered — "20" — and the driver
 * fills in four.
 */

/** Just the digits, so "207 953 km" and "207953" are the same reading. */
function digitsOf(v) {
  return String(v == null ? '' : v).replace(/\D+/g, '');
}

/**
 * What to put in the field, given the last reading.
 *
 * Returns { prefix, blanks, last } — `prefix` is what the form shows, `blanks`
 * how many digits the driver adds, `last` the previous reading in digits.
 * A reading too short to be a kilometre count (fewer than five digits: an
 * old Swedish-mil entry, or a typo) offers nothing: a wrong prefix is worse
 * than an empty field, because it is copied without being read.
 */
function prefill(lastReading) {
  const last = digitsOf(lastReading);
  if (last.length < 5) return { prefix: '', blanks: 0, last };

  const hundreds = last[last.length - 3];
  // 9 hundreds means the next 1 000 is within reach of one day's driving.
  const cut = hundreds === '9' ? 4 : 3;
  const prefix = last.slice(0, last.length - cut);
  if (!prefix) return { prefix: '', blanks: 0, last };
  return { prefix, blanks: last.length - prefix.length, last };
}

/** 207953 -> "207 953", which is how a dashboard groups it. */
function group(v) {
  const d = digitsOf(v);
  return d ? d.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '';
}

module.exports = { digitsOf, prefill, group };
