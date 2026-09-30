'use strict';
/* Tomorrow's BOX routes from Planday, on the Vehicles page (2026-09-30).
 *
 *   node tests/planday-box.test.js
 *
 * No database: what a posted day is cleaned into, how it is counted, and what
 * the panel beside the Vehicles text says about it.
 */
const assert = require('assert');
const P = require('../src/planday-box');
const { adminVehiclesPage } = require('../src/views/admin');

let fails = 0;
const check = (what, fn) => {
  try { fn(); console.log('  ok   ' + what); }
  catch (e) { fails++; console.log('  FAIL ' + what + '\n       ' + e.message); }
};

const R = (route, operator, driver, extra) =>
  Object.assign({ route, operator, driver: driver || '', company: '', shift: '10:20 - 18:20' }, extra || {});

console.log('\n1. cleaning a posted day');
check('a bad date or an empty day is refused, never stored', () => {
  assert.strictEqual(P.cleanDay({ date: '2026-13', routes: [R('JKP-EM-1', 'inhouse', 'A B')] }), null);
  assert.strictEqual(P.cleanDay({ date: '2026-10-01', routes: [] }), null);
  assert.strictEqual(P.cleanDay({ date: '2026-10-01' }), null);
});
check('an unknown operator, or a driven route with no driver, is dropped and counted', () => {
  const d = P.cleanDay({ date: '2026-10-01', routes: [
    R('JKP-EM-1', 'inhouse', 'Sara Molin'), R('JKP-EM-2', 'martian', 'X Y'), R('JKP-EM-3', 'tpl', '')] });
  assert.strictEqual(d.routes.length, 1);
  assert.strictEqual(d.rejected, 2);
});
check('an open shift keeps its route and loses any name', () => {
  const d = P.cleanDay({ date: '2026-10-01', routes: [R('JKP-EM-9', 'unassigned', 'ghost', { company: 'X' })] });
  assert.deepStrictEqual([d.routes[0].driver, d.routes[0].company], ['', '']);
});
check('a route and its -RR twin are one route', () => {
  const d = P.cleanDay({ date: '2026-10-01', routes: [
    R('JKP-EM-5', 'inhouse', 'A B'), R('JKP-EM-5-RR', 'tpl', 'C D', { company: 'Kraft Guld' })] });
  assert.strictEqual(d.routes.length, 1);
  assert.strictEqual(d.routes[0].route, 'JKP-EM-5-RR', 'the later row wins');
});
check('routes sort by number, not as text (2 before 10)', () => {
  const d = P.cleanDay({ date: '2026-10-01', routes: [
    R('JKP-EM-10', 'inhouse', 'A B'), R('JKP-EM-2', 'inhouse', 'C D'), R('JKP-EM-1', 'inhouse', 'E F')] });
  assert.deepStrictEqual(d.routes.map(r => r.route), ['JKP-EM-1', 'JKP-EM-2', 'JKP-EM-10']);
});

check('a date that does not exist is not a day', () => {
  assert.strictEqual(P.isDay('2026-02-30'), false);
  assert.strictEqual(P.isDay('2026-99-99'), false);
  assert.strictEqual(P.isDay('2028-02-29'), true);
  assert.strictEqual(P.cleanDay({ date: '2026-02-30', routes: [R('JKP-EM-1', 'inhouse', 'A B')] }), null);
});

