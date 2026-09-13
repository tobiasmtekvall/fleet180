#!/usr/bin/env node
'use strict';

/**
 * Re-copy the Checklist Calendar's pages into this repo.
 *
 *   node scripts/sync-calendar-assets.js            # copy, then report
 *   node scripts/sync-calendar-assets.js --check    # report only, change nothing
 *
 * The calendar at `prog/checklist-calendar-railway-fresh/` is the original;
 * `calendar/` here is a copy served at /kalender. Data keeps itself in step --
 * that is what the sync does -- but the PAGE does not: it is code, and code
 * travels by deploy. So when the calendar's own pages change, run this, then
 * commit and push.
 *
 * It prints what differs even when it copies, because "three files changed" is
 * the sentence that tells you whether the deploy was needed.
 *
 * `carry-forward.mjs` is copied too, and that one matters more than the rest:
 * both servers run it, and if they ever run different versions they will roll
 * items forward differently -- which is the one disagreement the sync cannot
 * reconcile, because both sides would be right.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const HERE = path.join(ROOT, 'calendar');
const SOURCE = process.env.CALENDAR_SOURCE ||
  path.resolve(ROOT, '..', 'prog', 'checklist-calendar-railway-fresh');

/* published name -> where it comes from in the calendar project */
const FILES = {
  'index.html': 'public/index.html',
  'settings.html': 'public/settings.html',
  'app.js': 'public/app.js',
  'settings.js': 'public/settings.js',
  'fleet.js': 'public/fleet.js',
  'fleet-model.js': 'public/fleet-model.js',
  'theme.js': 'public/theme.js',
  'pdf.js': 'public/pdf.js',
  'styles.css': 'public/styles.css',
  'fleet.css': 'public/fleet.css',
  'icon.svg': 'public/icon.svg',
  'carry-forward.mjs': 'carry-forward.mjs',
  // The calendar asks for /icons/eagle.png, which on his machine lives two
  // folders up in the extension. Here it is a file of its own; assets.js maps
  // the request onto it.
  'eagle.png': '../../icons/eagle.png'
};

const digest = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);

function main() {
  const check = process.argv.includes('--check');
  if (!fs.existsSync(SOURCE)) {
    console.error(`Hittar inte kalendern på ${SOURCE}.`);
    console.error('Sätt CALENDAR_SOURCE till mappen checklist-calendar-railway-fresh.');
    process.exit(2);
  }
  fs.mkdirSync(HERE, { recursive: true });

  const changed = [];
  const missing = [];
  for (const [name, rel] of Object.entries(FILES)) {
    const from = path.resolve(SOURCE, rel);
    const to = path.join(HERE, name);
    let source;
    try { source = fs.readFileSync(from); } catch { missing.push(`${name}  (${from})`); continue; }
    let held = null;
    try { held = fs.readFileSync(to); } catch { /* new */ }
    if (held && held.equals(source)) continue;
    changed.push(`${name}  ${held ? digest(held) : '(saknas)'} -> ${digest(source)}`);
    if (!check) fs.writeFileSync(to, source);
  }

  // Node has to read the ES modules in calendar/ as ES modules.
  const marker = path.join(HERE, 'package.json');
  if (!fs.existsSync(marker) && !check) fs.writeFileSync(marker, '{"type":"module"}\n');

  for (const line of missing) console.error(`SAKNAS  ${line}`);
  if (!changed.length) {
    console.log('Kalendern i det här repot är redan identisk med originalet.');
  } else {
    console.log(check ? 'Skiljer sig:' : 'Kopierade:');
    for (const line of changed) console.log(`  ${line}`);
    if (check) console.log('\nKör utan --check för att kopiera, commita och deploya sedan.');
    else console.log('\nCommita och pusha för att få ut det på Railway.');
  }
  process.exit(missing.length ? 1 : (check && changed.length ? 1 : 0));
}

main();
