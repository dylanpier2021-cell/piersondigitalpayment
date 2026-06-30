'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Tiny file-backed database. The entire dataset lives in memory and is
 * persisted to data/db.json on every mutation via an atomic temp-write +
 * rename. No native dependencies, so it runs anywhere Node runs.
 *
 * This intentionally mirrors a document store: each top-level key is a
 * "collection" of records. Swap this module for Postgres/SQLite later
 * without touching the route handlers, as long as the helpers below keep
 * the same shape.
 */

// TF_DATA_DIR lets the test runner point at an isolated database.
// On serverless hosts (Vercel) the project filesystem is read-only — only /tmp
// is writable — so fall back to /tmp there unless a data dir was set explicitly.
const DATA_DIR = process.env.TF_DATA_DIR
  ? path.resolve(process.env.TF_DATA_DIR)
  : process.env.VERCEL
    ? path.join('/tmp', 'transfado-data')
    : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY = {
  meta: {
    version: 1,
    createdAt: null,
    // Platform-wide settings editable by the admin.
    settings: {
      platformName: 'Transfado',
      defaultFeePlanId: null,
      payoutHoldDays: 2,
      ownerPayoutMethod: null, // where Transfado's own profit pays out (owner's bank/card)
    },
  },
  users: [],
  merchants: [],
  feePlans: [],
  transactions: [],
  subscriptions: [],
  payouts: [],
  paymentLinks: [],
  coupons: [],
  webhooks: [],
  webhookDeliveries: [],
  notifications: [],
  ownerPayouts: [],
  sessions: [],
  events: [],
};

let data = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function load() {
  ensureDir();
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      data = JSON.parse(raw);
      // Make sure any newly-added collections exist on older db files.
      for (const key of Object.keys(EMPTY)) {
        if (!(key in data)) data[key] = JSON.parse(JSON.stringify(EMPTY[key]));
      }
    } catch (err) {
      throw new Error(`Failed to read database at ${DB_FILE}: ${err.message}`);
    }
  } else {
    data = JSON.parse(JSON.stringify(EMPTY));
    data.meta.createdAt = new Date().toISOString();
    save();
  }
  return data;
}

function save() {
  ensureDir();
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

/** Replace the entire dataset (used by the seeder). */
function replaceAll(newData) {
  data = newData;
  save();
}

function getData() {
  if (!data) load();
  return data;
}

// ---- Generic collection helpers ----------------------------------------

function collection(name) {
  const d = getData();
  if (!Array.isArray(d[name])) d[name] = [];
  return d[name];
}

function insert(name, record) {
  collection(name).push(record);
  save();
  return record;
}

function findById(name, id) {
  return collection(name).find((r) => r.id === id) || null;
}

function find(name, predicate) {
  return collection(name).filter(predicate);
}

function findOne(name, predicate) {
  return collection(name).find(predicate) || null;
}

function update(name, id, patch) {
  const rec = findById(name, id);
  if (!rec) return null;
  Object.assign(rec, patch);
  save();
  return rec;
}

function remove(name, id) {
  const col = collection(name);
  const idx = col.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  col.splice(idx, 1);
  save();
  return true;
}

module.exports = {
  DB_FILE,
  EMPTY,
  load,
  save,
  replaceAll,
  getData,
  collection,
  insert,
  findById,
  find,
  findOne,
  update,
  remove,
};
