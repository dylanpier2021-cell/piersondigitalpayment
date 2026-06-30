'use strict';

const bcrypt = require('bcryptjs');
const db = require('./db');
const { prefixedId, now } = require('./util');

const SESSION_COOKIE = 'pp_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function hashPassword(plain) {
  return bcrypt.hashSync(String(plain), 10);
}

function verifyPassword(plain, hash) {
  try {
    return bcrypt.compareSync(String(plain), String(hash));
  } catch {
    return false;
  }
}

function findUserByEmail(email) {
  const target = String(email || '').trim().toLowerCase();
  return db.findOne('users', (u) => u.email.toLowerCase() === target);
}

function createSession(userId) {
  const token = prefixedId('sess', 28);
  const ts = now();
  db.insert('sessions', {
    id: token,
    userId,
    createdAt: ts,
    expiresAt: ts + SESSION_TTL_MS,
  });
  return token;
}

function destroySession(token) {
  if (token) db.remove('sessions', token);
}

function getSessionUser(token) {
  if (!token) return null;
  const session = db.findById('sessions', token);
  if (!session) return null;
  if (session.expiresAt < now()) {
    db.remove('sessions', token);
    return null;
  }
  return db.findById('users', session.userId);
}

/**
 * Middleware: attach req.user (and req.merchant for merchant users) from the
 * session cookie, if present. Never blocks the request.
 */
function attachUser(req, res, next) {
  const token = req.cookies ? req.cookies[SESSION_COOKIE] : null;
  const user = getSessionUser(token);
  if (user) {
    req.user = user;
    req.sessionToken = token;
    if (user.role === 'merchant' && user.merchantId) {
      req.merchant = db.findById('merchants', user.merchantId);
    }
  }
  next();
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

// ---- Route guards -------------------------------------------------------

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: { message: 'Authentication required.' } });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: { message: 'Admin access required.' } });
  }
  next();
}

function requireMerchant(req, res, next) {
  if (!req.user || req.user.role !== 'merchant' || !req.merchant) {
    return res.status(403).json({ error: { message: 'Merchant access required.' } });
  }
  if (req.merchant.status === 'suspended') {
    return res.status(403).json({ error: { message: 'This account has been suspended.' } });
  }
  next();
}

/**
 * Middleware for the public REST API: authenticate by `Authorization: Bearer
 * <secret_key>` (or ?api_key=). Sets req.merchant + req.apiKeyMode.
 */
function requireApiKey(req, res, next) {
  let key = null;
  const auth = req.get('authorization');
  if (auth && /^bearer\s+/i.test(auth)) {
    key = auth.replace(/^bearer\s+/i, '').trim();
  } else if (req.query.api_key) {
    key = String(req.query.api_key);
  } else if (req.body && req.body.api_key) {
    key = String(req.body.api_key);
  }

  if (!key) {
    return res.status(401).json({ error: { type: 'authentication_error', message: 'No API key provided.' } });
  }

  const merchant = db.findOne(
    'merchants',
    (m) => m.secretKey === key || m.publishableKey === key
  );
  if (!merchant) {
    return res.status(401).json({ error: { type: 'authentication_error', message: 'Invalid API key provided.' } });
  }
  if (merchant.publishableKey === key && req.method !== 'GET') {
    return res.status(401).json({
      error: { type: 'authentication_error', message: 'A secret key is required for this request.' },
    });
  }
  if (merchant.status === 'suspended') {
    return res.status(403).json({ error: { type: 'account_error', message: 'This account is suspended.' } });
  }

  req.merchant = merchant;
  req.apiKeyMode = merchant.secretKey === key ? 'secret' : 'publishable';
  next();
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  findUserByEmail,
  createSession,
  destroySession,
  getSessionUser,
  attachUser,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
  requireMerchant,
  requireApiKey,
};
