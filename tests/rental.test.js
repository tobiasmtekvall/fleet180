'use strict';
/* Rental cars: the fourth section of Expenses, and the photo timestamps.
 *
 *   node tests/rental.test.js
 *
 * Node only, no database: the page is built from rows shaped exactly as
 * db.shapeIncident hands them over, so the parts that can be wrong without
 * anybody noticing -- which columns a rental has, what the firm list holds,
 * how the days are counted, which time a photo shows -- are checked here.
 * The posting itself was exercised against a real Postgres when it was
 * built; what a test can hold on to is in this file.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { expensesPage, incidentDeletePage, RENTAL_FIRM_LABEL, SCOPE_LABEL,
  KIND_LABEL } = require('../src/views/incidents');
const exif = require('../src/exif');

let fails = 0;
const check = (what, fn) => {
  try { fn(); console.log('  ok   ' + what); }
  catch (e) { fails++; console.log('  FAIL ' + what + '\n       ' + e.message); }
};

const TODAY = '2026-09-16';
const PLATES = ['RBE26H', 'RPH54L', 'ODW03R'];

function row(over = {}) {
  return {
    id: 1, scope: 'rental', plate: 'ABC123', occurred_on: '2026-09-14', rented_to: '2026-09-16',
    rental_firm: 'okq8-jordbron', for_plate: 'RBE26H', description: 'Hyrbil', driver_name: '',
    category: '', handled_by: '', supplier: '', invoice_no: 'OK-88412', note: '',
    shop_in: '', shop_out: '', cost_sek: 4350.5, sm_ok: false, sm_by: '', sm_at: null,
    submission_id: null, files: [], events: [], ...over
  };
}
/* The filters the page is handed. `scope` is only which tab you are standing
   on -- the list below is the whole ledger on every one of them -- and `edit`
   is the one line opened in its own section's editable form. */
function filters(over = {}) {
  return {
    scope: 'rental', kind: '', plate: '', from: '', to: '', sm: 'no', handledBy: '',
    edit: '', query: '', editQuery: i => `?scope=${i.scope}&edit=${i.id}`, ...over
  };
}
function render(rows, over = {}) {
  return expensesPage({
    incidents: rows, plates: PLATES, today: TODAY, message: '', nav: '',
    sections: { vehicle: { n: 3, cost: 900, waiting: 1 }, rental: { n: rows.length, cost: 4350.5, waiting: 1 } },
    filters: filters(over.filters),
    totals: { withCost: 1, cost: 4350.5, damageCost: 0, partsCost: 0, toolCost: 0,
      miscCost: 0, rentalCost: 4350.5, waiting: 1, atShop: 0, outNow: 1 },
    ...over, ...(over.filters ? { filters: filters(over.filters) } : {})
  });
}
/** The same page with one line opened for editing, which is where a hire's
    own columns and its full set of fields live. */
function editing(rows, id = 1) {
  return render(rows, { filters: { edit: String(id) } });
}

console.log('\n1. the section');
check('Expenses has four sections and Rental cars is one of them', () => {
  assert.deepStrictEqual(Object.keys(SCOPE_LABEL), ['vehicle', 'tool', 'misc', 'rental']);
  assert.strictEqual(SCOPE_LABEL.rental, 'Rental cars');
  const html = render([row()]);
  ['Vehicles', 'Tools', 'Misc', 'Rental cars'].forEach(t =>
    assert.ok(html.includes(`<strong>${t}</strong>`), 'no tab for ' + t));
});
check('the four firms, and only those four', () => {
  assert.deepStrictEqual(Object.values(RENTAL_FIRM_LABEL), [
    'OKQ8 Jordbron', 'OKQ8 Vårstarondellen', 'Circle K Österängen', 'Skeppsbrons']);
  const html = render([row()]);
  Object.entries(RENTAL_FIRM_LABEL).forEach(([v, l]) =>
    assert.ok(html.includes(`<option value="${v}"`) && html.includes(l), 'missing firm ' + l));
});
check('the columns are the hire’s, not the workshop’s', () => {
  const html = editing([row()]);
  ['Hire car', 'Firm', 'Picked up', 'Returned', 'Days', 'Stands in for', 'Invoice no.', 'Cost']
    .forEach(h => assert.ok(html.includes(`>${h}</span>`), 'no column ' + h));
  assert.ok(!html.includes('>Workshop in</span>'), 'a rental has no workshop');
  assert.ok(!html.includes('name="handledBy"'), 'a rental is not repaired by OKQ8 or by us');
  assert.ok(!html.includes('name="category"'), 'damage/spare parts means nothing here');
});
check('the hire car’s registration is typed, the van it stands in for is picked', () => {
  const html = render([row()]);
  assert.ok(/name="plate"[^>]*type="text"|type="text"[^>]*name="plate"/.test(html),
    'the hire plate must be free text — it is not one of our vans');
  assert.ok(html.includes('name="forPlate"'), 'no stands-in-for');
  PLATES.forEach(p => assert.ok(html.includes(`<option value="${p}"`), 'our fleet should be pickable'));
});

