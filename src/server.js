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
const { statsPage, statsResetPage } = require('./views/stats');
const { incidentsPage, expensesPage, incidentDeletePage, HANDLER_LABEL,
  RENTAL_FIRM_LABEL, ESTIMATE_SHOP_LABEL, KIND_LABEL, kindOf } = require('./views/incidents');
const exif = require('./exif');
const expenses = require('./expenses');
const statsLib = require('./stats');
const { buildDriverStats } = statsLib;
const { badgeText } = require('./badges');
const summaryLib = require('./summary');
const assignmentLib = require('./assignment');
const mask = require('./mask');
const odo = require('./odometer');
const calendarAssets = require('./calendar/assets');
const { calendarRouter } = require('./calendar/routes');
const calendarSync = require('./calendar/sync');
const { makeStore } = require('./calendar/store');
const calendarCarry = require('./calendar/carry');
const telltales = require('./telltales');
const mail = require('./mail');
const { page, esc, fmtDateTime } = require('./views/layout');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway terminates TLS in front of the app.
app.set('trust proxy', 1);
app.disable('x-powered-by');

/* The Checklist Calendar, mounted whole at /kalender.
 *
 * Deliberately ABOVE express.static: the calendar's own pages live in
 * `calendar/`, not `public/`, but mounting the guard first means no later
 * middleware can ever reach round it and serve a day's notes to somebody who
 * has not logged in. */
let calendarStore = null;
let calendarApi = null;
const swedishToday = () => summaryLib.dayKey();
app.use('/kalender', (req, res, next) => calendarAuth(req, res, next));
app.use('/kalender/api', (req, res, next) => {
  if (!calendarApi) {
    return res.status(503).json({ error: 'Kalendern är inte klar ännu.' });
  }
  return calendarApi(req, res, next);
});
app.use('/kalender', calendarAssets.serve);

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
function errorPage(res, status, heading, text, back = null, lang = 'sv') {
  res.status(status).send(page({
    title: heading, lang, admin: lang === 'en',
    links: back ? [{ href: back.href, text: back.text }] : [],
    body: `<div class="page-head"><h1>${esc(heading)}</h1></div>
           <p class="lede">${esc(text)}</p>` +
      (back ? `<div class="actions" style="justify-content:flex-start">
             <a class="btn btn-primary" href="${esc(back.href)}">${esc(back.text)}</a></div>` : '')
  }));
}

const TO_ADMIN = { href: '/admin', text: 'Back to Admin' };

/**
 * Live lists a dropdown can be built from. Only fetched when a question
 * actually asks for one, so a form without a driver dropdown never queries
 * the roster.
 */
async function formSources(form, vehicle = null, today = null) {
  const wants = name => form.fields.some(f => f.kind === 'select' && f.source === name);
  const out = {};
  if (wants('drivers')) {
    const drivers = await db.listDrivers();
    out.drivers = drivers.map(d => d.name);
  }
  if (wants('routes')) out.routes = await routeOptions(vehicle, today || summaryLib.dayKey());
  return out;
}

/**
 * The routes to offer on the scanned vehicle's form.
 *
 * Read from the assignments rather than typed into the form, because a fixed
 * list cannot be right for both fleets: the box routes are JKP-EM-n and
 * JKP-EM-n-RR, and the home routes are Budbee's numeric ids, which are
 * different numbers every day. The seeded list was neither -- it said
 * JK-EM-n -- so no route has ever pre-selected itself and a home driver could
 * not pick their route at all.
 *
 * Ordered by how likely it is to be the right one: this van today, anything
 * today, this van lately, anything lately. The window is deliberately wider
 * than today so that a page opened at 05:40, before the assigner has run, is
 * not an empty required dropdown -- and so that a form rendered before the
 * morning push still validates after it, since the list a submit is checked
 * against is built the same way and only grows during the day.
 */
const ROUTE_WINDOW_DAYS = 14;

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), 'sv', { numeric: true, sensitivity: 'base' });
}

