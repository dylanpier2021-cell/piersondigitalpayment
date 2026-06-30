'use strict';

const db = require('./db');
const fees = require('./fees');
const cards = require('./cards');
const { prefixedId, now, iso, formatMoney } = require('./util');
const { logEvent } = require('./merchants');

const MIN_AMOUNT = 50; // $0.50, matching Stripe's minimum.

/**
 * Run a charge end-to-end: quote fees -> authorize card -> record the
 * transaction -> credit the merchant's balance. Used by the virtual
 * terminal, hosted checkout, payment links, the public API, and the
 * recurring billing engine.
 *
 * Returns { ok, transaction, error }.
 */
function createCharge(opts) {
  const {
    merchant,
    amountCents,
    currency = 'usd',
    card,
    description = '',
    customer = {},
    source = 'api',
    subscriptionId = null,
    paymentLinkId = null,
    metadata = {},
    saved = false,
    couponCode = null,
  } = opts;

  if (!merchant) return { ok: false, error: { code: 'no_merchant', message: 'Merchant is required.' } };

  const amount = Math.round(Number(amountCents));
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT) {
    return {
      ok: false,
      error: { code: 'amount_too_small', message: `Amount must be at least $${(MIN_AMOUNT / 100).toFixed(2)}.` },
    };
  }

  // Resolve an applicable coupon: an explicit one-off code (checkout) takes
  // precedence, otherwise fall back to the merchant's attached coupon.
  const coupons = require('./coupons');
  let coupon = null;
  let oneOff = false;
  if (couponCode) {
    const v = coupons.validate(couponCode, merchant.id);
    if (v.ok) { coupon = v.coupon; oneOff = true; }
  }
  if (!coupon) coupon = coupons.activeForMerchant(merchant);

  const feePlans = db.collection('feePlans');
  const q = fees.quote(amount, merchant, feePlans, coupon);

  const auth = cards.authorize(card || {}, amount, { saved });
  const ts = now();

  if (!auth.ok) {
    const failed = {
      id: prefixedId('ch', 20),
      object: 'charge',
      merchantId: merchant.id,
      amount,
      currency,
      status: 'failed',
      paid: false,
      description,
      statementDescriptor: merchant.statementDescriptor,
      customer: { name: customer.name || '', email: customer.email || '' },
      card: { brand: auth.brand, last4: auth.last4, expMonth: card ? card.exp_month : null, expYear: card ? card.exp_year : null },
      fees: null,
      rates: q.rates,
      amountRefunded: 0,
      failureCode: auth.code,
      failureMessage: auth.message,
      source,
      subscriptionId,
      paymentLinkId,
      metadata,
      createdAt: ts,
      createdIso: iso(ts),
    };
    db.insert('transactions', failed);
    logEvent('charge.failed', { chargeId: failed.id, merchantId: merchant.id, code: auth.code });
    return { ok: false, transaction: failed, error: { code: auth.code, message: auth.message } };
  }

  const txn = {
    id: prefixedId('ch', 20),
    object: 'charge',
    merchantId: merchant.id,
    amount,
    currency,
    status: 'succeeded',
    paid: true,
    description,
    statementDescriptor: merchant.statementDescriptor,
    customer: { name: customer.name || '', email: customer.email || '' },
    card: {
      brand: auth.brand,
      last4: auth.last4,
      expMonth: card ? Number(card.exp_month) : null,
      expYear: card ? Number(card.exp_year) : null,
    },
    fees: {
      merchantFee: q.merchantFee,
      processorCost: q.processorCost,
      piersonMargin: q.piersonMargin,
      merchantNet: q.merchantNet,
    },
    rates: q.rates,
    amountRefunded: 0,
    authCode: auth.authCode,
    source,
    subscriptionId,
    paymentLinkId,
    coupon: q.couponApplied || null,
    couponWaived: !!q.couponWaived,
    metadata,
    createdAt: ts,
    createdIso: iso(ts),
  };

  db.insert('transactions', txn);
  db.update('merchants', merchant.id, { balance: (merchant.balance || 0) + q.merchantNet });
  if (oneOff && coupon) coupons.claim(coupon);
  logEvent('charge.succeeded', {
    chargeId: txn.id,
    merchantId: merchant.id,
    amount,
    margin: q.piersonMargin,
  });
  // Notification + webhook (best-effort; never block the charge).
  try {
    require('./notifications').notify(merchant.id, 'payment_received', 'Payment received',
      `${formatMoney(amount)} from ${customer.name || customer.email || 'a customer'}`,
      { email: customer.email, data: { chargeId: txn.id } });
    require('./webhooks').dispatch(merchant.id, 'charge.succeeded', chargeView(txn));
  } catch (e) { /* non-fatal */ }

  return { ok: true, transaction: txn };
}

/**
 * Refund a charge (full or partial). Reverses the proportional net from the
 * merchant's balance. Pierson retains its processing margin (the cost of
 * processing was already incurred), mirroring how acquirers handle refunds.
 */
function refundCharge(txnId, refundCents) {
  const txn = db.findById('transactions', txnId);
  if (!txn) return { ok: false, error: { code: 'not_found', message: 'Charge not found.' } };
  if (txn.status === 'failed') {
    return { ok: false, error: { code: 'not_refundable', message: 'Failed charges cannot be refunded.' } };
  }
  const alreadyRefunded = txn.amountRefunded || 0;
  const refundable = txn.amount - alreadyRefunded;
  if (refundable <= 0) {
    return { ok: false, error: { code: 'already_refunded', message: 'Charge is already fully refunded.' } };
  }
  let amount = refundCents == null ? refundable : Math.round(Number(refundCents));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: { code: 'invalid_amount', message: 'Invalid refund amount.' } };
  }
  amount = Math.min(amount, refundable);

  // Proportional net to claw back from the merchant balance.
  const netPortion = txn.fees ? Math.round((txn.fees.merchantNet * amount) / txn.amount) : amount;
  const merchant = db.findById('merchants', txn.merchantId);
  if (merchant) {
    db.update('merchants', merchant.id, { balance: (merchant.balance || 0) - netPortion });
  }

  const newRefunded = alreadyRefunded + amount;
  const status = newRefunded >= txn.amount ? 'refunded' : 'partially_refunded';
  db.update('transactions', txn.id, { amountRefunded: newRefunded, status });
  logEvent('charge.refunded', { chargeId: txn.id, merchantId: txn.merchantId, amount });
  try { require('./webhooks').dispatch(txn.merchantId, 'charge.refunded', chargeView(db.findById('transactions', txn.id))); } catch (e) {}

  return { ok: true, transaction: db.findById('transactions', txn.id) };
}

/** API/JSON-safe serialization of a charge. */
function chargeView(txn) {
  if (!txn) return null;
  return {
    id: txn.id,
    object: 'charge',
    amount: txn.amount,
    amount_refunded: txn.amountRefunded || 0,
    currency: txn.currency,
    status: txn.status,
    paid: !!txn.paid,
    description: txn.description,
    statement_descriptor: txn.statementDescriptor,
    customer: txn.customer,
    card: txn.card,
    fees: txn.fees,
    failure_code: txn.failureCode || null,
    failure_message: txn.failureMessage || null,
    source: txn.source,
    subscription: txn.subscriptionId || null,
    payment_link: txn.paymentLinkId || null,
    coupon: txn.coupon || null,
    coupon_waived: !!txn.couponWaived,
    metadata: txn.metadata || {},
    created: Math.floor(txn.createdAt / 1000),
    created_iso: txn.createdIso,
  };
}

module.exports = { MIN_AMOUNT, createCharge, refundCharge, chargeView };
