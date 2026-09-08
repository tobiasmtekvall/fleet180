'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');

const db = require('./db');
const { normalisePlate } = require('./plate');
const fieldsLib = require('./fields');
const { KIND_VALUES, ROLES, readAnswer, answerProblem, formatAnswer, isAnswerable } = fieldsLib;
const { indexPage } = require('./views/index');
const { formPage } = require('./views/form');
const { receiptPage } = require('./views/receipt');
const {
  adminListPage, adminDetailPage, adminVehiclesPage,
  adminFormsPage, adminFormEditorPage
} = require('./views/admin');
const { qrPage } = require('./views/qr');
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

function errorPage(res, status, heading, text) {
  res.status(status).send(page({
    title: heading,
    links: [{ href: '/', text: 'Fordon' }],
    body: `<div class="page-head"><h1>${esc(heading)}</h1></div>
           <p class="lede">${esc(text)}</p>
           <div class="actions" style="justify-content:flex-start">
             <a class="btn btn-primary" href="/">Till fordonslistan</a></div>`
  }));
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

app.get('/', async (req, res, next) => {
  try {
    const [vehicles, latest] = await Promise.all([db.listVehicles(), db.latestPerVehicle()]);
    res.send(indexPage({ vehicles, latest }));
  } catch (err) { next(err); }
});

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
    const latest = await db.latestPerVehicle();
    const l = latest.get(vehicle.plate);
    res.send(formPage({
      vehicle, form,
      lastCheck: l ? `${fmtDateTime(l.submitted_at)}${l.driver_name ? ' – ' + l.driver_name : ''}` : null
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

    // Only questions this form defines are read; anything else is dropped.
    const answers = {};
    const roles = {};
    const problems = [];
    for (const f of form.fields) {
      if (!isAnswerable(f)) continue;
      const value = readAnswer(f, req.body);
      const problem = answerProblem(f, value);
      if (problem) problems.push(`${f.label} – ${problem}`);
      answers[f.name] = value;
      if (f.role) roles[f.role] = f.kind === 'yesno' ? formatAnswer(f, value) : value;
    }
    if (problems.length) {
      const msg = problems.length === 1 ? problems[0]
        : `${problems.length} frågor är inte korrekt ifyllda.`;
      if (wantsJson(req)) return res.status(400).json({ ok: false, error: msg });
      return errorPage(res, 400, 'Ofullständig kontroll', msg);
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
      clientIp: req.ip
    });
    const redirect = `/kvitto/${saved.id}`;
    if (wantsJson(req)) return res.json({ ok: true, id: saved.id, redirect });
    res.redirect(303, redirect);
  } catch (err) { next(err); }
});

app.get('/kvitto/:id', async (req, res, next) => {
  try {
    const s = await db.getSubmission(req.params.id);
    if (!s) return errorPage(res, 404, 'Kvittot finns inte', 'Kontrollen kunde inte hittas.');
    res.send(receiptPage({ submission: s, fallbackFields: await fallbackFields() }));
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* QR codes                                                            */
/* ------------------------------------------------------------------ */

const QR_OPTS = { errorCorrectionLevel: 'M', margin: 1, width: 600, color: { dark: '#12324f', light: '#ffffff' } };

app.get('/qr', async (req, res, next) => {
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

app.get('/qr/:plate.png', async (req, res, next) => {
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
    const limit = 100;
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
    if (!s) return errorPage(res, 404, 'Kontrollen finns inte', 'Ingen kontroll med det numret.');
    res.send(adminDetailPage({ s, fallbackFields: await fallbackFields() }));
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

/* ---------------------------- vehicles ---------------------------- */

const OWNERS = new Set(['', 'own', 'okq8']);
const FLEETS = new Set(['box', 'home']);

function readVehicleBody(body) {
  const owner = OWNERS.has(body.owner) ? body.owner : '';
  const fleet = FLEETS.has(body.fleet) ? body.fleet : 'box';
  const formId = /^\d+$/.test(String(body.formId || '')) ? Number(body.formId) : null;
  return {
    plate: normalisePlate(body.plate),
    owner, fleet, formId,
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

/* ------------------------------ forms ----------------------------- */

function readFieldBody(body) {
  const kind = KIND_VALUES.includes(body.kind) ? body.kind : 'text';
  const roleValues = ROLES.map(r => r.value);
  return {
    kind,
    label: String(body.label || '').trim().slice(0, 500),
    section: String(body.section || '').trim().slice(0, 120),
    required: body.required === '1' && kind !== 'info',
    role: roleValues.includes(body.role) ? body.role : ''
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
    if (!form) return errorPage(res, 404, 'Formuläret finns inte', 'Inget formulär med det numret.');
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
    if (!form) return errorPage(res, 404, 'Formuläret finns inte', 'Inget formulär med det numret.');
    res.send(formPage({ vehicle: { plate: 'EXEMPEL' }, form, preview: true }));
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
    const vehicles = await db.listVehicles();
    app.listen(PORT, () => {
      console.log(`[web] listening on :${PORT} · ${vehicles.length} fordon`);
    });
  })
  .catch(err => {
    console.error('[db] could not initialise schema', err);
    process.exit(1);
  });
