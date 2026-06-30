'use strict';

const db = require('./db');
const { prefixedId, now, iso } = require('./util');

/**
 * In-app notifications + simulated email receipts. In a live deployment the
 * `emailedTo` address would receive a real templated email; here we record
 * the notification and log the intent.
 */
function notify(merchantId, type, title, body, opts = {}) {
  const ts = now();
  const n = {
    id: prefixedId('ntf', 14),
    object: 'notification',
    merchantId,
    type, // payment_received | payout_sent | subscription_renewed | payment_failed | dispute_opened
    title,
    body,
    emailedTo: opts.email || null,
    read: false,
    data: opts.data || {},
    createdAt: ts,
    createdIso: iso(ts),
  };
  db.insert('notifications', n);
  return n;
}

function list(merchantId, limit = 50) {
  return db.find('notifications', (n) => n.merchantId === merchantId).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

function markAllRead(merchantId) {
  db.find('notifications', (n) => n.merchantId === merchantId && !n.read).forEach((n) => db.update('notifications', n.id, { read: true }));
}

function unreadCount(merchantId) {
  return db.find('notifications', (n) => n.merchantId === merchantId && !n.read).length;
}

module.exports = { notify, list, markAllRead, unreadCount };
