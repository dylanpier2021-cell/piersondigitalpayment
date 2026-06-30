/* Transfado — shared frontend runtime (vanilla JS, no build step). */

// ---------- DOM ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------- i18n ----------
const LOCALES = ['en', 'es', 'fr', 'de', 'pt'];
const LOCALE_NAMES = { en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português' };
let DICT = {};
let BASE = {};
let LANG = 'en';

function detectLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q && LOCALES.includes(q)) return q;
  const stored = localStorage.getItem('tf_lang');
  if (stored && LOCALES.includes(stored)) return stored;
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return LOCALES.includes(nav) ? nav : 'en';
}
async function loadLocale(lang) {
  const fetchJson = async (l) => { try { const r = await fetch(`/locales/${l}.json`); return r.ok ? await r.json() : {}; } catch { return {}; } };
  if (!Object.keys(BASE).length) BASE = await fetchJson('en');
  DICT = lang === 'en' ? BASE : await fetchJson(lang);
  LANG = lang;
  document.documentElement.setAttribute('lang', lang);
}
function lookup(dict, key) { return key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict); }
function t(key, vars) {
  let s = lookup(DICT, key);
  if (s == null) s = lookup(BASE, key);
  if (s == null) return key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
  return s;
}
function applyI18n(root = document) {
  $$('[data-i18n]', root).forEach((n) => { n.textContent = t(n.getAttribute('data-i18n')); });
  $$('[data-i18n-html]', root).forEach((n) => { n.innerHTML = t(n.getAttribute('data-i18n-html')); });
  $$('[data-i18n-ph]', root).forEach((n) => { n.setAttribute('placeholder', t(n.getAttribute('data-i18n-ph'))); });
}
async function setLocale(lang) {
  if (!LOCALES.includes(lang)) lang = 'en';
  localStorage.setItem('tf_lang', lang);
  await loadLocale(lang);
  applyI18n(document);
  document.dispatchEvent(new CustomEvent('localechange', { detail: { lang } }));
}

// ---------- Formatting (locale-aware) ----------
function money(cents, withSign = false) {
  const n = (Number(cents) || 0) / 100;
  const neg = n < 0;
  let s;
  try { s = new Intl.NumberFormat(LANG, { style: 'currency', currency: 'USD' }).format(Math.abs(n)); }
  catch { s = '$' + Math.abs(n).toFixed(2); }
  if (withSign) return (neg ? '−' : '+') + s;
  return (neg ? '−' : '') + s;
}
function centsFromDollars(str) { const c = String(str).replace(/[^0-9.\-]/g, ''); const v = Number(c); return Number.isFinite(v) ? Math.round(v * 100) : NaN; }
function pct(bps) { return (bps / 100).toFixed(2) + '%'; }
function fmtDate(ms) { try { return new Intl.DateTimeFormat(LANG, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(ms)); } catch { return new Date(ms).toDateString(); } }
function fmtDateTime(ms) { try { return new Intl.DateTimeFormat(LANG, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms)); } catch { return new Date(ms).toString(); } }
function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return t('time.now');
  const m = Math.floor(s / 60); if (m < 60) return t('time.m', { n: m });
  const h = Math.floor(m / 60); if (h < 24) return t('time.h', { n: h });
  const d = Math.floor(h / 24); if (d < 30) return t('time.d', { n: d });
  return fmtDate(ms);
}
function brandIcon(brand) { return ({ visa: 'VISA', mastercard: 'MC', amex: 'AMEX', discover: 'DISC', unknown: 'CARD' }[brand]) || 'CARD'; }

// ---------- Brand mark (custom geometric T with transfer glyph) ----------
function brandMark() {
  return `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="tfg" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
        <stop stop-color="#1FE08A"/><stop offset="1" stop-color="#0FB877"/>
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="36" height="36" rx="11" fill="url(#tfg)"/>
    <rect x="2.6" y="2.6" width="34.8" height="34.8" rx="10.4" stroke="#fff" stroke-opacity=".22"/>
    <path d="M11 14h18" stroke="#042414" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M20 14v14" stroke="#042414" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M24.5 24.5l4 -3.2 -4 -3.2" stroke="#042414" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".85"/>
  </svg>`;
}

// ---------- Theme ----------
function getTheme() { return localStorage.getItem('tf_theme') || (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); }
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('tf_theme', theme);
  $$('.js-theme-toggle').forEach((b) => { b.innerHTML = theme === 'dark' ? ICON.sun : ICON.moon; b.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'); });
  document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}
function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }

const ICON = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
};

/** Build the top-bar controls (theme toggle + language select). Returns a node. */
function topControls() {
  const themeBtn = el('button', { class: 'icon-btn js-theme-toggle', title: 'Toggle theme', onclick: toggleTheme });
  themeBtn.innerHTML = document.documentElement.getAttribute('data-theme') === 'dark' ? ICON.sun : ICON.moon;
  const lang = el('select', { class: 'lang-select', 'aria-label': 'Language', onchange: (e) => setLocale(e.target.value) },
    LOCALES.map((l) => el('option', { value: l, selected: l === LANG, text: LOCALE_NAMES[l] })));
  return el('div', { class: 'topctl' }, [lang, themeBtn]);
}

