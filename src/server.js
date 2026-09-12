'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');

const db = require('./db');
const { normalisePlate } = require('./plate');
const fieldsLib = require('./fields');
const {
  KIND_VALUES, ROLES, CHOICES, readAnswer, answerProblem, formatAnswer,
  isAnswerable, isAlerting, optionsFor
} = fieldsLib;
const i18n = require('./i18n');
const { indexPage } = require('./views/index');
const { formPage } = require('./views/form');
const { receiptPage } = require('./views/receipt');
const {
  adminListPage, adminDetailPage, adminVehiclesPage,
  adminFormsPage, adminFormEditorPage, adminDriversPage, adminDeletePage,
  nav: adminNav
} = require('./views/admin');
const { qrPage } = require('./views/qr');
const { statsPage } = require('./views/stats');
const { buildDriverStats } = require('./stats');
const summaryLib = require('./summary');
const assignmentLib = require('./assignment');
const odo = require('./odometer');
const telltales = require('./telltales');
const mail = require('./mail');
const { page, esc, fmtDateTime } = require('./views/layout');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway terminates TLS in front of the app.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Photos are held in memory only long enough to write them to Postgres.
// Field names come from the database now, so accept any and match them
// against the form afterwards.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 24, fields: 200 }
}).any();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function requestOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function configuredBase() {
  const raw = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!raw || raw.includes('${')) return null;
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.origin;
  } catch { return null; }
}

function defaultBase(req) {
  return configuredBase() ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : requestOrigin(req));
}

function baseUrl(req) {
  return req.query.base === 'here' ? requestOrigin(req) : defaultBase(req);
}

function wantsJson(req) {
  return (req.get('accept') || '').includes('application/json');
}

/**
 * `back` is the only way out of an error page, and it is deliberately
 * absent for a driver: an error must not become a door to the fleet list.
 */
function errorPage(res, status, heading, text, back = null) {
  res.status(status).send(page({
    title: heading,
    links: back ? [{ href: back.href, text: back.text }] : [],
    body: `<div class="page-head"><h1>${esc(heading)}</h1></div>
           <p class="lede">${esc(text)}</p>` +
      (back ? `<div class="actions" style="justify-content:flex-start">
             <a class="btn btn-primary" href="${esc(back.href)}">${esc(back.text)}</a></div>` : '')
  }));
}

const TO_ADMIN = { href: '/admin', text: 'Till administrationen' };

/**
 * Live lists a dropdown can be built from. Only fetched when a question
 * actually asks for one, so a form without a driver dropdown never queries
 * the roster.
 */
async function formSources(form) {
  const needsDrivers = form.fields.some(f => f.kind === 'select' && f.source === 'drivers');
  if (!needsDrivers) return {};
  const drivers = await db.listDrivers();
  return { drivers: drivers.map(d => d.name) };
}

/** Questions to fall back on when a submission predates the form editor. */
async function fallbackFields() {
  const form = await db.getDefaultForm();
  return form ? form.fields : [];
}

/* ------------------------------------------------------------------ */
/* Public routes                                                       */
/* ------------------------------------------------------------------ */

app.get('/health', (req, res) => res.type('text/plain').send('ok'));

// Browsers ask for this whatever the page says, and a 404 in the console on
// every admin page is noise that hides real errors.
const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<circle cx="16" cy="16" r="15" fill="#1b6ec2"/><circle cx="16" cy="16" r="6" fill="#fff"/></svg>';
app.get('/favicon.ico', (req, res) =>
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(FAVICON));

/**
 * A driver scanning a QR code must land on that vehicle's form and reach
 * nothing else: not the fleet list, not the other vehicles' QR codes, not
 * anyone else's check. So everything except `/v/<PLATE>`, its POST and the
 * driver's own receipt sits behind the admin login. The vehicle list moved
 * with it -- it is a management view, not a driver's landing page.
 */
app.get('/', adminAuth, async (req, res, next) => {
  try {
    const [vehicles, latest] = await Promise.all([db.listVehicles(), db.latestPerVehicle()]);
    res.send(indexPage({ vehicles, latest }));
  } catch (err) { next(err); }
});

/**
 * Fill in the lists that depend on WHICH VAN this is.
 *
 * A question may say its follow-up list comes from the vehicle
 * (`comment_source = 'lights'`). The dashboard telltales of an IVECO Daily are
 * not those of a Sprinter, so the list cannot live on the shared form: it is
 * resolved here, once, for both the page and the submit handler — they must
 * agree about what is offerable or a driver would be refused an answer the
 * page just gave them.
 *
 * What is stored is the lamp's CODE. The names for all four languages are
 * written into the field's i18n blob (including Swedish, which normally has
 * none) so everything downstream — the picker, the receipt, the admin view,
 * the daily mail — reads them the same way as any other list.
 */
function expandForm(form, vehicle) {
  const lights = telltales.lightsFor(vehicle && vehicle.model_key);
  for (const f of form.fields) {
    if (f.comment_source !== 'lights') continue;
    f.comment_options = lights.map(l => l.code);
    f.lights = lights;                       // the page draws the symbols
    const blob = { ...(f.i18n || {}) };
    for (const code of i18n.CODES) {
      blob[code] = { ...(blob[code] || {}),
        commentOptions: lights.map(l => l[code] || l.sv),
        pickLabel: telltales.PICK_LABEL[code] || telltales.PICK_LABEL.sv };
    }
    f.i18n = blob;
  }
  return form;
}

