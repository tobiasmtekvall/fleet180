'use strict';

/**
 * The Checklist Calendar's own API, reproduced on this side.
 *
 * Same paths, same request bodies, same response shapes as
 * `prog/checklist-calendar-railway-fresh/server.mjs` -- mounted under
 * `/kalender` instead of at the root, which is the only difference the copied
 * page can see (and `src/calendar/assets.js` hides even that). If the two ever
 * disagree about a shape, this file is the one that is wrong.
 *
 * Everything behind the mount is already past `adminAuth`, so there is no
 * second password and no token here: if you got this far you are him.
 */

const express = require('express');
const carry = require('./carry');

const WEEK_KEY = /^\d{4}-W\d{2}$/;

/* The calendar's own validation, copied rather than loosened. A record this
   side accepts and his side rejects would sync over and then refuse to load. */
function validChecklist(v) {
  return Boolean(v)
    && typeof v === 'object'
    && typeof v.id === 'string' && v.id.length <= 160
    && ['day', 'week', 'month'].includes(v.scope)
    && typeof v.key === 'string' && v.key.length <= 32
    && typeof v.title === 'string' && v.title.length <= 180
    && Array.isArray(v.sections) && v.sections.length <= 40;
}

function validFleetRecord(v, maxEvents) {
  return Boolean(v)
    && typeof v === 'object'
    && !Array.isArray(v)
    && typeof v.key === 'string'
    && WEEK_KEY.test(v.key)
    && v.cells && typeof v.cells === 'object' && !Array.isArray(v.cells)
    && Object.keys(v.cells).length <= 20000
    && (v.events === undefined || (Array.isArray(v.events) && v.events.length <= maxEvents));
}

/**
 * @param {object} deps
 * @param {object} deps.store   src/calendar/store.js
 * @param {function} deps.today () => 'YYYY-MM-DD' in Swedish time
 */
function calendarRouter({ store, today }) {
  const router = express.Router();
  // The vehicle matrix for a full week is a large object; the calendar's own
  // server allows 8 MB for it and so does this one.
  router.use(express.json({ limit: '8mb' }));

  const fail = (res, code, error) => res.status(code).json({ error });

  /* ------------------------------------------------------ checklists -- */

  router.get('/checklists', async (req, res, next) => {
    try {
      // Reading is when the rollover happens on his machine too, so a day
      // opened at 06:00 is already carried before it is drawn.
      await carry.run(store, today(), 'read');
      res.json(await store.listChecklists());
    } catch (err) { next(err); }
  });

  router.post('/checklists', async (req, res, next) => {
    try {
      const checklist = req.body;
      if (!validChecklist(checklist)) return fail(res, 400, 'Invalid checklist data.');
      /* The page stamps `updatedAt` itself, in the browser, immediately before
         it posts -- and his own server stores what it is given. So does this
         one. Restamping here would mean the two sides dated the same save by
         different clocks, and "which edit was later" would depend on which
         half of the system you asked. Only a record that arrives without a
         usable timestamp gets one. */
      const given = new Date(checklist.updatedAt);
      const saved = Number.isNaN(given.getTime())
        ? { ...checklist, updatedAt: new Date().toISOString() }
        : checklist;
      await store.putChecklist(saved);
      res.json(saved);
    } catch (err) { next(err); }
  });

  router.delete('/checklists/:id', async (req, res, next) => {
    try {
      const ok = await store.deleteChecklist(req.params.id);
      if (!ok) return fail(res, 404, 'Checklist not found.');
      res.json({ deleted: req.params.id });
    } catch (err) { next(err); }
  });

  router.post('/carry-forward', async (req, res, next) => {
    try {
      const result = await carry.run(store, today(), 'manual', { force: true });
      res.json({ ok: true, ...result });
    } catch (err) { next(err); }
  });

  /* ----------------------------------------------------- fleet weeks -- */

  router.get('/fleet', async (req, res, next) => {
    try {
      const model = await carry.fleetModel();
      const records = await store.listFleetWeeks();
      res.json({
        ok: true,
        weeks: records.map(record => {
          const normalized = model.normalizeRecord(record, record.key);
          return {
            key: normalized.key,
            updatedAt: normalized.updatedAt,
            totals: model.matrixTally(normalized)
          };
        })
      });
    } catch (err) { next(err); }
  });

  router.post('/fleet', async (req, res, next) => {
    try {
      const model = await carry.fleetModel();
      if (!validFleetRecord(req.body, model.MAX_EVENTS)) {
        return fail(res, 400, 'Invalid vehicle matrix data.');
      }
      /* The matrix is the one place his server DOES restamp (server.mjs sets
         `stored.updatedAt` after normalising), so this side does the same. */
      const stored = model.normalizeRecord(req.body, req.body.key);
      stored.updatedAt = new Date().toISOString();
      await store.putFleetWeek(stored);
      res.json({ ok: true, record: stored });
    } catch (err) { next(err); }
  });

  router.get('/fleet/:key', async (req, res, next) => {
    try {
      const key = req.params.key;
      if (!WEEK_KEY.test(key)) return fail(res, 400, 'Invalid week key.');
      const model = await carry.fleetModel();
      const found = await store.getFleetWeek(key);
      res.json({
        ok: true,
        record: found ? model.normalizeRecord(found, key) : model.emptyRecord(key)
      });
    } catch (err) { next(err); }
  });

  router.delete('/fleet/:key', async (req, res, next) => {
    try {
      const key = req.params.key;
      if (!WEEK_KEY.test(key)) return fail(res, 400, 'Invalid week key.');
      const ok = await store.deleteFleetWeek(key);
      if (!ok) return fail(res, 404, 'No matrix stored for that week.');
      res.json({ deleted: key });
    } catch (err) { next(err); }
  });

  /* ----------------------------------------------------------- theme -- */

  router.get('/theme', async (req, res, next) => {
    try {
      res.json({ ok: true, theme: await store.getMeta('theme', null) });
    } catch (err) { next(err); }
  });

  router.post('/theme', async (req, res, next) => {
    try {
      const theme = req.body;
      if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
        return fail(res, 400, 'Invalid theme data.');
      }
      await store.setMeta('theme', theme);
      res.json({ ok: true, theme });
    } catch (err) { next(err); }
  });

  /* ---------------------------------------------------------- status -- */

  router.get('/status', async (req, res, next) => {
    try {
      const [totals, sync] = await Promise.all([
        store.counts(), store.getMeta('sync', null)
      ]);
      res.json({
        ok: true,
        checklistCount: totals.checklists,
        dataFile: 'Postgres (Fleet 180)',
        fleetFile: 'Postgres (Fleet 180)',
        fleetWeeks: totals.weeks,
        volumeMountPath: null,
        carryForward: {
          enabled: carry.enabled(),
          startKey: carry.startKey(),
          today: today(),
          lastRun: carry.lastRun()
        },
        // What the copy knows about the computer it mirrors. A blank `at` is
        // the honest answer to "has this ever synced", and it is the first
        // thing to look at when the two disagree.
        sync: sync || { at: null, from: null }
      });
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = { calendarRouter, validChecklist, validFleetRecord, WEEK_KEY };
