'use strict';

/**
 * Where the Checklist Calendar lives on this side.
 *
 * On his machine the calendar is two JSON files. Here it is three tables, and
 * the shape of them is the whole reason the two-way sync is safe:
 *
 *   ONE ROW PER RECORD, never one row per file.
 *
 * The calendar lost 21 items once because a browser tab holding yesterday's
 * picture posted a whole day record over the top of the server's. A sync that
 * exchanged whole files would make that failure routine instead of rare: every
 * reconnection would be one side's entire calendar landing on the other's.
 * Per record, a day he edited at his desk and a week he filled in from the van
 * are simply two rows, and neither can touch the other.
 *
 * `updated_at` is the record's OWN `updatedAt` -- the timestamp the calendar
 * already writes on every save -- not the moment the row was inserted. That is
 * what makes "whichever is newer wins" mean what a person would expect when a
 * push arrives hours after the edit it carries.
 *
 * Deletes leave a tombstone. Without one, deleting a day here and syncing would
 * simply hand it back from the other side, forever -- the same shape as the
 * carried-item bug the calendar already fixed once with `forwardedTo`.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS calendar_checklists (
  id          TEXT PRIMARY KEY,
  scope       TEXT        NOT NULL DEFAULT '',
  period_key  TEXT        NOT NULL DEFAULT '',
  payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
-- The sync asks one question of this table: what has moved since last time.
CREATE INDEX IF NOT EXISTS calendar_checklists_synced_idx ON calendar_checklists (synced_at);
CREATE INDEX IF NOT EXISTS calendar_checklists_scope_idx  ON calendar_checklists (scope, period_key);

CREATE TABLE IF NOT EXISTS calendar_fleet_weeks (
  week_key    TEXT PRIMARY KEY,
  payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS calendar_fleet_synced_idx ON calendar_fleet_weeks (synced_at);

-- The theme, and the bookkeeping the carry-forward pass keeps.
CREATE TABLE IF NOT EXISTS calendar_meta (
  name        TEXT PRIMARY KEY,
  payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

/** The record's own updatedAt, or now if it has none we can trust. */
function stamp(record, fallback) {
  const raw = record && (record.updatedAt || record.createdAt);
  const when = raw ? new Date(raw) : null;
  if (when && !Number.isNaN(when.getTime())) return when.toISOString();
  return (fallback || new Date()).toISOString();
}

