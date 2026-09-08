'use strict';

/**
 * The OKQ8-rented part of the Jonkoping box fleet.
 *
 * Taken verbatim from the Route Suite's vehicles/matrix-defaults.js
 * (VEHICLE_OWNER / DEFAULT_VEHICLES), where these eight plates carry
 * owner: "okq8". The other seven vans in that file are company-owned
 * and deliberately not included here.
 *
 * Order matches the fleet's rank order in the suite.
 */
const VEHICLES = [
  { plate: 'ODW03R', owner: 'okq8' },
  { plate: 'RBE87T', owner: 'okq8' },
  { plate: 'XWA50L', owner: 'okq8' },
  { plate: 'BPM38R', owner: 'okq8' },
  { plate: 'ESJ01Y', owner: 'okq8' },
  { plate: 'HJA34R', owner: 'okq8' },
  { plate: 'BBR00N', owner: 'okq8' },
  { plate: 'WAT90D', owner: 'okq8' }
];

const BY_PLATE = new Map(VEHICLES.map(v => [v.plate, v]));

/** Normalise anything a QR code or a hand-typed URL might carry. */
function normalisePlate(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** The vehicle, or null. Never guesses at a plate that is not on the list. */
function findVehicle(raw) {
  return BY_PLATE.get(normalisePlate(raw)) || null;
}

module.exports = { VEHICLES, findVehicle, normalisePlate };
