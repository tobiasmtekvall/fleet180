'use strict';
/* The per-model warning-light lists and the manual link on the vehicle page.
 *
 *   node tests/lights.test.js
 *
 * Checks the shape of every list, that every lamp and icon it names exists,
 * that the hosted PDFs are actually there, and that a van of each model
 * renders its own list and its own manual. mask-bidi.test.js does the same
 * kind of check for the Arabic layout.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const t = require('../src/telltales');
const seed = require('../src/seed');
const { formPage } = require('../src/views/form');
const i18n = require('../src/i18n');

let fails = 0;
const check = (what, fn) => {
  try { fn(); console.log('  ok   ' + what); }
  catch (e) { fails++; console.log('  FAIL ' + what + '\n       ' + e.message); }
};

const REAL = t.MODEL_KEYS.filter(k => k !== 'generic');

console.log('\n1. the lists');
for (const k of REAL) {
  check(`${k}: every code and icon exists, red before amber, no repeats`, () => {
    const m = t.MODELS[k];
    const codes = m.lights.map(l => l[0]);
    assert.deepStrictEqual(codes.filter(c => !t.LAMPS[c]), [], 'unknown lamp code');
    assert.deepStrictEqual(codes.filter((c, i) => codes.indexOf(c) !== i), [], 'repeated lamp');
    assert.ok(!/ar/.test(m.lights.map(l => l[1]).join('')), 'a red lamp sits after an amber one');
    t.lightsFor(k).forEach(l => assert.ok(t.ICONS[l.icon], 'no icon: ' + l.icon));
    assert.ok(codes[codes.length - 1] === 'other', 'the list must end with "other"');
    assert.ok(codes.length >= 25, 'only ' + codes.length + ' lamps');
    assert.ok(m.source && m.source.length > 40, 'no source for the list');
  });
}
check('the lists differ from one another — this is the whole point', () => {
  const seen = new Map();
  for (const k of REAL) {
    const sig = t.MODELS[k].lights.map(l => l[0]).join(',');
    if (seen.has(sig)) throw new Error(`${k} has exactly the same list as ${seen.get(sig)}`);
    seen.set(sig, k);
  }
});
check('every lamp in the catalogue reads in all four languages', () => {
  for (const [code, l] of Object.entries(t.LAMPS)) {
    for (const c of ['sv', 'en', 'ar', 'hi']) {
      assert.ok(l[c] && String(l[c]).trim(), `${code} has no ${c}`);
    }
  }
});
check('lampText reads a stored code back in each language', () => {
  assert.strictEqual(t.lampText('tailLift', 'sv'), 'Bakgavellyft / ramp');
  assert.strictEqual(t.lampText('ebd', 'en'), 'Brake force distribution (EBD) fault');
  assert.strictEqual(t.lampText('nosuchlamp', 'sv'), 'nosuchlamp');
});

console.log('\n2. the fleet');
check('every van in the seed has a model that exists', () => {
  for (const v of seed.DEFAULT_VEHICLES) {
    assert.ok(v.modelKey && t.MODELS[v.modelKey], `${v.plate} has no usable model`);
  }
});
check('RLX94L is gone and RLX94A is there', () => {
  const plates = seed.DEFAULT_VEHICLES.map(v => v.plate);
  assert.ok(!plates.includes('RLX94L'), 'the plate that exists in no register is still here');
  assert.ok(plates.includes('RLX94A'));
});
check('the fleet is 22 vans, and the model split matches the register', () => {
  const by = {};
  for (const v of seed.DEFAULT_VEHICLES) by[v.modelKey] = (by[v.modelKey] || 0) + 1;
  assert.strictEqual(seed.DEFAULT_VEHICLES.length, 22);
  assert.deepStrictEqual(by, {
    'iveco-daily': 12, 'toyota-proace-max': 3, 'mb-vito': 4,
    'mb-sprinter': 1, 'citroen-jumpy': 1, 'peugeot-expert': 1
  });
});

console.log('\n3. the manuals');
const MANUALS = path.join(__dirname, '..', 'public', 'manualer');
for (const k of REAL) {
  check(`${k}: the PDF it points at is really in public/manualer/`, () => {
    const man = t.manualFor(k, '');
    assert.ok(man && man.file, 'no manual on the model');
    const file = path.join(MANUALS, man.file);
    assert.ok(fs.existsSync(file), 'missing file: ' + man.file);
    const size = fs.statSync(file).size;
    assert.ok(size > 100 * 1024, man.file + ' is suspiciously small');
    assert.ok(size < 20 * 1024 * 1024, man.file + ' is too big to open on 4G');
    assert.strictEqual(fs.readFileSync(file, { encoding: 'latin1', flag: 'r' }).slice(0, 5), '%PDF-');
  });
}
check('a vehicle can override its own manual, and rubbish is refused', () => {
  assert.strictEqual(t.manualFor('iveco-daily', 'annat.pdf').file, 'annat.pdf');
  assert.strictEqual(t.manualFor('iveco-daily', '').file, 'iveco-daily-varningslampor.pdf');
  assert.strictEqual(t.manualFor('generic', ''), null);
});

console.log('\n4. the vehicle page');
function pageFor(key, lang) {
  const lights = t.lightsFor(key);
  const blob = {};
  for (const c of i18n.CODES) {
    blob[c] = { commentOptions: lights.map(l => l[c] || l.sv), pickLabel: t.PICK_LABEL[c] };
  }
  const fields = [
    { id: 1, name: 'lampor', kind: 'yesno', label: 'Lyser någon varningslampa?',
      section: 'Innan', required: true, role: '', options: [], alert_on: ['ja'],
      comment_source: 'lights', comment_options: lights.map(l => l.code), lights, i18n: blob }
  ];
  const html = formPage({
    vehicle: { plate: 'TEST01', owner: 'own' },
    form: { id: 1, key: 'box', title: 'Säkerhetskontroll', fields },
    sources: {}, assignment: null, week: null, board: null, lastCheck: null,
    openedAt: Date.now(), lang: lang || 'sv',
    manual: t.manualFor(key, '')
  });
  // fill() fences an interpolated plate in U+2068/U+2069 so Arabic cannot take
  // it apart; strip them here so the assertions read as the driver sees it.
  return html.replace(/[\u2068\u2069]/g, '');
}
for (const k of REAL) {
  check(`${k}: the page draws this model's lamps and links this model's manual`, () => {
    const html = pageFor(k);
    const man = t.manualFor(k, '');
    assert.ok(html.includes(`href="/manualer/${man.file}"`), 'the manual is not linked');
    assert.ok(html.includes('Instruktionsbok för TEST01'), 'no manual heading');
    const buttons = (html.match(/class="lamp lamp-/g) || []).length;
    assert.strictEqual(buttons, t.MODELS[k].lights.length, 'wrong number of symbols drawn');
    const opts = (html.match(/id="lampor__pick"[\s\S]*?<\/select>/) || [''])[0];
    t.MODELS[k].lights.forEach(([code]) =>
      assert.ok(opts.includes(`value="${code}"`), 'missing from the list: ' + code));
  });
}
check('the Sprinter and the Vito do not get each other’s list', () => {
  const s = pageFor('mb-sprinter'), v = pageFor('mb-vito');
  assert.ok(s.includes('value="diff"') && !s.includes('value="airSuspension"'),
    'the Sprinter should have the transfer case, not the air suspension');
  assert.ok(v.includes('value="airSuspension"') && !v.includes('value="diff"'),
    'the Vito should have AIRMATIC, not the 4MATIC lamp');
});
check('the IVECO list carries the tail lift and the Stellantis vans do not', () => {
  assert.ok(pageFor('iveco-daily').includes('value="tailLift"'));
  assert.ok(!pageFor('citroen-jumpy').includes('value="tailLift"'));
});
check('a van with no model set shows the shared list and no manual', () => {
  const html = pageFor('');
  assert.ok(!html.includes('/manualer/'), 'an unknown van must not link a manual');
  assert.ok(html.includes('value="other"'), 'it should still offer the shared list');
});
check('the manual link survives the other three languages', () => {
  for (const lang of ['en', 'ar', 'hi']) {
    const html = pageFor('mb-vito', lang);
    assert.ok(html.includes('href="/manualer/mb-vito-447-varningslampor.pdf"'), lang);
    assert.ok(html.includes(`data-t-${lang}=`), 'no translations written into the page');
  }
});

console.log(fails ? `\n${fails} FAILED\n` : '\nall green\n');
process.exit(fails ? 1 : 0);
