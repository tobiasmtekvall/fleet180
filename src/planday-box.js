'use strict';
/**
 * Tomorrow's BOX routes, as Planday has them (2026-09-30).
 *
 * The Route Suite reads the Planday schedule over its API and posts the coming
 * days here; the Vehicles page shows the next day beside the fleet figures, so
 * "how many routes go out tomorrow" and "how many vans can take one" are read
 * off the same screen.
 *
 * This app never reads Planday itself and never decides who is 3PL: the suite
 * already classifies every shift (In-house, Boxflow, Flexio, other 3PL) with
 * the patterns he keeps on its BOX schedule page, and a second rule here could
 * only ever disagree with it. What arrives is stored as it came, per day.
 *
 * The split the page shows is the one he asked for: 3PL on one side, and
 * everybody else -- our own staff, Flexio and Boxflow -- on the other.
 */

const OPERATORS = ['inhouse', 'boxflow', 'flexio', 'tpl', 'unassigned'];
const OPERATOR_LABEL = {
  inhouse: 'In-house', boxflow: 'Boxflow', flexio: 'Flexio', tpl: '3PL', unassigned: 'Open shift'
};
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A route and its "route refreshed" twin are the same route (JKP-EM-5-RR = JKP-EM-5). */
function routeKey(name) {
  const n = String(name || '').trim();
  return (n.replace(/[\s_-]*RR\s*$/i, '').trim() || n).toUpperCase();
}

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/**
 * One posted day, cleaned. Returns null for a day that cannot be stored:
 * a bad date, or no usable routes at all -- an empty day is never allowed to
 * replace a full one, because an empty read looks exactly like a failed one.
 */
function cleanDay(d) {
  if (!d || typeof d !== 'object') return null;
  const date = str(d.date, 10);
  if (!isDay(date)) return null;
  const list = Array.isArray(d.routes) ? d.routes : [];
  const byKey = new Map();
  let rejected = 0;
  for (const r of list) {
    const route = str(r && r.route, 60);
    const operator = str(r && r.operator, 20).toLowerCase();
    if (!route || !OPERATORS.includes(operator)) { rejected++; continue; }
    const driver = operator === 'unassigned' ? '' : str(r.driver, 120);
    if (operator !== 'unassigned' && !driver) { rejected++; continue; }
    // One row per route: the suite already sends one, and a -RR twin that
    // somehow arrives beside its plain name must not make two routes of one.
    byKey.set(routeKey(route), {
      route,
      driver,
      planday: str(r.planday, 160),
      operator,
      company: operator === 'unassigned' ? '' : str(r.company, 60),
      shift: str(r.shift, 20),
      handover: !!r.handover,
      adjusted: !!r.adjusted
    });
  }
  const routes = [...byKey.values()].sort((a, b) =>
    a.route.localeCompare(b.route, 'sv', { numeric: true }));
  if (!routes.length) return null;
  return { date, routes, rejected };
}

/** The figures for one day. `routes` counts routes somebody is driving. */
function summarise(routes) {
  const n = { inhouse: 0, boxflow: 0, flexio: 0, tpl: 0, unassigned: 0 };
  for (const r of routes || []) if (n[r.operator] != null) n[r.operator]++;
  const rest = n.inhouse + n.boxflow + n.flexio;
  return Object.assign(n, { rest, routes: rest + n.tpl, open: n.unassigned });
}

/** A real calendar day: the right shape AND a date that exists (not 2026-02-30). */
function isDay(v) {
  const s = String(v || '');
  return DAY_RE.test(s) && addDays(s, 0) === s;
}

/** YYYY-MM-DD plus n calendar days, with no time zone anywhere near it. */
function addDays(day, n) {
  const [y, m, d] = String(day).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

module.exports = { OPERATORS, OPERATOR_LABEL, routeKey, cleanDay, summarise, addDays, isDay };
