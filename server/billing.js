'use strict';

const db = require('./db');
const fees = require('./fees');
const { createCharge } = require('./charges');
const { logEvent } = require('./merchants');
const { prefixedId, now, iso } = require('./util');

const INTERVALS = ['week', 'month', 'year'];

/** Advance a timestamp by `count` billing intervals (calendar-aware). */
function advance(dateMs, interval, count = 1) {
  const d = new Date(dateMs);
  if (interval === 'week') d.setDate(d.getDate() + 7 * count);
  else if (interval === 'year') d.setFullYear(d.getFullYear() + count);
  else d.setMonth(d.getMonth() + count);
  return d.getTime();
}

/** Normalize a per-interval amount (cents) to a monthly figure for MRR. */
function toMonthly(amountCents, interval) {
  if (interval === 'year') return Math.round(amountCents / 12);
  if (interval === 'week') return Math.round((amountCents * 52) / 12);
  return Math.round(amountCents); // month
}

function intervalLabel(interval) {
  return { week: 'weekly', month: 'monthly', year: 'yearly' }[interval] || interval;
}

/**
 * Create a subscription. Charges the first cycle immediately; if that charge
 * fails the subscription is not created (mirrors Stripe's default behavior).
 *
 * Only brand/last4/expiry are stored for re-billing — never the CVC.
 */
function createSubscription(opts) {
  const {
    merchant,
    customer = {},
    productName,
    amountCents,
    interval = 'month',
    card,
    source = 'api',
    paymentLinkId = null,
    metadata = {},
    couponCode = null,
  } = opts;

  if (!merchant) return { ok: false, error: { code: 'no_merchant', message: 'Merchant is required.' } };
  if (!INTERVALS.includes(interval)) {
    return { ok: false, error: { code: 'invalid_interval', message: 'Interval must be week, month, or year.' } };
  }
  const amount = Math.round(Number(amountCents));
  if (!Number.isFinite(amount) || amount < 50) {
    return { ok: false, error: { code: 'amount_too_small', message: 'Amount must be at least $0.50.' } };
  }

  const ts = now();
  const subId = prefixedId('sub', 18);

  // Charge the first period up front.
  const first = createCharge({
    merchant,
    amountCents: amount,
    card,
    description: productName || 'Subscription',
    customer,
    source: 'subscription',
    subscriptionId: subId,
    paymentLinkId,
    metadata,
    couponCode,
  });
  if (!first.ok) {
    return { ok: false, error: first.error };
  }

  const subscription = {
    id: subId,
    object: 'subscription',
    merchantId: merchant.id,
    customer: { name: customer.name || '', email: customer.email || '' },
    productName: productName || 'Subscription',
    amount,
    currency: 'usd',
    interval,
    status: 'active', // active | past_due | canceled
    // Stored card for re-billing (no CVC).
    savedCard: {
      number: String((card && card.number) || '').replace(/\D/g, ''),
      exp_month: card ? Number(card.exp_month) : null,
      exp_year: card ? Number(card.exp_year) : null,
      brand: first.transaction.card.brand,
      last4: first.transaction.card.last4,
    },
    currentPeriodStart: ts,
    currentPeriodEnd: advance(ts, interval),
    nextBillingAt: advance(ts, interval),
    billingCycles: 1,
    paymentLinkId,
    metadata,
    createdAt: ts,
    createdIso: iso(ts),
    canceledAt: null,
  };
  db.insert('subscriptions', subscription);
  logEvent('subscription.created', { subscriptionId: subId, merchantId: merchant.id, amount, interval });
  try { require('./webhooks').dispatch(merchant.id, 'subscription.created', subscriptionView(subscription)); } catch (e) {}

  return { ok: true, subscription, transaction: first.transaction };
}

/** Cancel a subscription (no further charges). */
function cancelSubscription(subId) {
  const sub = db.findById('subscriptions', subId);
  if (!sub) return { ok: false, error: { code: 'not_found', message: 'Subscription not found.' } };
  if (sub.status === 'canceled') return { ok: true, subscription: sub };
  db.update('subscriptions', subId, { status: 'canceled', canceledAt: now() });
  logEvent('subscription.canceled', { subscriptionId: subId, merchantId: sub.merchantId });
  return { ok: true, subscription: db.findById('subscriptions', subId) };
}

/**
 * Process every subscription whose nextBillingAt has passed. Generates a
 * charge per due cycle. Called by the server's billing ticker and the
 * "run billing now" admin action. Returns a summary.
 */
