'use strict';
/* License control (Box): the prefill link and the page.
 *
 *   node tests/licence.test.js
 *
 * No database. The link is the whole feature -- the Google form trusts every
 * value in it -- so what goes into it is checked here field by field. Entry
 * ids were read off the live "Arrival Inspection Box" form on 2026-09-28.
 */
const assert = require('assert');
const L = require('../src/licence');
const { licencePage } = require('../src/views/licence');

let fails = 0;
const check = (what, fn) => {
  try { fn(); console.log('  ok   ' + what); }
  catch (e) { fails++; console.log('  FAIL ' + what + '\n       ' + e.message); }
};
const q = url => new URL(url).searchParams;

console.log('\n1. the Planday name');
check('Courier/Company is the company alone: Flexio, Boxflow, or empty', () => {
  const cv = s => L.courierValue(L.parseCourier(s));
  assert.strictEqual(cv('(EXT) Flexio Abdo Ghannoum'), 'Flexio');
  assert.strictEqual(cv('(EXT) Boxflow Belal Abdalla'), 'Boxflow');
  assert.strictEqual(cv('(BOX) Boxflow Hussein Al-lami'), 'Boxflow');
  assert.strictEqual(cv('Sara Molin'), '', 'an internal driver gets no company and no name');
  assert.strictEqual(L.parseCourier('(EXT) Flexio Abdo Ghannoum').name, 'Abdo Ghannoum');
});
check('only Flexio and Boxflow are companies; anything else stays in the name', () => {
  const p = L.parseCourier('(3PL) Kraft Guld Naveen Jacob');
  assert.strictEqual(p.company, '');
  assert.strictEqual(L.courierValue(p), '');
});
check('an unknown company is not a company, nor a name that starts like one', () => {
  const cv = s => L.courierValue(L.parseCourier(s));
  assert.strictEqual(cv('(EXT) Newco Anna Berg'), '');
  assert.strictEqual(cv('Boxflowen Test'), '');
});

console.log('\n2. the link');
check('the same link the extension builds, byte for byte', () => {
  assert.strictEqual(L.prefillUrl({ terminal: 'Jönköping', registration: 'HJA34R', route: 'JKP-EM-6-RR',
    courier: 'Boxflow' }),
    'https://docs.google.com/forms/d/e/1FAIpQLSfhF1u6mXWSNICHMrFr_uRg9xoQFySDkgheAtaaXwpaUhww7w/viewform' +
    '?usp=pp_url&entry.2145116271=J%C3%B6nk%C3%B6ping&entry.1069125218=HJA34R&entry.414178441=JKP-EM-6-RR' +
    '&entry.1449088697=Boxflow&entry.1672312795=Yes&entry.1186095297=Yes' +
    '&entry.1685393160=Yes&entry.1835434897=Yes&entry.848372024=Yes&entry.1897586744=Yes&entry.214106876=Yes');
});
check('seven Yes, the two tailgate questions included', () => {
  const p = q(L.prefillUrl({}));
  assert.strictEqual(L.INSPECTION.length, 7);
  ['1685393160', '214106876'].forEach(id => assert.strictEqual(p.get('entry.' + id), 'Yes'));
});
check('a terminal the box form does not offer is left out, not sent', () => {
  assert.ok(!q(L.prefillUrl({ terminal: 'Härryda' })).has('entry.2145116271'));
});
check('empty values are left out', () => {
  const p = q(L.prefillUrl({ terminal: '', registration: '', route: '', courier: '' }));
  ['2145116271', '1069125218', '414178441', '1449088697'].forEach(id => assert.ok(!p.has('entry.' + id)));
});

console.log('\n3. the options');
check('sorted by route number, courier from the Planday name, roster name as fallback', () => {
  const o = L.optionsFor([
    { route: 'JKP-EM-10-RR', plate: 'ELZ35L', driver: 'Abdo Ghannoum', courier: '' },
    { route: 'JKP-EM-6-RR', plate: 'HJA34R', driver: 'Wille Zäther', courier: '(EXT) Boxflow Wille Zäther' }
  ]);
  assert.deepStrictEqual(o.map(x => x.route), ['JKP-EM-6-RR', 'JKP-EM-10-RR']);
  assert.strictEqual(o[0].courier, 'Boxflow');
  assert.strictEqual(o[0].driver, 'Wille Zäther');
  assert.strictEqual(o[1].courier, '', 'no Planday name: no company, and never the driver');
  assert.strictEqual(o[0].terminal, 'Jönköping');
});
check('the Company column: Flexio, Boxflow, or none', () => {
  const html = licencePage({ days: [{ date: '2026-09-28', n: 3 }], date: '2026-09-28', newest: '2026-09-28', today: '2026-09-28', nav: '',
    options: L.optionsFor([
      { route: 'JKP-EM-1-RR', plate: 'A', driver: 'Abdo Ghannoum', courier: '(EXT) Flexio Abdo Ghannoum' },
      { route: 'JKP-EM-5-RR', plate: 'B', driver: 'Belal Abdalla', courier: '(EXT) Boxflow Belal Abdalla' },
      { route: 'JKP-EM-9-RR', plate: 'C', driver: 'Simon Bergman', courier: 'Simon Bergman' }] ) });
  const cells = [...html.matchAll(/<td>(<span class="(?:dl-co[^"]*|muted)">[^<]*<\/span>)<\/td>/g)].map(m => m[1].replace(/<[^>]+>/g, ''));
  assert.deepStrictEqual(cells.slice(0, 3), ['Flexio', 'Boxflow', '—']);
  assert.ok(html.includes('entry.1449088697=Flexio&amp;'));
  assert.ok(html.includes('entry.1449088697=Boxflow&amp;'));
  // Simon has no company: his link carries no Courier/Company at all.
  const simon = html.match(/entry\.414178441=JKP-EM-9-RR[^"]*/)[0];
  assert.ok(!simon.includes('entry.1449088697'), simon);
  assert.ok(!/entry\.1449088697=[^&"]*(Abdo|Belal|Simon)/.test(html), 'a driver name reached the field');
});
check('a prefix nobody named gets no terminal', () => {
  assert.strictEqual(L.terminalFromRoute('MTP-EM-1-RR'), '');
});

console.log('\n4. the page');
const days = [{ date: '2026-09-29', n: 1 }, { date: '2026-09-28', n: 1 }];
check('a hostile name cannot end the script or add markup', () => {
  const html = licencePage({ days, date: '2026-09-28', newest: '2026-09-29', nav: '',
    options: L.optionsFor([{ route: 'JKP-EM-2-RR', plate: 'X', driver: 'x',
      courier: '(EXT) Flexio </script><img src=x onerror=alert(1)>' }]) });
  assert.strictEqual((html.match(/<\/script>/g) || []).length, 1);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('not the newest day'));
});
check('a day that is not today says so', () => {
  const opts = L.optionsFor([{ route: 'JKP-EM-4-RR', plate: 'BPM38R', driver: 'Sara Molin' }]);
  const later = licencePage({ days, date: '2026-09-29', newest: '2026-09-29', today: '2026-09-28', nav: '', options: opts });
  assert.ok(/not today \(2026-09-28\) – the plan for a coming day/.test(later));
  const same = licencePage({ days, date: '2026-09-29', newest: '2026-09-29', today: '2026-09-29', nav: '', options: opts });
  assert.ok(!same.includes('not today'));
});
check('no assignment: says where to send one from, no script', () => {
  const html = licencePage({ days: [], date: '', newest: '', options: [], nav: '' });
  assert.ok(html.includes('Send this list to Fleet 180'));
  assert.ok(!html.includes('<script>'));
});

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