console.log('\n2. the hire period');
check('days are inclusive, and an unreturned car counts up', () => {
  assert.ok(render([row()]).includes('>3 d<'), 'the 14th to the 16th is three days');
  // picked up on the 14th, today is the 16th, no return date: three days and counting
  const out = render([row({ rented_to: '' })]);
  assert.ok(out.includes('3 d…'), 'a car still out counts to today and says so');
  assert.ok(out.includes('inc-days open'), 'and is marked open');
});
check('a hire with no dates at all does not invent one', () => {
  const html = render([row({ occurred_on: '2026-09-16', rented_to: '' })]);
  assert.ok(html.includes('1 d…'), 'picked up today, still out: one day');
});

console.log('\n3. the files');
const files = [
  { id: 7, kind: 'agreement', filename: 'avtal.pdf', mime: 'application/pdf', byte_size: 51200,
    uploaded_at: '2026-09-16T08:00:00Z', taken_at: null },
  { id: 8, kind: 'photo', filename: 'utlamning.jpg', mime: 'image/jpeg', byte_size: 900000,
    uploaded_at: '2026-09-16T08:00:00Z', taken_at: '2026-09-14T04:10:22Z' },
  { id: 9, kind: 'photo', filename: 'aterlamning.jpg', mime: 'image/jpeg', byte_size: 880000,
    uploaded_at: '2026-09-16T08:00:01Z', taken_at: null }
];
check('the agreement, the photos and the invoice are three kinds, and several photos fit', () => {
  const html = editing([row({ files })]);
  assert.ok(html.includes('file-agreement'), 'no agreement chip');
  assert.strictEqual((html.match(/class="filechip file-photo"/g) || []).length, 2);
  assert.ok(html.includes('name="agreements"'), 'nowhere to upload an agreement');
  assert.ok(html.includes('name="photos" accept="image/*" multiple'), 'photos must take several at once');
});
check('a photo shows when it was TAKEN, and an upload time is not dressed up as one', () => {
  const html = editing([row({ files })]);
  assert.ok(/Taken 2026-09-14/.test(html), 'the camera’s own time is not shown');
  assert.ok(/Uploaded 2026-09-16/.test(html), 'a file with no EXIF must say "uploaded"');
  assert.ok(html.includes('class="filewhen exact"'), 'the two are not told apart visually');
});
check('the fold-out lists every file with its time', () => {
  const html = editing([row({ files })]);
  ['avtal.pdf', 'utlamning.jpg', 'aterlamning.jpg'].forEach(n =>
    assert.ok(html.includes(n), 'missing from the file list: ' + n));
});

console.log('\n4. reading the time out of a photo');
check('DateTimeOriginal with its offset', () => {
  const d = exif.toDate('2026:09:14 06:10:22', '+02:00');
  assert.strictEqual(d.toISOString(), '2026-09-14T04:10:22.000Z');
});
check('no offset: Swedish summer and winter time, worked out per date', () => {
  assert.strictEqual(exif.toDate('2026:07:10 07:30:00', '').toISOString(), '2026-07-10T05:30:00.000Z');
  assert.strictEqual(exif.toDate('2026:01:10 07:30:00', '').toISOString(), '2026-01-10T06:30:00.000Z');
});
check('rubbish is null, never a guess', () => {
  assert.strictEqual(exif.toDate('0000:00:00 00:00:00', ''), null);
  assert.strictEqual(exif.toDate('1980:01:01 00:00:00', ''), null, 'a camera with a flat battery');
  assert.strictEqual(exif.toDate('', ''), null);
  assert.strictEqual(exif.takenAt(Buffer.from('not a jpeg'), 'image/jpeg'), null);
  assert.strictEqual(exif.takenAt(null, 'image/jpeg'), null);
  assert.strictEqual(exif.takenAt(Buffer.from([0xFF, 0xD8]), 'application/pdf'), null);
});
const SAMPLE = path.join(__dirname, 'fixtures', 'exif-sample.jpg');
if (fs.existsSync(SAMPLE)) {
  check('a real JPEG from the fixtures folder', () => {
    const d = exif.takenAt(fs.readFileSync(SAMPLE), 'image/jpeg');
    assert.ok(d instanceof Date, 'no timestamp read from the sample');
  });
}