// ---------- API ----------
async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  if (opts.headers) Object.assign(init.headers, opts.headers);
  const res = await fetch(path, init);
  let data = null; try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || (data && data.error) || `Request failed (${res.status})`;
    const err = new Error(typeof msg === 'string' ? msg : 'Request failed'); err.status = res.status; err.data = data; throw err;
  }
  return data;
}

// ---------- Session ----------
async function getSession() { try { return await api('/auth/me'); } catch { return { authenticated: false }; } }
async function requireRole(role) {
  const s = await getSession();
  if (!s.authenticated) { location.href = '/login'; throw new Error('redirect'); }
  if (role && s.user.role !== role) { location.href = s.user.role === 'admin' ? '/admin' : '/dashboard'; throw new Error('redirect'); }
  return s;
}
async function logout() { try { await api('/auth/logout', { method: 'POST' }); } catch {} location.href = '/login'; }

// ---------- Toast ----------
function toast(msg, type = '') {
  let host = $('#toasts'); if (!host) { host = el('div', { id: 'toasts' }); document.body.appendChild(host); }
  const tn = el('div', { class: 'toast ' + type, role: 'status', text: msg }); host.appendChild(tn);
  setTimeout(() => { tn.style.cssText += 'opacity:0;transform:translateX(24px);transition:all .3s'; setTimeout(() => tn.remove(), 320); }, 3600);
}

// ---------- Clipboard ----------
function copyText(text, label) {
  label = label || t('toast.copied');
  const done = () => toast(label, 'success');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fb());
  else fb();
  function fb() { const ta = el('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch {} ta.remove(); }
}

// ---------- Modal ----------
function openModal(node) {
  let b = $('#modal-backdrop');
  if (!b) { b = el('div', { id: 'modal-backdrop', class: 'modal-backdrop' }); b.addEventListener('click', (e) => { if (e.target === b) closeModal(); }); document.body.appendChild(b); }
  b.innerHTML = ''; b.appendChild(node); b.classList.add('open'); document.addEventListener('keydown', escClose);
}
function escClose(e) { if (e.key === 'Escape') closeModal(); }
function closeModal() { const b = $('#modal-backdrop'); if (b) { b.classList.remove('open'); b.innerHTML = ''; } document.removeEventListener('keydown', escClose); }
function modalShell(title, body, foot) {
  return el('div', { class: 'modal' }, [
    el('div', { class: 'modal-head' }, [el('h3', { text: title }), el('button', { class: 'modal-close', html: '&times;', 'aria-label': 'Close', onclick: closeModal })]),
    el('div', { class: 'modal-body' }, body),
    foot ? el('div', { class: 'modal-foot' }, foot) : null,
  ]);
}

// ---------- Count-up ----------
function reducedMotion() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }
function countUp(node, target, fmt) {
  fmt = fmt || ((v) => String(Math.round(v)));
  if (reducedMotion()) { node.textContent = fmt(target); return; }
  const dur = 900, start = performance.now();
  function step(now) {
    const p = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    node.textContent = fmt(target * e);
    if (p < 1) requestAnimationFrame(step); else node.textContent = fmt(target);
  }
  requestAnimationFrame(step);
}

// ---------- Confetti ----------
function confetti() {
  if (reducedMotion()) return;
  const c = el('canvas', { style: 'position:fixed;inset:0;pointer-events:none;z-index:9998' });
  document.body.appendChild(c); const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1; c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.scale(dpr, dpr);
  const colors = ['#1FE08A', '#8B5CF6', '#FBBF24', '#3B82F6', '#6EE7B7'];
  const parts = Array.from({ length: 130 }, () => ({ x: innerWidth / 2, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 14, vy: Math.random() * -15 - 4, g: 0.32 + Math.random() * 0.2, s: 5 + Math.random() * 6, c: colors[Math.floor(Math.random() * colors.length)], r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4 }));
  let frame = 0;
  (function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts.forEach((p) => { p.vy += p.g; p.x += p.vx; p.y += p.vy; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore(); });
    if (frame++ < 130) requestAnimationFrame(tick); else c.remove();
  })();
}

