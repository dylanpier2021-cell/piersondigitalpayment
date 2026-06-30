'use strict';

const { bpsOf, clamp } = require('./util');

/**
 * The fee engine. This is the heart of Transfado.
 *
 * Every fee plan carries TWO rate pairs:
 *
 *   cost  = costPct (bps) + costFixed (cents)   -> what processing "costs" the platform
 *   price = pricePct (bps) + priceFixed (cents) -> what the client is charged
 *
 * On each charge we compute:
 *   merchantFee   = price applied to the amount   (deducted from the client)
 *   processorCost = cost applied to the amount    (the platform's underlying cost)
 *   piersonMargin = merchantFee - processorCost   (the platform's profit)
 *   merchantNet   = amount - merchantFee          (what the client keeps)
 *
 * A merchant can either point at a shared fee plan (feePlanId) or carry a
 * per-merchant `feeOverride` that overrides any subset of those four numbers.
 */

/**
 * Resolve the effective rates for a merchant by merging their plan with any
 * per-merchant override. Returns a flat rate object plus provenance info.
 */
function resolveRates(merchant, feePlans) {
  const plan = feePlans.find((p) => p.id === merchant.feePlanId) || null;

  const base = plan
    ? {
        costPct: plan.costPct,
        costFixed: plan.costFixed,
        pricePct: plan.pricePct,
        priceFixed: plan.priceFixed,
      }
    : { costPct: 0, costFixed: 0, pricePct: 0, priceFixed: 0 };

  const override = merchant.feeOverride || {};
  const overriddenKeys = [];
  const rates = { ...base };
  for (const key of ['costPct', 'costFixed', 'pricePct', 'priceFixed']) {
    if (override[key] !== undefined && override[key] !== null && override[key] !== '') {
      rates[key] = Number(override[key]);
      overriddenKeys.push(key);
    }
  }

  return {
    rates,
    planId: plan ? plan.id : null,
    planName: plan ? plan.name : 'Custom',
    overriddenKeys,
    isCustom: overriddenKeys.length > 0,
  };
}

/**
 * Compute the full fee breakdown for an amount (in cents) given resolved rates.
 * Never lets the merchant fee exceed the charged amount. An optional `coupon`
 * (see coupons.js) can discount or fully waive the fee.
 */
function computeFees(amountCents, rates, coupon) {
  const amount = Math.max(0, Math.round(amountCents));

  const rawMerchantFee = bpsOf(amount, rates.pricePct) + rates.priceFixed;
  let merchantFee = clamp(rawMerchantFee, 0, amount);
  let processorCost = bpsOf(amount, rates.costPct) + rates.costFixed;
  let couponWaived = false;

  if (coupon) {
    // Lazy require to avoid a circular dependency.
    const adjusted = require('./coupons').applyToFee(merchantFee, processorCost, coupon);
    merchantFee = adjusted.merchantFee;
    processorCost = adjusted.processorCost;
    couponWaived = adjusted.waived;
  }

  const piersonMargin = merchantFee - processorCost;
  const merchantNet = amount - merchantFee;

  return {
    amount,
    merchantFee, // charged to the client by the platform
    processorCost, // platform's cost of processing
    piersonMargin, // platform's profit on this transaction
    merchantNet, // what the client receives
    couponApplied: coupon ? coupon.code : null,
    couponWaived,
  };
}

/**
 * Convenience: resolve + compute in one call. Pass a `coupon` to apply a discount.
 * Owner-owned businesses process at a permanent true $0 (fee/cost/margin all 0),
 * via the owner flag — not an expiring coupon — so the owner keeps 100%.
 */
function quote(amountCents, merchant, feePlans, coupon) {
  const resolved = resolveRates(merchant, feePlans);
  if (merchant && merchant.ownedByOwner) {
    const amount = Math.max(0, Math.round(amountCents));
    return {
      amount, merchantFee: 0, processorCost: 0, piersonMargin: 0, merchantNet: amount,
      couponApplied: null, couponWaived: false, ownerWaived: true,
      rates: resolved.rates, pricing: resolved,
    };
  }
  const breakdown = computeFees(amountCents, resolved.rates, coupon);
  return { ...breakdown, rates: resolved.rates, pricing: resolved };
}

/**
 * Human-readable rate label, e.g. "3.50% + $0.35".
 */
function describeRate(pct, fixed) {
  const pctStr = (pct / 100).toFixed(2);
  const fixedStr = (fixed / 100).toFixed(2);
  return `${pctStr}% + $${fixedStr}`;
}

module.exports = {
  resolveRates,
  computeFees,
  quote,
  describeRate,
};
