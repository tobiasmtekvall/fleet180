'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');

const db = require('./db');
const { VEHICLES, findVehicle } = require('./vehicles');
const { FORM_KEY, TEXT_FIELDS, FILE_FIELDS } = require('./form-def');
const { indexPage } = require('./views/index');
const { formPage } = require('./views/form');
const { receiptPage } = require('./views/receipt');
const { adminListPage, adminDetailPage } = require('./views/admin');
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
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 12, fields: 60 }
});
const uploadFields = upload.fields(FILE_FIELDS.map(f => ({ name: f.name, maxCount: 6 })));

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `${req.protocol}://${req.get('host')}`;
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

/* ------------------------------------------------------------------ */
/* Public routes                                                       */
/* ------------------------------------------------------------------ */

app.get('/health', (req, res) => res.type('text/plain').send('ok'));

app.get('/', async (req, res, next) => {
  try {
    const latest = await db.latestPerVehicle();
    res.send(indexPage({ latest }));
  } catch (err) { next(err); }
});

app.get('/v/:plate', async (req, res, next) => {
  const vehicle = findVehicle(req.params.plate);
  if (!vehicle) {
    return errorPage(res, 404, 'Okänt fordon',
      `Reg.nr "${req.params.plate}" finns inte bland OKQ8-fordonen i den här appen.`);
  }
  try {
    const latest = await db.latestPerVehicle();
    const l = latest.get(vehicle.plate);
    res.send(formPage({
      vehicle,
      lastCheck: l ? `${fmtDateTime(l.submitted_at)}${l.driver_name ? ' – ' + l.driver_name : ''}` : null
    }));
  } catch (err) { next(err); }
});

app.post('/v/:plate', uploadFields, async (req, res, next) => {
  const vehicle = findVehicle(req.params.plate);
  if (!vehicle) {
    if (wantsJson(req)) return res.status(404).json({ ok: false, error: 'Okänt fordon' });
    return errorPage(res, 404, 'Okänt fordon', 'Reg.nr finns inte i appen.');
  }

  // Only the fields the form defines are stored; anything else is dropped.
  const answers = {};
  const missing = [];
  for (const f of TEXT_FIELDS) {
    const val = String(req.body[f.name] ?? '').trim().slice(0, 2000);
    answers[f.name] = val;
    if (f.required && !val) missing.push(f.label);
  }
  if (missing.length) {
    const msg = 'Obligatoriska fält saknas: ' + missing.length + ' st.';
    if (wantsJson(req)) return res.status(400).json({ ok: false, error: msg });
    return errorPage(res, 400, 'Ofullständig kontroll', msg);
  }

  const photos = [];
  for (const f of FILE_FIELDS) {
    for (const file of (req.files && req.files[f.name]) || []) {
      if (!/^image\//.test(file.mimetype)) continue;
      photos.push({
        field: f.name,
        label: f.label,
        filename: file.originalname,
        mime: file.mimetype,
        buffer: file.buffer
      });
    }
  }

  try {
    const saved = await db.saveSubmission({
      plate: vehicle.plate,
      owner: vehicle.owner,
      formKey: FORM_KEY,
      answers,
      photos,
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
    res.send(receiptPage({ submission: s }));
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* QR codes                                                            */
/* ------------------------------------------------------------------ */

const QR_OPTS = { errorCorrectionLevel: 'M', margin: 1, width: 600, color: { dark: '#12324f', light: '#ffffff' } };

app.get('/qr', async (req, res, next) => {
  try {
    const base = baseUrl(req);
    const cards = await Promise.all(VEHICLES.map(async v => {
      const url = `${base}/v/${v.plate}`;
      return { plate: v.plate, url, dataUrl: await QRCode.toDataURL(url, QR_OPTS) };
    }));
    res.send(qrPage({ cards, baseUrl: base }));
  } catch (err) { next(err); }
});

app.get('/qr/:plate.png', async (req, res, next) => {
  const vehicle = findVehicle(req.params.plate);
  if (!vehicle) return errorPage(res, 404, 'Okänt fordon', 'Reg.nr finns inte i appen.');
  try {
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
  const header = req.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);
    const expectedUser = process.env.ADMIN_USER || 'admin';
    if (safeEqual(user, expectedUser) && safeEqual(pass, password)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Fleet 360 admin", charset="UTF-8"')
     .status(401).type('text/plain').send('Behörighet krävs.');
}

function readFilters(req) {
  const plate = findVehicle(req.query.plate || '')?.plate || '';
  const date = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
  return { plate, from: date(req.query.from), to: date(req.query.to) };
}

app.get('/admin', adminAuth, async (req, res, next) => {
  try {
    const filters = readFilters(req);
    const limit = 100;
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const { rows, total } = await db.listSubmissions({ ...filters, limit, offset });
    res.send(adminListPage({ rows, total, filters, limit, offset }));
  } catch (err) { next(err); }
});

app.get('/admin/s/:id', adminAuth, async (req, res, next) => {
  try {
    const s = await db.getSubmission(req.params.id);
    if (!s) return errorPage(res, 404, 'Kontrollen finns inte', 'Ingen kontroll med det numret.');
    res.send(adminDetailPage({ s }));
  } catch (err) { next(err); }
});

app.get('/admin/photo/:id', adminAuth, async (req, res, next) => {
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

app.get('/admin/export.csv', adminAuth, async (req, res, next) => {
  try {
    const filters = readFilters(req);
    const { rows } = await db.listSubmissions({ ...filters, limit: 50000, offset: 0 });
    const header = ['Id', 'Tidpunkt', 'Regnr', 'Foton']
      .concat(TEXT_FIELDS.map(f => f.label));
    const lines = [header.map(csvCell).join(';')];
    for (const r of rows) {
      const a = r.answers || {};
      lines.push([
        r.id,
        new Date(r.submitted_at).toISOString(),
        r.plate,
        r.photo_count
      ].concat(TEXT_FIELDS.map(f => a[f.name] || '')).map(csvCell).join(';'));
    }
    const name = `sakerhetskontroll${filters.plate ? '-' + filters.plate : ''}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="${name}"`)
      .send('﻿' + lines.join('\r\n'));
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
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[web] listening on :${PORT} · ${VEHICLES.length} OKQ8-fordon`);
    });
  })
  .catch(err => {
    console.error('[db] could not initialise schema', err);
    process.exit(1);
  });