console.log('\n5. the rest of the page');
check('the delete page names the firm and the hire', () => {
  const html = incidentDeletePage({ inc: row({ files }), ret: '/admin/expenses?scope=rental', nav: '' });
  assert.ok(html.includes('Rental car'));
  assert.ok(html.includes('OKQ8 Jordbron'));
  assert.ok(html.includes('rental agreement'), 'it should say the agreement goes too');
});
check('the other three sections are untouched by all this', () => {
  const base = { plates: PLATES, today: TODAY, message: '', nav: '', sections: {},
    totals: { withCost: 0, cost: 0, damageCost: 0, partsCost: 0, toolCost: 0,
      miscCost: 0, rentalCost: 0, waiting: 0, atShop: 0, outNow: 0 } };
  for (const scope of ['vehicle', 'tool', 'misc']) {
    const html = expensesPage({ ...base, incidents: [], filters: filters({ scope }) });
    assert.ok(html.includes(`<strong>${SCOPE_LABEL[scope]}</strong>`), scope + ' page did not render');
    assert.ok(!html.includes('name="rentalFirm"'), scope + ' should not carry a rental firm');
  }
});

console.log('\n6. one ledger under every tab');
/* His instruction, in his own words: "On all tabs, the tabs are only there
   for the input field". So the list is every expense there is, whichever tab
   is open, and its first column says which kind each line is. */
const LEDGER = [
  row({ id: 1 }),
  { ...row({ id: 2 }), scope: 'vehicle', category: 'damage', plate: 'RBE26H', rental_firm: '',
    for_plate: '', supplier: 'Mekonomen', handled_by: 'okq8', shop_in: '2026-09-08',
    shop_out: '2026-09-11', description: 'Buckla', cost_sek: 7400 },
  { ...row({ id: 3 }), scope: 'vehicle', category: 'parts', plate: 'RPH54L', rental_firm: '',
    for_plate: '', supplier: 'Biltema', description: 'Torkarblad', cost_sek: 420 },
  { ...row({ id: 4 }), scope: 'tool', plate: '', rental_firm: '', for_plate: '',
    supplier: 'Verktygsboden', description: 'Momentnyckel', cost_sek: 899 },
  { ...row({ id: 5 }), scope: 'misc', plate: '', rental_firm: '', for_plate: '',
    supplier: 'Willys', description: 'Kaffe', cost_sek: 260 }
];
const kindsIn = html => (html.match(/class="inc-kind kind-(\w+)"/g) || [])
  .map(m => m.match(/kind-(\w+)/)[1]);

