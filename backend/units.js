'use strict';

const KM_PER_MI = 1.609344;
const WEAR_AMBER_KM = 500;
const WEAR_RED_KM = 800;
const DEFAULT_MAX_KM = 800;
/** Amber fires at this fraction of a shoe's max (500/800). */
const WEAR_AMBER_RATIO = WEAR_AMBER_KM / WEAR_RED_KM;
const MAX_RUN_KM = 500;

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

function normalizeUnit(unit) {
  return unit === 'mi' ? 'mi' : 'km';
}

/** Accept number or numeric string; at most 3 decimal places; return rounded km or throw. */
function parseDistanceKm(value, { min = 0, max = Infinity, allowZero = true } = {}) {
  if (value === '' || value == null) {
    const err = new Error('Distance is required.');
    err.status = 400;
    throw err;
  }
  const raw = String(value).trim();
  if (!/^-?\d+(\.\d{1,3})?$/.test(raw) && !/^-?\d+$/.test(raw)) {
    // also allow plain numbers from JSON that already passed Number()
    const n = Number(value);
    if (!Number.isFinite(n)) {
      const err = new Error('Enter a valid distance (up to 3 decimal places).');
      err.status = 400;
      throw err;
    }
    // if float noise beyond 3dp, round — but reject if clearly more than 3dp from string form
    const asStr = String(value);
    if (/\.\d{4,}/.test(asStr)) {
      const err = new Error('Distance can have at most 3 decimal places.');
      err.status = 400;
      throw err;
    }
    const km = round3(n);
    if (!allowZero && km <= 0) {
      const err = new Error('Distance must be greater than zero.');
      err.status = 400;
      throw err;
    }
    if (km < min || km > max) {
      const err = new Error(`Enter a distance between ${min} and ${max} km.`);
      err.status = 400;
      throw err;
    }
    return km;
  }
  if (/\.\d{4,}/.test(raw)) {
    const err = new Error('Distance can have at most 3 decimal places.');
    err.status = 400;
    throw err;
  }
  const km = round3(Number(raw));
  if (!Number.isFinite(km)) {
    const err = new Error('Enter a valid distance.');
    err.status = 400;
    throw err;
  }
  if (!allowZero && km <= 0) {
    const err = new Error('Distance must be greater than zero.');
    err.status = 400;
    throw err;
  }
  if (km < min || km > max) {
    const err = new Error(`Enter a distance between ${min} and ${max} km.`);
    err.status = 400;
    throw err;
  }
  return km;
}

function milesToKm(mi) {
  return round3(Number(mi) * KM_PER_MI);
}

function kmToMiles(km) {
  return round3(Number(km) / KM_PER_MI);
}

module.exports = {
  KM_PER_MI,
  WEAR_AMBER_KM,
  WEAR_RED_KM,
  DEFAULT_MAX_KM,
  WEAR_AMBER_RATIO,
  MAX_RUN_KM,
  round3,
  normalizeUnit,
  parseDistanceKm,
  milesToKm,
  kmToMiles,
};