app.get('/v/:plate', async (req, res, next) => {
  try {
    const vehicle = await db.getVehicle(req.params.plate);
    if (!vehicle) {
      return errorPage(res, 404, 'Okänt fordon',
        `Reg.nr "${normalisePlate(req.params.plate)}" finns inte i appen.`);
    }
    if (!vehicle.active) {
      return errorPage(res, 404, 'Fordonet används inte längre',
        `${vehicle.plate} är avställt i appen och tar inte emot nya kontroller.`);
    }
    const form = await db.getFormForVehicle(vehicle);
    if (!form) {
      return errorPage(res, 500, 'Inget formulär',
        'Det finns inget formulär att fylla i. Skapa ett under Admin → Formulär.');
    }
    expandForm(form, vehicle);
    const today = summaryLib.dayKey();
    const weekFrom = assignmentLib.shiftDay(today, -6);
    const [latest, sources, todayRows, history, meter] = await Promise.all([
      db.latestPerVehicle(), formSources(form),
      db.assignmentsForPlate(vehicle.plate, today),
      db.plateHistory(vehicle.plate, weekFrom, today),
      db.lastOdometer(vehicle.plate)
    ]);
    const l = latest.get(vehicle.plate);
    res.send(formPage({
      vehicle, form, sources,
      lang: i18n.langOf(req.query.lang),
      lastCheck: l ? `${fmtDateTime(l.submitted_at)}${l.driver_name ? ' – ' + l.driver_name : ''}` : null,
      // Who has this van today (pre-filled), and who has had it this week.
      assignment: assignmentLib.todaysAssignment(todayRows),
      week: assignmentLib.buildWeek({
        assignments: history.assignments, checks: history.checks, today
      }),
      // The previous reading, so the field can open with all but its last
      // few digits already in place. The date is turned into a Swedish
      // calendar day here: `submitted_at` is a timestamptz, and a driver
      // reading "Sat Sep 12" where every other date on the page is
      // 2026-09-12 has to stop and work out whether it is the same day.
      odometer: meter ? { odometer: meter.odometer, date: summaryLib.dayKey(meter.submitted_at) } : null
    }));
  } catch (err) { next(err); }
});

