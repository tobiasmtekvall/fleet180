'use strict';

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
CREATE INDEX IF NOT EXISTS form_fields_order_idx ON form_fields (form_id, position);

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
CREATE INDEX IF NOT EXISTS submissions_plate_time_idx ON submissions (plate, submitted_at DESC);
CREATE INDEX IF NOT EXISTS submissions_time_idx ON submissions (submitted_at DESC);

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
      `INSERT INTO forms (key, title, is_default) VALUES ($1,$2,true) RETURNING id`,
      [seed.FORM_KEY, seed.FORM_TITLE]);
    const formId = form.rows[0].id;
    let pos = 0;
    for (const f of seed.DEFAULT_FIELDS) {
      await client.query(
        `INSERT INTO form_fields (form_id, position, name, kind, label, section, required, role)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [formId, pos += 10, f.name, f.kind, f.label, f.section || '', !!f.required, f.role || '']);
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

async function init() {
  pool = await connectWithRetry();
  await pool.query(SCHEMA);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seedIfEmpty(client);
    await client.query('COMMIT');
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
        `INSERT INTO form_fields (form_id, position, name, kind, label, section, required, role)
         SELECT $1, position, name, kind, label, section, required, role
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

async function addField(formId, { kind, label, section = '', required = false, role = '' }) {
  const name = await nextFieldName(formId);
  const r = await pool.query(
    `INSERT INTO form_fields (form_id, position, name, kind, label, section, required, role)
     VALUES ($1, COALESCE((SELECT MAX(position) FROM form_fields WHERE form_id = $1), 0) + 10,
             $2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [formId, name, kind, label, section, required, role]);
  await touchForm(formId);
  return r.rows[0];
}

async function getField(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const r = await pool.query('SELECT * FROM form_fields WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function updateField(id, { kind, label, section, required, role }) {
  const r = await pool.query(
    `UPDATE form_fields SET kind = $2, label = $3, section = $4, required = $5, role = $6
      WHERE id = $1 RETURNING form_id`, [id, kind, label, section, required, role]);
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
  plate, owner, form, answers, roles, photos, userAgent, clientIp
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const questions = form.fields.map(f => ({
      name: f.name, kind: f.kind, label: f.label,
      section: f.section, required: f.required, role: f.role
    }));
    const res = await client.query(
      `INSERT INTO submissions
         (plate, owner, form_key, form_id, form_title, driver_name, route, odometer,
          answers, questions, photo_count, user_agent, client_ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, submitted_at`,
      [
        plate, owner || '', form.key, form.id, form.title,
        roles.driver || null, roles.route || null, roles.odometer || null,
        JSON.stringify(answers), JSON.stringify(questions),
        photos.length, userAgent || null, clientIp || null
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
    return { id: String(id), submittedAt: res.rows[0].submitted_at };
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

module.exports = {
  init,
  listVehicles, getVehicle, getVehicleById, createVehicle, updateVehicle,
  deleteVehicle, countSubmissionsForPlate,
  listForms, getForm, getDefaultForm, getFormForVehicle, createForm,
  updateForm, deleteForm, addField, getField, updateField, deleteField, moveField,
  saveSubmission, listSubmissions, getSubmission, getPhoto, latestPerVehicle,
  get pool() { return pool; }
};
