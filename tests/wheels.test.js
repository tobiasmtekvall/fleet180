'use strict';
/* Wheels: what a tread depth means, and where it is heading.
 *
 *   node tests/wheels.test.js
 *
 * No database. The bands and the wear forecast are the judgements the page
 * exists to make -- whether a van is safe to drive and whether to order tyres
 * this month -- so they live in src/wheels.js and are checked here directly,
 * rather than by reading colours out of the HTML.
 */
const assert = require('assert');
const w = require('../src/wheels');
const { wheelsPage } = require('../src/views/wheels');

let fails = 0;
const check = (what, fn) => {
  try { fn(); console.log('  ok   ' + what); }
  catch (e) { fails++; console.log('  FAIL ' + what + '\n       ' + e.message); }
};

const TODAY = '2026-09-18';

console.log('\n1. the bands');
check('the four bands he asked for, and the boundaries land the right way', () => {
  assert.strictEqual(w.bandOf(0).key, 'critical');
  assert.strictEqual(w.bandOf(2.9).key, 'critical');
  // 3.0 is the winter legal minimum: a tyre AT 3.0 still meets it.
  assert.strictEqual(w.bandOf(3).key, 'soon', '3,0 mm must not be "change now"');
  assert.strictEqual(w.bandOf(4.9).key, 'soon');
  assert.strictEqual(w.bandOf(5).key, 'ok');
  assert.strictEqual(w.bandOf(7.9).key, 'ok');
  assert.strictEqual(w.bandOf(8).key, 'new');
  assert.strictEqual(w.bandOf(14).key, 'new');
  assert.strictEqual(w.BANDS.map(b => b.key).join(','), 'critical,soon,ok,new');
});
check('nothing measured is not a band, and never reads as good', () => {
  [null, undefined, '', 'abc', NaN, -1].forEach(v =>
    assert.strictEqual(w.bandOf(v).key, 'unknown', JSON.stringify(v) + ' should be unknown'));
  assert.strictEqual(w.worstOf([null, undefined]), 'unknown');
  assert.strictEqual(w.worstOf([9, 6, null]), 'ok', 'an unmeasured tyre must not mask a measured one');
  assert.strictEqual(w.worstOf([9, 2.5]), 'critical', 'the worst tyre is what a van is');
  assert.strictEqual(w.worstOf([]), 'unknown');
});
check('millimetres are written the Swedish way', () => {
  assert.strictEqual(w.mm(4.5), '4,5');
  assert.strictEqual(w.mm(6), '6', 'no pointless comma-nought');
  assert.strictEqual(w.mm(6.04), '6');
  assert.strictEqual(w.mm(null), '');
});

console.log('\n2. how fast it is wearing');
check('two readings far enough apart give a rate and a date', () => {
  const wear = w.wearOf([
    { depth_mm: 8, measured_on: '2026-03-01' },
    { depth_mm: 6.2, measured_on: '2026-09-01' }
  ], TODAY);
  assert.ok(wear, 'no forecast from six months of wear');
  // 1,8 mm over 184 days is about 0,29 a month; 3,2 mm left is about 11 months.
  assert.ok(Math.abs(wear.perMonth - 0.293) < 0.01, 'rate is ' + wear.perMonth);
  assert.strictEqual(wear.reaches3, '2027-07-25');
  assert.ok(wear.daysFromToday > 300 && wear.daysFromToday < 320);
});
check('one reading says nothing, and neither do two in the same fortnight', () => {
  assert.strictEqual(w.wearOf([{ depth_mm: 6, measured_on: '2026-09-01' }], TODAY), null);
  assert.strictEqual(w.wearOf([], TODAY), null);
  assert.strictEqual(w.wearOf(null, TODAY), null);
  // 0,1 mm in nine days is the gauge, not the tyre.
  assert.strictEqual(w.wearOf([
    { depth_mm: 8, measured_on: '2026-09-01' },
    { depth_mm: 7.9, measured_on: '2026-09-10' }], TODAY), null,
    'readings less than three weeks apart must not become a wear rate');
});
check('a new set, or a re-measure that read higher, gets no forecast', () => {
  assert.strictEqual(w.wearOf([
    { depth_mm: 4, measured_on: '2026-01-01' },
    { depth_mm: 8.5, measured_on: '2026-06-01' }], TODAY), null, 'tread does not grow back');
  assert.strictEqual(w.wearOf([
    { depth_mm: 6, measured_on: '2026-01-01' },
    { depth_mm: 6, measured_on: '2026-06-01' }], TODAY), null, 'no wear, no forecast');
});
check('a tyre already under 3 mm, and one that will last for years', () => {
  const now = w.wearOf([
    { depth_mm: 4, measured_on: '2026-01-01' },
    { depth_mm: 2.5, measured_on: '2026-06-01' }], TODAY);
  assert.strictEqual(now.months, 0, 'it is already there');
  assert.strictEqual(now.reaches3, null);
  const slow = w.wearOf([
    { depth_mm: 8.2, measured_on: '2026-01-01' },
    { depth_mm: 8.1, measured_on: '2026-06-01' }], TODAY);
  assert.strictEqual(slow.over, true, 'a straight line past a year is fiction');
  assert.strictEqual(slow.reaches3, null);
});
check('the readings may arrive in any order', () => {
  const a = w.wearOf([
    { depth_mm: 6.2, measured_on: '2026-09-01' },
    { depth_mm: 8, measured_on: '2026-03-01' }], TODAY);
  assert.strictEqual(a.reaches3, '2027-07-25');
});

