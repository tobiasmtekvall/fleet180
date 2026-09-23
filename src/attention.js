'use strict';

/**
 * What still needs doing to the vans.
 *
 * The daily email (src/summary.js) answers "what happened today". This
 * answers a different question, and the difference is the whole point of the
 * file: a broken tail light reported on Monday is still broken on Tuesday,
 * but Tuesday's email says nothing about it unless a driver happens to report
 * it again -- and the next driver in that van is a different person who does
 * not know it was already said. Everything a driver flags therefore has to
 * survive the day it was flagged on, per vehicle, until somebody says it is
 * done.
 *
 * Pure: no database and no HTML. It is handed the rows and returns the
 * picture, so the page, the CSV and a test can all ask the same question and
 * get the same answer -- one calculation, three readers, the same rule the
 * summary module follows.
 *
 * ## An item is not a report
 *
 * A REPORT (a "sighting" below) is one driver saying one thing on one
 * morning. An ITEM is the fault itself, and it is what the page lists: the
 * same broken light reported by three drivers on three days is one item with
 * three sightings, open since the first of them. Which means an item needs an
 * identity that survives being reported again, by somebody else, in another
 * language, on a form whose wording has since been edited:
 *
 *     check|RJC29S|f8|Halvljus - höger fram
 *     ^      ^      ^   ^
 *     kind   van    the question's NAME, never its label -- a label can be
 *                   rephrased in the form editor and a key built from it
 *                   would silently split one fault into two
 *                       the picked follow-up item, so "right headlight" and
 *                       "left brake light" are two faults on one question
 *                       and are fixed, and ticked off, separately
 *
 * The comment a driver types is deliberately NOT in the key. Two people
 * describing the same dent in their own words must land on one item; what
 * they wrote is kept on the sightings and shown under it.
 *
 * ## Nothing closes itself
 *
 * An item is open until somebody clears it by name (see attention_clears in
 * db.js). A clear covers the sightings up to the one that was on the page
 * when the button was pressed -- not "up to now" -- so a check that arrives
 * while the page is open is not swallowed by a click that never saw it. A
 * later sighting therefore reopens the item by itself, which is the behaviour
 * that matters: "fixed" that did not fix it comes back.
 *
 * The one thing deliberately NOT done here is closing an item because a later
 * check answered the same question with a Yes. A driver ticking "lights work"
 * without walking round the van would then quietly erase a real fault, and
 * the whole reason this file exists is that faults were getting lost.
 */

const { isAnswerable, isAlerting, formatAnswer, pickName } = require('./fields');
const { dayKey, clockTime } = require('./summary');
const { shiftDay } = require('./assignment');
const wheels = require('./wheels');

/**
 * How far back the sightings are read.
 *
 * Long enough that a fault nobody has touched for a season is still on the
 * list, short enough that the page is one query over a few thousand rows.
 * Stated on the page, because an item whose last sighting falls off the back
 * of this window disappears, and a list that drops things without saying so
 * is worse than no list.
 */
const WINDOW_DAYS = 90;

/** How long a cleared item stays visible under "Done". */
const DONE_DAYS = 30;

/**
 * The four levels, worst first.
 *
 * `info` is not a level of urgency but a level of ownership: a van at the
 * body shop is on the report because you want to know it is off the road,
 * not because anybody should act on this page. It sorts last and is counted
 * separately from "needs action".
 */
const SEVERITY = ['high', 'normal', 'low', 'info'];
const RANK = Object.fromEntries(SEVERITY.map((s, i) => [s, i]));

const SEVERITY_LABEL = {
  high: 'Act now',
  normal: 'Needs action',
  low: 'When there is time',
  info: 'For information'
};

/** What an item IS, which decides how it is drawn and where it is fixed. */
const KIND_LABEL = {
  lamp: 'Warning light',
  damage: 'Damage',
  check: 'Reported on a check',
  tyre: 'Tyres',
  tyredue: 'Tread not measured',
  shop: 'At the workshop'
};

/* ------------------------------------------------------------------ *
 * Small helpers                                                       *
 * ------------------------------------------------------------------ */

