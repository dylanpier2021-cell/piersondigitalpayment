'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db');
const auth = require('../auth');
const fees = require('../fees');
const charges = require('../charges');
const billing = require('../billing');
const links = require('../links');
const cards = require('../cards');
const coupons = require('../coupons');
const notifications = require('../notifications');
const webhooks = require('../webhooks');
const merchantsSvc = require('../merchants');
const metrics = require('../metrics');
const { prefixedId, now, iso, formatMoney } = require('../util');

const BRAND_LABEL = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', discover: 'Discover', unknown: 'Card' };

/**
 * Validate + build a safe payout method (debit card or bank account).
 * Only last4 / brand / routing are stored — never the full card or account number.
 * Throws { status, message } on invalid input.
 */
function buildPayoutMethod(input = {}) {
  const type = input.type === 'card' ? 'card' : 'bank';

  if (type === 'card') {
    const number = String(input.number || '').replace(/\D/g, '');
    if (!cards.luhnValid(number)) throw { status: 400, message: 'Enter a valid debit card number.' };
    const month = Number(input.exp_month);
    const year = Number(input.exp_year);
    if (!month || month < 1 || month > 12) throw { status: 400, message: 'Enter a valid expiry month.' };
    if (!year) throw { status: 400, message: 'Enter a valid expiry year.' };
    const fullYear = year < 100 ? 2000 + year : year;
    const brand = cards.detectBrand(number);
    const last4 = number.slice(-4);
    return {
      type: 'card',
      brand,
      last4,
      expMonth: month,
      expYear: fullYear,
      holderName: String(input.name || '').trim(),
      label: `${BRAND_LABEL[brand] || 'Card'} debit ••${last4}`,
    };
  }

  // Bank account (ACH).
  const account = String(input.accountNumber || '').replace(/\D/g, '');
  const routing = String(input.routingNumber || '').replace(/\D/g, '');
  if (account.length < 4) throw { status: 400, message: 'Enter a valid account number.' };
  if (routing.length !== 9) throw { status: 400, message: 'Routing number must be 9 digits.' };
  const last4 = account.slice(-4);
  const bankName = String(input.bankName || '').trim();
  return {
    type: 'bank',
    bankName,
    last4,
    routing,
    holderName: String(input.name || '').trim(),
    label: `${bankName || 'Bank account'} ••${last4}`,
  };
}

// Every route here requires an authenticated, active merchant.
router.use(auth.requireMerchant);

function resolvedRates(merchant) {
  const r = fees.resolveRates(merchant, db.collection('feePlans'));
  const coupon = coupons.activeForMerchant(merchant);
  const waived = !!(coupon && coupon.type === 'fee_waiver');
  return {
    planName: r.planName,
    isCustom: r.isCustom,
    price: { pct: r.rates.pricePct, fixed: r.rates.priceFixed, label: fees.describeRate(r.rates.pricePct, r.rates.priceFixed) },
    coupon: coupon ? { code: coupon.code, label: coupons.label(coupon), waived } : null,
    // Merchants see what they pay; cost basis/margin stays internal to the platform.
  };
}

// ---- Overview -----------------------------------------------------------

router.get('/overview', (req, res) => {
  const m = req.merchant;
  res.json({
    merchant: merchantsSvc.publicMerchant(m),
    metrics: metrics.merchantMetrics(m.id),
    rates: resolvedRates(m),
    recentTransactions: db
      .find('transactions', (t) => t.merchantId === m.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10)
      .map(charges.chargeView),
  });
});

router.get('/fees', (req, res) => {
  res.json(resolvedRates(req.merchant));
});

// ---- Transactions -------------------------------------------------------

