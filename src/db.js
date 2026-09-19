'use strict';

const crypto = require('crypto');
const { Pool } = require('pg');
const seed = require('./seed');
const { normalisePlate } = require('./plate');
const { SCHEMA: calendarSchema } = require('./calendar/store');

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
-- What the follow-up asks when an answer flags. "Does the exterior lighting
-- work?" answered Nej should not leave a driver typing "halvljuset fram
-- höger" into a free-text box at 05:30 -- and should not leave the workshop
-- reading fifteen spellings of the same lamp. The list is per question and
-- editable, and its translations ride in the same i18n blob as the label.
ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS comment_options JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Where that list comes from. '' = the question's own list (above); 'lights' =
-- the dashboard telltales of the vehicle being checked, which differ per model
-- and are therefore not something one shared form can hold.
ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS comment_source TEXT NOT NULL DEFAULT '';
-- What the driver is TOLD when the answer flags, as opposed to what they are
-- asked. "Is the cab clean? No" was being filed as somebody else's problem;
-- the person holding the phone is the one who can pick the wrappers up, so
-- the instruction appears the moment they answer, above the comment box.
-- Swedish here, the three translations in the i18n blob beside the label.
ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS alert_notice TEXT NOT NULL DEFAULT '';
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

-- Small named values the admin sets and the app reads back: at the moment only
-- the statistics reset line (stats_epoch). A table rather than an env var
-- because it is changed from the admin pages, and rather than a column on
-- something else because it belongs to no row.
-- (No backticks anywhere in SCHEMA: it is a JS template literal, and one
-- backtick in a SQL comment ends the string thirty lines early.)
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT        NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
-- Which van this is. It decides the warning-light list the driver is offered,
-- so it belongs to the vehicle rather than to the form. Empty means "not set
-- yet" and falls back to the shared list.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS model_key TEXT NOT NULL DEFAULT '';
-- The instruktionsbok this van's page links to. Empty means "whatever the
-- model's own manual is" (telltales.manualFor); a value here is a file in
-- public/manualer/ and overrides it for this van only.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS manual_file TEXT NOT NULL DEFAULT '';
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
-- When the form was opened, and how long it took to fill in. The point is not
-- speed but the opposite: a check filled in faster than anybody could have
-- walked round the van is a check that was not done. Kept NULL rather than
-- guessed whenever the number cannot mean anything -- a page left open all day,
-- a clock that moved, a check posted without going through the form.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS opened_at    TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS fill_seconds INTEGER;
-- What the assigner had decided for this vehicle on the day the check was
-- filed, kept ON the check rather than looked up later: assignments are
-- replaced whenever the assigner re-runs, so a lookup a week from now could
-- not tell you who was expected to be in this van when it was signed for.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS assigned_driver TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS assigned_route  TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS driver_changed  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS change_approver TEXT;
CREATE INDEX IF NOT EXISTS submissions_plate_time_idx ON submissions (plate, submitted_at DESC);
CREATE INDEX IF NOT EXISTS submissions_time_idx ON submissions (submitted_at DESC);
-- 2026-09-19: a fingerprint of the snapshot above, so that a page reading
-- months of checks can tell which of them were filed against the same form
-- without decompressing 30 kB of JSON apiece to find out. See
-- checksForAttention(); the attention report went from reading 60 MB to
-- reading a few hundred kB because of this one column.
-- Filled at insert and backfilled here for everything that predates it. The
-- UPDATE is written to do nothing at all once every row has one, so it is
-- safe on every boot like the rest of this file.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS questions_hash TEXT;
UPDATE submissions SET questions_hash = md5(questions::text)
 WHERE questions_hash IS NULL AND questions IS NOT NULL;
CREATE INDEX IF NOT EXISTS submissions_qhash_idx ON submissions (questions_hash);

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
-- The fleet belongs in the key. A push replaces one (day, fleet) at a time, so
-- without it a plate that appears in both fleets on one day loses the second
-- row to ON CONFLICT DO NOTHING and the surviving row carries the wrong fleet
-- -- which the other tab's next push would then delete.
ALTER TABLE assignments DROP CONSTRAINT IF EXISTS assignments_date_plate_driver_key;
-- A unique INDEX rather than ADD CONSTRAINT, because this file runs on every
-- boot and ADD CONSTRAINT has no IF NOT EXISTS: the second start would die on
-- "already exists" and take the app down with it. ON CONFLICT is happy with a
-- unique index.
CREATE UNIQUE INDEX IF NOT EXISTS assignments_day_plate_driver_fleet_key
  ON assignments (date, plate, driver, fleet);
CREATE INDEX IF NOT EXISTS assignments_date_idx ON assignments (date DESC);
CREATE INDEX IF NOT EXISTS assignments_driver_idx ON assignments (driver);
-- The form asks "who has this van today" on every scan, and "who had it the
-- last seven days" beside it. Both read by plate.
CREATE INDEX IF NOT EXISTS assignments_plate_date_idx ON assignments (plate, date DESC);

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

-- The Checklist Calendar's own tables. Kept in its module so the two things
-- stay separable; appended here so they are created by the same idempotent
-- pass as everything else. See src/calendar/store.js.
${calendarSchema}