function makeStore(pool) {
  const q = (text, params) => pool.query(text, params);

  /* ------------------------------------------------------- checklists -- */

  /** Every live checklist, in the array shape the page and the engine expect. */
  async function listChecklists() {
    const r = await q(
      `SELECT payload FROM calendar_checklists
        WHERE deleted_at IS NULL
        ORDER BY scope, period_key, id`);
    return r.rows.map(row => row.payload);
  }

  /**
   * Write one checklist.
   *
   * `ifNewer` is how the sync writes: the row moves only when what arrived is
   * actually newer than what is held, so a push that crosses a save in flight
   * cannot undo the save. The page's own POST passes false -- somebody is
   * sitting in front of it, and their save is by definition the latest word.
   */
  async function putChecklist(record, { ifNewer = false, at = null } = {}) {
    const id = String(record && record.id || '').trim();
    if (!id) throw new Error('En checklista utan id kan inte sparas.');
    const updated = stamp(record, at);
    const r = await q(
      `INSERT INTO calendar_checklists (id, scope, period_key, payload, updated_at, synced_at, deleted_at)
            VALUES ($1, $2, $3, $4::jsonb, $5, now(), NULL)
       ON CONFLICT (id) DO UPDATE
              SET scope = EXCLUDED.scope,
                  period_key = EXCLUDED.period_key,
                  payload = EXCLUDED.payload,
                  updated_at = EXCLUDED.updated_at,
                  synced_at = now(),
                  deleted_at = NULL
            WHERE $6::boolean IS FALSE
               OR EXCLUDED.updated_at > calendar_checklists.updated_at
               OR (EXCLUDED.updated_at = calendar_checklists.updated_at
                   AND EXCLUDED.payload::text > calendar_checklists.payload::text)
        RETURNING id`,
      [id, String(record.scope || ''), String(record.key || ''),
       JSON.stringify(record), updated, ifNewer]);
    return r.rowCount > 0;
  }

  /**
   * Tombstone a checklist. The row stays so the other side learns about it;
   * the payload stays too, because a delete that turns out to be a mistake is
   * a thing he will want back and a JSONB blob is not worth reclaiming.
   */
  async function deleteChecklist(id, { ifNewer = false, at = null } = {}) {
    const when = (at ? new Date(at) : new Date()).toISOString();
    const r = await q(
      `UPDATE calendar_checklists
          SET deleted_at = now(), updated_at = $2, synced_at = now()
        WHERE id = $1
          AND ($3::boolean IS FALSE OR deleted_at IS NOT NULL OR $2 >= updated_at)
      RETURNING id`, [String(id), when, ifNewer]);
    return r.rowCount > 0;
  }

  /* ------------------------------------------------------ fleet weeks -- */

  async function listFleetWeeks() {
    const r = await q(
      `SELECT payload FROM calendar_fleet_weeks
        WHERE deleted_at IS NULL ORDER BY week_key`);
    return r.rows.map(row => row.payload);
  }

  async function getFleetWeek(key) {
    const r = await q(
      `SELECT payload FROM calendar_fleet_weeks
        WHERE week_key = $1 AND deleted_at IS NULL`, [String(key)]);
    return r.rowCount ? r.rows[0].payload : null;
  }

  async function putFleetWeek(record, { ifNewer = false, at = null } = {}) {
    const key = String(record && record.key || '').trim();
    if (!key) throw new Error('En veckomatris utan vecka kan inte sparas.');
    const updated = stamp(record, at);
    const r = await q(
      `INSERT INTO calendar_fleet_weeks (week_key, payload, updated_at, synced_at, deleted_at)
            VALUES ($1, $2::jsonb, $3, now(), NULL)
       ON CONFLICT (week_key) DO UPDATE
              SET payload = EXCLUDED.payload,
                  updated_at = EXCLUDED.updated_at,
                  synced_at = now(),
                  deleted_at = NULL
            WHERE $4::boolean IS FALSE
               OR EXCLUDED.updated_at > calendar_fleet_weeks.updated_at
               OR (EXCLUDED.updated_at = calendar_fleet_weeks.updated_at
                   AND EXCLUDED.payload::text > calendar_fleet_weeks.payload::text)
        RETURNING week_key`,
      [key, JSON.stringify(record), updated, ifNewer]);
    return r.rowCount > 0;
  }

  async function deleteFleetWeek(key, { ifNewer = false, at = null } = {}) {
    const when = (at ? new Date(at) : new Date()).toISOString();
    const r = await q(
      `UPDATE calendar_fleet_weeks
          SET deleted_at = now(), updated_at = $2, synced_at = now()
        WHERE week_key = $1
          AND ($3::boolean IS FALSE OR deleted_at IS NOT NULL OR $2 >= updated_at)
      RETURNING week_key`, [String(key), when, ifNewer]);
    return r.rowCount > 0;
  }

  /* ------------------------------------------------------------ meta -- */

  async function getMeta(name, fallback = null) {
    const r = await q('SELECT payload, updated_at FROM calendar_meta WHERE name = $1', [name]);
    if (!r.rowCount) return fallback;
    return r.rows[0].payload;
  }

  async function getMetaRow(name) {
    const r = await q('SELECT payload, updated_at FROM calendar_meta WHERE name = $1', [name]);
    return r.rowCount ? { payload: r.rows[0].payload, updatedAt: r.rows[0].updated_at.toISOString() } : null;
  }

  async function setMeta(name, payload, { ifNewer = false, at = null } = {}) {
    const when = (at ? new Date(at) : new Date()).toISOString();
    const r = await q(
      `INSERT INTO calendar_meta (name, payload, updated_at)
            VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (name) DO UPDATE
              SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
            WHERE $4::boolean IS FALSE OR EXCLUDED.updated_at > calendar_meta.updated_at
        RETURNING name`,
      [name, JSON.stringify(payload), when, ifNewer]);
    return r.rowCount > 0;
  }

  /* ------------------------------------------------------------ sync -- */

  /**
   * Everything that has moved since `since`, tombstones included.
   *
   * Keyed on `synced_at` (when this side wrote it) rather than `updated_at`
   * (when the edit happened), because an edit made on a laptop whose clock is
   * a minute slow must still be handed on. The two are different questions and
   * conflating them is how a change goes missing exactly once and is never
   * reproducible.
   */
  async function changesSince(since) {
    const from = since ? new Date(since) : new Date(0);
    const [checks, weeks, theme] = await Promise.all([
      q(`SELECT id, payload, updated_at, deleted_at FROM calendar_checklists
          WHERE synced_at > $1 ORDER BY synced_at`, [from.toISOString()]),
      q(`SELECT week_key, payload, updated_at, deleted_at FROM calendar_fleet_weeks
          WHERE synced_at > $1 ORDER BY synced_at`, [from.toISOString()]),
      q(`SELECT payload, updated_at FROM calendar_meta
          WHERE name = 'theme' AND updated_at > $1`, [from.toISOString()])
    ]);
    return {
      checklists: checks.rows.filter(r => !r.deleted_at).map(r => r.payload),
      deletedChecklists: checks.rows.filter(r => r.deleted_at)
        .map(r => ({ id: r.id, at: r.updated_at.toISOString() })),
      fleet: weeks.rows.filter(r => !r.deleted_at).map(r => r.payload),
      deletedFleet: weeks.rows.filter(r => r.deleted_at)
        .map(r => ({ key: r.week_key, at: r.updated_at.toISOString() })),
      theme: theme.rowCount
        ? { payload: theme.rows[0].payload, updatedAt: theme.rows[0].updated_at.toISOString() }
        : null
    };
  }

  async function counts() {
    const r = await q(
      `SELECT (SELECT count(*) FROM calendar_checklists WHERE deleted_at IS NULL) AS checklists,
              (SELECT count(*) FROM calendar_fleet_weeks WHERE deleted_at IS NULL) AS weeks`);
    return { checklists: Number(r.rows[0].checklists), weeks: Number(r.rows[0].weeks) };
  }

  /** Replace the whole checklist set after a carry-forward pass. */
  async function putChecklists(records, at) {
    let written = 0;
    for (const record of records) {
      if (await putChecklist(record, { at })) written += 1;
    }
    return written;
  }

  return {
    listChecklists, putChecklist, putChecklists, deleteChecklist,
    listFleetWeeks, getFleetWeek, putFleetWeek, deleteFleetWeek,
    getMeta, getMetaRow, setMeta, changesSince, counts
  };
}

module.exports = { SCHEMA, makeStore, stamp };