app.post('/v/:plate', upload, async (req, res, next) => {
  try {
    const vehicle = await db.getVehicle(req.params.plate);
    if (!vehicle || !vehicle.active) {
      if (wantsJson(req)) return res.status(404).json({ ok: false, error: 'Okänt fordon' });
      return errorPage(res, 404, 'Okänt fordon', 'Reg.nr finns inte i appen.');
    }
    const form = await db.getFormForVehicle(vehicle);
    if (!form) {
      const msg = 'Inget formulär är kopplat till fordonet.';
      if (wantsJson(req)) return res.status(500).json({ ok: false, error: msg });
      return errorPage(res, 500, 'Inget formulär', msg);
    }

    const lang = i18n.langOf(req.body.__lang);
    expandForm(form, vehicle);
    const sources = await formSources(form);

    // Only questions this form defines are read; anything else is dropped.
    const answers = {};
    const roles = {};
    const problems = [];
    for (const f of form.fields) {
      if (!isAnswerable(f)) continue;
      const value = readAnswer(f, req.body);
      const allowed = f.kind === 'select' ? optionsFor(f, sources) : null;
      const problem = answerProblem(f, value, allowed);
      if (problem) problems.push(`${i18n.fieldText(f, lang)} – ${i18n.t(lang, problem)}`);
      answers[f.name] = value;
      // First field with a role wins, so the page and the server agree about
      // which answer is "the driver" when a form has two of them by mistake.
      if (f.role && roles[f.role] === undefined) {
        roles[f.role] = f.kind === 'yesno' ? formatAnswer(f, value) : value;
      }
    }
    if (problems.length) {
      const msg = problems.length === 1 ? problems[0]
        : `${problems.length} ${i18n.t(lang, 'incomplete')}`;
      if (wantsJson(req)) return res.status(400).json({ ok: false, error: msg });
      return errorPage(res, 400, 'Ofullständig kontroll', msg);
    }

    /* Somebody other than the assigned driver may file the check -- vans are
       swapped in the yard every week -- but not silently. The same rule the
       page applies is applied again here, because the page is the driver's
       own phone: a stale tab opened before today's assignment arrived, or a
       posted request, must not be able to slip past it. */
    const today = summaryLib.dayKey();
    const assignment = assignmentLib.todaysAssignment(
      await db.assignmentsForPlate(vehicle.plate, today));
    const chosenDriver = String(roles.driver || '').trim();
    const changed = assignmentLib.isDriverChange(assignment, chosenDriver);
    const confirmed = String(req.body.__driver_change || '').trim().toLowerCase();
    const approver = String(req.body.__change_approver || '').trim().slice(0, 200);
    if (changed) {
      let why = '';
      if (confirmed !== 'ja' && confirmed !== 'nej') why = 'changeNeedAnswer';
      else if (confirmed === 'nej') why = 'changeBlocked';
      else if (approver.length < 2) why = 'changeNeedApprover';
      if (why) {
        const msg = i18n.t(lang, why);
        if (wantsJson(req)) {
          return res.status(400).json({
            ok: false, error: msg, needsChangeConfirm: true, blocked: why === 'changeBlocked',
            // The page may have been opened before this assignment existed, or
            // against an earlier one. Send what it should be asking about so it
            // can put the question on screen instead of repeating an error the
            // driver has no way to answer.
            assigned: {
              driver: assignment.list.map(a => a.driver).join(', '),
              drivers: assignment.list.map(a => a.driver),
              route: assignment.one ? (assignment.one.route || '') : '',
              plate: vehicle.plate
            }
          });
        }
        return errorPage(res, 400, 'Bytet är inte godkänt', msg);
      }
    }
    const expected = assignment.one ? assignment.one
      : (assignment.list.find(a => assignmentLib.sameName(a.driver, chosenDriver)) || assignment.list[0] || null);

    /* The odometer is checked here only against being obviously unfilled:
       digits, and not merely the prefix the form put there. It is deliberately
       NOT checked against the previous reading — a meter that was read wrong
       last week, or replaced, must never be the reason a safety check cannot
       be filed. The page says so before it comes to this, where the driver can
       still see what they typed. */
    const meterField = form.fields.find(f => f.role === 'odometer' && isAnswerable(f));
    if (meterField) {
      const typed = odo.digitsOf(answers[meterField.name]);
      const prev = await db.lastOdometer(vehicle.plate);
      const pre = prev ? odo.prefill(prev.odometer) : { prefix: '' };
      const raw = String(answers[meterField.name] || '').trim();
      let why = '';
      if (raw && !/^[\d\s.,]+$/.test(raw)) why = 'odometerDigits';
      else if (pre.prefix && typed === pre.prefix) why = 'odometerUnchanged';
      if (why) {
        const msg = `${i18n.fieldText(meterField, lang)} – ${i18n.t(lang, why)}`;
        if (wantsJson(req)) return res.status(400).json({ ok: false, error: msg });
        return errorPage(res, 400, 'Ofullständig kontroll', msg);
      }
      // Stored as digits, so "207 953 km" and "207953" are one reading and the
      // next driver's prefix is built from something predictable.
      if (typed) { answers[meterField.name] = typed; roles.odometer = typed; }
    }

    const photoFields = new Map(form.fields.filter(f => f.kind === 'photo').map(f => [f.name, f]));
    const photos = [];
    for (const file of req.files || []) {
      const field = photoFields.get(file.fieldname);
      if (!field || !/^image\//.test(file.mimetype)) continue;
      photos.push({
        field: field.name, label: field.label,
        filename: file.originalname, mime: file.mimetype, buffer: file.buffer
      });
    }

    const saved = await db.saveSubmission({
      plate: vehicle.plate, owner: vehicle.owner, form, answers, roles, photos,
      userAgent: (req.get('user-agent') || '').slice(0, 400),
      clientIp: req.ip, lang,
      // Kept on the check itself: assignments are replaced every time the
      // assigner re-runs, so this is the only lasting record of who was
      // expected in this van when it was signed for.
      assignedDriver: expected ? expected.driver : null,
      assignedRoute: expected ? (expected.route || null) : null,
      driverChanged: changed,
      changeApprover: changed ? approver : null
    });
    const redirect = `/kvitto/${saved.id}?k=${encodeURIComponent(saved.key)}` +
      (lang === i18n.DEFAULT_LANG ? '' : '&lang=' + lang);
    if (wantsJson(req)) return res.json({ ok: true, id: saved.id, redirect });
    res.redirect(303, redirect);
  } catch (err) { next(err); }
});

app.get('/kvitto/:id', async (req, res, next) => {
  try {
    const s = await db.getSubmission(req.params.id);
    if (!s) return errorPage(res, 404, 'Kvittot finns inte', 'Kontrollen kunde inte hittas.');
    // The receipt is the driver's own, reachable only with the key handed
    // out at submit -- otherwise counting upwards from /kvitto/1 would walk
    // through every check in the fleet. Admins read them under /admin.
    const key = String(req.query.k || '');
    if (!s.public_key || key !== s.public_key) {
      return errorPage(res, 404, 'Kvittot finns inte',
        'Länken saknar sin nyckel. Öppna kvittot från bekräftelsen du fick när du skickade in kontrollen.');
    }
    res.send(receiptPage({
      submission: s,
      fallbackFields: await fallbackFields(),
      lang: i18n.langOf(req.query.lang || s.lang)
    }));
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* QR codes                                                            */
/* ------------------------------------------------------------------ */

const QR_OPTS = { errorCorrectionLevel: 'M', margin: 1, width: 600, color: { dark: '#12324f', light: '#ffffff' } };

app.get('/qr', adminAuth, async (req, res, next) => {
  try {
    const here = requestOrigin(req);
    const configured = defaultBase(req);
    const forced = req.query.base === 'here';
    const base = forced ? here : configured;
    const vehicles = await db.listVehicles();
    const cards = await Promise.all(vehicles.map(async v => {
      const url = `${base}/v/${v.plate}`;
      return { plate: v.plate, url, dataUrl: await QRCode.toDataURL(url, QR_OPTS) };
    }));
    // Codes that point somewhere other than the app you are looking at are
    // almost always a stale PUBLIC_BASE_URL, and you cannot tell by eye once
    // they are printed -- so say it here, before the paper is cut. The note
    // stays up while ?base=here is in force, because the variable is still wrong.
    res.send(qrPage({
      cards, baseUrl: base,
      mismatch: configured === here ? null : { here, configured, forced }
    }));
  } catch (err) { next(err); }
});

app.get('/qr/:plate.png', adminAuth, async (req, res, next) => {
  try {
    const vehicle = await db.getVehicle(req.params.plate);
    if (!vehicle) return errorPage(res, 404, 'Okänt fordon', 'Reg.nr finns inte i appen.');
    const png = await QRCode.toBuffer(`${baseUrl(req)}/v/${vehicle.plate}`, { ...QR_OPTS, type: 'png' });
    res.type('image/png')
      .set('Content-Disposition', `inline; filename="qr-${vehicle.plate}.png"`)
      .send(png);
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}


/* ------------------------------------------------------------------ */
/* API — the driver sync and the Chrome extension                      */
/*                                                                     */
/* One shared secret, API_TOKEN, sent as X-Api-Key (or ?key= for image */
/* URLs, which cannot carry a header). Without it set, the API is off  */
/* entirely rather than open: an unset secret must never mean "let      */
/* everyone in".                                                        */
/* ------------------------------------------------------------------ */

function apiAuth(req, res, next) {
  const token = (process.env.API_TOKEN || '').trim();
  if (!token) {
    return res.status(503).json({ ok: false, error: 'API_TOKEN är inte satt i miljön.' });
  }
  const given = String(req.get('x-api-key') || req.query.key || '');
  if (given.length !== token.length || !safeEqual(given, token)) {
    return res.status(401).json({ ok: false, error: 'Fel eller saknad API-nyckel.' });
  }
  next();
}

app.use('/api', express.json({ limit: '2mb' }));

/** The nightly roster push from the Route Suite. */
app.post('/api/drivers', apiAuth, async (req, res, next) => {
  try {
    const list = Array.isArray(req.body) ? req.body
      : Array.isArray(req.body && req.body.drivers) ? req.body.drivers : null;
    if (!list) {
      return res.status(400).json({ ok: false, error: 'Skicka {"drivers":[{"name":"..."}]} eller en array.' });
    }
    if (!list.length) {
      // An empty roster would empty the dropdown and stop every driver from
      // filing a check. Almost certainly a broken export, so refuse it.
      return res.status(400).json({ ok: false, error: 'Tom lista – vägrar tömma förarregistret.' });
    }
    const result = await db.replaceDrivers(list);
    console.log(`[api] drivers: ${result.total} aktiva, ${result.added} nya, ${result.deactivated.length} avaktiverade`);
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

app.get('/api/drivers', apiAuth, async (req, res, next) => {
  try {
    res.json({ ok: true, drivers: await db.listDrivers() });
  } catch (err) { next(err); }
});

/**
 * Vehicle assignments from the Route Suite's assigner.
 *
 * The app never decides who drives what -- it only records what the suite
 * decided, so that "did this driver check the vehicle they were given" has
 * an answer. A push replaces the days it covers rather than merging: a
 * re-run of the assigner supersedes its own earlier answer for that day.
 */
app.post('/api/assignments', apiAuth, async (req, res, next) => {
  try {
    const list = Array.isArray(req.body) ? req.body
      : Array.isArray(req.body && req.body.assignments) ? req.body.assignments : null;
    if (!list) {
      return res.status(400).json({ ok: false,
        error: 'Skicka {"assignments":[{"date":"YYYY-MM-DD","plate":"...","driver":"..."}]}.' });
    }
    const clean = [];
    for (const a of list) {
      const date = String((a && a.date) || '').slice(0, 10);
      const plate = normalisePlate(a && a.plate);
      const driver = String((a && a.driver) || '').trim().slice(0, 200);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !plate || !driver) continue;
      clean.push({
        date, plate, driver,
        route: String(a.route || '').slice(0, 60),
        type: String(a.type || '').slice(0, 40),
        fleet: a.fleet === 'home' ? 'home' : 'box',
        sourceAt: a.sourceAt || null
      });
    }
    if (!clean.length) {
      return res.status(400).json({ ok: false, error: 'Inga giltiga rader i listan.' });
    }
    const result = await db.replaceAssignments(clean);
    console.log(`[api] assignments: ${result.rows} rader över ${result.days} dagar ` +
      `(${result.dates[0]} – ${result.dates[result.dates.length - 1]})`);
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

app.get('/api/assignments', apiAuth, async (req, res, next) => {
  try {
    const day = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
    const to = day(req.query.to) || summaryLib.dayKey();
    const from = day(req.query.from) || to;
    res.json({ ok: true, from, to, assignments: await db.assignmentsBetween(from, to) });
  } catch (err) { next(err); }
});

/** Everything the extension needs to mirror a span of days. */
app.get('/api/checks', apiAuth, async (req, res, next) => {
  try {
    const day = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
    const to = day(req.query.to) || summaryLib.dayKey();
    const from = day(req.query.from) || to;
    const [rows, vehicles, fallback, allAssignments] = await Promise.all([
      db.submissionsBetween(from, to), db.listVehicles({ includeInactive: true }), fallbackFields(),
      db.assignmentsBetween(from, to)
    ]);
    const photos = await db.photoIdsFor(rows.map(r => Number(r.id)));

    // Grouped by day, already carrying the flags, so the extension renders
    // what the daily mail says rather than re-deriving the polarity itself.
    // Days with assignments but no checks are included on purpose: a day
    // where nobody filed anything is the one worth seeing, and building the
    // list from submissions alone would silently drop it.
    const byDay = new Map();
    for (const a of allAssignments) if (!byDay.has(a.date)) byDay.set(a.date, []);
    for (const row of rows) {
      const key = summaryLib.dayKey(row.submitted_at);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(row);
    }
    const days = [];
    for (const [date, subs] of [...byDay.entries()].sort()) {
      const built = summaryLib.buildDay({
        date, submissions: subs, vehicles, fallback,
        assignments: allAssignments.filter(a => a.date === date)
      });
      built.checks = built.checks.map(c => ({
        ...c,
        photos: (photos.get(c.id) || []).map(p => ({
          id: String(p.id), field: p.field, mime: p.mime, bytes: p.byte_size,
          url: `/api/photo/${p.id}`
        }))
      }));
      days.push(built);
    }
    res.json({
      ok: true, from, to,
      vehicles: vehicles.map(v => ({ plate: v.plate, owner: v.owner, fleet: v.fleet, active: v.active })),
      days
    });
  } catch (err) { next(err); }
});

app.get('/api/photo/:id', apiAuth, async (req, res, next) => {
  try {
    const p = await db.getPhoto(req.params.id);
    if (!p) return res.status(404).json({ ok: false, error: 'Fotot finns inte.' });
    res.type(p.mime).set('Cache-Control', 'private, max-age=86400').send(p.bytes);
  } catch (err) { next(err); }
});

function adminAuth(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    return errorPage(res, 503, 'Administrationen är inte konfigurerad',
      'Sätt miljövariabeln ADMIN_PASSWORD i Railway för att låsa upp den här sidan.');
  }
  // The browser resends Basic credentials on any request, so a POST that
  // arrived from somewhere else is refused before it can change anything.
  if (req.method === 'POST') {
    const origin = req.get('origin');
    if (origin && origin !== requestOrigin(req)) {
      return res.status(403).type('text/plain').send('Fel ursprung.');
    }
  }
  const header = req.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx > -1) {
      const user = decoded.slice(0, idx);
      const pass = decoded.slice(idx + 1);
      if (safeEqual(user, process.env.ADMIN_USER || 'admin') && safeEqual(pass, password)) return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="Fleet 180 admin", charset="UTF-8"')
     .status(401).type('text/plain').send('Behörighet krävs.');
}

app.use('/admin', adminAuth);

function readFilters(req) {
  const plate = normalisePlate(req.query.plate || '');
  const date = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
  return { plate, from: date(req.query.from), to: date(req.query.to) };
}

/** ?ok=... carries a one-line confirmation across the redirect after a POST. */
function back(res, url, message) {
  res.redirect(303, message ? `${url}${url.includes('?') ? '&' : '?'}ok=${encodeURIComponent(message)}` : url);
}
function flashOf(req) {
  return String(req.query.ok || '').slice(0, 200);
}

app.get('/admin', async (req, res, next) => {
  try {
    const filters = readFilters(req);
    const limit = 10;   // ten checks at a time, walked with the arrows
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const [{ rows, total }, vehicles] = await Promise.all([
      db.listSubmissions({ ...filters, limit, offset }),
      db.listVehicles({ includeInactive: true })
    ]);
    res.send(adminListPage({ rows, total, filters, limit, offset, vehicles }));
  } catch (err) { next(err); }
});

app.get('/admin/s/:id', async (req, res, next) => {
  try {
    const s = await db.getSubmission(req.params.id);
    if (!s) return errorPage(res, 404, 'Kontrollen finns inte', 'Ingen kontroll med det numret.', TO_ADMIN);
    res.send(adminDetailPage({ s, fallbackFields: await fallbackFields() }));
  } catch (err) { next(err); }
});

app.get('/admin/s/:id/delete', async (req, res, next) => {
  try {
    const s = await db.getSubmission(req.params.id);
    if (!s) return errorPage(res, 404, 'Kontrollen finns inte', 'Ingen kontroll med det numret.', TO_ADMIN);
    res.send(adminDeletePage({ s }));
  } catch (err) { next(err); }
});

app.post('/admin/s/:id/delete', async (req, res, next) => {
  try {
    const gone = await db.deleteSubmission(req.params.id);
    if (!gone) return back(res, '/admin', 'Kontrollen fanns inte.');
    console.log(`[admin] raderade kontroll ${gone.id} (${gone.plate}, ${gone.driver_name || 'okänd förare'})`);
    back(res, `/admin?plate=${encodeURIComponent(gone.plate)}`,
      `Kontrollen från ${fmtDateTime(gone.submitted_at)} för ${gone.plate} är borttagen.`);
  } catch (err) { next(err); }
});

app.get('/admin/photo/:id', async (req, res, next) => {
  try {
    const p = await db.getPhoto(req.params.id);
    if (!p) return res.status(404).type('text/plain').send('Fotot finns inte.');
    res.type(p.mime).set('Cache-Control', 'private, max-age=3600').send(p.bytes);
  } catch (err) { next(err); }
});

function csvCell(v) {
  const s = String(v === null || v === undefined ? '' : v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

app.get('/admin/export.csv', async (req, res, next) => {
  try {
    const filters = readFilters(req);
    const { rows } = await db.listSubmissions({ ...filters, limit: 50000, offset: 0 });
    const fallback = await fallbackFields();

    // Forms differ between vehicles and change over time, so the columns are
    // the union of every question these rows actually carry, first seen first.
    const columns = [];
    const seen = new Map();
    for (const r of rows) {
      const questions = (r.questions && r.questions.length ? r.questions : fallback)
        .filter(isAnswerable);
      for (const q of questions) {
        const key = q.label;
        if (!seen.has(key)) { seen.set(key, columns.length); columns.push(q); }
      }
    }

    const header = ['Id', 'Tidpunkt', 'Regnr', 'Formulär', 'Foton'].concat(columns.map(q => q.label));
    const lines = [header.map(csvCell).join(';')];
    for (const r of rows) {
      const questions = (r.questions && r.questions.length ? r.questions : fallback);
      const byLabel = new Map(questions.map(q => [q.label, q]));
      const answers = r.answers || {};
      const cells = columns.map(col => {
        const q = byLabel.get(col.label);
        if (!q) return '';                       // this form never asked it
        const value = answers[q.name];
        return value === undefined || value === null ? '' : formatAnswer(q, value);
      });
      lines.push([r.id, new Date(r.submitted_at).toISOString(), r.plate,
        r.form_title || '', r.photo_count].concat(cells).map(csvCell).join(';'));
    }

    const name = `sakerhetskontroll${filters.plate ? '-' + filters.plate : ''}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="${name}"`)
      .send('﻿' + lines.join('\r\n'));
  } catch (err) { next(err); }
});


/* ------------------------------------------------------------------ */
/* Daily summary                                                       */
/* ------------------------------------------------------------------ */

/** One day's figures, shared by the mail, the preview page and the API. */
async function summaryFor(date) {
  const [submissions, vehicles, fallback, assignments] = await Promise.all([
    db.submissionsBetween(date, date),
    db.listVehicles(),
    fallbackFields(),
    db.assignmentsBetween(date, date)
  ]);
  return summaryLib.buildDay({ date, submissions, vehicles, fallback, assignments });
}

async function sendDailySummary(date, { force = false } = {}) {
  const day = await summaryFor(date);
  // claimJob is the guard: a restart, a second instance or a manual click
  // cannot produce two mails for the same day, because only the first
  // caller with this key gets true back.
  if (!force && !(await db.claimJob('daily-summary', date))) {
    return { skipped: true, reason: 'redan skickad för ' + date, day };
  }
  const result = await mail.send({
    subject: summaryLib.subject(day),
    html: summaryLib.renderHtml(day, process.env.PUBLIC_BASE_URL || ''),
    text: summaryLib.renderText(day)
  });
  console.log(`[mail] ${date}: ${result.sent ? 'skickad till ' + result.to : 'ej skickad – ' + result.reason}`);
  return { ...result, day };
}

/**
 * The scheduler. A minute-resolution check rather than a cron dependency:
 * the app is already awake, and the job table makes a duplicate impossible
 * even if this fires twice.
 */
function startScheduler() {
  const hour = Number(process.env.SUMMARY_HOUR || 17);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    console.warn(`[mail] SUMMARY_HOUR="${process.env.SUMMARY_HOUR}" är ogiltig – använder 17`);
  }
  const target = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 17;
  console.log(`[mail] dagssammanfattning kl ${String(target).padStart(2, '0')}:00 Europe/Stockholm` +
    (mail.isConfigured() ? '' : ' (ingen RESEND_API_KEY satt – inget skickas ännu)'));

  setInterval(async () => {
    try {
      if (summaryLib.localHour() !== target) return;
      const today = summaryLib.dayKey();
      const state = await db.jobState('daily-summary');
      if (state && state.last_key === today) return;
      await sendDailySummary(today);
    } catch (err) {
      console.error('[mail] schemalagd sammanfattning misslyckades', err);
    }
  }, 5 * 60 * 1000).unref();
}

app.get('/admin/daily-summary', async (req, res, next) => {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ''))
      ? String(req.query.date) : summaryLib.dayKey();
    const day = await summaryFor(date);
    if (req.query.format === 'json') return res.json(day);
    const html = summaryLib.renderHtml(day, `${req.protocol}://${req.get('host')}`);
    // The mail body has no <head> of its own -- it is built for an inbox --
    // so the preview supplies the icon the browser would otherwise 404 on.
    const bar = `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#1b6ec2"/><circle cx="16" cy="16" r="6" fill="#fff"/></svg>')}">
    <div style="max-width:680px;margin:0 auto;padding:14px 20px 0;font-family:Helvetica,Arial,sans-serif">
      <form method="get" action="/admin/daily-summary" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <a href="/admin" style="color:#1b6ec2">← Admin</a>
        <input type="date" name="date" value="${esc(date)}" style="padding:5px 8px;border:1px solid #dee2e6;border-radius:4px">
        <button type="submit" style="padding:6px 12px;border:0;border-radius:4px;background:#1b6ec2;color:#fff;cursor:pointer">Visa</button>
        <span style="flex:1"></span>
        <span style="font-size:13px;color:#6c757d">${mail.isConfigured()
          ? 'Skickas kl ' + String(Number(process.env.SUMMARY_HOUR || 17)).padStart(2, '0') + ':00 till ' + esc(mail.config().to)
          : 'RESEND_API_KEY saknas – inget mejl skickas ännu'}</span>
      </form>
      <form method="post" action="/admin/daily-summary/send" style="margin:10px 0 0">
        <input type="hidden" name="date" value="${esc(date)}">
        <button type="submit" style="padding:6px 12px;border:1px solid #dee2e6;border-radius:4px;background:#fff;cursor:pointer">Skicka det här mejlet nu</button>
      </form>
    </div>`;
    res.send(html.replace('<div style="max-width:680px', bar + '<div style="max-width:680px'));
  } catch (err) { next(err); }
});

app.post('/admin/daily-summary/send', async (req, res, next) => {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date || ''))
      ? String(req.body.date) : summaryLib.dayKey();
    const result = await sendDailySummary(date, { force: true });
    back(res, `/admin/daily-summary?date=${date}`,
      result.sent ? `Mejlet skickat till ${result.to}.` : `Inte skickat: ${result.reason}`);
  } catch (err) { next(err); }
});


/* ---------------------------- statistics -------------------------- */

/**
 * The period defaults to everything the assignments cover, because a
 * fixed "last 30 days" would show an empty page for weeks after the
 * first sync and look broken rather than young.
 */
async function statsFor(req) {
  const day = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
  const range = await db.assignmentRange();
  const to = day(req.query.to) || range.last || summaryLib.dayKey();
  const from = day(req.query.from) || range.first || to;

  const [assignments, submissions, fallback] = await Promise.all([
    db.assignmentsBetween(from, to),
    db.submissionsBetween(from, to),
    fallbackFields()
  ]);
  const withDay = submissions.map(s => ({ ...s, day: summaryLib.dayKey(s.submitted_at) }));
  return { from, to, range, stats: buildDriverStats({ assignments, submissions: withDay, fallback }) };
}

app.get('/admin/stats', async (req, res, next) => {
  try {
    const { from, to, range, stats } = await statsFor(req);
    res.send(statsPage({ stats, from, to, range, message: flashOf(req), nav: adminNav('stats') }));
  } catch (err) { next(err); }
});

app.get('/admin/stats.csv', async (req, res, next) => {
  try {
    const { from, to, stats } = await statsFor(req);
    const header = ['Förare', 'Tilldelade', 'Gjorda', 'Missade', 'Extra', 'Genomförande',
      'Omsorg', 'Kommentarsandel', 'Medianord', 'Rapporterade brister', 'Foton', 'Poäng', 'Not'];
    const num = x => (x === null || x === undefined ? '' : String(Math.round(x * 1000) / 10).replace('.', ','));
    const lines = [header.map(csvCell).join(';')];
    for (const r of stats.rows) {
      lines.push([r.name, r.expected, r.done, r.missed, r.extra, num(r.completion),
        num(r.care), num(r.commentRate), r.medianWords ?? '', r.flags, r.photos,
        num(r.score), r.note].map(csvCell).join(';'));
    }
    res.type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="forarstatistik-${from}_${to}.csv"`)
      .send('\ufeff' + lines.join('\r\n'));
  } catch (err) { next(err); }
});

/* ---------------------------- vehicles ---------------------------- */

const OWNERS = new Set(['', 'own', 'okq8']);
const FLEETS = new Set(['box', 'home']);

function readVehicleBody(body) {
  const owner = OWNERS.has(body.owner) ? body.owner : '';
  const fleet = FLEETS.has(body.fleet) ? body.fleet : 'box';
  const formId = /^\d+$/.test(String(body.formId || '')) ? Number(body.formId) : null;
  // An unknown model key is dropped rather than stored: the warning-light
  // list falls back to the shared one, which is the safe direction.
  const modelKey = telltales.MODEL_KEYS.includes(body.modelKey) && body.modelKey !== 'generic'
    ? body.modelKey : '';
  return {
    plate: normalisePlate(body.plate),
    owner, fleet, formId, modelKey,
    note: String(body.note || '').slice(0, 500),
    active: body.active === '1'
  };
}

app.get('/admin/vehicles', async (req, res, next) => {
  try {
    const [vehicles, forms] = await Promise.all([
      db.listVehicles({ includeInactive: true }), db.listForms()
    ]);
    const counts = new Map();
    for (const v of vehicles) counts.set(v.plate, await db.countSubmissionsForPlate(v.plate));
    res.send(adminVehiclesPage({ vehicles, forms, counts, message: flashOf(req) }));
  } catch (err) { next(err); }
});

app.post('/admin/vehicles', async (req, res, next) => {
  try {
    const data = readVehicleBody(req.body);
    if (!data.plate) return back(res, '/admin/vehicles', 'Reg.nr saknas.');
    const existing = await db.getVehicle(data.plate);
    if (existing) return back(res, '/admin/vehicles', `${data.plate} finns redan.`);
    await db.createVehicle(data);
    back(res, '/admin/vehicles', `${data.plate} tillagt. QR-koden finns på QR-sidan.`);
  } catch (err) { next(err); }
});

app.post('/admin/vehicles/:id', async (req, res, next) => {
  try {
    const vehicle = await db.getVehicleById(req.params.id);
    if (!vehicle) return back(res, '/admin/vehicles', 'Fordonet finns inte.');
    const data = readVehicleBody(req.body);
    if (!data.plate) return back(res, '/admin/vehicles', 'Reg.nr saknas.');
    if (data.plate !== vehicle.plate) {
      const clash = await db.getVehicle(data.plate);
      if (clash) return back(res, '/admin/vehicles', `${data.plate} finns redan.`);
      const used = await db.countSubmissionsForPlate(vehicle.plate);
      if (used) {
        return back(res, '/admin/vehicles',
          `${vehicle.plate} har ${used} registrerade kontroller och kan inte byta reg.nr – ` +
          'lägg upp det nya fordonet i stället.');
      }
    }
    await db.updateVehicle(vehicle.id, data);
    back(res, '/admin/vehicles', `${data.plate} sparat.`);
  } catch (err) { next(err); }
});

app.post('/admin/vehicles/:id/delete', async (req, res, next) => {
  try {
    const vehicle = await db.getVehicleById(req.params.id);
    if (!vehicle) return back(res, '/admin/vehicles', 'Fordonet finns inte.');
    const used = await db.countSubmissionsForPlate(vehicle.plate);
    if (used) {
      return back(res, '/admin/vehicles',
        `${vehicle.plate} har ${used} registrerade kontroller och tas därför inte bort. ` +
        'Bocka ur Aktiv i stället – historiken finns kvar.');
    }
    await db.deleteVehicle(vehicle.id);
    back(res, '/admin/vehicles', `${vehicle.plate} borttaget.`);
  } catch (err) { next(err); }
});

app.get('/admin/drivers', async (req, res, next) => {
  try {
    const drivers = await db.listDrivers({ includeInactive: true });
    const lastSync = drivers.reduce((max, d) =>
      (!max || new Date(d.updated_at) > new Date(max)) ? d.updated_at : max, null);
    res.send(adminDriversPage({ drivers, lastSync, message: flashOf(req) }));
  } catch (err) { next(err); }
});

/* ------------------------------ forms ----------------------------- */

const CHOICE_VALUES = CHOICES.map(c => c.value);

function readFieldBody(body) {
  const kind = KIND_VALUES.includes(body.kind) ? body.kind : 'text';
  const roleValues = ROLES.map(r => r.value);

  // Options arrive either one per line (the edit panel) or comma separated
  // (the compact "new question" row). Blank lines are dropped and the order
  // is kept -- it is the order the driver sees.
  const raw = String(body.options ?? body.optionsLine ?? '');
  const options = raw
    .split(raw.includes('\n') ? '\n' : ',')
    .map(o => o.trim()).filter(Boolean).slice(0, 300);

  const alertOn = CHOICE_VALUES.filter(c => body['alert_' + c] === '1');

  // The follow-up list ("which lamp?"), one per line, and its translations.
  // The Swedish line is the value that gets stored; a translation row is
  // matched to it by position, so a list edited in one language and not the
  // others still shows Swedish rather than nothing.
  const commentOptions = String(body.commentOptions || '')
    .split('\n').map(o => o.trim()).filter(Boolean).slice(0, 100);

  const i18nBlob = {};
  for (const code of i18n.CODES) {
    if (code === i18n.DEFAULT_LANG) continue;
    const label = String(body['label_' + code] || '').trim().slice(0, 500);
    const section = String(body['section_' + code] || '').trim().slice(0, 120);
    const picks = String(body['picks_' + code] || '')
      .split('\n').map(o => o.trim()).filter(Boolean).slice(0, 100);
    if (label || section || picks.length) {
      i18nBlob[code] = { label, section };
      if (picks.length) i18nBlob[code].commentOptions = picks;
    }
  }

  const commentSource = body.commentSource === 'lights' ? 'lights' : '';

  return {
    kind,
    commentSource,
    label: String(body.label || '').trim().slice(0, 500),
    section: String(body.section || '').trim().slice(0, 120),
    required: body.required === '1' && kind !== 'info',
    role: roleValues.includes(body.role) ? body.role : '',
    options,
    source: body.source === 'drivers' ? 'drivers' : '',
    alertOn,
    commentOptions,
    i18n: i18nBlob
  };
}

app.get('/admin/forms', async (req, res, next) => {
  try {
    res.send(adminFormsPage({ forms: await db.listForms(), message: flashOf(req) }));
  } catch (err) { next(err); }
});

app.post('/admin/forms', async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim().slice(0, 200);
    if (!title) return back(res, '/admin/forms', 'Formuläret behöver ett namn.');
    const copyFromId = /^\d+$/.test(String(req.body.copyFromId || '')) ? Number(req.body.copyFromId) : null;
    const id = await db.createForm({ title, copyFromId });
    back(res, `/admin/forms/${id}`, 'Formuläret skapat.');
  } catch (err) { next(err); }
});

app.get('/admin/forms/:id', async (req, res, next) => {
  try {
    const form = await db.getForm(req.params.id);
    if (!form) return errorPage(res, 404, 'Formuläret finns inte', 'Inget formulär med det numret.', { href: '/admin/forms', text: 'Till formulären' });
    const vehicles = await db.listVehicles({ includeInactive: true });
    res.send(adminFormEditorPage({
      form,
      usedBy: vehicles.filter(v => String(v.form_id) === String(form.id)),
      message: flashOf(req)
    }));
  } catch (err) { next(err); }
});

app.get('/admin/forms/:id/preview', async (req, res, next) => {
  try {
    const form = await db.getForm(req.params.id);
    if (!form) return errorPage(res, 404, 'Formuläret finns inte', 'Inget formulär med det numret.', { href: '/admin/forms', text: 'Till formulären' });
    res.send(formPage({
      vehicle: { plate: 'EXEMPEL' }, form, preview: true,
      lang: i18n.langOf(req.query.lang), sources: await formSources(form)
    }));
  } catch (err) { next(err); }
});

app.post('/admin/forms/:id', async (req, res, next) => {
  try {
    const form = await db.getForm(req.params.id);
    if (!form) return back(res, '/admin/forms', 'Formuläret finns inte.');
    const title = String(req.body.title || '').trim().slice(0, 200);
    if (!title) return back(res, `/admin/forms/${form.id}`, 'Namnet får inte vara tomt.');
    await db.updateForm(form.id, { title });
    back(res, `/admin/forms/${form.id}`, 'Namnet sparat.');
  } catch (err) { next(err); }
});

app.post('/admin/forms/:id/duplicate', async (req, res, next) => {
  try {
    const form = await db.getForm(req.params.id);
    if (!form) return back(res, '/admin/forms', 'Formuläret finns inte.');
    const id = await db.createForm({ title: `${form.title} (kopia)`, copyFromId: form.id });
    back(res, `/admin/forms/${id}`, 'Kopian skapad – ändra frågorna här.');
  } catch (err) { next(err); }
});

app.post('/admin/forms/:id/delete', async (req, res, next) => {
  try {
    const form = await db.getForm(req.params.id);
    if (!form) return back(res, '/admin/forms', 'Formuläret finns inte.');
    if (form.is_default) return back(res, '/admin/forms', 'Standardformuläret kan inte tas bort.');
    const vehicles = await db.listVehicles({ includeInactive: true });
    const using = vehicles.filter(v => String(v.form_id) === String(form.id));
    if (using.length) {
      return back(res, '/admin/forms',
        `${form.title} används av ${using.map(v => v.plate).join(', ')} – flytta dem till ett ` +
        'annat formulär först.');
    }
    await db.deleteForm(form.id);
    back(res, '/admin/forms', `${form.title} borttaget.`);
  } catch (err) { next(err); }
});

app.post('/admin/forms/:id/fields', async (req, res, next) => {
  try {
    const form = await db.getForm(req.params.id);
    if (!form) return back(res, '/admin/forms', 'Formuläret finns inte.');
    const data = readFieldBody(req.body);
    if (!data.label) return back(res, `/admin/forms/${form.id}`, 'Frågan behöver en text.');
    await db.addField(form.id, data);
    back(res, `/admin/forms/${form.id}`, 'Frågan tillagd.');
  } catch (err) { next(err); }
});

app.post('/admin/forms/:id/fields/:fieldId', async (req, res, next) => {
  try {
    const field = await db.getField(req.params.fieldId);
    if (!field || String(field.form_id) !== String(req.params.id)) {
      return back(res, `/admin/forms/${req.params.id}`, 'Frågan finns inte.');
    }
    const data = readFieldBody(req.body);
    if (!data.label) return back(res, `/admin/forms/${field.form_id}`, 'Frågan behöver en text.');
    await db.updateField(field.id, data);
    back(res, `/admin/forms/${field.form_id}`, 'Frågan sparad.');
  } catch (err) { next(err); }
});

app.post('/admin/forms/:id/fields/:fieldId/delete', async (req, res, next) => {
  try {
    const field = await db.getField(req.params.fieldId);
    if (!field || String(field.form_id) !== String(req.params.id)) {
      return back(res, `/admin/forms/${req.params.id}`, 'Frågan finns inte.');
    }
    await db.deleteField(field.id);
    // Answers already stored keep their snapshot, so old checks still read right.
    back(res, `/admin/forms/${field.form_id}`,
      'Frågan borttagen. Redan inskickade kontroller påverkas inte.');
  } catch (err) { next(err); }
});

app.post('/admin/forms/:id/fields/:fieldId/move', async (req, res, next) => {
  try {
    const field = await db.getField(req.params.fieldId);
    if (!field || String(field.form_id) !== String(req.params.id)) {
      return back(res, `/admin/forms/${req.params.id}`, 'Frågan finns inte.');
    }
    await db.moveField(field.id, req.body.dir === 'up' ? 'up' : 'down');
    res.redirect(303, `/admin/forms/${field.form_id}`);
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* Fallbacks                                                           */
/* ------------------------------------------------------------------ */

app.use((req, res) => errorPage(res, 404, 'Sidan finns inte', 'Kontrollera adressen eller skanna fordonets QR-kod igen.'));

app.use((err, req, res, next) => {                       // eslint-disable-line no-unused-vars
  console.error('[error]', err);
  const msg = err && err.code === 'LIMIT_FILE_SIZE'
    ? 'Bilden är för stor (max 12 MB).'
    : 'Ett fel uppstod. Försök igen.';
  if (wantsJson(req)) return res.status(500).json({ ok: false, error: msg });
  errorPage(res, 500, 'Något gick fel', msg);
});

db.init()
  .then(async () => {
    const [vehicles, drivers] = await Promise.all([db.listVehicles(), db.listDrivers()]);
    app.listen(PORT, () => {
      console.log(`[web] listening on :${PORT} · ${vehicles.length} fordon · ${drivers.length} förare`);
      startScheduler();
    });
  })
  .catch(err => {
    console.error('[db] could not initialise schema', err);
    process.exit(1);
  });
