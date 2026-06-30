'use strict';

const { randomId } = require('./util');

/**
 * A simulated card network for sandbox mode. No real money moves. It performs
 * a real Luhn check and recognizes Stripe-style test numbers so the rest of
 * the platform behaves exactly as it would against a live processor. Swap this
 * module for a real acquirer integration to go live.
 */

const TEST_CARDS = {
  '4242424242424242': { result: 'approved', brand: 'visa' },
  '4000056655665556': { result: 'approved', brand: 'visa' },
  '5555555555554444': { result: 'approved', brand: 'mastercard' },
  '5200828282828210': { result: 'approved', brand: 'mastercard' },
  '378282246310005': { result: 'approved', brand: 'amex' },
  '6011111111111117': { result: 'approved', brand: 'discover' },
  // Decline scenarios:
  '4000000000000002': { result: 'declined', code: 'card_declined', message: 'Your card was declined.' },
  '4000000000009995': { result: 'declined', code: 'insufficient_funds', message: 'Insufficient funds.' },
  '4000000000000069': { result: 'declined', code: 'expired_card', message: 'Your card has expired.' },
  '4000000000000127': { result: 'declined', code: 'incorrect_cvc', message: 'Incorrect security code.' },
};

/** Luhn checksum validation. */
function luhnValid(number) {
  const digits = String(number).replace(/\D/g, '');
  if (digits.length < 12) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Detect card brand from the leading digits. */
function detectBrand(number) {
  const n = String(number).replace(/\D/g, '');
  if (/^4/.test(n)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(n)) return 'mastercard';
  if (/^3[47]/.test(n)) return 'amex';
  if (/^6(011|5)/.test(n)) return 'discover';
  return 'unknown';
}

/**
 * "Authorize" a card. Returns a normalized result object.
 * card = { number, exp_month, exp_year, cvc, name }
 * opts.saved = true skips the CVC check (used for stored-card recurring
 * re-bills, since CVCs are never stored — only brand/last4/expiry are).
 */
function authorize(card, amountCents, opts = {}) {
  const number = String(card.number || '').replace(/\D/g, '');
  const last4 = number.slice(-4);
  const brand = detectBrand(number);

  if (!number) {
    return { ok: false, code: 'invalid_number', message: 'Card number is required.', brand, last4 };
  }
  if (!luhnValid(number)) {
    return { ok: false, code: 'invalid_number', message: 'Your card number is invalid.', brand, last4 };
  }

  // Basic expiry sanity check.
  const month = Number(card.exp_month);
  const year = Number(card.exp_year);
  if (!month || month < 1 || month > 12) {
    return { ok: false, code: 'invalid_expiry_month', message: 'Invalid expiration month.', brand, last4 };
  }
  if (!year) {
    return { ok: false, code: 'invalid_expiry_year', message: 'Invalid expiration year.', brand, last4 };
  }
  const fullYear = year < 100 ? 2000 + year : year;
  const now = new Date();
  const expEnd = new Date(fullYear, month, 1); // first day after expiry month
  if (expEnd <= now) {
    return { ok: false, code: 'expired_card', message: 'Your card has expired.', brand, last4 };
  }
  if (!opts.saved && (!card.cvc || String(card.cvc).replace(/\D/g, '').length < 3)) {
    return { ok: false, code: 'incorrect_cvc', message: "Your card's security code is incomplete.", brand, last4 };
  }

  const known = TEST_CARDS[number];
  if (known && known.result === 'declined') {
    return { ok: false, code: known.code, message: known.message, brand: known.brand || brand, last4 };
  }

  // Any Luhn-valid, non-declined card approves in sandbox mode.
  return {
    ok: true,
    brand: (known && known.brand) || brand,
    last4,
    authCode: randomId(6).toUpperCase(),
    network: 'transfado-sandbox',
  };
}

module.exports = { authorize, luhnValid, detectBrand, TEST_CARDS };
