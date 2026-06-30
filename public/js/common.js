/* Pierson Pay — shared frontend helpers (vanilla JS, no build step). */

// ---- DOM ----
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

// ---- Money / formatting ----
function money(cents, withSign = false) {
  const n = Number(cents) || 0;
  const neg = n < 0;
  const s = '$' + (Math.abs(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (withSign) return (neg ? '−' : '+') + s;
  return (neg ? '−' : '') + s;
}
function centsFromDollars(str) {
  const cleaned = String(str).replace(/[^0-9.\-]/g, '');
  const v = Number(cleaned);
  return Number.isFinite(v) ? Math.round(v * 100) : NaN;
}
function pct(bps) { return (bps / 100).toFixed(2) + '%'; }

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateTime(ms) {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24); if (d < 30) return d + 'd ago';
  return fmtDate(ms);
}
function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function brandIcon(brand) {
  const map = { visa: 'VISA', mastercard: 'MC', amex: 'AMEX', discover: 'DISC', unknown: 'CARD' };
  return map[brand] || 'CARD';
}

// ---- API client ----
async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  if (opts.headers) Object.assign(init.headers, opts.headers);
  const res = await fetch(path, init);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || (data && data.error) || `Request failed (${res.status})`;
    const err = new Error(typeof msg === 'string' ? msg : 'Request failed');
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

// ---- Session ----
async function getSession() {
  try { return await api('/auth/me'); } catch { return { authenticated: false }; }
}
async function requireRole(role) {
  const s = await getSession();
  if (!s.authenticated) { location.href = '/login'; throw new Error('redirect'); }
  if (role && s.user.role !== role) {
    location.href = s.user.role === 'admin' ? '/admin' : '/dashboard';
    throw new Error('redirect');
  }
  return s;
}
async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  location.href = '/login';
}

// ---- Toasts ----
function toast(msg, type = '') {
  let host = $('#toasts');
  if (!host) { host = el('div', { id: 'toasts' }); document.body.appendChild(host); }
  const t = el('div', { class: 'toast ' + type, text: msg });
  host.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; t.style.transition = 'all .3s'; setTimeout(() => t.remove(), 320); }, 3600);
}

// ---- Copy to clipboard ----
function copyText(text, label = 'Copied') {
  const done = () => toast(label, 'success');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else { fallbackCopy(text, done); }
}
function fallbackCopy(text, done) {
  const ta = el('textarea', { html: '' }); ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch {} ta.remove();
}

// ---- Modal ----
function openModal(node) {
  let backdrop = $('#modal-backdrop');
  if (!backdrop) {
    backdrop = el('div', { id: 'modal-backdrop', class: 'modal-backdrop' });
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
    document.body.appendChild(backdrop);
  }
  backdrop.innerHTML = '';
  backdrop.appendChild(node);
  backdrop.classList.add('open');
  document.addEventListener('keydown', escClose);
}
function escClose(e) { if (e.key === 'Escape') closeModal(); }
function closeModal() {
  const b = $('#modal-backdrop');
  if (b) { b.classList.remove('open'); b.innerHTML = ''; }
  document.removeEventListener('keydown', escClose);
}
function modalShell(title, bodyNode, footNode) {
  return el('div', { class: 'modal' }, [
    el('div', { class: 'modal-head' }, [
      el('h3', { text: title }),
      el('button', { class: 'modal-close', html: '&times;', onclick: closeModal }),
    ]),
    el('div', { class: 'modal-body' }, bodyNode),
    footNode ? el('div', { class: 'modal-foot' }, footNode) : null,
  ]);
}

// ---- Inline SVG chart (area + line) ----
function renderChart(series, opts = {}) {
  const field = opts.field || 'volume';
  const w = 760, h = 200, pad = { t: 12, r: 8, b: 22, l: 8 };
  const vals = series.map((d) => d[field]);
  const max = Math.max(1, ...vals);
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const n = series.length;
  const x = (i) => pad.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v) => pad.t + innerH - (v / max) * innerH;
  let line = '', area = '';
  series.forEach((d, i) => {
    const px = x(i).toFixed(1), py = y(d[field]).toFixed(1);
    line += (i === 0 ? 'M' : 'L') + px + ' ' + py + ' ';
  });
  area = line + `L${x(n - 1).toFixed(1)} ${(pad.t + innerH).toFixed(1)} L${x(0).toFixed(1)} ${(pad.t + innerH).toFixed(1)} Z`;
  const color = opts.color || 'var(--blue-light)';
  const fill = opts.fill || 'chartGrad';
  // gridlines
  let grid = '';
  for (let g = 0; g <= 3; g++) {
    const gy = (pad.t + (innerH / 3) * g).toFixed(1);
    grid += `<line x1="${pad.l}" y1="${gy}" x2="${w - pad.r}" y2="${gy}" stroke="rgba(123,170,247,0.08)" stroke-width="1"/>`;
  }
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="${fill}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#${fill})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

// ---- Empty state ----
function emptyState(icon, title, sub) {
  return el('div', { class: 'empty-state' }, [
    el('div', { class: 'big', text: icon }),
    el('div', { html: '<strong>' + escapeHtml(title) + '</strong>' }),
    sub ? el('div', { class: 'small muted mt8', text: sub }) : null,
  ]);
}

// expose
window.PP = {
  $, $$, el, money, centsFromDollars, pct, fmtDate, fmtDateTime, timeAgo, escapeHtml, brandIcon,
  api, getSession, requireRole, logout, toast, copyText, openModal, closeModal, modalShell, renderChart, emptyState,
};
