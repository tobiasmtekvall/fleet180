'use strict';

/**
 * The exchange between his computer and this copy.
 *
 * One POST does the whole thing: his side sends what has changed on it since
 * the last successful exchange, this side applies what it should, and answers
 * with what has changed here since the same moment. Nobody is "the server" and
 * nobody is "the client" -- both stores hold the same records and both are
 * allowed to write.
 *
 * Four decisions hold it together.
 *
 * 1. PER RECORD, NEVER PER FILE. A day he edits at his desk and a week filled
 *    in from the van are two rows. Exchanging whole files would make the
 *    accident that once cost this calendar 21 items -- one stale picture
 *    written over a fresher one -- into the normal case at every reconnect.
 *
 * 2. NEWER WINS, BY THE RECORD'S OWN TIMESTAMP. `updatedAt` is written by
 *    whichever side saved, at the moment it saved. So an edit made offline on
 *    Monday and pushed on Wednesday still loses to a Tuesday edit, which is
 *    what a person means by "the latest version".
 *
 * 3. A TIE IS BROKEN THE SAME WAY ON BOTH SIDES. Equal timestamps and
 *    different content is rare and real (two saves in the same millisecond, or
 *    a record rebuilt identically). Comparing the serialised payload and
 *    keeping the larger is arbitrary, but it is arbitrary *identically* in
 *    both directions, so the two stores converge instead of swapping the
 *    record back and forth forever.
 *
 * 4. DELETES ARE FACTS, NOT ABSENCES. A record missing from a push means
 *    nothing -- it may simply not have changed. A deletion is sent as its own
 *    statement with the time it happened, and kept here as a tombstone, or the
 *    other side would hand the record back at the next exchange and keep doing
 *    it forever.
 *
 * The one thing this cannot do is merge two edits INSIDE the same record: tick
 * an item on the laptop and a different item on the phone in the same day,
 * without a sync between, and the later save is the one that survives whole.
 * Merging item by item is possible but it is not obviously right -- it would
 * also resurrect items deleted on one side -- and for one person with one
 * calendar the simpler rule is the one whose outcome he can predict.
 */

const crypto = require('crypto');

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/** ISO string or null, never a bad Date. */
function iso(value, fallback = null) {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

const MAX_RECORDS = 2000;

/**
 * Apply one push and answer with this side's changes.
 *
 * @param {object} store  src/calendar/store.js
 * @param {object} body   { since, checklists, fleet, theme, deleted }
 */
async function exchange(store, body) {
  const since = iso(body && body.since, null);
  const now = new Date().toISOString();
  const incoming = body || {};

  const checklists = Array.isArray(incoming.checklists) ? incoming.checklists : [];
  const fleet = Array.isArray(incoming.fleet) ? incoming.fleet : [];
  const deleted = incoming.deleted || {};
  const goneChecklists = Array.isArray(deleted.checklists) ? deleted.checklists : [];
  const goneFleet = Array.isArray(deleted.fleet) ? deleted.fleet : [];

  if (checklists.length + fleet.length > MAX_RECORDS) {
    const err = new Error('För många poster i en och samma synk.');
    err.status = 413;
    throw err;
  }

  const applied = { checklists: 0, fleet: 0, deletedChecklists: 0, deletedFleet: 0, theme: 0 };

  /* Deletions are applied BEFORE writes. If the same exchange carries a
     deletion of a record and a later save of it -- he deleted a day and
     rebuilt it -- the save has the newer timestamp and comes back. The other
     order would let the tombstone land on top of the rebuild. */
  for (const gone of goneChecklists) {
    const id = typeof gone === 'string' ? gone : (gone && gone.id);
    const at = typeof gone === 'string' ? now : iso(gone && gone.at, now);
    if (!id) continue;
    if (await store.deleteChecklist(id, { ifNewer: true, at })) applied.deletedChecklists += 1;
  }
  for (const gone of goneFleet) {
    const key = typeof gone === 'string' ? gone : (gone && gone.key);
    const at = typeof gone === 'string' ? now : iso(gone && gone.at, now);
    if (!key) continue;
    if (await store.deleteFleetWeek(key, { ifNewer: true, at })) applied.deletedFleet += 1;
  }

  for (const record of checklists) {
    if (!record || typeof record.id !== 'string') continue;
    if (await store.putChecklist(record, { ifNewer: true, at: now })) applied.checklists += 1;
  }
  for (const record of fleet) {
    if (!record || typeof record.key !== 'string') continue;
    if (await store.putFleetWeek(record, { ifNewer: true, at: now })) applied.fleet += 1;
  }

  if (incoming.theme && incoming.theme.payload && typeof incoming.theme.payload === 'object') {
    const at = iso(incoming.theme.updatedAt, now);
    if (await store.setMeta('theme', incoming.theme.payload, { ifNewer: true, at })) {
      applied.theme = 1;
    }
  }

  /* What this side has to hand back. Read AFTER applying, so a record the push
     just landed is not immediately sent back as news -- its `synced_at` is now,
     which is after the cutoff, but its content is what he just sent, so the
     round trip is a no-op on his side rather than a loop. */
  const outgoing = await store.changesSince(since);

  await store.setMeta('sync', {
    at: now,
    from: String((incoming.from || '')).slice(0, 60) || null,
    received: applied,
    sent: {
      checklists: outgoing.checklists.length,
      fleet: outgoing.fleet.length,
      deletedChecklists: outgoing.deletedChecklists.length,
      deletedFleet: outgoing.deletedFleet.length
    }
  }).catch(() => {});

  return {
    ok: true,
    now,
    applied,
    checklists: outgoing.checklists,
    fleet: outgoing.fleet,
    theme: outgoing.theme,
    deleted: {
      checklists: outgoing.deletedChecklists,
      fleet: outgoing.deletedFleet
    }
  };
}

module.exports = { exchange, safeEqual, iso, MAX_RECORDS };
