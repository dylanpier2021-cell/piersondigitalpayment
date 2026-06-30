'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db');
const auth = require('../auth');
const fees = require('../fees');
const charges = require('../charges');
const billing = require('../billing');
const links = require('../links');
const merchantsSvc = require('../merchants');
const metrics = require('../metrics');
const { prefixedId, now, iso } = require('../util');

// Every route here requires an authenticated, active merchant.
router.use(auth.requireMerchant);

function resolvedRates(merchant) {
  const r = fees.resolveRates(merchant, db.collection('feePlans'));
  return {
    planName: r.planName,
    isCustom: r.isCustom,
    price: { pct: r.rates.pricePct, fixed: r.rates.priceFixed, label: fees.describeRate(r.rates.pricePct, r.rates.priceFixed) },
    // Merchants see what they pay; cost basis/margin stays internal to Pierson.
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

router.get('/transactions', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const list = db
    .find('transactions', (t) => t.merchantId === req.merchant.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(charges.chargeView);
  res.json({ data: list });
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
  res.json({ data: list, balance: req.merchant.balance });
});

router.post('/payouts', (req, res) => {
  const amount = Math.round(Number(req.body && req.body.amount));
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: { message: 'Invalid amount.' } });
  if (amount > req.merchant.balance) return res.status(400).json({ error: { message: 'Amount exceeds available balance.' } });
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
    method: 'standard',
    destination: 'Bank account ••••6789',
    createdAt: ts,
    createdIso: iso(ts),
  };
  db.insert('payouts', payout);
  db.update('merchants', req.merchant.id, { balance: newBalance });
  merchantsSvc.logEvent('payout.created', { payoutId: payout.id, merchantId: req.merchant.id, amount });
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

module.exports = router;
