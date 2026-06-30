'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db');
const auth = require('../auth');
const fees = require('../fees');
const charges = require('../charges');
const billing = require('../billing');
const metrics = require('../metrics');
const merchantsSvc = require('../merchants');
const { prefixedId, now, iso } = require('../util');

router.use(auth.requireAdmin);

/** Full rate detail for admin: cost basis, client price, and margin. */
function rateDetail(merchant) {
  const r = fees.resolveRates(merchant, db.collection('feePlans'));
  return {
    planId: r.planId,
    planName: r.planName,
    isCustom: r.isCustom,
    overriddenKeys: r.overriddenKeys,
    cost: { pct: r.rates.costPct, fixed: r.rates.costFixed, label: fees.describeRate(r.rates.costPct, r.rates.costFixed) },
    price: { pct: r.rates.pricePct, fixed: r.rates.priceFixed, label: fees.describeRate(r.rates.pricePct, r.rates.priceFixed) },
    margin: {
      pct: r.rates.pricePct - r.rates.costPct,
      fixed: r.rates.priceFixed - r.rates.costFixed,
      label: fees.describeRate(r.rates.pricePct - r.rates.costPct, r.rates.priceFixed - r.rates.costFixed),
    },
  };
}

function merchantRow(m) {
  const charged = db.find('transactions', (t) => t.merchantId === m.id && t.status !== 'failed');
  let volume = 0;
  let margin = 0;
  for (const c of charged) {
    volume += c.amount - (c.amountRefunded || 0);
    if (c.fees) margin += c.fees.piersonMargin;
  }
  return {
    ...merchantsSvc.publicMerchant(m),
    secretKey: m.secretKey,
    balance: m.balance,
    feePlanId: m.feePlanId,
    feeOverride: m.feeOverride || null,
    rates: rateDetail(m),
    mrr: billing.merchantMrr(m.id),
    volume,
    margin,
    chargeCount: charged.length,
  };
}

// ---- Overview -----------------------------------------------------------

router.get('/overview', (req, res) => {
  res.json({
    metrics: metrics.platformMetrics(),
    settings: db.getData().meta.settings,
    feePlans: db.collection('feePlans'),
  });
});

// ---- Merchants ----------------------------------------------------------

router.get('/merchants', (req, res) => {
  const list = db
    .collection('merchants')
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(merchantRow);
  res.json({ data: list });
});

router.get('/merchants/:id', (req, res) => {
  const m = db.findById('merchants', req.params.id);
  if (!m) return res.status(404).json({ error: { message: 'Merchant not found.' } });
  res.json({
    merchant: merchantRow(m),
    metrics: metrics.merchantMetrics(m.id),
    transactions: db
      .find('transactions', (t) => t.merchantId === m.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 25)
      .map(charges.chargeView),
    subscriptions: db.find('subscriptions', (s) => s.merchantId === m.id).map(billing.subscriptionView),
  });
});

router.patch('/merchants/:id', (req, res) => {
  const m = db.findById('merchants', req.params.id);
  if (!m) return res.status(404).json({ error: { message: 'Merchant not found.' } });
  const b = req.body || {};
  const patch = {};

  if (b.status && ['active', 'suspended'].includes(b.status)) patch.status = b.status;
  if (b.feePlanId !== undefined) {
    if (b.feePlanId && !db.findById('feePlans', b.feePlanId)) {
      return res.status(400).json({ error: { message: 'Unknown fee plan.' } });
    }
    patch.feePlanId = b.feePlanId || null;
  }

  if (b.feeOverride !== undefined) {
    if (b.feeOverride === null) {
      patch.feeOverride = null;
    } else {
      const o = {};
      for (const k of ['costPct', 'costFixed', 'pricePct', 'priceFixed']) {
        if (b.feeOverride[k] !== undefined && b.feeOverride[k] !== '' && b.feeOverride[k] !== null) {
          const n = Math.round(Number(b.feeOverride[k]));
          if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: { message: `Invalid ${k}.` } });
          o[k] = n;
        }
      }
      patch.feeOverride = Object.keys(o).length ? o : null;
    }
  }

  db.update('merchants', m.id, patch);
  merchantsSvc.logEvent('merchant.updated', { merchantId: m.id, fields: Object.keys(patch) });
  res.json({ ok: true, merchant: merchantRow(db.findById('merchants', m.id)) });
});