console.log('\n2. the counts');
check('3PL on one side; In-house + Flexio + Boxflow on the other; open shifts apart', () => {
  const c = P.summarise([R('1', 'inhouse', 'a'), R('2', 'inhouse', 'b'), R('3', 'flexio', 'c'),
    R('4', 'boxflow', 'd'), R('5', 'tpl', 'e'), R('6', 'tpl', 'f'), R('7', 'unassigned')]);
  assert.deepStrictEqual([c.routes, c.tpl, c.rest, c.inhouse, c.flexio, c.boxflow, c.open],
    [6, 2, 4, 2, 1, 1, 1]);
});
check('addDays crosses month ends and the October clock change without drifting', () => {
  assert.strictEqual(P.addDays('2026-09-30', 1), '2026-10-01');
  assert.strictEqual(P.addDays('2026-10-24', 1), '2026-10-25');
  assert.strictEqual(P.addDays('2026-10-25', 1), '2026-10-26');
  assert.strictEqual(P.addDays('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(P.addDays('2026-10-01', -1), '2026-09-30');
});

console.log('\n3. the panel');
const vans = [
  { plate: 'AAA111', fleet: 'box', active: true, status: 'service' },
  { plate: 'BBB222', fleet: 'box', active: true, status: 'workshop' },
  { plate: 'CCC333', fleet: 'home', active: true, status: 'service' }];
const render = boxRoutes => adminVehiclesPage({ vehicles: vans, forms: [], counts: new Map(), boxRoutes });
const base = { date: '2026-10-01', today: '2026-09-30', tomorrow: '2026-10-01', prev: null, next: null };
check('the old text is still all there, now in the left panel', () => {
  const html = render(Object.assign({}, base, { day: null }));
  const left = html.split('class="veh-intro-text"')[1].split('<aside')[0];
  for (const bit of ['immediately gets its own page', 'Status and Active are two different questions',
    'The model decides the warning lights', 'The model also decides the manual']) {
    assert.ok(left.includes(bit), bit);
  }
});
check('no day on file says so, and points at the next one', () => {
  const html = render(Object.assign({}, base, { day: null, next: { date: '2026-10-05', n: 12 } }));
  assert.ok(/No Box routes for this day have reached Fleet 180 yet/.test(html));
  assert.ok(html.includes('href="/admin/vehicles?routes=2026-10-05"'));
});
check('a day on file: figures, the list, and the vans set against the routes', () => {
  const routes = P.cleanDay({ date: '2026-10-01', routes: [
    R('JKP-EM-1', 'inhouse', 'Sara Molin'), R('JKP-EM-2', 'tpl', 'Naveen Jacob', { company: 'Kraft Guld' }),
    R('JKP-EM-3', 'unassigned')] }).routes;
  const html = render(Object.assign({}, base, {
    day: { date: '2026-10-01', routes, counts: P.summarise(routes), fetched_at: new Date().toISOString() } }));
  const aside = html.split('<aside')[1];
  assert.ok(aside.includes('Tomorrow'));
  assert.ok(aside.includes('Thursday 1 October'), 'the day is printed as the day, not shifted by a zone');
  assert.ok(/<strong>1<\/strong><span>3PL<\/span>/.test(aside));
  assert.ok(/<strong>1<\/strong><span>In-house \+ Flexio \+ Boxflow<\/span>/.test(aside));
  assert.ok(aside.includes('Kraft Guld') && aside.includes('Open shift'));
  assert.ok(/ready now:\s*<strong>1<\/strong> for 3 routes/.test(aside), 'only box vans that are ready count');
  assert.ok(/2 short/.test(aside));
  assert.ok(!/nothing newer has arrived/.test(aside));
});
check('a read older than six hours is flagged as stale', () => {
  const routes = [R('JKP-EM-1', 'inhouse', 'Sara Molin')];
  const html = render(Object.assign({}, base, { day: { date: '2026-10-01', routes, counts: P.summarise(routes),
    fetched_at: new Date(Date.now() - 7 * 3600e3).toISOString() } }));
  assert.ok(/nothing newer has arrived since/.test(html));
});
check('names are escaped', () => {
  const routes = [R('JKP-EM-1', 'inhouse', '<b>x</b>')];
  const html = render(Object.assign({}, base, { day: { date: '2026-10-01', routes, counts: P.summarise(routes) } }));
  assert.ok(!html.includes('<b>x</b>') && html.includes('&lt;b&gt;x&lt;/b&gt;'));
});

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
