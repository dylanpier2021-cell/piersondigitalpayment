'use strict';
// Shared test harness: HTTP client with cookie jar + a tiny assertion collector.

const BASE = process.env.TF_TEST_BASE || 'http://localhost:4242';

function makeJar() {
  const jar = {};
  return {
    header() { return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); },
    absorb(setCookie) { if (!setCookie) return; [].concat(setCookie).forEach((sc) => { const p = sc.split(';')[0]; const i = p.indexOf('='); jar[p.slice(0, i)] = p.slice(i + 1); }); },
    async fetch(path, opts = {}) {
      const headers = Object.assign({}, opts.headers);
      if (this.header()) headers.Cookie = this.header();
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(BASE + path, { method: opts.method || 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
      this.absorb(res.headers.getSetCookie ? res.headers.getSetCookie() : res.headers.get('set-cookie'));
      let data = null; try { data = await res.json(); } catch {}
      return { status: res.status, data, res };
    },
  };
}

async function login(jar, email, password) {
  const r = await jar.fetch('/auth/login', { method: 'POST', body: { email, password } });
  if (!r.data || !r.data.user) throw new Error('login failed: ' + email);
  return r.data;
}

function has(obj, path) { return path.split('.').every((k) => { if (obj == null) return false; obj = obj[k]; return obj !== undefined; }); }

class Checker {
  constructor(name) { this.name = name; this.pass = 0; this.fail = 0; this.failures = []; }
  ok(cond, label) { if (cond) this.pass++; else { this.fail++; this.failures.push(label); } }
  result() { return { name: this.name, pass: this.pass, fail: this.fail, failures: this.failures }; }
}

module.exports = { BASE, makeJar, login, has, Checker };
