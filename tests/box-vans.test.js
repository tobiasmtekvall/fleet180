'use strict';
/**
 * "Box vans ready now: 15 for 15 routes + 1 3PL".
 *
 * The one line on the Box routes card that somebody acts on: it is read the
 * evening before, and a wrong figure either sends somebody hunting for a hire
 * car that is not needed or leaves a route in the yard. A 3PL route arrives on
 * the supplier's own vehicle, so it is not a route we have to find a van for
 * -- counting it was the difference between "1 short" and "enough" on a day
 * when nothing at all was wrong.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const admin = require('../src/views/admin');

const DAY = { date: '2026-10-01', today: '2026-09-30', tomorrow: '2026-10-01' };

/** The one line, with the whitespace taken out of it. */
function vanLine({ inhouse = 0, flexio = 0, boxflow = 0, tpl = 0, open = 0,
                   vans = [] } = {}) {
  const routes = [];
  const add = (operator, n) => {
    for (let i = 0; i < n; i++) {
      routes.push({ route: `JKP-EM-${routes.length + 1}`, operator,
        driver: operator === 'unassigned' ? '' : 'Someone',
        company: operator === 'tpl' ? 'Ceva' : '', shift: '06:00-14:00' });
    }
  };
  add('inhouse', inhouse); add('flexio', flexio); add('boxflow', boxflow);
  add('tpl', tpl); add('unassigned', open);

  const rest = inhouse + flexio + boxflow;
  const html = admin.adminVehiclesPage({
    vehicles: vans, forms: [], counts: new Map(),
    boxRoutes: { ...DAY, day: {
      counts: { inhouse, flexio, boxflow, tpl, unassigned: open,
        rest, routes: rest + tpl, open },
      routes, fetched_at: new Date().toISOString() } }
  });
  const i = html.indexOf('br-vans');
  assert.ok(i > 0, 'the Box routes card did not render');
  return html.slice(i, html.indexOf('</div>', i)).replace(/\s+/g, ' ').trim();
}

/** n box vans with this status, as the page receives them. */
const fleet = (n, status = 'service') => Array.from({ length: n }, (_, i) => ({
  id: i + 1, plate: `BOX${String(i).padStart(2, '0')}`, fleet: 'box', owner: 'own',
  active: true, status, status_note: '', model_key: '', manual_file: ''
}));

test('a 3PL route is not a route we need a van for', () => {
  // 2026-10-01 as it actually stood: 15 vans, 16 routes, one of them 3PL.
  const line = vanLine({ inhouse: 12, flexio: 2, boxflow: 1, tpl: 1, vans: fleet(15) });
  assert.match(line, /<strong>15<\/strong> for 15 routes/, line);
  assert.match(line, /\+ 1 3PL/, line);
  assert.match(line, /enough/, line);
  assert.doesNotMatch(line, /short/, line);
});

test('with no 3PL the line says nothing about 3PL', () => {
  const line = vanLine({ inhouse: 15, vans: fleet(15) });
  assert.match(line, /<strong>15<\/strong> for 15 routes/, line);
  assert.doesNotMatch(line, /3PL/, line);
  assert.match(line, /enough/, line);
});

test('genuinely short is still short, and the supplier did not cause it', () => {
  const line = vanLine({ inhouse: 14, tpl: 3, vans: fleet(12) });
  assert.match(line, /<strong>12<\/strong> for 14 routes/, line);
  assert.match(line, /\+ 3 3PL/, line);
  assert.match(line, /<strong>2 short<\/strong>/, line);
  assert.match(line, /br-short/, line);
});

test('an open shift is one of ours and does need a van', () => {
  // No driver yet means no operator either, so an unassigned route cannot be
  // told from one of ours -- and the guess that keeps a van spare is the one
  // that does not leave a route standing.
  const line = vanLine({ inhouse: 10, tpl: 2, open: 3, vans: fleet(13) });
  assert.match(line, /<strong>13<\/strong> for 13 routes/, line);
  assert.match(line, /\+ 2 3PL/, line);
  assert.match(line, /enough/, line);
});

test('a day of nothing but 3PL needs no vans at all', () => {
  const line = vanLine({ tpl: 4 });
  assert.match(line, /<strong>0<\/strong> for 0 routes/, line);
  assert.match(line, /\+ 4 3PL/, line);
  assert.match(line, /enough/, line);
  assert.doesNotMatch(line, /short/, line);
});

test('one route reads as a route, not routes', () => {
  const line = vanLine({ inhouse: 1, vans: fleet(1) });
  assert.match(line, /for 1 route /, line);
});

test('only vans that can take a route are counted', () => {
  const vans = [...fleet(5), ...fleet(3, 'workshop'), ...fleet(2, 'waiting')];
  // The plates collide across the three groups; the count is what matters.
  const line = vanLine({ inhouse: 8, tpl: 2, vans });
  assert.match(line, /<strong>5<\/strong> for 8 routes/, line);
  assert.match(line, /<strong>3 short<\/strong>/, line);
});

test('a working hire car counts towards the routes', () => {
  const line = vanLine({ inhouse: 6, vans: [...fleet(5), ...fleet(1, 'rental')] });
  assert.match(line, /<strong>6<\/strong> for 6 routes/, line);
  assert.match(line, /enough/, line);
});

test('a van that is not active is not counted, whatever its status', () => {
  const vans = fleet(6);
  vans[5].active = false;
  const line = vanLine({ inhouse: 6, vans });
  assert.match(line, /<strong>5<\/strong> for 6 routes/, line);
  assert.match(line, /<strong>1 short<\/strong>/, line);
});

test('home vans are not box vans', () => {
  const vans = [...fleet(4), ...fleet(9).map(v => ({ ...v, fleet: 'home' }))];
  const line = vanLine({ inhouse: 5, vans });
  assert.match(line, /<strong>4<\/strong> for 5 routes/, line);
  assert.match(line, /<strong>1 short<\/strong>/, line);
});
