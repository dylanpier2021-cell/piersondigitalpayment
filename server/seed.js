'use strict';

const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const fees = require('./fees');
const merchantsSvc = require('./merchants');
const billing = require('./billing');
const { prefixedId, now, iso } = require('./util');

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
  const q = fees.quote(amount, merchant, db.collection('feePlans'));
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

  // ---- Fee plans (cost basis vs. client price = Pierson's margin) ----
  const plans = [
    { name: 'Pierson Standard', description: 'Default plan for new clients.', costPct: 290, costFixed: 30, pricePct: 350, priceFixed: 35 },
    { name: 'Pierson Plus', description: 'Higher-volume clients.', costPct: 270, costFixed: 25, pricePct: 320, priceFixed: 30 },
    { name: 'Pierson Nonprofit', description: 'Discounted rate for nonprofits.', costPct: 220, costFixed: 30, pricePct: 250, priceFixed: 30 },
  ].map((p) => {
    const ts = now();
    const plan = { id: prefixedId('plan', 12), object: 'fee_plan', ...p, createdAt: ts, createdIso: iso(ts) };
    db.insert('feePlans', plan);
    return plan;
  });

  const settings = db.getData().meta.settings;
  settings.defaultFeePlanId = plans[0].id;
  settings.platformName = 'Pierson Pay';
  db.save();

  // ---- Admin (Pierson Digital) ----
  db.insert('users', {
    id: prefixedId('usr', 18),
    object: 'user',
    role: 'admin',
    merchantId: null,
    name: 'Pierson Digital',
    email: config.ADMIN_EMAIL.toLowerCase(),
    passwordHash: auth.hashPassword(config.ADMIN_PASSWORD),
    createdAt: now(),
  });

  // ---- Sample clients ----
  const merchantDefs = [
    { businessName: "Boochie's Slots & Video Poker", email: 'boochies@example.com', password: 'demo1234', contactName: 'Boochie', website: 'boochiesplace.com', feePlanId: plans[1].id },
    { businessName: 'KEI Events', email: 'aricka@example.com', password: 'demo1234', contactName: 'Aricka Dean', website: 'kei-events.com', feePlanId: plans[0].id, feeOverride: { pricePct: 360, priceFixed: 40 } },
    { businessName: "Jermaine's Home Services", email: 'jermaine@example.com', password: 'demo1234', contactName: 'Jermaine', feePlanId: plans[0].id },
    { businessName: 'The Gloss Spot', email: 'gloss@example.com', password: 'demo1234', contactName: 'Front Desk', feePlanId: plans[0].id },
    { businessName: 'MAD Landscaping', email: 'mad@example.com', password: 'demo1234', contactName: 'Owner', feePlanId: plans[1].id },
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
        method: 'standard',
        destination: 'Bank account ••••6789',
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
  console.log('Seeded Pierson Pay sandbox:', JSON.stringify(result, null, 2));
  console.log(`\nAdmin login:  ${config.ADMIN_EMAIL} / ${config.ADMIN_PASSWORD}`);
  console.log('Client login: boochies@example.com / demo1234 (and 4 more)');
}
