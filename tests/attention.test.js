'use strict';
/* The attention report: what is still wrong with the vans.
 *
 *   node tests/attention.test.js
 *
 * No database. What this file is checking is the one thing the report is for
 * -- that a fault reported once does not disappear the next morning, and that
 * nothing leaves the list except a person saying it is done -- so the rules
 * live in src/attention.js and are asked directly, rather than by reading
 * colours out of the page.
 */
const assert = require('assert');
const a = require('../src/attention');
const { attentionPage } = require('../src/views/attention');
const wheels = require('../src/wheels');

let fails = 0;
const check = (what, fn) => {
  try { fn(); console.log('  ok   ' + what); }
  catch (e) { fails++; console.log('  FAIL ' + what + '\n       ' + e.message); }
};

const TODAY = '2026-09-18';

/* Swedish local time: 07:30 UTC is 09:30 in Stockholm, so the day of a
   timestamp is never in doubt in these fixtures. */
const at = day => new Date(`${day}T07:30:00Z`);

const FORM = [
  { name: 'f1', kind: 'select', label: 'Förare', role: 'driver', alert_on: [] },
  { name: 'f5', kind: 'yesno', label: 'Har du orsakat någon ny yttre skada?', role: 'damage',
    alert_on: ['ja'], i18n: { en: { label: 'Any new damage to the outside?' } } },
  { name: 'f8', kind: 'yesno', label: 'Är belysningen hel?', alert_on: ['nej'],
    comment_options: ['Halvljus – höger fram', 'Bromsljus – vänster bak'],
    i18n: { en: { label: 'Is the lighting in order?' } } },
  { name: 'f9', kind: 'yesno', label: 'Lyser någon varningslampa?', alert_on: ['ja'],
    comment_source: 'lights', comment_options: ['engineOil', 'absFault'],
    i18n: { en: { label: 'Is a warning light on?' } } },
  { name: 'f12', kind: 'yesno', label: 'Är hytten städad?', alert_on: ['nej'],
    i18n: { en: { label: 'Is the cab clean?' } } }
];

const VEHICLES = [
  { plate: 'RJC29S', owner: 'own', fleet: 'box', fitted_season: 'summer', created_at: '2026-01-05T00:00:00Z' },
  { plate: 'BPM38R', owner: 'okq8', fleet: 'box', fitted_season: '', created_at: '2026-01-05T00:00:00Z' },
  { plate: 'TTJ00A', owner: '', fleet: 'home', fitted_season: 'winter', created_at: '2026-01-05T00:00:00Z' }
];

let nextId = 100;
function submission(plate, day, answers, opts = {}) {
  return {
    id: String(nextId++), plate, submitted_at: at(day),
    driver_name: opts.driver || 'Simon Bengtsson',
    answers, questions: opts.questions === undefined ? FORM : opts.questions,
    photo_count: opts.photos || 0
  };
}

const light = pick => ({ f8: { choice: 'nej', comment: '', pick } });

function build(over = {}) {
  return a.buildAttention({
    today: TODAY, vehicles: VEHICLES, fallback: FORM,
    submissions: [], assignments: [], incidents: [], wheelSets: [], clears: [],
    ...over
  });
}
const find = (report, key) => report.items.concat(report.done).find(i => i.key === key);


console.log('\n1. a fault is one item, however many people report it');

check('a flagged answer becomes an item keyed on the question and the pick', () => {
  const r = build({ submissions: [submission('RJC29S', '2026-09-15', light('Halvljus – höger fram'))] });
  const item = find(r, 'check|RJC29S|f8|Halvljus – höger fram');
  assert.ok(item, 'no item: ' + r.items.map(i => i.key).join(', '));
  assert.strictEqual(item.plate, 'RJC29S');
  assert.ok(item.title.includes('Is the lighting in order?'), 'the English question is not in the title');
  assert.ok(item.title.includes('Halvljus'), 'the title does not say WHICH light: ' + item.title);
});

