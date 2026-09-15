'use strict';
/* Does the masked name survive the Arabic page?
 *
 * "Simon B****" is a Latin phrase with four neutral characters on the end. On
 * a right-to-left page the bidi algorithm gives those stars to the paragraph,
 * not to the name, and lays the two halves out right-to-left -- the driver
 * reads "**** B Simon". i18n.isolate is what stops it; this test proves it by
 * rendering the real page in Chromium and reading the characters back in the
 * order they appear on screen, left to right.
 *
 * Needs Playwright, which is not a dependency of this app. Point PLAYWRIGHT at
 * an installation (or install it) and run:  node tests/mask-bidi.test.js
 */
let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT || 'playwright'));
} catch (e) {
  console.log('Playwright not found -- set PLAYWRIGHT to its path. Skipping.');
  process.exit(0);
}
const { formPage } = require('../src/views/form');
const { receiptPage } = require('../src/views/receipt');
const roster = require('../data/drivers.json').drivers.map(d => d.name);

const FIELDS = [
  { id: 1, name: 'forare', kind: 'select', label: 'Förare', section: 'Innan', required: true,
    role: 'driver', source: 'drivers', options: [], i18n: {} },
  { id: 3, name: 'ljus', kind: 'yesno', label: 'Fungerar ljusen?', section: 'Innan', required: true,
    role: '', options: [], alert_on: ['nej'], i18n: {} }
];
const form = { id: 7, key: 'box', title: 'Säkerhetskontroll', fields: FIELDS };
const vehicle = { plate: 'ABC12D', owner: 'Egen' };
const assignment = { list: [{ driver: 'Simon Bergman', route: 'JK-EM-3' }, { driver: 'Alvar Björk', route: 'JK-EM-1' }], one: null };
const week = { from: '2026-09-08', to: '2026-09-14', days: [
  { date: '2026-09-12', assigned: [{ driver: 'Simon Bergman', route: 'JK-EM-3' }], checks: [{ driver: 'Amanda Claesson', swapped: true }] }
] };

const formHtml = formPage({ vehicle, form, sources: { drivers: roster }, assignment, week,
  openedAt: Date.now(), lastCheck: null, lang: 'ar', board: null });

const submission = { id: 412, plate: 'ABC12D', submitted_at: new Date('2026-09-14T05:40:00Z'),
  form_title: 'Säkerhetskontroll', photos: [], questions: FIELDS,
  answers: { forare: 'Simon Bergman', ljus: { choice: 'ja' } } };
const recHtml = receiptPage({ submission, fallbackFields: FIELDS, lang: 'ar' });

function visualScript() {
  window.__visual = function (sel) {
    const node = document.querySelector(sel);
    if (!node) return null;
    const out = [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = walker.nextNode())) {
      for (let i = 0; i < t.data.length; i++) {
        const r = document.createRange();
        r.setStart(t, i); r.setEnd(t, i + 1);
        const rect = r.getBoundingClientRect();
        if (!rect.width) continue;
        out.push({ ch: t.data[i], x: rect.left });
      }
    }
    out.sort((a, b) => a.x - b.x);
    return out.map(o => o.ch).join('').replace(/[⁨⁩]/g, '');
  };
}

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  let bad = 0;
  const say = (what, got, mustContain) => {
    const ok = got && got.includes(mustContain);
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}: ${JSON.stringify(got)}`);
  };

  await p.setContent(formHtml);
  await p.evaluate(visualScript);
  console.log('\nArabic form (characters read left to right):');
  say('assign line', await p.evaluate(() => window.__visual('.assign-line')), 'Simon B****');
  say('week, assigned', await p.evaluate(() => window.__visual('.week-list li .wa')), 'Simon B****');
  say('week, checked', await p.evaluate(() => window.__visual('.week-list li .wc')), 'Amanda C****');
  // #changeQ sits inside the hidden change box, so it has no rects to measure;
  // its wording goes through i18n.fill, which fences the name the same way.
  say('change question (text, box is hidden)',
    await p.evaluate(() => (document.querySelector('#changeQ').textContent || '').replace(/[\u2068\u2069]/g, '')),
    'Simon B****');

  await p.setContent(recHtml);
  await p.evaluate(visualScript);
  console.log('\nArabic receipt:');
  say('driver cell', await p.evaluate(() => window.__visual('table.kv tr:first-child td:last-child')), 'Simon B****');

  await p.close(); await b.close();
  console.log(bad ? `\n${bad} FAILED\n` : '\nall green\n');
  process.exit(bad ? 1 : 0);
})();
