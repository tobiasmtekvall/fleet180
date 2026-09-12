#!/usr/bin/env node
'use strict';

/**
 * Push the Route Suite's vehicle assignments to the FLEET180 app.
 *
 * Reads the assigner's own record in the web-server mirror -- the current
 * session plus the archive of past runs -- and sends one row per
 * (day, vehicle, driver). That is what turns "41 checks were filed" into
 * "41 of the 58 that were owed", because the app then knows who was given
 * which vehicle on which day.
 *
 * Only `results[]` is read, never the CSV beside it: the CSV carries the
 * driver's first name with the surname starred out, while results carries
 * the full name that the check itself is signed with. Matching on a first
 * name alone would merge two drivers who share one.
 *
 * Usage:
 *   node sync-assignments.js [--from=2026-09-08] [--dry-run]
 *
 * Config is shared with sync-drivers.js (scripts/fleet180-sync.json).
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
function arg(name) {
  const hit = args.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : '';
}

/** Assignments before this date are not carried over; Tobias set the line. */
const DEFAULT_FROM = '2026-09-08';

const MIRROR = ['webserver', 'data', 'mirror', 'storage.json'];

function fail(msg) { console.error('FEL: ' + msg); process.exit(1); }

function loadConfig() {
  const file = path.join(__dirname, 'fleet180-sync.json');
  let fromFile = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
    if (raw) {
      try { fromFile = JSON.parse(raw); }
      catch (e) { fail(`${file} går inte att läsa som JSON: ${e.message}`); }
    }
  }
  return {
    base: (arg('base') || process.env.FLEET180_BASE || fromFile.base ||
      'https://fleet180-production.up.railway.app').replace(/\/+$/, ''),
    token: arg('token') || process.env.FLEET180_TOKEN || fromFile.token || '',
    suite: arg('suite') || process.env.ROUTE_SUITE_DIR || fromFile.suite || '',
    from: arg('from') || DEFAULT_FROM
  };
}

function findSuite(configured) {
  const candidates = [configured, path.resolve(__dirname, '..', '..')].filter(Boolean);
  for (const dir of candidates) if (fs.existsSync(path.join(dir, ...MIRROR))) return dir;
  fail('Hittar inte webserver/data/mirror/storage.json. Letade i:\n' +
    candidates.map(c => '       ' + c).join('\n'));
}

function parseMaybe(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (e) { return null; }
}

/**
 * Every assigner run we can find, newest last, as
 * { runAt, fleet, results[] }.
 */
function collectRuns(store) {
  const runs = [];
  const push = (entry, fleet) => {
    if (!entry || !Array.isArray(entry.results) || !entry.results.length) return;
    const runAt = (entry.meta && entry.meta.date) || entry.date || null;
    runs.push({ runAt, fleet, results: entry.results });
  };

  push(parseMaybe(store['routeAssigner.session.v1']), 'box');
  push(parseMaybe(store['routeAssigner.home.session.v1']), 'home');
  for (const e of parseMaybe(store['routeAssigner.archive.v1']) || []) push(e, 'box');
  for (const e of parseMaybe(store['routeAssigner.home.archive.v1']) || []) push(e, 'home');

  // Oldest first, so a later run overwrites an earlier one for the same day.
  runs.sort((a, b) => String(a.runAt || '').localeCompare(String(b.runAt || '')));
  return runs;
}

function buildAssignments(store, from) {
  const runs = collectRuns(store);
  const byDay = new Map();          // date -> Map(route|plate -> row)
  let seenRows = 0, skippedNoVehicle = 0, beforeCutoff = 0;

  for (const run of runs) {
    for (const r of run.results) {
      if (!r || r.kind !== 'driver') continue;
      const date = String((r.row && r.row.date) || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      seenRows++;
      if (date < from) { beforeCutoff++; continue; }

      const plate = String(r.vehicle || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const driver = String(r.driverName || (r.parsed && r.parsed.name) || '').trim();
      // 3PL drivers bring their own vehicle: no plate, nothing to check.
      if (!plate || !driver) { skippedNoVehicle++; continue; }

      /* One key per (fleet, day, route): the LAST run wins.
         The key used to carry the driver and the plate as well, which meant a
         day the assigner was re-run kept both answers -- the same route and
         often the same van listed under two drivers. Since the app started
         filling the driver's name into the scanned form, that is not a
         double-count any more but a vehicle with two drivers, which switches
         the fill-in and the driver-change question off for that van and lets
         either driver file a check with no questions asked. A re-run
         supersedes its own earlier answer; that is the whole contract of
         this push. */
      const key = `${run.fleet}|${date}|${String((r.row && r.row.route) || '')}`;
      if (!byDay.has(date)) byDay.set(date, new Map());
      byDay.get(date).set(key, {
        date, plate, driver,
        route: String((r.row && r.row.route) || ''),
        type: String((r.parsed && r.parsed.type) || ''),
        fleet: run.fleet,
        sourceAt: run.runAt
      });
    }
  }

  const rows = [];
  for (const [, m] of [...byDay.entries()].sort()) rows.push(...m.values());
  return { rows, seenRows, skippedNoVehicle, beforeCutoff, days: byDay.size };
}

async function post(cfg, assignments) {
  const res = await fetch(cfg.base + '/api/assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.token },
    body: JSON.stringify({ assignments })
  });
  const text = await res.text();
  if (!res.ok) fail(`${cfg.base} svarade ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

(async () => {
  const cfg = loadConfig();
  const suiteDir = findSuite(cfg.suite);
  const store = JSON.parse(fs.readFileSync(path.join(suiteDir, ...MIRROR), 'utf8'));
  const built = buildAssignments(store, cfg.from);

  console.log(`läste ${suiteDir}`);
  console.log(`${built.rows.length} tilldelningar över ${built.days} dagar från och med ${cfg.from}`);
  console.log(`  (${built.beforeCutoff} rader före brytdatumet, ` +
    `${built.skippedNoVehicle} utan fordon – t.ex. 3PL med egen bil)`);

  if (!built.rows.length) {
    console.log('\nInget att skicka. Kör ruttilldelningen i Route Suite för en dag ' +
      `från och med ${cfg.from}, så finns det data här nästa gång.`);
    return;
  }

  const days = [...new Set(built.rows.map(r => r.date))].sort();
  console.log(`  dagar: ${days.join(', ')}`);

  if (dryRun) {
    console.log('\n--dry-run: postar inget. Första tio raderna:');
    built.rows.slice(0, 10).forEach(r =>
      console.log(`  ${r.date}  ${r.plate}  ${r.driver}  (${r.route}, ${r.type || '—'}, ${r.fleet})`));
    return;
  }
  if (!cfg.token) fail('Ingen API-nyckel. Sätt token i fleet180-sync.json eller FLEET180_TOKEN.');

  const result = await post(cfg, built.rows);
  console.log(`skickat till ${cfg.base}: ${result.rows} rader över ${result.days} dagar`);
})().catch(err => fail(err && err.message ? err.message : String(err)));