check('the same fault on three days is one item, open since the first', () => {
  const r = build({ submissions: [
    submission('RJC29S', '2026-09-14', light('Halvljus – höger fram'), { driver: 'Simon B' }),
    submission('RJC29S', '2026-09-16', light('Halvljus – höger fram'), { driver: 'Ali K' }),
    submission('RJC29S', '2026-09-17', light('Halvljus – höger fram'), { driver: 'Eva N' })
  ] });
  assert.strictEqual(r.items.length, 1, 'three reports made ' + r.items.length + ' items');
  const item = r.items[0];
  assert.strictEqual(item.reports, 3);
  assert.strictEqual(item.days, 3);
  assert.strictEqual(item.firstDay, '2026-09-14', 'open since the first sighting, not the last');
  assert.strictEqual(item.lastDay, '2026-09-17');
  assert.strictEqual(item.ageDays, 4);
  assert.deepStrictEqual(item.drivers, ['Simon B', 'Ali K', 'Eva N']);
});

check('said three times and still here is promoted to act-now', () => {
  const once = build({ submissions: [submission('RJC29S', '2026-09-16', light('Halvljus – höger fram'))] });
  assert.strictEqual(once.items[0].severity, 'normal');
  const thrice = build({ submissions: [
    submission('RJC29S', '2026-09-14', light('Halvljus – höger fram')),
    submission('RJC29S', '2026-09-16', light('Halvljus – höger fram')),
    submission('RJC29S', '2026-09-17', light('Halvljus – höger fram'))
  ] });
  assert.strictEqual(thrice.items[0].severity, 'high');
});

check('two faults on one question are two items', () => {
  const r = build({ submissions: [
    submission('RJC29S', '2026-09-16', light('Halvljus – höger fram')),
    submission('RJC29S', '2026-09-16', light('Bromsljus – vänster bak'))
  ] });
  assert.strictEqual(r.items.length, 2, 'a headlight and a brake light are not one job');
});

check('the same fault on two vans is two items', () => {
  const r = build({ submissions: [
    submission('RJC29S', '2026-09-16', light('Halvljus – höger fram')),
    submission('BPM38R', '2026-09-16', light('Halvljus – höger fram'))
  ] });
  assert.strictEqual(r.items.length, 2);
});

check('rephrasing the question does not split the item in two', () => {
  /* The form editor is used. A key built from the label would start a second
     item the morning after somebody fixed a typo in the question. */
  const reworded = FORM.map(f => f.name === 'f8'
    ? { ...f, label: 'Fungerar all belysning?', i18n: { en: { label: 'Do all the lights work?' } } } : f);
  const r = build({ submissions: [
    submission('RJC29S', '2026-09-14', light('Halvljus – höger fram')),
    submission('RJC29S', '2026-09-17', light('Halvljus – höger fram'), { questions: reworded })
  ] });
  assert.strictEqual(r.items.length, 1, 'a reworded question started a second item');
  assert.ok(r.items[0].title.includes('Do all the lights work?'),
    'the item should read as the question reads now: ' + r.items[0].title);
});

check('what the driver typed is kept, but does not split the item', () => {
  const r = build({ submissions: [
    submission('RJC29S', '2026-09-14', { f8: { choice: 'nej', pick: 'Halvljus – höger fram', comment: 'blinkar' } }),
    submission('RJC29S', '2026-09-17', { f8: { choice: 'nej', pick: 'Halvljus – höger fram', comment: 'helt död nu' } })
  ] });
  assert.strictEqual(r.items.length, 1, 'two wordings of one fault made two items');
  const last = r.items[0].sightings[1];
  assert.ok(last.answer.includes('helt död nu'), 'the latest wording was lost');
});


console.log('\n2. checks filed before the columns existed');

check('a snapshot with no alert polarity borrows it from the form of today', () => {
  /* A check from August carries a snapshot with alert_on empty on everything.
     Reading it as clean is the dangerous direction to be wrong in. */
  const old = FORM.map(f => ({ ...f, alert_on: [] }));
  const r = build({ submissions: [submission('RJC29S', '2026-09-10', light('Halvljus – höger fram'), { questions: old })] });
  assert.strictEqual(r.items.length, 1, 'an old check read as clean');
});

