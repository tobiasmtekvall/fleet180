#!/usr/bin/env node
'use strict';

/**
 * Writes one PNG per OKQ8 vehicle into ./qr-out/, for printing on
 * labels or pasting into a document.
 *
 *   BASE_URL=https://your-app.up.railway.app npm run qr
 *
 * The /qr page in the running app does the same thing in the browser
 * and is usually easier -- this script is for bulk label printing.
 */
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { VEHICLES } = require('../src/vehicles');

const base = (process.env.BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
if (!base) {
  console.error('Set BASE_URL first, e.g. BASE_URL=https://your-app.up.railway.app npm run qr');
  process.exit(1);
}

const outDir = path.join(__dirname, '..', 'qr-out');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  for (const v of VEHICLES) {
    const url = `${base}/v/${v.plate}`;
    const file = path.join(outDir, `qr-${v.plate}.png`);
    await QRCode.toFile(file, url, {
      errorCorrectionLevel: 'M', margin: 2, width: 900,
      color: { dark: '#12324f', light: '#ffffff' }
    });
    console.log(`${v.plate}  ->  ${url}`);
  }
  console.log(`\n${VEHICLES.length} PNG-filer i ${outDir}`);
})();