-- Placed last: incidents references submissions, and on an empty database
-- the table must exist before the foreign key can point at it.
-- The incident ledger: one row per damage to a vehicle, from what happened to
-- what it cost and who signed it off. Deliberately separate from submissions --
-- a safety check is a driver saying what they saw on one morning, an incident
-- is a case that stays open for weeks while the van is at the body shop and an
-- invoice makes its way over. They are linked (submission_id) but not merged.
CREATE TABLE IF NOT EXISTS incidents (
  id            BIGSERIAL PRIMARY KEY,
  plate         TEXT        NOT NULL,
  occurred_on   DATE        NOT NULL,
  description   TEXT        NOT NULL DEFAULT '',
  driver_name   TEXT        NOT NULL DEFAULT '',
  shop_in       DATE,
  shop_out      DATE,
  -- Kronor and ore. NUMERIC, never a float: money that is out by a rounding
  -- error is money somebody has to explain.
  cost_sek      NUMERIC(12,2),
  sm_ok         BOOLEAN     NOT NULL DEFAULT false,
  sm_by         TEXT        NOT NULL DEFAULT '',
  sm_at         TIMESTAMPTZ,
  submission_id BIGINT      REFERENCES submissions(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incidents_plate_idx ON incidents (plate, occurred_on DESC);
CREATE INDEX IF NOT EXISTS incidents_date_idx ON incidents (occurred_on DESC, id DESC);
-- One incident per damage report, so the "not yet handled" list above the
-- table cannot show the same report twice and two people cannot both file it.
CREATE UNIQUE INDEX IF NOT EXISTS incidents_submission_idx
  ON incidents (submission_id) WHERE submission_id IS NOT NULL;
-- 2026-09-15: the ledger became Expenses. A row is either a damage case or a
-- spare-part purchase (no workshop dates), and says who did the work. Both
-- ADD COLUMN IF NOT EXISTS, because this whole block runs on every boot.
-- handled_by is '' until somebody picks: it is never derived from the van's
-- owner, a rented van can still be fixed in-house.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS category   TEXT NOT NULL DEFAULT 'damage';
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS handled_by TEXT NOT NULL DEFAULT '';
-- 2026-09-16: Expenses covers Vehicles, Tools and Misc. Only vehicle rows
-- carry a plate, a driver, a category and workshop dates; tools and misc
-- have plate '' and category ''. Supplier, invoice number and a note are
-- for every row. "In-house" was renamed "Own"; the UPDATE is a no-op once
-- nothing is left to rename, so it is safe on every boot.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS scope      TEXT NOT NULL DEFAULT 'vehicle';
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS supplier   TEXT NOT NULL DEFAULT '';
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS invoice_no TEXT NOT NULL DEFAULT '';
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS note       TEXT NOT NULL DEFAULT '';
UPDATE incidents SET handled_by = 'own' WHERE handled_by = 'inhouse';
CREATE INDEX IF NOT EXISTS incidents_scope_idx ON incidents (scope, occurred_on DESC);
-- 2026-09-16: Rental cars, the fourth section. A hire carries the firm it
-- came from, the day it goes back, and (optionally) the van it stands in for
-- while that one is off the road. NOTE: on a rental row the plate column is
-- the HIRE CAR's registration, which is not one of ours and therefore free
-- text; for_plate is the van from our own fleet. (No backticks anywhere in
-- this string: SCHEMA is a template literal and one would end it here.)
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS rental_firm TEXT NOT NULL DEFAULT '';
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS rented_to   DATE;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS for_plate   TEXT NOT NULL DEFAULT '';
-- 2026-09-18: Estimat (Reparation), the fifth section. A quote from one of
-- three workshops for work not done yet, so it carries no cost_sek at all:
-- quoted_sek is what somebody asked for, and it is deliberately a separate
-- column -- here and on incident_sm_events -- so that no sum of cost_sek
-- anywhere can mistake a quote for money spent. occurred_on is the day the
-- estimate came in; sm_ok/sm_by/
-- sm_at carry "accepted, we are going ahead" on these rows.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS estimate_shop TEXT NOT NULL DEFAULT '';
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS quoted_sek    NUMERIC(12,2);

-- Photos of the damage and invoices from the workshop, in the database beside
-- everything else so a backup is a backup of the whole case.
CREATE TABLE IF NOT EXISTS incident_files (
  id          BIGSERIAL PRIMARY KEY,
  incident_id BIGINT      NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL DEFAULT 'photo',
  filename    TEXT,
  mime        TEXT        NOT NULL,
  bytes       BYTEA       NOT NULL,
  byte_size   INTEGER     NOT NULL DEFAULT 0,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- When the PHOTOGRAPH was taken, read out of the file's own EXIF. Null
  -- when the file carries none (a PDF, a screenshot, a picture an app has
  -- re-encoded), and then the upload time is all there is. The two are
  -- shown differently on purpose: "taken" is evidence, "uploaded" is not.
  taken_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS incident_files_idx ON incident_files (incident_id, id);
-- The column above reaches a fresh install only; every existing database
-- needs it added, like every other column in this file.
ALTER TABLE incident_files ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ;

-- 2026-09-18: Wheels. Tyres are not an expense and not a check -- they are a
-- thing every van has two sets of, and the question asked of them is always
-- the same one: how much tread is left. A set is one vehicle's tyres for one
-- season; a reading is one measurement of one axle on one day, and readings
-- are KEPT rather than overwritten, because two of them are what says whether
-- a van needs tyres this month or after the summer.
CREATE TABLE IF NOT EXISTS wheel_sets (
  id         BIGSERIAL PRIMARY KEY,
  plate      TEXT NOT NULL,
  -- 'summer' or 'winter'. Two rows per van, made on demand, never both ways.
  season     TEXT NOT NULL,
  make       TEXT NOT NULL DEFAULT '',
  model      TEXT NOT NULL DEFAULT '',
  -- 235/65 R16C and the like, as written on the tyre wall.
  size       TEXT NOT NULL DEFAULT '',
  -- Studded or friction, which is a winter question and left empty otherwise.
  tyre_type  TEXT NOT NULL DEFAULT '',
  -- The DOT code's four digits: week and year of manufacture, e.g. 2321.
  -- Rubber ages whether or not it is driven on, so this is worth keeping.
  dot        TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- When this set came off for good. Null is the set the van has NOW; a date is
-- a set that has been replaced, kept with its own readings, its own make and
-- its own DOT code. Without this, new tyres in April would either be measured
-- into the old set's history -- one row describing two different pieces of
-- rubber -- or bought at the price of deleting the old one.
ALTER TABLE wheel_sets ADD COLUMN IF NOT EXISTS retired_on DATE;
-- One LIVE set per van per season. Retired ones are unlimited, and are what
-- makes a history a history. (The plain index came first; dropping it is a
-- no-op on every boot after the first.)
DROP INDEX IF EXISTS wheel_sets_idx;
CREATE UNIQUE INDEX IF NOT EXISTS wheel_sets_live_idx
  ON wheel_sets (plate, season) WHERE retired_on IS NULL;
-- Tyres belong to a van. Without the key, renaming a registration strands
-- every reading and every photo invisibly, and deleting the van leaves blobs
-- nothing can reach. Orphans are cleared first so the constraint can be added
-- to a database that already has some.
DELETE FROM wheel_sets ws WHERE NOT EXISTS (
  SELECT 1 FROM vehicles v WHERE v.plate = ws.plate);
DO $wheels$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wheel_sets_plate_fk') THEN
    ALTER TABLE wheel_sets ADD CONSTRAINT wheel_sets_plate_fk
      FOREIGN KEY (plate) REFERENCES vehicles(plate) ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $wheels$;

CREATE TABLE IF NOT EXISTS wheel_readings (
  id          BIGSERIAL PRIMARY KEY,
  set_id      BIGINT NOT NULL REFERENCES wheel_sets(id) ON DELETE CASCADE,
  -- 'front' or 'back'. One figure per axle, which is how it is measured.
  position    TEXT NOT NULL,
  depth_mm    NUMERIC(4,1) NOT NULL,
  measured_on DATE NOT NULL,
  measured_by TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wheel_readings_idx
  ON wheel_readings (set_id, position, measured_on DESC, id DESC);

-- Pictures of a tyre: a cut, a bulge, uneven wear. Beside the set rather than
-- beside a reading, because what they show is the tyre, not the day.
CREATE TABLE IF NOT EXISTS wheel_files (
  id          BIGSERIAL PRIMARY KEY,
  set_id      BIGINT      NOT NULL REFERENCES wheel_sets(id) ON DELETE CASCADE,
  position    TEXT        NOT NULL DEFAULT '',
  filename    TEXT,
  mime        TEXT        NOT NULL,
  bytes       BYTEA       NOT NULL,
  byte_size   INTEGER     NOT NULL DEFAULT 0,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  taken_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS wheel_files_idx ON wheel_files (set_id, id);

-- Which set is ON the van right now, and since when. On the vehicle because
-- that is what it is a fact about: a van is on winter tyres, a set is not.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fitted_season TEXT NOT NULL DEFAULT '';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fitted_since  DATE;

-- Every time the Site Manager signs off or takes it back. The incident row
-- carries the current state; this carries how it got there, because an
-- approval that was withdrawn is exactly the thing somebody will ask about.
CREATE TABLE IF NOT EXISTS incident_sm_events (
  id          BIGSERIAL PRIMARY KEY,
  incident_id BIGINT      NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  action      TEXT        NOT NULL,
  who         TEXT        NOT NULL DEFAULT '',
  cost_sek    NUMERIC(12,2),
  happened_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incident_sm_events_idx ON incident_sm_events (incident_id, id);
-- 2026-09-18: on an estimate this same signature means "accepted", and the
-- figure it was given against is a quote. It gets its own column here for the
-- same reason it has one on the incident: cost_sek must stay summable as
-- money spent, and an accepted quote is not that.
ALTER TABLE incident_sm_events ADD COLUMN IF NOT EXISTS quoted_sek NUMERIC(12,2);

-- 2026-09-19: the attention report (src/attention.js, /admin/attention).
--
-- The report itself is DERIVED -- what needs doing to a van is worked out
-- from the checks, the assignments, the incidents and the tread readings
-- every time the page is drawn, so nothing has to have been written at the
-- time a driver reported a fault for that fault to be on the list today, and
-- a question whose polarity is corrected next month re-reads correctly all
-- the way back. The only thing stored is the one thing that cannot be
-- derived: a person saying an item has been dealt with.
--
-- One row per act of clearing, never updated in place and never deleted.
-- covers_to is the sighting the page was showing when the button was
-- pressed, not the moment it was pressed: a check that lands while somebody
-- is reading the page must not be signed off by a click that never saw it,
-- and anything reported after that instant reopens the item by itself.
-- title is what the item said at the time, so a cleared item is still
-- legible after the question it came from has been rephrased or deleted.
CREATE TABLE IF NOT EXISTS attention_clears (
  id           BIGSERIAL PRIMARY KEY,
  item_key     TEXT        NOT NULL,
  plate        TEXT        NOT NULL DEFAULT '',
  kind         TEXT        NOT NULL DEFAULT '',
  title        TEXT        NOT NULL DEFAULT '',
  covers_to    TIMESTAMPTZ NOT NULL,
  cleared_by   TEXT        NOT NULL,
  cleared_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  note         TEXT        NOT NULL DEFAULT '',
  -- Taking it back. The row stays: "signed off on Tuesday and withdrawn on
  -- Thursday" is exactly the thing somebody will ask about later, and a
  -- DELETE would leave the page unable to answer.
  withdrawn_at TIMESTAMPTZ,
  withdrawn_by TEXT        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS attention_clears_key_idx ON attention_clears (item_key, id);
CREATE INDEX IF NOT EXISTS attention_clears_when_idx ON attention_clears (cleared_at DESC);

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
            options, source, alert_on, i18n, comment_options, comment_source,
            alert_notice)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [formId, pos += 10, f.name, f.kind, f.label, f.section || '', !!f.required, f.role || '',
         JSON.stringify(f.options || []), f.source || '',
         JSON.stringify(f.alertOn || []), JSON.stringify(f.i18n || {}),
         JSON.stringify(f.commentOptions || []), f.commentSource || '',
         f.alertNotice || '']);
    }
    console.log(`[db] seeded default form with ${seed.DEFAULT_FIELDS.length} questions`);
  }

  const v = await client.query('SELECT COUNT(*)::int AS n FROM vehicles');
  if (v.rows[0].n === 0) {
    let order = 0;
    for (const car of seed.DEFAULT_VEHICLES) {
      await client.query(
        `INSERT INTO vehicles (plate, owner, fleet, sort_order, model_key)
         VALUES ($1,$2,$3,$4,$5)`,
        [car.plate, car.owner, car.fleet, order += 10, car.modelKey || '']);
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

/**
 * Two changes to the standard form that a database seeded earlier will never
 * see on its own: the odometer question asks for kilometres, and the exterior
 * lighting question offers a list of lamps instead of an empty comment box.
 *
 * Timid in the same way as the two migrations above, and for the same reason:
 * a form somebody has edited is theirs. The odometer label is only replaced
 * where it still reads exactly as the old template's, and the lamp list is
 * only filled in where there is none. Recorded in `jobs`, so a list deleted
 * on purpose does not grow back at the next restart.
 */
const LAMPS_UPGRADE_KEY = 'seed-2026-09-13-lamps-and-odometer-km';
const OLD_ODOMETER_LABEL = 'Ange fordonets miltal:';

async function addLampsAndKilometres(client) {
  const done = await client.query('SELECT 1 FROM jobs WHERE name = $1', [LAMPS_UPGRADE_KEY]);
  if (done.rowCount) return null;

  const meter = seed.DEFAULT_FIELDS.find(f => f.role === 'odometer');
  const lamps = seed.DEFAULT_FIELDS.find(f => (f.commentOptions || []).length);

  // Kilometres. Only a question still carrying the old wording, and its
  // translations are replaced with it -- a label in km over a translation
  // that still says "mil" would be worse than leaving both alone.
  const km = await client.query(
    `UPDATE form_fields SET label = $2, i18n = $3::jsonb
      WHERE name = $1 AND label = $4`,
    [meter.name, meter.label, JSON.stringify(meter.i18n || {}), OLD_ODOMETER_LABEL]);

  // The lamp list, where the lighting question is still the template's and
  // has no list of its own.
  const withLamps = await client.query(
    `UPDATE form_fields
        SET comment_options = $3::jsonb,
            i18n = i18n || $4::jsonb
      WHERE name = $1 AND label = $2 AND comment_options = '[]'::jsonb`,
    [lamps.name, lamps.label, JSON.stringify(lamps.commentOptions || []),
     JSON.stringify(lamps.i18n || {})]);

  await client.query(
    `INSERT INTO jobs (name, last_run, note) VALUES ($1, now(), $2)
     ON CONFLICT (name) DO NOTHING`,
    [LAMPS_UPGRADE_KEY, `${km.rowCount} mätarfrågor till km, ${withLamps.rowCount} med lampval`]);

  return { km: km.rowCount, lamps: withLamps.rowCount };
}

/**
 * Give every question its follow-up list, point the warning-light question at
 * the vehicle, and record which vans are IVECO Daily.
 *
 * Timid like the migrations above, and each part independently so one edited
 * question does not stop the rest: a list is only filled in where the question
 * still reads exactly as the template's AND has no list of its own, and a
 * model is only set on a vehicle that has none. Recorded in `jobs`.
 */
const LISTS_UPGRADE_KEY = 'seed-2026-09-13-per-question-lists-and-models';

async function addQuestionLists(client) {
  const done = await client.query('SELECT 1 FROM jobs WHERE name = $1', [LISTS_UPGRADE_KEY]);
  if (done.rowCount) return null;

  let lists = 0, lamps = 0;
  for (const f of seed.DEFAULT_FIELDS) {
    if ((f.commentOptions || []).length) {
      const r = await client.query(
        `UPDATE form_fields
            SET comment_options = $3::jsonb, i18n = i18n || $4::jsonb
          WHERE name = $1 AND label = $2 AND comment_options = '[]'::jsonb`,
        [f.name, f.label, JSON.stringify(f.commentOptions), JSON.stringify(f.i18n || {})]);
      lists += r.rowCount;
    }
    if (f.commentSource) {
      const r = await client.query(
        `UPDATE form_fields SET comment_source = $3
          WHERE name = $1 AND label = $2 AND comment_source = ''`,
        [f.name, f.label, f.commentSource]);
      lamps += r.rowCount;
    }
  }

  /* The little question above each list ("Where on the vehicle?"). It rides
     along in the blob above for a question that is getting its list now, but
     the two questions that were given their lists by an earlier upgrade are
     already past that test -- so their heading is set here, and only where
     nobody has written one. */
  let heads = 0;
  for (const f of seed.DEFAULT_FIELDS) {
    const blob = f.i18n || {};
    const heading = {};
    for (const c of ['sv', 'en', 'ar', 'hi']) {
      if (blob[c] && blob[c].pickLabel) heading[c] = blob[c].pickLabel;
    }
    const codes = Object.keys(heading);
    if (!codes.length) continue;
    // One column, so the four languages are nested rather than listed.
    let expr = 'i18n';
    codes.forEach((c, i) => {
      expr = `jsonb_set(${expr}, '{${c}}', ` +
             `coalesce(${expr}->'${c}', '{}'::jsonb) || $${i + 3}::jsonb, true)`;
    });
    const r = await client.query(
      `UPDATE form_fields SET i18n = ${expr}
        WHERE name = $1 AND label = $2
          AND NOT (coalesce(i18n->'sv', '{}'::jsonb) ? 'pickLabel')`,
      [f.name, f.label, ...codes.map(c => JSON.stringify({ pickLabel: heading[c] }))]);
    heads += r.rowCount;
  }

  let models = 0;
  for (const car of seed.DEFAULT_VEHICLES) {
    if (!car.modelKey) continue;
    const r = await client.query(
      `UPDATE vehicles SET model_key = $2 WHERE plate = $1 AND model_key = ''`,
      [car.plate, car.modelKey]);
    models += r.rowCount;
  }

  await client.query(
    `INSERT INTO jobs (name, last_run, note) VALUES ($1, now(), $2)
     ON CONFLICT (name) DO NOTHING`,
    [LISTS_UPGRADE_KEY,
     `${lists} frågor fick välj-lista, ${lamps} frågor kopplade till fordonets lampor, ` +
     `${heads} frågor fick egen ledtext, ${models} fordon fick modell`]);

  return { lists, lamps, models, heads };
}

/**
 * The cab question, rewritten so it says what it means and asks the driver to
 * fix what they find.
 *
 * Three things at once, all about the same question: the wording spells out
 * what a clean cab is (matrester, omslagspapper, burkar och flaskor -- "inga
 * lösa föremål" was being read as "nothing rolling around"), the follow-up
 * list gains the three answers that were missing from it, and the question
 * gets a notice, shown the moment the answer flags: städa upp.
 *
 * Timid like the migrations above. The question is only touched where its
 * Swedish wording is still exactly the old template's -- proof nobody has
 * rewritten it -- and the notice is filled in separately where the wording is
 * already the new one but no notice has been written, so a form that has been
 * updated by hand still gets the half it is missing. Recorded in `jobs`.
 */
const CLEAN_UPGRADE_KEY = 'seed-2026-09-13-cab-clean-and-notices';
const OLD_CLEAN_LABEL = 'Är bilen städad? (inga lösa föremål i hytt). Svara ja eller nej.';

async function addCleanQuestion(client) {
  const done = await client.query('SELECT 1 FROM jobs WHERE name = $1', [CLEAN_UPGRADE_KEY]);
  if (done.rowCount) return null;

  const clean = seed.DEFAULT_FIELDS.find(f => f.name === 'f12');

  // The whole question, where it still reads as the old template's. The
  // translations go with it: a Swedish label that lists the wrappers over an
  // English one that does not is worse than leaving both alone.
  const rewritten = await client.query(
    `UPDATE form_fields
        SET label = $2, i18n = i18n || $3::jsonb, comment_options = $4::jsonb,
            alert_notice = $5
      WHERE name = $1 AND label = $6`,
    [clean.name, clean.label, JSON.stringify(clean.i18n || {}),
     JSON.stringify(clean.commentOptions || []), clean.alertNotice || '',
     OLD_CLEAN_LABEL]);

  // Any question already carrying the current wording but no notice. Keyed on
  // the notice being absent rather than on the label being old, because the
  // pass above can only fire once per question -- see the heading pass in
  // addQuestionLists() for the same trap.
  let noticed = 0;
  for (const f of seed.DEFAULT_FIELDS) {
    if (!f.alertNotice) continue;
    const r = await client.query(
      `UPDATE form_fields SET alert_notice = $3, i18n = i18n || $4::jsonb
        WHERE name = $1 AND label = $2 AND alert_notice = ''`,
      [f.name, f.label, f.alertNotice, JSON.stringify(f.i18n || {})]);
    noticed += r.rowCount;
  }

  await client.query(
    `INSERT INTO jobs (name, last_run, note) VALUES ($1, now(), $2)
     ON CONFLICT (name) DO NOTHING`,
    [CLEAN_UPGRADE_KEY,
     `${rewritten.rowCount} städfrågor omskrivna, ${noticed} frågor fick uppmaning`]);

  return { rewritten: rewritten.rowCount, noticed };
}

/**
 * Mark the two damage questions as such.
 *
 * The Händelser page finds damage reports by the question's role, not by its
 * wording -- see ROLES in fields.js. Existing forms have no role on them, so
 * they get one here: only where the Swedish wording is still exactly the
 * template's and no role has been set by hand.
 */
const DAMAGE_ROLE_KEY = 'seed-2026-09-14-damage-role';

async function addDamageRole(client) {
  const done = await client.query('SELECT 1 FROM jobs WHERE name = $1', [DAMAGE_ROLE_KEY]);
  if (done.rowCount) return null;

  let marked = 0;
  for (const f of seed.DEFAULT_FIELDS) {
    if (f.role !== 'damage') continue;
    const r = await client.query(
      `UPDATE form_fields SET role = 'damage'
        WHERE name = $1 AND label = $2 AND role = ''`, [f.name, f.label]);
    marked += r.rowCount;
  }

  await client.query(
    `INSERT INTO jobs (name, last_run, note) VALUES ($1, now(), $2)
     ON CONFLICT (name) DO NOTHING`,
    [DAMAGE_ROLE_KEY, `${marked} skadefrågor märkta`]);

  return { marked };
}

/**
 * Point the route question at the live list.
 *
 * The seeded dropdown said JK-EM-1…20. The assigner produces JKP-EM-n and
 * JKP-EM-n-RR for the box fleet and Budbee's numeric ids for the home fleet,
 * so the list matched nothing in either: the route never pre-selected itself
 * from the assignment, and a home driver could not pick their route at all,
 * because a dropdown refuses a value that is not one of its own options.
 *
 * Timid like the rest: only the question that still carries the route role and
 * has no source of its own. The old list is replaced at the same time, since
 * it is the fallback for a day with no assignment and a wrong fallback is
 * worse than a short one.
 */
const ROUTE_SOURCE_KEY = 'seed-2026-09-16-route-source';

async function addRouteSource(client) {
  const done = await client.query('SELECT 1 FROM jobs WHERE name = $1', [ROUTE_SOURCE_KEY]);
  if (done.rowCount) return null;

  const route = seed.DEFAULT_FIELDS.find(f => f.role === 'route');
  const r = await client.query(
    `UPDATE form_fields
        SET source = 'routes', options = $1::jsonb
      WHERE role = 'route' AND kind = 'select' AND source = ''`,
    [JSON.stringify(route ? route.options || [] : [])]);

  await client.query(
    `INSERT INTO jobs (name, last_run, note) VALUES ($1, now(), $2)
     ON CONFLICT (name) DO NOTHING`,
    [ROUTE_SOURCE_KEY, `${r.rowCount} ruttfrågor kopplade till tilldelningen`]);

  return { routes: r.rowCount };
}

/**
 * The model of every van in the fleet, and one mistyped plate.
 *
 * Until 2026-09-16 only the seven IVECOs we own had a model, so fifteen vans
 * were offered the shared warning-light list. Every plate was then looked up
 * in the Swedish vehicle register, so each one can have its own manual's list
 * — see seed.DEFAULT_VEHICLES and telltales.MODELS.
 *
 * RLX94L does not exist in the register. Tobias checked the van: it is
 * RLX94A. The rename is done first and only when the right plate is not
 * already there, so a van that has been corrected by hand is left alone; its
 * checks, assignments and odometer history are keyed on the plate, so they
 * follow the rename rather than being orphaned by it.
 *
 * Timid like every other migration here: a model is set only where the
 * vehicle has none, so a van somebody has pointed at another list by hand
 * keeps that list.
 */
const FLEET_MODELS_KEY = 'seed-2026-09-16-fleet-models';

async function addFleetModels(client) {
  const done = await client.query('SELECT 1 FROM jobs WHERE name = $1', [FLEET_MODELS_KEY]);
  if (done.rowCount) return null;

  /* The vehicles row and its history are renamed independently.
     `vehicles.plate` is unique, so that one row is renamed only when RLX94A
     is not already there — but the history tables are not guarded by that:
     somebody who fixed the plate by hand in /admin renamed the vehicles row
     ALONE, and the checks, assignments and incidents behind it would then
     keep the old plate for good, invisible to every query that looks the van
     up. So each table is asked for itself. */
  let renamed = 0;
  const HISTORY = ['submissions', 'assignments', 'incidents'];
  const taken = await client.query('SELECT 1 FROM vehicles WHERE plate = $1', ['RLX94A']);
  const old = await client.query('SELECT 1 FROM vehicles WHERE plate = $1', ['RLX94L']);
  if (old.rowCount && !taken.rowCount) {
    const r = await client.query(`UPDATE vehicles SET plate = 'RLX94A' WHERE plate = 'RLX94L'`);
    renamed = r.rowCount;
  } else if (old.rowCount && taken.rowCount) {
    // Two rows for one van. Renaming would collide on the unique plate, and
    // guessing which one to keep is not a migration's business.
    console.warn('[db] både RLX94L och RLX94A finns som fordon – ingen omdöpning gjord, ' +
      'ta bort det felaktiga fordonet i Admin → Fordon');
  }
  for (const table of HISTORY) {
    const r = await client.query(
      `UPDATE ${table} SET plate = 'RLX94A' WHERE plate = 'RLX94L'`);
    renamed += r.rowCount;
  }

  let models = 0;
  for (const car of seed.DEFAULT_VEHICLES) {
    if (!car.modelKey) continue;
    const r = await client.query(
      `UPDATE vehicles SET model_key = $2 WHERE plate = $1 AND model_key = ''`,
      [car.plate, car.modelKey]);
    models += r.rowCount;
  }

  await client.query(
    `INSERT INTO jobs (name, last_run, note) VALUES ($1, now(), $2)
     ON CONFLICT (name) DO NOTHING`,
    [FLEET_MODELS_KEY, `${models} fordon fick modell, ${renamed} registreringsnummer rättat`]);

  return { models, renamed };
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
    const lamps = await addLampsAndKilometres(client);
    const lists = await addQuestionLists(client);
    const clean = await addCleanQuestion(client);
    const damage = await addDamageRole(client);
    const routes = await addRouteSource(client);
    const fleet = await addFleetModels(client);
    await client.query('COMMIT');
    if (fleet && (fleet.models || fleet.renamed)) {
      console.log(`[db] modell satt på ${fleet.models} fordon` +
        (fleet.renamed ? ', RLX94L rättat till RLX94A' : ''));
    }
    if (routes && routes.routes) {
      console.log(`[db] ${routes.routes} ruttfrågor hämtar nu listan från tilldelningen`);
    }
    if (damage && damage.marked) {
      console.log(`[db] ${damage.marked} skadefrågor märkta för händelseloggen`);
    }
    if (clean && (clean.rewritten || clean.noticed)) {
      console.log(`[db] städfrågan omskriven i ${clean.rewritten} formulär, ` +
        `${clean.noticed} frågor fick en uppmaning vid larm`);
    }
    if (lists && (lists.lists || lists.lamps || lists.models)) {
      console.log(`[db] välj-listor på ${lists.lists} frågor, ${lists.lamps} fråga kopplad ` +
        `till fordonets varningslampor, modell satt på ${lists.models} fordon`);
    }
    if (lamps && (lamps.km || lamps.lamps)) {
      console.log(`[db] mätarfrågan till kilometer i ${lamps.km} formulär, ` +
        `lampval på ${lamps.lamps} belysningsfrågor`);
    }
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

const VEHICLE_COLS = `id, plate, owner, fleet, note, active, form_id, sort_order, model_key,
                      manual_file, fitted_season, fitted_since`;

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

async function createVehicle({ plate, owner = '', fleet = 'box', note = '', formId = null,
                               modelKey = '', manualFile = '' }) {
  const r = await pool.query(
    `INSERT INTO vehicles (plate, owner, fleet, note, form_id, model_key, manual_file, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,
             COALESCE((SELECT MAX(sort_order) FROM vehicles WHERE fleet = $3), 0) + 10)
     RETURNING ${VEHICLE_COLS}`,
    [normalisePlate(plate), owner, fleet, note, formId, modelKey || '', manualFile || '']);
  return r.rows[0];
}

async function updateVehicle(id, { plate, owner, fleet, note, active, formId, modelKey,
                                   manualFile }) {
  const r = await pool.query(
    `UPDATE vehicles SET plate = $2, owner = $3, fleet = $4, note = $5,
            active = $6, form_id = $7, model_key = $8, manual_file = $9
      WHERE id = $1 RETURNING ${VEHICLE_COLS}`,
    [id, normalisePlate(plate), owner, fleet, note, active, formId, modelKey || '',
     manualFile || '']);
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
 * Settings                                                            *
 * ------------------------------------------------------------------ */

async function getSetting(key) {
  const r = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return r.rows.length ? r.rows[0].value : null;
}

async function setSetting(key, value) {
  if (value === null || value === '') {
    await pool.query('DELETE FROM settings WHERE key = $1', [key]);
    return;
  }
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, String(value)]);
}

/**
 * The statistics reset line.
 *
 * Everything the scoreboard and /admin/stats count starts here. It is a date,
 * not a deletion: the checks, the photos and the odometer history are all
 * still there, so a van's record survives a reset and the line can be moved
 * or removed again. `null` means count from the beginning.
 */
const STATS_EPOCH_KEY = 'stats_epoch';

async function getStatsEpoch() {
  const v = await getSetting(STATS_EPOCH_KEY);
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null;
}

async function setStatsEpoch(date) {
  await setSetting(STATS_EPOCH_KEY, date || '');
}

/**
 * What a reset line at this date would stop counting.
 *
 * Shown on the confirmation page so the admin sees the size of what they are
 * about to hide before they hide it. "Hide", not "delete": these rows are
 * still in the database afterwards, and moving the line back brings them
 * straight back into the figures.
 */
async function countsBefore(date) {
  const [subs, asg] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS n, MIN(submitted_at) AS first
         FROM submissions
        WHERE submitted_at < ($1::date AT TIME ZONE 'Europe/Stockholm')`, [date]),
    pool.query('SELECT COUNT(*)::int AS n FROM assignments WHERE date < $1', [date])
  ]);
  return {
    submissions: subs.rows[0].n,
    firstSubmission: subs.rows[0].first,
    assignments: asg.rows[0].n
  };
}

/* ------------------------------------------------------------------ *
 * Incidents                                                           *
 * ------------------------------------------------------------------ */

const INCIDENT_COLS = `id, plate, occurred_on, description, driver_name,
  category, handled_by, scope, supplier, invoice_no, note, shop_in, shop_out, cost_sek, sm_ok, sm_by, sm_at, submission_id,
  rental_firm, rented_to, for_plate,
  estimate_shop, quoted_sek,
  created_at, updated_at`;

/** Dates come back as Date objects; the page wants 2026-09-14. */
function dayOf(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shapeIncident(row, files = [], events = []) {
  return {
    ...row,
    occurred_on: dayOf(row.occurred_on),
    shop_in: dayOf(row.shop_in),
    shop_out: dayOf(row.shop_out),
    rented_to: dayOf(row.rented_to),
    cost_sek: row.cost_sek === null || row.cost_sek === undefined ? null : Number(row.cost_sek),
    quoted_sek: row.quoted_sek === null || row.quoted_sek === undefined ? null : Number(row.quoted_sek),
    files, events
  };
}

async function listIncidents({ plate = '', from = '', to = '', smOk = null,
                               category = '', handledBy = '', scope = '' } = {}) {
  const where = [];
  const args = [];
  /* A registration matches the line it is on AND the hires taken to cover it:
     asking for RJC29S should show the van's own repairs and the car hired
     while it was in the workshop, because that is one bill in the end. */
  if (plate) { args.push(plate); where.push(`(plate = $${args.length} OR for_plate = $${args.length})`); }
  if (scope) { args.push(scope); where.push(`scope = $${args.length}`); }
  if (category) { args.push(category); where.push(`category = $${args.length}`); }
  if (handledBy) { args.push(handledBy); where.push(`handled_by = $${args.length}`); }
  if (from) { args.push(from); where.push(`occurred_on >= $${args.length}`); }
  if (to) { args.push(to); where.push(`occurred_on <= $${args.length}`); }
  if (smOk !== null) { args.push(smOk); where.push(`sm_ok = $${args.length}`); }
  const rows = (await pool.query(
    `SELECT ${INCIDENT_COLS} FROM incidents
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY occurred_on DESC, id DESC`, args)).rows;
  if (!rows.length) return [];

  // Files and the sign-off history for the whole page in two queries rather
  // than two per row: forty incidents used to be eighty round trips.
  const ids = rows.map(r => Number(r.id));
  const files = (await pool.query(
    `SELECT id, incident_id, kind, filename, mime, byte_size, uploaded_at, taken_at
       FROM incident_files WHERE incident_id = ANY($1::bigint[]) ORDER BY id`, [ids])).rows;
  const events = (await pool.query(
    `SELECT id, incident_id, action, who, cost_sek, quoted_sek, happened_at
       FROM incident_sm_events WHERE incident_id = ANY($1::bigint[]) ORDER BY id`, [ids])).rows;

  const byId = new Map(rows.map(r => [String(r.id), { files: [], events: [] }]));
  for (const f of files) byId.get(String(f.incident_id)).files.push(f);
  for (const e of events) byId.get(String(e.incident_id)).events.push(e);
  return rows.map(r => shapeIncident(r, byId.get(String(r.id)).files, byId.get(String(r.id)).events));
}

async function getIncident(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const r = await pool.query(`SELECT ${INCIDENT_COLS} FROM incidents WHERE id = $1`, [id]);
  if (!r.rows.length) return null;
  const files = (await pool.query(
    `SELECT id, incident_id, kind, filename, mime, byte_size, uploaded_at, taken_at
       FROM incident_files WHERE incident_id = $1 ORDER BY id`, [id])).rows;
  const events = (await pool.query(
    `SELECT id, incident_id, action, who, cost_sek, quoted_sek, happened_at
       FROM incident_sm_events WHERE incident_id = $1 ORDER BY id`, [id])).rows;
  return shapeIncident(r.rows[0], files, events);
}

async function createIncident(data) {
  const r = await pool.query(
    `INSERT INTO incidents
       (plate, occurred_on, description, driver_name, shop_in, shop_out, cost_sek, submission_id,
        category, handled_by, scope, supplier, invoice_no, note,
        rental_firm, rented_to, for_plate, estimate_shop, quoted_sek)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
    [data.plate, data.occurredOn, data.description || '', data.driverName || '',
     data.shopIn || null, data.shopOut || null,
     data.cost === null || data.cost === undefined ? null : data.cost,
     data.submissionId || null,
     data.category ?? 'damage', data.handledBy || '',
     data.scope || 'vehicle', data.supplier || '', data.invoiceNo || '', data.note || '',
     data.rentalFirm || '', data.rentedTo || null, data.forPlate || '',
     data.estimateShop || '',
     data.quoted === null || data.quoted === undefined ? null : data.quoted]);
  return String(r.rows[0].id);
}

/**
 * Edit the case, never the sign-off.
 *
 * `sm_ok`, `sm_by` and `sm_at` are deliberately not writable here: they change
 * only through signOff(), which records why. What this does do is clear the
 * approval when the amount changes -- an OK is an OK of an amount, and a
 * figure edited after the fact would otherwise carry yesterday's signature.
 * On an estimate the amount is the quote and the signature means "accepted",
 * so the same rule applies to it: a quote that changed is a quote nobody has
 * said yes to yet.
 */
async function updateIncident(id, data) {
  const before = await pool.query(
    'SELECT cost_sek, quoted_sek, scope, estimate_shop, sm_ok FROM incidents WHERE id = $1', [id]);
  if (!before.rows.length) return null;
  const num = v => (v === null || v === undefined ? null : Number(v));
  const estimate = before.rows[0].scope === 'estimate';
  const oldCost = num(estimate ? before.rows[0].quoted_sek : before.rows[0].cost_sek);
  const newCost = num(estimate ? data.quoted : data.cost);
  /* What was accepted on an estimate is one workshop's quote, so pointing the
     row at a different workshop invalidates the tick exactly as changing the
     figure does: nobody has said yes to Malte Mansson's price for a line that
     was accepted as STS's. */
  const shopChanged = estimate && (before.rows[0].estimate_shop || '') !== (data.estimateShop || '');
  const reason = oldCost !== newCost ? (estimate ? 'quote' : 'cost') : shopChanged ? 'workshop' : '';
  const costChanged = Boolean(before.rows[0].sm_ok && reason);

  await pool.query(
    `UPDATE incidents SET plate = $2, occurred_on = $3, description = $4, driver_name = $5,
            shop_in = $6, shop_out = $7, cost_sek = $8, category = $9, handled_by = $10,
            scope = $11, supplier = $12, invoice_no = $13, note = $14,
            rental_firm = $15, rented_to = $16, for_plate = $17,
            estimate_shop = $18, quoted_sek = $19, updated_at = now()
      WHERE id = $1`,
    [id, data.plate, data.occurredOn, data.description || '', data.driverName || '',
     data.shopIn || null, data.shopOut || null, num(data.cost),
     data.category ?? 'damage', data.handledBy || '',
     data.scope || 'vehicle', data.supplier || '', data.invoiceNo || '', data.note || '',
     data.rentalFirm || '', data.rentedTo || null, data.forPlate || '',
     data.estimateShop || '', num(data.quoted)]);

  if (costChanged) {
    await pool.query(
      `UPDATE incidents SET sm_ok = false, sm_by = '', sm_at = NULL WHERE id = $1`, [id]);
    await pool.query(
      `INSERT INTO incident_sm_events (incident_id, action, who, cost_sek, quoted_sek)
       VALUES ($1, $2, '', $3, $4)`,
      [id, !estimate ? 'cleared-by-cost-change'
        : reason === 'workshop' ? 'cleared-by-workshop-change' : 'cleared-by-quote-change',
       estimate ? null : newCost, estimate ? newCost : null]);
  }
  return { costChanged, reason };
}

/** Count and total per section, for the sub-tab labels on Expenses. */
async function expenseSections() {
  const r = await pool.query(
    `SELECT scope, count(*)::int AS n, coalesce(sum(cost_sek), 0)::float AS cost,
            coalesce(sum(quoted_sek), 0)::float AS quoted,
            count(*) FILTER (WHERE NOT sm_ok)::int AS waiting
       FROM incidents GROUP BY scope`);
  const out = {};
  for (const row of r.rows) out[row.scope] = row;
  return out;
}

/** The three figures the Incidents tab shows (vehicles only), without loading every row. */
async function incidentCounts() {
  const r = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE NOT sm_ok)::int AS waiting,
            count(*) FILTER (WHERE scope = 'vehicle' AND category <> 'parts' AND shop_in IS NOT NULL
                               AND shop_out IS NULL)::int AS "atShop"
       FROM incidents WHERE scope = 'vehicle'`);
  return r.rows[0];
}

async function deleteIncident(id) {
  const r = await pool.query(
    'DELETE FROM incidents WHERE id = $1 RETURNING id, plate, occurred_on', [id]);
  return r.rows[0] || null;
}

/**
 * The Site Manager's signature, or its withdrawal.
 *
 * The cost as it stood is copied onto the event: the row can be edited later,
 * and "approved 12 400 kr on the 14th" must stay true whatever the figure
 * becomes afterwards.
 */
async function signOffIncident(id, { ok, who }) {
  /* The history keeps the figure the signature was given against -- "approved
     WHAT" is the question it exists to answer. On an estimate that figure is
     a quote and the signature means "accepted", so it is written to its own
     column: cost_sek in this table has to stay summable as money somebody
     approved spending, and an accepted quote is not that. */
  const cur = await pool.query(
    'SELECT scope, cost_sek, quoted_sek FROM incidents WHERE id = $1', [id]);
  if (!cur.rows.length) return null;
  const estimate = cur.rows[0].scope === 'estimate';
  await pool.query(
    `UPDATE incidents SET sm_ok = $2, sm_by = $3, sm_at = $4, updated_at = now() WHERE id = $1`,
    [id, !!ok, ok ? who : '', ok ? new Date() : null]);
  await pool.query(
    `INSERT INTO incident_sm_events (incident_id, action, who, cost_sek, quoted_sek)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, ok ? 'ok' : 'withdrawn', who || '',
     estimate ? null : cur.rows[0].cost_sek, estimate ? cur.rows[0].quoted_sek : null]);
  return getIncident(id);
}

async function addIncidentFile(incidentId, { kind, filename, mime, buffer, takenAt = null }) {
  const r = await pool.query(
    `INSERT INTO incident_files (incident_id, kind, filename, mime, bytes, byte_size, taken_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [incidentId, kind, filename || null, mime, buffer, buffer.length, takenAt]);
  await pool.query('UPDATE incidents SET updated_at = now() WHERE id = $1', [incidentId]);
  return String(r.rows[0].id);
}

async function getIncidentFile(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const r = await pool.query(
    'SELECT id, incident_id, kind, filename, mime, bytes FROM incident_files WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function deleteIncidentFile(id) {
  const r = await pool.query(
    'DELETE FROM incident_files WHERE id = $1 RETURNING incident_id, filename', [id]);
  return r.rows[0] || null;
}

/**
 * The routes the assigner has actually handed out, for the route dropdown.
 *
 * The form used to offer a fixed list typed into the seed, which was wrong in
 * both fleets at once: the box routes are JKP-EM-n(-RR) and the list said
 * JK-EM-n, and the home routes are Budbee's numeric ids, which change every
 * day and can never be a fixed list at all. So the list is read from the
 * assignments instead.
 *
 * `mine` marks the rows for this vehicle, and the date comes back as text so
 * the caller can rank "this van today" above "anything today" without a
 * timezone getting involved.
 */
async function routeChoices(plate, fromDate, toDate) {
  const r = await pool.query(
    `SELECT DISTINCT route,
            to_char(date, 'YYYY-MM-DD') AS date,
            (plate = $1) AS mine
       FROM assignments
      WHERE date BETWEEN $2::date AND $3::date
        AND route <> ''`,
    [plate || '', fromDate, toDate]);
  return r.rows;
}

/** Which submissions already have an incident, so the list above the table
 *  can leave them out. */
async function submissionsWithIncident(ids) {
  if (!ids.length) return new Set();
  const r = await pool.query(
    'SELECT submission_id FROM incidents WHERE submission_id = ANY($1::bigint[])', [ids]);
  return new Set(r.rows.map(x => String(x.submission_id)));
}

/**
 * Which case each of these checks was turned into, as submission id -> case
 * id. The attention report uses it to say where a reported dent is already
 * being handled; submissionsWithIncident above only answers whether, which
 * is all the pending list needs.
 */
async function incidentBySubmission(ids) {
  if (!ids.length) return new Map();
  const r = await pool.query(
    'SELECT id, submission_id FROM incidents WHERE submission_id = ANY($1::bigint[])', [ids]);
  return new Map(r.rows.map(x => [String(x.submission_id), String(x.id)]));
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
        /* Every column a question carries, not just the ones it had when this
           was written: a copy that quietly loses its follow-up lists or its
           clean-up notice is a copy the admin has to notice is wrong. */
        `INSERT INTO form_fields
           (form_id, position, name, kind, label, section, required, role,
            options, source, alert_on, i18n, comment_options, comment_source,
            alert_notice)
         SELECT $1, position, name, kind, label, section, required, role,
                options, source, alert_on, i18n, comment_options, comment_source,
                alert_notice
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
  options = [], source = '', alertOn = [], i18n = {}, commentOptions = [],
  commentSource = '', alertNotice = ''
}) {
  const name = await nextFieldName(formId);
  const r = await pool.query(
    `INSERT INTO form_fields
       (form_id, position, name, kind, label, section, required, role,
        options, source, alert_on, i18n, comment_options, comment_source,
        alert_notice)
     VALUES ($1, COALESCE((SELECT MAX(position) FROM form_fields WHERE form_id = $1), 0) + 10,
             $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [formId, name, kind, label, section, required, role,
     JSON.stringify(options), source, JSON.stringify(alertOn), JSON.stringify(i18n),
     JSON.stringify(commentOptions || []), commentSource || '', alertNotice || '']);
  await touchForm(formId);
  return r.rows[0];
}

async function getField(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const r = await pool.query('SELECT * FROM form_fields WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function updateField(id, {
  kind, label, section, required, role, options, source, alertOn, i18n,
  commentOptions, commentSource, alertNotice
}) {
  const r = await pool.query(
    `UPDATE form_fields SET kind = $2, label = $3, section = $4, required = $5,
            role = $6, options = $7, source = $8, alert_on = $9, i18n = $10,
            comment_options = $11, comment_source = $12, alert_notice = $13
      WHERE id = $1 RETURNING form_id`,
    [id, kind, label, section, required, role,
     JSON.stringify(options || []), source || '',
     JSON.stringify(alertOn || []), JSON.stringify(i18n || {}),
     JSON.stringify(commentOptions || []), commentSource || '', alertNotice || '']);
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
  plate, owner, form, answers, roles, photos, userAgent, clientIp, lang,
  assignedDriver = null, assignedRoute = null, driverChanged = false, changeApprover = null,
  openedAt = null, fillSeconds = null
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
      // The follow-up list as it stood: a lamp removed from the list next
      // month must still read back on last month's check. For a list that came
      // from the vehicle's model these are codes, and the names for every
      // language ride in `i18n` beside them.
      comment_options: Array.isArray(f.comment_options) ? f.comment_options : [],
      comment_source: f.comment_source || '',
      // The instruction the driver was given at the time. A notice reworded
      // next month must not rewrite what last month's check said.
      alert_notice: f.alert_notice || '',
      source: f.source || '',
      i18n: f.i18n || {}
    }));
    const res = await client.query(
      `INSERT INTO submissions
         (plate, owner, form_key, form_id, form_title, driver_name, route, odometer,
          answers, questions, photo_count, user_agent, client_ip, lang, public_key,
          assigned_driver, assigned_route, driver_changed, change_approver,
          opened_at, fill_seconds, questions_hash)
       -- The fingerprint is taken from the same parameter the snapshot is
       -- stored from, by the database, in the same statement: computing it
       -- here in JavaScript would mean two renderings of the same JSON that
       -- could disagree about key order and quietly stop matching.
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
               md5($10::jsonb::text))
       RETURNING id, submitted_at, public_key`,
      [
        plate, owner || '', form.key, form.id, form.title,
        roles.driver || null, roles.route || null, roles.odometer || null,
        JSON.stringify(answers), JSON.stringify(questions),
        photos.length, userAgent || null, clientIp || null, lang || 'sv',
        crypto.randomBytes(9).toString('base64url'),
        assignedDriver || null, assignedRoute || null, !!driverChanged, changeApprover || null,
        openedAt || null, Number.isFinite(fillSeconds) ? Math.round(fillSeconds) : null
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
            driver_name, route, odometer, answers, questions, photo_count,
            assigned_driver, driver_changed, change_approver, fill_seconds
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
  // Scoped by day AND fleet. The nightly script pushes both fleets together,
  // but the assigner's two tabs push one fleet each as they are edited, and a
  // whole-day delete would then let the box tab wipe the home fleet's rows for
  // that day -- the day's home drivers would silently lose their assignment,
  // which is exactly the record this table exists to keep.
  const scopes = [...new Set(rows.map(r => `${r.date}\u0000${r.fleet || 'box'}`))]
    .map(s => s.split('\u0000'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let removed = 0;
    for (const [date, fleet] of scopes) {
      const gone = await client.query(
        'DELETE FROM assignments WHERE date = $1::date AND fleet = $2', [date, fleet]);
      removed += gone.rowCount;
    }
    let n = 0;
    for (const r of rows) {
      const res = await client.query(
        `INSERT INTO assignments (date, plate, driver, route, type, fleet, source_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (date, plate, driver, fleet) DO NOTHING`,
        [r.date, r.plate, r.driver, r.route || '', r.type || '', r.fleet || 'box',
         r.sourceAt || null]);
      n += res.rowCount;
    }
    await client.query('COMMIT');
    // `removed` is reported back so a push that quietly shrinks a day -- a
    // filtered CSV re-run over a full one -- shows up where somebody sees it.
    return { days: dates.length, rows: n, removed, dates: dates.sort(),
             fleets: [...new Set(scopes.map(s => s[1]))] };
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

/**
 * The last odometer reading filed for one vehicle.
 *
 * Only rows that actually carry a number: a check where the field was left
 * empty (it has not always been required) must not hide the reading from the
 * day before. The value is returned exactly as it was typed -- what it means
 * is decided by whoever reads it, and old rows were entered in Swedish mil.
 */
async function lastOdometer(plate) {
  const r = await pool.query(
    `SELECT odometer, submitted_at, driver_name
       FROM submissions
      WHERE plate = $1 AND odometer IS NOT NULL AND odometer <> ''
      ORDER BY submitted_at DESC LIMIT 1`, [plate]);
  return r.rows[0] || null;
}

/** Today's assignment(s) for one vehicle -- what the scanned form pre-fills. */
async function assignmentsForPlate(plate, date) {
  const r = await pool.query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, plate, driver, route, type, fleet
       FROM assignments WHERE plate = $1 AND date = $2::date
      ORDER BY route, driver`, [plate, date]);
  return r.rows;
}

/**
 * One vehicle's last days: who was given it, and who signed for it.
 *
 * The checks are fetched a day wide on each side and bucketed by Swedish
 * calendar day by the caller -- `submitted_at` is a timestamptz and the
 * database's own timezone is not the one the crew works in.
 */
async function plateHistory(plate, from, to) {
  const [asg, subs] = await Promise.all([
    pool.query(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date, driver, route, type, fleet
         FROM assignments WHERE plate = $1 AND date >= $2::date AND date <= $3::date
        ORDER BY date DESC, route`, [plate, from, to]),
    pool.query(
      `SELECT id, submitted_at, driver_name, route, driver_changed, change_approver, assigned_driver
         FROM submissions
        WHERE plate = $1
          AND submitted_at >= (($2::date - 1) AT TIME ZONE 'Europe/Stockholm')
          AND submitted_at <  (($3::date + 2) AT TIME ZONE 'Europe/Stockholm')
        ORDER BY submitted_at DESC`, [plate, from, to])
  ]);
  return { assignments: asg.rows, checks: subs.rows };
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

/* ------------------------------------------------------------------ *
 * Wheels                                                              *
 * ------------------------------------------------------------------ */

const SEASONS = new Set(['summer', 'winter']);
const POSITIONS = new Set(['front', 'back']);

/**
 * Every set, with its readings and its files, in three queries.
 *
 * The page draws every van and both seasons whether or not anything has been
 * recorded, so this returns what EXISTS and the page fills the gaps -- a set
 * row is created the first time somebody writes something into it, and an
 * empty tile is the honest picture of a tyre nobody has measured.
 */
async function listWheelSets() {
  const sets = (await pool.query(
    `SELECT id, plate, season, make, model, size, tyre_type, dot, note,
            retired_on, created_at, updated_at
       FROM wheel_sets ORDER BY plate, season, (retired_on IS NULL) DESC, retired_on DESC`)).rows;
  if (!sets.length) return [];
  const ids = sets.map(r => Number(r.id));
  const readings = (await pool.query(
    `SELECT id, set_id, position, depth_mm, measured_on, measured_by, note, created_at
       FROM wheel_readings WHERE set_id = ANY($1::bigint[])
      ORDER BY measured_on, id`, [ids])).rows;
  const files = (await pool.query(
    `SELECT id, set_id, position, filename, mime, byte_size, uploaded_at, taken_at
       FROM wheel_files WHERE set_id = ANY($1::bigint[]) ORDER BY id`, [ids])).rows;

  const by = new Map(sets.map(r => [String(r.id), { readings: [], files: [] }]));
  for (const r of readings) {
    by.get(String(r.set_id)).readings.push({ ...r, depth_mm: Number(r.depth_mm),
      measured_on: dayOf(r.measured_on) });
  }
  for (const f of files) by.get(String(f.set_id)).files.push(f);
  return sets.map(r => ({ ...r, retired_on: dayOf(r.retired_on), ...by.get(String(r.id)) }));
}

/** The set for this van and season, made the first time it is written to. */
/* Both of these target the LIVE set. The unique index is partial --
   (plate, season) WHERE retired_on IS NULL -- so that is what ON CONFLICT
   resolves against, and a retired set is never written to again. */
async function upsertWheelSet(plate, season, data) {
  if (!SEASONS.has(season)) return null;
  const r = await pool.query(
    `INSERT INTO wheel_sets (plate, season, make, model, size, tyre_type, dot, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (plate, season) WHERE retired_on IS NULL DO UPDATE SET
       make = EXCLUDED.make, model = EXCLUDED.model, size = EXCLUDED.size,
       tyre_type = EXCLUDED.tyre_type, dot = EXCLUDED.dot, note = EXCLUDED.note,
       updated_at = now()
     RETURNING id`,
    [plate, season, data.make || '', data.model || '', data.size || '',
     data.tyreType || '', data.dot || '', data.note || '']);
  return String(r.rows[0].id);
}

/**
 * The live set's id, making an empty one if this van has never had this
 * season. DO UPDATE SET plate = EXCLUDED.plate rather than DO NOTHING: the
 * latter returns no row at all on a conflict, and the caller needs the id.
 */
async function wheelSetId(plate, season) {
  if (!SEASONS.has(season)) return null;
  const r = await pool.query(
    `INSERT INTO wheel_sets (plate, season) VALUES ($1, $2)
     ON CONFLICT (plate, season) WHERE retired_on IS NULL
       DO UPDATE SET plate = EXCLUDED.plate
     RETURNING id`, [plate, season]);
  return String(r.rows[0].id);
}

/**
 * New tyres on that end of the van.
 *
 * The old set is stamped with the day it came off and keeps everything it had
 * -- its readings, its make, its DOT code -- and a fresh, empty set takes its
 * place. This is the only way a reading history stays honest across a change
 * of rubber, and it is why nothing on this page ever offers to "reset" a set.
 */
async function replaceWheelSet(plate, season, on) {
  if (!SEASONS.has(season)) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const old = await client.query(
      `UPDATE wheel_sets SET retired_on = $3, updated_at = now()
        WHERE plate = $1 AND season = $2 AND retired_on IS NULL
        RETURNING id, make, model`, [plate, season, on]);
    const fresh = await client.query(
      `INSERT INTO wheel_sets (plate, season) VALUES ($1, $2) RETURNING id`, [plate, season]);
    await client.query('COMMIT');
    return { retired: old.rows[0] || null, id: String(fresh.rows[0].id) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function addWheelReading(setId, { position, depthMm, measuredOn, measuredBy, note }) {
  if (!POSITIONS.has(position)) return null;
  const r = await pool.query(
    `INSERT INTO wheel_readings (set_id, position, depth_mm, measured_on, measured_by, note)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [setId, position, depthMm, measuredOn, measuredBy || '', note || '']);
  return String(r.rows[0].id);
}

/** A mistyped reading is deleted, not corrected: the history is a history. */
async function deleteWheelReading(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const r = await pool.query(
    `DELETE FROM wheel_readings WHERE id = $1
     RETURNING id, set_id, position, depth_mm, measured_on`, [id]);
  return r.rows[0] || null;
}

async function setFitted(plate, season, since) {
  const r = await pool.query(
    `UPDATE vehicles SET fitted_season = $2, fitted_since = $3 WHERE plate = $1 RETURNING id`,
    [plate, SEASONS.has(season) ? season : '', since || null]);
  return r.rows.length > 0;
}

async function addWheelFile(setId, { position, filename, mime, buffer, takenAt }) {
  const r = await pool.query(
    `INSERT INTO wheel_files (set_id, position, filename, mime, bytes, byte_size, taken_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [setId, POSITIONS.has(position) ? position : '', filename || null, mime,
     buffer, buffer.length, takenAt || null]);
  return String(r.rows[0].id);
}

async function getWheelFile(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const r = await pool.query(
    'SELECT id, set_id, filename, mime, bytes FROM wheel_files WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function deleteWheelFile(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const r = await pool.query('DELETE FROM wheel_files WHERE id = $1 RETURNING id', [id]);
  return r.rows[0] || null;
}


/* ------------------------------------------------------------------ *
 * The attention report                                                *
 *                                                                     *
 * Only the sign-offs are stored; see the table's own comment in        *
 * SCHEMA and the header of src/attention.js for why.                   *
 * ------------------------------------------------------------------ */

/**
 * The checks the attention report reads, for a window measured in months
 * rather than in days.
 *
 * submissionsBetween() would do, and did, but it carries every check's whole
 * form SNAPSHOT: 21 questions with their follow-up lists and four languages
 * apiece, about 30 kB of JSON per check. Ninety days of a 22-van fleet is
 * some 1400 checks, so the page was fetching and parsing the better part of
 * 40 MB to find a handful of flagged answers -- on every refresh, on a small
 * Railway instance.
 *
 * Nearly all of those snapshots are byte-for-byte the same: a snapshot is a
 * copy of the form as it stood, and the form changes a few times a year. So
 * the checks come back WITHOUT their snapshot and with a hash of it, the
 * distinct snapshots come back once each in a second query, and they are put
 * back together here. Same rows, same answers, a few hundred kB.
 *
 * jsonb renders canonically (keys sorted, whitespace fixed), so two checks
 * filed against the same form always hash alike -- which is what makes this
 * a deduplication rather than a guess. The hash is a stored column
 * (questions_hash, written at insert and backfilled in SCHEMA) rather than
 * something computed here: md5 over the text of every snapshot in the window
 * costs half a second by itself, which is the cost this was meant to avoid.
 */
async function checksForAttention(fromDate, toDate) {
  const window = `submitted_at >= ($1::date AT TIME ZONE 'Europe/Stockholm')
                  AND submitted_at <  (($2::date + 1) AT TIME ZONE 'Europe/Stockholm')`;
  const rows = (await pool.query(
    `SELECT id, plate, submitted_at, driver_name, route, odometer, answers, photo_count,
            lang, assigned_driver, driver_changed, change_approver, questions_hash
       FROM submissions WHERE ${window}
      ORDER BY submitted_at`, [fromDate, toDate])).rows;
  if (!rows.length) return [];

  /* One snapshot per distinct form, fetched by hash rather than by scanning
     the window again: the list above is already everything in it. */
  const hashes = [...new Set(rows.map(r => r.questions_hash).filter(Boolean))];
  const byHash = new Map();
  if (hashes.length) {
    const shapes = (await pool.query(
      `SELECT DISTINCT ON (questions_hash) questions_hash, questions
         FROM submissions WHERE questions_hash = ANY($1::text[])`, [hashes])).rows;
    for (const s of shapes) byHash.set(s.questions_hash, s.questions);
  }
  /* A row whose hash is missing gets its own snapshot fetched by id. That
     should never happen -- the column is written at insert and backfilled at
     boot -- but "never happens" is how a check quietly loses the polarity it
     was filed with, and the answer here is one extra query for the rows it
     applies to rather than a silent fallback to today's form. */
  const unhashed = rows.filter(r => !r.questions_hash).map(r => Number(r.id));
  const byId = new Map();
  if (unhashed.length) {
    const own = (await pool.query(
      'SELECT id, questions FROM submissions WHERE id = ANY($1::bigint[])', [unhashed])).rows;
    for (const o of own) byId.set(String(o.id), o.questions);
  }

  // A check with no snapshot at all keeps the empty array it has always had,
  // and attention.js falls back to the form as it stands today.
  return rows.map(r => ({
    ...r,
    questions: byHash.get(r.questions_hash) || byId.get(String(r.id)) || []
  }));
}

/**
 * Every clear ever recorded, oldest first.
 *
 * The whole table rather than a filtered slice: it grows by one row per
 * fault dealt with -- a few hundred a year -- and the report needs both the
 * clear in force for each item and the history behind it, which a WHERE on
 * "still current" could not give it. Ordered by id so the reader can take
 * the last row per key and be right.
 */
async function listAttentionClears() {
  const r = await pool.query(
    `SELECT id, item_key, plate, kind, title, covers_to, cleared_by, cleared_at,
            note, withdrawn_at, withdrawn_by
       FROM attention_clears ORDER BY id`);
  return r.rows;
}

/**
 * Somebody says an item is dealt with.
 *
 * `coversTo` comes off the page (the last sighting it was showing), never
 * from now(), and is clamped to now so a doctored form cannot sign off
 * reports that have not happened yet.
 */
async function clearAttentionItem({ itemKey, plate = '', kind = '', title = '',
                                    coversTo, by, note = '' }) {
  const who = String(by || '').trim();
  if (!itemKey || who.length < 2) return null;
  const r = await pool.query(
    `INSERT INTO attention_clears (item_key, plate, kind, title, covers_to, cleared_by, note)
     VALUES ($1,$2,$3,$4, LEAST($5::timestamptz, now()), $6, $7)
     RETURNING id, item_key, covers_to, cleared_by, cleared_at`,
    [String(itemKey).slice(0, 400), plate, kind, String(title).slice(0, 400),
     coversTo, who.slice(0, 120), String(note || '').slice(0, 500)]);
  return r.rows[0] || null;
}

/**
 * Taking a sign-off back.
 *
 * An UPDATE of the row rather than a new one: what is being undone is this
 * particular clear, and an already-withdrawn row is left alone so two people
 * pressing Reopen do not rewrite who did it first.
 */
async function withdrawAttentionClear(id, by) {
  if (!/^\d+$/.test(String(id))) return null;
  const who = String(by || '').trim();
  if (who.length < 2) return null;
  const r = await pool.query(
    `UPDATE attention_clears
        SET withdrawn_at = now(), withdrawn_by = $2
      WHERE id = $1 AND withdrawn_at IS NULL
      RETURNING id, item_key, plate, title`, [id, who.slice(0, 120)]);
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
  replaceAssignments, assignmentsBetween, assignmentRange,
  assignmentsForPlate, plateHistory, lastOdometer, deleteSubmission, routeChoices,
  getSetting, setSetting, getStatsEpoch, setStatsEpoch, countsBefore,
  listIncidents, getIncident, createIncident, updateIncident, deleteIncident, incidentCounts, expenseSections,
  signOffIncident, addIncidentFile, getIncidentFile, deleteIncidentFile,
  submissionsWithIncident, incidentBySubmission,
  listWheelSets, upsertWheelSet, wheelSetId, replaceWheelSet, addWheelReading, deleteWheelReading,
  setFitted, addWheelFile, getWheelFile, deleteWheelFile,
  checksForAttention, listAttentionClears, clearAttentionItem, withdrawAttentionClear,
  get pool() { return pool; }
};
