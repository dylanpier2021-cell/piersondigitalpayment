'use strict';
const { makeJar, login, has, Checker } = require('./lib');

const APPROVE = { number: '4242424242424242', exp_month: 12, exp_year: 2030, cvc: '123' };

async function run() {
  const c = new Checker('API contract');
  const admin = makeJar(); const merch = makeJar();

  // ---- auth ----
  await login(admin, 'owner@transfado.com', 'transfado123');
  c.ok(true, 'admin login');
  const me = await login(merch, 'boochies@example.com', 'demo1234');
  c.ok(me.merchant && me.merchant.businessName, 'merchant login');

  // ---- platform name rebranded ----
  const health = (await merch.fetch('/api/health')).data;
  c.ok(health.name === 'Transfado', 'platform name is Transfado');

  // ---- merchant overview ----
  let r = await merch.fetch('/api/merchant/overview');
  ['metrics.balance', 'metrics.mrr', 'rates.price.label'].forEach((p) => c.ok(has(r.data, p), 'overview.' + p));
  c.ok(Array.isArray(r.data.metrics.series) && r.data.metrics.series.length === 30, 'overview.series[30]');

  // ---- new public flat rate ----
  r = await merch.fetch('/api/merchant/fees');
  c.ok(/2\.30% \+ \$0\.10|2\.50% \+ \$0\.10|2\.[0-9]+% \+ \$0\.10/.test(r.data.price.label), 'rate label uses $0.10 fixed');

  // ---- terminal charge + decline + refund ----
  r = await merch.fetch('/api/merchant/charges', { method: 'POST', body: { amount: 5000, description: 'api test', customerEmail: 't@b.com', card: APPROVE } });
  c.ok(r.status === 200 && r.data.charge.status === 'succeeded', 'terminal charge approves');
  const chId = r.data.charge && r.data.charge.id;
  r = await merch.fetch('/api/merchant/charges', { method: 'POST', body: { amount: 5000, card: { number: '4000000000000002', exp_month: 12, exp_year: 2030, cvc: '123' } } });
  c.ok(r.status === 402, 'declined card -> 402');
  r = await merch.fetch('/api/merchant/charges/' + chId + '/refund', { method: 'POST', body: {} });
  c.ok(r.status === 200 && r.data.charge.status === 'refunded', 'refund works');

  // ---- transaction search + CSV ----
  r = await merch.fetch('/api/merchant/transactions?status=succeeded&limit=10');
  c.ok(Array.isArray(r.data.data) && r.data.data.every((t) => t.status !== 'failed'), 'transaction status filter');
  const csv = await (await fetch((process.env.TF_TEST_BASE || 'http://localhost:4242') + '/api/merchant/transactions.csv', { headers: { Cookie: merch.header() } })).text();
  c.ok(csv.startsWith('id,date,amount'), 'CSV export has header');

  // ---- payment links + QR-able url ----
  r = await merch.fetch('/api/merchant/payment-links', { method: 'POST', body: { name: 'Test', mode: 'payment', amount: 5000 } });
  c.ok(r.status === 200 && r.data.link.url.startsWith('/pay/'), 'create payment link');
  const linkId = r.data.link.id;

  // ---- subscriptions ----
  r = await merch.fetch('/api/merchant/subscriptions', { method: 'POST', body: { productName: 'Plan', amount: 2900, interval: 'month', customerEmail: 's@b.com', card: APPROVE } });
  c.ok(r.status === 200 && r.data.subscription.status === 'active', 'create subscription');
  r = await merch.fetch('/api/merchant/subscriptions/' + r.data.subscription.id + '/cancel', { method: 'POST' });
  c.ok(r.data.subscription.status === 'canceled', 'cancel subscription');

  // ---- payouts: method required ----
  r = await merch.fetch('/api/merchant/payouts');
  c.ok(typeof r.data.balance === 'number' && 'payoutMethod' in r.data, 'payouts returns balance + method');
  // boochies has a seeded debit-card payout method
  c.ok(r.data.payoutMethod && r.data.payoutMethod.type === 'card', 'seeded payout method present');
  r = await merch.fetch('/api/merchant/payout-method', { method: 'PUT', body: { type: 'bank', bankName: 'Test', routingNumber: '021000021', accountNumber: '12345678' } });
  c.ok(r.status === 200 && r.data.payoutMethod.label.includes('5678'), 'update payout method (bank)');

  // ---- webhooks ----
  r = await merch.fetch('/api/merchant/webhooks', { method: 'POST', body: { url: 'https://example.com/hook' } });
  c.ok(r.status === 200 && r.data.endpoint.secret.startsWith('whsec_'), 'create webhook endpoint');
  const wid = r.data.endpoint.id;
  r = await merch.fetch('/api/merchant/webhooks/' + wid + '/test', { method: 'POST' });
  c.ok(r.status === 200 && r.data.delivery.success, 'webhook test-send records delivery');
  r = await merch.fetch('/api/merchant/webhooks');
  c.ok(r.data.deliveries.length > 0, 'webhook deliveries listed');
  await merch.fetch('/api/merchant/webhooks/' + wid, { method: 'DELETE' });

  // ---- notifications ----
  r = await merch.fetch('/api/merchant/notifications');
  c.ok(Array.isArray(r.data.data), 'notifications list');

  // ---- public REST API ----
  const acct = await merch.fetch('/api/merchant/api-keys');
  const sk = acct.data.secretKey;
  r = await merch.fetch('/v1/charges', { method: 'POST', body: { amount: 2500, card: APPROVE }, headers: { Authorization: 'Bearer ' + sk } });
  c.ok(r.status === 201 && r.data.fees, 'public /v1/charges');

  // ---- admin metrics: profit == revenue - cost ----
  r = await admin.fetch('/api/admin/overview');
  const M = r.data.metrics;
  c.ok(M.piersonRevenue - M.processorCost === M.piersonProfit, 'admin profit == revenue - cost');
  c.ok(M.piersonProfit > 0, 'platform profitable on new low rates');

  // ---- role guards ----
  c.ok((await merch.fetch('/api/admin/overview')).status === 403, 'merchant blocked from admin');
  c.ok((await makeJar().fetch('/api/merchant/overview')).status >= 401, 'unauth blocked from merchant');

  // ---- public checkout pays the link ----
  const pr = await fetch((process.env.TF_TEST_BASE || 'http://localhost:4242') + '/api/public/payment-links/' + linkId + '/pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerName: 'Jane', customerEmail: 'j@x.com', card: APPROVE }) });
  const pd = await pr.json();
  c.ok(pr.status === 200 && pd.receipt && pd.receipt.businessName, 'public checkout pays link');

  return c.result();
}

module.exports = { run };
