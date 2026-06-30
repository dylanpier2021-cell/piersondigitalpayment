'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db');
const auth = require('../auth');
const owner = require('../owner');
const { buildPayoutMethod } = require('../payoutmethods');

// Platform owner / super-admin only.
router.use(auth.requireOwner);

// ---- Earnings ----
router.get('/earnings', (req, res) => {
  res.json(owner.earnings());
});

// ---- Payout method (where Transfado's profit goes) ----
router.put('/payout-method', (req, res) => {
  try {
    const method = owner.setPayoutMethod(buildPayoutMethod(req.body || {}));
    res.json({ ok: true, payoutMethod: method });
  } catch (err) {
    res.status(err.status || 400).json({ error: { message: err.message || 'Could not save payout method.' } });
  }
});

router.delete('/payout-method', (req, res) => {
  owner.setPayoutMethod(null);
  res.json({ ok: true });
});

// ---- Withdraw profit ----
router.post('/payouts', (req, res) => {
  const result = owner.payout(req.body && req.body.amount);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, payout: result.payout, earnings: owner.earnings() });
});

// ---- Change the owner password ----
router.post('/password', (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = db.findById('users', req.user.id);
  if (!user || !auth.verifyPassword(currentPassword, user.passwordHash)) {
    return res.status(400).json({ error: { message: 'Current password is incorrect.' } });
  }
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: { message: 'New password must be at least 8 characters.' } });
  }
  db.update('users', user.id, { passwordHash: auth.hashPassword(newPassword) });
  res.json({ ok: true });
});

module.exports = router;