/** Anything time-shaped as milliseconds, or null. Never NaN. */
function ms(v) {
  if (v === null || v === undefined || v === '') return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * A YYYY-MM-DD day as the instant the day STARTS, in UTC.
 *
 * Used to stamp the sightings that are facts about a day rather than about a
 * moment -- a van that went out unchecked on the 14th, a tread depth measured
 * on the 3rd. The start and not the end of the day on purpose: a clear
 * pressed on the same day the fault is dated must cover it, and stamping the
 * sighting at midnight is the only reading that makes "cleared it this
 * afternoon" mean what everybody assumes it means.
 */
function dayStart(day) {
  const t = Date.parse(String(day || '').slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(t) ? t : null;
}

/** A key part that cannot break the key apart or run away with the line. */
function part(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/\|/g, '/').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function keyOf(...parts) {
  return parts.map(part).join('|');
}

/** Whole days between two YYYY-MM-DD days. */
function daysBetween(from, to) {
  const a = dayStart(from), b = dayStart(to);
  return a === null || b === null ? null : Math.round((b - a) / 86400000);
}

/** "3 days", "1 day", "today". */
function ageText(days) {
  if (days === null || days === undefined) return '';
  if (days <= 0) return 'today';
  return days === 1 ? '1 day' : `${days} days`;
}

/* ------------------------------------------------------------------ *
 * Roles a snapshot may not carry                                      *
 * ------------------------------------------------------------------ */

/**
 * Which questions are damage questions, and which one asks about the
 * dashboard lights, read off the form as it stands TODAY.
 *
 * Every check filed before a column existed carries a snapshot with that
 * column empty -- `role` was added on 2026-09-14, `comment_source` on
 * 2026-09-13 -- and those checks are exactly the history this page opens on.
 * So the snapshot is asked first and today's form of the same question name
 * is the fallback, which is the same rule the Incidents page follows for
 * damage (isDamageQuestion in server.js). Keep both halves.
 */
function formTraits(fallback = []) {
  const damage = new Set();
  const lights = new Set();
  for (const f of fallback) {
    if (f.role === 'damage') damage.add(f.name);
    if ((f.comment_source || f.commentSource) === 'lights') lights.add(f.name);
  }
  return { damage, lights };
}

/* ------------------------------------------------------------------ *
 * Sightings out of the checks                                         *
 * ------------------------------------------------------------------ */

/**
 * Every flagged answer in the window, as one row apiece.
 *
 * `fallback` supplies both the questions for checks saved before the form
 * editor existed and the alert polarity for checks saved before the snapshot
 * carried it -- without the second half a check from August reads as clean,
 * which is the dangerous direction to be wrong in. The summary module does
 * the same thing for the same reason.
 */
function sightingsFromChecks(submissions, fallback, lang) {
  const { damage, lights } = formTraits(fallback);
  const rules = new Map(fallback.map(f => [f.name, f.alert_on || f.alertOn || []]));
  const withRule = q => (Array.isArray(q.alert_on) && q.alert_on.length)
    ? q : { ...q, alert_on: rules.get(q.name) || [] };

  /* Prepared once per distinct form, not once per check.
   *
   * checksForAttention hands every check filed against the same form the SAME
   * questions array (it deduplicates them by hash), so the array itself is
   * the cache key. Without this, three months of checks meant copying twenty
   * questions -- each carrying its follow-up list and four translations --
   * forty thousand times, which was most of a second of the page's life.
   */
  const prepared = new Map();
  const questionsFor = (snapshot) => {
    const source = snapshot && snapshot.length ? snapshot : fallback;
    if (!prepared.has(source)) prepared.set(source, source.map(withRule));
    return prepared.get(source);
  };

  const out = [];
  for (const s of submissions) {
    const questions = questionsFor(s.questions);
    const answers = s.answers || {};
    for (const q of questions) {
      if (!isAnswerable(q)) continue;
      const value = answers[q.name];
      if (!isAlerting(q, value)) continue;

      const pick = (value && typeof value === 'object' && value.pick) ? String(value.pick) : '';
      const isLamp = (q.comment_source || q.commentSource) === 'lights' || lights.has(q.name);
      const isDamage = q.role === 'damage' || damage.has(q.name);
      const label = (lang !== 'sv' && q.i18n && q.i18n[lang] && q.i18n[lang].label) || q.label;

      out.push({
        key: keyOf('check', s.plate, q.name, pick),
        kind: isLamp ? 'lamp' : isDamage ? 'damage' : 'check',
        plate: s.plate,
        field: q.name,
        pick,
        question: label,
        /* What the picked item is CALLED. Taken from pickName rather than
           sliced back out of the formatted answer: a lamp is stored as a code
           ("absFault") and several of the lists' own entries contain the same
           dash formatAnswer joins with, so any attempt to parse the sentence
           back apart loses exactly the half that distinguishes one item on a
           question from another. */
        pickLabel: pick ? pickName(q, pick, lang) : '',
        // The whole answer as a reader sees it: "No: Dipped beam - right
        // front - the bulb rattles". The pick is in the key, the comment is
        // not, so this is where what the driver actually wrote is kept.
        answer: formatAnswer(q, value, lang),
        comment: (value && typeof value === 'object' && value.comment) ? String(value.comment) : '',
        driver: s.driver_name || '',
        at: s.submitted_at,
        day: dayKey(s.submitted_at),
        time: clockTime(s.submitted_at),
        submissionId: String(s.id),
        photos: s.photo_count || 0
      });
    }
  }
  return out;
}

/**
 * The title an item carries: the question, and what was picked under it.
 *
 * Built from the LATEST sighting rather than the first, so a question that
 * has been rephrased reads as it reads now. The picked item is appended
 * because it is what separates this item from its siblings -- three open
 * items all called "Is the lighting in order?" would be unreadable.
 */
function titleOf(latest) {
  const tail = String(latest.pickLabel || '').trim();
  return tail ? `${latest.question} — ${tail}` : latest.question;
}

/* ------------------------------------------------------------------ *
 * The other sources                                                   *
 * ------------------------------------------------------------------ */

/**
 * When each van was last checked at all.
 *
 * This is the panel down the right-hand side, and it replaced what used to be
 * a "driven without a safety check" ITEM per van (2026-09-23, on Tobias's
 * instruction). The item was the wrong shape for the question: a van that
 * missed a check on three days does not need three lines and a Done button,
 * it needs one number that somebody can look at -- how long since anybody
 * walked round this van. An item you tick off says "dealt with"; a date says
 * what is true.
 *
 * Every van in the fleet is listed, including the ones checked this morning,
 * because the panel is a fleet at a glance rather than a list of problems.
 * A van never checked at all is not given a day count of zero -- it is said
 * out loud, and sorts to the top with the worst of them.
 */
function lastCheckPanel({ vehicles, latest, assignments, today }) {
  const out = [];
  const outToday = new Set(
    (assignments || [])
      .filter(a => String(a.date).slice(0, 10) === today)
      .map(a => a.plate));

  for (const v of vehicles) {
    const row = latest instanceof Map ? latest.get(v.plate) : (latest || {})[v.plate];
    const day = row && row.submitted_at ? dayKey(row.submitted_at) : '';
    const ageDays = day ? daysBetween(day, today) : null;
    out.push({
      plate: v.plate,
      owner: v.owner || '',
      fleet: v.fleet || '',
      day,
      driver: (row && row.driver_name) || '',
      ageDays,
      never: !day,
      age: day ? ageText(ageDays) : 'never checked',
      outToday: outToday.has(v.plate),
      band: staleBand(ageDays, !day)
    });
  }

  /* Worst first, like everything else on this page: the van nobody has
     touched for a fortnight is the reason the panel exists, and a fleet
     sorted by registration hides it in the middle. */
  out.sort((a, b) =>
    (b.never ? 1 : 0) - (a.never ? 1 : 0) ||
    (b.ageDays || 0) - (a.ageDays || 0) ||
    a.plate.localeCompare(b.plate));
  return out;
}

/**
 * How old a last check is allowed to get before it is worth looking at.
 *
 * Deliberately generous at the short end: vans do not go out every day, and
 * a panel that turns amber every Monday morning because nothing ran at the
 * weekend is a panel people stop reading. Four days covers a normal weekend
 * plus a day; ten is long enough that the van has almost certainly been out
 * unchecked.
 */
function staleBand(ageDays, never) {
  if (never) return 'never';
  if (ageDays === null || ageDays === undefined) return 'never';
  if (ageDays >= 10) return 'old';
  if (ageDays >= 4) return 'ageing';
  return 'fresh';
}

/**
 * Vans that are at the body shop, or on a case nobody has closed.
 *
 * Information rather than an action: the case lives on Expenses and closes
 * when somebody types the day it came out, so a Fixed button here would be a
 * second place to say the same thing and the two would disagree within a
 * week. The item carries the case number and a link instead.
 */
function shopItems({ incidents, today, plates }) {
  const items = [];
  for (const inc of incidents || []) {
    if (inc.scope && inc.scope !== 'vehicle') continue;
    if (inc.category && inc.category !== 'damage') continue;
    if (!inc.shop_in || inc.shop_out) continue;
    if (!plates.has(inc.plate)) continue;
    const days = daysBetween(inc.shop_in, today);
    items.push({
      key: keyOf('shop', inc.id),
      kind: 'shop',
      plate: inc.plate,
      title: 'Off the road — at the workshop',
      severity: 'info',
      incidentId: String(inc.id),
      sightings: [{
        at: dayStart(inc.shop_in),
        day: inc.shop_in,
        driver: inc.driver_name || '',
        answer: (inc.description || 'No description').slice(0, 300)
      }],
      note: `In since ${inc.shop_in}${days !== null ? ' — ' + ageText(days) : ''}. ` +
        'Closes when the day it came out is filled in on Expenses.'
    });
  }
  return items;
}

/**
 * Tyres: the ones that are down to the tread, and the ones nobody has put a
 * gauge on.
 *
 * One item per van and season rather than one per axle: whoever books the
 * tyre change books the van in, not a wheel. The worst axle decides what it
 * says, and both are listed under it.
 *
 * The "not measured" item is dated the day the measurement went stale rather
 * than today, and re-dated every STALE_DAYS after that. That is what makes
 * clearing it mean "I know, leave it until the next round" instead of "hide
 * this forever" or "be back tomorrow morning".
 */
function tyreItems({ wheelSets, vehicles, today }) {
  const byPlate = new Map(vehicles.map(v => [v.plate, v]));
  const live = (wheelSets || []).filter(s => !s.retired_on);
  const items = [];

  for (const set of live) {
    const vehicle = byPlate.get(set.plate);
    if (!vehicle) continue;
    /* Only the set that is ON the van. A winter set sitting on a pallet at
       2,1 mm is a thing to buy tyres for in October, not a van to stop
       today, and putting both sets on the report doubles every line on it.
       When nobody has said which set is fitted, the set with the most recent
       reading is the best guess there is, and the item says so. */
    const fitted = vehicle.fitted_season
      ? vehicle.fitted_season === set.season
      : mostRecentlyRead(live.filter(s => s.plate === set.plate)) === set;
    if (!fitted) continue;

    const axles = ['front', 'back'].map(position => {
      const rows = (set.readings || []).filter(r => r.position === position);
      const last = rows.length ? rows[rows.length - 1] : null;
      return { position, last, band: wheels.bandOf(last && last.depth_mm) };
    });

    const measured = axles.filter(a => a.last);
    const worst = axles
      .filter(a => a.band.key === 'critical' || a.band.key === 'soon')
      .sort((a, b) => Number(a.last.depth_mm) - Number(b.last.depth_mm))[0];

    const seasonName = set.season === 'winter' ? 'Winter' : 'Summer';
    const guessed = vehicle.fitted_season ? '' :
      ' (which set is fitted has not been recorded — this is the set measured most recently)';

    if (worst) {
      const critical = worst.band.key === 'critical';
      items.push({
        key: keyOf('tyre', set.plate, set.season, critical ? 'worn' : 'soon'),
        kind: 'tyre',
        plate: set.plate,
        title: `${seasonName} tyres — ${wheels.mm(worst.last.depth_mm)} mm ${worst.position === 'front' ? 'front' : 'back'}`,
        severity: critical ? 'high' : 'low',
        sightings: [{
          at: dayStart(worst.last.measured_on),
          day: worst.last.measured_on,
          driver: worst.last.measured_by || '',
          answer: axles.filter(a => a.last)
            .map(a => `${a.position}: ${wheels.mm(a.last.depth_mm)} mm (${wheels.bandOf(a.last.depth_mm).label.toLowerCase()})`)
            .join(' · ')
        }],
        note: (critical
          ? 'Under 3 mm — below the winter minimum. '
          : 'Between 3 and 5 mm — order the next set now rather than in a hurry. ') +
          `Measured ${worst.last.measured_on}${guessed}`
      });
    }

    /* Nothing measured, or measured too long ago for the number to mean
       anything. Either way what is missing is a measurement, so it is one
       item with two wordings rather than two items. */
    const newest = measured
      .map(a => a.last.measured_on)
      .sort()
      .slice(-1)[0] || '';
    const due = staleSince(newest, vehicle, today);
    if (due) {
      items.push({
        key: keyOf('tyre', set.plate, set.season, 'due'),
        kind: 'tyredue',
        plate: set.plate,
        title: newest
          ? `${seasonName} tread not measured since ${newest}`
          : `${seasonName} tread has never been measured`,
        severity: 'low',
        sightings: [{ at: dayStart(due), day: due, driver: '',
          answer: newest ? `Last gauged ${newest}` : 'No reading on this set at all' }],
        note: `A tread depth is a measurement, not a property: it goes out of date in ` +
          `${wheels.STALE_DAYS} days${guessed}`
      });
    }
  }
  return items;
}

/** Of several sets for one van, the one somebody put a gauge on last. */
function mostRecentlyRead(sets) {
  let best = null, bestOn = '';
  for (const s of sets) {
    for (const r of s.readings || []) {
      if (String(r.measured_on) > bestOn) { bestOn = String(r.measured_on); best = s; }
    }
  }
  return best || sets[0] || null;
}

/**
 * The day a measurement went stale, stepped forward in whole STALE_DAYS so
 * that clearing it buys exactly one more round rather than silence.
 * Null while the reading is still fresh.
 */
function staleSince(lastMeasured, vehicle, today) {
  const from = lastMeasured
    ? lastMeasured
    /* Never measured: count from the day the van was put on the system, not
       from today, or the item would be born already cleared. `created_at`
       arrives as a Date from Postgres and as a string from a fixture, and
       Intl refuses a string outright, so it is made a Date either way. */
    : dayKey(new Date(vehicle.created_at || `${today}T00:00:00Z`));
  const age = daysBetween(from, today);
  if (age === null || age <= wheels.STALE_DAYS) return null;
  const rounds = Math.floor(age / wheels.STALE_DAYS);
  return shiftDay(from, rounds * wheels.STALE_DAYS);
}

/* ------------------------------------------------------------------ *
 * Sightings -> items -> vehicles                                      *
 * ------------------------------------------------------------------ */

/** The clear in force for each key, and the whole history per key. */
function clearIndex(clears = []) {
  const active = new Map();
  const history = new Map();
  for (const c of clears) {
    const key = String(c.item_key);
    if (!history.has(key)) history.set(key, []);
    history.get(key).push(c);
    // Later rows win; a withdrawn one leaves the item with no clear at all
    // rather than falling back to the one before it -- taking a sign-off
    // back means the item is open, not that an older sign-off revives.
    active.set(key, c.withdrawn_at ? null : c);
  }
  return { active, history };
}

function itemFromSightings(key, rows, { damageBump = false } = {}) {
  const sorted = [...rows].sort((a, b) => (ms(a.at) || 0) - (ms(b.at) || 0));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const days = new Set(sorted.map(r => r.day));
  const drivers = [...new Set(sorted.map(r => r.driver).filter(Boolean))];

  let severity = first.kind === 'lamp' || first.kind === 'damage' ? 'high' : 'normal';
  /* Said three times on three different days and still here. That is not a
     worse fault than it was on day one, but it is a worse failure to deal
     with it, and this page is about what has not been dealt with. */
  if (severity === 'normal' && days.size >= 3) severity = 'high';
  if (damageBump) severity = 'high';

  return {
    key,
    kind: first.kind,
    plate: first.plate,
    title: titleOf(last),
    severity,
    sightings: sorted,
    reports: sorted.length,
    days: days.size,
    drivers,
    photos: sorted.reduce((n, r) => n + (r.photos || 0), 0)
  };
}

/**
 * One day's picture of the whole fleet.
 *
 * Everything is derived: nothing is written when a check comes in, so an
 * item that has been open for three weeks did not need a row three weeks ago
 * to exist today, and a form fixed retrospectively re-reads correctly. The
 * only thing stored is the human act of saying it is done.
 */
function buildAttention({
  today,
  vehicles = [],
  submissions = [],
  assignments = [],
  incidents = [],
  wheelSets = [],
  clears = [],
  fallback = [],
  latest = new Map(),
  cases = new Map(),
  lang = 'en'
} = {}) {
  const day = today || dayKey();
  const from = shiftDay(day, -(WINDOW_DAYS - 1));
  const plates = new Set(vehicles.map(v => v.plate));

  /* Checks for vans that have since left the fleet are dropped rather than
     listed under a registration nobody can act on. Their history is still in
     the checks; it is only this page that has nothing useful to say. */
  const mine = submissions.filter(s => plates.has(s.plate));

  const grouped = new Map();
  for (const sighting of sightingsFromChecks(mine, fallback, lang)) {
    if (!grouped.has(sighting.key)) grouped.set(sighting.key, []);
    grouped.get(sighting.key).push(sighting);
  }

  const items = [];
  for (const [key, rows] of grouped) {
    const item = itemFromSightings(key, rows);
    /* A damage report somebody has already opened a case for. The item stays
       open -- the case is a case, not a repair -- but it says where it is
       being handled, so the same dent is not chased twice. */
    const linked = rows.map(r => cases.get(r.submissionId)).filter(Boolean);
    if (linked.length) item.incidentId = String(linked[linked.length - 1]);
    items.push(item);
  }

  items.push(...shopItems({ incidents, today: day, plates }));
  items.push(...tyreItems({ wheelSets, vehicles, today: day }));

  // Everything not built out of check sightings arrives with its own
  // `sightings`; give those the same derived fields so one renderer can draw
  // every kind of item.
  for (const item of items) {
    if (item.reports === undefined) {
      const sorted = [...item.sightings].sort((a, b) => (ms(a.at) || 0) - (ms(b.at) || 0));
      item.sightings = sorted;
      item.reports = sorted.length;
      item.days = new Set(sorted.map(s => s.day)).size;
      item.drivers = [...new Set(sorted.map(s => s.driver).filter(Boolean))];
      item.photos = 0;
    }
  }

  const { active, history } = clearIndex(clears);

  for (const item of items) {
    const last = item.sightings[item.sightings.length - 1];
    const clear = active.get(item.key) || null;
    const coversTo = clear ? ms(clear.covers_to) : null;

    item.clear = clear;
    item.history = history.get(item.key) || [];
    item.open = coversTo === null || (ms(last.at) || 0) > coversTo;
    /* Which sightings are still unanswered. An item reopened by a new report
       says "open since" the report that reopened it, not since the original
       fault -- the first one was dealt with, and pretending otherwise makes
       every reopened item look three months old. */
    item.since = item.sightings.filter(s => coversTo === null || (ms(s.at) || 0) > coversTo);
    const openFrom = item.since[0] || last;
    item.firstDay = openFrom.day;
    item.lastDay = last.day;
    item.ageDays = daysBetween(openFrom.day, day);
    item.age = ageText(item.ageDays);
    item.newToday = last.day === day;
    item.reopened = Boolean(clear && item.open);
    item.lastSightingAt = last.at instanceof Date ? last.at.toISOString()
      : typeof last.at === 'number' ? new Date(last.at).toISOString()
      : String(last.at || '');
    if (!item.open) {
      item.clearedDays = clear ? daysBetween(dayKey(clear.cleared_at), day) : null;
    }
  }

  const open = items.filter(i => i.open);
  const done = items.filter(i => !i.open &&
    (i.clearedDays === null || i.clearedDays === undefined || i.clearedDays <= DONE_DAYS));

  const sortItems = (a, b) =>
    RANK[a.severity] - RANK[b.severity] ||
    (b.ageDays || 0) - (a.ageDays || 0) ||
    a.plate.localeCompare(b.plate) ||
    a.title.localeCompare(b.title);
  open.sort(sortItems);
  done.sort((a, b) => (ms(b.clear && b.clear.cleared_at) || 0) - (ms(a.clear && a.clear.cleared_at) || 0));

  /* Per vehicle, and vans with nothing wrong are kept in the list: "RJC29S —
     nothing to report" is an answer, and a page that only shows the bad vans
     cannot be read as a fleet. */
  const perVehicle = vehicles.map(v => {
    const mineOpen = open.filter(i => i.plate === v.plate);
    const mineDone = done.filter(i => i.plate === v.plate);
    const worst = mineOpen.length
      ? SEVERITY[Math.min(...mineOpen.map(i => RANK[i.severity]))] : '';
    return {
      plate: v.plate,
      owner: v.owner || '',
      fleet: v.fleet || '',
      items: mineOpen,
      done: mineDone,
      worst,
      counts: {
        open: mineOpen.length,
        action: mineOpen.filter(i => i.severity !== 'info').length,
        high: mineOpen.filter(i => i.severity === 'high').length,
        newToday: mineOpen.filter(i => i.newToday).length,
        done: mineDone.length
      }
    };
  }).sort((a, b) =>
    (a.worst ? RANK[a.worst] : 99) - (b.worst ? RANK[b.worst] : 99) ||
    b.counts.open - a.counts.open ||
    a.plate.localeCompare(b.plate));

  /* The panel down the right-hand side: every van and how long since
     anybody walked round it. Built from the LATEST check of all time, not
     from the window above -- "nobody has checked this van since June" is
     exactly the answer a ninety-day window would hide. */
  const lastChecks = lastCheckPanel({ vehicles, latest, assignments, today: day });

  return {
    today: day,
    window: { from, to: day, days: WINDOW_DAYS },
    items: open,
    done,
    vehicles: perVehicle,
    lastChecks,
    counts: {
      open: open.length,
      action: open.filter(i => i.severity !== 'info').length,
      high: open.filter(i => i.severity === 'high').length,
      normal: open.filter(i => i.severity === 'normal').length,
      low: open.filter(i => i.severity === 'low').length,
      info: open.filter(i => i.severity === 'info').length,
      newToday: open.filter(i => i.newToday).length,
      reopened: open.filter(i => i.reopened).length,
      vehicles: perVehicle.filter(v => v.counts.open).length,
      fleet: vehicles.length,
      done: done.length,
      neverChecked: lastChecks.filter(l => l.never).length,
      checkedToday: lastChecks.filter(l => l.ageDays === 0).length,
      stale: lastChecks.filter(l => l.band === 'old' || l.band === 'never').length
    }
  };
}

/**
 * The same report, narrowed to what the filters ask for.
 *
 * Applied after the report is built, never before: the tallies across the top
 * are of the whole fleet, and a page whose "4 to act on now" changed the
 * moment you picked a vehicle would be a page you could not use to decide
 * which vehicle to pick. Only the cards narrow.
 */
function narrow(report, { plate = '', show = '' } = {}) {
  const keep = item =>
    (show !== 'high' || item.severity === 'high') &&
    (show !== 'action' || item.severity !== 'info') &&
    (show !== 'new' || item.newToday);

  const vehicles = report.vehicles
    .filter(v => !plate || v.plate === plate)
    .map(v => {
      const items = v.items.filter(keep);
      return { ...v, items, done: plate || !show ? v.done : [],
        counts: { ...v.counts, open: items.length } };
    });

  return { ...report, vehicles, items: report.items.filter(keep)
    .filter(i => !plate || i.plate === plate) };
}

/** The report as rows, for the CSV and for anything that wants it flat. */
function flatten(report) {
  const rows = [];
  for (const item of report.items) {
    const last = item.sightings[item.sightings.length - 1];
    rows.push({
      plate: item.plate,
      severity: item.severity,
      severityLabel: SEVERITY_LABEL[item.severity] || item.severity,
      kind: KIND_LABEL[item.kind] || item.kind,
      title: item.title,
      openSince: item.firstDay,
      ageDays: item.ageDays,
      lastReported: item.lastDay,
      reports: item.reports,
      days: item.days,
      reportedBy: item.drivers.join(', '),
      latest: last.answer || '',
      note: item.note || '',
      reopened: item.reopened ? 'yes' : '',
      case: item.incidentId || ''
    });
  }
  return rows;
}

module.exports = {
  buildAttention, narrow, flatten,
  WINDOW_DAYS, DONE_DAYS, SEVERITY, SEVERITY_LABEL, KIND_LABEL, RANK,
  keyOf, titleOf, staleSince, ageText, dayStart, formTraits, sightingsFromChecks,
  lastCheckPanel, staleBand
};
