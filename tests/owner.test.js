'use strict';
const { makeJar, login, has, Checker } = require('./lib');
const APPROVE = { number: '4242424242424242', exp_month: 12, exp_year: 2030, cvc: '123' };

async function run() {
  const c = new Checker('Owner / earnings');
  const owner = makeJar();

  // ---- owner login + flag ----
  const me = await login(owner, 'dylanpier2021@gmail.com', 'owner1234');
  c.ok(me.user.owner === true && me.user.role === 'admin', 'owner logs in with owner flag');

  // ---- earnings shape + math ----
  let r = await owner.fetch('/api/owner/earnings');
  ['profitEarned', 'profitWithdrawn', 'profitAvailable', 'ownAvailable', 'combined', 'perMerchant', 'ownBusinesses', 'payoutMethod', 'payouts'].forEach((k) => c.ok(has(r.data, k), 'earnings.' + k));
  const e = r.data;
  c.ok(e.profitEarned - e.profitWithdrawn === e.profitAvailable, 'profitAvailable == earned - withdrawn');
  c.ok(e.profitAvailable + e.ownAvailable === e.combined, 'combined == profit + own businesses');
  c.ok(e.combined > 0, 'combined balance is positive');
  c.ok(e.ownBusinesses.length >= 1, 'owner has at least one own business');
  c.ok(e.perMerchant.length >= 1, 'profit breakdown from other businesses');

  // ---- owner-owned business charges at $0 (permanent, via owner flag not coupon) ----
  const gloss = makeJar();
  await login(gloss, 'gloss@example.com', 'demo1234');
  r = await gloss.fetch('/api/merchant/charges', { method: 'POST', body: { amount: 10000, card: APPROVE } });
  const f = r.data.charge.fees;
  c.ok(f.merchantFee === 0 && f.merchantNet === 10000 && f.piersonMargin === 0, 'owner business: $0 fee, keeps 100%');
  c.ok(r.data.charge.coupon_waived === false, 'owner $0 is NOT a coupon (permanent flag)');

  // ---- payout method + withdraw ----
  r = await owner.fetch('/api/owner/payout-method', { method: 'PUT', body: { type: 'bank', bankName: 'Test', routingNumber: '021000021', accountNumber: '12345678' } });
  c.ok(r.status === 200 && r.data.payoutMethod.label.includes('5678'), 'owner sets payout method');
  const before = (await owner.fetch('/api/owner/earnings')).data.combined;
  r = await owner.fetch('/api/owner/payouts', { method: 'POST', body: { amount: 5000 } });
  c.ok(r.status === 200 && r.data.earnings.combined === before - 5000, 'withdraw reduces combined balance');
  // overdraw rejected
  r = await owner.fetch('/api/owner/payouts', { method: 'POST', body: { amount: 999999999 } });
  c.ok(r.status === 400, 'overdraw rejected');

  // ---- access control ----
  const boochies = makeJar();
  await login(boochies, 'boochies@example.com', 'demo1234');
  c.ok((await boochies.fetch('/api/owner/earnings')).status === 403, 'non-owner blocked from owner API');

  // ---- change password ----
  c.ok((await owner.fetch('/api/owner/password', { method: 'POST', body: { currentPassword: 'wrong', newPassword: 'newpass99' } })).status === 400, 'wrong current password rejected');
  c.ok((await owner.fetch('/api/owner/password', { method: 'POST', body: { currentPassword: 'owner1234', newPassword: 'newpass99' } })).status === 200, 'password change succeeds');
  const relog = makeJar();
  const ok = await login(relog, 'dylanpier2021@gmail.com', 'newpass99').then(() => true).catch(() => false);
  c.ok(ok, 'can log in with the new password');

  return c.result();
}

module.exports = { run };