console.log('\n3. the page');
const VEHICLES = [
  { plate: 'RJC29S', note: 'Box', fitted_season: 'summer', fitted_since: '2026-04-02' },
  { plate: 'RBE26H', note: '', fitted_season: '', fitted_since: null }
];
const SETS = [
  { id: 1, plate: 'RJC29S', season: 'summer', make: 'Continental', model: 'VanContact',
    size: '235/65 R16C', tyre_type: '', dot: '2321', note: '', files: [],
    readings: [
      { id: 1, position: 'front', depth_mm: 8, measured_on: '2026-03-01', measured_by: 'Simon', note: '' },
      { id: 2, position: 'front', depth_mm: 6.2, measured_on: '2026-09-01', measured_by: 'Simon', note: '' },
      { id: 3, position: 'back', depth_mm: 2.4, measured_on: '2026-09-01', measured_by: 'Simon', note: '' }
    ] },
  { id: 2, plate: 'RJC29S', season: 'winter', make: 'Nokian', model: 'Hakkapeliitta',
    size: '235/65 R16C', tyre_type: 'studded', dot: '4522', note: 'On the shelf', files: [],
    readings: [{ id: 4, position: 'front', depth_mm: 9.1, measured_on: '2026-04-02', measured_by: '', note: '' }] }
];
const render = (over = {}) => wheelsPage({
  vehicles: VEHICLES, sets: SETS,
  tally: { critical: 1, soon: 0, ok: 1, new: 1, unknown: 5 },
  filters: { plate: '', band: '', fitted: '', query: '' },
  today: TODAY, message: '', nav: '', ...over
});

