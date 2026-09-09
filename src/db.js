'use strict';

const crypto = require('crypto');
const { Pool } = require('pg');
const seed = require('./seed');
const { normalisePlate } = require('./plate');

/* ------------------------------------------------------------------ *
 * Finding the database                                                *
 *                                                                     *
 * The one failure worth spelling out: if Railway hands the app no      *
 * usable DATABASE_URL, node-postgres silently falls back to            *
 * localhost:5432 and the deploy dies with ECONNREFUSED 127.0.0.1 --    *
 * which looks like a database problem but is a variable problem.       *
 * So the value is validated here and the app says exactly what is      *
 * wrong instead of dialling a database that was never there.           *
 * ------------------------------------------------------------------ */

const URL_VARS = [
  'DATABASE_URL',          // what you set on Railway
  'DATABASE_PRIVATE_URL',  // Railway's private-network alias
  'POSTGRES_URL',
  'DATABASE_PUBLIC_URL',   // the TCP-proxy address, works from anywhere
  'PGURL'
];

const ON_RAILWAY = Boolean(
  process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID ||
  process.env.RAILWAY_SERVICE_ID || process.env.RAILWAY_ENVIRONMENT_NAME
);

function looksUnresolved(v) { return v.includes('${'); }
function isPostgresUrl(v) { return /^postgres(ql)?:\/\//i.test(v); }

/** Railway's Postgres service also exports PGHOST/PGUSER/... separately. */
function fromParts() {
  const { PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT } = process.env;
  if (!PGHOST || !PGUSER || !PGDATABASE) return null;
  if ([PGHOST, PGUSER, PGDATABASE].some(looksUnresolved)) return null;
  const auth = encodeURIComponent(PGUSER) +
    (PGPASSWORD ? ':' + encodeURIComponent(PGPASSWORD) : '');
  return {
    source: 'PGHOST/PGUSER/PGDATABASE',
    connectionString: `postgres://${auth}@${PGHOST}:${PGPORT || 5432}/${PGDATABASE}`
  };
}

function resolveConnection() {
  const problems = [];
  for (const name of URL_VARS) {
    const raw = (process.env[name] || '').trim();
    if (!raw) continue;
    if (looksUnresolved(raw)) {
      problems.push(`${name} is set to "${raw}" -- that is an unresolved ` +
        'Railway variable reference, not an address.');
      continue;
    }
    if (!isPostgresUrl(raw)) {
      problems.push(`${name} does not look like a postgres:// URL.`);
      continue;
    }
    return { source: name, connectionString: raw, problems };
  }
  const parts = fromParts();
  if (parts) return { ...parts, problems };
  return { problems };
}

function fail(lines) {
  const width = 72;
  console.error('\n' + '='.repeat(width));
  console.error('  Databasen kunde inte nås / could not reach the database');
  console.error('='.repeat(width));
  lines.forEach(l => console.error('  ' + l));
  console.error('='.repeat(width) + '\n');
  process.exit(1);
}

const SETUP_HELP = [
  'How to fix it on Railway:',
  '',
  '  1. In the SAME project, add the database:',
  '       New -> Database -> Add PostgreSQL',
  '  2. Open THIS service (the app, not the database) -> Variables',
  '  3. New Variable, then either:',
  '       - press "Add Reference" and pick Postgres -> DATABASE_URL, or',
  '       - name it DATABASE_URL with the value  ${{Postgres.DATABASE_URL}}',
  '     The value must show as a linked reference, not as plain text.',
  '     If the database service is named something else, use that name.',
  '  4. Deploy. This log will print the host it connects to.',
  '',
  'Variables the app can use: ' + URL_VARS.join(', ') +
    ' -- or PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT.'
];

const resolved = resolveConnection();

if (!resolved.connectionString) {
  fail([
    'No usable Postgres address was found in this service\'s environment.',
    ...(resolved.problems.length ? ['', 'What was found:', ...resolved.problems.map(p => '  - ' + p)] : []),
    '',
    ...SETUP_HELP
  ]);
}

let parsedUrl;
try {
  parsedUrl = new URL(resolved.connectionString);
} catch {
  fail([`${resolved.source} is not a valid URL.`, '', ...SETUP_HELP]);
}

const HOST = parsedUrl.hostname;
const IS_LOOPBACK = HOST === 'localhost' || HOST === '127.0.0.1' || HOST === '::1';

if (ON_RAILWAY && IS_LOOPBACK) {
  fail([
    `${resolved.source} points at ${HOST} -- that is this container itself,`,
    'which runs no database, so the connection is refused.',
    'The Postgres service has its own hostname (postgres.railway.internal).',
    '',
    ...SETUP_HELP
  ]);
}

/** postgres://user:secret@host:5432/db  ->  postgres://user:***@host:5432/db */
function redact(u) {
  const c = new URL(u.toString());
  if (c.password) c.password = '***';
  return c.toString();
}

/* ------------------------------------------------------------------ *
 * Connecting                                                          *
 *                                                                     *
 * Railway's private network speaks plain TCP; its public TCP proxy     *
 * wants TLS but presents a certificate no public CA signed. Rather     *
 * than guess, try the likely mode first and fall back to the other,    *
 * unless the URL states sslmode= itself.                               *
 * ------------------------------------------------------------------ */

const sslMode = (parsedUrl.searchParams.get('sslmode') || '').toLowerCase();
const PREFERS_PLAIN = IS_LOOPBACK || HOST.endsWith('.railway.internal');
const LAX_TLS = { rejectUnauthorized: false };
const STRICT_TLS = process.env.DB_SSL_STRICT === '1';
const TLS = STRICT_TLS ? true : LAX_TLS;

// sslmode= in the URL is read here and then removed, so that node-postgres
// cannot quietly upgrade "require" to full certificate verification --
// which fails against Railway's self-signed proxy certificate. The mode
// still decides what we do; it just does not decide it twice.
const cleanUrl = new URL(parsedUrl.toString());
cleanUrl.searchParams.delete('sslmode');

let sslOrder;
if (sslMode === 'disable') sslOrder = [false];
else if (sslMode) sslOrder = [TLS];
else sslOrder = PREFERS_PLAIN ? [false, TLS] : [TLS, false];

const POOL_OPTS = {
  connectionString: cleanUrl.toString(),
  max: Number(process.env.PGPOOL_MAX || 5),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
};

const TRANSIENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET']);

let pool = null;

async function openPool() {
  let lastErr = null;
  for (const ssl of sslOrder) {
    const candidate = new Pool({ ...POOL_OPTS, ssl });
    try {
      const client = await candidate.connect();
      client.release();
      console.log(`[db] connected to ${redact(parsedUrl)} (ssl: ${ssl ? 'on' : 'off'}, from ${resolved.source})`);
      candidate.on('error', err => console.error('[db] idle client error', err));
      return candidate;
    } catch (err) {
      lastErr = err;
      await candidate.end().catch(() => {});
      // A refused/unknown host will not be fixed by changing SSL mode.
      if (TRANSIENT.has(err.code)) break;
    }
  }
  throw lastErr;
}

/** Railway can start the app before Postgres accepts connections. */
async function connectWithRetry(attempts = Number(process.env.DB_CONNECT_ATTEMPTS || 6)) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await openPool();
    } catch (err) {
      const last = i === attempts;
      if (last || !TRANSIENT.has(err.code)) {
        fail([
          `Tried ${redact(parsedUrl)} (from ${resolved.source}) and got ${err.code || err.message}.`,
          '',
          ...(TRANSIENT.has(err.code)
            ? ['The address answered nothing. Either the database service is not',
               'running yet, or the URL points somewhere without a database.']
            : ['The server answered but refused the connection:', '  ' + err.message]),
          '',
          ...SETUP_HELP
        ]);
      }
      const wait = Math.min(30000, 2000 * 2 ** (i - 1));
      console.warn(`[db] ${err.code} on attempt ${i}/${attempts}; retrying in ${wait / 1000}s`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

/* ------------------------------------------------------------------ *
 * Schema                                                              *
 *                                                                     *
 * Vehicles and questions live in the database, not in the code, so     *
 * that /admin can change them. Each submission keeps a snapshot of the *
 * questions it was answered against: edit a form tomorrow and last     *
 * week's checks still read the way they were filled in.                *
 * ------------------------------------------------------------------ */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS forms (
  id          BIGSERIAL PRIMARY KEY,
  key         TEXT        NOT NULL UNIQUE,
  title       TEXT        NOT NULL,
  is_default  BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS form_fields (
  id        BIGSERIAL PRIMARY KEY,
  form_id   BIGINT  NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  name      TEXT    NOT NULL,
  kind      TEXT    NOT NULL,
  label     TEXT    NOT NULL,
  section   TEXT    NOT NULL DEFAULT '',
  required  BOOLEAN NOT NULL DEFAULT false,
  role      TEXT    NOT NULL DEFAULT '',
  UNIQUE (form_id, name)
);
ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS options  JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS source   TEXT  NOT NULL DEFAULT '';
ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS alert_on JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS i18n     JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS form_fields_order_idx ON form_fields (form_id, position);

ALTER TABLE forms ADD COLUMN IF NOT EXISTS i18n JSONB NOT NULL DEFAULT '{}'::jsonb;

-- The driver roster, replaced wholesale by the nightly sync from the
-- Route Suite. Never edited by hand here; whatever the suite says wins.
CREATE TABLE IF NOT EXISTS drivers (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT    NOT NULL UNIQUE,
  fleet      TEXT    NOT NULL DEFAULT '',
  type       TEXT    NOT NULL DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drivers_name_idx ON drivers (name);

-- One row per background job, so a restart cannot send the daily mail twice.
CREATE TABLE IF NOT EXISTS jobs (
  name      TEXT PRIMARY KEY,
  last_run  TIMESTAMPTZ,
  last_key  TEXT,
  note      TEXT
);

CREATE TABLE IF NOT EXISTS vehicles (
  id          BIGSERIAL PRIMARY KEY,
  plate       TEXT    NOT NULL UNIQUE,
  owner       TEXT    NOT NULL DEFAULT '',
  fleet       TEXT    NOT NULL DEFAULT 'box',
  note        TEXT    NOT NULL DEFAULT '',
  active      BOOLEAN NOT NULL DEFAULT true,
  form_id     BIGINT  REFERENCES forms(id) ON DELETE SET NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicles_order_idx ON vehicles (fleet, sort_order, plate);

CREATE TABLE IF NOT EXISTS submissions (
  id            BIGSERIAL PRIMARY KEY,
  plate         TEXT        NOT NULL,
  owner         TEXT        NOT NULL DEFAULT '',
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
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS form_id    BIGINT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS form_title TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS questions  JSONB;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS lang       TEXT NOT NULL DEFAULT 'sv';
-- Unguessable handle for the receipt. A driver scanning a QR code may read
-- their own receipt and nobody else's, so the id alone is not enough.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS public_key TEXT;
CREATE INDEX IF NOT EXISTS submissions_plate_time_idx ON submissions (plate, submitted_at DESC);
CREATE INDEX IF NOT EXISTS submissions_time_idx ON submissions (submitted_at DESC);

-- Who was expected to check which vehicle, per day. Pushed from the Route
-- Suite's assigner; this app never decides an assignment itself.
CREATE TABLE IF NOT EXISTS assignments (
  id          BIGSERIAL PRIMARY KEY,
  date        DATE    NOT NULL,
  plate       TEXT    NOT NULL,
  driver      TEXT    NOT NULL,
  route       TEXT    NOT NULL DEFAULT '',
  type        TEXT    NOT NULL DEFAULT '',
  fleet       TEXT    NOT NULL DEFAULT 'box',
  source_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (date, plate, driver)
);
CREATE INDEX IF NOT EXISTS assignments_date_idx ON assignments (date DESC);
CREATE INDEX IF NOT EXISTS assignments_driver_idx ON assignments (driver);

CREATE TABLE IF NOT EXISTS photos (
  id             BIGSERIAL PRIMARY KEY,
  submission_id  BIGINT  NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  field          TEXT    NOT NULL,
  field_label    TEXT,
  filename       TEXT,
  mime           TEXT    NOT NULL,
  bytes          BYTEA   NOT NULL,
  byte_size      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_submission_idx ON photos (submission_id);
`;

/* ------------------------------------------------------------------ *
 * First run                                                           *
 * ------------------------------------------------------------------ */

async function seedIfEmpty(client) {
  const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM forms');
  if (rows[0].n === 0) {
    const form = await client.query(
      `INSERT INTO forms (key, title, is_default, i18n) VALUES ($1,$2,true,$3) RETURNING id`,
      [seed.FORM_KEY, seed.FORM_TITLE, JSON.stringify(seed.FORM_I18N || {})]);
    const formId = form.rows[0].id;
    let pos = 0;
    for (const f of seed.DEFAULT_FIELDS) {
      await client.query(
        `INSERT INTO form_fields
           (form_id, position, name, kind, label, section, required, role,
            options, source, alert_on, i18n)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [formId, pos += 10, f.name, f.kind, f.label, f.section || '', !!f.required, f.role || '',
         JSON.stringify(f.options || []), f.source || '',
         JSON.stringify(f.alertOn || []), JSON.stringify(f.i18n || {})]);
    }
    console.log(`[db] seeded default form with ${seed.DEFAULT_FIELDS.length} questions`);
  }

  const v = await client.query('SELECT COUNT(*)::int AS n FROM vehicles');
  if (v.rows[0].n === 0) {
    let order = 0;
    for (const car of seed.DEFAULT_VEHICLES) {
      await client.query(
        `INSERT INTO vehicles (plate, owner, fleet, sort_order) VALUES ($1,$2,$3,$4)`,
        [car.plate, car.owner, car.fleet, order += 10]);
    }
    console.log(`[db] seeded ${seed.DEFAULT_VEHICLES.length} vehicles`);
  }
}


/**
 * Bring an existing database up to the current seed.
 *
 * seedIfEmpty only fires on a virgin database, which meant every seed
 * improvement after the first deploy -- the dropdowns, the alert rules,
 * the translations -- was written in code and never reached the live rows.
 * This closes that gap once.
 *
 * Deliberately timid. A field is only touched when it still looks
 * untouched: the Swedish wording must be unchanged (proof the admin has
 * not rewritten the question) and each property is filled in only where it
 * is still empty. Anything edited in /admin wins. It runs once, recorded in
 * `jobs`, so removing a translation by hand does not see it reappear at the
 * next restart.
 */
const SEED_UPGRADE_KEY = 'seed-upgrade-2026-09-08-dropdowns-i18n';

async function upgradeSeededFields(client) {
  const done = await client.query('SELECT 1 FROM jobs WHERE name = $1', [SEED_UPGRADE_KEY]);
  if (done.rowCount) return null;

  let fields = 0;
  for (const f of seed.DEFAULT_FIELDS) {
    const r = await client.query(
      `UPDATE form_fields SET
         kind     = CASE WHEN kind = 'text' AND $3 <> 'text' THEN $3 ELSE kind END,
         options  = CASE WHEN options  = '[]'::jsonb THEN $4::jsonb ELSE options END,
         source   = CASE WHEN source   = ''          THEN $5      ELSE source END,
         alert_on = CASE WHEN alert_on = '[]'::jsonb THEN $6::jsonb ELSE alert_on END,
         i18n     = CASE WHEN i18n     = '{}'::jsonb THEN $7::jsonb ELSE i18n END
       WHERE name = $1 AND label = $2`,
      [f.name, f.label, f.kind,
       JSON.stringify(f.options || []), f.source || '',
       JSON.stringify(f.alertOn || []), JSON.stringify(f.i18n || {})]);
    fields += r.rowCount;
  }

  const titles = await client.query(
    `UPDATE forms SET i18n = $1::jsonb WHERE title = $2 AND i18n = '{}'::jsonb`,
    [JSON.stringify(seed.FORM_I18N || {}), seed.FORM_TITLE]);

  await client.query(
    `INSERT INTO jobs (name, last_run, note) VALUES ($1, now(), $2)
     ON CONFLICT (name) DO NOTHING`,
    [SEED_UPGRADE_KEY, `${fields} frågor, ${titles.rowCount} formulärtitlar`]);

  return { fields, titles: titles.rowCount };
}

/**
 * Add the three hand-back questions to forms that are already in the
 * database, and renumber the section headings from "av 4" to "av 5".
 *
 * Same caution as the upgrade above: a form only counts as a standard form
 * if its first question still reads exactly as the template's, and a
 * question is only inserted where its key is free. Runs once, recorded in
 * `jobs`, so a question deleted on purpose does not come back.
 */
const RETURN_UPGRADE_KEY = 'seed-return-questions-2026-09-09';

async function addReturnQuestions(client) {
  const done = await client.query('SELECT 1 FROM jobs WHERE name = $1', [RETURN_UPGRADE_KEY]);
  if (done.rowCount) return null;

  const anchor = seed.DEFAULT_FIELDS.find(f => f.role === 'odometer');
  const forms = await client.query(
    `SELECT DISTINCT form_id FROM form_fields WHERE name = $1 AND label = $2`,
    [anchor.name, anchor.label]);

  let inserted = 0, renamed = 0;
  for (const { form_id: formId } of forms.rows) {
    // Section headings first, so the new card lands among correct numbers.
    for (const { from, to } of seed.SECTION_RENAMES) {
      const rows = await client.query(
        'SELECT id, i18n FROM form_fields WHERE form_id = $1 AND section = $2', [formId, from]);
      for (const row of rows.rows) {
        const blob = row.i18n || {};
        for (const [code, text] of Object.entries(seed.SECTION_TEXT(to))) {
          if (blob[code]) blob[code] = { ...blob[code], section: text };
        }
        await client.query('UPDATE form_fields SET section = $2, i18n = $3::jsonb WHERE id = $1',
          [row.id, to, JSON.stringify(blob)]);
        renamed++;
      }
    }

    // Then the questions, immediately after the odometer.
    const at = await client.query(
      'SELECT position FROM form_fields WHERE form_id = $1 AND name = $2', [formId, anchor.name]);
    if (!at.rowCount) continue;
    const base = Number(at.rows[0].position);

    let step = 0;
    for (const f of seed.RETURN_FIELDS) {
      step++;
      const taken = await client.query(
        'SELECT 1 FROM form_fields WHERE form_id = $1 AND name = $2', [formId, f.name]);
      if (taken.rowCount) continue;
      await client.query(
        `INSERT INTO form_fields
           (form_id, position, name, kind, label, section, required, role,
            options, source, alert_on, i18n)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'', '[]'::jsonb, '', $8::jsonb, $9::jsonb)`,
        [formId, base + step, f.name, f.kind, f.label, f.section, !!f.required,
         JSON.stringify(f.alertOn || []), JSON.stringify(f.i18n || {})]);
      inserted++;
    }
    await client.query('UPDATE forms SET updated_at = now() WHERE id = $1', [formId]);
  }

  await client.query(
    `INSERT INTO jobs (name, last_run, note) VALUES ($1, now(), $2)
     ON CONFLICT (name) DO NOTHING`,
    [RETURN_UPGRADE_KEY, `${inserted} frågor i ${forms.rowCount} formulär, ${renamed} avsnittsrubriker`]);

  return { inserted, renamed, forms: forms.rowCount };
}

async function init() {
  pool = await connectWithRetry();
  await pool.query(SCHEMA);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seedIfEmpty(client);
    const upgraded = await upgradeSeededFields(client);
    const added = await addReturnQuestions(client);
    await client.query('COMMIT');
    if (added && (added.inserted || added.renamed)) {
      console.log(`[db] lade till ${added.inserted} frågor och numrerade om ${added.renamed} ` +
        `avsnittsrader i ${added.forms} formulär`);
    }
    if (upgraded && (upgraded.fields || upgraded.titles)) {
      console.log(`[db] uppgraderade ${upgraded.fields} frågor och ${upgraded.titles} formulärtitlar ` +
        'till aktuell mall (rullgardiner, larm, översättningar)');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  console.log('[db] schema ready');
}

/* ------------------------------------------------------------------ *
 * Vehicles                                                            *
 * ------------------------------------------------------------------ */

const VEHICLE_COLS = `id, plate, owner, fleet, note, active, form_id, sort_order`;

async function listVehicles({ includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE active';
  const r = await pool.query(
    `SELECT ${VEHICLE_COLS} FROM vehicles ${where}
      ORDER BY (fleet <> 'box'), sort_order, plate`);
  return r.rows;
}

async function getVehicle(plate) {
  const r = await pool.query(
    `SELECT ${VEHICLE_COLS} FROM vehicles WHERE plate = $1`, [normalisePlate(plate)]);
  return r.rows[0] || null;
}

async function getVehicleById(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const r = await pool.query(`SELECT ${VEHICLE_COLS} FROM vehicles WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function createVehicle({ plate, owner = '', fleet = 'box', note = '', formId = null }) {
  const r = await pool.query(
    `INSERT INTO vehicles (plate, owner, fleet, note, form_id, sort_order)
     VALUES ($1,$2,$3,$4,$5,
             COALESCE((SELECT MAX(sort_order) FROM vehicles WHERE fleet = $3), 0) + 10)
     RETURNING ${VEHICLE_COLS}`,
    [normalisePlate(plate), owner, fleet, note, formId]);
  return r.rows[0];
}

async function updateVehicle(id, { plate, owner, fleet, note, active, formId }) {
  const r = await pool.query(
    `UPDATE vehicles SET plate = $2, owner = $3, fleet = $4, note = $5,
            active = $6, form_id = $7
      WHERE id = $1 RETURNING ${VEHICLE_COLS}`,
    [id, normalisePlate(plate), owner, fleet, note, active, formId]);
  return r.rows[0] || null;
}

async function deleteVehicle(id) {
  await pool.query('DELETE FROM vehicles WHERE id = $1', [id]);
}

async function countSubmissionsForPlate(plate) {
  const r = await pool.query(
    'SELECT COUNT(*)::int AS n FROM submissions WHERE plate = $1', [plate]);
  return r.rows[0].n;
}

/* ------------------------------------------------------------------ *
 * Forms                                                               *
 * ------------------------------------------------------------------ */

async function listForms() {
  const r = await pool.query(
    `SELECT f.id, f.key, f.title, f.is_default, f.updated_at,
            (SELECT COUNT(*)::int FROM form_fields ff WHERE ff.form_id = f.id) AS field_count,
            (SELECT COUNT(*)::int FROM vehicles v WHERE v.form_id = f.id) AS vehicle_count
       FROM forms f ORDER BY f.is_default DESC, f.title`);
  return r.rows;
}

async function getForm(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const f = await pool.query('SELECT * FROM forms WHERE id = $1', [id]);
  if (!f.rows.length) return null;
  const fields = await pool.query(
    'SELECT * FROM form_fields WHERE form_id = $1 ORDER BY position, id', [id]);
  return { ...f.rows[0], fields: fields.rows };
}

async function getDefaultForm() {
  const f = await pool.query(
    'SELECT * FROM forms WHERE is_default ORDER BY id LIMIT 1');
  if (!f.rows.length) return null;
  return getForm(f.rows[0].id);
}

/** The form a vehicle uses: its own if it has one, otherwise the default. */
async function getFormForVehicle(vehicle) {
  if (vehicle && vehicle.form_id) {
    const own = await getForm(vehicle.form_id);
    if (own) return own;
  }
  return getDefaultForm();
}

function slugify(title) {
  return String(title).toLowerCase()
    .replace(/[åä]/g, 'a').replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'formular';
}

async function uniqueFormKey(base) {
  let key = base;
  for (let n = 2; ; n++) {
    const r = await pool.query('SELECT 1 FROM forms WHERE key = $1', [key]);
    if (!r.rows.length) return key;
    key = `${base}-${n}`;
  }
}

/** New form, optionally as a copy of an existing one's questions. */
async function createForm({ title, copyFromId = null }) {
  const key = await uniqueFormKey(slugify(title));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const f = await client.query(
      'INSERT INTO forms (key, title) VALUES ($1,$2) RETURNING id', [key, title]);
    const id = f.rows[0].id;
    if (copyFromId) {
      await client.query(
        `INSERT INTO form_fields
           (form_id, position, name, kind, label, section, required, role,
            options, source, alert_on, i18n)
         SELECT $1, position, name, kind, label, section, required, role,
                options, source, alert_on, i18n
           FROM form_fields WHERE form_id = $2`, [id, copyFromId]);
    }
    await client.query('COMMIT');
    return id;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function updateForm(id, { title }) {
  await pool.query(
    'UPDATE forms SET title = $2, updated_at = now() WHERE id = $1', [id, title]);
}

async function deleteForm(id) {
  await pool.query('DELETE FROM forms WHERE id = $1 AND NOT is_default', [id]);
}

async function touchForm(id) {
  await pool.query('UPDATE forms SET updated_at = now() WHERE id = $1', [id]);
}

/** A key that has never been used in this form, so old answers stay put. */
async function nextFieldName(formId) {
  const r = await pool.query('SELECT name FROM form_fields WHERE form_id = $1', [formId]);
  const taken = new Set(r.rows.map(x => x.name));
  for (let n = 1; ; n++) {
    const candidate = 'q' + n;
    if (!taken.has(candidate)) return candidate;
  }
}

async function addField(formId, {
  kind, label, section = '', required = false, role = '',
  options = [], source = '', alertOn = [], i18n = {}
}) {
  const name = await nextFieldName(formId);
  const r = await pool.query(
    `INSERT INTO form_fields
       (form_id, position, name, kind, label, section, required, role,
        options, source, alert_on, i18n)
     VALUES ($1, COALESCE((SELECT MAX(position) FROM form_fields WHERE form_id = $1), 0) + 10,
             $2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [formId, name, kind, label, section, required, role,
     JSON.stringify(options), source, JSON.stringify(alertOn), JSON.stringify(i18n)]);
  await touchForm(formId);
  return r.rows[0];
}

async function getField(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const r = await pool.query('SELECT * FROM form_fields WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function updateField(id, {
  kind, label, section, required, role, options, source, alertOn, i18n
}) {
  const r = await pool.query(
    `UPDATE form_fields SET kind = $2, label = $3, section = $4, required = $5,
            role = $6, options = $7, source = $8, alert_on = $9, i18n = $10
      WHERE id = $1 RETURNING form_id`,
    [id, kind, label, section, required, role,
     JSON.stringify(options || []), source || '',
     JSON.stringify(alertOn || []), JSON.stringify(i18n || {})]);
  if (r.rows.length) await touchForm(r.rows[0].form_id);
}

async function deleteField(id) {
  const r = await pool.query(
    'DELETE FROM form_fields WHERE id = $1 RETURNING form_id', [id]);
  if (r.rows.length) await touchForm(r.rows[0].form_id);
}

/** Swap a question with its neighbour. Positions are opaque; order is not. */
async function moveField(id, direction) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const me = await client.query('SELECT * FROM form_fields WHERE id = $1 FOR UPDATE', [id]);
    if (!me.rows.length) { await client.query('ROLLBACK'); return; }
    const field = me.rows[0];
    const cmp = direction === 'up' ? '<' : '>';
    const order = direction === 'up' ? 'DESC' : 'ASC';
    const neighbour = await client.query(
      `SELECT * FROM form_fields
        WHERE form_id = $1 AND (position, id) ${cmp} ($2, $3)
        ORDER BY position ${order}, id ${order} LIMIT 1 FOR UPDATE`,
      [field.form_id, field.position, field.id]);
    if (!neighbour.rows.length) { await client.query('ROLLBACK'); return; }
    const other = neighbour.rows[0];
    await client.query('UPDATE form_fields SET position = $2 WHERE id = $1', [field.id, other.position]);
    await client.query('UPDATE form_fields SET position = $2 WHERE id = $1', [other.id, field.position]);
    await client.query('UPDATE forms SET updated_at = now() WHERE id = $1', [field.form_id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ *
 * Submissions                                                         *
 * ------------------------------------------------------------------ */

async function saveSubmission({
  plate, owner, form, answers, roles, photos, userAgent, clientIp, lang
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // The snapshot has to carry alert_on as well as the wording: without it
    // a check saved today could not be re-evaluated tomorrow, and the daily
    // mail would quietly report nothing to fix. i18n rides along so an old
    // check still reads in the language it was filed in.
    const questions = form.fields.map(f => ({
      name: f.name, kind: f.kind, label: f.label,
      section: f.section, required: f.required, role: f.role,
      alert_on: Array.isArray(f.alert_on) ? f.alert_on : [],
      options: Array.isArray(f.options) ? f.options : [],
      source: f.source || '',
      i18n: f.i18n || {}
    }));
    const res = await client.query(
      `INSERT INTO submissions
         (plate, owner, form_key, form_id, form_title, driver_name, route, odometer,
          answers, questions, photo_count, user_agent, client_ip, lang, public_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id, submitted_at, public_key`,
      [
        plate, owner || '', form.key, form.id, form.title,
        roles.driver || null, roles.route || null, roles.odometer || null,
        JSON.stringify(answers), JSON.stringify(questions),
        photos.length, userAgent || null, clientIp || null, lang || 'sv',
        crypto.randomBytes(9).toString('base64url')
      ]
    );
    const id = res.rows[0].id;
    for (const p of photos) {
      await client.query(
        `INSERT INTO photos (submission_id, field, field_label, filename, mime, bytes, byte_size)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, p.field, p.label || null, p.filename || null, p.mime, p.buffer, p.buffer.length]);
    }
    await client.query('COMMIT');
    return { id: String(id), submittedAt: res.rows[0].submitted_at, key: res.rows[0].public_key };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

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
    `SELECT id, plate, submitted_at, driver_name, route, odometer,
            photo_count, answers, questions, form_title
       FROM submissions ${clause}
      ORDER BY submitted_at DESC, id DESC
      LIMIT ${lim} OFFSET ${off}`, args);

  const count = await pool.query(
    `SELECT COUNT(*)::int AS n FROM submissions ${clause}`, args.slice(0, args.length - 2));

  return { rows: rows.rows, total: count.rows[0].n };
}

async function getSubmission(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const s = await pool.query('SELECT * FROM submissions WHERE id = $1', [id]);
  if (!s.rows.length) return null;
  const p = await pool.query(
    `SELECT id, field, field_label, filename, mime, byte_size
       FROM photos WHERE submission_id = $1 ORDER BY id`, [id]);
  return { ...s.rows[0], photos: p.rows };
}

async function getPhoto(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const r = await pool.query('SELECT mime, bytes, filename FROM photos WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function latestPerVehicle() {
  const r = await pool.query(
    `SELECT DISTINCT ON (plate) plate, submitted_at, driver_name
       FROM submissions ORDER BY plate, submitted_at DESC`);
  return new Map(r.rows.map(row => [row.plate, row]));
}


/* ------------------------------------------------------------------ *
 * Drivers                                                             *
 *                                                                     *
 * Owned by the Route Suite, not by this app: the nightly sync posts    *
 * the whole roster and it replaces what was here. Names that vanish    *
 * from the suite are marked inactive rather than deleted, so a check   *
 * signed by someone who has since left still resolves.                *
 * ------------------------------------------------------------------ */

const SV_COLLATOR = new Intl.Collator('sv', { sensitivity: 'base' });

async function listDrivers({ includeInactive = false } = {}) {
  const r = await pool.query(
    `SELECT name, fleet, type, active, updated_at FROM drivers
      ${includeInactive ? '' : 'WHERE active'}`);
  // Sorted here, not in SQL: Swedish puts Å Ä Ö after Z, and a database
  // collation that does that is not guaranteed to exist on every Postgres
  // image. Intl always gets it right.
  return r.rows.sort((a, b) => SV_COLLATOR.compare(a.name, b.name));
}

/** Replaces the roster. Returns what changed, for the sync log. */
async function replaceDrivers(list) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query('SELECT name, active FROM drivers');
    const seen = new Set();
    let added = 0;
    for (const d of list) {
      const name = String(d.name || '').trim().slice(0, 200);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const r = await client.query(
        `INSERT INTO drivers (name, fleet, type, active, updated_at)
         VALUES ($1,$2,$3,true,now())
         ON CONFLICT (name) DO UPDATE
           SET fleet = EXCLUDED.fleet, type = EXCLUDED.type,
               active = true, updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [name, String(d.fleet || '').slice(0, 40), String(d.type || '').slice(0, 40)]);
      if (r.rows[0].inserted) added++;
    }
    const gone = await client.query(
      `UPDATE drivers SET active = false, updated_at = now()
        WHERE active AND NOT (name = ANY($1::text[])) RETURNING name`,
      [[...seen]]);
    await client.query('COMMIT');
    return { total: seen.size, added, deactivated: gone.rows.map(r => r.name), before: before.rowCount };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ *
 * Background jobs                                                     *
 * ------------------------------------------------------------------ */

/** True only for the first caller with this key -- the daily mail guard. */
async function claimJob(name, key) {
  const r = await pool.query(
    `INSERT INTO jobs (name, last_run, last_key) VALUES ($1, now(), $2)
     ON CONFLICT (name) DO UPDATE SET last_run = now(), last_key = $2
       WHERE jobs.last_key IS DISTINCT FROM $2
     RETURNING name`, [name, key]);
  return r.rowCount > 0;
}

async function jobState(name) {
  const r = await pool.query('SELECT * FROM jobs WHERE name = $1', [name]);
  return r.rows[0] || null;
}

/** Every submission in a day (Europe/Stockholm), for the mail and the API. */
async function submissionsBetween(fromDate, toDate) {
  const r = await pool.query(
    `SELECT id, plate, owner, form_id, form_key, form_title, submitted_at, lang,
            driver_name, route, odometer, answers, questions, photo_count
       FROM submissions
      WHERE submitted_at >= ($1::date AT TIME ZONE 'Europe/Stockholm')
        AND submitted_at <  (($2::date + 1) AT TIME ZONE 'Europe/Stockholm')
      ORDER BY submitted_at`, [fromDate, toDate]);
  return r.rows;
}

async function photoIdsFor(submissionIds) {
  if (!submissionIds.length) return new Map();
  const r = await pool.query(
    `SELECT id, submission_id, field, mime, byte_size FROM photos
      WHERE submission_id = ANY($1::bigint[]) ORDER BY id`, [submissionIds]);
  const out = new Map();
  for (const row of r.rows) {
    if (!out.has(String(row.submission_id))) out.set(String(row.submission_id), []);
    out.get(String(row.submission_id)).push(row);
  }
  return out;
}


/* ------------------------------------------------------------------ *
 * Assignments                                                         *
 * ------------------------------------------------------------------ */

/**
 * Replace the assignments for the days covered by this push.
 *
 * Scoped by day rather than merged: the assigner is re-run and its answer
 * for a day supersedes the previous one, so a route that moved to another
 * driver must not leave the old pairing behind and double-count.
 */
async function replaceAssignments(rows) {
  const dates = [...new Set(rows.map(r => r.date))];
  if (!dates.length) return { days: 0, rows: 0 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM assignments WHERE date = ANY($1::date[])', [dates]);
    let n = 0;
    for (const r of rows) {
      const res = await client.query(
        `INSERT INTO assignments (date, plate, driver, route, type, fleet, source_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (date, plate, driver) DO NOTHING`,
        [r.date, r.plate, r.driver, r.route || '', r.type || '', r.fleet || 'box',
         r.sourceAt || null]);
      n += res.rowCount;
    }
    await client.query('COMMIT');
    return { days: dates.length, rows: n, dates: dates.sort() };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function assignmentsBetween(from, to) {
  const r = await pool.query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, plate, driver, route, type, fleet
       FROM assignments WHERE date >= $1::date AND date <= $2::date
      ORDER BY date, route, plate`, [from, to]);
  return r.rows;
}

async function assignmentRange() {
  const r = await pool.query(
    `SELECT to_char(MIN(date),'YYYY-MM-DD') AS first,
            to_char(MAX(date),'YYYY-MM-DD') AS last, COUNT(*)::int AS n
       FROM assignments`);
  return r.rows[0];
}

/* ------------------------------------------------------------------ *
 * Deleting a check                                                    *
 * ------------------------------------------------------------------ */

/** Photos go with it (ON DELETE CASCADE); nothing else references a check. */
async function deleteSubmission(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const r = await pool.query(
    'DELETE FROM submissions WHERE id = $1 RETURNING id, plate, driver_name, submitted_at', [id]);
  return r.rows[0] || null;
}

module.exports = {
  init,
  listVehicles, getVehicle, getVehicleById, createVehicle, updateVehicle,
  deleteVehicle, countSubmissionsForPlate,
  listForms, getForm, getDefaultForm, getFormForVehicle, createForm,
  updateForm, deleteForm, addField, getField, updateField, deleteField, moveField,
  saveSubmission, listSubmissions, getSubmission, getPhoto, latestPerVehicle,
  listDrivers, replaceDrivers, claimJob, jobState, submissionsBetween, photoIdsFor,
  replaceAssignments, assignmentsBetween, assignmentRange, deleteSubmission,
  get pool() { return pool; }
};