async function routeOptions(vehicle, today) {
  const plate = vehicle && vehicle.plate ? vehicle.plate : '';
  const from = assignmentLib.shiftDay(today, -(ROUTE_WINDOW_DAYS - 1));
  // Up to and including tomorrow: a van checked the evening before is
  // pre-filled from tomorrow's assignment, and its route has to be a value
  // the list -- and the server's check of the posted answer -- contains.
  const tomorrow = assignmentLib.shiftDay(today, 1);
  const rows = await db.routeChoices(plate, from, tomorrow);

  const rank = r => (r.mine && (r.date === today || r.date === tomorrow) ? 0
    : r.date === today ? 1 : r.date === tomorrow ? 2 : r.mine ? 3 : 4);
  const best = new Map();
  for (const r of rows) {
    const route = String(r.route || '').trim();
    if (!route) continue;
    const k = rank(r);
    if (!best.has(route) || k < best.get(route)) best.set(route, k);
  }
  return [...best.entries()]
    .sort((a, b) => a[1] - b[1] || naturalCompare(a[0], b[0]))
    .map(([route]) => route);
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

/**
 * How long the form was open, from the timestamp it was built with.
 *
 * MAX_FILL is the line past which the number stops being about the check: a
 * page opened at the depot in the morning and submitted in the afternoon says
 * nothing about how carefully it was filled in, and counting it would reward
 * exactly the wrong habit. Under one second is a machine, not a person.
 */
const MAX_FILL = 3 * 60 * 60;          // seconds

function fillTime(raw) {
  const opened = Number(String(raw || '').trim());
  if (!Number.isFinite(opened) || opened <= 0) return { openedAt: null, seconds: null };
  const openedAt = new Date(opened);
  const seconds = (Date.now() - opened) / 1000;
  if (!(seconds >= 1 && seconds <= MAX_FILL)) return { openedAt, seconds: null };
  return { openedAt, seconds };
}

/* ---------------------- the standings board ------------------------
 *
 * Every scanned QR code renders this, so it must not cost a fleet-wide
 * recomputation each time: fifteen drivers arriving at 05:40 would otherwise
 * run the same query fifteen times inside a minute. It is cached in the
 * process for BOARD_TTL and thrown away whenever a check is filed or the reset
 * line moves, so the number a driver sees is at worst a few minutes old and
 * never wrong about their own submission.
 */
const BOARD_TTL = 5 * 60 * 1000;
let boardCache = null;          // { at, key, board }

function dropBoardCache() { boardCache = null; }

/**
 * How far back the board looks.
 *
 * A rolling month rather than "everything there is". Two reasons, and the
 * second was found by deploying without it: a driver should be able to have a
 * bad week and climb out of it, and a board keyed to the whole assignment
 * history reads "everybody 0 %" every night from midnight until the first
 * check of the day comes in -- which is exactly when the drivers are looking
 * at it. A month of history behind today's zeros makes the number mean
 * "how you have been doing", which is the only thing a standings board is for.
 */
const BOARD_WINDOW_DAYS = 30;

async function buildBoard() {
  const epoch = await db.getStatsEpoch();
  const today = summaryLib.dayKey();
  const window = assignmentLib.shiftDay(today, -(BOARD_WINDOW_DAYS - 1));
  // The reset line always wins when it is later: a reset means start today.
  const from = epoch && epoch > window ? epoch : window;
  const to = today;

  const [assignments, submissions, fallback] = await Promise.all([
    db.assignmentsBetween(from, to),
    db.submissionsBetween(from, to),
    fallbackFields()
  ]);
  const withDay = submissions.map(s => ({ ...s, day: summaryLib.dayKey(s.submitted_at) }));
  const stats = buildDriverStats({ assignments, submissions: withDay, fallback });

  return {
    from,
    minAssignments: stats.minAssignments,
    // Only what the page may show: initials, the percentage, the marks, and a
    // token to recognise yourself by. No names, no scores, no counts.
    rows: stats.rows.map(r => ({
      key: statsLib.driverKey(r.name),
      initials: statsLib.initialsOf(r.name),
      completion: r.completion,
      ranked: r.ranked,
      badges: r.badges || []
    }))
  };
}

async function boardNow() {
  const now = Date.now();
  const key = summaryLib.dayKey();
  if (boardCache && boardCache.key === key && now - boardCache.at < BOARD_TTL) {
    return boardCache.board;
  }
  const board = await buildBoard();
  boardCache = { at: now, key, board };
  return board;
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
    const [latest, sources, todayRows, tomorrowRows, history, meter, board] = await Promise.all([
      db.latestPerVehicle(), formSources(form, vehicle, today),
      db.assignmentsForPlate(vehicle.plate, today),
      db.assignmentsForPlate(vehicle.plate, assignmentLib.shiftDay(today, 1)),
      db.plateHistory(vehicle.plate, weekFrom, today),
      db.lastOdometer(vehicle.plate),
      boardNow()
    ]);
    const l = latest.get(vehicle.plate);
    res.send(formPage({
      vehicle, form, sources, board,
      // The clock starts when the page is built, not when the driver first
      // touches something: walking round the van before answering is the
      // behaviour worth rewarding, and it happens before the first tap.
      openedAt: Date.now(),
      lang: i18n.langOf(req.query.lang),
      // "Senaste kontroll ... – Simon B****": the line under the plate is read
      // at the van, so the name in it is masked like every other name on this
      // page. The fleet list in /admin shows the same fact unmasked.
      lastCheck: l
        ? `${fmtDateTime(l.submitted_at)}${l.driver_name ? ' – ' + mask.maskName(l.driver_name) : ''}`
        : null,
      // The van's own instruktionsbok, from its model unless this vehicle
      // names its own file.
      manual: telltales.manualFor(vehicle.model_key, vehicle.manual_file),
      // Who has this van today (pre-filled), and who has had it this week.
      // Tomorrow's when today has none: the assigner runs the evening before.
      assignment: assignmentLib.currentAssignment(todayRows, tomorrowRows),
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
    // Same vehicle, same day, same lists as the page was drawn with: the two
    // sides have to agree about what is offerable, or a driver is refused an
    // answer the page just gave them.
    const sources = await formSources(form, vehicle, summaryLib.dayKey());

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
    // Must pick the same assignment the page did, or a check filed in the
    // evening would be judged against a different day than it was shown.
    const [todayRows, tomorrowRows] = await Promise.all([
      db.assignmentsForPlate(vehicle.plate, today),
      db.assignmentsForPlate(vehicle.plate, assignmentLib.shiftDay(today, 1))
    ]);
    const assignment = assignmentLib.currentAssignment(todayRows, tomorrowRows);
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
              // `driver` is read by the driver, so it is masked; `drivers` is
              // what the page compares the picked name against and stays whole.
              driver: assignment.list.map(a => mask.maskName(a.driver)).join(', '),
              drivers: assignment.list.map(a => a.driver),
              route: assignment.one ? (assignment.one.route || '') : '',
              tomorrow: !!assignment.tomorrow,
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

    /* How long the check took. Computed here from the timestamp the page was
       built with, never from a number the page reports: the point of the
       measure is that a check filled in faster than anyone could walk round a
       van was not done, and a client-side stopwatch measures whatever the
       client says it does.

       Anything that cannot mean what it says is stored as nothing rather than
       as a small or a large number -- a page opened yesterday and submitted
       today, a clock that moved, a POST that never went through the form.
       Null is a truthful answer; zero is a claim about the driver. */
    const timing = fillTime(req.body.__opened);

    const saved = await db.saveSubmission({
      plate: vehicle.plate, owner: vehicle.owner, form, answers, roles, photos,
      userAgent: (req.get('user-agent') || '').slice(0, 400),
      clientIp: req.ip, lang,
      openedAt: timing.openedAt,
      fillSeconds: timing.seconds,
      // Kept on the check itself: assignments are replaced every time the
      // assigner re-runs, so this is the only lasting record of who was
      // expected in this van when it was signed for.
      assignedDriver: expected ? expected.driver : null,
      assignedRoute: expected ? (expected.route || null) : null,
      driverChanged: changed,
      changeApprover: changed ? approver : null
    });
    // A new check changes the standings the next driver will see.
    dropBoardCache();
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
    if (!vehicle) return errorPage(res, 404, 'Unknown vehicle', 'That registration number is not in the app.', null, 'en');
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

/* The calendar exchange. Guarded by API_TOKEN rather than the admin password
   because it is a machine calling, not a person: his calendar server holds a
   token, not a browser session. The body can be large -- a week of the vehicle
   matrix is thousands of cells -- so it gets its own limit. */
app.post('/api/calendar/sync', apiAuth, express.json({ limit: '12mb' }), async (req, res, next) => {
  try {
    if (!calendarStore) {
      return res.status(503).json({ ok: false, error: 'Kalendern är inte klar ännu.' });
    }
    const result = await calendarSync.exchange(calendarStore, req.body || {});
    const got = result.applied;
    if (got.checklists || got.fleet || got.deletedChecklists || got.deletedFleet) {
      console.log(`[kalender] tog emot ${got.checklists} checklistor, ${got.fleet} veckor, ` +
        `${got.deletedChecklists + got.deletedFleet} raderingar`);
    }
    res.json(result);
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ ok: false, error: err.message });
    next(err);
  }
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
    return errorPage(res, 503, 'Admin is not configured',
      'Set the ADMIN_PASSWORD environment variable in Railway to unlock this page.', null, 'en');
  }
  // The browser resends Basic credentials on any request, so a POST that
  // arrived from somewhere else is refused before it can change anything.
  if (req.method === 'POST') {
    const origin = req.get('origin');
    if (origin && origin !== requestOrigin(req)) {
      return res.status(403).type('text/plain').send('Wrong origin.');
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
     .status(401).type('text/plain').send('Authentication required.');
}

app.use('/admin', adminAuth);

/**
 * The calendar has a login of its own.
 *
 * Not the admin one: the people who keep the checklist calendar are not the
 * people who read invoices and driver statistics, and one password for both
 * means everybody who needs the calendar can also delete a safety check.
 * Username `superuser` unless CALENDAR_USER says otherwise, password from
 * CALENDAR_PASSWORD -- an environment variable, never a value in this repo,
 * because everything here is on GitHub.
 *
 * A separate realm string matters: browsers cache Basic credentials per realm,
 * so sharing one would send the admin password to the calendar and log the
 * wrong person in silently.
 *
 * With CALENDAR_PASSWORD unset it falls back to the admin login rather than
 * standing open or locking shut -- the deploy must never be the moment the
 * calendar becomes unreachable, or public. The startup banner says which of
 * the two is in force.
 */
function calendarAuth(req, res, next) {
  const password = (process.env.CALENDAR_PASSWORD || '').trim();
  if (!password) return adminAuth(req, res, next);

  // Same cross-origin rule as the admin pages: the browser resends Basic
  // credentials on any request, so a POST from somewhere else is refused
  // before it can write to a day.
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
      if (safeEqual(user, process.env.CALENDAR_USER || 'superuser') &&
          safeEqual(pass, password)) return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="Fleet 180 kalender", charset="UTF-8"')
     .status(401).type('text/plain').send('Behörighet krävs.');
}

function readFilters(req) {
  const plate = normalisePlate(req.query.plate || '');
  const date = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
  return { plate, from: date(req.query.from), to: date(req.query.to) };
}

/** ?ok=... carries a one-line confirmation across the redirect after a POST. */
/* The message goes on the query, which is BEFORE any #row-12 the caller put
   on the end -- a flash appended after the fragment would be read as part of
   the fragment, and neither the message nor the scroll would happen. */
function back(res, url, message) {
  if (!message) return res.redirect(303, url);
  const h = url.indexOf('#');
  const [path, hash] = h >= 0 ? [url.slice(0, h), url.slice(h)] : [url, ''];
  res.redirect(303,
    `${path}${path.includes('?') ? '&' : '?'}ok=${encodeURIComponent(message)}${hash}`);
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
    if (!s) return errorPage(res, 404, 'Check not found', 'There is no check with that number.', TO_ADMIN, 'en');
    res.send(adminDetailPage({ s, fallbackFields: await fallbackFields() }));
  } catch (err) { next(err); }
});

app.get('/admin/s/:id/delete', async (req, res, next) => {
  try {
    const s = await db.getSubmission(req.params.id);
    if (!s) return errorPage(res, 404, 'Check not found', 'There is no check with that number.', TO_ADMIN, 'en');
    res.send(adminDeletePage({ s }));
  } catch (err) { next(err); }
});

app.post('/admin/s/:id/delete', async (req, res, next) => {
  try {
    const gone = await db.deleteSubmission(req.params.id);
    if (!gone) return back(res, '/admin', 'That check no longer exists.');
    console.log(`[admin] raderade kontroll ${gone.id} (${gone.plate}, ${gone.driver_name || 'okänd förare'})`);
    back(res, `/admin?plate=${encodeURIComponent(gone.plate)}`,
      `The check from ${fmtDateTime(gone.submitted_at)} for ${gone.plate} was deleted.`);
  } catch (err) { next(err); }
});

app.get('/admin/photo/:id', async (req, res, next) => {
  try {
    const p = await db.getPhoto(req.params.id);
    if (!p) return res.status(404).type('text/plain').send('Photo not found.');
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

    // The question columns keep their Swedish labels: they are the drivers' questions.
    const header = ['Id', 'Time', 'Reg. no.', 'Form', 'Photos'].concat(columns.map(q => q.label));
    const lines = [header.map(csvCell).join(';')];
    for (const r of rows) {
      const questions = (r.questions && r.questions.length ? r.questions : fallback);
      const byLabel = new Map(questions.map(q => [q.label, q]));
      const answers = r.answers || {};
      const cells = columns.map(col => {
        const q = byLabel.get(col.label);
        if (!q) return '';                       // this form never asked it
        const value = answers[q.name];
        return value === undefined || value === null ? '' : formatAnswer(q, value, 'en');
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
  // English answers (Yes/No/Other): this feeds the mail and its preview only.
  return summaryLib.buildDay({ date, submissions, vehicles, fallback, assignments, lang: 'en' });
}

async function sendDailySummary(date, { force = false } = {}) {
  const day = await summaryFor(date);
  // claimJob is the guard: a restart, a second instance or a manual click
  // cannot produce two mails for the same day, because only the first
  // caller with this key gets true back.
  if (!force && !(await db.claimJob('daily-summary', date))) {
    return { skipped: true, reason: 'already sent for ' + date, day };
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
        <button type="submit" style="padding:6px 12px;border:0;border-radius:4px;background:#1b6ec2;color:#fff;cursor:pointer">Show</button>
        <span style="flex:1"></span>
        <span style="font-size:13px;color:#6c757d">${mail.isConfigured()
          ? 'Sent at ' + String(Number(process.env.SUMMARY_HOUR || 17)).padStart(2, '0') + ':00 to ' + esc(mail.config().to)
          : 'RESEND_API_KEY is missing – no email is sent yet'}</span>
      </form>
      <form method="post" action="/admin/daily-summary/send" style="margin:10px 0 0">
        <input type="hidden" name="date" value="${esc(date)}">
        <button type="submit" style="padding:6px 12px;border:1px solid #dee2e6;border-radius:4px;background:#fff;cursor:pointer">Send this email now</button>
      </form>${flashOf(req) ? `
      <p style="margin:10px 0 0;padding:8px 12px;border-radius:4px;background:#e8f5ec;color:#256b38;font-size:14px">${esc(flashOf(req))}</p>` : ''}
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
      result.sent ? `Email sent to ${result.to}.` : `Not sent: ${result.reason}`);
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
  const [range, epoch] = await Promise.all([db.assignmentRange(), db.getStatsEpoch()]);
  const to = day(req.query.to) || range.last || summaryLib.dayKey();
  let from = day(req.query.from) || range.first || to;

  /* The reset line wins over anything earlier, including a date typed into the
     form above the table. It is not a filter the reader can undo -- that is
     the whole point of a reset -- so a "from" before it is quietly pulled
     forward and the page says which line is in force. */
  let clamped = false;
  if (epoch && from < epoch) { from = epoch; clamped = true; }

  const [assignments, submissions, fallback] = await Promise.all([
    db.assignmentsBetween(from, to),
    db.submissionsBetween(from, to),
    fallbackFields()
  ]);
  const withDay = submissions.map(s => ({ ...s, day: summaryLib.dayKey(s.submitted_at) }));
  return {
    from, to, range, epoch, clamped,
    stats: buildDriverStats({ assignments, submissions: withDay, fallback })
  };
}

app.get('/admin/stats', async (req, res, next) => {
  try {
    const { from, to, range, stats, epoch, clamped } = await statsFor(req);
    res.send(statsPage({ stats, from, to, range, epoch, clamped,
      message: flashOf(req), nav: adminNav('stats') }));
  } catch (err) { next(err); }
});

/* ------------------------ the reset line ---------------------------
 *
 * "Reset the statistics" is a date, not a delete. Everything the board and
 * this page count starts at the line; the checks themselves, their photos and
 * the odometer history stay exactly where they are, so a van's record survives
 * a reset, the daily mail still works, and a line set by mistake can be moved
 * or removed again. Nothing in Fleet 180 destroys a filed safety check except
 * deleting that one check by hand, which has its own confirmation page.
 */
app.get('/admin/stats/reset', async (req, res, next) => {
  try {
    const epoch = await db.getStatsEpoch();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ''))
      ? String(req.query.date) : summaryLib.dayKey();
    const counts = await db.countsBefore(from);
    res.send(statsResetPage({ epoch, date: from, counts, nav: adminNav('stats') }));
  } catch (err) { next(err); }
});

app.post('/admin/stats/reset', async (req, res, next) => {
  try {
    const date = String(req.body.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return back(res, '/admin/stats', 'Give a date to count from (YYYY-MM-DD).');
    }
    if (String(req.body.confirm || '').trim().toLowerCase() !== 'reset') {
      return back(res, `/admin/stats/reset?date=${encodeURIComponent(date)}`,
        'Type the word RESET to confirm.');
    }
    await db.setStatsEpoch(date);
    dropBoardCache();
    back(res, '/admin/stats',
      `Statistics now count from ${date}. The checks themselves are kept – nothing was deleted.`);
  } catch (err) { next(err); }
});

app.post('/admin/stats/reset/clear', async (req, res, next) => {
  try {
    await db.setStatsEpoch(null);
    dropBoardCache();
    back(res, '/admin/stats', 'Reset removed – all history counts again.');
  } catch (err) { next(err); }
});

app.get('/admin/stats.csv', async (req, res, next) => {
  try {
    const { from, to, stats } = await statsFor(req);
    const header = ['Driver', 'Assigned', 'Done', 'Missed', 'Extra', 'Completion',
      'Care', 'Comment rate', 'Median words', 'Median time (s)', 'Timed checks',
      'Badges', 'Reported faults', 'Photos', 'Score', 'Note'];
    const num = x => (x === null || x === undefined ? '' : String(Math.round(x * 1000) / 10).replace('.', ','));
    const lines = [header.map(csvCell).join(';')];
    for (const r of stats.rows) {
      lines.push([r.name, r.expected, r.done, r.missed, r.extra, num(r.completion),
        num(r.care), num(r.commentRate), r.medianWords ?? '',
        r.medianFill === null ? '' : Math.round(r.medianFill), r.fillCount,
        (r.badges || []).map(k => badgeText(k, 'en').name).join(', '),
        r.flags, r.photos, num(r.score), r.note].map(csvCell).join(';'));
    }
    res.type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="driver-statistics-${from}_${to}.csv"`)
      .send('\ufeff' + lines.join('\r\n'));
  } catch (err) { next(err); }
});

/* ---------------------------- incidents ---------------------------
 *
 * The damage ledger. Everything here is admin-only (app.use('/admin', …)),
 * because it holds invoices and money and is nobody's business at the van.
 */

/** How far back the "reported but no incident yet" list looks. */
const PENDING_DAYS = 60;

/** Files a workshop actually sends: pictures and PDFs, nothing executable. */
const INCIDENT_MIME = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/i;

/**
 * "12 345,50", "12345.5", "12 345 kr" -> 12345.5. Empty stays empty.
 *
 * Swedish keyboards produce a comma and Swedish eyes produce spaces between
 * the thousands; a cost field that rejects both would be a cost field people
 * work around by writing the figure in the description.
 */
function parseCost(raw) {
  const s = String(raw ?? '').replace(/\s|kr/gi, '').replace(',', '.').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/** What a row is. Spare parts have no workshop visit, so no shop dates. */
const EXPENSE_CATEGORIES = new Set(['damage', 'parts']);
/** Who did the work. '' = nobody has said; never guessed from the owner. */
const HANDLERS = new Set(['', 'okq8', 'own']);
/** The five sections of Expenses. */
const SCOPES = new Set(['vehicle', 'tool', 'misc', 'rental', 'estimate']);
/** The firms we hire from. A fixed list, on Tobias's instruction. */
const RENTAL_FIRMS = new Set(Object.keys(RENTAL_FIRM_LABEL));
/** The workshops that write us estimates. A fixed list, for the same reason. */
const ESTIMATE_SHOPS = new Set(Object.keys(ESTIMATE_SHOP_LABEL));

function readIncidentBody(body) {
  const day = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null);
  const text = (s, n) => String(s || '').trim().slice(0, n);
  const scope = SCOPES.has(body.scope) ? body.scope : 'vehicle';
  const common = {
    scope,
    occurredOn: day(body.occurredOn),
    description: text(body.description, 600),
    supplier: text(body.supplier, 160),
    invoiceNo: text(body.invoiceNo, 80),
    note: text(body.note, 2000),
    cost: parseCost(body.cost),
    rentalFirm: '', rentedTo: null, forPlate: '',
    estimateShop: '', quoted: null
  };
  /* A hire car. `plate` is the HIRE CAR's registration, which is not one of
     ours, so it is typed rather than picked -- normalised the same way as
     ours so "abc 12d" and "ABC12D" are the same car. `forPlate` is the van
     of ours it stands in for, and is allowed to be empty: a hire taken for
     extra capacity stands in for nothing. No driver, no category, no
     workshop dates and no OKQ8/Own -- a rental is not repaired, it is
     returned. */
  if (scope === 'rental') {
    return {
      ...common,
      plate: normalisePlate(body.plate),
      driverName: '', category: '', handledBy: '', shopIn: null, shopOut: null,
      rentalFirm: RENTAL_FIRMS.has(body.rentalFirm) ? body.rentalFirm : '',
      rentedTo: day(body.rentedTo),
      forPlate: normalisePlate(body.forPlate)
    };
  }
  /* An estimate. The van is one of ours, so it is picked; the workshop is one
     of three. `quoted` is what is being ASKED and goes in its own field --
     `cost` is forced to null here, because a quote that reached the cost
     column would be counted as money spent on every total in the app. */
  if (scope === 'estimate') {
    return {
      ...common,
      cost: null,
      plate: normalisePlate(body.plate),
      driverName: '', category: '', handledBy: '', shopIn: null, shopOut: null,
      estimateShop: ESTIMATE_SHOPS.has(body.estimateShop) ? body.estimateShop : '',
      quoted: parseCost(body.quoted)
    };
  }
  // Tools and misc belong to no van: no plate, driver, category, OKQ8/Own
  // or workshop dates, whatever the form happened to send.
  if (scope !== 'vehicle') {
    return { ...common, plate: '', driverName: '', category: '', handledBy: '',
      shopIn: null, shopOut: null };
  }
  const category = EXPENSE_CATEGORIES.has(body.category) ? body.category : 'damage';
  const parts = category === 'parts';
  // 'inhouse' is what a page loaded before the rename still posts.
  const by = body.handledBy === 'inhouse' ? 'own' : body.handledBy;
  return {
    ...common,
    plate: normalisePlate(body.plate),
    driverName: text(body.driverName, 120),
    category,
    handledBy: HANDLERS.has(by) ? by : '',
    // Enforced here and not only by the disabled inputs: a row switched to
    // Spare parts drops any dates it had, or "at the workshop now" would
    // keep counting a part that never went anywhere.
    shopIn: parts ? null : day(body.shopIn),
    shopOut: parts ? null : day(body.shopOut)
  };
}

/** What a scope calls one of its rows, for the messages. */
function entryName(data) {
  if (data.scope === 'tool') return 'Tool expense';
  if (data.scope === 'misc') return 'Misc expense';
  if (data.scope === 'rental') return 'Rental car';
  if (data.scope === 'estimate') return 'Estimate';
  return data.category === 'parts' ? 'Spare part' : 'Incident';
}

/** The problem with a posted row, or null. */
function entryProblem(data) {
  if (data.scope === 'vehicle' && !data.plate) return 'Choose which vehicle it concerns.';
  if (!data.occurredOn) return 'The entry needs a date.';
  if (data.scope === 'rental') {
    if (!data.plate) return "Type the hire car's registration number.";
    if (!data.rentalFirm) return 'Choose which firm the car was hired from.';
    // Not "is it filled in" but "does it make sense": a hire that ends before
    // it starts is a typo somebody will otherwise spend a day looking for.
    if (data.rentedTo && data.rentedTo < data.occurredOn) {
      return 'The car cannot go back before it was picked up.';
    }
    return null;
  }
  if (data.scope === 'estimate') {
    if (!data.plate) return 'Choose which vehicle the estimate is for.';
    if (!data.estimateShop) return 'Choose which workshop wrote the estimate.';
    if (!data.description) return 'Say what the estimate is for.';
    return null;
  }
  if (data.scope !== 'vehicle' && !data.description) return 'Say what the expense was for.';
  return null;
}

/**
 * Where a row action lands afterwards. The Expenses page posts its own URL
 * (filters included) so a save does not throw the filter away; anything that
 * is not one of our two pages falls back to Expenses -- never an open redirect.
 */
function returnTo(req) {
  const r = String((req.body && req.body.ret) || '');
  // The optional #row-12 is how a line opened for editing keeps its place.
  if (/^\/admin\/(expenses|incidents)(\?[\w=&%.+-]*)?(#row-\d+)?$/.test(r)) return r;
  return '/admin/expenses';
}

/**
 * The same upload, but a file that is too big or one file too many does not
 * throw the edit away.
 *
 * On /v/:plate a failed upload is the whole submission, and the driver is
 * told. Here it is one line in a ledger somebody has just typed into: a
 * hire's cost, dates and invoice number must not be lost because the ninth
 * photo was 13 MB. The row saves, and the message says what was left out --
 * the same way a file of the wrong type is already reported.
 */
function softUpload(req, res, next) {
  upload(req, res, err => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' ||
        err.code === 'LIMIT_PART_COUNT' || err.code === 'LIMIT_FIELD_COUNT') {
      req.uploadLimit = err.code;
      req.files = req.files || [];
      return next();
    }
    return next(err);
  });
}

/** What to tell somebody whose files did not all fit. */
function limitNote(req) {
  if (!req.uploadLimit) return '';
  return req.uploadLimit === 'LIMIT_FILE_SIZE'
    ? ' One file was over 12 MB and was not attached – the rest of the line was saved.'
    : ' Too many files in one go (24 at most) – the rest of the line was saved.';
}

/** Photos, invoices and rental agreements off a multipart post. */
const FILE_KIND = { photos: 'photo', invoices: 'invoice', agreements: 'agreement',
  estimates: 'estimate' };

async function saveIncidentFiles(incidentId, files) {
  let n = 0, skipped = 0;
  for (const f of files || []) {
    const kind = FILE_KIND[f.fieldname];
    if (!kind) continue;
    if (!INCIDENT_MIME.test(f.mimetype)) { skipped++; continue; }
    await db.addIncidentFile(incidentId, {
      kind,
      filename: (f.originalname || '').slice(0, 200),
      mime: f.mimetype,
      buffer: f.buffer,
      // What the camera says, not what the clock says: a hand-back photo
      // uploaded the following morning still dates itself to the hand-back.
      // Null when the file carries no EXIF, which is most of the time.
      takenAt: exif.takenAt(f.buffer, f.mimetype)
    });
    n++;
  }
  return { added: n, skipped };
}

/**
 * The damage drivers reported that nobody has opened a case for.
 *
 * Found by the question's ROLE, not its wording -- see ROLES in fields.js.
 * A form can be copied and rephrased; a role survives that.
 */
async function damageNames() {
  const fields = await fallbackFields();
  return new Set(fields.filter(f => f.role === 'damage').map(f => f.name));
}

/**
 * Is this question a damage question?
 *
 * The role is the answer -- except on a check filed before the role existed.
 * Those carry a snapshot of the form as it was, with no role on anything, and
 * they are exactly the reports somebody wants to see on the day this page
 * opens. So a snapshot question also counts if the question of that name
 * carries the role on the form today.
 */
function isDamageQuestion(q, names) {
  return isAnswerable(q) && (q.role === 'damage' || names.has(q.name));
}

async function pendingDamage() {
  const to = summaryLib.dayKey();
  const from = assignmentLib.shiftDay(to, -PENDING_DAYS);
  const [subs, fallback, names] = await Promise.all([
    db.submissionsBetween(from, to),
    fallbackFields(),
    damageNames()
  ]);

  const hits = [];
  for (const s of subs) {
    const questions = (s.questions && s.questions.length) ? s.questions : fallback;
    const said = [];
    for (const q of questions) {
      if (!isDamageQuestion(q, names)) continue;
      const value = (s.answers || {})[q.name];
      if (!isAlerting(q, value)) continue;
      said.push(formatAnswer(q, value, 'en'));
    }
    if (said.length) {
      hits.push({
        id: String(s.id),
        plate: s.plate,
        day: summaryLib.dayKey(s.submitted_at),
        driver: s.driver_name || '',
        text: said.join(' · '),
        photos: s.photo_count || 0
      });
    }
  }
  if (!hits.length) return [];

  const linked = await db.submissionsWithIncident(hits.map(h => Number(h.id)));
  return hits.filter(h => !linked.has(h.id)).reverse();
}

/* Which kind of expense a line is, and which section's form it is entered on.
   The Expenses page has five tabs, but the list under them is the whole
   ledger on every one of them -- the tabs choose the form, not the view. So
   the section (`scope`) is only ever the tab you are standing on, and what
   narrows the list is `kind`, which is the first column of that list. */
const KINDS = new Map([
  ['damage', { scope: 'vehicle', category: 'damage' }],
  ['parts', { scope: 'vehicle', category: 'parts' }],
  ['tool', { scope: 'tool', category: '' }],
  ['misc', { scope: 'misc', category: '' }],
  ['rental', { scope: 'rental', category: '' }],
  ['estimate', { scope: 'estimate', category: '' }]
]);

/**
 * @param smDefault what an absent `sm` parameter means. The page opens on
 *   what is still waiting for the check, because that is what the Site
 *   Manager came to do; a CSV asked for without saying defaults to the whole
 *   ledger, because a file that quietly leaves out every approved line is a
 *   wrong answer nobody can see is wrong.
 */
function incidentFilters(req, smDefault = 'no') {
  const day = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
  const sm = req.query.sm === 'yes' ? 'yes' : req.query.sm === 'all' ? 'all'
    : req.query.sm === 'no' ? 'no' : smDefault;
  /* An old bookmark still says category=parts. It meant the same thing. */
  const legacy = EXPENSE_CATEGORIES.has(req.query.category) ? req.query.category : '';
  const f = {
    plate: normalisePlate(req.query.plate || ''),
    from: day(req.query.from),
    to: day(req.query.to),
    sm,
    // The tab: which form is shown above the list. Never filters the list.
    scope: SCOPES.has(req.query.scope) ? req.query.scope : 'vehicle',
    kind: KINDS.has(req.query.kind) ? req.query.kind : legacy,
    handledBy: (req.query.by === 'inhouse' ? 'own' : HANDLERS.has(req.query.by) && req.query.by ? req.query.by : '')
      || (req.query.by === 'none' ? 'none' : ''),
    // The one line that is open in its own editable form, if any.
    edit: /^\d+$/.test(String(req.query.edit || '')) ? String(req.query.edit) : ''
  };
  /* OKQ8 / Own is a question only a vehicle line answers. Asked together with
     a kind that is not a vehicle's, the two cannot both be true, and an empty
     list with no reason given is worse than the filter being ignored. */
  if (f.kind && KINDS.get(f.kind).scope !== 'vehicle') f.handledBy = '';
  const params = { scope: f.scope, kind: f.kind, plate: f.plate, by: f.handledBy,
    from: f.from, to: f.to, sm: f.sm };
  /* `query` is what every link back to this page carries: the filters, and
     deliberately NOT `edit` -- saving a line should close it, not reopen it. */
  f.query = qsOf(params);
  /* Edit opens the line on its own section's tab, keeping the filters, so
     that closing it or saving it lands back on the same list. */
  f.editQuery = inc => qsOf({ ...params, scope: KINDS.get(kindOf(inc)).scope,
    edit: String(inc.id) });
  return f;
}

function qsOf(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
}

async function incidentsFor(req, smDefault) {
  const filters = incidentFilters(req, smDefault);
  const kind = filters.kind ? KINDS.get(filters.kind) : null;
  /* OKQ8 / Own is a question only a vehicle line answers -- a tool, a misc
     line and a hire car have never had one. So asking it narrows the list to
     vehicles, rather than quietly counting every hire as "not set". */
  const scope = kind ? kind.scope : filters.handledBy ? 'vehicle' : '';
  let incidents = await db.listIncidents({
    plate: filters.plate, from: filters.from, to: filters.to,
    smOk: filters.sm === 'yes' ? true : filters.sm === 'no' ? false : null,
    category: kind ? kind.category : '',
    handledBy: filters.handledBy === 'none' ? '' : filters.handledBy,
    scope
  });
  // "Not set" is the empty string, which the query treats as "any".
  if (filters.handledBy === 'none') incidents = incidents.filter(i => !i.handled_by);
  const totals = expenses.totalsOf(incidents, summaryLib.dayKey());
  return { filters, incidents, totals };
}

function fileNote(files) {
  return (files.added ? ` ${files.added} file(s) attached.` : '') +
    (files.skipped ? ` ${files.skipped} file(s) skipped – images and PDF only.` : '');
}

/* Incidents: the intake. What drivers reported, and the form for a new case. */
app.get('/admin/incidents', async (req, res, next) => {
  try {
    const [vehicles, pendingChecks, counts] = await Promise.all([
      db.listVehicles({ includeInactive: true }),
      pendingDamage(),
      db.incidentCounts()
    ]);
    res.send(incidentsPage({
      pendingChecks,
      plates: vehicles.map(v => v.plate),
      counts,
      today: summaryLib.dayKey(),
      message: flashOf(req), nav: adminNav('incidents')
    }));
  } catch (err) { next(err); }
});

/* Expenses: the ledger, the SM check and the CSV. */
app.get('/admin/expenses', async (req, res, next) => {
  try {
    /* "all" was the old way of asking for every section. Every tab shows them
       all now, so it means nothing -- but the period and the plate beside it
       still do, and a redirect that threw those away would lose a bookmark's
       whole question. */
    if (req.query.scope === 'all') {
      return res.redirect(303, '/admin/expenses' +
        req.originalUrl.slice(req.originalUrl.indexOf('?')).replace(/([?&])scope=all\b/, '$1scope=vehicle'));
    }
    const [{ filters, incidents, totals }, vehicles, sections] = await Promise.all([
      incidentsFor(req),
      db.listVehicles({ includeInactive: true }),
      db.expenseSections()
    ]);
    res.send(expensesPage({
      incidents, totals, filters, sections,
      plates: vehicles.map(v => v.plate),
      today: summaryLib.dayKey(),
      message: flashOf(req), nav: adminNav('expenses')
    }));
  } catch (err) { next(err); }
});

/**
 * Where to land after adding a line: the list it was added from, with any
 * filter that would hide the new line taken off. Nothing else is touched --
 * the period, the tab and the rest are the user's, not ours.
 */
function landOn(from, data) {
  /* Entered on Incidents, a line lives on Expenses: that page lists the
     damage nobody has opened a case for, and the case just opened is not on
     it. Anywhere but Expenses, go to Expenses. */
  if (!from.startsWith('/admin/expenses')) return '/admin/expenses';
  // Any #row-12 on the end belongs to a line being edited, not to a new one.
  const h = from.indexOf('#');
  if (h >= 0) from = from.slice(0, h);
  const i = from.indexOf('?');
  const q = new URLSearchParams(i >= 0 ? from.slice(i + 1) : '');
  const kind = data.scope === 'vehicle' ? (data.category === 'parts' ? 'parts' : 'damage') : data.scope;
  if (q.get('kind') && q.get('kind') !== kind) q.delete('kind');
  if (q.get('plate') && q.get('plate') !== data.plate && q.get('plate') !== data.forPlate) q.delete('plate');
  // A new line has nobody's name on it yet, so "Approved" would hide it.
  if (q.get('sm') === 'yes') q.delete('sm');
  if (q.get('by') && data.scope !== 'vehicle') q.delete('by');
  else if (q.get('by') && q.get('by') !== (data.handledBy || 'none')) q.delete('by');
  // The period hides a new line as effectively as anything else does. A hire
  // still out has no end date, so only its first day has to fall inside.
  const on = data.occurredOn || '';
  if (q.get('from') && on && on < q.get('from')) q.delete('from');
  if (q.get('to') && on && on > q.get('to')) q.delete('to');
  const s = q.toString();
  return (i >= 0 ? from.slice(0, i) : from) + (s ? '?' + s : '');
}

app.post('/admin/incidents', softUpload, async (req, res, next) => {
  try {
    const data = readIncidentBody(req.body);
    const from = returnTo(req);
    const problem = entryProblem(data);
    if (problem) return back(res, from, problem);
    const id = await db.createIncident(data);
    const files = await saveIncidentFiles(id, req.files);
    // Back to the list as it was filtered -- minus any filter that would hide
    // the line just added, because "added" over a list it cannot be seen in is
    // the same as no answer at all.
    back(res, landOn(from, data),
      `${entryName(data)}${data.plate ? ' for ' + data.plate : ''} added.` +
      fileNote(files) + limitNote(req));
  } catch (err) { next(err); }
});

app.post('/admin/incidents/:id', softUpload, async (req, res, next) => {
  try {
    const to = returnTo(req);
    const inc = await db.getIncident(req.params.id);
    if (!inc) return back(res, to, 'That entry no longer exists.');
    // A row never changes section by being saved: the page it was on decides.
    const data = readIncidentBody({ ...req.body, scope: inc.scope });
    const problem = entryProblem(data);
    if (problem) return back(res, to, problem);
    const result = await db.updateIncident(inc.id, data);
    const files = await saveIncidentFiles(inc.id, req.files);
    back(res, to, 'Saved.' + fileNote(files) + limitNote(req) +
      (data.scope === 'vehicle' && data.category === 'parts' && (inc.shop_in || inc.shop_out)
        ? ' Spare parts have no workshop dates, so those were cleared.' : '') +
      (result && result.costChanged ? ({
        quote: ' The quoted amount changed, so the acceptance was cleared and has to be given again.',
        workshop: ' The workshop changed, so the acceptance was cleared – it was given for the other one’s quote.',
        cost: ' The cost changed, so the SM check was reset and needs to be given again.'
      })[result.reason] || '' : ''));
  } catch (err) { next(err); }
});

/**
 * The Site Manager's OK.
 *
 * Two rules, both enforced here and not only in the page: a name is required,
 * because a shared login cannot say who clicked and an unsigned approval is
 * just a tick; and there must be a cost, because approving an unknown amount
 * is not approving anything.
 */
app.post('/admin/incidents/:id/sm', upload, async (req, res, next) => {
  try {
    const to = returnTo(req);
    const inc = await db.getIncident(req.params.id);
    if (!inc) return back(res, to, 'That entry no longer exists.');
    const who = String(req.body.smBy || '').trim().slice(0, 120);
    /* On an estimate this same tick means "accepted, we are going ahead", and
       the amount it is given against is the quote rather than a cost. The
       rule is the one rule either way: no figure, no signature. */
    const estimate = inc.scope === 'estimate';
    const amount = estimate ? inc.quoted_sek : inc.cost_sek;
    if (who.length < 2) {
      return back(res, to, estimate
        ? 'Type your name before accepting – the acceptance is saved under that name.'
        : 'Type your name in the SM box before approving – the approval is saved under that name.');
    }
    if (amount === null || amount === undefined) {
      return back(res, to, estimate
        ? 'Fill in the quoted amount first. Accepting an unknown figure is not accepting.'
        : 'Fill in the cost first. An OK on an unknown amount is not an approval.');
    }
    const after = await db.signOffIncident(inc.id, { ok: true, who });
    console.log(`[admin] ${estimate ? 'estimate accepted' : 'SM check'} ${inc.plate} ${inc.occurred_on} by ${who} (${amount} kr)`);
    back(res, to, `${estimate ? 'Accepted' : 'Approved'} by ${who} ${fmtDateTime(after.sm_at)}.`);
  } catch (err) { next(err); }
});

app.post('/admin/incidents/:id/sm/withdraw', upload, async (req, res, next) => {
  try {
    const to = returnTo(req);
    const inc = await db.getIncident(req.params.id);
    if (!inc) return back(res, to, 'That entry no longer exists.');
    const who = String(req.body.smBy || '').trim().slice(0, 120);
    await db.signOffIncident(inc.id, { ok: false, who });
    // An estimate is accepted, not approved, and undoing it has to say so.
    back(res, to,
      `The ${inc.scope === 'estimate' ? 'acceptance' : 'approval'} for ${
        inc.plate ? inc.plate + ' ' : 'the entry from '}${inc.occurred_on} was withdrawn. The history is kept.`);
  } catch (err) { next(err); }
});

/** Open a case straight from the damage a driver reported. */
app.post('/admin/incidents/from-check/:id', async (req, res, next) => {
  try {
    const s = await db.getSubmission(req.params.id);
    if (!s) return back(res, '/admin/incidents', 'That check no longer exists.');
    const [fallback, names] = await Promise.all([fallbackFields(), damageNames()]);
    const questions = (s.questions && s.questions.length) ? s.questions : fallback;
    const said = [];
    for (const q of questions) {
      if (!isDamageQuestion(q, names)) continue;
      const value = (s.answers || {})[q.name];
      if (isAlerting(q, value)) said.push(formatAnswer(q, value, 'en'));
    }
    await db.createIncident({
      plate: s.plate,
      occurredOn: summaryLib.dayKey(s.submitted_at),
      description: said.join(' · ').slice(0, 600),
      driverName: s.driver_name || '',
      category: 'damage',
      submissionId: Number(s.id)
    });
    back(res, '/admin/expenses',
      `Incident created for ${s.plate}. Fill in the workshop dates and the cost when you have them.`);
  } catch (err) { next(err); }
});

app.get('/admin/incidents/file/:id', async (req, res, next) => {
  try {
    const f = await db.getIncidentFile(req.params.id);
    if (!f) return res.status(404).type('text/plain').send('File not found.');
    // inline: an invoice is something you glance at, not something you collect
    // in a downloads folder. The filename still travels for a save-as.
    res.type(f.mime)
      .set('Content-Disposition', `inline; filename="${encodeURIComponent(f.filename || 'file')}"`)
      .set('Cache-Control', 'private, max-age=3600')
      .send(f.bytes);
  } catch (err) { next(err); }
});

app.post('/admin/incidents/file/:id/delete', upload, async (req, res, next) => {
  try {
    const gone = await db.deleteIncidentFile(req.params.id);
    back(res, returnTo(req), gone ? 'File removed.' : 'That file no longer exists.');
  } catch (err) { next(err); }
});

app.post('/admin/incidents/:id/delete', upload, async (req, res, next) => {
  try {
    const to = returnTo(req);
    const inc = await db.getIncident(req.params.id);
    if (!inc) return back(res, to, 'That entry no longer exists.');
    // A row with an invoice and a signature on it does not disappear on one
    // stray click, the same rule the check delete follows.
    if (req.query.confirm !== '1') {
      return res.send(incidentDeletePage({ inc, ret: to, nav: adminNav('expenses') }));
    }
    await db.deleteIncident(inc.id);
    console.log(`[admin] deleted expense ${inc.id} (${inc.plate} ${inc.occurred_on})`);
    back(res, to, `The entry ${inc.plate ? 'for ' + inc.plate + ' ' : ''}from ${inc.occurred_on} was deleted.`);
  } catch (err) { next(err); }
});

/* The old address, kept so a bookmark or a saved link still downloads. */
app.get('/admin/incidents.csv', (req, res) => {
  const i = req.originalUrl.indexOf('?');
  res.redirect(301, '/admin/expenses.csv' + (i >= 0 ? req.originalUrl.slice(i) : ''));
});

app.get('/admin/expenses.csv', async (req, res, next) => {
  try {
    const { filters, incidents } = await incidentsFor(req, 'all');
    /* The file is the list: one shape for all five sections, with the same
       first column the screen has. A rental's dates live in the workshop
       columns' place -- renamed in the header, because "in" and "out" is
       what both of them are. */
    const header = ['Id', 'Category', 'Vehicle', 'Date / picked up / received', 'Description',
      'Driver', 'Workshop in / hire from', 'Workshop out / hire to', 'Days', 'OKQ8 / Own',
      'Supplier', 'Hire firm / estimating workshop', 'Stands in for', 'Invoice / estimate no.',
      'Cost (SEK)', 'Quoted (SEK)',
      'Photos', 'Invoices', 'Agreements', 'Estimates', 'SM check / accepted', 'SM by', 'SM time',
      'Check', 'Note'];
    const lines = [header.map(csvCell).join(';')];
    for (const i of incidents) {
      const rental = i.scope === 'rental';
      const [start, end] = rental ? [i.occurred_on, i.rented_to] : [i.shop_in, i.shop_out];
      const dayCount = start && end
        ? Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1 : '';
      lines.push([
        i.id, KIND_LABEL[kindOf(i)],
        i.plate, i.occurred_on, i.description, i.driver_name,
        start, end, dayCount, HANDLER_LABEL[i.handled_by] || '',
        i.supplier,
        RENTAL_FIRM_LABEL[i.rental_firm] || ESTIMATE_SHOP_LABEL[i.estimate_shop] || '',
        i.for_plate, i.invoice_no,
        // Decimal comma: the file is ;-separated for a Swedish Excel. Cost and
        // Quoted are two columns on purpose -- summing them would be wrong.
        i.cost_sek === null ? '' : String(i.cost_sek).replace('.', ','),
        i.quoted_sek === null || i.quoted_sek === undefined ? ''
          : String(i.quoted_sek).replace('.', ','),
        i.files.filter(f => f.kind === 'photo').length,
        i.files.filter(f => f.kind === 'invoice').length,
        i.files.filter(f => f.kind === 'agreement').length,
        i.files.filter(f => f.kind === 'estimate').length,
        i.sm_ok ? 'YES' : 'NO', i.sm_by, i.sm_at ? fmtDateTime(i.sm_at) : '',
        i.submission_id || '', i.note
      ].map(csvCell).join(';'));
    }
    res.type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="expenses-${filters.kind || 'all'}.csv"`)
      .send('﻿' + lines.join('\r\n'));
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
  /* A file name in public/manualer/, nothing else: no path, no protocol. The
     field is an override for one van, so a typo must land on "no manual"
     rather than on somebody else's server or on ../. */
  const manualFile = /^[A-Za-z0-9._-]+\.pdf$/.test(String(body.manualFile || '').trim())
    ? String(body.manualFile).trim() : '';
  return {
    plate: normalisePlate(body.plate),
    owner, fleet, formId, modelKey, manualFile,
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
    if (!data.plate) return back(res, '/admin/vehicles', 'The registration number is missing.');
    const existing = await db.getVehicle(data.plate);
    if (existing) return back(res, '/admin/vehicles', `${data.plate} already exists.`);
    await db.createVehicle(data);
    back(res, '/admin/vehicles', `${data.plate} added. Its QR code is on the QR page.`);
  } catch (err) { next(err); }
});

app.post('/admin/vehicles/:id', async (req, res, next) => {
  try {
    const vehicle = await db.getVehicleById(req.params.id);
    if (!vehicle) return back(res, '/admin/vehicles', 'That vehicle no longer exists.');
    const data = readVehicleBody(req.body);
    if (!data.plate) return back(res, '/admin/vehicles', 'The registration number is missing.');
    if (data.plate !== vehicle.plate) {
      const clash = await db.getVehicle(data.plate);
      if (clash) return back(res, '/admin/vehicles', `${data.plate} already exists.`);
      const used = await db.countSubmissionsForPlate(vehicle.plate);
      if (used) {
        return back(res, '/admin/vehicles',
          `${vehicle.plate} has ${used} recorded checks and cannot change its registration number – ` +
          'add the new vehicle instead.');
      }
    }
    await db.updateVehicle(vehicle.id, data);
    back(res, '/admin/vehicles', `${data.plate} saved.`);
  } catch (err) { next(err); }
});

app.post('/admin/vehicles/:id/delete', async (req, res, next) => {
  try {
    const vehicle = await db.getVehicleById(req.params.id);
    if (!vehicle) return back(res, '/admin/vehicles', 'That vehicle no longer exists.');
    const used = await db.countSubmissionsForPlate(vehicle.plate);
    if (used) {
      return back(res, '/admin/vehicles',
        `${vehicle.plate} has ${used} recorded checks and is therefore not deleted. ` +
        'Untick Active instead – the history is kept.');
    }
    await db.deleteVehicle(vehicle.id);
    back(res, '/admin/vehicles', `${vehicle.plate} deleted.`);
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

  // The instruction shown the moment the answer flags ("städa upp"), Swedish
  // here and translated below -- exactly like the label.
  const alertNotice = String(body.alertNotice || '').trim().slice(0, 300);

  const i18nBlob = {};
  for (const code of i18n.CODES) {
    if (code === i18n.DEFAULT_LANG) continue;
    const label = String(body['label_' + code] || '').trim().slice(0, 500);
    const section = String(body['section_' + code] || '').trim().slice(0, 120);
    const picks = String(body['picks_' + code] || '')
      .split('\n').map(o => o.trim()).filter(Boolean).slice(0, 100);
    const notice = String(body['notice_' + code] || '').trim().slice(0, 300);
    if (label || section || picks.length || notice) {
      i18nBlob[code] = { label, section };
      if (picks.length) i18nBlob[code].commentOptions = picks;
      if (notice) i18nBlob[code].alertNotice = notice;
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
    alertNotice,
    commentOptions,
    i18n: i18nBlob
  };
}

/**
 * What the editor does not show, kept as it was.
 *
 * The blob above is rebuilt from the posted form, so anything the editor has
 * no box for would be silently dropped by pressing Save. `pickLabel` -- the
 * little heading above a follow-up list -- is exactly that: it is seeded per
 * question, and until this was here, saving a question in /admin reset
 * "Vilket däck?" to the generic phrasing without saying so.
 */
const KEPT_I18N_KEYS = ['pickLabel'];

function keepUneditedI18n(data, existing) {
  const old = (existing && existing.i18n) || {};
  const blob = { ...data.i18n };
  for (const code of Object.keys(old)) {
    const kept = {};
    for (const key of KEPT_I18N_KEYS) {
      if (old[code] && old[code][key]) kept[key] = old[code][key];
    }
    if (Object.keys(kept).length) blob[code] = { ...kept, ...(blob[code] || {}) };
  }
  return { ...data, i18n: blob };
}

app.get('/admin/forms', async (req, res, next) => {
  try {
    res.send(adminFormsPage({ forms: await db.listForms(), message: flashOf(req) }));
  } catch (err) { next(err); }
});

app.post('/admin/forms', async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim().slice(0, 200);
    if (!title) return back(res, '/admin/forms', 'The form needs a name.');
    const copyFromId = /^\d+$/.test(String(req.body.copyFromId || '')) ? Number(req.body.copyFromId) : null;
    const id = await db.createForm({ title, copyFromId });
    back(res, `/admin/forms/${id}`, 'Form created.');
  } catch (err) { next(err); }
});

app.get('/admin/forms/:id', async (req, res, next) => {
  try {
    const form = await db.getForm(req.params.id);
    if (!form) return errorPage(res, 404, 'Form not found', 'There is no form with that number.', { href: '/admin/forms', text: 'To the forms' }, 'en');
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
    if (!form) return errorPage(res, 404, 'Form not found', 'There is no form with that number.', { href: '/admin/forms', text: 'To the forms' }, 'en');
    res.send(formPage({
      vehicle: { plate: 'EXEMPEL' }, form, preview: true,
      lang: i18n.langOf(req.query.lang), sources: await formSources(form)
    }));
  } catch (err) { next(err); }
});

app.post('/admin/forms/:id', async (req, res, next) => {
  try {
    const form = await db.getForm(req.params.id);
    if (!form) return back(res, '/admin/forms', 'That form no longer exists.');
    const title = String(req.body.title || '').trim().slice(0, 200);
    if (!title) return back(res, `/admin/forms/${form.id}`, 'The name cannot be empty.');
    await db.updateForm(form.id, { title });
    back(res, `/admin/forms/${form.id}`, 'Name saved.');
  } catch (err) { next(err); }
});

app.post('/admin/forms/:id/duplicate', async (req, res, next) => {
  try {
    const form = await db.getForm(req.params.id);
    if (!form) return back(res, '/admin/forms', 'That form no longer exists.');
    const id = await db.createForm({ title: `${form.title} (kopia)`, copyFromId: form.id });
    back(res, `/admin/forms/${id}`, 'Copy created – change the questions here.');
  } catch (err) { next(err); }
});

app.post('/admin/forms/:id/delete', async (req, res, next) => {
  try {
    const form = await db.getForm(req.params.id);
    if (!form) return back(res, '/admin/forms', 'That form no longer exists.');
    if (form.is_default) return back(res, '/admin/forms', 'The default form cannot be deleted.');
    const vehicles = await db.listVehicles({ includeInactive: true });
    const using = vehicles.filter(v => String(v.form_id) === String(form.id));
    if (using.length) {
      return back(res, '/admin/forms',
        `${form.title} is used by ${using.map(v => v.plate).join(', ')} – move them to ` +
        'another form first.');
    }
    await db.deleteForm(form.id);
    back(res, '/admin/forms', `${form.title} deleted.`);
  } catch (err) { next(err); }
});

app.post('/admin/forms/:id/fields', async (req, res, next) => {
  try {
    const form = await db.getForm(req.params.id);
    if (!form) return back(res, '/admin/forms', 'That form no longer exists.');
    const data = readFieldBody(req.body);
    if (!data.label) return back(res, `/admin/forms/${form.id}`, 'The question needs a text.');
    await db.addField(form.id, data);
    back(res, `/admin/forms/${form.id}`, 'Question added.');
  } catch (err) { next(err); }
});

app.post('/admin/forms/:id/fields/:fieldId', async (req, res, next) => {
  try {
    const field = await db.getField(req.params.fieldId);
    if (!field || String(field.form_id) !== String(req.params.id)) {
      return back(res, `/admin/forms/${req.params.id}`, 'That question no longer exists.');
    }
    const data = readFieldBody(req.body);
    if (!data.label) return back(res, `/admin/forms/${field.form_id}`, 'The question needs a text.');
    await db.updateField(field.id, keepUneditedI18n(data, field));
    back(res, `/admin/forms/${field.form_id}`, 'Question saved.');
  } catch (err) { next(err); }
});

app.post('/admin/forms/:id/fields/:fieldId/delete', async (req, res, next) => {
  try {
    const field = await db.getField(req.params.fieldId);
    if (!field || String(field.form_id) !== String(req.params.id)) {
      return back(res, `/admin/forms/${req.params.id}`, 'That question no longer exists.');
    }
    await db.deleteField(field.id);
    // Answers already stored keep their snapshot, so old checks still read right.
    back(res, `/admin/forms/${field.form_id}`,
      'Question deleted. Checks already submitted are not affected.');
  } catch (err) { next(err); }
});

app.post('/admin/forms/:id/fields/:fieldId/move', async (req, res, next) => {
  try {
    const field = await db.getField(req.params.fieldId);
    if (!field || String(field.form_id) !== String(req.params.id)) {
      return back(res, `/admin/forms/${req.params.id}`, 'That question no longer exists.');
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
    calendarStore = makeStore(db.pool);
    calendarApi = calendarRouter({ store: calendarStore, today: swedishToday });
    /* One pass at boot, exactly as his own server does, so a copy woken on
       Monday morning has already rolled Friday's open items over before
       anybody opens it. A failure here must not stop the app: the calendar is
       a guest in this process, the safety checks are the tenant. */
    calendarCarry.run(calendarStore, swedishToday(), 'startup')
      .then(r => {
        if (r && r.moved) console.log(`[kalender] flyttade ${r.moved} punkter till närmaste arbetsdag`);
      })
      .catch(err => console.error('[kalender] carry-forward misslyckades', err.message));

    /* Which login the calendar is behind is worth one line in the log: the
       fallback is deliberate but silent, and "I set the variable, did it take"
       is otherwise unanswerable without trying the page. */
    console.log((process.env.CALENDAR_PASSWORD || '').trim()
      ? `[kalender] egen inloggning aktiv (användare: ${process.env.CALENDAR_USER || 'superuser'})`
      : '[kalender] CALENDAR_PASSWORD är inte satt – kalendern använder admin-inloggningen tills den sätts');

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