check('every van, both seasons, four tyres each', () => {
  const html = render();
  VEHICLES.forEach(v => assert.ok(html.includes(`id="v-${v.plate}"`), 'no row for ' + v.plate));
  ['summer', 'winter'].forEach(s => ['front', 'back'].forEach(p =>
    assert.ok(html.includes(`id="t-RJC29S-${s}-${p}"`), `no tile for ${s} ${p}`)));
  // A van nobody has measured still gets its four tiles, empty.
  assert.strictEqual((html.match(/id="t-RBE26H-/g) || []).length, 4);
});
/** The band on one tile, whether or not it also carries the "old" marker. */
const bandOfTile = (html, id) => {
  const m = html.match(new RegExp(`class="tyre band-(\\w+)( stale)?" id="t-${id}"`));
  return m ? m[1] + (m[2] ? ' stale' : '') : null;
};

check('the depth is on the tyre, in its own band', () => {
  const html = render();
  assert.strictEqual(bandOfTile(html, 'RJC29S-summer-back'), 'critical',
    '2,4 mm must colour the tile red');
  assert.strictEqual(bandOfTile(html, 'RJC29S-summer-front'), 'ok');
  assert.strictEqual(bandOfTile(html, 'RJC29S-winter-back'), 'unknown');
  assert.ok(html.includes('6,2<em>mm</em>'), 'the number is not next to the tyre');
  assert.ok(html.includes('2,4<em>mm</em>'));
});
check('a reading that has gone out of date says so on the tyre', () => {
  const html = render();
  // The winter front was measured on 2026-04-02; today is 2026-09-18.
  assert.strictEqual(bandOfTile(html, 'RJC29S-winter-front'), 'new stale',
    'a five-month-old reading must be marked old');
  assert.strictEqual(bandOfTile(html, 'RJC29S-summer-front'), 'ok',
    'a reading from this month must NOT be marked old');
  assert.ok(html.includes('>old</em>'), 'nothing says the reading is old');
  assert.ok(html.includes('class="tyre-when">2026-09-01'), 'the date is not on the tile');
});
check('the depth box takes the comma a Swede types', () => {
  const html = render();
  assert.ok(!/name="depthMm"[^>]*type="number"/.test(html),
    'type=number under an English page throws the comma away');
  assert.ok(/name="depthMm"[^>]*inputmode="decimal"/.test(html),
    'it should still be a number pad on a phone');
  assert.ok(html.includes('placeholder="e.g. 6,5"'));
});
check('a reading can carry its own note', () => {
  const html = render();
  assert.ok(/<input class="form-control" type="text" name="note"[^>]*worn on the inside edge/.test(html),
    'the note column exists in the database but nowhere to type one');
});
check('clicking a tyre is what opens its form – no javascript involved', () => {
  const html = render();
  assert.ok(!html.includes('<script'), 'this page should need no script at all');
  assert.ok(html.includes('<details class="tyre'), 'the tile has to be the summary of a details');
  assert.ok(html.includes('action="/admin/wheels/RJC29S/summer/reading"'), 'nowhere to post a reading');
  assert.ok(html.includes('name="depthMm"'));
});
check('two small pictures, one per season, and they are drawn not fetched', () => {
  const html = render();
  assert.strictEqual((html.match(/class="tyreart"/g) || []).length, VEHICLES.length * 2,
    'one picture per season per van');
  assert.ok(!/<img/.test(html), 'the pictures are SVG, not files to go missing');
  assert.ok(html.includes('currentColor'), 'the picture must take the tread colour');
});
check('the make, the size, the DOT and the note are there, folded away', () => {
  const html = render();
  ['Continental', '235/65 R16C', '2321', 'Nokian', 'Hakkapeliitta', 'On the shelf']
    .forEach(t => assert.ok(html.includes(t), 'missing ' + t));
  assert.ok(html.includes('name="tyreType"'), 'studded or friction');
  assert.ok(html.includes('value="studded" selected'), 'the winter set is studded');
  assert.ok(html.includes('name="photos"'), 'nowhere to add a photo');
});
check('which set is on the van, with the day it went on', () => {
  const html = render();
  assert.ok(html.includes('2026-04-02'), 'the changeover date is not shown');
  assert.ok(html.includes('on the van'), 'nothing marks the fitted set');
  assert.ok(html.includes('action="/admin/wheels/RBE26H/fitted"'));
  assert.ok(html.includes('which set is on it is not recorded'),
    'a van with no fitted set should say so');
});
check('the wear line says the rate and the date, on the tyre it belongs to', () => {
  const html = render();
  assert.ok(/0,3 mm a month/.test(html), 'no wear rate: ' +
    (html.match(/mm a month/) ? 'wrong figure' : 'missing'));
  assert.ok(html.includes('2027-07-25'), 'no date for 3 mm');
});
check('nothing user-supplied reaches the page unescaped', () => {
  const nasty = '<img src=x onerror=alert(1)>';
  const html = render({
    vehicles: [{ plate: 'AAA111', note: nasty, fitted_season: '', fitted_since: null }],
    sets: [{ id: 9, plate: 'AAA111', season: 'summer', make: nasty, model: '', size: '',
      tyre_type: '', dot: '', note: nasty, files: [],
      readings: [{ id: 9, position: 'front', depth_mm: 5, measured_on: '2026-09-01',
        measured_by: nasty, note: '' }] }]
  });
  assert.ok(!html.includes('<img src=x'), 'an unescaped value reached the page');
  assert.ok(html.includes('&lt;img src=x'), 'the value should be there, escaped');
});

console.log('\n4. new tyres');
const RETIRED = {
  id: 7, plate: 'RJC29S', season: 'summer', make: 'Michelin', model: 'Agilis',
  size: '235/65 R16C', tyre_type: '', dot: '1119', note: '', files: [],
  retired_on: '2026-03-01',
  readings: [
    { id: 20, position: 'front', depth_mm: 2.2, measured_on: '2026-02-20', measured_by: '', note: '' },
    { id: 21, position: 'back', depth_mm: 2.0, measured_on: '2026-02-20', measured_by: '', note: '' }
  ]
};
check('a set that has been replaced is kept, and is not what the tiles show', () => {
  const html = render({ sets: [...SETS, RETIRED] });
  assert.ok(html.includes('<details class="wpast">'), 'no earlier-sets section');
  // The tiles still show the live set: 6,2 mm, not the old set's 2,2 mm.
  assert.strictEqual(bandOfTile(html, 'RJC29S-summer-front'), 'ok',
    'a retired set must not colour the tile');
  assert.ok(html.includes('Earlier sets'), 'the old set is nowhere to be seen');
  assert.ok(html.includes('Michelin'), 'the old set lost its make');
  assert.ok(html.includes('to 2026-03-01'), 'the old set lost the day it came off');
  assert.ok(html.includes('2 readings'), 'the old set lost its readings');
});
check('there is a way to say new tyres were fitted', () => {
  const html = render();
  assert.ok(html.includes('action="/admin/wheels/RJC29S/summer/replace"'),
    'nowhere to record a new set');
  assert.ok(html.includes('>New set</button>'));
  assert.ok(!html.includes('<details class="wpast">'),
    'a van with no past sets should not offer the list');
});
check('a van with no past sets shows no history section', () => {
  assert.ok(!render().includes('wpast-list'));
});

console.log(fails ? `\n${fails} FAILED\n` : '\nall green\n');
process.exit(fails ? 1 : 0);