check('a snapshot with no role still counts as damage', () => {
  const old = FORM.map(f => ({ ...f, role: '' }));
  const r = build({ submissions: [submission('RJC29S', '2026-09-16',
    { f5: { choice: 'ja', comment: 'backade i en stolpe' } }, { questions: old })] });
  assert.strictEqual(r.items[0].kind, 'damage', 'damage from before the role existed went unseen');
  assert.strictEqual(r.items[0].severity, 'high');
});

check('a snapshot with no comment_source still reads as a warning light', () => {
  const old = FORM.map(f => ({ ...f, comment_source: '' }));
  const r = build({ submissions: [submission('RJC29S', '2026-09-16',
    { f9: { choice: 'ja', pick: 'engineOil' } }, { questions: old })] });
  assert.strictEqual(r.items[0].kind, 'lamp');
  assert.strictEqual(r.items[0].severity, 'high', 'a lamp on the dashboard is not a someday job');
  assert.ok(r.items[0].title.toLowerCase().includes('oil'),
    'the lamp code was never turned into a name: ' + r.items[0].title);
});

check('a check with no snapshot at all falls back to the current form', () => {
  const r = build({ submissions: [submission('RJC29S', '2026-09-16', light('Halvljus – höger fram'), { questions: [] })] });
  assert.strictEqual(r.items.length, 1);
});

check('checks for a van that has left the fleet are dropped', () => {
  const r = build({ submissions: [submission('ESJ01Y', '2026-09-16', light('Halvljus – höger fram'))] });
  assert.strictEqual(r.items.length, 0, 'a van nobody has cannot have a fault anybody can fix');
});


console.log('\n3. nothing closes itself');

const ONE = [submission('RJC29S', '2026-09-15', light('Halvljus – höger fram'))];
const KEY = 'check|RJC29S|f8|Halvljus – höger fram';
const clear = (over = {}) => ({
  id: 1, item_key: KEY, plate: 'RJC29S', kind: 'check', title: 'Lighting',
  covers_to: new Date('2026-09-15T12:00:00Z'), cleared_by: 'Tobias',
  cleared_at: new Date('2026-09-15T12:00:00Z'), note: '', withdrawn_at: null, withdrawn_by: '',
  ...over
});

check('a later check does NOT close an item', () => {
  /* The whole reason the page exists. A driver answering "yes, they work"
     without walking round the van must not erase a real fault. */
  const r = build({ submissions: [...ONE,
    submission('RJC29S', '2026-09-17', { f8: { choice: 'ja', comment: '' } })] });
  assert.strictEqual(r.items.length, 1, 'a passing answer silently closed a fault');
  assert.strictEqual(r.items[0].open, true);
});

check('a signed-off item leaves the list', () => {
  const r = build({ submissions: ONE, clears: [clear()] });
  assert.strictEqual(r.items.length, 0);
  assert.strictEqual(r.done.length, 1);
  assert.strictEqual(r.done[0].clear.cleared_by, 'Tobias');
});

check('a report AFTER the sign-off brings it straight back', () => {
  const r = build({
    submissions: [...ONE, submission('RJC29S', '2026-09-17', light('Halvljus – höger fram'))],
    clears: [clear()]
  });
  assert.strictEqual(r.items.length, 1, '"fixed" that did not fix it must come back');
  assert.strictEqual(r.items[0].reopened, true);
  assert.strictEqual(r.items[0].firstDay, '2026-09-17',
    'a reopened item is as old as the report that reopened it, not the original');
  assert.strictEqual(r.counts.reopened, 1);
});

