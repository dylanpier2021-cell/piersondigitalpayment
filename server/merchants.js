'use strict';

const db = require('./db');
const auth = require('./auth');
const { prefixedId, randomId, now, iso } = require('./util');

/** Build a statement descriptor (<=22 chars, like card networks require). */
function makeDescriptor(businessName) {
  const base = String(businessName || 'TRANSFADO')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (base || 'TRANSFADO').slice(0, 22);
}

function generateKeys(mode = 'sandbox') {
  return {
    publishableKey: `pk_${mode}_${randomId(24)}`,
    secretKey: `sk_${mode}_${randomId(24)}`,
  };
}

/**
 * Create a merchant (connected account) plus its owner login user.
 * Throws { status, message } on validation failure.
 */
function createMerchant({ businessName, email, password, contactName, feePlanId, website }) {
  businessName = String(businessName || '').trim();
  email = String(email || '').trim().toLowerCase();
  contactName = String(contactName || '').trim();

  if (!businessName) throw { status: 400, message: 'Business name is required.' };
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw { status: 400, message: 'A valid email is required.' };
  }
  if (!password || String(password).length < 8) {
    throw { status: 400, message: 'Password must be at least 8 characters.' };
  }
  if (auth.findUserByEmail(email)) {
    throw { status: 409, message: 'An account with that email already exists.' };
  }

  const settings = db.getData().meta.settings;
  const plan =
    (feePlanId && db.findById('feePlans', feePlanId)) ||
    (settings.defaultFeePlanId && db.findById('feePlans', settings.defaultFeePlanId)) ||
    db.collection('feePlans')[0] ||
    null;

  const keys = generateKeys('sandbox');
  const ts = now();

  const merchant = {
    id: prefixedId('mer', 18),
    object: 'merchant',
    businessName,
    website: String(website || '').trim(),
    statementDescriptor: makeDescriptor(businessName),
    email,
    contactName,
    feePlanId: plan ? plan.id : null,
    feeOverride: null, // per-merchant rate override (set by admin)
    balance: 0, // available funds in cents
    currency: 'usd',
    status: 'active', // active | suspended
    payoutMethod: null, // where payouts go (debit card or bank account)
    appliedCoupon: null, // attached coupon code that discounts/waives fees
    ownedByOwner: false, // owner's own business — processes at a permanent $0 fee
    publishableKey: keys.publishableKey,
    secretKey: keys.secretKey,
    createdAt: ts,
    createdIso: iso(ts),
  };
  db.insert('merchants', merchant);

  const user = {
    id: prefixedId('usr', 18),
    object: 'user',
    role: 'merchant',
    merchantId: merchant.id,
    name: contactName || businessName,
    email,
    passwordHash: auth.hashPassword(password),
    verified: false,
    createdAt: ts,
  };
  db.insert('users', user);

  logEvent('merchant.created', { merchantId: merchant.id, businessName });

  return { merchant, user };
}

/** Append an event to the audit log. */
function logEvent(type, data) {
  const ts = now();
  db.insert('events', {
    id: prefixedId('evt', 16),
    type,
    data,
    createdAt: ts,
    createdIso: iso(ts),
  });
}

/** Public-safe view of a merchant (no secret key, no internal fields). */
function publicMerchant(m) {
  if (!m) return null;
  return {
    id: m.id,
    object: 'merchant',
    businessName: m.businessName,
    website: m.website,
    statementDescriptor: m.statementDescriptor,
    email: m.email,
    contactName: m.contactName,
    status: m.status,
    publishableKey: m.publishableKey,
    currency: m.currency,
    payoutMethod: m.payoutMethod || null,
    appliedCoupon: m.appliedCoupon || null,
    ownedByOwner: !!m.ownedByOwner,
    createdAt: m.createdAt,
  };
}

module.exports = {
  makeDescriptor,
  generateKeys,
  createMerchant,
  logEvent,
  publicMerchant,
};
