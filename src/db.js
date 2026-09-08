'use strict';

const { Pool } = require('pg');

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.PGURL;

if (!connectionString) {
  console.error(
    '[db] No DATABASE_URL set.\n' +
    '     On Railway: add the Postgres plugin, then reference it on this\n' +
    '     service as DATABASE_URL = ${{Postgres.DATABASE_URL}}.'
  );
  process.exit(1);
}

// Railway's internal proxy hands out a self-signed certificate; public
// hostnames need TLS but not a verified chain. Local dev needs neither.
const isLocal = /(^|@)(localhost|127\.0\.0\.1)/.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: Number(process.env.PGPOOL_MAX || 5),
  idleTimeoutMillis: 30000
});

pool.on('error', err => console.error('[db] idle client error', err));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS submissions (
  id            BIGSERIAL PRIMARY KEY,
  plate         TEXT        NOT NULL,
  owner         TEXT        NOT NULL DEFAULT 'okq8',
  form_key      TEXT        NOT NULL,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  driver_name   TEXT,
  route         TEXT,
  odometer      TEXT,
  answers       JSONB       NOT NULL,
  photo_count   INTEGER     NOT NULL DEFAULT 0,
  user_agent    TEXT,
  client_ip     TEXT
);
CREATE INDEX IF NOT EXISTS submissions_plate_time_idx
  ON submissions (plate, submitted_at DESC);
CREATE INDEX IF NOT EXISTS submissions_time_idx
  ON submissions (submitted_at DESC);

CREATE TABLE IF NOT EXISTS photos (
  id             BIGSERIAL PRIMARY KEY,
  submission_id  BIGINT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  field          TEXT   NOT NULL,
  field_label    TEXT,
  filename       TEXT,
  mime           TEXT   NOT NULL,
  bytes          BYTEA  NOT NULL,
  byte_size      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_submission_idx ON photos (submission_id);
`;

async function init() {
  await pool.query(SCHEMA);
  console.log('[db] schema ready');
}

/**
 * One submission plus its photos, written together so a half-saved
 * check can never appear in the admin list.
 */
async function saveSubmission({ plate, owner, formKey, answers, photos, userAgent, clientIp }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `INSERT INTO submissions
         (plate, owner, form_key, driver_name, route, odometer,
          answers, photo_count, user_agent, client_ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, submitted_at`,
      [
        plate, owner, formKey,
        answers.f0 || null, answers.f1 || null, answers.f2 || null,
        JSON.stringify(answers), photos.length,
        userAgent || null, clientIp || null
      ]
    );
    const id = res.rows[0].id;
    for (const p of photos) {
      await client.query(
        `INSERT INTO photos
           (submission_id, field, field_label, filename, mime, bytes, byte_size)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, p.field, p.label || null, p.filename || null, p.mime, p.buffer, p.buffer.length]
      );
    }
    await client.query('COMMIT');
    return { id: String(id), submittedAt: res.rows[0].submitted_at };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Filtered list for the admin table. `from`/`to` are YYYY-MM-DD or null. */
async function listSubmissions({ plate, from, to, limit = 200, offset = 0 }) {
  const where = [];
  const args = [];
  if (plate) { args.push(plate); where.push(`plate = $${args.length}`); }
  if (from)  { args.push(from);  where.push(`submitted_at >= $${args.length}::date`); }
  if (to)    { args.push(to);    where.push(`submitted_at < ($${args.length}::date + 1)`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  args.push(limit); const lim = `$${args.length}`;
  args.push(offset); const off = `$${args.length}`;

  const rows = await pool.query(
    `SELECT id, plate, submitted_at, driver_name, route, odometer, photo_count, answers
       FROM submissions ${clause}
      ORDER BY submitted_at DESC, id DESC
      LIMIT ${lim} OFFSET ${off}`, args);

  const count = await pool.query(
    `SELECT COUNT(*)::int AS n FROM submissions ${clause}`, args.slice(0, args.length - 2));

  return { rows: rows.rows, total: count.rows[0].n };
}

async function getSubmission(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const s = await pool.query(`SELECT * FROM submissions WHERE id = $1`, [id]);
  if (!s.rows.length) return null;
  const p = await pool.query(
    `SELECT id, field, field_label, filename, mime, byte_size
       FROM photos WHERE submission_id = $1 ORDER BY id`, [id]);
  return { ...s.rows[0], photos: p.rows };
}

async function getPhoto(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const r = await pool.query(
    `SELECT mime, bytes, filename FROM photos WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

/** Latest check per vehicle, for the front page. */
async function latestPerVehicle() {
  const r = await pool.query(
    `SELECT DISTINCT ON (plate) plate, submitted_at, driver_name
       FROM submissions
      ORDER BY plate, submitted_at DESC`);
  return new Map(r.rows.map(row => [row.plate, row]));
}

module.exports = {
  pool, init, saveSubmission, listSubmissions,
  getSubmission, getPhoto, latestPerVehicle
};
