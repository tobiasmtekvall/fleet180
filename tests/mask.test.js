'use strict';
/* src/mask.js, and the driver-facing pages that use it.
 *
 * Node only, no database and no dependencies:  node tests/mask.test.js
 * The Arabic layout of the same names is checked in mask-bidi.test.js.
 */
const assert = require('assert');
const { maskName, maskNames } = require('../src/mask');
const { formPage } = require('../src/views/form');
const { receiptPage } = require('../src/views/receipt');
const roster = require('../data/drivers.json').drivers.map(d => d.name);

let fails = 0;
function check(what, fn) {
  try { fn(); console.log('  ok   ' + what); }
  catch (e) { fails++; console.log('  FAIL ' + what + '\n       ' + e.message); }
}

console.log('\n1. maskName');
check('Simon Bergman -> Simon B****', () => assert.strictEqual(maskName('Simon Bergman'), 'Simon B****'));
check('Swedish letter survives', () => assert.strictEqual(maskName('Alvar Björk'), 'Alvar B****'));
check('Ö as an initial', () => assert.strictEqual(maskName('Anne-Marie Öberg'), 'Anne-Marie Ö****'));
check('long surname is still four stars', () => assert.strictEqual(maskName('Deepesh Madathiparambil'), 'Deepesh M****'));
check('two-letter surname is four stars too', () => assert.strictEqual(maskName('Simon Bo'), 'Simon B****'));
check('two surnames both masked', () => assert.strictEqual(maskName('Ali Ben Hassan'), 'Ali B**** H****'));
check('first name alone is untouched', () => assert.strictEqual(maskName('Simon'), 'Simon'));
check('empty / null / dash', () => {
  assert.strictEqual(maskName(''), '');
  assert.strictEqual(maskName(null), '');
  assert.strictEqual(maskName(undefined), '');
  assert.strictEqual(maskName('—'), '—');
});
check('extra whitespace collapses', () => assert.strictEqual(maskName('  Simon   Bergman '), 'Simon B****'));
check('maskNames over the real roster leaves no surname whole', () => {
  const masked = maskNames(roster);
  assert.strictEqual(masked.length, roster.length);
  roster.forEach((full, i) => {
    const surnames = full.trim().split(/\s+/).slice(1);
    const first = full.trim().split(/\s+/)[0];
    surnames.forEach(s => {
      // "Ahmed Ahmed": the surname is spelled like the first name, which is
      // kept whole by design -- nothing leaked there.
      if (s.length > 1 && s !== first) assert.ok(!masked[i].includes(s), full + ' -> ' + masked[i]);
    });
    assert.ok(masked[i].startsWith(full.trim().split(/\s+/)[0]), full + ' -> ' + masked[i]);
  });
  console.log('       e.g. ' + masked.slice(0, 4).join(' · '));
});

/* ---- a rendered form ------------------------------------------------- */
const FIELDS = [
  { id: 1, name: 'forare', kind: 'select', label: 'Förare', section: 'Innan', required: true,
    role: 'driver', source: 'drivers', options: [], i18n: {} },
  { id: 2, name: 'rutt', kind: 'select', label: 'Rutt', section: 'Innan', required: true,
    role: 'route', source: '', options: ['JK-EM-1', 'JK-EM-2'], i18n: {} },
  { id: 3, name: 'ljus', kind: 'yesno', label: 'Fungerar ljusen?', section: 'Innan', required: true,
    role: '', options: [], alert_on: ['nej'], i18n: {} }
];
const form = { id: 7, key: 'box', title: 'Säkerhetskontroll', fields: FIELDS };
const vehicle = { plate: 'ABC12D', owner: 'Egen' };
const sources = { drivers: roster };
const assignment = { list: [{ driver: 'Simon Bergman', route: 'JK-EM-3' }], one: { driver: 'Simon Bergman', route: 'JK-EM-3' } };
const week = { from: '2026-09-08', to: '2026-09-14', days: [
  { date: '2026-09-12', assigned: [{ driver: 'Alvar Björk', route: 'JK-EM-1' }],
    checks: [{ driver: 'Amanda Claesson', swapped: true }] },
  { date: '2026-09-14', assigned: [{ driver: 'Simon Bergman', route: 'JK-EM-3' }], checks: [] }
] };