function filterTransactions(merchantId, q) {
  const text = String(q.q || '').toLowerCase().trim();
  const status = q.status && q.status !== 'all' ? q.status : null;
  const source = q.source && q.source !== 'all' ? q.source : null;
  const from = q.from ? Date.parse(q.from) : null;
  const to = q.to ? Date.parse(q.to) + 86400000 : null; // inclusive day
  return db
    .find('transactions', (t) => t.merchantId === merchantId)
    .filter((t) => {
      if (status && t.status !== status) return false;
      if (source && t.source !== source) return false;
      if (from && t.createdAt < from) return false;
      if (to && t.createdAt >= to) return false;
      if (text) {
        const hay = `${t.description || ''} ${t.customer && t.customer.email || ''} ${t.customer && t.customer.name || ''} ${t.id} ${t.card && t.card.last4 || ''}`.toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

router.get('/transactions', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const list = filterTransactions(req.merchant.id, req.query).slice(0, limit).map(charges.chargeView);
  res.json({ data: list });
});

function csv(rows) {
  const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

router.get('/transactions.csv', (req, res) => {
  const rows = [['id', 'date', 'amount', 'currency', 'status', 'fee', 'net', 'description', 'customer_email', 'card_brand', 'card_last4', 'source']];
  filterTransactions(req.merchant.id, req.query).forEach((t) => rows.push([
    t.id, t.createdIso, (t.amount / 100).toFixed(2), t.currency, t.status,
    t.fees ? (t.fees.merchantFee / 100).toFixed(2) : '', t.fees ? (t.fees.merchantNet / 100).toFixed(2) : '',
    t.description || '', t.customer && t.customer.email || '', t.card && t.card.brand || '', t.card && t.card.last4 || '', t.source,
  ]));
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="transactions.csv"').send(csv(rows));
});

router.get('/payouts.csv', (req, res) => {
  const rows = [['id', 'date', 'amount', 'currency', 'status', 'method', 'destination']];
  db.find('payouts', (p) => p.merchantId === req.merchant.id).sort((a, b) => b.createdAt - a.createdAt)
    .forEach((p) => rows.push([p.id, p.createdIso, (p.amount / 100).toFixed(2), p.currency, p.status, p.method, p.destination]));
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="payouts.csv"').send(csv(rows));
});

router.get('/transactions/:id', (req, res) => {
  const t = db.findById('transactions', req.params.id);
  if (!t || t.merchantId !== req.merchant.id) return res.status(404).json({ error: { message: 'Not found.' } });
  res.json(charges.chargeView(t));
});

// Virtual terminal: charge a card directly.
router.post('/charges', (req, res) => {
  const b = req.body || {};
  const result = charges.createCharge({
    merchant: req.merchant,
    amountCents: Math.round(Number(b.amount)),
    description: b.description || '',
    customer: { name: b.customerName, email: b.customerEmail },
    card: {
      number: b.card && b.card.number,
      exp_month: b.card && b.card.exp_month,
      exp_year: b.card && b.card.exp_year,
      cvc: b.card && b.card.cvc,
      name: (b.card && b.card.name) || b.customerName,
    },
    source: 'terminal',
  });
  if (!result.ok) return res.status(402).json({ error: result.error, charge: result.transaction ? charges.chargeView(result.transaction) : null });
  res.json({ ok: true, charge: charges.chargeView(result.transaction) });
});

router.post('/charges/:id/refund', (req, res) => {
  const t = db.findById('transactions', req.params.id);
  if (!t || t.merchantId !== req.merchant.id) return res.status(404).json({ error: { message: 'Not found.' } });
  const amount = req.body && req.body.amount != null ? Math.round(Number(req.body.amount)) : null;
  const result = charges.refundCharge(t.id, amount);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, charge: charges.chargeView(result.transaction) });
});

// ---- Subscriptions ------------------------------------------------------

router.get('/subscriptions', (req, res) => {
  const list = db
    .find('subscriptions', (s) => s.merchantId === req.merchant.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(billing.subscriptionView);
  res.json({ data: list });
});

router.post('/subscriptions', (req, res) => {
  const b = req.body || {};
  const result = billing.createSubscription({
    merchant: req.merchant,
    productName: b.productName,
    amountCents: Math.round(Number(b.amount)),
    interval: b.interval,
    customer: { name: b.customerName, email: b.customerEmail },
    card: {
      number: b.card && b.card.number,
      exp_month: b.card && b.card.exp_month,
      exp_year: b.card && b.card.exp_year,
      cvc: b.card && b.card.cvc,
      name: (b.card && b.card.name) || b.customerName,
    },
    source: 'terminal',
  });
  if (!result.ok) return res.status(402).json({ error: result.error });
  res.json({ ok: true, subscription: billing.subscriptionView(result.subscription), charge: charges.chargeView(result.transaction) });
});

router.post('/subscriptions/:id/cancel', (req, res) => {
  const s = db.findById('subscriptions', req.params.id);
  if (!s || s.merchantId !== req.merchant.id) return res.status(404).json({ error: { message: 'Not found.' } });
  const result = billing.cancelSubscription(s.id);
  res.json({ ok: true, subscription: billing.subscriptionView(result.subscription) });
});

// ---- Payment links ------------------------------------------------------

router.get('/payment-links', (req, res) => {
  const list = db
    .find('paymentLinks', (l) => l.merchantId === req.merchant.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(links.linkView);
  res.json({ data: list });
});

router.post('/payment-links', (req, res) => {
  try {
    const link = links.createPaymentLink(req.merchant, req.body || {});
    res.json({ ok: true, link: links.linkView(link) });
  } catch (err) {
    res.status(err.status || 400).json({ error: { message: err.message || 'Could not create link.' } });
  }
});

router.patch('/payment-links/:id', (req, res) => {
  const l = db.findById('paymentLinks', req.params.id);
  if (!l || l.merchantId !== req.merchant.id) return res.status(404).json({ error: { message: 'Not found.' } });
  const patch = {};
  if (req.body.active !== undefined) patch.active = !!req.body.active;
  if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
  if (req.body.description !== undefined) patch.description = String(req.body.description).trim();
  db.update('paymentLinks', l.id, patch);
  res.json({ ok: true, link: links.linkView(db.findById('paymentLinks', l.id)) });
});

router.delete('/payment-links/:id', (req, res) => {
  const l = db.findById('paymentLinks', req.params.id);
  if (!l || l.merchantId !== req.merchant.id) return res.status(404).json({ error: { message: 'Not found.' } });
  db.remove('paymentLinks', l.id);
  res.json({ ok: true });
});

// ---- Payouts ------------------------------------------------------------

router.get('/payouts', (req, res) => {
  const list = db
    .find('payouts', (p) => p.merchantId === req.merchant.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json({ data: list, balance: req.merchant.balance, payoutMethod: req.merchant.payoutMethod || null });
});

// Save / update where payouts go (debit card or bank account).
router.put('/payout-method', (req, res) => {
  try {
    const method = buildPayoutMethod(req.body || {});
    db.update('merchants', req.merchant.id, { payoutMethod: method });
    merchantsSvc.logEvent('payout_method.updated', { merchantId: req.merchant.id, type: method.type });
    res.json({ ok: true, payoutMethod: method });
  } catch (err) {
    res.status(err.status || 400).json({ error: { message: err.message || 'Could not save payout method.' } });
  }
});

router.delete('/payout-method', (req, res) => {
  db.update('merchants', req.merchant.id, { payoutMethod: null });
  res.json({ ok: true });
});

router.post('/payouts', (req, res) => {
  const amount = Math.round(Number(req.body && req.body.amount));
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: { message: 'Invalid amount.' } });
  if (amount > req.merchant.balance) return res.status(400).json({ error: { message: 'Amount exceeds available balance.' } });

  const method = req.merchant.payoutMethod;
  if (!method) {
    return res.status(400).json({ error: { message: 'Add a payout method before paying out.', code: 'no_payout_method' } });
  }

  const ts = now();
  // Capture the new balance BEFORE mutating: req.merchant is the same object
  // reference the DB stores, so db.update() changes req.merchant.balance in place.
  const newBalance = req.merchant.balance - amount;
  const payout = {
    id: prefixedId('po', 18),
    object: 'payout',
    merchantId: req.merchant.id,
    amount,
    currency: 'usd',
    status: 'paid',
    method: method.type === 'card' ? 'instant' : 'standard',
    destination: method.label,
    destinationType: method.type,
    createdAt: ts,
    createdIso: iso(ts),
  };
  db.insert('payouts', payout);
  db.update('merchants', req.merchant.id, { balance: newBalance });
  merchantsSvc.logEvent('payout.created', { payoutId: payout.id, merchantId: req.merchant.id, amount });
  notifications.notify(req.merchant.id, 'payout_sent', 'Payout sent', `${formatMoney(amount)} to ${payout.destination}`, { data: { payoutId: payout.id } });
  try { webhooks.dispatch(req.merchant.id, 'payout.created', payout); } catch (e) {}
  res.json({ ok: true, payout, balance: newBalance });
});

// ---- API keys -----------------------------------------------------------

router.get('/api-keys', (req, res) => {
  res.json({ publishableKey: req.merchant.publishableKey, secretKey: req.merchant.secretKey });
});

router.post('/api-keys/rotate', (req, res) => {
  const next = merchantsSvc.generateKeys('sandbox');
  db.update('merchants', req.merchant.id, { secretKey: next.secretKey });
  res.json({ ok: true, secretKey: next.secretKey, publishableKey: req.merchant.publishableKey });
});

// ---- Settings -----------------------------------------------------------

router.patch('/settings', (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.businessName !== undefined) patch.businessName = String(b.businessName).trim();
  if (b.website !== undefined) patch.website = String(b.website).trim();
  if (b.contactName !== undefined) patch.contactName = String(b.contactName).trim();
  if (b.statementDescriptor !== undefined) {
    patch.statementDescriptor = merchantsSvc.makeDescriptor(b.statementDescriptor);
  }
  db.update('merchants', req.merchant.id, patch);
  res.json({ ok: true, merchant: merchantsSvc.publicMerchant(db.findById('merchants', req.merchant.id)) });
});

// ---- Coupons ------------------------------------------------------------

router.post('/coupons/redeem', (req, res) => {
  const code = req.body && req.body.code;
  const v = coupons.validate(code, req.merchant.id);
  if (!v.ok) return res.status(400).json({ error: { message: v.message } });
  if (req.merchant.appliedCoupon !== v.coupon.code) coupons.claim(v.coupon);
  db.update('merchants', req.merchant.id, { appliedCoupon: v.coupon.code });
  res.json({ ok: true, coupon: { code: v.coupon.code, label: coupons.label(v.coupon) }, rates: resolvedRates(db.findById('merchants', req.merchant.id)) });
});

router.delete('/coupons', (req, res) => {
  db.update('merchants', req.merchant.id, { appliedCoupon: null });
  res.json({ ok: true });
});

// ---- Notifications ------------------------------------------------------

router.get('/notifications', (req, res) => {
  res.json({ data: notifications.list(req.merchant.id, 60), unread: notifications.unreadCount(req.merchant.id) });
});
router.post('/notifications/read', (req, res) => {
  notifications.markAllRead(req.merchant.id);
  res.json({ ok: true });
});

// ---- Webhooks -----------------------------------------------------------

router.get('/webhooks', (req, res) => {
  res.json({
    data: db.find('webhooks', (w) => w.merchantId === req.merchant.id).map(webhooks.endpointView),
    deliveries: webhooks.deliveries(req.merchant.id, 30),
    eventTypes: webhooks.EVENT_TYPES,
  });
});
router.post('/webhooks', (req, res) => {
  const url = String(req.body && req.body.url || '').trim();
  if (!/^https?:\/\/.+/.test(url)) return res.status(400).json({ error: { message: 'Enter a valid URL.' } });
  const ep = webhooks.createEndpoint(req.merchant.id, url, req.body && req.body.events);
  res.json({ ok: true, endpoint: webhooks.endpointView(ep) });
});
router.post('/webhooks/:id/test', (req, res) => {
  const ep = db.findById('webhooks', req.params.id);
  if (!ep || ep.merchantId !== req.merchant.id) return res.status(404).json({ error: { message: 'Not found.' } });
  const d = webhooks.recordDelivery(ep, 'charge.succeeded', { id: 'ch_test_123', object: 'charge', amount: 2500, currency: 'usd', status: 'succeeded' });
  res.json({ ok: true, delivery: d });
});
router.delete('/webhooks/:id', (req, res) => {
  const ep = db.findById('webhooks', req.params.id);
  if (!ep || ep.merchantId !== req.merchant.id) return res.status(404).json({ error: { message: 'Not found.' } });
  db.remove('webhooks', ep.id);
  res.json({ ok: true });
});

module.exports = router;