check('a sign-off covers only what the page was showing', () => {
  /* covers_to is the last sighting the reader could see. A check that landed
     while the page sat open on a desk is not signed off by a click that never
     saw it -- which is why the button posts the sighting, not now(). */
  const r = build({
    submissions: [...ONE, submission('RJC29S', '2026-09-15', light('Halvljus – höger fram'))]
      .map((s, i) => i === 1 ? { ...s, submitted_at: new Date('2026-09-15T14:00:00Z') } : s),
    clears: [clear()]      // covers to 12:00; the second check came at 14:00
  });
  assert.strictEqual(r.items.length, 1, 'a check filed after the page was drawn was swallowed');
});

check('withdrawing a sign-off opens the item again', () => {
  const r = build({ submissions: ONE, clears: [clear({ withdrawn_at: new Date('2026-09-16T08:00:00Z'), withdrawn_by: 'Tobias' })] });
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].open, true);
});

check('withdrawing the newer of two sign-offs does not revive the older one', () => {
  const r = build({
    submissions: ONE,
    clears: [
      clear({ id: 1 }),
      clear({ id: 2, covers_to: new Date('2026-09-16T12:00:00Z'), withdrawn_at: new Date('2026-09-17T08:00:00Z') })
    ]
  });
  assert.strictEqual(r.items.length, 1, 'taking a sign-off back left an older one standing');
});

check('the whole sign-off history is kept with the item', () => {
  const r = build({ submissions: ONE, clears: [clear({ id: 1, withdrawn_at: new Date('2026-09-16T08:00:00Z') }), clear({ id: 2 })] });
  assert.strictEqual(find(r, KEY).history.length, 2);
});


console.log('\n4. vans that went out without a check');

const ASSIGNED = day => ([
  { date: day, plate: 'RJC29S', driver: 'Simon B', route: 'JK-EM-1', fleet: 'box' },
  { date: day, plate: 'BPM38R', driver: 'Ali K', route: 'JK-EM-2', fleet: 'box' }
]);

check('an assigned van with no check that day becomes an item', () => {
  const r = build({ assignments: ASSIGNED('2026-09-17') });
  const item = find(r, 'nocheck|RJC29S');
  assert.ok(item, 'a van went out unchecked and nothing said so');
  assert.strictEqual(item.severity, 'normal');
  assert.ok(item.sightings[0].answer.includes('Simon B'), 'it does not say who had it');
});

check('a van that WAS checked that day is not on the list', () => {
  const r = build({
    assignments: ASSIGNED('2026-09-17'),
    submissions: [submission('RJC29S', '2026-09-17', { f12: { choice: 'ja' } })]
  });
  assert.ok(!find(r, 'nocheck|RJC29S'));
  assert.ok(find(r, 'nocheck|BPM38R'), 'the other van still went out unchecked');
});

check('today is never counted as a fault', () => {
  /* A van assigned at seven whose driver has not scanned the code yet is not
     a fault at half past seven, and a report that cries wolf every morning is
     a report nobody reads by Thursday. */
  const r = build({ assignments: ASSIGNED(TODAY) });
  assert.strictEqual(r.items.filter(i => i.kind === 'nocheck').length, 0);
  assert.strictEqual(r.counts.todayOutstanding, 2, 'today belongs in its own line at the top');
  assert.strictEqual(r.todayOutstanding[0].plate, 'BPM38R');
});

check("today's line clears as the checks come in", () => {
  const r = build({
    assignments: ASSIGNED(TODAY),
    submissions: [submission('RJC29S', TODAY, { f12: { choice: 'ja' } })]
  });
  assert.deepStrictEqual(r.todayOutstanding.map(t => t.plate), ['BPM38R']);
});

check('three unchecked days is an act-now item, and says how many', () => {
  const r = build({ assignments: [
    ...ASSIGNED('2026-09-15'), ...ASSIGNED('2026-09-16'), ...ASSIGNED('2026-09-17')
  ] });
  const item = find(r, 'nocheck|RJC29S');
  assert.strictEqual(item.severity, 'high');
  assert.strictEqual(item.reports, 3);
  assert.ok(item.note.includes('3 days'), item.note);
  assert.strictEqual(item.firstDay, '2026-09-15');
});

