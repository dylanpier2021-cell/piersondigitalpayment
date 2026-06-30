'use strict';

const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const fees = require('./fees');
const merchantsSvc = require('./merchants');
const billing = require('./billing');
const { prefixedId, randomId, now, iso } = require('./util');

const DAY = 24 * 60 * 60 * 1000;

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function choice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const CARD_BRANDS = [
  { brand: 'visa', last4: '4242' },
  { brand: 'visa', last4: '1881' },
  { brand: 'mastercard', last4: '4444' },
  { brand: 'amex', last4: '0005' },
  { brand: 'discover', last4: '1117' },
];

const FIRST_NAMES = ['James', 'Maria', 'David', 'Ashley', 'Michael', 'Jessica', 'Chris', 'Amanda', 'Robert', 'Lisa', 'Kevin', 'Nicole'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Martinez', 'Wilson'];

function randomCustomer() {
  const first = choice(FIRST_NAMES);
  const last = choice(LAST_NAMES);
  return { name: `${first} ${last}`, email: `${first}.${last}@example.com`.toLowerCase() };
}

/** Build a historical charge record directly (so we control the timestamp). */
function makeHistoricalCharge(merchant, amount, createdAt, opts = {}) {
  const coupon = require('./coupons').activeForMerchant(merchant);
  const q = fees.quote(amount, merchant, db.collection('feePlans'), coupon);
  const card = choice(CARD_BRANDS);
  const customer = opts.customer || randomCustomer();
  const status = opts.status || 'succeeded';
  const amountRefunded = status === 'refunded' ? amount : status === 'partially_refunded' ? Math.round(amount / 2) : 0;

  return {
    id: prefixedId('ch', 20),
    object: 'charge',
    merchantId: merchant.id,
    amount,
    currency: 'usd',
    status,
    paid: true,
    description: opts.description || choice(['Order', 'Invoice', 'Service', 'Booking', 'Purchase']) + ' #' + randInt(1000, 9999),
    statementDescriptor: merchant.statementDescriptor,
    customer,
    card: { brand: card.brand, last4: card.last4, expMonth: randInt(1, 12), expYear: 2030 },
    fees: {
      merchantFee: q.merchantFee,
      processorCost: q.processorCost,
      piersonMargin: q.piersonMargin,
      merchantNet: q.merchantNet,
    },
    rates: q.rates,
    amountRefunded,
    authCode: prefixedId('', 6).toUpperCase().replace('_', ''),
    source: opts.source || choice(['terminal', 'checkout', 'api', 'payment_link']),
    subscriptionId: opts.subscriptionId || null,
    paymentLinkId: opts.paymentLinkId || null,
    coupon: q.couponApplied || null,
    couponWaived: !!q.couponWaived,
    metadata: {},
    createdAt,
    createdIso: iso(createdAt),
  };
}

function buildMerchant(def, ts) {
  const keys = merchantsSvc.generateKeys('sandbox');
  const merchant = {
    id: prefixedId('mer', 18),
    object: 'merchant',
    businessName: def.businessName,
    website: def.website || '',
    statementDescriptor: merchantsSvc.makeDescriptor(def.businessName),
    email: def.email,
    contactName: def.contactName || '',
    feePlanId: def.feePlanId,
    feeOverride: def.feeOverride || null,
    balance: 0,
    currency: 'usd',
    status: def.status || 'active',
    payoutMethod: def.payoutMethod || null,
    appliedCoupon: def.appliedCoupon || null,
    publishableKey: keys.publishableKey,
    secretKey: keys.secretKey,
    createdAt: ts,
    createdIso: iso(ts),
  };
  db.insert('merchants', merchant);
  db.insert('users', {
    id: prefixedId('usr', 18),
    object: 'user',
    role: 'merchant',
    merchantId: merchant.id,
    name: def.contactName || def.businessName,
    email: def.email,
    passwordHash: auth.hashPassword(def.password),
    createdAt: ts,
  });
  return merchant;
}

function seed() {
  // Reset everything.
  const fresh = JSON.parse(JSON.stringify(db.EMPTY));
  fresh.meta.createdAt = iso();
  db.replaceAll(fresh);

  // ---- Fee plans (cost basis vs. client price = platform margin) ----
  // Public flat rate is 2.5% + $0.10, beating every major processor.
  // Cost basis sits near interchange (~1.8% + $0.08) so margin stays positive.
  const plans = [
    { name: 'Transfado Flat', description: 'The public flat rate — lower than everyone.', costPct: 180, costFixed: 8, pricePct: 250, priceFixed: 10 },
    { name: 'Transfado Plus', description: 'Higher-volume clients.', costPct: 170, costFixed: 7, pricePct: 230, priceFixed: 10 },
    { name: 'Transfado Nonprofit', description: 'Discounted rate for nonprofits.', costPct: 160, costFixed: 8, pricePct: 200, priceFixed: 10 },
  ].map((p) => {
    const ts = now();
    const plan = { id: prefixedId('plan', 12), object: 'fee_plan', ...p, createdAt: ts, createdIso: iso(ts) };
    db.insert('feePlans', plan);
    return plan;
  });

  const settings = db.getData().meta.settings;
  settings.defaultFeePlanId = plans[0].id;
  settings.platformName = 'Transfado';
  db.save();

  // ---- Admin (platform owner) ----
  db.insert('users', {
    id: prefixedId('usr', 18),
    object: 'user',
    role: 'admin',
    merchantId: null,
    name: 'Transfado',
    email: config.ADMIN_EMAIL.toLowerCase(),
    passwordHash: auth.hashPassword(config.ADMIN_PASSWORD),
    createdAt: now(),
  });

  // ---- Coupons (incl. a built-in FREE fee-waiver) ----
  const couponDefs = [
    { code: 'FREE', type: 'fee_waiver', value: 0, maxRedemptions: null, redemptions: 1 },
    { code: 'LAUNCH50', type: 'percent_off', value: 5000, maxRedemptions: 500, redemptions: 37 },
    { code: 'SAVE10', type: 'fixed_off', value: 10, maxRedemptions: null, redemptions: 12 },
  ];
  couponDefs.forEach((c) => {
    const ts = now();
    db.insert('coupons', { id: prefixedId('cpn', 14), object: 'coupon', code: c.code, type: c.type, value: c.value, scope: 'platform', merchantId: null, maxRedemptions: c.maxRedemptions, redemptions: c.redemptions, expiresAt: null, active: true, createdAt: ts, createdIso: iso(ts) });
  });

  // ---- Sample clients (each with a demo payout method) ----
  const bank = (name, last4, holder) => ({ type: 'bank', bankName: name, last4, routing: '110000000', holderName: holder, label: `${name} ••${last4}` });
  const debit = (brand, last4, holder) => ({ type: 'card', brand, last4, expMonth: 8, expYear: 2031, holderName: holder, label: `${brand[0].toUpperCase() + brand.slice(1)} debit ••${last4}` });
  const merchantDefs = [
    { businessName: "Boochie's Slots & Video Poker", email: 'boochies@example.com', password: 'demo1234', contactName: 'Boochie', website: 'boochiesplace.com', feePlanId: plans[1].id, payoutMethod: debit('visa', '4242', 'Boochie') },
    { businessName: 'KEI Events', email: 'aricka@example.com', password: 'demo1234', contactName: 'Aricka Dean', website: 'kei-events.com', feePlanId: plans[0].id, feeOverride: { pricePct: 270, priceFixed: 15 }, payoutMethod: bank('Chase', '8842', 'Aricka Dean') },
    { businessName: "Jermaine's Home Services", email: 'jermaine@example.com', password: 'demo1234', contactName: 'Jermaine', feePlanId: plans[0].id, payoutMethod: bank('Bank of America', '5511', 'Jermaine') },
    { businessName: 'The Gloss Spot', email: 'gloss@example.com', password: 'demo1234', contactName: 'Front Desk', feePlanId: plans[0].id, appliedCoupon: 'FREE', payoutMethod: debit('mastercard', '4444', 'The Gloss Spot') },
    { businessName: 'MAD Landscaping', email: 'mad@example.com', password: 'demo1234', contactName: 'Owner', feePlanId: plans[1].id, payoutMethod: bank('Wells Fargo', '2093', 'MAD Landscaping') },
  ];

  const merchants = merchantDefs.map((def, i) => buildMerchant(def, now() - (70 - i) * DAY));

  // ---- Historical charges + subscriptions per merchant ----
  for (const merchant of merchants) {
    let balance = 0;

    // One-time charges over the last ~60 days.
    const chargeCount = randInt(18, 42);
    for (let i = 0; i < chargeCount; i++) {
      const daysAgo = randInt(0, 60);
      const createdAt = now() - daysAgo * DAY - randInt(0, DAY);
      const amount = choice([1999, 2500, 4999, 7500, 9900, 12500, 19900, 25000, 45000, 8800, 6500, 3200]);
      const roll = Math.random();
      const status = roll < 0.06 ? 'failed' : roll < 0.1 ? 'refunded' : 'succeeded';
      const txn = makeHistoricalCharge(merchant, amount, createdAt, { status });
      db.insert('transactions', txn);
      if (status === 'succeeded') balance += txn.fees.merchantNet;
      else if (status === 'partially_refunded') balance += txn.fees.merchantNet - Math.round(txn.fees.merchantNet / 2);
      // failed + fully refunded contribute nothing net.
    }

    // Active subscriptions (drive MRR) + their historical invoices.
    const subCount = randInt(2, 5);
    for (let s = 0; s < subCount; s++) {
      const interval = choice(['month', 'month', 'month', 'year', 'week']);
      const amount = choice([2900, 4900, 9700, 19700, 29700, 1500, 5000]);
      const startedDaysAgo = randInt(20, 120);
      const startedAt = now() - startedDaysAgo * DAY;
      const customer = randomCustomer();
      const subId = prefixedId('sub', 18);
      const card = choice(CARD_BRANDS);

      // Walk forward from start, creating an invoice per elapsed cycle.
      let periodStart = startedAt;
      let cycles = 0;
      while (billing.advance(periodStart, interval) <= now() && cycles < 36) {
        const txn = makeHistoricalCharge(merchant, amount, periodStart, {
          status: 'succeeded',
          source: 'subscription',
          subscriptionId: subId,
          customer,
          description: choice(['Membership', 'Retainer', 'Subscription', 'Plan']),
        });
        db.insert('transactions', txn);
        balance += txn.fees.merchantNet;
        periodStart = billing.advance(periodStart, interval);
        cycles++;
      }
      const nextBillingAt = billing.advance(periodStart, interval);

      db.insert('subscriptions', {
        id: subId,
        object: 'subscription',
        merchantId: merchant.id,
        customer,
        productName: choice(['Gold Membership', 'Monthly Retainer', 'Pro Plan', 'VIP Club', 'Care Plan']),
        amount,
        currency: 'usd',
        interval,
        status: 'active',
        savedCard: { number: '4242424242424242', exp_month: 12, exp_year: 2030, brand: card.brand, last4: card.last4 },
        currentPeriodStart: periodStart,
        currentPeriodEnd: nextBillingAt,
        nextBillingAt,
        billingCycles: cycles + 1,
        paymentLinkId: null,
        metadata: {},
        createdAt: startedAt,
        createdIso: iso(startedAt),
        canceledAt: null,
      });
    }

    // A couple of payment links.
    db.insert('paymentLinks', {
      id: prefixedId('plink', 16),
      object: 'payment_link',
      merchantId: merchant.id,
      name: choice(['Deposit', 'Invoice payment', 'Booking fee', 'Consultation']),
      mode: 'payment',
      amount: choice([5000, 10000, 2500]),
      currency: 'usd',
      interval: null,
      description: 'Pay securely online.',
      active: true,
      allowCustomAmount: false,
      collectName: true,
      collectEmail: true,
      createdAt: now() - randInt(1, 30) * DAY,
      createdIso: iso(now()),
    });
    db.insert('paymentLinks', {
      id: prefixedId('plink', 16),
      object: 'payment_link',
      merchantId: merchant.id,
      name: choice(['Monthly Membership', 'Care Plan', 'Retainer']),
      mode: 'subscription',
      amount: choice([2900, 9700, 4900]),
      currency: 'usd',
      interval: 'month',
      description: 'Subscribe and get billed automatically.',
      active: true,
      allowCustomAmount: false,
      collectName: true,
      collectEmail: true,
      createdAt: now() - randInt(1, 30) * DAY,
      createdIso: iso(now()),
    });

    // A webhook endpoint + recent deliveries (for the Developers tab).
    if (Math.random() < 0.75) {
      const wid = prefixedId('we', 14);
      const host = (merchant.website || 'example.com').replace(/^https?:\/\//, '');
      db.insert('webhooks', { id: wid, object: 'webhook_endpoint', merchantId: merchant.id, url: `https://${host}/webhooks/transfado`, secret: 'whsec_' + randomId(28), enabledEvents: ['*'], active: true, createdAt: now() - randInt(5, 40) * DAY, createdIso: iso(now()) });
      for (let i = 0; i < randInt(4, 9); i++) {
        const ty = choice(['charge.succeeded', 'charge.succeeded', 'charge.refunded', 'subscription.created', 'payout.created']);
        const ok = Math.random() < 0.9;
        const when = now() - randInt(0, 18) * DAY - randInt(0, DAY);
        db.insert('webhookDeliveries', { id: prefixedId('whd', 14), object: 'webhook_delivery', webhookId: wid, merchantId: merchant.id, eventId: prefixedId('evt', 18), type: ty, url: `https://${host}/webhooks/transfado`, statusCode: ok ? 200 : 500, success: ok, signatureHeader: `t=${Math.floor(when / 1000)},v1=${randomId(12)}`, payload: '{}', createdAt: when, createdIso: iso(when) });
      }
    }

    // A few notifications.
    for (let i = 0; i < randInt(3, 6); i++) {
      const ty = choice(['payment_received', 'payment_received', 'payout_sent', 'subscription_renewed']);
      const amt = choice([4500, 12000, 2900, 25000, 7700]);
      const title = ty === 'payout_sent' ? 'Payout sent' : ty === 'subscription_renewed' ? 'Subscription renewed' : 'Payment received';
      const when = now() - randInt(0, 14) * DAY - randInt(0, DAY);
      db.insert('notifications', { id: prefixedId('ntf', 14), object: 'notification', merchantId: merchant.id, type: ty, title, body: `$${(amt / 100).toFixed(2)} ${ty === 'payout_sent' ? 'to your bank' : ty === 'subscription_renewed' ? 'membership renewed' : 'from a customer'}`, emailedTo: null, read: i > 1, data: {}, createdAt: when, createdIso: iso(when) });
    }

    // A past payout, then set the current available balance.
    if (balance > 20000) {
      const payoutAmount = Math.round(balance * 0.5);
      db.insert('payouts', {
        id: prefixedId('po', 18),
        object: 'payout',
        merchantId: merchant.id,
        amount: payoutAmount,
        currency: 'usd',
        status: 'paid',
        method: merchant.payoutMethod && merchant.payoutMethod.type === 'card' ? 'instant' : 'standard',
        destination: merchant.payoutMethod ? merchant.payoutMethod.label : 'Bank account ••5678',
        destinationType: merchant.payoutMethod ? merchant.payoutMethod.type : 'bank',
        createdAt: now() - randInt(3, 15) * DAY,
        createdIso: iso(now()),
      });
      balance -= payoutAmount;
    }

    db.update('merchants', merchant.id, { balance });
  }

  db.save();
  return summary();
}

function summary() {
  const d = db.getData();
  return {
    feePlans: d.feePlans.length,
    merchants: d.merchants.length,
    transactions: d.transactions.length,
    subscriptions: d.subscriptions.length,
    paymentLinks: d.paymentLinks.length,
    payouts: d.payouts.length,
    coupons: d.coupons.length,
    webhooks: d.webhooks.length,
    notifications: d.notifications.length,
  };
}

/** Seed only if the database has no users yet (first run). */
function ensureSeeded() {
  db.load();
  if (db.collection('users').length === 0) {
    return seed();
  }
  return null;
}

module.exports = { seed, ensureSeeded, summary };

// Allow `npm run seed` (with --force to wipe & reseed).
if (require.main === module) {
  db.load();
  const force = process.argv.includes('--force');
  if (!force && db.collection('users').length > 0) {
    console.log('Database already seeded. Use `npm run seed` (with --force) to wipe and reseed.');
    process.exit(0);
  }
  const result = seed();
  console.log('Seeded Transfado sandbox:', JSON.stringify(result, null, 2));
  console.log(`\nAdmin login:  ${config.ADMIN_EMAIL} / ${config.ADMIN_PASSWORD}`);
  console.log('Client login: boochies@example.com / demo1234 (and 4 more)');
  console.log('Coupon: FREE waives all fees · LAUNCH50 = 50% off · SAVE10 = $0.10 off');
}
