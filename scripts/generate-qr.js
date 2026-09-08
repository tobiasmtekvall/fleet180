#!/usr/bin/env node
'use strict';

/**
 * Writes one PNG per active vehicle into ./qr-out/, for printing on
 * labels or pasting into a document.
 *
 *   BASE_URL=https://fleet180-production.up.railway.app \
 *   DATABASE_URL=... npm run qr
 *
 * The /qr page in the running app does the same thing in the browser and
 * is usually easier -- this script is for bulk label printing. The vehicle
 * list comes from the database, so it always matches what /admin shows.
 */
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const db = require('../src/db');

const base = (process.env.BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
if (!base) {
  console.error('Set BASE_URL first, e.g. BASE_URL=https://fleet180-production.up.railway.app npm run qr');
  process.exit(1);
}

const outDir = path.join(__dirname, '..', 'qr-out');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  await db.init();
  const vehicles = await db.listVehicles();
  for (const v of vehicles) {
    const url = `${base}/v/${v.plate}`;
    await QRCode.toFile(path.join(outDir, `qr-${v.plate}.png`), url, {
      errorCorrectionLevel: 'M', margin: 2, width: 900,
      color: { dark: '#12324f', light: '#ffffff' }
    });
    console.log(`${v.plate}  ->  ${url}`);
  }
  console.log(`\n${vehicles.length} PNG-filer i ${outDir}`);
  await db.pool.end();
})();