check('two routes in one van on one day is one missing check, not two', () => {
  const r = build({ assignments: [
    { date: '2026-09-17', plate: 'RJC29S', driver: 'Simon B', route: 'JK-EM-1', fleet: 'box' },
    { date: '2026-09-17', plate: 'RJC29S', driver: 'Simon B', route: 'JK-EM-9', fleet: 'box' }
  ] });
  assert.strictEqual(find(r, 'nocheck|RJC29S').reports, 1);
});


console.log('\n5. the workshop and the tyres');

check('a van at the body shop is on the report, for information', () => {
  const r = build({ incidents: [{
    id: 7, plate: 'RJC29S', scope: 'vehicle', category: 'damage', occurred_on: '2026-09-02',
    description: 'Dent in the near-side door', driver_name: 'Simon B',
    shop_in: '2026-09-10', shop_out: null
  }] });
  const item = find(r, 'shop|7');
  assert.ok(item, 'a van off the road was nowhere on the report');
  assert.strictEqual(item.severity, 'info');
  assert.ok(item.note.includes('2026-09-10'));
  assert.strictEqual(r.counts.action, 0, 'information must not be counted as work to do');
});

check('a van that came back out of the shop is off the report', () => {
  const r = build({ incidents: [{
    id: 7, plate: 'RJC29S', scope: 'vehicle', category: 'damage', shop_in: '2026-09-10',
    shop_out: '2026-09-16', description: '', driver_name: ''
  }] });
  assert.strictEqual(r.items.length, 0);
});

const SET = (plate, season, readings, retired = null) => ({
  id: `${plate}-${season}`, plate, season, retired_on: retired, readings
});
const reading = (position, depth_mm, measured_on) => ({ position, depth_mm, measured_on });

check('a tyre under 3 mm is an act-now item', () => {
  const r = build({ wheelSets: [SET('RJC29S', 'summer', [
    reading('front', 2.4, '2026-09-12'), reading('back', 5.5, '2026-09-12')
  ])] });
  const item = find(r, 'tyre|RJC29S|summer|worn');
  assert.ok(item, 'a van on bald tyres was not on the report');
  assert.strictEqual(item.severity, 'high');
  assert.ok(item.title.includes('2,4 mm'), item.title);
  assert.ok(item.sightings[0].answer.includes('back: 5,5 mm'), 'the other axle is not shown');
  assert.strictEqual(item.firstDay, '2026-09-12', 'dated the day it was measured, not today');
});

check('3 to 5 mm is a when-there-is-time item, not an emergency', () => {
  const r = build({ wheelSets: [SET('RJC29S', 'summer', [reading('front', 3.4, '2026-09-12')])] });
  assert.strictEqual(find(r, 'tyre|RJC29S|summer|soon').severity, 'low');
});

check('only the set that is ON the van is reported', () => {
  const r = build({ wheelSets: [
    SET('RJC29S', 'summer', [reading('front', 6.5, '2026-09-12')]),
    SET('RJC29S', 'winter', [reading('front', 2.1, '2026-09-12')])   // on a pallet
  ] });
  assert.ok(!find(r, 'tyre|RJC29S|winter|worn'),
    'a spare set in the store is a thing to buy tyres for, not a van to stop');
});

check('a retired set is history and is never reported', () => {
  const r = build({ wheelSets: [SET('RJC29S', 'summer', [reading('front', 1.2, '2026-08-01')], '2026-08-02')] });
  assert.strictEqual(r.items.length, 0);
});

check('a tread nobody has measured for a season asks to be measured', () => {
  const r = build({ wheelSets: [SET('RJC29S', 'summer', [reading('front', 7, '2026-05-01')])] });
  const item = find(r, 'tyre|RJC29S|summer|due');
  assert.ok(item, 'a reading four months old was treated as the truth');
  assert.strictEqual(item.severity, 'low');
  assert.ok(item.title.includes('2026-05-01'));
});

check('a fresh reading is not asked for again', () => {
  const r = build({ wheelSets: [SET('RJC29S', 'summer', [reading('front', 7, '2026-08-20')])] });
  assert.ok(!find(r, 'tyre|RJC29S|summer|due'));
});

