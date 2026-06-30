'use strict';

const bcrypt = require('bcryptjs');
const db = require('./db');
const config = require('./config');
const { now, sign, safeEqual } = require('./util');

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

/**
 * Stateless sessions: the cookie is `userId.expiresAt.HMAC(userId.expiresAt)`
 * signed with SESSION_SECRET. No server-side store, so a session is valid on
 * any instance — essential on serverless (Vercel), where each lambda has its
 * own ephemeral /tmp and a file-stored session would not survive cold starts.
 */
function createSession(userId) {
  const expiresAt = now() + SESSION_TTL_MS;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${sign(payload, config.SESSION_SECRET)}`;
}

// Stateless — nothing to destroy server-side; logout clears the cookie.
function destroySession() {}

function getSessionUser(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expiresStr, mac] = parts;
  const payload = `${userId}.${expiresStr}`;
  if (!safeEqual(mac, sign(payload, config.SESSION_SECRET))) return null;
  const expiresAt = Number(expiresStr);
  if (!Number.isFinite(expiresAt) || expiresAt < now()) return null;
  return db.findById('users', userId);
}

/**
 * Purpose-bound, stateless, signed tokens for email verification + password
 * reset. Bound to a `purpose` so a verify token can't double as a reset token.
 */
function createToken(purpose, userId, ttlMs) {
  const expiresAt = now() + ttlMs;
  const mac = sign(`${purpose}.${userId}.${expiresAt}`, config.SESSION_SECRET);
  return `${userId}.${expiresAt}.${mac}`;
}
function verifyToken(purpose, token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expiresStr, mac] = parts;
  if (!safeEqual(mac, sign(`${purpose}.${userId}.${expiresStr}`, config.SESSION_SECRET))) return null;
  if (!Number.isFinite(Number(expiresStr)) || Number(expiresStr) < now()) return null;
  return userId;
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
  // `secure` only over HTTPS (so localhost dev over http still works); httpOnly
  // always, so client JS can never read the session cookie.
  const secure = !!(res.req && res.req.secure);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: !!(res.req && res.req.secure), sameSite: 'lax' });
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

// Platform owner / super-admin only (the Earnings + platform payout screens).
function requireOwner(req, res, next) {
  if (!req.user || !req.user.owner) {
    return res.status(403).json({ error: { message: 'Owner access required.' } });
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
  createToken,
  verifyToken,
  attachUser,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
  requireOwner,
  requireMerchant,
  requireApiKey,
};
