'use strict';

const crypto = require('crypto');
const db = require('./db');
const { prefixedId, randomId, now, iso } = require('./util');

/**
 * Developer webhooks. Each endpoint has a signing secret; every dispatched
 * event is HMAC-SHA256 signed (Transfado-Signature header model) and recorded
 * in the delivery log. In sandbox we simulate a successful delivery; swap the
 * delivery block for a real HTTP POST with retries to go live.
 */

const EVENT_TYPES = [
  'charge.succeeded', 'charge.failed', 'charge.refunded',
  'subscription.created', 'subscription.canceled', 'subscription.payment_failed',
  'payout.created', 'payment_link.created', 'dispute.opened',
];

function createEndpoint(merchantId, url, enabledEvents) {
  const ts = now();
  const ep = {
    id: prefixedId('we', 14),
    object: 'webhook_endpoint',
    merchantId,
    url: String(url || '').trim(),
    secret: 'whsec_' + randomId(28),
    enabledEvents: Array.isArray(enabledEvents) && enabledEvents.length ? enabledEvents : ['*'],
    active: true,
    createdAt: ts,
    createdIso: iso(ts),
  };
  db.insert('webhooks', ep);
  return ep;
}

function sign(payload, secret, t) {
  return crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
}

function recordDelivery(ep, type, dataObj, simulatedStatus) {
  const t = Math.floor(now() / 1000);
  const eventId = prefixedId('evt', 18);
  const payload = JSON.stringify({ id: eventId, type, created: t, data: dataObj });
  const signature = sign(payload, ep.secret, t);
  const status = simulatedStatus || 200;
  const delivery = {
    id: prefixedId('whd', 14),
    object: 'webhook_delivery',
    webhookId: ep.id,
    merchantId: ep.merchantId,
    eventId,
    type,
    url: ep.url,
    statusCode: status,
    success: status >= 200 && status < 300,
    signatureHeader: `t=${t},v1=${signature}`,
    payload,
    createdAt: now(),
    createdIso: iso(),
  };
  db.insert('webhookDeliveries', delivery);
  return delivery;
}

/** Dispatch an event to all of a merchant's active endpoints subscribed to it. */
function dispatch(merchantId, type, dataObj) {
  const endpoints = db.find('webhooks', (w) => w.merchantId === merchantId && w.active && (w.enabledEvents.includes('*') || w.enabledEvents.includes(type)));
  endpoints.forEach((ep) => recordDelivery(ep, type, dataObj));
  return endpoints.length;
}

function deliveries(merchantId, limit = 50) {
  return db.find('webhookDeliveries', (d) => d.merchantId === merchantId).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

function endpointView(ep) {
  return { id: ep.id, url: ep.url, secret: ep.secret, enabledEvents: ep.enabledEvents, active: ep.active, createdAt: ep.createdAt };
}

module.exports = { EVENT_TYPES, createEndpoint, dispatch, recordDelivery, deliveries, endpointView };
