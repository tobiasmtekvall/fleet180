'use strict';

/* Driver-name masking for the pages a driver sees.
 *
 * THE RULE: the first name is kept whole, every part after it is reduced to
 * its own first character and four stars.
 *
 *   Simon Bergman            ->  Simon B****
 *   Deepesh Madathiparambil  ->  Deepesh M****
 *   Anne-Marie Öberg         ->  Anne-Marie Ö****
 *   Ali Ben Hassan           ->  Ali B**** H****
 *
 * The star count is FIXED at four and deliberately does not follow the
 * surname's length: "Bo" and "Bergman" have to look alike, or the length is
 * one more thing to guess from. This differs from the extension's
 * lib/mask.js (G****e A******n), which preserves length on purpose so a
 * colleague can still read the roster; here the first name already does that
 * job, so the surname gives nothing away.
 *
 * WHERE IT IS APPLIED: everywhere Fleet 180 draws a driver's name for a
 * person to read (since 2026-10-01; before that only the driver-facing form
 * and receipt) -- the form, the receipt, the vehicle list, every /admin page
 * including the form preview, Box routes and License control, and the daily
 * mail with its preview. What stays whole: the API (/api/*, which feeds the
 * extension), the CSV downloads, and every form VALUE that is posted back or
 * compared. Nothing masked is ever stored: the mask happens at the moment a
 * page is drawn, and the database keeps the name the driver picked. The one
 * editable name box (an incident's driver) is drawn masked and the server
 * treats the masked text posted back as "unchanged".
 *
 * THIS IS A CURTAIN, NOT A LOCK -- the same caveat the standings board
 * carries. The driver dropdown has to post a name the server can resolve, so
 * the <option> values on the form are still the real names and anyone who
 * reads the page source can pair them up. What the mask removes is the
 * surname from everything a person *reads*: the assignment line, the week's
 * driver list, the change question and the receipt. Making it proof against
 * someone reading the HTML needs the form behind a login or a driver PIN.
 */

const STARS = '****';

/** One name part: its first character, then four stars. */
function maskPart(part) {
  // Array.from, not split(''): a surrogate pair must not be cut in half.
  // (maskName has already composed the name -- see the NFC note there.)
  const chars = Array.from(part);
  if (!chars.length) return part;
  return chars[0] + STARS;
}

/**
 * A full name, masked. Anything that is not a name -- '', null, a dash the
 * page uses for "nobody" -- comes back unchanged apart from trimming, so a
 * caller can hand this whatever it has.
 */
function maskName(name) {
  /* "Bergman, Simon" is the other way round, and masking the first word there
     would hide the first name and print the surname whole -- the opposite of
     the job. /api/drivers takes whatever the suite pushes at it and does not
     insist on a format, so this is worth two lines. */
  /* NFC once, for the whole name: typed on a Mac it can arrive decomposed,
     where "Öberg" is O + U+0308 -- and the initial of a decomposed name is a
     bare "O" with its dots thrown away. */
  const raw = String(name === null || name === undefined ? '' : name)
    .normalize('NFC').trim();
  const comma = raw.indexOf(',');
  const ordered = comma > 0
    ? `${raw.slice(comma + 1).trim()} ${raw.slice(0, comma).trim()}`.trim()
    : raw;
  const parts = ordered.split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];  // a first name alone has nothing to mask
  return [parts[0]].concat(parts.slice(1).map(maskPart)).join(' ');
}

/** A list of names, each masked on its own -- never the joined string. */
function maskNames(names) {
  return (Array.isArray(names) ? names : []).map(maskName);
}

module.exports = { maskName, maskNames, STARS };
