'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db');
const auth = require('../auth');
const merchantsSvc = require('../merchants');
const email = require('../email');
const config = require('../config');
const { rateLimit } = require('../ratelimit');

const HOUR = 60 * 60 * 1000;
const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;

/** Shape a user for the client (never leak the password hash). */
function meView(req) {
  if (!req.user) return { authenticated: false };
  const out = {
    authenticated: true,
    user: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role, owner: !!req.user.owner },
  };
  if (req.user.role === 'merchant' && req.merchant) {
    out.merchant = merchantsSvc.publicMerchant(req.merchant);
  }
  return out;
}

router.get('/me', (req, res) => {
  res.json(meView(req));
});

router.post('/login', rateLimit({ name: 'login', windowMs: 60000, max: 12 }), (req, res) => {
  const { email: em, password } = req.body || {};
  const user = auth.findUserByEmail(em);
  if (!user || !auth.verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: { message: 'Incorrect email or password.' } });
  }
  const token = auth.createSession(user.id);
  auth.setSessionCookie(res, token);
  req.user = user;
  if (user.role === 'merchant') req.merchant = db.findById('merchants', user.merchantId);
  res.json({ ok: true, ...meView(req), redirect: user.role === 'admin' ? '/admin' : '/dashboard' });
});

router.post('/signup', rateLimit({ name: 'signup', windowMs: 60000, max: 6 }), (req, res) => {
  try {
    const { businessName, email: em, password, contactName, website } = req.body || {};
    const { merchant, user } = merchantsSvc.createMerchant({ businessName, email: em, password, contactName, website });
    const token = auth.createSession(user.id);
    auth.setSessionCookie(res, token);
    req.user = user;
    req.merchant = merchant;
    // Welcome + verification emails (sandbox: logged, real: sent via Resend).
    const verifyLink = `${baseUrl(req)}/verify-email?token=${auth.createToken('verify', user.id, 48 * HOUR)}`;
    email.welcome(user.email, user.name).catch(() => {});
    email.verifyEmail(user.email, verifyLink).catch(() => {});
    res.json({ ok: true, ...meView(req), redirect: '/dashboard' });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: { message: err.message || 'Could not create account.' } });
  }
});

// ---- Password reset ----
router.post('/forgot', rateLimit({ name: 'forgot', windowMs: 60000, max: 6 }), async (req, res) => {
  const user = auth.findUserByEmail(req.body && req.body.email);
  const out = { ok: true }; // never reveal whether the email exists
  if (user) {
    const link = `${baseUrl(req)}/reset?token=${auth.createToken('reset', user.id, 1 * HOUR)}`;
    await email.passwordReset(user.email, link).catch(() => {});
    if (!config.RESEND_API_KEY) out.devLink = link; // sandbox: surface the link so it's testable
  }
  res.json(out);
});

router.post('/reset', rateLimit({ name: 'reset', windowMs: 60000, max: 10 }), (req, res) => {
  const { token, password } = req.body || {};
  const userId = auth.verifyToken('reset', token);
  if (!userId || !db.findById('users', userId)) {
    return res.status(400).json({ error: { message: 'This reset link is invalid or has expired.' } });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: { message: 'Password must be at least 8 characters.' } });
  }
  db.update('users', userId, { passwordHash: auth.hashPassword(password) });
  res.json({ ok: true });
});

router.post('/verify-email', (req, res) => {
  const userId = auth.verifyToken('verify', req.body && req.body.token);
  if (!userId || !db.findById('users', userId)) {
    return res.status(400).json({ error: { message: 'This verification link is invalid or has expired.' } });
  }
  db.update('users', userId, { verified: true });
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  if (req.sessionToken) auth.destroySession(req.sessionToken);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

module.exports = router;
