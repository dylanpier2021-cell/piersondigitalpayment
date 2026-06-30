'use strict';

const db = require('./db');
const { logEvent } = require('./merchants');
const { prefixedId, now, iso } = require('./util');

const INTERVALS = ['week', 'month', 'year'];

/**
 * Create a Stripe-style Payment Link. A link can be one-time ("payment") or
 * recurring ("subscription"). `amount` of 0 with allowCustomAmount lets the
 * payer choose what to pay (good for tips, donations, custom invoices).
 */
function createPaymentLink(merchant, input = {}) {
  const mode = input.mode === 'subscription' ? 'subscription' : 'payment';
  const name = String(input.name || '').trim() || 'Payment';
  const allowCustomAmount = !!input.allowCustomAmount && mode === 'payment';
  let amount = Math.round(Number(input.amount) || 0);
  if (!allowCustomAmount && amount < 50) {
    throw { status: 400, message: 'Amount must be at least $0.50 (or enable “let customer choose”).' };
  }
  if (allowCustomAmount) amount = 0;

  let interval = null;
  if (mode === 'subscription') {
    interval = INTERVALS.includes(input.interval) ? input.interval : 'month';
  }

  const ts = now();
  const link = {
    id: prefixedId('plink', 16),
    object: 'payment_link',
    merchantId: merchant.id,
    name,
    mode,
    amount,
    currency: 'usd',
    interval,
    description: String(input.description || '').trim(),
    active: input.active === undefined ? true : !!input.active,
    allowCustomAmount,
    collectName: input.collectName === undefined ? true : !!input.collectName,
    collectEmail: input.collectEmail === undefined ? true : !!input.collectEmail,
    createdAt: ts,
    createdIso: iso(ts),
  };
  db.insert('paymentLinks', link);
  logEvent('payment_link.created', { linkId: link.id, merchantId: merchant.id, mode });
  return link;
}

/** Aggregate basic stats for a link (charges that came through it). */
function linkStats(linkId) {
  const charges = db.find('transactions', (t) => t.paymentLinkId === linkId && t.status !== 'failed');
  return {
    payments: charges.length,
    volume: charges.reduce((s, c) => s + c.amount, 0),
  };
}

/** Owner view (dashboard) — includes stats and the share URL path. */
function linkView(link) {
  if (!link) return null;
  return {
    ...link,
    url: `/pay/${link.id}`,
    stats: linkStats(link.id),
  };
}

/** Public, payer-facing view (no internal flags beyond what checkout needs). */
function publicLinkView(link, merchant) {
  if (!link) return null;
  return {
    id: link.id,
    name: link.name,
    mode: link.mode,
    amount: link.amount,
    currency: link.currency,
    interval: link.interval,
    description: link.description,
    active: link.active,
    allowCustomAmount: link.allowCustomAmount,
    collectName: link.collectName,
    collectEmail: link.collectEmail,
    merchant: merchant
      ? { businessName: merchant.businessName, statementDescriptor: merchant.statementDescriptor, website: merchant.website }
      : null,
  };
}

module.exports = { INTERVALS, createPaymentLink, linkStats, linkView, publicLinkView };
