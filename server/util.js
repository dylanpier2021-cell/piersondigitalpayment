'use strict';

const crypto = require('crypto');

/**
 * Small shared helpers: id generation, money math, time, signing.
 * Money is ALWAYS handled as integer cents to avoid floating point drift.
 */

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Random url-safe id of `size` chars (default 16). */
function randomId(size = 16) {
  const bytes = crypto.randomBytes(size);
  let out = '';
  for (let i = 0; i < size; i++) {
    out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return out;
}

/**
 * Prefixed resource id, Stripe-style: `ch_8fK2...`, `mer_...`, `txn_...`.
 */
function prefixedId(prefix, size = 20) {
  return `${prefix}_${randomId(size)}`;
}

/** Current epoch milliseconds. */
function now() {
  return Date.now();
}

/** ISO timestamp string for a given epoch ms (defaults to now). */
function iso(ms = Date.now()) {
  return new Date(ms).toISOString();
}

/** HMAC-SHA256 sign `value` with `secret`, returns hex. */
function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
}

/** Constant-time string comparison. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Format integer cents as a currency string, e.g. 123456 -> "$1,234.56". */
function formatMoney(cents, currency = 'usd') {
  const symbol = currency.toLowerCase() === 'usd' ? '$' : '';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const remainder = String(abs % 100).padStart(2, '0');
  const withCommas = dollars.toLocaleString('en-US');
  return `${sign}${symbol}${withCommas}.${remainder}`;
}

/** Parse a user-entered dollar string ("12.50", "$1,234") into integer cents. */
function dollarsToCents(input) {
  if (typeof input === 'number') return Math.round(input * 100);
  const cleaned = String(input).replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return NaN;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return NaN;
  return Math.round(value * 100);
}

/** Basis points (1/100th of a percent) of an amount, rounded to nearest cent. */
function bpsOf(amountCents, bps) {
  return Math.round((amountCents * bps) / 10000);
}

/** Clamp a number between min and max. */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

module.exports = {
  randomId,
  prefixedId,
  now,
  iso,
  sign,
  safeEqual,
  formatMoney,
  dollarsToCents,
  bpsOf,
  clamp,
};
