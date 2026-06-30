'use strict';

const db = require('./db');
const billing = require('./billing');

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD
}

/** Successful (revenue-bearing) charges, optionally for one merchant. */
function succeededCharges(merchantId) {
  return db.find(
    'transactions',
    (t) => t.status !== 'failed' && (!merchantId || t.merchantId === merchantId)
  );
}

/**
 * Build a daily time series for the last `days` days from a list of charges.
 * Returns [{ date, volume, margin, count }] oldest-first.
 */
function dailySeries(charges, days = 30, endMs = Date.now()) {
  const buckets = new Map();
  const start = endMs - (days - 1) * DAY_MS;
  for (let i = 0; i < days; i++) {
    buckets.set(dayKey(start + i * DAY_MS), { date: dayKey(start + i * DAY_MS), volume: 0, margin: 0, count: 0 });
  }
  for (const c of charges) {
    if (c.createdAt < start) continue;
    const k = dayKey(c.createdAt);
    const b = buckets.get(k);
    if (!b) continue;
    b.volume += c.amount;
    b.margin += c.fees ? c.fees.piersonMargin : 0;
    b.count += 1;
  }
  return Array.from(buckets.values());
}

/** Metrics for a single merchant (client) dashboard. */
function merchantMetrics(merchantId) {
  const merchant = db.findById('merchants', merchantId);
  const charges = succeededCharges(merchantId);

  let grossVolume = 0;
  let feesPaid = 0;
  let netCollected = 0;
  let refunded = 0;
  for (const c of charges) {
    grossVolume += c.amount - (c.amountRefunded || 0);
    refunded += c.amountRefunded || 0;
    if (c.fees) {
      feesPaid += c.fees.merchantFee;
      netCollected += c.fees.merchantNet;
    }
  }

  const activeSubs = db.find('subscriptions', (s) => s.merchantId === merchantId && s.status === 'active');

  return {
    balance: merchant ? merchant.balance : 0,
    mrr: billing.merchantMrr(merchantId),
    activeSubscriptions: activeSubs.length,
    chargeCount: charges.length,
    grossVolume,
    feesPaid,
    netCollected,
    refunded,
    series: dailySeries(charges, 30),
  };
}

/** Platform-wide metrics for the admin dashboard. */
function platformMetrics() {
  const merchants = db.collection('merchants');
  const charges = succeededCharges();

  let totalVolume = 0;
  let piersonRevenue = 0; // total fees charged to clients
  let processorCost = 0; // the platform's underlying cost
  let piersonProfit = 0; // margin the platform keeps
  let merchantNet = 0;
  for (const c of charges) {
    totalVolume += c.amount - (c.amountRefunded || 0);
    if (c.fees) {
      piersonRevenue += c.fees.merchantFee;
      processorCost += c.fees.processorCost;
      piersonProfit += c.fees.piersonMargin;
      merchantNet += c.fees.merchantNet;
    }
  }

  // Top merchants by processed volume.
  const byMerchant = new Map();
  for (const c of charges) {
    const cur = byMerchant.get(c.merchantId) || { merchantId: c.merchantId, volume: 0, margin: 0, count: 0 };
    cur.volume += c.amount - (c.amountRefunded || 0);
    cur.margin += c.fees ? c.fees.piersonMargin : 0;
    cur.count += 1;
    byMerchant.set(c.merchantId, cur);
  }
  const topMerchants = Array.from(byMerchant.values())
    .map((row) => {
      const m = db.findById('merchants', row.merchantId);
      return { ...row, businessName: m ? m.businessName : 'Unknown' };
    })
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 8);

  return {
    totalMerchants: merchants.length,
    activeMerchants: merchants.filter((m) => m.status === 'active').length,
    totalCharges: charges.length,
    totalVolume,
    piersonRevenue,
    processorCost,
    piersonProfit,
    merchantNet,
    payableBalance: merchants.reduce((s, m) => s + (m.balance || 0), 0),
    piersonMrr: billing.piersonRecurringMrr(),
    platformVolumeMrr: billing.platformVolumeMrr(),
    activeSubscriptions: db.find('subscriptions', (s) => s.status === 'active').length,
    series: dailySeries(charges, 30),
    topMerchants,
  };
}

module.exports = { merchantMetrics, platformMetrics, dailySeries, succeededCharges };