check('clearing "not measured" buys one round, not silence and not a day', () => {
  /* The item is dated the day the measurement went stale and re-dated every
     STALE_DAYS after that, so a sign-off holds until the next round comes up
     instead of coming back tomorrow morning or never coming back at all. */
  const vehicle = VEHICLES[0];
  const first = a.staleSince('2026-05-01', vehicle, TODAY);
  assert.strictEqual(first, '2026-07-30', 'stale ' + wheels.STALE_DAYS + ' days after the reading');
  const later = a.staleSince('2026-05-01', vehicle, '2026-11-01');
  assert.strictEqual(later, '2026-10-28', 'it should come round again');
  assert.strictEqual(a.staleSince('2026-09-01', vehicle, TODAY), null, 'a fresh reading is not due');
});

check('a set nobody has ever measured is due from the day the van arrived', () => {
  const r = build({ wheelSets: [SET('RJC29S', 'summer', [])] });
  const item = find(r, 'tyre|RJC29S|summer|due');
  assert.ok(item);
  assert.ok(item.title.includes('never'), item.title);
  assert.notStrictEqual(item.firstDay, TODAY, 'dating it today would make it born already cleared');
});

check('with no fitted season recorded, the set measured last is used and it says so', () => {
  const r = build({ wheelSets: [
    SET('BPM38R', 'summer', [reading('front', 2.2, '2026-04-01')]),
    SET('BPM38R', 'winter', [reading('front', 2.4, '2026-09-12')])
  ] });
  const item = find(r, 'tyre|BPM38R|winter|worn');
  assert.ok(item, 'nothing was reported for a van whose fitted set is unknown');
  assert.ok(item.note.includes('has not been recorded'), 'the guess is not owned up to: ' + item.note);
});


console.log('\n6. the shape of the page');

check('vehicles are ordered by how bad they are, and the quiet ones are named', () => {
  const r = build({
    submissions: [
      submission('BPM38R', '2026-09-16', light('Halvljus – höger fram')),
      submission('RJC29S', '2026-09-16', { f9: { choice: 'ja', pick: 'absFault' } })
    ]
  });
  assert.deepStrictEqual(r.vehicles.map(v => v.plate), ['RJC29S', 'BPM38R', 'TTJ00A'],
    'the van with a warning light on should be first');
  assert.strictEqual(r.vehicles[2].counts.open, 0);
  assert.strictEqual(r.counts.vehicles, 2);
  assert.strictEqual(r.counts.fleet, 3);
});

check('counts separate work to do from things to know', () => {
  const r = build({
    submissions: [submission('RJC29S', '2026-09-16', light('Halvljus – höger fram'))],
    incidents: [{ id: 7, plate: 'BPM38R', scope: 'vehicle', category: 'damage',
      shop_in: '2026-09-10', shop_out: null, description: '', driver_name: '' }]
  });
  assert.strictEqual(r.counts.open, 2);
  assert.strictEqual(r.counts.action, 1);
  assert.strictEqual(r.counts.info, 1);
});

check('narrowing to one van does not change the tallies across the top', () => {
  const r = build({ submissions: [
    submission('RJC29S', '2026-09-16', light('Halvljus – höger fram')),
    submission('BPM38R', '2026-09-16', light('Halvljus – höger fram'))
  ] });
  const one = a.narrow(r, { plate: 'RJC29S' });
  assert.strictEqual(one.counts.open, 2, 'a filter that rewrote the totals could not be used to choose');
  assert.strictEqual(one.vehicles.length, 1);
  assert.strictEqual(one.items.length, 1);
});

check('"act now" narrows to the red ones only', () => {
  const r = build({ submissions: [
    submission('RJC29S', '2026-09-16', { f9: { choice: 'ja', pick: 'absFault' } }),
    submission('BPM38R', '2026-09-16', light('Halvljus – höger fram'))
  ] });
  assert.deepStrictEqual(a.narrow(r, { show: 'high' }).items.map(i => i.plate), ['RJC29S']);
});

