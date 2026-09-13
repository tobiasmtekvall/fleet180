'use strict';

/**
 * Running the calendar's own carry-forward rule on this side.
 *
 * The engine is not reimplemented here. `calendar/carry-forward.mjs` is a
 * byte-for-byte copy of the one his server runs, imported and called with the
 * same arguments -- because two implementations of "which items roll to
 * tomorrow" would eventually disagree about one item on one day, and that is
 * precisely the kind of difference nobody notices until it matters.
 *
 * It has to run here at all because the copy has to stay right while the
 * computer is off. A laptop shut on Friday afternoon means Monday's page,
 * opened on a phone, shows Friday's open items -- unless this side rolls them
 * over by itself. When both sides run it they produce identical records: since
 * this change a carried copy's id is derived from the item's origin and the day
 * it lands on, not generated at random.
 *
 * "Today" is Sweden's today, handed in by the caller. The container thinks in
 * UTC, and a pass that runs at 01:00 Swedish time in winter would otherwise
 * believe it was still yesterday and roll nothing.
 */

const path = require('path');
const { pathToFileURL } = require('url');

const CALENDAR_DIR = path.join(__dirname, '..', '..', 'calendar');
const ENABLED = String(process.env.CARRY_FORWARD || 'on').toLowerCase() !== 'off';

let enginePromise = null;
let modelPromise = null;
let last = { at: null, day: null, moved: 0 };
let running = null;
let startKeyCache = null;

/** The ESM engine, loaded once. `calendar/package.json` marks the folder. */
function engine() {
  if (!enginePromise) {
    enginePromise = import(pathToFileURL(path.join(CALENDAR_DIR, 'carry-forward.mjs')).href);
  }
  return enginePromise;
}

/** The vehicle-matrix model, used by the routes for validation and tallies. */
function fleetModel() {
  if (!modelPromise) {
    modelPromise = import(pathToFileURL(path.join(CALENDAR_DIR, 'fleet-model.js')).href);
  }
  return modelPromise;
}

function enabled() { return ENABLED; }
function lastRun() { return last; }

function startKey() {
  return startKeyCache || process.env.CARRY_START || '2026-08-25';
}

/**
 * One pass, at most one at a time.
 *
 * Concurrency matters more here than it looks: the pass runs before every read
 * of the checklists, and the page reads on every dialog it opens. Two passes
 * interleaving their read-modify-write is the same race his server solved with
 * `withDataLock()`; this is that lock, in the only shape a stateless web
 * process can have one.
 */
async function run(store, todayKey, reason = 'read', { force = false } = {}) {
  if (!ENABLED) return { changed: false, moved: 0, skipped: 'off' };
  if (running) return running;

  running = (async () => {
    const mod = await engine();
    if (!startKeyCache) startKeyCache = process.env.CARRY_START || mod.DEFAULT_START_KEY;

    const before = await store.listChecklists();
    const result = mod.carryForward(before, { startKey: startKey(), todayKey });
    if (!result.changed && !force) {
      last = { at: new Date().toISOString(), day: todayKey, moved: 0, reason };
      return { changed: false, moved: 0 };
    }

    /* Only the records the pass actually altered are written back. Writing all
       of them would bump every row's `synced_at` and hand his machine the
       entire calendar at the next exchange -- every fifteen minutes, forever. */
    const wasById = new Map(before.map(c => [c.id, JSON.stringify(c)]));
    const changed = result.checklists.filter(
      c => wasById.get(c.id) !== JSON.stringify(c));
    const at = new Date().toISOString();
    for (const record of changed) {
      // A record the pass touched but did not restamp still has to look newer
      // than what is stored, or the newer-wins write would drop it.
      if (!record.updatedAt || record.updatedAt < at) record.updatedAt = at;
      await store.putChecklist(record);
    }

    last = { at, day: todayKey, moved: result.moves.length, reason };
    await store.setMeta('carry', last).catch(() => {});
    return { changed: changed.length > 0, moved: result.moves.length, moves: result.moves };
  })().finally(() => { running = null; });

  return running;
}

module.exports = { run, engine, fleetModel, enabled, lastRun, startKey, CALENDAR_DIR };
