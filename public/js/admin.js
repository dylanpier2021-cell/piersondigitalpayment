/* Transfado — admin / processor console */
(function () {
  const {
    $, $$, el, money, centsFromDollars, pct, fmtDate, fmtDateTime, timeAgo, escapeHtml, brandIcon,
    api, requireRole, logout, toast, copyText, openModal, closeModal, modalShell, renderChart, emptyState,
    t, topControls, countUp, brandMark, openPalette, setCommands,
  } = window.PP;

  let PLANS = [];

  // bps <-> percent helpers
  const pctToBps = (s) => { const v = Number(String(s).replace(/[^0-9.\-]/g, '')); return Number.isFinite(v) ? Math.round(v * 100) : NaN; };
  const bpsToPct = (b) => (b / 100).toString();
  const dollarsToCents = (s) => { const v = Number(String(s).replace(/[^0-9.\-]/g, '')); return Number.isFinite(v) ? Math.round(v * 100) : NaN; };
  const centsToDollars = (c) => (c / 100).toFixed(2);

  function statusBadge(status) { return el('span', { class: 'badge ' + status, text: status.replace(/_/g, ' ') }); }
  const sum = (arr, f) => arr.reduce((s, x) => s + (x[f] || 0), 0);
  function tile(label, value, color, sub, count) {
    const valNode = el('div', { class: 'stat-value countup ' + (color || ''), text: value });
    if (count != null) countUp(valNode, count, (v) => money(Math.round(v)));
    return el('div', { class: 'stat ' + (color || '') }, [
      el('div', { class: 'stat-label', text: label }), valNode,
      sub ? el('div', { class: 'stat-sub', text: sub }) : null,
    ]);
  }
  function rowKV(k, v, cls) { return el('div', { class: 'row-between' }, [el('span', { class: 'muted', text: k }), el('span', { class: cls || '', text: v })]); }

  const PAGES = ['overview', 'clients', 'plans', 'coupons', 'transactions', 'settings'];
  const TITLE_KEY = { overview: 'admin.overview', clients: 'admin.clients', plans: 'admin.plans', coupons: 'admin.coupons', transactions: 'admin.transactions', settings: 'admin.settings' };
  function setPage(name) {
    if (!PAGES.includes(name)) name = 'overview';
    $$('.side-link[data-page]').forEach((a) => a.classList.toggle('active', a.dataset.page === name));
    $$('.page').forEach((p) => p.classList.remove('active'));
    $('#page-' + name).classList.add('active');
    $('#page-title').textContent = t(TITLE_KEY[name]);
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    RENDER[name]();
  }

  // ============================ OVERVIEW ============================
  async function renderOverview() {
    const host = $('#page-overview');
    const data = await api('/api/admin/overview');
    PLANS = data.feePlans;
    const m = data.metrics;
    host.innerHTML = '';

    host.appendChild(el('div', { class: 'stat-grid stagger' }, [
      tile(t('admin.totalVolume'), money(m.totalVolume), '', m.totalCharges + ' charges', m.totalVolume),
      tile(t('admin.yourRevenue'), money(m.piersonRevenue), '', 'Fees charged to clients', m.piersonRevenue),
      tile(t('admin.yourProfit'), money(m.piersonProfit), 'gold', 'Margin after cost', m.piersonProfit),
      tile(t('admin.processingCost'), money(m.processorCost), 'red', 'Your underlying cost', m.processorCost),
    ]));

    host.appendChild(el('div', { class: 'stat-grid mt16 stagger' }, [
      tile(t('admin.profitMrr'), money(m.piersonMrr), 'gold', 'Recurring margin / month', m.piersonMrr),
      tile(t('admin.platformMrr'), money(m.platformVolumeMrr), 'green', m.activeSubscriptions + ' active subscriptions', m.platformVolumeMrr),
      tile(t('admin.clients'), String(m.totalMerchants), '', m.activeMerchants + ' active'),
      tile(t('admin.owedClients'), money(m.payableBalance), '', 'Across all balances', m.payableBalance),
    ]));

    const volChart = el('div', { class: 'card' }, [
      el('div', { class: 'panel-title', text: t('admin.totalVolume') + ' — 30d' }),
      el('div', { html: renderChart(m.series, { field: 'volume', color: 'var(--accent)', fill: 'gVol' }) }),
    ]);
    const marginChart = el('div', { class: 'card' }, [
      el('div', { class: 'panel-title', text: t('admin.yourProfit') }),
      el('div', { html: renderChart(m.series, { field: 'margin', color: 'var(--gold)', fill: 'gMar' }) }),
    ]);
    host.appendChild(el('div', { class: 'grid-2 mt24' }, [volChart, marginChart]));

    const topRows = m.topMerchants.map((row) => el('tr', {}, [
      el('td', {}, [el('strong', { text: row.businessName })]),
      el('td', { class: 'num', text: money(row.volume) }),
      el('td', { class: 'num', html: '<span style="color:var(--gold)">' + money(row.margin) + '</span>' }),
      el('td', { class: 'num small muted', text: row.count }),
    ]));
    host.appendChild(el('div', { class: 'card mt24' }, [
      el('h3', { class: 'mb16', text: 'Top clients by volume' }),
      m.topMerchants.length ? el('div', { class: 'table-wrap' }, [el('table', { class: 'data' }, [
        el('thead', {}, [el('tr', {}, ['Client', 'Volume', 'Your profit', 'Charges'].map((h, i) => el('th', { class: i ? 'num' : '', text: h })))]),
        el('tbody', {}, topRows),
      ])]) : emptyState('📊', 'No data yet'),
    ]));
  }

  // ============================ CLIENTS ============================
  async function renderClients() {
    const host = $('#page-clients');
    host.innerHTML = '<div class="loading-block"><span class="spinner"></span></div>';
    const { data: clients } = await api('/api/admin/merchants');
    host.innerHTML = '';
    host.appendChild(el('div', { class: 'section-head' }, [
      el('div', {}, [el('h2', { text: 'Clients' }), el('p', { class: 'muted small', text: clients.length + ' merchant accounts processing through you' })]),
    ]));

    const rows = clients.map((c) => el('tr', { class: 'row-link', onclick: () => openClient(c.id) }, [
      el('td', {}, [el('strong', { text: c.businessName }), el('div', { class: 'tiny muted', text: c.email })]),
      el('td', {}, [statusBadge(c.status)]),
      el('td', { class: 'small' }, [el('span', { text: c.rates.planName }), c.rates.isCustom ? el('span', { class: 'badge neutral plain', style: 'margin-left:6px', text: 'custom' }) : null]),
      el('td', { class: 'small mono', text: c.rates.price.label }),
      el('td', { class: 'small mono', html: '<span style="color:var(--gold)">' + c.rates.margin.label + '</span>' }),
      el('td', { class: 'num', text: money(c.volume) }),
      el('td', { class: 'num', html: '<span style="color:var(--gold)">' + money(c.margin) + '</span>' }),
      el('td', { class: 'num', text: money(c.mrr) }),
      el('td', { class: 'num small muted', text: '›' }),
    ]));
    host.appendChild(el('div', { class: 'table-wrap' }, [el('table', { class: 'data' }, [
      el('thead', {}, [el('tr', {}, ['Client', 'Status', 'Plan', 'They pay', 'Your margin', 'Volume', 'Your profit', 'MRR', ''].map((h, i) => el('th', { class: i >= 5 ? 'num' : '', text: h })))]),
      el('tbody', {}, rows),
    ])]));
  }

  async function openClient(id) {
    const data = await api('/api/admin/merchants/' + id);
    const c = data.merchant;
    const r = c.rates;

    // Fee plan select
    const planSel = el('select', {}, [el('option', { value: '', text: '— No plan (custom only) —' })].concat(
      PLANS.map((p) => el('option', { value: p.id, text: p.name, selected: p.id === c.feePlanId }))
    ));

    // Override inputs (blank = inherit from plan)
    const ov = c.feeOverride || {};
    const ovPricePct = el('input', { type: 'text', placeholder: bpsToPct(r.price.pct), value: ov.pricePct != null ? bpsToPct(ov.pricePct) : '' });
    const ovPriceFixed = el('input', { type: 'text', placeholder: centsToDollars(r.price.fixed), value: ov.priceFixed != null ? centsToDollars(ov.priceFixed) : '' });
    const ovCostPct = el('input', { type: 'text', placeholder: bpsToPct(r.cost.pct), value: ov.costPct != null ? bpsToPct(ov.costPct) : '' });
    const ovCostFixed = el('input', { type: 'text', placeholder: centsToDollars(r.cost.fixed), value: ov.costFixed != null ? centsToDollars(ov.costFixed) : '' });
    const err = el('div', { class: 'form-error' });

    const marginNote = el('div', { class: 'fee-break mt8' });
    function refreshMargin() {
      const pp = ovPricePct.value ? pctToBps(ovPricePct.value) : r.price.pct;
      const pf = ovPriceFixed.value ? dollarsToCents(ovPriceFixed.value) : r.price.fixed;
      const cp = ovCostPct.value ? pctToBps(ovCostPct.value) : r.cost.pct;
      const cf = ovCostFixed.value ? dollarsToCents(ovCostFixed.value) : r.cost.fixed;
      marginNote.innerHTML = '';
      marginNote.appendChild(rowKV('Client pays', (pp / 100).toFixed(2) + '% + ' + money(pf)));
      marginNote.appendChild(rowKV('Your cost', (cp / 100).toFixed(2) + '% + ' + money(cf)));
      marginNote.appendChild(el('div', { class: 'row-between total' }, [el('span', { text: 'Your margin' }), el('span', { class: 'pierson', text: ((pp - cp) / 100).toFixed(2) + '% + ' + money(pf - cf) })]));
    }
    [ovPricePct, ovPriceFixed, ovCostPct, ovCostFixed].forEach((i) => i.addEventListener('input', refreshMargin));
    refreshMargin();

    const saveBtn = el('button', { class: 'btn btn-primary', text: 'Save fees' });
    const couponInput = el('input', { type: 'text', value: c.appliedCoupon || '', placeholder: 'e.g. FREE (waives all fees)', style: 'text-transform:uppercase' });

    saveBtn.addEventListener('click', async () => {
      err.textContent = '';
      const override = {};
      if (ovPricePct.value) override.pricePct = pctToBps(ovPricePct.value);
      if (ovPriceFixed.value) override.priceFixed = dollarsToCents(ovPriceFixed.value);
      if (ovCostPct.value) override.costPct = pctToBps(ovCostPct.value);
      if (ovCostFixed.value) override.costFixed = dollarsToCents(ovCostFixed.value);
      saveBtn.disabled = true; saveBtn.innerHTML = '<span class="spinner"></span>';
      try {
        await api('/api/admin/merchants/' + id, { method: 'PATCH', body: { feePlanId: planSel.value, feeOverride: Object.keys(override).length ? override : null, appliedCoupon: couponInput.value.trim() || null } });
        toast('Updated ' + c.businessName, 'success'); closeModal(); renderClients();
      } catch (ex) { err.textContent = ex.message; saveBtn.disabled = false; saveBtn.textContent = 'Save fees'; }
    });

    const suspendBtn = el('button', { class: c.status === 'active' ? 'btn btn-danger' : 'btn btn-green', text: c.status === 'active' ? 'Suspend account' : 'Reactivate' });
    suspendBtn.addEventListener('click', async () => {
      await api('/api/admin/merchants/' + id, { method: 'PATCH', body: { status: c.status === 'active' ? 'suspended' : 'active' } });
      toast('Account ' + (c.status === 'active' ? 'suspended' : 'reactivated')); closeModal(); renderClients();
    });

    const ovField = (label, input, prefix) => el('label', { class: 'field' }, [el('span', { text: label }), prefix ? el('div', { class: 'input-group' }, [el('span', { class: 'input-prefix', text: prefix }), input]) : input]);

    const body = el('div', {}, [
      el('div', { class: 'row-between mb16' }, [
        el('div', {}, [el('div', { class: 'small muted', text: c.email + ' · ' + c.id }), el('div', { class: 'small', text: 'Balance: ' + money(c.balance) + ' · MRR: ' + money(c.mrr) + ' · ' + c.chargeCount + ' charges' })]),
        statusBadge(c.status),
      ]),
      el('div', { class: 'panel-title', text: 'Fee plan' }), planSel,
      el('div', { class: 'panel-title mt24', text: 'Per-client override (blank = use plan)' }),
      el('div', { class: 'small muted mb16', text: "Set what this client pays you and your underlying cost. Margin updates live below." }),
      el('div', { class: 'field-row' }, [ovField('Client price %', ovPricePct), ovField('Client fixed', ovPriceFixed, '$')]),
      el('div', { class: 'field-row' }, [ovField('Your cost %', ovCostPct), ovField('Your cost fixed', ovCostFixed, '$')]),
      marginNote,
      el('div', { class: 'panel-title mt24', text: 'Coupon' }),
      el('div', { class: 'small muted mb8', text: c.couponLabel ? ('Active: ' + c.couponLabel) : 'Attach a code to discount or waive this client\'s fees.' }),
      couponInput,
      err,
    ]);

    openModal(modalShell(c.businessName, body, [suspendBtn, el('div', { class: 'grow' }), el('button', { class: 'btn btn-ghost', text: 'Close', onclick: closeModal }), saveBtn]));
  }

  // ============================ FEE PLANS ============================
  async function renderPlans() {
    const host = $('#page-plans');
    host.innerHTML = '<div class="loading-block"><span class="spinner"></span></div>';
    const [{ data: plans }, overview] = await Promise.all([api('/api/admin/fee-plans'), api('/api/admin/overview')]);
    PLANS = plans;
    const defaultId = overview.settings.defaultFeePlanId;
    const usage = {};
    (await api('/api/admin/merchants')).data.forEach((m) => { if (m.feePlanId) usage[m.feePlanId] = (usage[m.feePlanId] || 0) + 1; });
    host.innerHTML = '';
    host.appendChild(el('div', { class: 'section-head' }, [
      el('div', {}, [el('h2', { text: 'Fee plans' }), el('p', { class: 'muted small', text: 'Define your cost basis and what clients pay. The spread is your profit.' })]),
      el('button', { class: 'btn btn-primary', text: '+ New plan', onclick: () => planModal() }),
    ]));

    host.appendChild(el('div', { class: 'grid-3' }, plans.map((p) => el('div', { class: 'card' }, [
      el('div', { class: 'row-between mb8' }, [el('h3', { text: p.name }), defaultId === p.id ? el('span', { class: 'badge active plain', text: 'Default' }) : null]),
      p.description ? el('p', { class: 'small muted mb16', text: p.description }) : el('div', { class: 'mb16' }),
      el('div', { class: 'fee-break' }, [
        rowKV('Client pays', (p.pricePct / 100).toFixed(2) + '% + ' + money(p.priceFixed)),
        rowKV('Your cost', (p.costPct / 100).toFixed(2) + '% + ' + money(p.costFixed)),
        el('div', { class: 'row-between total' }, [el('span', { text: 'Your margin' }), el('span', { class: 'pierson', text: ((p.pricePct - p.costPct) / 100).toFixed(2) + '% + ' + money(p.priceFixed - p.costFixed) })]),
      ]),
      el('div', { class: 'small muted mt16 mb16', text: (usage[p.id] || 0) + ' client(s) on this plan' }),
      el('div', { class: 'row gap8' }, [
        el('button', { class: 'btn btn-ghost btn-sm grow', text: 'Edit', onclick: () => planModal(p) }),
        defaultId === p.id ? null : el('button', { class: 'btn btn-ghost btn-sm', text: 'Set default', onclick: async () => { await api('/api/admin/settings', { method: 'PATCH', body: { defaultFeePlanId: p.id } }); toast('Default plan set'); renderPlans(); } }),
        el('button', { class: 'btn btn-danger btn-sm', text: '🗑', onclick: async () => { if (confirm('Delete plan "' + p.name + '"?')) { try { await api('/api/admin/fee-plans/' + p.id, { method: 'DELETE' }); toast('Plan deleted'); renderPlans(); } catch (ex) { toast(ex.message, 'error'); } } } }),
      ]),
    ]))));
  }

  function planModal(plan) {
    const isEdit = !!plan;
    const name = el('input', { type: 'text', value: plan ? plan.name : '', placeholder: 'e.g. Standard' });
    const desc = el('input', { type: 'text', value: plan ? plan.description : '', placeholder: 'Optional' });
    const pricePct = el('input', { type: 'text', value: plan ? bpsToPct(plan.pricePct) : '3.5', placeholder: '3.5' });
    const priceFixed = el('input', { type: 'text', value: plan ? centsToDollars(plan.priceFixed) : '0.35', placeholder: '0.35' });
    const costPct = el('input', { type: 'text', value: plan ? bpsToPct(plan.costPct) : '2.9', placeholder: '2.9' });
    const costFixed = el('input', { type: 'text', value: plan ? centsToDollars(plan.costFixed) : '0.30', placeholder: '0.30' });
    const note = el('div', { class: 'fee-break mt8' });
    const err = el('div', { class: 'form-error' });
    function refresh() {
      const pp = pctToBps(pricePct.value), pf = dollarsToCents(priceFixed.value), cp = pctToBps(costPct.value), cf = dollarsToCents(costFixed.value);
      note.innerHTML = '';
      note.appendChild(el('div', { class: 'row-between total' }, [el('span', { text: 'Your margin' }), el('span', { class: 'pierson', text: (((pp - cp) || 0) / 100).toFixed(2) + '% + ' + money((pf - cf) || 0) })]));
    }
    [pricePct, priceFixed, costPct, costFixed].forEach((i) => i.addEventListener('input', refresh)); refresh();

    const fld = (label, input, prefix) => el('label', { class: 'field' }, [el('span', { text: label }), prefix ? el('div', { class: 'input-group' }, [el('span', { class: 'input-prefix', text: prefix }), input]) : input]);
    const save = el('button', { class: 'btn btn-primary', text: isEdit ? 'Save plan' : 'Create plan' });
    save.addEventListener('click', async () => {
      err.textContent = '';
      const body = { name: name.value, description: desc.value, pricePct: pctToBps(pricePct.value), priceFixed: dollarsToCents(priceFixed.value), costPct: pctToBps(costPct.value), costFixed: dollarsToCents(costFixed.value) };
      for (const k of ['pricePct', 'priceFixed', 'costPct', 'costFixed']) if (!Number.isFinite(body[k])) { err.textContent = 'Enter valid rate numbers.'; return; }
      save.disabled = true; save.innerHTML = '<span class="spinner"></span>';
      try {
        if (isEdit) await api('/api/admin/fee-plans/' + plan.id, { method: 'PATCH', body });
        else await api('/api/admin/fee-plans', { method: 'POST', body });
        toast('Plan saved ✓', 'success'); closeModal(); renderPlans();
      } catch (ex) { err.textContent = ex.message; save.disabled = false; save.textContent = isEdit ? 'Save plan' : 'Create plan'; }
    });

    openModal(modalShell(isEdit ? 'Edit fee plan' : 'New fee plan', [
      fld('Plan name', name), fld('Description', desc),
      el('div', { class: 'panel-title mt16', text: 'What the client pays you' }),
      el('div', { class: 'field-row' }, [fld('Percentage', pricePct, '%'), fld('Fixed fee', priceFixed, '$')]),
      el('div', { class: 'panel-title mt16', text: 'Your underlying cost' }),
      el('div', { class: 'field-row' }, [fld('Percentage', costPct, '%'), fld('Fixed fee', costFixed, '$')]),
      note, err,
    ], [el('button', { class: 'btn btn-ghost', text: 'Cancel', onclick: closeModal }), save]));
  }

  // ============================ TRANSACTIONS ============================
  async function renderTransactions() {
    const host = $('#page-transactions');
    host.innerHTML = '<div class="loading-block"><span class="spinner"></span></div>';
    const { data: txns } = await api('/api/admin/transactions?limit=300');
    host.innerHTML = '';
    host.appendChild(el('div', { class: 'section-head' }, [el('div', {}, [el('h2', { text: 'All transactions' }), el('p', { class: 'muted small', text: txns.length + ' most recent across all clients' })])]));
    const rows = txns.map((t) => el('tr', {}, [
      el('td', {}, [el('strong', { text: money(t.amount) }), t.amount_refunded ? el('div', { class: 'tiny muted', text: money(t.amount_refunded) + ' refunded' }) : null]),
      el('td', { class: 'small', text: t.merchantName }),
      el('td', {}, [statusBadge(t.status)]),
      el('td', { class: 'num small', html: t.fees ? '<span style="color:var(--gold)">' + money(t.fees.piersonMargin) + '</span>' : '<span class="dim">—</span>' }),
      el('td', { class: 'small muted', text: t.source }),
      el('td', { class: 'small', text: t.card ? brandIcon(t.card.brand) + ' ••' + t.card.last4 : '—' }),
      el('td', { class: 'small muted nowrap', text: timeAgo(t.created_iso ? Date.parse(t.created_iso) : t.created * 1000) }),
    ]));
    host.appendChild(el('div', { class: 'table-wrap' }, [el('table', { class: 'data' }, [
      el('thead', {}, [el('tr', {}, ['Amount', 'Client', 'Status', 'Your profit', 'Source', 'Card', 'When'].map((h, i) => el('th', { class: i === 3 ? 'num' : '', text: h })))]),
      el('tbody', {}, rows),
    ])]));
  }

  // ============================ SETTINGS ============================
  async function renderSettings() {
    const host = $('#page-settings');
    host.innerHTML = '<div class="loading-block"><span class="spinner"></span></div>';
    const [overview, events] = await Promise.all([api('/api/admin/overview'), api('/api/admin/events?limit=40')]);
    const s = overview.settings; PLANS = overview.feePlans;
    host.innerHTML = '';

    const pname = el('input', { type: 'text', value: s.platformName });
    const defSel = el('select', {}, [el('option', { value: '', text: '— None —' })].concat(PLANS.map((p) => el('option', { value: p.id, text: p.name, selected: p.id === s.defaultFeePlanId }))));
    const err = el('div', { class: 'form-error' });
    const save = el('button', { class: 'btn btn-primary', text: 'Save settings' });
    save.addEventListener('click', async () => {
      err.textContent = '';
      try { await api('/api/admin/settings', { method: 'PATCH', body: { platformName: pname.value, defaultFeePlanId: defSel.value } }); toast('Settings saved ✓', 'success'); }
      catch (ex) { err.textContent = ex.message; }
    });

    const evRows = events.data.map((e) => el('tr', {}, [
      el('td', { class: 'small mono', text: e.type }),
      el('td', { class: 'small muted', text: JSON.stringify(e.data).slice(0, 60) }),
      el('td', { class: 'small muted nowrap', text: timeAgo(e.createdAt) }),
    ]));

    host.appendChild(el('div', { class: 'grid-2' }, [
      el('div', { class: 'card' }, [
        el('h3', { class: 'mb16', text: 'Platform settings' }),
        el('label', { class: 'field' }, [el('span', { text: 'Platform name' }), pname]),
        el('label', { class: 'field' }, [el('span', { text: 'Default fee plan for new clients' }), defSel]),
        err, save,
        el('div', { class: 'side-sep', style: 'margin:24px 0' }),
        el('h3', { class: 'mb8', text: 'Recurring billing' }),
        el('p', { class: 'small muted mb16', text: 'Subscriptions auto-bill every minute. Run a cycle now to process anything due.' }),
        el('button', { class: 'btn btn-gold', text: '▶ Run billing cycle now', onclick: runBilling }),
      ]),
      el('div', { class: 'card' }, [
        el('h3', { class: 'mb16', text: 'Activity log' }),
        events.data.length ? el('div', { class: 'table-wrap' }, [el('table', { class: 'data' }, [
          el('thead', {}, [el('tr', {}, ['Event', 'Detail', 'When'].map((h) => el('th', { text: h })))]),
          el('tbody', {}, evRows),
        ])]) : emptyState('🗒', 'No events yet'),
      ]),
    ]));
  }

  async function runBilling() {
    try { const r = await api('/api/admin/billing/run', { method: 'POST' }); toast('Billing run: ' + r.charged + ' charged, ' + r.failed + ' failed', 'success'); }
    catch (ex) { toast(ex.message, 'error'); }
  }

  // ============================ COUPONS ============================
  async function renderCoupons() {
    const host = $('#page-coupons');
    host.innerHTML = '<div class="loading-block"><span class="spinner"></span></div>';
    const { data } = await api('/api/admin/coupons');
    host.innerHTML = '';
    host.appendChild(el('div', { class: 'section-head' }, [
      el('div', {}, [el('h2', { text: t('admin.coupons') }), el('p', { class: 'muted small', text: 'Discount or fully waive fees. FREE waives all fees.' })]),
      el('button', { class: 'btn btn-primary', text: '+ ' + t('admin.newCoupon'), onclick: () => couponModal() }),
    ]));
    if (!data.length) { host.appendChild(el('div', { class: 'card' }, [emptyState('🏷️', 'No coupons yet')])); return; }
    const rows = data.map((c) => el('tr', {}, [
      el('td', {}, [el('strong', { class: 'mono', text: c.code })]),
      el('td', {}, [el('span', { class: 'badge ' + (c.type === 'fee_waiver' ? 'active' : 'neutral') + ' plain', text: c.label })]),
      el('td', { class: 'small muted', text: c.scope === 'merchant' ? (c.merchantName || 'merchant') : 'Platform-wide' }),
      el('td', { class: 'num small', text: c.redemptions + (c.maxRedemptions ? ' / ' + c.maxRedemptions : '') }),
      el('td', {}, [el('span', { class: 'badge ' + (c.live ? 'active' : 'canceled'), text: c.live ? 'Live' : 'Off' })]),
      el('td', { class: 'num' }, [
        el('button', { class: 'btn btn-ghost btn-sm', text: c.active ? 'Disable' : 'Enable', onclick: async () => { await api('/api/admin/coupons/' + c.id, { method: 'PATCH', body: { active: !c.active } }); renderCoupons(); } }),
        el('button', { class: 'btn btn-danger btn-sm', style: 'margin-left:6px', text: '🗑', onclick: async () => { if (confirm('Delete coupon ' + c.code + '?')) { await api('/api/admin/coupons/' + c.id, { method: 'DELETE' }); renderCoupons(); } } }),
      ]),
    ]));
    host.appendChild(el('div', { class: 'table-wrap' }, [el('table', { class: 'data' }, [
      el('thead', {}, [el('tr', {}, ['Code', 'Type', 'Scope', 'Redemptions', 'Status', ''].map((h, i) => el('th', { class: i === 3 || i === 5 ? 'num' : '', text: h })))]),
      el('tbody', {}, rows),
    ])]));
  }

  function couponModal() {
    const code = el('input', { type: 'text', placeholder: 'FREE', style: 'text-transform:uppercase' });
    const type = el('select', {}, [el('option', { value: 'fee_waiver', text: 'Fee waiver (0% — free)' }), el('option', { value: 'percent_off', text: '% off fees' }), el('option', { value: 'fixed_off', text: 'Fixed $ off fees' })]);
    const value = el('input', { type: 'text', placeholder: '50' });
    const valueRow = el('label', { class: 'field', style: 'display:none' }, [el('span', { id: 'vlabel', text: 'Percent off' }), value]);
    const max = el('input', { type: 'number', placeholder: 'Unlimited', min: '1' });
    const err = el('div', { class: 'form-error' });
    type.addEventListener('change', () => {
      const show = type.value !== 'fee_waiver';
      valueRow.style.display = show ? 'block' : 'none';
      $('#vlabel').textContent = type.value === 'percent_off' ? 'Percent off (1–100)' : 'Amount off (USD)';
    });
    const save = el('button', { class: 'btn btn-primary', text: 'Create coupon' });
    save.addEventListener('click', async () => {
      err.textContent = '';
      const body = { code: code.value, type: type.value, scope: 'platform', maxRedemptions: max.value || null };
      if (type.value === 'percent_off') body.value = Math.round((Number(value.value) || 0) * 100);
      if (type.value === 'fixed_off') body.value = dollarsToCents(value.value);
      try { await api('/api/admin/coupons', { method: 'POST', body }); closeModal(); toast('Coupon created ✓', 'success'); renderCoupons(); }
      catch (ex) { err.textContent = ex.message; }
    });
    openModal(modalShell(t('admin.newCoupon'), [
      el('label', { class: 'field' }, [el('span', { text: 'Code' }), code]),
      el('label', { class: 'field' }, [el('span', { text: 'Type' }), type]),
      valueRow,
      el('label', { class: 'field' }, [el('span', { text: 'Max redemptions' }), max]),
      err,
    ], [el('button', { class: 'btn btn-ghost', text: t('common.cancel'), onclick: closeModal }), save]));
  }

  const RENDER = { overview: renderOverview, clients: renderClients, plans: renderPlans, coupons: renderCoupons, transactions: renderTransactions, settings: renderSettings };

  function setupCommands() {
    setCommands([
      ...PAGES.map((p) => ({ label: t(TITLE_KEY[p]), icon: '→', hint: '↵', run: () => setPage(p) })),
      { label: 'Run billing', icon: '▶', run: runBilling },
      { label: 'Toggle theme', icon: '◐', run: () => window.PP.toggleTheme() },
      { label: t('dash.signout'), icon: '→', run: logout },
    ]);
  }

  async function boot() {
    let s;
    try { s = await requireRole('admin'); } catch { return; }
    await window.PP.ready;
    $('#mark').innerHTML = brandMark();
    $('#topctl').appendChild(topControls());
    window.PP.applyI18n(document);
    $('#side-account').innerHTML = '<strong style="color:var(--text)">' + escapeHtml(s.user.name) + '</strong><br>' + escapeHtml(s.user.email);
    setupCommands();
    $$('.side-link[data-page]').forEach((a) => a.addEventListener('click', () => setPage(a.dataset.page)));
    $('#logout-btn').addEventListener('click', logout);
    $('#run-billing').addEventListener('click', runBilling);
    $('#cmdk-btn').addEventListener('click', openPalette);
    window.addEventListener('hashchange', () => setPage(location.hash.slice(1)));
    document.addEventListener('localechange', () => { window.PP.applyI18n(document); setupCommands(); setPage(location.hash.slice(1) || 'overview'); });
    setPage(location.hash.slice(1) || 'overview');
  }
  boot();
})();