function processDueSubscriptions(at = now()) {
  const due = db.find('subscriptions', (s) => s.status !== 'canceled' && s.nextBillingAt <= at);
  let charged = 0;
  let failed = 0;

  for (const sub of due) {
    const merchant = db.findById('merchants', sub.merchantId);
    if (!merchant || merchant.status === 'suspended') continue;

    // Catch up any missed cycles (e.g. server was offline), capped to avoid runaway loops.
    let guard = 0;
    while (sub.nextBillingAt <= at && sub.status !== 'canceled' && guard < 60) {
      guard++;
      const result = createCharge({
        merchant: db.findById('merchants', sub.merchantId),
        amountCents: sub.amount,
        card: sub.savedCard,
        saved: true,
        description: sub.productName,
        customer: sub.customer,
        source: 'subscription',
        subscriptionId: sub.id,
      });

      if (result.ok) {
        charged++;
        const nextStart = sub.nextBillingAt;
        const nextEnd = advance(nextStart, sub.interval);
        db.update('subscriptions', sub.id, {
          status: 'active',
          currentPeriodStart: nextStart,
          currentPeriodEnd: nextEnd,
          nextBillingAt: nextEnd,
          billingCycles: (sub.billingCycles || 0) + 1,
        });
        sub.nextBillingAt = nextEnd; // keep loop state in sync
      } else {
        failed++;
        db.update('subscriptions', sub.id, { status: 'past_due' });
        logEvent('subscription.payment_failed', { subscriptionId: sub.id, merchantId: sub.merchantId });
        try {
          require('./notifications').notify(sub.merchantId, 'payment_failed', 'Subscription payment failed', `${sub.productName} — card declined`, { email: sub.customer.email, data: { subscriptionId: sub.id } });
          require('./webhooks').dispatch(sub.merchantId, 'subscription.payment_failed', subscriptionView(db.findById('subscriptions', sub.id)));
        } catch (e) {}
        break; // stop retrying this sub on this pass
      }
    }
  }

  return { processed: due.length, charged, failed };
}

// ---- MRR / analytics ----------------------------------------------------

/** A client's own MRR: monthly-normalized sum of their active subscriptions. */
function merchantMrr(merchantId) {
  return db
    .find('subscriptions', (s) => s.merchantId === merchantId && s.status === 'active')
    .reduce((sum, s) => sum + toMonthly(s.amount, s.interval), 0);
}

/** Total recurring volume flowing through the whole platform (sum of clients). */
function platformVolumeMrr() {
  return db
    .find('subscriptions', (s) => s.status === 'active')
    .reduce((sum, s) => sum + toMonthly(s.amount, s.interval), 0);
}

/**
 * Pierson's own recurring profit MRR: for each active subscription, the
 * monthly-normalized margin Pierson earns on each recurring charge.
 */
function piersonRecurringMrr() {
  const feePlans = db.collection('feePlans');
  let total = 0;
  for (const s of db.find('subscriptions', (x) => x.status === 'active')) {
    const merchant = db.findById('merchants', s.merchantId);
    if (!merchant) continue;
    const q = fees.quote(s.amount, merchant, feePlans);
    total += toMonthly(q.piersonMargin, s.interval);
  }
  return total;
}

/** JSON-safe subscription view (omits stored card number). */
function subscriptionView(sub) {
  if (!sub) return null;
  return {
    id: sub.id,
    object: 'subscription',
    merchant: sub.merchantId,
    customer: sub.customer,
    product_name: sub.productName,
    amount: sub.amount,
    currency: sub.currency,
    interval: sub.interval,
    status: sub.status,
    card: sub.savedCard ? { brand: sub.savedCard.brand, last4: sub.savedCard.last4 } : null,
    current_period_start: sub.currentPeriodStart,
    current_period_end: sub.currentPeriodEnd,
    next_billing_at: sub.nextBillingAt,
    billing_cycles: sub.billingCycles,
    mrr: toMonthly(sub.amount, sub.interval),
    created: Math.floor(sub.createdAt / 1000),
    created_iso: sub.createdIso,
  };
}

module.exports = {
  INTERVALS,
  advance,
  toMonthly,
  intervalLabel,
  createSubscription,
  cancelSubscription,
  processDueSubscriptions,
  merchantMrr,
  platformVolumeMrr,
  piersonRecurringMrr,
  subscriptionView,
};
