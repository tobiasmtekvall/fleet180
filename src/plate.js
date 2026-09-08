'use strict';

/** Registration numbers, normalised the same way everywhere: a QR scan, a
 *  hand-typed URL and an admin form all end up as one uppercase token. */
function normalisePlate(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9ÅÄÖ]/g, '').slice(0, 16);
}

module.exports = { normalisePlate };
