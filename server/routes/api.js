'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db');
const auth = require('../auth');
const charges = require('../charges');
const billing = require('../billing');
const links = require('../links');
const merchantsSvc = require('../merchants');

// Authenticate every /v1 request with an API key.
router.use(auth.requireApiKey);

/** Pull a card object from a flexible request body (card{} or source{}). */
function cardFrom(b) {
  const c = b.card || b.source || {};
  return {
    number: c.number,
    exp_month: c.exp_month || c.expMonth,
    exp_year: c.exp_year || c.expYear,
    cvc: c.cvc,
    name: c.name || b.customer_name,
  };
}

router.get('/account', (req, res) => {
  res.json({ ...merchantsSvc.publicMerchant(req.merchant), balance: req.merchant.balance });
});

router.get('/balance', (req, res) => {
  res.json({ object: 'balance', available: req.merchant.balance, currency: req.merchant.currency });
});

// ---- Charges ------------------------------------------------------------

router.post('/charges', (req, res) => {
  const b = req.body || {};
  const result = charges.createCharge({
    merchant: req.merchant,
    amountCents: Math.round(Number(b.amount)),
    currency: b.currency || 'usd',
    description: b.description || '',
    customer: { name: b.customer_name, email: b.customer_email || b.receipt_email },
    card: cardFrom(b),
    source: 'api',
    metadata: b.metadata || {},
  });
  if (!result.ok) {
    return res.status(402).json({ error: { type: 'card_error', code: result.error.code, message: result.error.message } });
  }
  res.status(201).json(charges.chargeView(result.transaction));
});

router.get('/charges', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const data = db
    .find('transactions', (t) => t.merchantId === req.merchant.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(charges.chargeView);
  res.json({ object: 'list', data, has_more: false });
});

router.get('/charges/:id', (req, res) => {
  const t = db.findById('transactions', req.params.id);
  if (!t || t.merchantId !== req.merchant.id) {
    return res.status(404).json({ error: { type: 'invalid_request_error', message: 'No such charge.' } });
  }
  res.json(charges.chargeView(t));
});

// ---- Refunds ------------------------------------------------------------

router.post('/refunds', (req, res) => {
  const b = req.body || {};
  const t = db.findById('transactions', b.charge);
  if (!t || t.merchantId !== req.merchant.id) {
    return res.status(404).json({ error: { type: 'invalid_request_error', message: 'No such charge.' } });
  }
  const amount = b.amount != null ? Math.round(Number(b.amount)) : null;
  const result = charges.refundCharge(t.id, amount);
  if (!result.ok) return res.status(400).json({ error: { type: 'invalid_request_error', message: result.error.message } });
  res.status(201).json(charges.chargeView(result.transaction));
});

// ---- Subscriptions ------------------------------------------------------

router.post('/subscriptions', (req, res) => {
  const b = req.body || {};
  const result = billing.createSubscription({
    merchant: req.merchant,
    productName: b.product_name || b.description,
    amountCents: Math.round(Number(b.amount)),
    interval: b.interval || 'month',
    customer: { name: b.customer_name, email: b.customer_email },
    card: cardFrom(b),
    source: 'api',
    metadata: b.metadata || {},
  });
  if (!result.ok) {
    return res.status(402).json({ error: { type: 'card_error', code: result.error.code, message: result.error.message } });
  }
  res.status(201).json(billing.subscriptionView(result.subscription));
});

router.get('/subscriptions', (req, res) => {
  const data = db
    .find('subscriptions', (s) => s.merchantId === req.merchant.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(billing.subscriptionView);
  res.json({ object: 'list', data, has_more: false });
});

router.post('/subscriptions/:id/cancel', (req, res) => {
  const s = db.findById('subscriptions', req.params.id);
  if (!s || s.merchantId !== req.merchant.id) {
    return res.status(404).json({ error: { type: 'invalid_request_error', message: 'No such subscription.' } });
  }
  const result = billing.cancelSubscription(s.id);
  res.json(billing.subscriptionView(result.subscription));
});

// ---- Payment links ------------------------------------------------------

router.post('/payment_links', (req, res) => {
  try {
    const b = req.body || {};
    const link = links.createPaymentLink(req.merchant, {
      name: b.name,
      mode: b.mode,
      amount: b.amount,
      interval: b.interval,
      description: b.description,
      allowCustomAmount: b.allow_custom_amount,
    });
    const base = `${req.protocol}://${req.get('host')}`;
    res.status(201).json({ ...links.linkView(link), url: `${base}/pay/${link.id}` });
  } catch (err) {
    res.status(err.status || 400).json({ error: { type: 'invalid_request_error', message: err.message } });
  }
});

router.get('/payment_links', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const data = db
    .find('paymentLinks', (l) => l.merchantId === req.merchant.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((l) => ({ ...links.linkView(l), url: `${base}/pay/${l.id}` }));
  res.json({ object: 'list', data, has_more: false });
});

module.exports = router;
