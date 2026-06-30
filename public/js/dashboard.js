/* Transfado — merchant dashboard */
(function () {
  const {
    $, $$, el, money, centsFromDollars, pct, fmtDate, fmtDateTime, timeAgo, escapeHtml, brandIcon,
    api, requireRole, logout, toast, copyText, openModal, closeModal, modalShell, renderChart, emptyState,
    t, topControls, countUp, qrCanvas, skeleton, openPalette, setCommands, brandMark,
  } = window.PP;

  const STATE = { session: null, merchant: null, rates: null };

  // ---- Card input helper (number formatting + reader) ----
  function buildCardInputs(prefill = true) {
    const number = el('input', { type: 'text', inputmode: 'numeric', placeholder: '4242 4242 4242 4242', maxlength: '23', autocomplete: 'off' });
    const exp = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'MM / YY', maxlength: '7', autocomplete: 'off' });
    const cvc = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'CVC', maxlength: '4', autocomplete: 'off' });
    const warn = el('p', { class: 'help', style: 'color:var(--negative-text);display:none' });
    number.addEventListener('input', () => {
      let v = number.value.replace(/\D/g, '').slice(0, 19);
      number.value = v.replace(/(.{4})/g, '$1 ').trim();
      const d = number.value.replace(/\D/g, '');
      if (d.length >= 8 && !window.PP.isTestCard(d)) { warn.style.display = 'block'; warn.innerHTML = '⚠ That is not a test card. Real cards are never charged — use <b>4242 4242 4242 4242</b>.'; }
      else warn.style.display = 'none';
    });
    exp.addEventListener('input', () => {
      let v = exp.value.replace(/\D/g, '').slice(0, 4);
      if (v.length >= 3) v = v.slice(0, 2) + ' / ' + v.slice(2);
      exp.value = v;
    });
    cvc.addEventListener('input', () => { cvc.value = cvc.value.replace(/\D/g, ''); });
    if (prefill) { number.value = '4242 4242 4242 4242'; exp.value = '12 / 30'; cvc.value = '123'; }

    const node = el('div', {}, [
      el('div', { class: 'fee-break', style: 'margin-bottom:12px;border-color:var(--accent-ring)' }, [
        el('strong', { class: 'small', text: 'Sandbox — test cards only' }),
        el('p', { class: 'small muted', style: 'margin-top:6px', html: 'Real cards are <b>never charged</b>. Use <b>4242 4242 4242 4242</b> (approves) or <b>4000 0000 0000 0002</b> (declines). Any future expiry, any CVC.' }),
      ]),
      el('label', { class: 'field' }, [el('span', { text: 'Card number' }), number]),
      el('div', { class: 'field-row' }, [
        el('label', { class: 'field' }, [el('span', { text: 'Expiry' }), exp]),
        el('label', { class: 'field' }, [el('span', { text: 'CVC' }), cvc]),
      ]),
      warn,
    ]);
    function get() {
      const digits = number.value.replace(/\D/g, '');
      const ev = exp.value.replace(/\D/g, '');
      return { number: digits, exp_month: ev.slice(0, 2), exp_year: ev.slice(2), cvc: cvc.value };
    }
    return { node, get };
  }

  // ---- Live fee preview for an amount, given the merchant's price ----
  function feePreview(amountCents) {
    const p = STATE.rates && STATE.rates.price;
    if (!p || !Number.isFinite(amountCents) || amountCents <= 0) return null;
    if (STATE.rates.coupon && STATE.rates.coupon.waived) return { fee: 0, net: amountCents, waived: true };
    const fee = Math.round((amountCents * p.pct) / 10000) + p.fixed;
    const net = amountCents - Math.min(fee, amountCents);
    return { fee: Math.min(fee, amountCents), net };
  }

  function statusBadge(status) {
    return el('span', { class: 'badge ' + status, text: status.replace(/_/g, ' ') });
  }

  // ============================ NAV / ROUTER ============================
  const PAGES = ['overview', 'payments', 'links', 'subscriptions', 'payouts', 'developers', 'settings'];

  function setPage(name) {
    if (!PAGES.includes(name)) name = 'overview';
    $$('.side-link[data-page]').forEach((a) => a.classList.toggle('active', a.dataset.page === name));
    $$('.page').forEach((p) => p.classList.remove('active'));
    $('#page-' + name).classList.add('active');
    $('#page-title').textContent = t('dash.' + name);
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    RENDER[name]();
  }

  // ============================ OVERVIEW ============================
  async function renderOverview() {
    const host = $('#page-overview');
    host.innerHTML = ''; host.appendChild(el('div', { class: 'stat-grid' }, [skeleton(2), skeleton(2), skeleton(2), skeleton(2)]));
    const data = await api('/api/merchant/overview');
    STATE.rates = data.rates;
    const m = data.metrics;
    host.innerHTML = '';

    const waived = data.rates.coupon && data.rates.coupon.waived;
    const feeSub = waived ? t('coupon.feesWaived') : t('dash.yourRate', { rate: data.rates.price ? data.rates.price.label : '—' });
    const stats = el('div', { class: 'stat-grid stagger' }, [
      tile(t('dash.availableBalance'), money(m.balance), 'green', t('dash.readyPayout'), m.balance),
      tile(t('dash.mrr'), money(m.mrr), 'gold', t('dash.activeSubs', { n: m.activeSubscriptions }), m.mrr),
      tile(t('dash.volume30'), money(sum(m.series, 'volume')), '', m.chargeCount + ' charges', sum(m.series, 'volume')),
      tile(waived ? t('dash.feesWaived') : t('dash.feesPaid'), money(m.feesPaid), waived ? 'green' : 'red', feeSub, m.feesPaid),
    ]);

    const chartCard = el('div', { class: 'card' }, [
      el('div', { class: 'row-between mb16' }, [el('div', { class: 'panel-title', text: t('dash.volume30'), style: 'margin:0' }), el('div', { class: 'small muted', text: money(sum(m.series, 'volume')) })]),
      el('div', { html: renderChart(m.series, { field: 'volume', color: 'var(--accent)' }) }),
    ]);

    const recent = el('div', { class: 'card' }, [
      el('div', { class: 'row-between mb16' }, [el('h3', { text: t('dash.recentActivity') }), el('a', { class: 'small', href: '#payments', text: t('common.viewall') + ' →', onclick: () => setPage('payments') })]),
      data.recentTransactions.length ? txnTable(data.recentTransactions.slice(0, 8), false) : emptyState('💳', 'No payments yet'),
    ]);

    // Sandbox notice (always — it's not real money yet).
    host.appendChild(el('div', { class: 'card mb24', style: 'display:flex;align-items:center;gap:12px;border-color:var(--border-strong)' }, [
      el('span', { class: 'badge neutral plain', text: 'Sandbox' }),
      el('span', { class: 'small muted', text: 'Test mode — no real cards are charged. Your account, balances, and transactions are simulated until live processing is connected.' }),
    ]));

    // First-run onboarding checklist (hides once you're set up).
    const onboard = buildOnboarding(data);
    if (onboard) host.appendChild(onboard);

    if (waived) host.appendChild(el('div', { class: 'card mb24', style: 'border-color:var(--accent-ring);background:var(--accent-soft)' }, [el('div', { class: 'row gap8', style: 'align-items:center' }, [el('span', { class: 'badge active', text: t('coupon.feesWaived') }), el('span', { class: 'small', text: 'Code ' }), el('strong', { class: 'mono', text: data.rates.coupon.code }), el('span', { class: 'small muted', text: '— you keep 100% of every sale.' })])]));
    host.appendChild(stats);
    host.appendChild(el('div', { class: 'grid-side mt24' }, [chartCard, recent]));
  }

  function buildOnboarding(data) {
    const m = data.metrics, merch = data.merchant;
    const steps = [
      { done: m.chargeCount > 0, label: 'Take your first payment', go: 'payments' },
      { done: !!(merch && merch.payoutMethod), label: 'Add a payout method', go: 'payouts' },
      { done: false, label: 'Create a payment link', go: 'links' },
      { done: false, label: 'Get your API keys', go: 'developers' },
    ];
    const doneCount = steps.filter((s) => s.done).length;
    if (m.chargeCount > 0 && merch && merch.payoutMethod) return null; // set up enough — hide
    const check = (on) => '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="' + (on ? 'var(--positive)' : 'var(--text-dim)') + '" stroke-width="2"><circle cx="12" cy="12" r="9"/>' + (on ? '<path d="M8 12l3 3 5-6" stroke-linecap="round" stroke-linejoin="round"/>' : '') + '</svg>';
    return el('div', { class: 'card mb24' }, [
      el('div', { class: 'row-between mb16' }, [el('h3', { text: 'Get started' }), el('span', { class: 'small muted', text: doneCount + ' of ' + steps.length + ' done' })]),
      el('div', {}, steps.map((s) => el('div', { class: 'row gap8 row-link', style: 'align-items:center;padding:9px 0;border-bottom:1px solid var(--border)', onclick: () => setPage(s.go) }, [
        el('span', { html: check(s.done) }),
        el('span', { style: s.done ? 'color:var(--text-muted);text-decoration:line-through' : '', text: s.label }),
        el('span', { class: 'grow' }),
        s.done ? null : el('span', { class: 'small', style: 'color:var(--accent)', text: 'Start →' }),
      ]))),
    ]);
  }

  function tile(label, value, color, sub, count) {
    const valNode = el('div', { class: 'stat-value countup ' + (color || ''), text: value });
    if (count != null) countUp(valNode, count, (v) => money(Math.round(v)));
    return el('div', { class: 'stat ' + (color || '') }, [
      el('div', { class: 'stat-label', text: label }),
      valNode,
      sub ? el('div', { class: 'stat-sub', text: sub }) : null,
    ]);
  }
  const sum = (arr, f) => arr.reduce((s, x) => s + (x[f] || 0), 0);

  // ============================ PAYMENTS (terminal + table) ============================
  async function renderPayments() {
    const host = $('#page-payments');
    host.innerHTML = '<div class="loading-block"><span class="spinner"></span></div>';
    const [{ data: txns }] = await Promise.all([api('/api/merchant/transactions?limit=200')]);
    if (!STATE.rates) STATE.rates = await api('/api/merchant/fees');
    host.innerHTML = '';

    // --- Virtual terminal ---
    const amount = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0.00' });
    const desc = el('input', { type: 'text', placeholder: 'What is this for?' });
    const cname = el('input', { type: 'text', placeholder: 'Customer name' });
    const cemail = el('input', { type: 'email', placeholder: 'customer@email.com' });
    const card = buildCardInputs();
    const feeBox = el('div', { class: 'fee-break mt8', style: 'display:none' });
    const errBox = el('div', { class: 'form-error' });
    const payBtn = el('button', { class: 'btn btn-primary btn-lg btn-block', text: 'Charge card' });

    function refreshFee() {
      const cents = centsFromDollars(amount.value);
      const fp = feePreview(cents);
      if (!fp) { feeBox.style.display = 'none'; return; }
      feeBox.style.display = 'block';
      feeBox.innerHTML = '';
      feeBox.appendChild(rowKV('Charge amount', money(cents)));
      feeBox.appendChild(rowKV('Processing fee (' + STATE.rates.price.label + ')', '−' + money(fp.fee)));
      const total = el('div', { class: 'row-between total' }, [el('span', { text: 'You receive' }), el('span', { text: money(fp.net) })]);
      feeBox.appendChild(total);
    }
    amount.addEventListener('input', refreshFee);

    payBtn.addEventListener('click', async () => {
      errBox.textContent = '';
      const cents = centsFromDollars(amount.value);
      if (!Number.isFinite(cents) || cents < 50) { errBox.textContent = 'Enter an amount of at least $0.50.'; return; }
      payBtn.disabled = true; payBtn.innerHTML = '<span class="spinner"></span>';
      try {
        const res = await api('/api/merchant/charges', { method: 'POST', body: {
          amount: cents, description: desc.value, customerName: cname.value, customerEmail: cemail.value, card: card.get(),
        }});
        toast('Payment of ' + money(res.charge.amount) + ' approved ✓', 'success');
        amount.value = ''; desc.value = ''; cname.value = ''; cemail.value = ''; refreshFee();
        renderPayments();
      } catch (ex) {
        errBox.textContent = ex.message || 'The charge was declined.';
      } finally { payBtn.disabled = false; payBtn.textContent = 'Charge card'; }
    });

    const terminal = el('div', { class: 'card' }, [
      el('h3', { class: 'mb16', text: 'Virtual terminal' }),
      el('label', { class: 'field' }, [el('span', { text: 'Amount (USD)' }),
        el('div', { class: 'input-group' }, [el('span', { class: 'input-prefix', text: '$' }), amount])]),
      feeBox,
      el('label', { class: 'field mt16' }, [el('span', { text: 'Description' }), desc]),
      el('div', { class: 'field-row' }, [
        el('label', { class: 'field' }, [el('span', { text: 'Customer name' }), cname]),
        el('label', { class: 'field' }, [el('span', { text: 'Customer email' }), cemail]),
      ]),
      card.node,
      errBox,
      payBtn,
    ]);

    // Search + filter + CSV export
    const search = el('input', { type: 'search', placeholder: t('common.search') + '…', style: 'max-width:240px' });
    const statusSel = el('select', { style: 'max-width:150px' }, [
      el('option', { value: 'all', text: t('common.all') }),
      el('option', { value: 'succeeded', text: 'Succeeded' }),
      el('option', { value: 'failed', text: 'Failed' }),
      el('option', { value: 'refunded', text: 'Refunded' }),
    ]);
    const results = el('div', {});
    let debounce;
    async function loadTxns() {
      const qs = new URLSearchParams({ q: search.value, status: statusSel.value, limit: '300' }).toString();
      results.innerHTML = '<div class="loading-block"><span class="spinner"></span></div>';
      const { data } = await api('/api/merchant/transactions?' + qs);
      results.innerHTML = '';
      results.appendChild(el('div', { class: 'small muted mb16', text: data.length + ' result' + (data.length === 1 ? '' : 's') }));
      results.appendChild(data.length ? txnTable(data, true) : emptyState('🧾', 'No transactions match'));
    }
    search.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(loadTxns, 250); });
    statusSel.addEventListener('change', loadTxns);
    const csvBtn = el('a', { class: 'btn btn-ghost btn-sm', href: '/api/merchant/transactions.csv', text: '↓ ' + t('common.export') });

    const tableCard = el('div', { class: 'card' }, [
      el('div', { class: 'row-between mb16 wrap' }, [el('h3', { text: t('dash.transactions') }), el('div', { class: 'row gap8 wrap', style: 'align-items:center' }, [search, statusSel, csvBtn])]),
      results,
    ]);

    host.appendChild(el('div', { class: 'grid-side' }, [tableCard, terminal]));
    loadTxns();
  }

  function rowKV(k, v) { return el('div', { class: 'row-between' }, [el('span', { class: 'muted', text: k }), el('span', { text: v })]); }

  function txnTable(txns, withRefund) {
    const rows = txns.map((t) => {
      const tds = [
        el('td', {}, [el('strong', { text: money(t.amount) }), t.amount_refunded ? el('div', { class: 'tiny muted', text: money(t.amount_refunded) + ' refunded' }) : null]),
        el('td', {}, [statusBadge(t.status)]),
        el('td', { html: '<span class="small">' + escapeHtml(t.description || '—') + '</span>' }),
        el('td', { class: 'small' }, [t.card ? el('span', {}, [el('span', { class: 'mono tiny', text: brandIcon(t.card.brand) + ' ••' + (t.card.last4 || '') })]) : '—']),
        el('td', { class: 'small muted', text: t.customer && t.customer.email ? t.customer.email : '—' }),
        el('td', { class: 'small muted nowrap', text: timeAgo(t.created_iso ? Date.parse(t.created_iso) : t.created * 1000) }),
      ];
      if (withRefund) {
        const canRefund = (t.status === 'succeeded' || t.status === 'partially_refunded');
        tds.push(el('td', { class: 'num' }, [canRefund ? el('button', { class: 'btn btn-ghost btn-sm', text: 'Refund', onclick: () => refundFlow(t) }) : el('span', { class: 'tiny dim', text: '—' })]));
      }
      return el('tr', {}, tds);
    });
    const head = ['Amount', 'Status', 'Description', 'Card', 'Customer', 'When'];
    if (withRefund) head.push('');
    return el('div', { class: 'table-wrap' }, [
      el('table', { class: 'data' }, [
        el('thead', {}, [el('tr', {}, head.map((h, i) => el('th', { class: i === head.length - 1 && withRefund ? 'num' : '', text: h })))]),
        el('tbody', {}, rows),
      ]),
    ]);
  }

  async function refundFlow(t) {
    const remaining = t.amount - (t.amount_refunded || 0);
    const amt = el('input', { type: 'text', value: (remaining / 100).toFixed(2) });
    const err = el('div', { class: 'form-error' });
    const confirm = el('button', { class: 'btn btn-danger', text: 'Refund ' + money(remaining) });
    confirm.addEventListener('click', async () => {
      const cents = centsFromDollars(amt.value);
      if (!Number.isFinite(cents) || cents <= 0) { err.textContent = 'Invalid amount.'; return; }
      confirm.disabled = true; confirm.innerHTML = '<span class="spinner"></span>';
      try {
        await api('/api/merchant/charges/' + t.id + '/refund', { method: 'POST', body: { amount: cents } });
        toast('Refunded ' + money(cents), 'success'); closeModal(); renderPayments();
      } catch (ex) { err.textContent = ex.message; confirm.disabled = false; confirm.textContent = 'Refund'; }
    });
    openModal(modalShell('Refund payment', [
      el('p', { class: 'muted mb16', text: 'Refunding charge ' + t.id + ' (' + money(t.amount) + ').' }),
      el('label', { class: 'field' }, [el('span', { text: 'Amount to refund' }),
        el('div', { class: 'input-group' }, [el('span', { class: 'input-prefix', text: '$' }), amt])]),
      err,
    ], [el('button', { class: 'btn btn-ghost', text: 'Cancel', onclick: closeModal }), confirm]));
  }

  // ============================ PAYMENT LINKS ============================
  async function renderLinks() {
    const host = $('#page-links');
    host.innerHTML = '<div class="loading-block"><span class="spinner"></span></div>';
    const { data: links } = await api('/api/merchant/payment-links');
    host.innerHTML = '';
    host.appendChild(el('div', { class: 'section-head' }, [
      el('div', {}, [el('h2', { text: 'Payment links' }), el('p', { class: 'muted small', text: 'Shareable checkout pages — one-time or recurring.' })]),
      el('button', { class: 'btn btn-primary', text: '+ New link', onclick: () => linkModal() }),
    ]));
    if (!links.length) { host.appendChild(el('div', { class: 'card' }, [emptyState('🔗', 'No payment links yet', 'Create a link and share it to get paid.')])); return; }

    const grid = el('div', { class: 'grid-3' }, links.map(linkCard));
    host.appendChild(grid);
  }

  function linkCard(l) {
    const url = location.origin + l.url;
    return el('div', { class: 'card' }, [
      el('div', { class: 'row-between mb8' }, [
        el('span', { class: 'badge ' + (l.mode === 'subscription' ? 'neutral' : 'succeeded') + ' plain', text: l.mode === 'subscription' ? 'Recurring' : 'One-time' }),
        el('span', { class: 'badge ' + (l.active ? 'active' : 'canceled'), text: l.active ? 'Active' : 'Off' }),
      ]),
      el('h3', { text: l.name }),
      el('div', { class: 'stat-value', style: 'font-size:26px;margin:6px 0', text: l.allowCustomAmount ? 'Customer chooses' : money(l.amount) + (l.mode === 'subscription' ? ' / ' + l.interval : '') }),
      l.description ? el('p', { class: 'small muted mb8', text: l.description }) : null,
      el('div', { class: 'small muted mb16', text: l.stats.payments + ' payment' + (l.stats.payments === 1 ? '' : 's') + ' · ' + money(l.stats.volume) }),
      el('div', { class: 'copy-field mb8' }, [el('code', { text: url }), el('button', { class: 'btn btn-ghost btn-sm', text: 'Copy', onclick: () => copyText(url, 'Link copied') })]),
      el('div', { class: 'row gap8' }, [
        el('a', { class: 'btn btn-ghost btn-sm grow center', href: l.url, target: '_blank', text: 'Open ↗' }),
        el('button', { class: 'btn btn-ghost btn-sm', text: 'QR', onclick: () => showQR(l, url) }),
        el('button', { class: 'btn btn-ghost btn-sm', text: l.active ? t('common.disable') : t('common.enable'), onclick: async () => { await api('/api/merchant/payment-links/' + l.id, { method: 'PATCH', body: { active: !l.active } }); renderLinks(); } }),
        el('button', { class: 'btn btn-danger btn-sm', text: '🗑', onclick: async () => { if (confirm('Delete this link?')) { await api('/api/merchant/payment-links/' + l.id, { method: 'DELETE' }); toast('Link deleted'); renderLinks(); } } }),
      ]),
    ]);
  }

  function showQR(l, url) {
    openModal(modalShell(l.name, [
      el('p', { class: 'muted mb16 center', text: 'Scan to pay' }),
      el('div', { class: 'center mb16' }, [qrCanvas(url, 200)]),
      el('div', { class: 'copy-field' }, [el('code', { text: url }), el('button', { class: 'btn btn-primary btn-sm', text: t('common.copy'), onclick: () => copyText(url, 'Link copied') })]),
    ]));
  }

  function linkModal() {
    const name = el('input', { type: 'text', placeholder: 'e.g. Deposit, Membership' });
    const mode = el('select', {}, [el('option', { value: 'payment', text: 'One-time payment' }), el('option', { value: 'subscription', text: 'Recurring subscription' })]);
    const amount = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0.00' });
    const interval = el('select', {}, [el('option', { value: 'month', text: 'Monthly' }), el('option', { value: 'week', text: 'Weekly' }), el('option', { value: 'year', text: 'Yearly' })]);
    const desc = el('input', { type: 'text', placeholder: 'Optional description' });
    const custom = el('input', { type: 'checkbox' });
    const intervalRow = el('label', { class: 'field', style: 'display:none' }, [el('span', { text: 'Billing interval' }), interval]);
    const customRow = el('label', { class: 'switch mb16' }, [custom, el('span', { class: 'track' }), el('span', { text: 'Let the customer choose the amount' })]);
    const amountRow = el('label', { class: 'field' }, [el('span', { text: 'Amount (USD)' }), el('div', { class: 'input-group' }, [el('span', { class: 'input-prefix', text: '$' }), amount])]);
    const err = el('div', { class: 'form-error' });

    mode.addEventListener('change', () => {
      const sub = mode.value === 'subscription';
      intervalRow.style.display = sub ? 'block' : 'none';
      customRow.style.display = sub ? 'none' : 'flex';
      if (sub) custom.checked = false, amountRow.style.display = 'block';
    });
    custom.addEventListener('change', () => { amountRow.style.display = custom.checked ? 'none' : 'block'; });

    const create = el('button', { class: 'btn btn-primary', text: 'Create link' });
    create.addEventListener('click', async () => {
      err.textContent = '';
      const body = { name: name.value, mode: mode.value, description: desc.value, allowCustomAmount: custom.checked, interval: interval.value };
      if (!custom.checked) body.amount = centsFromDollars(amount.value);
      create.disabled = true; create.innerHTML = '<span class="spinner"></span>';
      try {
        const res = await api('/api/merchant/payment-links', { method: 'POST', body });
        closeModal(); toast('Payment link created ✓', 'success'); renderLinks();
        showLinkCreated(res.link);
      } catch (ex) { err.textContent = ex.message; create.disabled = false; create.textContent = 'Create link'; }
    });

    openModal(modalShell('New payment link', [
      el('label', { class: 'field' }, [el('span', { text: 'Name' }), name]),
      el('label', { class: 'field' }, [el('span', { text: 'Type' }), mode]),
      intervalRow, customRow, amountRow,
      el('label', { class: 'field' }, [el('span', { text: 'Description' }), desc]),
      err,
    ], [el('button', { class: 'btn btn-ghost', text: 'Cancel', onclick: closeModal }), create]));
  }

  function showLinkCreated(l) {
    const url = location.origin + l.url;
    openModal(modalShell('Link ready 🔗', [
      el('p', { class: 'muted mb16', text: 'Share this link to collect payment:' }),
      el('div', { class: 'copy-field' }, [el('code', { text: url }), el('button', { class: 'btn btn-primary btn-sm', text: 'Copy', onclick: () => copyText(url, 'Link copied') })]),
      el('a', { class: 'btn btn-ghost btn-block mt16 center', href: l.url, target: '_blank', text: 'Open checkout ↗' }),
    ]));
  }

  // ============================ SUBSCRIPTIONS ============================
  async function renderSubscriptions() {
    const host = $('#page-subscriptions');
    host.innerHTML = '<div class="loading-block"><span class="spinner"></span></div>';
    const { data: subs } = await api('/api/merchant/subscriptions');
    if (!STATE.rates) STATE.rates = await api('/api/merchant/fees');
    host.innerHTML = '';
    const active = subs.filter((s) => s.status === 'active');
    const mrr = active.reduce((s, x) => s + x.mrr, 0);

    host.appendChild(el('div', { class: 'section-head' }, [
      el('div', {}, [el('h2', { text: 'Subscriptions' }), el('p', { class: 'muted small', text: 'Recurring billing. MRR: ' + money(mrr) + ' · ' + active.length + ' active' })]),
      el('button', { class: 'btn btn-primary', text: '+ New subscription', onclick: () => subscriptionModal() }),
    ]));

    host.appendChild(el('div', { class: 'stat-grid mb24' }, [
      tile('MRR', money(mrr), 'gold', 'Normalized monthly'),
      tile('Active subscribers', String(active.length), 'green'),
      tile('Annual run-rate', money(mrr * 12), '', 'MRR × 12'),
    ]));

    if (!subs.length) { host.appendChild(el('div', { class: 'card' }, [emptyState('🔁', 'No subscriptions yet', 'Start a recurring plan for a customer.')])); return; }

    const rows = subs.map((s) => el('tr', {}, [
      el('td', {}, [el('strong', { text: s.product_name }), el('div', { class: 'tiny muted', text: s.customer && s.customer.email ? s.customer.email : '' })]),
      el('td', {}, [el('strong', { text: money(s.amount) }), el('span', { class: 'tiny muted', text: ' / ' + s.interval })]),
      el('td', { class: 'num', text: money(s.mrr) }),
      el('td', {}, [statusBadge(s.status)]),
      el('td', { class: 'small muted nowrap', text: s.status === 'canceled' ? '—' : fmtDate(s.next_billing_at) }),
      el('td', { class: 'small muted', text: s.card ? brandIcon(s.card.brand) + ' ••' + s.card.last4 : '—' }),
      el('td', { class: 'num' }, [s.status !== 'canceled' ? el('button', { class: 'btn btn-ghost btn-sm', text: 'Cancel', onclick: async () => { if (confirm('Cancel this subscription?')) { await api('/api/merchant/subscriptions/' + s.id + '/cancel', { method: 'POST' }); toast('Subscription canceled'); renderSubscriptions(); } } }) : el('span', { class: 'tiny dim', text: '—' })]),
    ]));
    host.appendChild(el('div', { class: 'table-wrap' }, [el('table', { class: 'data' }, [
      el('thead', {}, [el('tr', {}, ['Product / customer', 'Price', 'MRR', 'Status', 'Next charge', 'Card', ''].map((h, i) => el('th', { class: i === 2 || i === 6 ? 'num' : '', text: h })))]),
      el('tbody', {}, rows),
    ])]));
  }

  function subscriptionModal() {
    const product = el('input', { type: 'text', placeholder: 'e.g. Gold Membership' });
    const amount = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0.00' });
    const interval = el('select', {}, [el('option', { value: 'month', text: 'Monthly' }), el('option', { value: 'week', text: 'Weekly' }), el('option', { value: 'year', text: 'Yearly' })]);
    const cname = el('input', { type: 'text', placeholder: 'Customer name' });
    const cemail = el('input', { type: 'email', placeholder: 'customer@email.com' });
    const card = buildCardInputs();
    const err = el('div', { class: 'form-error' });
    const create = el('button', { class: 'btn btn-primary', text: 'Start subscription' });
    create.addEventListener('click', async () => {
      err.textContent = '';
      const cents = centsFromDollars(amount.value);
      if (!Number.isFinite(cents) || cents < 50) { err.textContent = 'Amount must be at least $0.50.'; return; }
      create.disabled = true; create.innerHTML = '<span class="spinner"></span>';
      try {
        await api('/api/merchant/subscriptions', { method: 'POST', body: { productName: product.value, amount: cents, interval: interval.value, customerName: cname.value, customerEmail: cemail.value, card: card.get() } });
        closeModal(); toast('Subscription started — first payment charged ✓', 'success'); renderSubscriptions();
      } catch (ex) { err.textContent = ex.message; create.disabled = false; create.textContent = 'Start subscription'; }
    });
    openModal(modalShell('New subscription', [
      el('label', { class: 'field' }, [el('span', { text: 'Product name' }), product]),
      el('div', { class: 'field-row' }, [
        el('label', { class: 'field' }, [el('span', { text: 'Amount (USD)' }), el('div', { class: 'input-group' }, [el('span', { class: 'input-prefix', text: '$' }), amount])]),
        el('label', { class: 'field' }, [el('span', { text: 'Billing every' }), interval]),
      ]),
      el('div', { class: 'field-row' }, [
        el('label', { class: 'field' }, [el('span', { text: 'Customer name' }), cname]),
        el('label', { class: 'field' }, [el('span', { text: 'Customer email' }), cemail]),
      ]),
      card.node, err,
    ], [el('button', { class: 'btn btn-ghost', text: 'Cancel', onclick: closeModal }), create]));
  }

  // ============================ PAYOUTS ============================
  async function renderPayouts() {
    const host = $('#page-payouts');
    host.innerHTML = '<div class="loading-block"><span class="spinner"></span></div>';
    const { data: payouts, balance, payoutMethod } = await api('/api/merchant/payouts');
    host.innerHTML = '';

    const hasMethod = !!payoutMethod;
    const amount = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0.00' });
    const err = el('div', { class: 'form-error' });
    const btnLabel = hasMethod ? (payoutMethod.type === 'card' ? 'Pay out to card' : 'Pay out to bank') : 'Add a payout method first';
    const btn = el('button', { class: 'btn btn-green btn-block btn-lg', text: btnLabel, disabled: hasMethod ? null : 'disabled' });
    btn.addEventListener('click', async () => {
      err.textContent = '';
      const cents = centsFromDollars(amount.value);
      if (!Number.isFinite(cents) || cents <= 0) { err.textContent = 'Enter an amount.'; return; }
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      try { const r = await api('/api/merchant/payouts', { method: 'POST', body: { amount: cents } }); toast('Payout of ' + money(cents) + ' sent to ' + r.payout.destination + ' ✓', 'success'); renderPayouts(); }
      catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = btnLabel; }
    });

    // Payout method card
    const methodCard = el('div', { class: 'card mb24' }, [
      el('div', { class: 'row-between mb16' }, [el('h3', { text: 'Payout method' }), el('button', { class: 'btn btn-ghost btn-sm', text: hasMethod ? 'Change' : 'Add', onclick: () => payoutMethodModal(payoutMethod) })]),
      hasMethod
        ? el('div', { class: 'fee-break' }, [
            el('div', { class: 'row-between' }, [
              el('span', {}, [el('span', { class: 'badge neutral plain', text: payoutMethod.type === 'card' ? 'Debit card' : 'Bank account' })]),
              el('strong', { text: payoutMethod.label }),
            ]),
            payoutMethod.type === 'card' ? el('div', { class: 'row-between' }, [el('span', { class: 'muted', text: 'Expires' }), el('span', { text: String(payoutMethod.expMonth).padStart(2, '0') + '/' + payoutMethod.expYear })]) : null,
            payoutMethod.holderName ? el('div', { class: 'row-between' }, [el('span', { class: 'muted', text: 'Holder' }), el('span', { text: payoutMethod.holderName })]) : null,
          ])
        : el('p', { class: 'help', text: 'Add your debit card or bank account to receive payouts.' }),
    ]);

    const payoutCard = el('div', { class: 'card' }, [
      el('div', { class: 'stat-label', text: 'Available balance' }),
      el('div', { class: 'stat-value green', style: 'font-size:40px', text: money(balance) }),
      el('p', { class: 'help mb16', text: 'Funds from your sales, net of fees.' }),
      el('label', { class: 'field' }, [el('span', { text: 'Payout amount' }), el('div', { class: 'input-group' }, [el('span', { class: 'input-prefix', text: '$' }), amount])]),
      el('button', { class: 'btn btn-ghost btn-sm mb16', text: 'Pay out full balance', onclick: () => { amount.value = (balance / 100).toFixed(2); } }),
      err, btn,
      el('p', { class: 'help center mt16', text: hasMethod ? 'Destination: ' + payoutMethod.label + (payoutMethod.type === 'card' ? ' · instant' : ' · 1–2 business days') : 'No payout method set' }),
    ]);

    const rightCol = el('div', {}, [methodCard, payoutCard]);

    const historyCard = el('div', { class: 'card' }, [
      el('h3', { class: 'mb16', text: 'Payout history' }),
      payouts.length ? el('div', { class: 'table-wrap' }, [el('table', { class: 'data' }, [
        el('thead', {}, [el('tr', {}, ['Amount', 'Status', 'Destination', 'Date'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, payouts.map((p) => el('tr', {}, [
          el('td', {}, [el('strong', { text: money(p.amount) })]),
          el('td', {}, [statusBadge(p.status)]),
          el('td', { class: 'small muted', text: p.destination }),
          el('td', { class: 'small muted nowrap', text: fmtDate(p.createdAt) }),
        ]))),
      ])]) : emptyState('🏦', 'No payouts yet'),
    ]);

    host.appendChild(el('div', { class: 'grid-side' }, [historyCard, rightCol]));
  }

  function payoutMethodModal(current) {
    let type = current ? current.type : 'card';
    const seg = el('div', { class: 'segmented mb16' }, [
      el('button', { class: type === 'card' ? 'active' : '', text: 'Debit card', onclick: () => switchType('card') }),
      el('button', { class: type === 'bank' ? 'active' : '', text: 'Bank account', onclick: () => switchType('bank') }),
    ]);

    // Card fields
    const cardNum = el('input', { type: 'text', inputmode: 'numeric', placeholder: '4242 4242 4242 4242', maxlength: '23' });
    const cardExp = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'MM / YY', maxlength: '7' });
    cardNum.addEventListener('input', () => { let v = cardNum.value.replace(/\D/g, '').slice(0, 19); cardNum.value = v.replace(/(.{4})/g, '$1 ').trim(); });
    cardExp.addEventListener('input', () => { let v = cardExp.value.replace(/\D/g, '').slice(0, 4); if (v.length >= 3) v = v.slice(0, 2) + ' / ' + v.slice(2); cardExp.value = v; });
    const cardName = el('input', { type: 'text', placeholder: 'Name on card' });
    const cardFields = el('div', {}, [
      el('label', { class: 'field' }, [el('span', { text: 'Debit card number' }), cardNum]),
      el('div', { class: 'field-row' }, [
        el('label', { class: 'field' }, [el('span', { text: 'Expiry' }), cardExp]),
        el('label', { class: 'field' }, [el('span', { text: 'Name on card' }), cardName]),
      ]),
      el('p', { class: 'help', html: 'Sandbox: use <b>4242 4242 4242 4242</b>. Real payouts to a card require a live payout rail.' }),
    ]);

    // Bank fields
    const bankName = el('input', { type: 'text', placeholder: 'e.g. Chase' });
    const routing = el('input', { type: 'text', inputmode: 'numeric', placeholder: '9 digits', maxlength: '9' });
    const account = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'Account number' });
    const acctName = el('input', { type: 'text', placeholder: 'Account holder name' });
    routing.addEventListener('input', () => { routing.value = routing.value.replace(/\D/g, ''); });
    account.addEventListener('input', () => { account.value = account.value.replace(/\D/g, ''); });
    const bankFields = el('div', { style: 'display:none' }, [
      el('label', { class: 'field' }, [el('span', { text: 'Bank name' }), bankName]),
      el('div', { class: 'field-row' }, [
        el('label', { class: 'field' }, [el('span', { text: 'Routing number' }), routing]),
        el('label', { class: 'field' }, [el('span', { text: 'Account number' }), account]),
      ]),
      el('label', { class: 'field' }, [el('span', { text: 'Account holder name' }), acctName]),
    ]);

    function switchType(t) {
      type = t;
      seg.children[0].classList.toggle('active', t === 'card');
      seg.children[1].classList.toggle('active', t === 'bank');
      cardFields.style.display = t === 'card' ? 'block' : 'none';
      bankFields.style.display = t === 'bank' ? 'block' : 'none';
    }
    switchType(type);

    const err = el('div', { class: 'form-error' });
    const save = el('button', { class: 'btn btn-primary', text: 'Save payout method' });
    save.addEventListener('click', async () => {
      err.textContent = '';
      let body;
      if (type === 'card') {
        const ev = cardExp.value.replace(/\D/g, '');
        body = { type: 'card', number: cardNum.value.replace(/\D/g, ''), exp_month: ev.slice(0, 2), exp_year: ev.slice(2), name: cardName.value };
      } else {
        body = { type: 'bank', bankName: bankName.value, routingNumber: routing.value, accountNumber: account.value, name: acctName.value };
      }
      save.disabled = true; save.innerHTML = '<span class="spinner"></span>';
      try {
        await api('/api/merchant/payout-method', { method: 'PUT', body });
        toast('Payout method saved ✓', 'success'); closeModal(); renderPayouts();
      } catch (ex) { err.textContent = ex.message; save.disabled = false; save.textContent = 'Save payout method'; }
    });

    openModal(modalShell('Payout method', [seg, cardFields, bankFields, err], [el('button', { class: 'btn btn-ghost', text: 'Cancel', onclick: closeModal }), save]));
  }

  // ============================ DEVELOPERS ============================
  async function renderDevelopers() {
    const host = $('#page-developers');
    host.innerHTML = '<div class="loading-block"><span class="spinner"></span></div>';
    const keys = await api('/api/merchant/api-keys');
    host.innerHTML = '';
    let revealed = false;

    const secretCode = el('code', { text: maskKey(keys.secretKey) });
    const revealBtn = el('button', { class: 'btn btn-ghost btn-sm', text: 'Reveal' });
    revealBtn.addEventListener('click', () => { revealed = !revealed; secretCode.textContent = revealed ? keys.secretKey : maskKey(keys.secretKey); revealBtn.textContent = revealed ? 'Hide' : 'Reveal'; });

    const curl = `curl ${location.origin}/v1/charges \\
  -H "Authorization: Bearer ${keys.secretKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"amount":2500,"description":"Test","card":{"number":"4242424242424242","exp_month":12,"exp_year":2030,"cvc":"123"}}'`;

    host.appendChild(el('div', { class: 'section-head' }, [el('div', {}, [el('h2', { text: 'Developers' }), el('p', { class: 'muted small', text: 'Use the API to charge cards, create subscriptions, and generate links.' })]), el('a', { class: 'btn btn-ghost', href: '/docs', target: '_blank', text: 'API docs ↗' })]));

    host.appendChild(el('div', { class: 'grid-2' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'panel-title', text: 'Publishable key' }),
        el('div', { class: 'copy-field mb24' }, [el('code', { text: keys.publishableKey }), el('button', { class: 'btn btn-ghost btn-sm', text: 'Copy', onclick: () => copyText(keys.publishableKey, 'Copied') })]),
        el('div', { class: 'panel-title', text: 'Secret key' }),
        el('div', { class: 'copy-field' }, [secretCode, revealBtn, el('button', { class: 'btn btn-ghost btn-sm', text: 'Copy', onclick: () => copyText(keys.secretKey, 'Secret key copied') })]),
        el('p', { class: 'help', text: 'Keep your secret key safe — it can move money.' }),
        el('button', { class: 'btn btn-danger btn-sm mt16', text: '↻ Roll secret key', onclick: async () => { if (confirm('Roll your secret key? The old one stops working immediately.')) { const r = await api('/api/merchant/api-keys/rotate', { method: 'POST' }); toast('Secret key rolled', 'success'); renderDevelopers(); } } }),
      ]),
      el('div', { class: 'card' }, [
        el('div', { class: 'panel-title', text: 'Quick start — create a charge' }),
        el('pre', { class: 'mono', style: 'background:var(--bg-2);border:1px solid var(--border);border-radius:11px;padding:16px;overflow:auto;font-size:12.5px;line-height:1.6;color:var(--text);white-space:pre-wrap;word-break:break-all', text: curl }),
        el('button', { class: 'btn btn-ghost btn-sm mt16', text: 'Copy cURL', onclick: () => copyText(curl, 'Copied') }),
      ]),
    ]));

    const whHost = el('div', { class: 'mt24' });
    host.appendChild(whHost);
    renderWebhooks(whHost);
  }
  function maskKey(k) { return k.slice(0, 12) + '••••••••••••' + k.slice(-4); }

  async function renderWebhooks(host) {
    host.innerHTML = '<div class="loading-block"><span class="spinner"></span></div>';
    const { data, deliveries } = await api('/api/merchant/webhooks');
    host.innerHTML = '';
    const addBtn = el('button', { class: 'btn btn-primary btn-sm', text: '+ Add endpoint', onclick: () => webhookModal() });
    host.appendChild(el('div', { class: 'section-head' }, [el('div', {}, [el('h3', { text: 'Webhooks' }), el('p', { class: 'muted small', text: 'Receive signed events at your server. ' + data.length + ' endpoint(s).' })]), addBtn]));

    if (data.length) {
      host.appendChild(el('div', { class: 'mb24' }, data.map((ep) => el('div', { class: 'card mb16' }, [
        el('div', { class: 'row-between mb8 wrap' }, [el('strong', { class: 'mono small', text: ep.url }), el('div', { class: 'row gap8' }, [
          el('button', { class: 'btn btn-ghost btn-sm', text: 'Test', onclick: async () => { await api('/api/merchant/webhooks/' + ep.id + '/test', { method: 'POST' }); toast('Test event sent ✓', 'success'); renderWebhooks(host); } }),
          el('button', { class: 'btn btn-danger btn-sm', text: 'Delete', onclick: async () => { await api('/api/merchant/webhooks/' + ep.id, { method: 'DELETE' }); renderWebhooks(host); } }),
        ])]),
        el('div', { class: 'copy-field' }, [el('code', { text: ep.secret }), el('button', { class: 'btn btn-ghost btn-sm', text: 'Copy secret', onclick: () => copyText(ep.secret, 'Signing secret copied') })]),
      ]))));
    }

    host.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'panel-title', text: 'Recent deliveries' }),
      deliveries.length ? el('div', { class: 'table-wrap' }, [el('table', { class: 'data' }, [
        el('thead', {}, [el('tr', {}, ['Event', 'Status', 'When'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, deliveries.map((d) => el('tr', {}, [
          el('td', { class: 'mono small', text: d.type }),
          el('td', {}, [el('span', { class: 'badge ' + (d.success ? 'succeeded' : 'failed'), text: d.statusCode })]),
          el('td', { class: 'small muted nowrap', text: timeAgo(d.createdAt) }),
        ]))),
      ])]) : emptyState('🛰️', 'No deliveries yet'),
    ]));
  }

  function webhookModal() {
    const url = el('input', { type: 'url', placeholder: 'https://your-server.com/webhooks' });
    const err = el('div', { class: 'form-error' });
    const save = el('button', { class: 'btn btn-primary', text: 'Add endpoint' });
    save.addEventListener('click', async () => {
      err.textContent = '';
      try { await api('/api/merchant/webhooks', { method: 'POST', body: { url: url.value } }); closeModal(); toast('Endpoint added ✓', 'success'); renderDevelopers(); }
      catch (ex) { err.textContent = ex.message; }
    });
    openModal(modalShell('Add webhook endpoint', [el('label', { class: 'field' }, [el('span', { text: 'Endpoint URL' }), url]), el('p', { class: 'help', text: 'All events are sent, signed with a secret you can verify.' }), err], [el('button', { class: 'btn btn-ghost', text: t('common.cancel'), onclick: closeModal }), save]));
  }

  // ============================ SETTINGS ============================
  async function renderSettings() {
    const host = $('#page-settings');
    host.innerHTML = '<div class="loading-block"><span class="spinner"></span></div>';
    const [me, rates] = await Promise.all([api('/auth/me'), api('/api/merchant/fees')]);
    const m = me.merchant;
    host.innerHTML = '';

    const bn = el('input', { type: 'text', value: m.businessName });
    const cn = el('input', { type: 'text', value: m.contactName || '' });
    const web = el('input', { type: 'text', value: m.website || '' });
    const sd = el('input', { type: 'text', value: m.statementDescriptor, maxlength: '22' });
    const err = el('div', { class: 'form-error' });
    const save = el('button', { class: 'btn btn-primary', text: 'Save changes' });
    save.addEventListener('click', async () => {
      err.textContent = '';
      save.disabled = true; save.innerHTML = '<span class="spinner"></span>';
      try { await api('/api/merchant/settings', { method: 'PATCH', body: { businessName: bn.value, contactName: cn.value, website: web.value, statementDescriptor: sd.value } }); toast('Settings saved ✓', 'success'); refreshAccount(); }
      catch (ex) { err.textContent = ex.message; } finally { save.disabled = false; save.textContent = 'Save changes'; }
    });

    host.appendChild(el('div', { class: 'grid-2' }, [
      el('div', { class: 'card' }, [
        el('h3', { class: 'mb16', text: 'Business profile' }),
        el('label', { class: 'field' }, [el('span', { text: 'Business name' }), bn]),
        el('label', { class: 'field' }, [el('span', { text: 'Contact name' }), cn]),
        el('label', { class: 'field' }, [el('span', { text: 'Website' }), web]),
        el('label', { class: 'field' }, [el('span', { text: 'Statement descriptor' }), sd, el('p', { class: 'help', text: 'Up to 22 characters — appears on customer statements.' })]),
        err, save,
      ]),
      el('div', {}, [
        el('div', { class: 'card mb24' }, [
          el('h3', { class: 'mb16', text: 'Your processing rate' }),
          el('div', { class: 'fee-break' }, [
            rowKV('Rate plan', rates.planName + (rates.isCustom ? ' (custom)' : '')),
            rates.coupon && rates.coupon.waived
              ? el('div', { class: 'row-between total' }, [el('span', { text: 'You pay per transaction' }), el('span', { class: 'free', text: t('coupon.feesWaived') })])
              : el('div', { class: 'row-between total' }, [el('span', { text: 'You pay per transaction' }), el('span', { class: 'margin-hl', text: rates.price.label })]),
          ]),
          couponBox(rates),
        ]),
        el('div', { class: 'card' }, [
          el('h3', { class: 'mb16', text: t('common.theme') + ' & ' + t('common.language') }),
          el('p', { class: 'help mb16', text: 'Switch theme and language any time (also in the top bar).' }),
          el('div', { id: 'settings-ctl' }),
        ]),
        el('div', { class: 'card mt24' }, [
          el('h3', { class: 'mb16', text: 'Account' }),
          rowKV('Account ID', m.id),
          rowKV('Email', m.email),
          rowKV('Status', m.status),
          rowKV('Created', fmtDate(m.createdAt)),
        ]),
      ]),
    ]));
    $('#settings-ctl').appendChild(topControls());
  }

  function couponBox(rates) {
    const wrap = el('div', { class: 'mt16' });
    function render() {
      wrap.innerHTML = '';
      if (rates.coupon) {
        wrap.appendChild(el('div', { class: 'row-between' }, [
          el('span', { class: 'badge active', text: rates.coupon.label }),
          el('button', { class: 'btn btn-ghost btn-sm', text: t('common.delete'), onclick: async () => { await api('/api/merchant/coupons', { method: 'DELETE' }); toast('Code removed'); renderSettings(); } }),
        ]));
      } else {
        const code = el('input', { type: 'text', placeholder: 'e.g. FREE', style: 'text-transform:uppercase' });
        const btn = el('button', { class: 'btn btn-primary btn-sm', text: t('dash.redeemCoupon') });
        const e2 = el('div', { class: 'form-error' });
        btn.addEventListener('click', async () => {
          e2.textContent = '';
          try { const r = await api('/api/merchant/coupons/redeem', { method: 'POST', body: { code: code.value } }); toast(t('coupon.applied') + ': ' + r.coupon.label, 'success'); renderSettings(); }
          catch (ex) { e2.textContent = ex.message; }
        });
        wrap.appendChild(el('div', { class: 'row gap8', style: 'align-items:flex-start' }, [code, btn]));
        wrap.appendChild(e2);
      }
    }
    render();
    return wrap;
  }

  // ============================ BOOT ============================
  const RENDER = { overview: renderOverview, payments: renderPayments, links: renderLinks, subscriptions: renderSubscriptions, payouts: renderPayouts, developers: renderDevelopers, settings: renderSettings };

  function refreshAccount() {
    api('/auth/me').then((s) => {
      if (s.merchant) $('#side-account').innerHTML = '<strong style="color:var(--text)">' + escapeHtml(s.merchant.businessName) + '</strong><br>' + escapeHtml(s.user.email);
    });
  }

  // ============================ NOTIFICATIONS ============================
  async function refreshNotifBadge() {
    try { const { unread } = await api('/api/merchant/notifications'); $('#notif-dot').classList.toggle('hidden', !unread); } catch {}
  }
  async function openNotifications() {
    const { data } = await api('/api/merchant/notifications');
    await api('/api/merchant/notifications/read', { method: 'POST' }).catch(() => {});
    refreshNotifBadge();
    const icon = (ty) => ({ payment_received: '💰', payout_sent: '🏦', subscription_renewed: '🔁', payment_failed: '⚠️' }[ty] || '🔔');
    const body = data.length ? el('div', {}, data.map((n) => el('div', { class: 'row gap8', style: 'padding:11px 0;border-bottom:1px solid var(--border);align-items:flex-start' }, [
      el('span', { style: 'font-size:18px', text: icon(n.type) }),
      el('div', { class: 'grow' }, [el('div', {}, [el('strong', { text: n.title })]), el('div', { class: 'small muted', text: n.body }), el('div', { class: 'tiny dim mt8', text: timeAgo(n.createdAt) })]),
    ]))) : emptyState('🔔', 'No notifications yet');
    openModal(modalShell('Notifications', body));
  }

  function setupCommands() {
    setCommands([
      ...PAGES.map((p) => ({ label: t('dash.' + p), icon: '→', hint: '↵', run: () => setPage(p) })),
      { label: 'New payment', icon: '＋', run: () => setPage('payments') },
      { label: 'Toggle theme', icon: '◐', run: () => window.PP.toggleTheme() },
      { label: 'Notifications', icon: '🔔', run: openNotifications },
      { label: t('dash.signout'), icon: '→', run: logout },
    ]);
  }

  async function boot() {
    let s;
    try { s = await requireRole('merchant'); } catch { return; }
    await window.PP.ready;
    STATE.session = s; STATE.merchant = s.merchant;
    $('#mark').innerHTML = brandMark();
    $('#topctl').appendChild(topControls());
    window.PP.applyI18n(document);
    refreshAccount(); refreshNotifBadge(); setupCommands();
    $$('.side-link[data-page]').forEach((a) => a.addEventListener('click', () => setPage(a.dataset.page)));
    $('#logout-btn').addEventListener('click', logout);
    $('#quick-charge').addEventListener('click', () => setPage('payments'));
    $('#cmdk-btn').addEventListener('click', openPalette);
    $('#notif-btn').addEventListener('click', openNotifications);
    window.addEventListener('hashchange', () => setPage(location.hash.slice(1)));
    document.addEventListener('localechange', () => { window.PP.applyI18n(document); setupCommands(); setPage(location.hash.slice(1) || 'overview'); });
    setPage(location.hash.slice(1) || 'overview');
  }
  boot();
})();