const strip = h => h.replace(/[\u2068\u2069]/g, '');
const htmlRaw = formPage({ vehicle, form, sources, assignment, week, openedAt: Date.now(),
  lastCheck: '2026-09-13 06:12 – Amanda C****', lang: 'sv', board: null });
const html = strip(htmlRaw);

console.log('\n2. the driver-facing form');
check('the dropdown label is masked', () => assert.ok(html.includes('>Simon B****</option>'), 'no masked option'));
check('the dropdown value is the real name', () => assert.ok(html.includes('value="Simon Bergman"'), 'no full value'));
check('no surname is readable outside an option value or data-assigned', () => {
  const stripped = html
    .replace(/value="[^"]*"/g, 'value="."')
    .replace(/data-assigned="[^"]*"/g, 'data-assigned="."')
    .replace(/data-key="[^"]*"/g, 'data-key="."');
  const leaked = roster
    .filter(n => { const p = n.trim().split(/\s+/); return p.length > 1 && p[1] !== p[0]; })
    .map(n => n.trim().split(/\s+/).slice(1).join(' '))
    .filter(s => s.length > 2 && stripped.includes(s));
  assert.deepStrictEqual(leaked, [], 'leaked: ' + leaked.join(', '));
});
check('the assignment line is masked', () => {
  assert.ok(/class="assign-line"[^>]*>[^<]*Simon B\*\*\*\*/.test(html) || html.includes('Simon B****'), 'assign line');
  assert.ok(!/class="assign-line"[^>]*>[^<]*Bergman/.test(html));
});
check('the change question keeps the real names on data-assigned', () =>
  assert.ok(html.includes('data-assigned="Simon Bergman"'), 'data-assigned must stay whole'));
check('the week list is masked', () => {
  const box = html.slice(html.indexOf('<details class="week-box'), html.indexOf('</details>'));
  assert.ok(box.includes('Alvar B****') && box.includes('Amanda C****'), 'week names not masked');
  assert.ok(!box.includes('Björk') && !box.includes('Claesson'), 'week list leaks a surname');
  assert.ok(box.includes('Simon B****') && !box.includes('Bergman'));
});
check('the last-check line carries what the server masked', () =>
  assert.ok(html.includes('Amanda C****')));

const preview = strip(formPage({ vehicle, form, sources, preview: true, lang: 'sv',
  assignment: null, week: null, board: null }));
console.log('\n3. the admin preview');
check('keeps the roster unmasked', () => {
  assert.ok(preview.includes('>Simon Bergman</option>'), 'preview should not mask');
  assert.ok(!preview.includes('Simon B****'));
});

/* ---- the receipt ----------------------------------------------------- */
console.log('\n4. the receipt');
const submission = {
  id: 412, plate: 'ABC12D', submitted_at: new Date('2026-09-14T05:40:00Z'),
  form_title: 'Säkerhetskontroll', photos: [],
  questions: FIELDS,
  answers: { forare: 'Simon Bergman', rutt: 'JK-EM-3', ljus: { choice: 'ja' } }
};
const rec = strip(receiptPage({ submission, fallbackFields: FIELDS, lang: 'sv' }));
check('the name reads masked', () => assert.ok(rec.includes('Simon B****')));
check('the full surname is gone', () => assert.ok(!rec.includes('Bergman')));
check('the route is untouched', () => assert.ok(rec.includes('JK-EM-3')));

const old = JSON.parse(JSON.stringify(submission));
old.questions = FIELDS.map(f => { const c = { ...f }; delete c.role; return c; });
old.submitted_at = submission.submitted_at;
const recOld = strip(receiptPage({ submission: old, fallbackFields: FIELDS, lang: 'sv' }));
check('an old snapshot with no role still masks (source: drivers)', () => {
  assert.ok(recOld.includes('Simon B****'));
  assert.ok(!recOld.includes('Bergman'));
});

console.log(fails ? `\n${fails} FAILED\n` : '\nall green\n');
process.exit(fails ? 1 : 0);
