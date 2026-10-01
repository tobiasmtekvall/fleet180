'use strict';
/* Driver surnames are masked on every page Fleet 180 draws (2026-10-01).
 *
 *   node tests/mask-everywhere.test.js
 *
 * No database: the admin views and the daily mail, rendered from fixtures, must
 * not print a surname anywhere a person reads it. The full crawl of a running
 * app against a seeded database (every page, title/placeholder/option/visible
 * input text included) was done when this was built; this keeps the cheap part
 * of it running.
 */
const assert = require('assert');
const summary = require('../src/summary');
const { adminVehiclesPage } = require('../src/views/admin');
const P = require('../src/planday-box');

let fails = 0;
const check = (what, fn) => {
  try { fn(); console.log('  ok   ' + what); }
  catch (e) { fails++; console.log('  FAIL ' + what + '\n       ' + e.message); }
};
const SURNAMES = ['Zebraqvist', 'Yxmarken', 'Xanderlund', 'Wolfsgruber'];
const clean = (text, where) => {
  for (const s of SURNAMES) assert.ok(!String(text).includes(s), `${s} printed in ${where}`);
};

console.log('\n1. the daily mail');
// A day exactly as buildDay() made it from a seeded database: three checks, each
// done by somebody other than the assigned driver, four assignments, flags.
const day = require('./fixtures/mask-day.json');
check('the HTML mail', () => {
  const html = summary.renderHtml(day, 'https://example.invalid');
  clean(html, 'renderHtml');
  assert.ok(html.includes('Sara Y****') && html.includes('Simon Z****'));
});
check('the text mail', () => {
  const text = summary.renderText(day);
  clean(text, 'renderText');
  assert.ok(text.includes('Simon Z****') && text.includes('Sara Y****'));
});

console.log('\n2. the Box routes beside the Vehicles text');
check('names masked, no full Planday name in a tooltip', () => {
  const routes = P.cleanDay({ date: '2026-10-02', routes: [
    { route: 'JKP-EM-1', operator: 'inhouse', driver: 'Simon Zebraqvist', planday: 'Simon Zebraqvist' },
    { route: 'JKP-EM-2', operator: 'boxflow', driver: 'Wille Xanderlund', planday: '(EXT) Boxflow Wille Xanderlund', company: 'Boxflow' }] }).routes;
  const html = adminVehiclesPage({ vehicles: [], forms: [], counts: new Map(), boxRoutes: {
    date: '2026-10-02', today: '2026-10-01', tomorrow: '2026-10-02', prev: null, next: null,
    day: { date: '2026-10-02', routes, counts: P.summarise(routes), fetched_at: new Date().toISOString() } } });
  clean(html, 'the Vehicles page');
  assert.ok(html.includes('Simon Z****') && html.includes('Wille X****'));
});

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
