'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db');
const charges = require('../charges');
const billing = require('../billing');
const links = require('../links');
const cards = require('../cards');

/** Fetch the public view of a payment link for the hosted checkout page. */
router.get('/payment-links/:id', (req, res) => {
  const link = db.findById('paymentLinks', req.params.id);
  if (!link) return res.status(404).json({ error: { message: 'This payment link does not exist.' } });
  const merchant = db.findById('merchants', link.merchantId);
  if (!link.active || !merchant || merchant.status === 'suspended') {
    return res.status(410).json({ error: { message: 'This payment link is no longer active.' } });
  }
  res.json(links.publicLinkView(link, merchant));
});

/** Pay a payment link (one-time charge or new subscription). */
router.post('/payment-links/:id/pay', (req, res) => {
  const link = db.findById('paymentLinks', req.params.id);
  if (!link) return res.status(404).json({ error: { message: 'This payment link does not exist.' } });
  const merchant = db.findById('merchants', link.merchantId);
  if (!link.active || !merchant || merchant.status === 'suspended') {
    return res.status(410).json({ error: { message: 'This payment link is no longer active.' } });
  }

  const b = req.body || {};
  const amount = link.allowCustomAmount ? Math.round(Number(b.amount)) : link.amount;
  const card = {
    number: b.card && b.card.number,
    exp_month: b.card && b.card.exp_month,
    exp_year: b.card && b.card.exp_year,
    cvc: b.card && b.card.cvc,
    name: (b.card && b.card.name) || b.customerName,
  };
  const customer = { name: b.customerName, email: b.customerEmail };

  if (link.mode === 'subscription') {
    const result = billing.createSubscription({
      merchant,
      productName: link.name,
      amountCents: amount,
      interval: link.interval,
      customer,
      card,
      source: 'payment_link',
      paymentLinkId: link.id,
    });
    if (!result.ok) return res.status(402).json({ error: result.error });
    return res.json({
      ok: true,
      mode: 'subscription',
      receipt: receiptView(result.transaction, merchant, link, result.subscription),
    });
  }

  const result = charges.createCharge({
    merchant,
    amountCents: amount,
    description: link.name,
    customer,
    card,
    source: 'payment_link',
    paymentLinkId: link.id,
  });
  if (!result.ok) return res.status(402).json({ error: result.error });
  res.json({ ok: true, mode: 'payment', receipt: receiptView(result.transaction, merchant, link) });
});

function receiptView(txn, merchant, link, subscription) {
  return {
    id: txn.id,
    amount: txn.amount,
    currency: txn.currency,
    card: txn.card,
    description: txn.description,
    businessName: merchant.businessName,
    statementDescriptor: merchant.statementDescriptor,
    interval: subscription ? subscription.interval : null,
    nextBillingAt: subscription ? subscription.nextBillingAt : null,
    createdIso: txn.createdIso,
  };
}

/** Test cards the sandbox accepts, surfaced on the checkout page as a hint. */
router.get('/test-cards', (req, res) => {
  res.json({
    approved: ['4242 4242 4242 4242', '5555 5555 5555 4444', '3782 822463 10005'],
    declined: { '4000 0000 0000 0002': 'generic decline', '4000 0000 0000 9995': 'insufficient funds' },
    note: 'Use any future expiry and any 3-digit CVC (4 for Amex).',
  });
});

module.exports = router;