// ---- Fee plans ----------------------------------------------------------

function validatePlanInput(b) {
  const fields = ['costPct', 'costFixed', 'pricePct', 'priceFixed'];
  const out = {};
  for (const f of fields) {
    const n = Math.round(Number(b[f]));
    if (!Number.isFinite(n) || n < 0) throw { status: 400, message: `Invalid ${f}.` };
    out[f] = n;
  }
  return out;
}

router.get('/fee-plans', (req, res) => {
  res.json({ data: db.collection('feePlans') });
});

router.post('/fee-plans', (req, res) => {
  try {
    const b = req.body || {};
    const rates = validatePlanInput(b);
    const ts = now();
    const plan = {
      id: prefixedId('plan', 12),
      object: 'fee_plan',
      name: String(b.name || '').trim() || 'Untitled plan',
      description: String(b.description || '').trim(),
      ...rates,
      createdAt: ts,
      createdIso: iso(ts),
    };
    db.insert('feePlans', plan);
    res.json({ ok: true, plan });
  } catch (err) {
    res.status(err.status || 400).json({ error: { message: err.message } });
  }
});

router.patch('/fee-plans/:id', (req, res) => {
  const plan = db.findById('feePlans', req.params.id);
  if (!plan) return res.status(404).json({ error: { message: 'Plan not found.' } });
  const b = req.body || {};
  const patch = {};
  if (b.name !== undefined) patch.name = String(b.name).trim();
  if (b.description !== undefined) patch.description = String(b.description).trim();
  for (const f of ['costPct', 'costFixed', 'pricePct', 'priceFixed']) {
    if (b[f] !== undefined) {
      const n = Math.round(Number(b[f]));
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: { message: `Invalid ${f}.` } });
      patch[f] = n;
    }
  }
  db.update('feePlans', plan.id, patch);
  res.json({ ok: true, plan: db.findById('feePlans', plan.id) });
});

router.delete('/fee-plans/:id', (req, res) => {
  const plan = db.findById('feePlans', req.params.id);
  if (!plan) return res.status(404).json({ error: { message: 'Plan not found.' } });
  const inUse = db.find('merchants', (m) => m.feePlanId === plan.id);
  if (inUse.length) {
    return res.status(400).json({ error: { message: `Plan is assigned to ${inUse.length} merchant(s).` } });
  }
  const settings = db.getData().meta.settings;
  if (settings.defaultFeePlanId === plan.id) settings.defaultFeePlanId = null;
  db.remove('feePlans', plan.id);
  db.save();
  res.json({ ok: true });
});

// ---- Settings -----------------------------------------------------------

router.patch('/settings', (req, res) => {
  const settings = db.getData().meta.settings;
  const b = req.body || {};
  if (b.platformName !== undefined) settings.platformName = String(b.platformName).trim() || 'Pierson Pay';
  if (b.defaultFeePlanId !== undefined) {
    if (b.defaultFeePlanId && !db.findById('feePlans', b.defaultFeePlanId)) {
      return res.status(400).json({ error: { message: 'Unknown fee plan.' } });
    }
    settings.defaultFeePlanId = b.defaultFeePlanId || null;
  }
  if (b.payoutHoldDays !== undefined) settings.payoutHoldDays = Math.max(0, Math.round(Number(b.payoutHoldDays)) || 0);
  db.save();
  res.json({ ok: true, settings });
});

// ---- All transactions ---------------------------------------------------

router.get('/transactions', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const list = db
    .collection('transactions')
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((t) => {
      const m = db.findById('merchants', t.merchantId);
      return { ...charges.chargeView(t), merchantName: m ? m.businessName : 'Unknown', merchantId: t.merchantId };
    });
  res.json({ data: list });
});

// ---- Billing controls ---------------------------------------------------

router.post('/billing/run', (req, res) => {
  const summary = billing.processDueSubscriptions();
  res.json({ ok: true, ...summary });
});

router.get('/events', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const list = db.collection('events').slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  res.json({ data: list });
});

module.exports = router;