check('every tab shows all five kinds, in the same order', () => {
  for (const scope of ['vehicle', 'tool', 'misc', 'rental']) {
    const html = render(LEDGER, { filters: { scope } });
    assert.deepStrictEqual(kindsIn(html), ['rental', 'damage', 'parts', 'tool', 'misc'],
      'the ' + scope + ' tab does not show the whole ledger');
  }
});
check('the first column names the kind, and only the five exist', () => {
  assert.deepStrictEqual(Object.keys(KIND_LABEL), ['damage', 'parts', 'tool', 'misc', 'rental']);
  const html = render(LEDGER);
  Object.values(KIND_LABEL).forEach(l =>
    assert.ok(html.includes(`>${l}</span>`), 'the ledger never says ' + l));
  assert.ok(html.includes('<span class="inc-kind">Category</span>'), 'no Category heading');
});
check('the category is the FIRST column, before the date', () => {
  const head = render(LEDGER).match(/<div class="inc-row inc-head">([\s\S]*?)<\/div>/)[1];
  const order = [...head.matchAll(/<span class="inc-(\w+)"/g)].map(m => m[1]);
  assert.strictEqual(order[0], 'kind', 'Category must come first: ' + order.join(', '));
  assert.strictEqual(order[1], 'date');
});
check('a line can be read and approved from here, and Edit opens it on its own tab', () => {
  const html = render(LEDGER);
  assert.strictEqual((html.match(/class="inc-line inc-read/g) || []).length, 5, 'five lines');
  assert.strictEqual(
    (html.match(/<form class="inc-form" method="post" action="\/admin\/incidents\/\d+\/sm"/g) || []).length,
    5, 'every line should be approvable from the ledger');
  assert.ok(html.includes('href="/admin/expenses?scope=vehicle&amp;edit=2#row-2"'),
    'no Edit link to the damage line');
  assert.ok(html.includes('href="/admin/expenses?scope=rental&amp;edit=1#row-1"'),
    'no Edit link to the hire');
  // Nothing on a read-only line may be typed into except the approver's name.
  const list = html.split('class="inc-list inc-list-all"')[1].split('</div>\n    </div>')[0];
  const fields = [...list.matchAll(/name="(\w+)"/g)].map(m => m[1]);
  assert.deepStrictEqual([...new Set(fields)].sort(), ['ret', 'smBy'],
    'the ledger lines must not be editable in place: ' + fields.join(', '));
});
check('opening one line leaves the others alone', () => {
  const html = editing(LEDGER, 2);
  assert.deepStrictEqual(kindsIn(html), ['rental', 'parts', 'tool', 'misc'],
    'the opened line should be drawn as its section\u2019s line, not as a ledger line');
  assert.ok(html.includes('id="row-2"'), 'the opened line has no anchor');
  assert.ok(html.includes('>Workshop in</span>'), 'a vehicle opens with the workshop columns');
  assert.ok(html.includes('Editing this line'), 'nothing says which line is open');
});
check('a hire car says which van it stands in for', () => {
  const html = render(LEDGER);
  assert.ok(html.includes('(for RBE26H)'), 'the van the hire covers is not on the line');
});

check('the money in brackets adds up to the total in front of them', () => {
  const totals = { withCost: 4, cost: 8979, damageCost: 7400, partsCost: 420, toolCost: 899,
    miscCost: 260, rentalCost: 0, waiting: 4, atShop: 0, outNow: 0 };
  const html = render(LEDGER, { totals });
  // kr() separates thousands with a non-breaking space, hence the dot.
  const line = html.match(/8.979 kr total \(([^)]*)\)/);
  assert.ok(line, 'no breakdown after the total');
  const parts = line[1].split(' \u00b7 ').map(p => Number(p.replace(/[^\d]/g, '')));
  assert.strictEqual(parts.reduce((a, b) => a + b, 0), 8979,
    'the brackets do not add up to the total: ' + line[1]);
  assert.ok(!/hire 0 kr/.test(html), 'a kind with no money in it should not be listed');
});
check('a line opened for editing comes back to itself, not to the folded list', () => {
  const html = editing(LEDGER, 1);
  const rets = [...html.matchAll(/name="ret" value="([^"]*)"/g)].map(m => m[1]);
  assert.ok(rets.some(r => r.includes('edit=1') && r.includes('#row-1')),
    'the opened line must post back to itself: ' + rets.join(' | '));
  assert.ok(rets.some(r => !r.includes('edit=')), 'the other lines must not reopen it');
});
check('a line with more files than fit says so', () => {
  const many = [1, 2, 3, 4, 5, 6].map(id => ({ id, kind: 'photo', filename: `p${id}.jpg`,
    mime: 'image/jpeg', byte_size: 1000, uploaded_at: '2026-09-16T08:00:00Z', taken_at: null }));
  const html = render([row({ files: many })]);
  assert.strictEqual((html.match(/class="fileicon/g) || []).length, 4, 'four icons, no more');
  assert.ok(html.includes('>+2</span>'), 'nothing says two files are not shown');
});

console.log(fails ? `\n${fails} FAILED\n` : '\nall green\n');
process.exit(fails ? 1 : 0);
