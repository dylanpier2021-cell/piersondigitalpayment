'use strict';
const { makeJar, login, Checker } = require('./lib');
const APPROVE = { number: '4242424242424242', exp_month: 12, exp_year: 2030, cvc: '123' };

async function run() {
  const c = new Checker('Coupons / fee-waiver');
  const admin = makeJar();
  await login(admin, 'owner@transfado.com', 'transfado123');

  // ---- FREE coupon exists and waives fees for the seeded Gloss Spot ----
  const merchants = (await admin.fetch('/api/admin/merchants')).data.data;
  const gloss = merchants.find((m) => m.businessName === 'The Gloss Spot');
  c.ok(gloss && gloss.couponLabel && /waiv/i.test(gloss.couponLabel), 'FREE attached to a seeded client');

  // login as the FREE merchant and charge -> fee 0, net = amount, margin 0
  const free = makeJar();
  await login(free, 'gloss@example.com', 'demo1234');
  let r = await free.fetch('/api/merchant/charges', { method: 'POST', body: { amount: 10000, card: APPROVE } });
  const f = r.data.charge.fees;
  c.ok(f.merchantFee === 0 && f.merchantNet === 10000 && f.piersonMargin === 0, 'FREE coupon: fee 0, net 100%, margin 0');
  c.ok(r.data.charge.coupon_waived === true, 'charge flagged coupon_waived');

  // ---- create coupons of each type ----
  r = await admin.fetch('/api/admin/coupons', { method: 'POST', body: { code: 'TESTPCT', type: 'percent_off', value: 5000, scope: 'platform' } });
  c.ok(r.status === 200, 'create percent_off coupon');
  r = await admin.fetch('/api/admin/coupons', { method: 'POST', body: { code: 'TESTFIX', type: 'fixed_off', value: 5, scope: 'platform' } });
  c.ok(r.status === 200, 'create fixed_off coupon');
  // duplicate rejected
  r = await admin.fetch('/api/admin/coupons', { method: 'POST', body: { code: 'TESTPCT', type: 'fee_waiver' } });
  c.ok(r.status === 409, 'duplicate code rejected');

  // ---- merchant redeems percent_off and fee is halved ----
  const m = makeJar();
  await login(m, 'jermaine@example.com', 'demo1234');
  const before = (await m.fetch('/api/merchant/charges', { method: 'POST', body: { amount: 10000, card: APPROVE } })).data.charge.fees.merchantFee;
  r = await m.fetch('/api/merchant/coupons/redeem', { method: 'POST', body: { code: 'TESTPCT' } });
  c.ok(r.status === 200, 'merchant redeems percent_off');
  const after = (await m.fetch('/api/merchant/charges', { method: 'POST', body: { amount: 10000, card: APPROVE } })).data.charge.fees.merchantFee;
  c.ok(after === Math.round(before * 0.5), '50% off halves the fee (' + before + ' -> ' + after + ')');
  await m.fetch('/api/merchant/coupons', { method: 'DELETE' });

  // ---- max redemptions enforced ----
  r = await admin.fetch('/api/admin/coupons', { method: 'POST', body: { code: 'ONCE', type: 'fee_waiver', maxRedemptions: 1 } });
  c.ok(r.status === 200, 'create max-1 coupon');
  const a = makeJar(); await login(a, 'mad@example.com', 'demo1234');
  c.ok((await a.fetch('/api/merchant/coupons/redeem', { method: 'POST', body: { code: 'ONCE' } })).status === 200, 'first redemption ok');
  const b = makeJar(); await login(b, 'aricka@example.com', 'demo1234');
  c.ok((await b.fetch('/api/merchant/coupons/redeem', { method: 'POST', body: { code: 'ONCE' } })).status === 400, 'second redemption blocked (max reached)');
  await a.fetch('/api/merchant/coupons', { method: 'DELETE' });

  // ---- expired coupon rejected ----
  r = await admin.fetch('/api/admin/coupons', { method: 'POST', body: { code: 'EXPIRED', type: 'fee_waiver', expiresAt: Date.now() - 1000 } });
  c.ok((await b.fetch('/api/merchant/coupons/redeem', { method: 'POST', body: { code: 'EXPIRED' } })).status === 400, 'expired coupon rejected');

  // ---- invalid code rejected ----
  c.ok((await b.fetch('/api/merchant/coupons/redeem', { method: 'POST', body: { code: 'NOPE404' } })).status === 400, 'unknown code rejected');

  // cleanup created coupons
  const all = (await admin.fetch('/api/admin/coupons')).data.data;
  for (const code of ['TESTPCT', 'TESTFIX', 'ONCE', 'EXPIRED']) {
    const cp = all.find((x) => x.code === code);
    if (cp) await admin.fetch('/api/admin/coupons/' + cp.id, { method: 'DELETE' });
  }

  return c.result();
}

module.exports = { run };
