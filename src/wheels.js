'use strict';
/**
 * Tyres: what a tread depth means, and where it is heading.
 *
 * Its own file, and pure -- no database, no HTML -- because these are the
 * judgements the Wheels page exists to make, and a judgement about whether a
 * van is legal to drive should be somewhere a test can call directly.
 *
 * The bands are Tobias's, not the law's. For reference the Swedish legal
 * minimum is 1.6 mm on summer tyres and 3.0 mm on winter tyres in winter
 * conditions, so "change now" below 3 mm is the stricter line on both, which
 * is the point: a fleet that changes at the legal minimum is a fleet with
 * illegal vans in it by the end of the month.
 */

/**
 * The four bands, worst first. `from` is inclusive, so a tyre measured at
 * exactly 3.0 is "about two months" rather than "change now" -- 3.0 is the
 * winter minimum, which a tyre AT 3.0 still meets.
 */
const BANDS = [
  { key: 'critical', from: 0, to: 3, label: 'Change now',
    hint: 'Under 3 mm. Below the winter minimum, and not far off the summer one.' },
  { key: 'soon', from: 3, to: 5, label: 'About two months',
    hint: '3-5 mm. Still legal, but order the next set now rather than in a hurry.' },
  { key: 'ok', from: 5, to: 8, label: 'OK', hint: '5-8 mm. Nothing to do.' },
  { key: 'new', from: 8, to: Infinity, label: 'As new', hint: '8 mm or more.' }
];

/** The deepest a reading may be. Above this somebody typed the tyre width. */
const MAX_MM = 20;

/** The band a depth falls in. Null, undefined or rubbish -> "not measured". */
function bandOf(mm) {
  /* Number('  ') and Number([]) are both 0, which would land blank input and
     an array in the 0-3 band and paint a tyre red that nobody has measured.
     So the emptiness test is on the trimmed STRING, and booleans -- which
     also coerce to numbers -- are refused outright. */
  const v = Number(mm);
  if (mm === null || mm === undefined || typeof mm === 'boolean' ||
      String(mm).trim() === '' || !Number.isFinite(v) || v < 0) {
    return { key: 'unknown', label: 'Not measured', from: null, to: null,
      hint: 'Nobody has put a gauge on this one yet.' };
  }
  return BANDS.find(b => v >= b.from && v < b.to) || BANDS[BANDS.length - 1];
}

/** 4.5 -> "4,5". Swedish decimal comma, and no trailing ",0". */
function mm(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '').replace('.', ',');
}

/**
 * A Date to 2026-07-25, read in UTC.
 *
 * UTC and not local, because everything that hands a Date to this built it
 * from Date.parse('2026-09-01'), which is UTC midnight. Reading it back with
 * the local getters puts the answer a day early on any host west of
 * Greenwich -- the app runs in Stockholm, but a forecast that depends on
 * where the server happens to be is a forecast with a bug waiting in it.
 * (The one "today" this file never invents is the actual today: the routes
 * pass in summaryLib.dayKey(), which is pinned to Europe/Stockholm.)
 */
function dayKey(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * How fast this tyre is wearing, and when it reaches 3 mm.
 *
 * Two readings far enough apart are enough for a straight line, which is all
 * anybody wants from this: not a prediction, an answer to "do I order tyres
 * this month or next". Readings closer than 21 days apart are not used as the
 * span -- a gauge is good to about 0.1 mm, and over a fortnight that is most
 * of the real wear, so the "rate" would be measurement noise with a date on
 * it. Wear that is flat or negative (a new set fitted, or a re-measure that
 * read higher) gets no forecast at all rather than a nonsense one.
 *
 * `readings` are {depth_mm, measured_on} in any order. Returns null when
 * there is nothing honest to say.
 */
function wearOf(readings, today) {
  const rows = (readings || [])
    .filter(r => r && r.measured_on && r.depth_mm !== null && r.depth_mm !== undefined)
    .map(r => ({ on: asDay(r.measured_on), mm: Number(r.depth_mm) }))
    .filter(r => Number.isFinite(r.mm) && /^\d{4}-\d{2}-\d{2}$/.test(r.on))
    .sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  if (rows.length < 2) return null;

  const last = rows[rows.length - 1];
  // The most recent reading at least three weeks before the last one.
  const first = [...rows].reverse().find(r =>
    (Date.parse(last.on) - Date.parse(r.on)) / 86400000 >= 21);
  if (!first) return null;

  const days = (Date.parse(last.on) - Date.parse(first.on)) / 86400000;
  const lost = first.mm - last.mm;
  if (!(days > 0) || lost <= 0) return null;

  const perMonth = (lost / days) * 30;
  const toGo = last.mm - 3;
  if (toGo <= 0) return { perMonth, reaches3: null, months: 0, from: first, to: last };

  const daysLeft = (toGo / lost) * days;
  // Past a year the straight line is fiction; say "over a year" instead.
  if (daysLeft > 365) return { perMonth, reaches3: null, months: null, over: true, from: first, to: last };

  const when = new Date(Date.parse(last.on) + daysLeft * 86400000);
  /* Days from TODAY, which is what somebody ordering tyres counts -- and it
     can be NEGATIVE, when the last reading is old enough that the line has
     already crossed 3 mm since. That is not a rounding detail to clamp away:
     it is the page's one chance to say that what it is showing is out of
     date, on the tyre where it matters. */
  const daysFromToday = today
    ? Math.round((Date.parse(dayKey(when)) - Date.parse(today)) / 86400000) : null;
  return {
    perMonth,
    reaches3: dayKey(when),
    months: daysLeft / 30,
    daysFromToday,
    passed: daysFromToday !== null && daysFromToday < 0,
    from: first,
    to: last
  };
}

/** The worst band among some tyres, for a vehicle's line or a whole fleet. */
function worstOf(depths) {
  const order = ['critical', 'soon', 'ok', 'new', 'unknown'];
  let worst = 'unknown';
  for (const d of depths) {
    const k = bandOf(d).key;
    if (k === 'unknown') continue;
    if (worst === 'unknown' || order.indexOf(k) < order.indexOf(worst)) worst = k;
  }
  return worst;
}

/**
 * A date as 2026-04-02, whatever it arrives as.
 *
 * node-postgres hands a DATE column back as a JS Date, and String(that) is
 * "Thu Apr 02 2026 ..." -- so slicing ten characters off it, which is right
 * for a string, silently prints "Thu Apr 02" instead. Everything that shows a
 * date on this page goes through here.
 */
function asDay(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : dayKey(d);
}

/** How stale a reading is: a measurement older than this needs redoing. */
const STALE_DAYS = 90;

/** Days between two YYYY-MM-DD days, or null if either is not one. */
function daysBetween(from, to) {
  const a = Date.parse(asDay(from)), b = Date.parse(asDay(to));
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : null;
}

/**
 * Is this reading old enough that the tile is no longer telling the truth?
 *
 * A tread depth is a measurement, not a property: 6 mm last March is not 6 mm
 * now. Everything on the page -- the colour, the row, the fleet tally -- is
 * built on the latest reading, so the page has to say out loud when the
 * latest reading is not recent.
 */
function isStale(measuredOn, today) {
  const d = daysBetween(measuredOn, today);
  return d !== null && d > STALE_DAYS;
}

module.exports = { BANDS, MAX_MM, STALE_DAYS, bandOf, wearOf, worstOf, mm, dayKey, asDay,
  daysBetween, isStale };
