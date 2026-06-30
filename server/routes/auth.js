'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db');
const auth = require('../auth');
const merchantsSvc = require('../merchants');

/** Shape a user for the client (never leak the password hash). */
function meView(req) {
  if (!req.user) return { authenticated: false };
  const out = {
    authenticated: true,
    user: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role },
  };
  if (req.user.role === 'merchant' && req.merchant) {
    out.merchant = merchantsSvc.publicMerchant(req.merchant);
  }
  return out;
}

router.get('/me', (req, res) => {
  res.json(meView(req));
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = auth.findUserByEmail(email);
  if (!user || !auth.verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: { message: 'Incorrect email or password.' } });
  }
  const token = auth.createSession(user.id);
  auth.setSessionCookie(res, token);
  req.user = user;
  if (user.role === 'merchant') req.merchant = db.findById('merchants', user.merchantId);
  res.json({ ok: true, ...meView(req), redirect: user.role === 'admin' ? '/admin' : '/dashboard' });
});

router.post('/signup', (req, res) => {
  try {
    const { businessName, email, password, contactName, website } = req.body || {};
    const { merchant, user } = merchantsSvc.createMerchant({
      businessName,
      email,
      password,
      contactName,
      website,
    });
    const token = auth.createSession(user.id);
    auth.setSessionCookie(res, token);
    req.user = user;
    req.merchant = merchant;
    res.json({ ok: true, ...meView(req), redirect: '/dashboard' });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: { message: err.message || 'Could not create account.' } });
  }
});

router.post('/logout', (req, res) => {
  if (req.sessionToken) auth.destroySession(req.sessionToken);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

module.exports = router;
