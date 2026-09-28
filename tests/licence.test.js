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
check('tag and company come off, company goes in brackets', () => {
  const cv = s => L.courierValue(L.parseCourier(s));
  assert.strictEqual(cv('(EXT) Flexio Abdo Ghannoum'), 'Abdo Ghannoum (Flexio)');
  assert.strictEqual(cv('(3PL) Kraft Guld Naveen Jacob'), 'Naveen Jacob (Kraft Guld)');
  assert.strictEqual(cv('[3PL] Fleetforce Bemanning Ali Hassan'), 'Ali Hassan (Fleetforce Bemanning)');
  assert.strictEqual(cv('Sara Molin'), 'Sara Molin');
});
check('an unknown company is not cut off, nor a name that starts like one', () => {
  const cv = s => L.courierValue(L.parseCourier(s));
  assert.strictEqual(cv('(EXT) Newco Anna Berg'), 'Newco Anna Berg');
  assert.strictEqual(cv('Boxflowen Test'), 'Boxflowen Test');
});

console.log('\n2. the link');
check('the same link the extension builds, byte for byte', () => {
  assert.strictEqual(L.prefillUrl({ terminal: 'Jönköping', registration: 'HJA34R', route: 'JKP-EM-6-RR',
    courier: 'Wille Zäther (Boxflow)' }),
    'https://docs.google.com/forms/d/e/1FAIpQLSfhF1u6mXWSNICHMrFr_uRg9xoQFySDkgheAtaaXwpaUhww7w/viewform' +
    '?usp=pp_url&entry.2145116271=J%C3%B6nk%C3%B6ping&entry.1069125218=HJA34R&entry.414178441=JKP-EM-6-RR' +
    '&entry.1449088697=Wille+Z%C3%A4ther+%28Boxflow%29&entry.1672312795=Yes&entry.1186095297=Yes' +
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
  assert.strictEqual(o[0].courier, 'Wille Zäther (Boxflow)');
  assert.strictEqual(o[1].courier, 'Abdo Ghannoum');
  assert.strictEqual(o[0].terminal, 'Jönköping');
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
