'use strict';
/**
 * What the Expenses ledger adds up to.
 *
 * Its own file, and not a few lines inside the request handler, for one
 * reason: the rule that a QUOTE IS NOT MONEY SPENT lives here, and a rule
 * that matters that much should be somewhere a test can call directly. The
 * page renders whatever it is handed, so a test of the page proves nothing
 * about this; tests/rental.test.js calls totalsOf() itself.
 *
 * Every line is in exactly one bucket, and the five buckets add up to `cost`.
 * An estimate is in none of them: what it carries is what a workshop is
 * asking for work nobody has done, and adding that to the money that has
 * actually gone out would say a van cost twice what it did.
 */

/** The kinds whose money is money spent, and the bucket each one falls in. */
const SPENT = [
  ['damageCost', i => i.scope === 'vehicle' && i.category !== 'parts'],
  ['partsCost', i => i.scope === 'vehicle' && i.category === 'parts'],
  ['toolCost', i => i.scope === 'tool'],
  ['miscCost', i => i.scope === 'misc'],
  ['rentalCost', i => i.scope === 'rental']
];

function totalsOf(incidents, today) {
  const spent = incidents.filter(i => i.scope !== 'estimate' && i.cost_sek !== null &&
    i.cost_sek !== undefined);
  const sum = list => list.reduce((n, i) => n + Number(i.cost_sek), 0);
  const estimates = incidents.filter(i => i.scope === 'estimate');

  const totals = {
    withCost: spent.length,
    cost: sum(spent),
    /* Quoted money is kept apart from all of the above and from the total. */
    quoted: estimates.reduce((n, i) => n + (Number(i.quoted_sek) || 0), 0),
    toAccept: estimates.filter(i => !i.sm_ok).length,
    waiting: incidents.filter(i => i.scope !== 'estimate' && !i.sm_ok).length,
    atShop: incidents.filter(i => i.scope === 'vehicle' && i.category !== 'parts' &&
      i.shop_in && !i.shop_out).length,
    /* Hire cars still out: no return date at all, or one still in the future
       (a booked return). A car handed back TODAY is back -- ">=" would have
       counted every car returned this morning as still out, which is the one
       number on this line somebody acts on. */
    outNow: incidents.filter(i => i.scope === 'rental' &&
      (!i.rented_to || i.rented_to > today)).length
  };
  for (const [name, is] of SPENT) totals[name] = sum(spent.filter(is));
  return totals;
}

module.exports = { totalsOf, SPENT };
