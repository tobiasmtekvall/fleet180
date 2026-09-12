'use strict';

/**
 * What the assigner decided, as the driver's form needs it.
 *
 * The app still never decides an assignment (see /api/assignments) -- this is
 * only the reading side: which driver was given this vehicle today, whether
 * the person filling in the check is that driver, and who has had the vehicle
 * over the last week.
 */

const { dayKey } = require('./summary');

/**
 * Names are compared the same way the driver statistics compare them
 * (src/stats.js): trimmed, inner spaces collapsed, lower-cased. Deliberately
 * the same rule and nothing cleverer -- both sides read the same roster, and
 * two ways of deciding "same person" would eventually disagree about one.
 */
function normName(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function sameName(a, b) {
  const x = normName(a), y = normName(b);
  return !!x && x === y;
}

/**
 * Today's assignment for one vehicle.
 *
 * `one` is set only when exactly one driver was given the vehicle: with two
 * (a van shared over two routes, or a plate that appears in both fleets)
 * there is no name to fill in, and guessing one would put the wrong person on
 * the check. The list is still shown, so the driver can see the situation.
 */
function todaysAssignment(rows) {
  const list = (rows || []).filter(r => r && String(r.driver || '').trim());
  return { list, one: list.length === 1 ? list[0] : null };
}

/** Is this vehicle's check being filed by somebody it was not given to? */
function isDriverChange(assignment, chosenDriver) {
  const list = (assignment && assignment.list) || [];
  if (!list.length) return false;                 // nothing was assigned: nothing to confirm
  if (!String(chosenDriver || '').trim()) return false;  // no name yet; the field's own rule applies
  return !list.some(a => sameName(a.driver, chosenDriver));
}

/**
 * The last `days` days for one vehicle, newest first: who was given it, and
 * who signed for it.
 *
 * Checks are bucketed by Swedish calendar day rather than by the database's
 * idea of a date, because `submitted_at` is a timestamptz and a check filed
 * at 06:00 belongs to that morning wherever the server happens to think it
 * is. A day is listed when it has an assignment, a check, or both -- the
 * interesting days are exactly the ones where those two disagree.
 */
function buildWeek({ assignments = [], checks = [], today, days = 7 }) {
  const end = today || dayKey();
  const from = shiftDay(end, -(days - 1));
  const byDate = new Map();
  const dayOf = d => {
    if (!byDate.has(d)) byDate.set(d, { date: d, assigned: [], checks: [] });
    return byDate.get(d);
  };

  for (const a of assignments) {
    if (a.date < from || a.date > end) continue;
    dayOf(a.date).assigned.push({
      driver: a.driver, route: a.route || '', fleet: a.fleet || '', type: a.type || ''
    });
  }

  for (const c of checks) {
    const date = dayKey(c.submitted_at);
    if (date < from || date > end) continue;
    dayOf(date).checks.push({
      id: String(c.id),
      driver: c.driver_name || '',
      route: c.route || '',
      changed: !!c.driver_changed,
      approver: c.change_approver || '',
      assignedDriver: c.assigned_driver || ''
    });
  }

  /* "Swapped" is judged against what the check itself recorded first, and
     only then against the day's assignment. The assignments table is
     replaced every time the assigner re-runs, so a driver who WAS the
     assigned one when they signed must not be marked as a swap this
     afternoon because the van was given to somebody else since. The day's
     assignment is the fallback for checks filed before this was recorded. */
  const list = [...byDate.values()].map(d => {
    d.checks.forEach(c => {
      const expected = c.assignedDriver ? [{ driver: c.assignedDriver }] : d.assigned;
      c.swapped = c.changed ||
        (!!expected.length && !!c.driver && !expected.some(a => sameName(a.driver, c.driver)));
    });
    return d;
  });
  list.sort((a, b) => b.date.localeCompare(a.date));
  return { from, to: end, days: list };
}

/** YYYY-MM-DD, moved by whole days without dragging a timezone along. */
function shiftDay(date, delta) {
  const [y, m, d] = String(date).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

module.exports = { normName, sameName, todaysAssignment, isDriverChange, buildWeek, shiftDay };