check('the CSV carries the columns somebody would sort on', () => {
  const r = build({ submissions: [submission('RJC29S', '2026-09-14', light('Halvljus – höger fram'))] });
  const row = a.flatten(r)[0];
  assert.strictEqual(row.plate, 'RJC29S');
  assert.strictEqual(row.openSince, '2026-09-14');
  assert.strictEqual(row.ageDays, 4);
  assert.strictEqual(row.severityLabel, 'Needs action');
  assert.ok(row.latest.includes('Halvljus'));
});


console.log('\n7. the page itself');

const render = (over = {}, filters = {}) =>
  attentionPage({ report: build(over), filters, message: '', nav: '<nav></nav>' });

check('an item is drawn with a way to mark it done, and the fields to do it', () => {
  const html = render({ submissions: [submission('RJC29S', '2026-09-14', light('Halvljus – höger fram'))] });
  assert.ok(html.includes('action="/admin/attention/clear"'), 'no way to mark anything done');
  assert.ok(html.includes('name="who" required'), 'a sign-off with no name is nobody\'s');
  assert.ok(html.includes('name="covers" value="2026-09-14T07:30:00.000Z"'),
    'the form must post the sighting it was showing, not rely on the server guessing');
  assert.ok(html.includes('id="v-RJC29S"'), 'no anchor to come back to');
  assert.ok(html.includes('Open 4 days'), 'the page does not say how long it has been open');
});

check('the item title and the drivers survive into the page', () => {
  const html = render({ submissions: [
    submission('RJC29S', '2026-09-14', light('Halvljus – höger fram'), { driver: 'Simon B' }),
    submission('RJC29S', '2026-09-16', light('Halvljus – höger fram'), { driver: 'Ali K' })
  ] });
  assert.ok(html.includes('Is the lighting in order?'));
  assert.ok(html.includes('Simon B') && html.includes('Ali K'));
  assert.ok(html.includes('Reported 2 times'), 'the page hides that it has been said twice');
});

check('a van at the workshop gets no Done button', () => {
  const html = render({ incidents: [{ id: 7, plate: 'RJC29S', scope: 'vehicle', category: 'damage',
    shop_in: '2026-09-10', shop_out: null, description: 'Dent', driver_name: '' }] });
  assert.ok(html.includes('At the workshop'));
  assert.ok(!html.includes('action="/admin/attention/clear"'),
    'a second place to close a case is two places that disagree by Friday');
  assert.ok(html.includes('Expenses'), 'it should say where the case actually lives');
});

check('an empty fleet reads as an answer, not as a broken page', () => {
  const html = render();
  assert.ok(html.includes('Nothing open on any of the 3 vehicles'));
  assert.ok(html.includes('Nothing to report on 3 of 3'));
});

check('a cleared item is still readable, with who and a way back', () => {
  const html = render({ submissions: ONE, clears: [clear()] });
  assert.ok(html.includes('dealt with in the last 30 days'));
  assert.ok(html.includes('Done by Tobias'));
  assert.ok(html.includes('/admin/attention/clear/1/withdraw'), 'no way to take a sign-off back');
});

check('today\'s outstanding checks are a line, not items', () => {
  const html = render({ assignments: ASSIGNED(TODAY) });
  assert.ok(html.includes("2 of today's vans have not been checked yet"));
  assert.ok(html.includes('Counted as a fault only once the day is over'));
});

check('the window it reads is stated on the page', () => {
  assert.ok(render().includes('90 days back (from 2026-06-21)'),
    'a list that silently drops old items is worse than no list');
});

check('everything a driver wrote is escaped', () => {
  const html = render({ submissions: [submission('RJC29S', '2026-09-16',
    { f8: { choice: 'nej', pick: 'Halvljus – höger fram', comment: '<script>alert(1)</script>' } })] });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'a driver can put script into the admin page');
  assert.ok(html.includes('&lt;script&gt;'));
});

console.log(fails ? `\n${fails} FAILED\n` : '\nall green\n');
process.exit(fails ? 1 : 0);
