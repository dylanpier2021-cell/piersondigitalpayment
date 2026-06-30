'use strict';
// Headless DOM render test: loads each page's real HTML+JS in jsdom against the
// running server, asserting zero JS errors, rendered content, theme + i18n.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { makeJar, login, Checker } = require('./lib');

const BASE = process.env.TF_TEST_BASE || 'http://localhost:4242';
const PUB = path.join(__dirname, '..', 'public');

const getSet = (res) => (res.headers.getSetCookie ? res.headers.getSetCookie() : res.headers.get('set-cookie'));
function shimFetch(jar) {
  return async function (url, opts = {}) {
    const abs = String(url).startsWith('http') ? url : BASE + url;
    const headers = Object.assign({}, opts.headers); if (jar.header()) headers.Cookie = jar.header();
    const res = await fetch(abs, { method: opts.method || 'GET', headers, body: opts.body });
    jar.absorb(getSet(res));
    return res;
  };
}
function inlineScripts(html) {
  return html.replace(/<script src="(\/js\/[^"]+)"><\/script>/g, (m, src) => '<script>\n' + fs.readFileSync(path.join(PUB, src), 'utf8') + '\n</script>');
}

async function renderPage(pageFile, jar, { hash = '', pathname = null, theme = null, lang = null, wait = 1000 } = {}) {
  const html = inlineScripts(fs.readFileSync(path.join(PUB, pageFile), 'utf8'));
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.detail && (e.detail.message) || e.message)));
  const url = BASE + (pathname || ('/' + pageFile.replace('.html', ''))) + (hash || '');
  const dom = new JSDOM(html, {
    url, runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true,
    beforeParse(window) {
      try { if (theme) window.localStorage.setItem('tf_theme', theme); if (lang) window.localStorage.setItem('tf_lang', lang); } catch {}
      window.fetch = shimFetch(jar);
      window.addEventListener('error', (e) => errors.push('window.error: ' + (e.error ? (e.error.message) : e.message)));
      window.addEventListener('unhandledrejection', (e) => errors.push('unhandledRejection: ' + (e.reason && (e.reason.message) || e.reason)));
    },
  });
  await new Promise((r) => setTimeout(r, wait));
  return { errors, doc: dom.window.document, win: dom.window };
}

async function run() {
  const c = new Checker('DOM render');

  // ---- Static pages ----
  for (const [file, marker] of [['index.html', 'get paid'], ['login.html', 'Welcome back'], ['signup.html', 'Create your account'], ['docs.html', 'API Reference'], ['legal/terms.html', 'Terms of Service']]) {
    const { errors, doc } = await renderPage(file, makeJar());
    c.ok(errors.length === 0, file + ' no JS errors' + (errors.length ? ' :: ' + errors.join(' | ') : ''));
    c.ok(doc.body.textContent.includes(marker), file + ' content present');
  }

  // ---- Merchant dashboard ----
  {
    const jar = makeJar(); await login(jar, 'boochies@example.com', 'demo1234');
    for (const hash of ['#overview', '#payments', '#links', '#subscriptions', '#payouts', '#developers', '#settings']) {
      const { errors, doc } = await renderPage('dashboard.html', jar, { hash, pathname: '/dashboard' });
      const pg = doc.querySelector('.page.active');
      const rendered = pg && !pg.querySelector('.loading-block') && pg.textContent.trim().length > 20;
      c.ok(errors.length === 0 && rendered, 'dashboard ' + hash + (errors.length ? ' :: ' + errors.join(' | ') : (rendered ? '' : ' (no render)')));
    }
  }

  // ---- Admin console ----
  {
    const jar = makeJar(); await login(jar, 'owner@transfado.com', 'transfado123');
    for (const hash of ['#overview', '#clients', '#plans', '#coupons', '#transactions', '#settings']) {
      const { errors, doc } = await renderPage('admin.html', jar, { hash, pathname: '/admin' });
      const pg = doc.querySelector('.page.active');
      const rendered = pg && !pg.querySelector('.loading-block') && pg.textContent.trim().length > 20;
      c.ok(errors.length === 0 && rendered, 'admin ' + hash + (errors.length ? ' :: ' + errors.join(' | ') : (rendered ? '' : ' (no render)')));
    }
  }

  // ---- Checkout ----
  {
    const jar = makeJar(); await login(jar, 'boochies@example.com', 'demo1234');
    const links = await (await shimFetch(jar)('/api/merchant/payment-links')).json();
    const link = links.data[0];
    const { errors, doc } = await renderPage('checkout.html', makeJar(), { pathname: '/pay/' + link.id });
    c.ok(errors.length === 0 && !!doc.querySelector('.checkout'), 'checkout renders' + (errors.length ? ' :: ' + errors.join(' | ') : ''));
  }

  // ---- Theme persistence ----
  {
    const light = await renderPage('index.html', makeJar(), { theme: 'light' });
    c.ok(light.doc.documentElement.getAttribute('data-theme') === 'light', 'theme=light applied from storage');
    const dark = await renderPage('index.html', makeJar(), { theme: 'dark' });
    c.ok(dark.doc.documentElement.getAttribute('data-theme') === 'dark', 'theme=dark applied from storage');
  }

  // ---- i18n locale swap ----
  {
    const es = await renderPage('index.html', makeJar(), { lang: 'es', wait: 1200 });
    c.ok(es.doc.documentElement.getAttribute('lang') === 'es', 'html lang=es');
    c.ok(es.doc.body.textContent.includes('Empezar') || es.doc.body.textContent.includes('cobrar'), 'Spanish strings rendered');
    const de = await renderPage('login.html', makeJar(), { lang: 'de', wait: 1200 });
    c.ok(de.doc.body.textContent.includes('Willkommen'), 'German login string rendered');
  }

  return c.result();
}

module.exports = { run };
