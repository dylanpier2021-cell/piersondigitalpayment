'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Minimal .env loader (no dotenv dependency). Reads KEY=VALUE lines from a
 * .env file at the project root, if present, without overwriting variables
 * already set in the environment.
 */
function loadEnvFile() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

module.exports = {
  PORT: Number(process.env.PORT) || 4242,
  SESSION_SECRET: process.env.SESSION_SECRET || 'transfado-dev-secret',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'owner@transfado.com',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'transfado123',
  // Platform owner / super-admin (sees everything, $0 fees, withdraws platform profit).
  OWNER_EMAIL: (process.env.OWNER_EMAIL || 'dylanpier2021@gmail.com').toLowerCase(),
  OWNER_PASSWORD: process.env.OWNER_PASSWORD || 'owner1234',
  // Seed rich demo merchants/transactions. Set SEED_DEMO=false for a clean
  // production deploy (only the owner account is created; real signups stay empty).
  SEED_DEMO: process.env.SEED_DEMO !== 'false',
  // Transactional email (verify / reset / welcome). When unset, runs in sandbox:
  // logs the email and returns the link instead of sending.
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  EMAIL_FROM: process.env.EMAIL_FROM || 'Transfado <no-reply@transfado.com>',
  PROCESSING_MODE: process.env.PROCESSING_MODE || 'sandbox',
};
