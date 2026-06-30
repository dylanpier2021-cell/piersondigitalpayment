'use strict';

const db = require('./db');
const metrics = require('./metrics');
const { prefixedId, now, iso } = require('./util');
const { logEvent } = require('./merchants');

/** Merchant accounts the owner runs themselves (they keep 100% — $0 fees). */
function ownerOwnedMerchants() {
  return db.find('merchants', (m) => m.ownedByOwner);
}

/** Total margin Transfado has earned from OTHER businesses (the 2.5%+$0.10 spread). */
function platformProfitEarned() {
  return db.find('transactions', (t) => t.status !== 'failed')
    .reduce((s, t) => s + (t.fees ? t.fees.piersonMargin : 0), 0);
}
function platformProfitWithdrawn() {
  return db.collection('ownerPayouts').reduce((s, p) => s + (p.fromProfit || 0), 0);
}

/**
 * The owner's full earnings view: profit from everyone else on Transfado +
 * balances from the owner's own businesses, a combined withdrawable balance,
 * a per-merchant breakdown, a margin time-series, and payout history.
 */
function earnings() {
  const earned = platformProfitEarned();
  const withdrawn = platformProfitWithdrawn();
  const profitAvailable = earned - withdrawn;

  const own = ownerOwnedMerchants();
  const ownAvailable = own.reduce((s, m) => s + (m.balance || 0), 0);
  const combined = profitAvailable + ownAvailable;

  // Per-merchant breakdown of platform profit (other businesses only).
  const perMerchant = [];
  for (const m of db.collection('merchants')) {
    if (m.ownedByOwner) continue;
    const txns = db.find('transactions', (t) => t.merchantId === m.id && t.status !== 'failed');
    if (!txns.length) continue;
    let margin = 0, volume = 0;
    for (const t of txns) { margin += t.fees ? t.fees.piersonMargin : 0; volume += t.amount - (t.amountRefunded || 0); }
    perMerchant.push({ id: m.id, businessName: m.businessName, margin, volume, count: txns.length });
  }
  perMerchant.sort((a, b) => b.margin - a.margin);

  // The owner's own businesses (they keep 100% of volume).
  const ownBusinesses = own.map((m) => {
    const txns = db.find('transactions', (t) => t.merchantId === m.id && t.status !== 'failed');
    const volume = txns.reduce((s, t) => s + (t.amount - (t.amountRefunded || 0)), 0);
    return { id: m.id, businessName: m.businessName, balance: m.balance, volume, count: txns.length };
  });

  const series = metrics.dailySeries(db.find('transactions', (t) => t.status !== 'failed'), 30);

  return {
    profitEarned: earned,
    profitWithdrawn: withdrawn,
    profitAvailable,
    ownAvailable,
    combined,
    activeSubscriptions: db.find('subscriptions', (s) => s.status === 'active').length,
    totalMerchants: db.collection('merchants').length,
    perMerchant,
    ownBusinesses,
    series,
    payoutMethod: db.getData().meta.settings.ownerPayoutMethod || null,
    payouts: db.collection('ownerPayouts').slice().sort((a, b) => b.createdAt - a.createdAt),
  };
}

/** Pay out from the combined pool: drains platform profit first, then own-business balances. */
function payout(amountCents) {
  const amount = Math.round(Number(amountCents));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: { message: 'Invalid amount.' } };

  const method = db.getData().meta.settings.ownerPayoutMethod;
  if (!method) return { ok: false, error: { message: 'Add a payout method before withdrawing.', code: 'no_payout_method' } };

  const profitAvailable = platformProfitEarned() - platformProfitWithdrawn();
  const own = ownerOwnedMerchants();
  const ownAvailable = own.reduce((s, m) => s + (m.balance || 0), 0);
  const combined = profitAvailable + ownAvailable;
  if (amount > combined) return { ok: false, error: { message: 'Amount exceeds available balance.' } };

  const fromProfit = Math.min(amount, profitAvailable);
  let remaining = amount - fromProfit;
  let fromBusinesses = 0;
  for (const m of own) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, m.balance || 0);
    if (take > 0) { db.update('merchants', m.id, { balance: (m.balance || 0) - take }); fromBusinesses += take; remaining -= take; }
  }

  const ts = now();
  const po = {
    id: prefixedId('opo', 16), object: 'owner_payout', amount, fromProfit, fromBusinesses,
    currency: 'usd', status: 'paid', method: method.type === 'card' ? 'instant' : 'standard',
    destination: method.label, createdAt: ts, createdIso: iso(ts),
  };
  db.insert('ownerPayouts', po);
  logEvent('owner.payout', { amount, fromProfit, fromBusinesses });
  return { ok: true, payout: po };
}

function setPayoutMethod(method) {
  db.getData().meta.settings.ownerPayoutMethod = method;
  db.save();
  return method;
}

module.exports = { earnings, payout, setPayoutMethod, ownerOwnedMerchants };
