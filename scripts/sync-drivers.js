#!/usr/bin/env node
'use strict';

/**
 * Push the Route Suite's driver roster to the FLEET180 app.
 *
 * Reads the web server's storage mirror -- the freshest copy of the matrix
 * on this machine, written every time the suite saves -- merges the box and
 * home fleets, drops anyone on the inactive list, sorts them the Swedish
 * way, writes data/drivers.json for the record, and posts the list to
 * /api/drivers. The app then fills the "Namn och efternamn" dropdown from
 * it within seconds; no redeploy, no commit.
 *
 * Usage:
 *   node sync-drivers.js                 # read config from fleet180-sync.json / env
 *   node sync-drivers.js --dry-run       # build the list, show it, post nothing
 *
 * Config, in order of precedence: command line, environment, then the JSON
 * file beside this script:
 *   { "base": "https://fleet180-production.up.railway.app",
 *     "token": "...", "suite": "C:\\IBX\\route-suite-flat-4.0.0.0" }
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
function arg(name) {
  const hit = args.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : '';
}

function loadConfig() {
  const file = path.join(__dirname, 'fleet180-sync.json');
  let fromFile = {};
  if (fs.existsSync(file)) {
    // Notepad and PowerShell's Set-Content both like to prepend a UTF-8
    // byte-order mark, which JSON.parse refuses with a message that says
    // nothing useful. Strip it rather than make anyone debug it.
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
    if (raw) {
      try { fromFile = JSON.parse(raw); }
      catch (e) {
        fail(`${file} går inte att läsa som JSON: ${e.message}\n` +
          '     Filen ska se ut som fleet180-sync.example.json:\n' +
          '     { "base": "...", "token": "...", "suite": "C:\\\\IBX\\\\route-suite-flat-4.0.0.0" }');
      }
    }
  }
  const suite = arg('suite') || process.env.ROUTE_SUITE_DIR || fromFile.suite ||
    path.resolve(__dirname, '..', '..');
  return {
    base: (arg('base') || process.env.FLEET180_BASE || fromFile.base ||
      'https://fleet180-production.up.railway.app').replace(/\/+$/, ''),
    token: arg('token') || process.env.FLEET180_TOKEN || fromFile.token || '',
    suite,
    out: arg('out') || fromFile.out || path.join(__dirname, '..', 'data', 'drivers.json')
  };
}

function fail(msg) {
  console.error('FEL: ' + msg);
  process.exit(1);
}

/** The mirror stores each value as a JSON string or as an object. */
function parseMaybe(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (e) { return value; }
}

const MIRROR = ['webserver', 'data', 'mirror', 'storage.json'];

/**
 * Find the suite, wherever this happens to be running.
 *
 * The same config file is read from two places: Windows, where `suite` is
 * C:\IBX\..., and the scheduled job's Linux sandbox, where that folder is
 * mounted under a different root. The script sits inside the suite either
 * way, so its own location is the reliable fallback -- try the configured
 * path first, then two levels up from here.
 */
function findSuite(configured) {
  const candidates = [configured, path.resolve(__dirname, '..', '..')].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, ...MIRROR))) return dir;
  }
  fail('Hittar inte webserver/data/mirror/storage.json. Letade i:\n' +
    candidates.map(c => '       ' + c).join('\n') +
    '\n     Peka ut suiten med --suite=<mapp>, eller kör webbservern en gång så att spegeln skapas.');
}

function readRoster(configuredDir) {
  const suiteDir = findSuite(configuredDir);
  const storage = path.join(suiteDir, ...MIRROR);
  const raw = JSON.parse(fs.readFileSync(storage, 'utf8'));

  const box = parseMaybe(raw['routeAssigner.matrix.v1']) || {};
  const home = parseMaybe(raw['routeAssigner.home.matrix.v1']) || {};
  const inactive = new Set((parseMaybe(raw['budbee:drivers:inactive']) || [])
    .map(n => String(n).trim()).filter(Boolean));

  const drivers = new Map();
  const take = (list, fleet) => {
    for (const d of list || []) {
      const name = String((d && d.name) || '').trim();
      if (!name || inactive.has(name)) continue;
      // A driver in both fleets keeps the first entry; box is read first
      // because that is where the type (Internal/EXT/BOX) is maintained.
      if (!drivers.has(name)) drivers.set(name, { name, fleet, type: String(d.type || '') });
    }
  };
  take(box.drivers, 'box');
  take(home.drivers, 'home');

  const collator = new Intl.Collator('sv', { sensitivity: 'base' });
  return {
    drivers: [...drivers.values()].sort((a, b) => collator.compare(a.name, b.name)),
    sourceUpdated: (box.meta && box.meta.updatedAt) || null,
    skipped: inactive.size,
    suiteDir
  };
}

async function post(cfg, drivers) {
  const res = await fetch(cfg.base + '/api/drivers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.token },
    body: JSON.stringify({ drivers })
  });
  const text = await res.text();
  if (!res.ok) fail(`${cfg.base} svarade ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

(async () => {
  const cfg = loadConfig();
  const { drivers, sourceUpdated, skipped, suiteDir } = readRoster(cfg.suite);

  if (!drivers.length) {
    fail('Förarlistan blev tom – vägrar skicka, det skulle tömma rullgardinen i formuläret.');
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceUpdated,
    count: drivers.length,
    drivers
  };
  fs.mkdirSync(path.dirname(cfg.out), { recursive: true });
  fs.writeFileSync(cfg.out, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  console.log(`läste ${suiteDir}`);
  console.log(`${drivers.length} förare (${skipped} på inaktiv-listan hoppades över)`);
  console.log(`matrisen senast ändrad: ${sourceUpdated || 'okänt'}`);
  console.log(`skrev ${cfg.out}`);

  if (dryRun) {
    console.log('\n--dry-run: postar inget. Listan:');
    drivers.forEach(d => console.log('  ' + d.name + '  (' + (d.type || '—') + ', ' + d.fleet + ')'));
    return;
  }
  if (!cfg.token) {
    fail('Ingen API-nyckel. Sätt token i fleet180-sync.json eller FLEET180_TOKEN.');
  }
  const result = await post(cfg, drivers);
  console.log(`skickat till ${cfg.base}: ${result.total} aktiva, ${result.added} nya, ` +
    `${(result.deactivated || []).length} avaktiverade` +
    ((result.deactivated || []).length ? ' (' + result.deactivated.join(', ') + ')' : ''));
})().catch(err => fail(err && err.message ? err.message : String(err)));