// ---------- Inline SVG chart (draw-on) ----------
function renderChart(series, opts = {}) {
  const field = opts.field || 'volume';
  const w = 760, h = 200, pad = { t: 12, r: 8, b: 22, l: 8 };
  const vals = series.map((d) => d[field]); const max = Math.max(1, ...vals);
  const iW = w - pad.l - pad.r, iH = h - pad.t - pad.b, n = series.length;
  const x = (i) => pad.l + (n <= 1 ? iW / 2 : (i / (n - 1)) * iW);
  const y = (v) => pad.t + iH - (v / max) * iH;
  let line = ''; series.forEach((d, i) => { line += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(d[field]).toFixed(1) + ' '; });
  const area = line + `L${x(n - 1).toFixed(1)} ${(pad.t + iH).toFixed(1)} L${x(0).toFixed(1)} ${(pad.t + iH).toFixed(1)} Z`;
  const color = opts.color || 'var(--accent)'; const fill = opts.fill || 'cg';
  let grid = ''; for (let g = 0; g <= 3; g++) { const gy = (pad.t + (iH / 3) * g).toFixed(1); grid += `<line x1="${pad.l}" y1="${gy}" x2="${w - pad.r}" y2="${gy}" stroke="var(--border)" stroke-width="1"/>`; }
  const drawCls = reducedMotion() ? '' : 'draw';
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="${fill}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".34"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path d="${area}" fill="url(#${fill})"/><path class="line ${drawCls}" d="${line}" stroke="${color}"/></svg>`;
}

// ---------- Empty state ----------
function emptyState(icon, title, sub) {
  return el('div', { class: 'empty-state' }, [el('div', { class: 'big', text: icon }), el('div', { html: '<strong>' + escapeHtml(title) + '</strong>' }), sub ? el('div', { class: 'small muted mt8', text: sub }) : null]);
}

// ---------- Skeleton ----------
function skeleton(lines = 3) { return el('div', { class: 'card' }, Array.from({ length: lines }, (_, i) => el('div', { class: 'skel skel-line', style: `width:${[90, 70, 80, 60][i % 4]}%` }))); }

// ---------- Command palette ----------
let COMMANDS = [];
function setCommands(cmds) { COMMANDS = cmds; }
function openPalette() {
  let bd = $('#cmdk'); if (bd) return;
  bd = el('div', { id: 'cmdk', class: 'cmdk-backdrop open' });
  const input = el('input', { type: 'text', placeholder: t('cmdk.placeholder') || 'Type a command…', 'aria-label': 'Command' });
  const list = el('div', { class: 'cmdk-list' });
  bd.appendChild(el('div', { class: 'cmdk' }, [input, list]));
  bd.addEventListener('click', (e) => { if (e.target === bd) closePalette(); });
  document.body.appendChild(bd); input.focus();
  let sel = 0, filtered = COMMANDS.slice();
  function render() {
    list.innerHTML = '';
    if (!filtered.length) { list.appendChild(el('div', { class: 'cmdk-empty', text: t('cmdk.empty') || 'No results' })); return; }
    filtered.forEach((c, i) => list.appendChild(el('div', { class: 'cmdk-item' + (i === sel ? ' sel' : ''), onclick: () => run(c) }, [el('span', { text: (c.icon || '›') + '  ' + c.label }), c.hint ? el('span', { class: 'k', text: c.hint }) : null])));
  }
  function run(c) { closePalette(); c.run(); }
  input.addEventListener('input', () => { const q = input.value.toLowerCase(); filtered = COMMANDS.filter((c) => c.label.toLowerCase().includes(q)); sel = 0; render(); });
  bd.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(filtered.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (filtered[sel]) run(filtered[sel]); }
    else if (e.key === 'Escape') closePalette();
  });
  render();
}
function closePalette() { const b = $('#cmdk'); if (b) b.remove(); }
document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if ($('#cmdk')) closePalette(); else if (COMMANDS.length) openPalette(); } });

// ---------- QR (via CDN qrcodejs, lazy) ----------
function qrCanvas(text, size = 160) {
  const box = el('div', { class: 'qr-box' });
  const make = () => { try { new window.QRCode(box, { text, width: size, height: size, colorDark: '#0B1424', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M }); } catch { box.textContent = 'QR'; } };
  if (window.QRCode) make();
  else { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'; s.onload = make; s.onerror = () => { box.textContent = 'QR'; }; document.head.appendChild(s); }
  return box;
}

// ---------- Boot: theme + locale ----------
const ready = (async () => { await loadLocale(detectLang()); })();
document.addEventListener('DOMContentLoaded', () => { ready.then(() => applyI18n(document)); });
// Theme is applied pre-paint by an inline head snippet; ensure attr exists.
if (!document.documentElement.getAttribute('data-theme')) applyTheme(getTheme());

// PWA: register the service worker (installable + offline fallback).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

window.PP = {
  $, $$, el, escapeHtml, money, centsFromDollars, pct, fmtDate, fmtDateTime, timeAgo, brandIcon, brandMark,
  api, getSession, requireRole, logout, toast, copyText, openModal, closeModal, modalShell, renderChart, emptyState,
  skeleton, countUp, confetti, reducedMotion,
  t, setLocale, applyI18n, detectLang, LOCALES, LOCALE_NAMES, get LANG() { return LANG; }, ready,
  getTheme, applyTheme, toggleTheme, topControls, ICON,
  setCommands, openPalette, closePalette, qrCanvas,
};
