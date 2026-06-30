'use strict';

const db = require('./db');
const { prefixedId, now, iso } = require('./util');

/**
 * Coupons / fee-waiver codes.
 *
 * type:
 *   fee_waiver  — fees set to 0 (and processor cost booked to 0 → margin 0)
 *   percent_off — `value` = basis points off the merchant fee (5000 = 50% off)
 *   fixed_off   — `value` = cents off the merchant fee
 *
 * scope: 'platform' (any merchant) or 'merchant' (only `merchantId`).
 */

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

function findByCode(code) {
  const c = normalizeCode(code);
  if (!c) return null;
  return db.findOne('coupons', (x) => x.code === c) || null;
}

/** Is the coupon usable right now (active, not expired, redemptions left)? */
function isLive(coupon) {
  if (!coupon || !coupon.active) return false;
  if (coupon.expiresAt && coupon.expiresAt < now()) return false;
  if (coupon.maxRedemptions != null && coupon.redemptions >= coupon.maxRedemptions) return false;
  return true;
}

/** Does this coupon apply to the given merchant (scope check)? */
function appliesToMerchant(coupon, merchantId) {
  if (!coupon) return false;
  if (coupon.scope === 'merchant') return coupon.merchantId === merchantId;
  return true; // platform
}

/** Validate a code for a merchant. Returns { ok, coupon, message }. */
function validate(code, merchantId) {
  const coupon = findByCode(code);
  if (!coupon) return { ok: false, message: 'Invalid or expired code.' };
  if (!isLive(coupon)) return { ok: false, message: 'Invalid or expired code.' };
  if (!appliesToMerchant(coupon, merchantId)) return { ok: false, message: 'This code is not valid for this account.' };
  return { ok: true, coupon };
}

/** The merchant's currently attached/redeemed coupon, if still live. */
function activeForMerchant(merchant) {
  if (!merchant || !merchant.appliedCoupon) return null;
  const coupon = findByCode(merchant.appliedCoupon);
  if (coupon && isLive(coupon) && appliesToMerchant(coupon, merchant.id)) return coupon;
  return null;
}

/** Consume one redemption (guarded). */
function claim(coupon) {
  if (!coupon) return;
  db.update('coupons', coupon.id, { redemptions: (coupon.redemptions || 0) + 1 });
}

/**
 * Apply a coupon to a computed fee. Returns adjusted { merchantFee, processorCost, waived }.
 * For a full fee waiver, processor cost is booked to 0 so platform margin is exactly 0.
 */
function applyToFee(merchantFee, processorCost, coupon) {
  if (!coupon) return { merchantFee, processorCost, waived: false };
  if (coupon.type === 'fee_waiver') return { merchantFee: 0, processorCost: 0, waived: true };
  if (coupon.type === 'percent_off') {
    const off = Math.round((merchantFee * coupon.value) / 10000);
    return { merchantFee: Math.max(0, merchantFee - off), processorCost, waived: false };
  }
  if (coupon.type === 'fixed_off') {
    return { merchantFee: Math.max(0, merchantFee - coupon.value), processorCost, waived: false };
  }
  return { merchantFee, processorCost, waived: false };
}

function couponView(c) {
  if (!c) return null;
  return {
    id: c.id, code: c.code, type: c.type, value: c.value, scope: c.scope,
    merchantId: c.merchantId || null, maxRedemptions: c.maxRedemptions,
    redemptions: c.redemptions || 0, expiresAt: c.expiresAt || null, active: !!c.active,
    live: isLive(c), createdAt: c.createdAt,
  };
}

/** Short human label, e.g. "Fees waived (0%)" or "25% off fees". */
function label(c) {
  if (!c) return '';
  if (c.type === 'fee_waiver') return 'Fees waived (0%)';
  if (c.type === 'percent_off') return `${(c.value / 100).toFixed(0)}% off fees`;
  if (c.type === 'fixed_off') return `$${(c.value / 100).toFixed(2)} off fees`;
  return c.code;
}

/** Create a coupon (admin). Throws { status, message }. */
function createCoupon(input = {}) {
  const code = normalizeCode(input.code);
  if (!code || !/^[A-Z0-9_-]{2,32}$/.test(code)) throw { status: 400, message: 'Code must be 2–32 letters, numbers, - or _.' };
  if (findByCode(code)) throw { status: 409, message: 'That code already exists.' };
  const type = ['fee_waiver', 'percent_off', 'fixed_off'].includes(input.type) ? input.type : 'fee_waiver';
  let value = 0;
  if (type === 'percent_off') { value = Math.round(Number(input.value)); if (!Number.isFinite(value) || value <= 0 || value > 10000) throw { status: 400, message: 'Percent off must be 1–100.' }; }
  if (type === 'fixed_off') { value = Math.round(Number(input.value)); if (!Number.isFinite(value) || value <= 0) throw { status: 400, message: 'Fixed amount must be positive.' }; }
  const scope = input.scope === 'merchant' ? 'merchant' : 'platform';
  const merchantId = scope === 'merchant' ? (input.merchantId || null) : null;
  if (scope === 'merchant' && !merchantId) throw { status: 400, message: 'Select a merchant for a merchant-scoped coupon.' };
  const ts = now();
  const coupon = {
    id: prefixedId('cpn', 14), object: 'coupon', code, type, value, scope, merchantId,
    maxRedemptions: input.maxRedemptions != null && input.maxRedemptions !== '' ? Math.max(1, Math.round(Number(input.maxRedemptions))) : null,
    redemptions: 0,
    expiresAt: input.expiresAt ? Number(input.expiresAt) : null,
    active: input.active === undefined ? true : !!input.active,
    createdAt: ts, createdIso: iso(ts),
  };
  db.insert('coupons', coupon);
  return coupon;
}

module.exports = {
  normalizeCode, findByCode, isLive, appliesToMerchant, validate, activeForMerchant,
  claim, applyToFee, couponView, label, createCoupon,
};
