'use strict';
/**
 * What a van is doing today, and how many of them can actually take a route.
 *
 * The fleet already had one flag, `active`, and it answers a different
 * question: is this van ours at all. A van sold, returned to OKQ8 or written
 * off is unticked and vanishes from every list, and its old checks stay. That
 * flag is about the fleet's *membership*, and it changes a few times a year.
 *
 * This is about the fleet's *availability*, and it changes most weeks: a van
 * that is ours, ticked, on the QR sheet and still standing at a body shop
 * with a broken tailgate. Counting that van as one we can plan a route around
 * is how a route goes out on Monday with nothing to drive it.
 *
 * So the status is set by hand. Nothing infers it. The workshop dates on
 * Expenses would have told us about a van somebody has already opened a case
 * for, and would have had nothing at all to say about the one reported on
 * Friday afternoon that nobody has booked in yet -- which is exactly the van
 * the Team Manager needs to know about on Monday morning.
 */

/* The order is the order they are offered in, and the order the shortfall is
   read out in: nearest to working first. */
const STATUSES = ['service', 'rental', 'waiting', 'workshop', 'off'];

/* Not one of the five. A column that says something this app does not
   recognise is a column somebody wrote around the form, and the van behind it
   is not one to hand a route to -- so it gets a name of its own, is counted
   with the vans that cannot work, and says plainly that it needs looking at.
   It is never offered in the dropdown and never written to the database. */
const UNKNOWN = 'unknown';

const STATUS_LABEL = {
  service: 'In service',
  rental: 'Temporary rental in service',
  waiting: 'Waiting for repair',
  workshop: 'In the workshop',
  off: 'Off the road',
  unknown: 'Status not recognised'
};

const STATUS_HINT = {
  service: 'On the road, or ready to be – this van can be given a route.',
  rental: 'A hired vehicle standing in for one of ours, and working. It CAN be given a route, '
    + 'so it counts towards the ready figure – it is shown apart only so the Team Manager '
    + 'can see how much of the fleet on the road today is hired.',
  waiting: 'Damaged or faulty and not yet booked in. Cannot take a route.',
  workshop: 'At the body shop or the garage now. Cannot take a route.',
  off: 'Out of use for any other reason – no driver, no tyres, waiting on paperwork.',
  unknown: 'This van has a status this app does not offer. Pick one – until then it is '
    + 'not counted as ready.'
};

/**
 * READY is our own van, working: the plain case, and the one the note rule
 * hangs off (a van in service has no holdup to explain, so its reason line is
 * cleared; a hire car very much does have one – which van it is covering, and
 * until when – so its line is kept).
 *
 * CAN_WORK is the wider question the figures at the top of both vehicle pages
 * actually ask: can this be given a route tomorrow. A hire car standing in for
 * a van at the body shop is a vehicle a driver gets into, so it belongs here.
 * Leaving it out would have the Team Manager plan one route fewer than he has
 * vehicles for, which is the same class of mistake as planning one more.
 */
const READY = 'service';
const CAN_WORK = new Set(['service', 'rental']);

/**
 * The status to READ a row by.
 *
 * Every other field on the vehicle form falls back to the harmless value when
 * it cannot be understood: an unknown model means the shared lamp list, an
 * unknown manual file means no manual. This one's harmless direction is the
 * opposite of the obvious one. Reading an unrecognised status as In service
 * would add a van to the figure the Team Manager plans routes against, which
 * is the single mistake this column exists to prevent. So anything that is not
 * on that list reads as UNKNOWN, and UNKNOWN is never ready.
 *
 * Rows that predate the column are unaffected: they carry the column's own
 * DEFAULT of 'service', which is a real value and a true one.
 */
function normalise(status) {
  return STATUSES.includes(status) ? status : UNKNOWN;
}

/** The status to WRITE when one has to be chosen without being told. Off the
 *  road, for the same reason: never a guess in the direction of "usable". */
function safe(status) {
  return STATUSES.includes(status) ? status : 'off';
}

function label(status) {
  return STATUS_LABEL[normalise(status)];
}

/** Ticked as in the fleet AND able to work. Both halves matter. */
function isReady(v) {
  return !!v.active && CAN_WORK.has(normalise(v.status));
}

/** Working, but not one of ours. */
function isRental(v) {
  return normalise(v.status) === 'rental';
}

/**
 * How many of each fleet can take a route, and what the rest are doing.
 *
 * Returns a Map keyed by fleet, in the order the fleets are given, each with
 * `active`, `ready` and `out` -- `out` being one entry per status that is
 * holding vans back, with the registration numbers, because "three not ready"
 * is a number and "ABC12D and XYZ99Z are at the workshop" is an answer.
 *
 * A list that has already had its inactive vans filtered out counts the same:
 * `active` is then simply every van it was given.
 */
function readiness(vehicles, order = ['box', 'home']) {
  const blank = f => ({ fleet: f, total: 0, active: 0, ready: 0, inactive: 0,
    rented: [], held: new Map() });
  /* A card per fleet that HAS vans, rather than per fleet this app knows the
     name of. A depot with no home-delivery vans was getting a green card
     reading "0 of 0 ready – every van is in service", which is a reassurance
     about a fleet that does not exist. */
  const out = new Map();

  for (const v of vehicles || []) {
    if (!out.has(v.fleet)) out.set(v.fleet, blank(v.fleet));
    const r = out.get(v.fleet);
    r.total++;
    if (!v.active) { r.inactive++; continue; }
    r.active++;
    const s = normalise(v.status);
    if (CAN_WORK.has(s)) {
      r.ready++;
      // Counted as ready, and also named, because "13 of 15" reads differently
      // when two of the thirteen are on hire from OKQ8.
      if (s !== READY) r.rented.push(v.plate);
      continue;
    }
    if (!r.held.has(s)) r.held.set(s, []);
    r.held.get(s).push(v.plate);
  }

  for (const r of out.values()) {
    r.out = [...STATUSES, UNKNOWN]
      .filter(s => s !== READY && r.held.has(s))
      .map(s => ({ status: s, label: STATUS_LABEL[s], plates: r.held.get(s) }));
    r.notReady = r.active - r.ready;
    delete r.held;
  }
  /* Box first, then Home, then anything else by name: a stable order, so a van
     changing fleet cannot make the two cards swap places under the reader. */
  const rank = f => { const i = order.indexOf(f); return i < 0 ? order.length : i; };
  return new Map([...out.entries()].sort((a, b) =>
    rank(a[0]) - rank(b[0]) || String(a[0]).localeCompare(String(b[0]))));
}

module.exports = { STATUSES, STATUS_LABEL, STATUS_HINT, READY, CAN_WORK, UNKNOWN,
  normalise, safe, label, isReady, isRental, readiness };
