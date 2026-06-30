'use strict';
const { makeJar, login, Checker } = require('./lib');

async function run() {
  const c = new Checker('Signup / onboarding / reset');

  // ---- fresh signup lands in dashboard ----
  const jar = makeJar();
  let r = await jar.fetch('/auth/signup', { method: 'POST', body: { businessName: 'Fresh Co', email: 'fresh@newclient.com', password: 'StrongPass9', contactName: 'New User' } });
  c.ok(r.status === 200 && r.data.redirect === '/dashboard', 'fresh signup succeeds → dashboard');
  c.ok(r.data.merchant && r.data.merchant.businessName === 'Fresh Co', 'merchant created');

  // ---- a NEW account starts EMPTY (no demo data) ----
  r = await jar.fetch('/api/merchant/overview');
  c.ok(r.data.metrics.chargeCount === 0 && r.data.metrics.balance === 0, 'new account is empty (no charges/balance)');
  c.ok(r.data.recentTransactions.length === 0, 'new account has no transactions');
  r = await jar.fetch('/api/merchant/payment-links');
  c.ok(r.data.data.length === 0, 'new account has no payment links');
  // its fee is shown (2.5% + $0.10 default plan)
  r = await jar.fetch('/api/merchant/fees');
  c.ok(/2\.50% \+ \$0\.10/.test(r.data.price.label), 'new account sees the 2.5% + $0.10 rate');
  // gets its own API keys
  r = await jar.fetch('/api/merchant/api-keys');
  c.ok(r.data.publishableKey && r.data.secretKey, 'new account gets its own API keys');

  // ---- validation ----
  r = await makeJar().fetch('/auth/signup', { method: 'POST', body: { businessName: 'Dup', email: 'fresh@newclient.com', password: 'StrongPass9' } });
  c.ok(r.status === 409, 'duplicate email rejected');
  r = await makeJar().fetch('/auth/signup', { method: 'POST', body: { businessName: 'Weak', email: 'weak@x.com', password: '123' } });
  c.ok(r.status === 400, 'short password rejected');

  // ---- password reset flow (sandbox returns the link) ----
  r = await makeJar().fetch('/auth/forgot', { method: 'POST', body: { email: 'fresh@newclient.com' } });
  c.ok(r.status === 200 && r.data.devLink, 'forgot returns a reset link (sandbox)');
  const token = new URL(r.data.devLink).searchParams.get('token');
  r = await makeJar().fetch('/auth/reset', { method: 'POST', body: { token, password: 'BrandNew99' } });
  c.ok(r.status === 200, 'reset with valid token succeeds');
  const relog = makeJar();
  const ok = await login(relog, 'fresh@newclient.com', 'BrandNew99').then(() => true).catch(() => false);
  c.ok(ok, 'can log in with the reset password');
  // invalid token rejected
  r = await makeJar().fetch('/auth/reset', { method: 'POST', body: { token: 'bad.token.here', password: 'whatever12' } });
  c.ok(r.status === 400, 'invalid reset token rejected');
  // forgot for unknown email still returns 200 (no enumeration)
  r = await makeJar().fetch('/auth/forgot', { method: 'POST', body: { email: 'nobody@nowhere.com' } });
  c.ok(r.status === 200, 'forgot for unknown email does not reveal existence');

  // ---- rate limiter mechanism (unit test, deterministic) ----
  const { rateLimit } = require('../server/ratelimit');
  const mw = rateLimit({ max: 2, windowMs: 60000, name: 'unit' });
  const req = { headers: {}, ip: '9.9.9.9' };
  let blocked = 0, passed = 0;
  for (let i = 0; i < 4; i++) {
    const res = { _c: 200, set() {}, status(code) { this._c = code; return this; }, json() {} };
    mw(req, res, () => { passed++; });
    if (res._c === 429) blocked++;
  }
  c.ok(passed === 2 && blocked === 2, 'rate limiter blocks after max attempts (' + passed + ' passed, ' + blocked + ' blocked)');

  return c.result();
}

module.exports = { run };
