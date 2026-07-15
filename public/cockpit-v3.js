(() => {
  'use strict';

  const state = {
    data: null,
    activeRmId: null,
    rmMenuOpen: false,
    view: 'today',
    todayFilter: 'all',
    marketTab: 'setsmart',
    setsmartListed: { status: 'idle', items: [], asOf: null, countsByType: {}, totalUniverse: 0, filteredTotal: 0, error: null },
    setsmartAssetQuery: '',
    setsmartAssetType: 'All',
    setsmartAssetOffset: 0,
    setsmartAssetLimit: 100,
    builderBook: { status: 'idle', portfolios: [], totalUniverse: 0, error: null },
    builderClientId: null,
    portfolioWorkspace: 'list',
    builderDraftHoldings: [],
    builderDraftMeta: null,
    builderDirty: false,
    builderSavedDrafts: [],
    builderAssetQuery: '',
    builderAssetType: 'All',
    builderAssetResults: [],
    builderAssetSearchStatus: 'idle',
    builderAnalysis: null,
    builderAnalysisStatus: 'idle',
    builderAnalysisError: null,
    builderPeriod: '1Y',
    builderMethod: 'MAX_RETURN_TARGET_VOL',
    builderTargetVolatility: 12,
    performanceRange: '1Y',
    performanceZoom: 1,
    allocationMode: 'asset',
    selectedAllocationKey: null,
    chartVisibility: { portfolio: true, benchmark: true, flows: true },
    activeCase: null,
    activeCaseId: null,
    caseStep: 'understand',
    selectedDecision: null,
    handoffReviewed: false,
    feedback: {},
    draftText: '',
    clientQuery: '',
    clientViewMode: 'table',
    clientSort: 'ranking',
    clientSortDirection: 'desc',
    clientSavedView: 'all',
    clientOwnerFilter: 'all',
    clientReadinessFilter: 'all',
    selectedClientId: null,
  };

  const viewLabels = {
    today: 'วันนี้', clients: 'ลูกค้า', goals: 'เป้าหมาย', portfolios: 'พอร์ตและการจัดสรร',
    market: 'เหตุการณ์ตลาด', queue: 'คิวและการส่งต่อ', audit: 'ตรวจสอบย้อนหลัง',
  };
  const stepLabels = [
    ['understand', 'เข้าใจเคส'], ['verify', 'ตรวจข้อมูล'], ['prepare', 'เตรียมคุย'],
    ['decide', 'ตัดสินใจ'], ['record', 'บันทึกผล'],
  ];
  const money = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 });
  const number = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 });
  const pct = new Intl.NumberFormat('th-TH', { style: 'percent', maximumFractionDigits: 1 });
  const shortDate = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  let toastTimer;
  let builderAnalysisTimer;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value == null ? '' : value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const list = (value) => Array.isArray(value) ? value : [];
  const obj = (value) => value && typeof value === 'object' ? value : {};
  const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');
  const governedValue = (value) => value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value') ? value.value : value;
  const fmtMoney = (value) => Number.isFinite(Number(value)) ? money.format(Number(value)) : 'ข้อมูลยังไม่พอ';
  const fmtPct = (value) => Number.isFinite(Number(value)) ? pct.format(Number(value)) : 'ข้อมูลยังไม่พอ';
  const fmtNumber = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
  const formatDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value || '—') : shortDate.format(date);
  };
  const actorLabel = (event) => {
    const actor = first(event?.actorName, event?.actor, event?.role, 'ระบบ');
    if (!actor || typeof actor !== 'object') return actor;
    return first(actor.name, actor.displayName, actor.actorName, actor.actorId, actor.role, 'ระบบ');
  };
  const asArrayText = (value) => list(value).map((item) => typeof item === 'string' ? item : first(item.text, item.label, item.question, item.fact, item.warning, item.name)).filter(Boolean);
  const makeIdempotencyKey = (actionId, decision) => `ui-${actionId}-${decision}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || payload.code || `HTTP_${response.status}`);
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function showToast(message, tone = 'normal') {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3600);
  }

  function meta() { return obj(state.data?.meta); }
  function rmRoster() { return list(meta().rms); }
  function activeRm() { return rmRoster().find((rm) => rm.rmId === state.activeRmId) || rmRoster()[0] || {}; }
  function activeRmOwner() { return first(activeRm().displayName, 'RM คุณพลอย'); }
  function rmShortName(owner = activeRmOwner()) { return String(owner).replace(/^RM\s+/u, ''); }
  function rmInitial(owner = activeRmOwner()) { return rmShortName(owner).replace(/^คุณ/u, '').trim().slice(0, 1) || 'R'; }
  function today() { return obj(state.data?.today); }
  function cases() { return list(first(today().cases, state.data?.actions)); }
  function clients() { return list(state.data?.clients); }
  function goals() { return list(state.data?.goals); }
  function funds() { return list(state.data?.funds); }
  function queue() { return list(state.data?.queue); }
  function performance() {
    const payload = obj(state.data?.performance);
    if (Array.isArray(payload)) return obj(payload.find((item) => item.clientId === state.selectedClientId) || payload[0]);
    return payload;
  }

  function activeRmClientIds() {
    const owner = activeRmOwner();
    return new Set(clients().filter((client) => first(client.owner, client.rmOwner) === owner).map((client) => client.clientId));
  }

  function activeRmCases() {
    const owner = activeRmOwner();
    const clientIds = activeRmClientIds();
    return cases().filter((item) => item.owner === owner || clientIds.has(item.clientId));
  }

  function renderRmSwitcher() {
    const rm = activeRm();
    const button = $('#rmProfileButton');
    const menu = $('#rmSwitcherMenu');
    if (!button || !menu || !rm.rmId) return;
    $('#activeRmInitial').textContent = rmInitial(rm.displayName);
    $('#activeRmName').textContent = rmShortName(rm.displayName);
    $('#activeRmRole').textContent = `RM · Demo view · ${first(rm.bookSize, 6)} ลูกค้า`;
    button.setAttribute('aria-expanded', String(state.rmMenuOpen));
    menu.hidden = !state.rmMenuOpen;
    menu.innerHTML = rmRoster().map((item) => `<button type="button" role="option" class="rm-switcher-option ${item.rmId === rm.rmId ? 'is-active' : ''}" data-rm-switch="${esc(item.rmId)}" aria-selected="${item.rmId === rm.rmId}"><span>${esc(rmInitial(item.displayName))}</span><span><strong>${esc(rmShortName(item.displayName))}</strong><small>${esc(item.displayName)} · ข้อมูลสาธิต</small></span><b>${esc(first(item.bookSize, 6))} คน</b></button>`).join('');
  }

  function switchActiveRm(rmId) {
    const next = rmRoster().find((rm) => rm.rmId === rmId);
    if (!next || next.rmId === state.activeRmId) { state.rmMenuOpen = false; renderRmSwitcher(); return; }
    if (!confirmDraftDiscard()) { state.rmMenuOpen = false; renderRmSwitcher(); return; }
    state.activeRmId = next.rmId;
    state.rmMenuOpen = false;
    state.clientOwnerFilter = next.displayName;
    const ownedClients = clients().filter((client) => first(client.owner, client.rmOwner) === next.displayName);
    state.selectedClientId = ownedClients[0]?.clientId || null;
    const activePortfolio = list(state.builderBook.portfolios).find((item) => item.clientId === state.builderClientId);
    if (activePortfolio && activePortfolio.rmOwner !== next.displayName) {
      state.builderClientId = null;
      state.portfolioWorkspace = 'list';
      state.builderDirty = false;
      state.builderDraftHoldings = [];
      state.builderAnalysis = null;
      state.builderAnalysisStatus = 'idle';
      if (window.location.pathname === '/portfolios') updatePortfolioUrl({ clientId: null, workspace: 'list' });
    }
    try { window.sessionStorage.setItem('fin-ai-demo-rm-id', next.rmId); } catch (_) { /* optional demo preference */ }
    updateChrome();
    render();
    showToast(`สลับเป็นมุมมอง ${next.displayName} แล้ว · ไม่ได้เปลี่ยนสิทธิ์ผู้ใช้จริง`);
  }

  function builderPortfolio() {
    return list(state.builderBook.portfolios).find((item) => item.clientId === state.builderClientId) || list(state.builderBook.portfolios)[0] || {};
  }

  function portfolioRouteState() {
    const params = new URLSearchParams(window.location.search);
    const workspaces = new Set(['overview','performance','risk','builder','compare','goals','history']);
    return {
      active: window.location.pathname === '/portfolios',
      clientId: params.get('clientId'),
      workspace: workspaces.has(params.get('workspace')) ? params.get('workspace') : 'overview',
    };
  }

  function updatePortfolioUrl({ clientId = state.builderClientId, workspace = state.portfolioWorkspace, replace = false } = {}) {
    const params = new URLSearchParams();
    if (clientId) params.set('clientId', clientId);
    if (clientId) params.set('workspace', workspace === 'list' ? 'overview' : workspace);
    const next = `/portfolios${params.size ? `?${params}` : ''}`;
    window.history[replace ? 'replaceState' : 'pushState']({ view: 'portfolios', clientId, workspace }, '', next);
  }

  function confirmDraftDiscard() {
    return !state.builderDirty || window.confirm('มี RM Draft ที่ยังไม่ได้บันทึก ต้องการออกจากลูกค้ารายนี้หรือไม่?');
  }

  function resetBuilderDraft(portfolio = builderPortfolio()) {
    state.builderDraftHoldings = list(portfolio.holdings).map((holding) => ({ ...holding, draftWeight: Number(first(holding.currentWeight,0)) }));
    state.builderDraftMeta = portfolio.clientId ? {
      clientId: portfolio.clientId,
      portfolioId: `PORTFOLIO-${portfolio.clientId}`,
      draftId: null,
      sourceSnapshotId: `SNAPSHOT-${portfolio.clientId}-${portfolio.marketAsOf}`,
      createdBy: activeRmOwner(),
      createdAt: null,
      updatedAt: null,
      calculationId: null,
      modelVersion: 'portfolio-builder-v1',
    } : null;
    state.builderDirty = false;
    state.builderAnalysis = null;
    state.builderAnalysisError = null;
    state.builderAnalysisStatus = 'idle';
  }

  async function loadBuilderBook(force = false) {
    if (!force && ['loading','ready'].includes(state.builderBook.status)) return;
    state.builderBook = { ...state.builderBook, status: 'loading', error: null };
    if (state.view === 'portfolios') render();
    try {
      const payload = await api('/api/v3/portfolio-builder/book');
      state.builderBook = { ...payload, portfolios: list(payload.portfolios), status: 'ready', error: null };
      const preferred = state.builderClientId;
      state.builderClientId = payload.portfolios.some((item) => item.clientId === preferred) ? preferred : null;
      if (state.builderClientId) resetBuilderDraft();
    } catch (error) {
      state.builderBook = { ...state.builderBook, status: 'error', error: error.message || 'BUILDER_BOOK_UNAVAILABLE' };
    }
    if (state.view === 'portfolios') render();
  }

  async function loadBuilderDrafts() {
    if (!state.builderClientId) { state.builderSavedDrafts = []; return; }
    try {
      const payload = await api(`/api/v3/portfolio-builder/drafts?clientId=${encodeURIComponent(state.builderClientId)}`);
      state.builderSavedDrafts = list(payload.drafts);
    } catch (error) {
      state.builderSavedDrafts = [];
      showToast(`ยังโหลดประวัติร่างไม่ได้: ${error.message}`, 'error');
    }
  }

  async function openPortfolioClient(clientId, workspace = 'overview', options = {}) {
    if (!options.skipConfirm && !confirmDraftDiscard()) return;
    const portfolio = list(state.builderBook.portfolios).find((item) => item.clientId === clientId);
    if (!portfolio) return;
    const ownerRm = rmRoster().find((rm) => rm.displayName === portfolio.rmOwner);
    if (ownerRm) {
      state.activeRmId = ownerRm.rmId;
      state.clientOwnerFilter = ownerRm.displayName;
      try { window.sessionStorage.setItem('fin-ai-demo-rm-id', ownerRm.rmId); } catch (_) { /* optional demo preference */ }
      updateChrome();
    }
    state.builderClientId = clientId;
    state.selectedClientId = clientId;
    state.portfolioWorkspace = workspace;
    resetBuilderDraft(portfolio);
    updatePortfolioUrl({ clientId, workspace, replace: Boolean(options.replace) });
    render();
    await loadBuilderDrafts();
    await analyzeBuilder();
  }

  function switchPortfolioWorkspace(workspace) {
    state.portfolioWorkspace = workspace;
    updatePortfolioUrl({ workspace });
    render();
  }

  async function saveBuilderDraft() {
    if (!state.builderDraftMeta) return;
    try {
      const saved = await api('/api/v3/portfolio-builder/drafts', {
        method: 'POST',
        body: JSON.stringify({
          ...state.builderDraftMeta,
          draftId: state.builderDraftMeta.draftId,
          calculationId: state.builderAnalysis?.calculationId || null,
          holdings: state.builderDraftHoldings.map((holding) => ({ productId: holding.productId, weight: Number(first(holding.draftWeight,0)) })),
        }),
      });
      state.builderDraftMeta = saved;
      state.builderDirty = false;
      await loadBuilderDrafts();
      showToast('บันทึก Draft Proposal แล้ว · Current Portfolio ไม่ถูกแก้');
      render();
    } catch (error) {
      showToast(`บันทึกร่างไม่สำเร็จ: ${error.message}`, 'error');
    }
  }

  function scheduleBuilderAnalysis() {
    clearTimeout(builderAnalysisTimer);
    builderAnalysisTimer = setTimeout(() => {
      const total = state.builderDraftHoldings.reduce((sum, holding) => sum + Number(first(holding.draftWeight,0)), 0);
      if (total > 0 && total <= 1 + 1e-9) analyzeBuilder();
    }, 450);
  }

  async function searchBuilderAssets() {
    state.builderAssetSearchStatus = 'loading';
    render();
    const params = [
      `query=${encodeURIComponent(state.builderAssetQuery)}`,
      `securityType=${encodeURIComponent(state.builderAssetType)}`,
      'limit=25',
      'offset=0',
    ].join('&');
    try {
      const payload = await api(`/api/v3/market/setsmart-assets?${params}`);
      state.builderAssetResults = list(payload.items);
      state.builderAssetSearchStatus = 'ready';
    } catch (error) {
      state.builderAssetResults = [];
      state.builderAssetSearchStatus = 'error';
      showToast(`ค้นหา SETSMART ไม่สำเร็จ: ${error.message}`, 'error');
    }
    render();
  }

  function builderDateRange() {
    const asOf = first(state.builderBook.marketAsOf,meta().asOf,'2026-07-15');
    const end = new Date(`${asOf}T00:00:00Z`);
    const years = ({'1Y':1,'3Y':3,'5Y':5})[state.builderPeriod] || 1;
    const start = new Date(end); start.setUTCFullYear(start.getUTCFullYear()-years);
    return { startDate:start.toISOString().slice(0,10), endDate:asOf };
  }

  async function analyzeBuilder() {
    const total = state.builderDraftHoldings.reduce((sum,holding)=>sum+Number(first(holding.draftWeight,0)),0);
    if (!(total>0) || total>1+1e-9) { showToast('น้ำหนักพอร์ตต้องมากกว่า 0% และไม่เกิน 100%', 'error'); return; }
    state.builderAnalysisStatus = 'loading'; state.builderAnalysisError = null; render();
    const range = builderDateRange();
    try {
      state.builderAnalysis = await api('/api/v3/portfolio-builder/analyze', {
        method:'POST',
        body:JSON.stringify({
          clientId:state.builderClientId,
          holdings:state.builderDraftHoldings.map((holding)=>({productId:holding.productId,weight:Number(first(holding.draftWeight,0))})),
          ...range,
          method:state.builderMethod,
          targetVolatility:Number(state.builderTargetVolatility)/100,
          constraints:{maxPositionWeight:.35},
        }),
      });
      state.builderAnalysisStatus = 'ready';
    } catch (error) {
      state.builderAnalysis = null; state.builderAnalysisStatus = 'error'; state.builderAnalysisError = error.message || 'BUILDER_ANALYSIS_FAILED';
    }
    render();
  }

  async function loadSetSmartListed(force = false) {
    if (!force && state.setsmartListed.status === 'loading') return;
    state.setsmartListed = {
      ...state.setsmartListed,
      status: 'loading',
      error: null,
    };
    if (state.view === 'market') render();
    const params = [
      `securityType=${encodeURIComponent(state.setsmartAssetType)}`,
      `query=${encodeURIComponent(state.setsmartAssetQuery)}`,
      `limit=${encodeURIComponent(state.setsmartAssetLimit)}`,
      `offset=${encodeURIComponent(state.setsmartAssetOffset)}`,
    ].join('&');
    try {
      const payload = await api(`/api/v3/market/setsmart-assets?${params}`);
      state.setsmartListed = {
        status: 'ready',
        items: list(payload.items),
        asOf: payload.marketAsOf,
        countsByType: obj(payload.countsByType),
        totalUniverse: Number(payload.totalUniverse || 0),
        filteredTotal: Number(payload.filteredTotal || 0),
        limit: Number(payload.limit || state.setsmartAssetLimit),
        offset: Number(payload.offset || 0),
        nextOffset: payload.nextOffset,
        previousOffset: payload.previousOffset,
        cache: obj(payload.cache),
        source: obj(payload.source),
        error: null,
      };
    } catch (error) {
      state.setsmartListed = {
        ...state.setsmartListed,
        status: 'error',
        error: error.message || 'SETSMART_LISTED_UNAVAILABLE',
      };
    }
    updateChrome();
    if (state.view === 'market') render();
  }

  async function initialize() {
    try {
      state.data = await api('/api/v3/bootstrap');
      let savedRmId = null;
      try { savedRmId = window.sessionStorage.getItem('fin-ai-demo-rm-id'); } catch (_) { /* optional demo preference */ }
      state.activeRmId = rmRoster().some((rm) => rm.rmId === savedRmId) ? savedRmId : rmRoster()[0]?.rmId || null;
      state.clientOwnerFilter = activeRmOwner();
      const ownedClients = clients().filter((client) => first(client.owner, client.rmOwner) === activeRmOwner());
      state.selectedClientId = first(ownedClients[0]?.clientId, ownedClients[0]?.id, clients()[0]?.clientId, clients()[0]?.id);
      const route = portfolioRouteState();
      if (route.active) {
        state.view = 'portfolios';
        state.builderClientId = route.clientId;
        state.portfolioWorkspace = route.clientId ? route.workspace : 'list';
      }
      updateChrome();
      bindGlobalEvents();
      render();
      if (state.view === 'portfolios') {
        await loadBuilderBook();
        if (state.builderClientId) await openPortfolioClient(state.builderClientId, state.portfolioWorkspace, { skipConfirm: true, replace: true });
      }
    } catch (error) {
      $('#appRoot').innerHTML = `
        <section class="empty-v3">
          <h1>ยังเปิดโต๊ะงานไม่ได้</h1>
          <p>เซิร์ฟเวอร์ยังเตรียมข้อมูลสาธิตไม่สำเร็จ (${esc(error.message)})</p>
          <button class="primary-button" type="button" data-retry>ลองอีกครั้ง</button>
        </section>`;
      bindGlobalEvents();
    }
  }

  function updateChrome() {
    const rmCaseList = activeRmCases();
    const rmQueue = queue().filter((item) => item.owner === activeRmOwner());
    $('#todayBadge').textContent = String(rmCaseList.filter((item) => ['P0', 'P1'].includes(item.priorityTier)).length);
    $('#handoffBadge').textContent = String(rmQueue.filter((item) => item.overdue).length);
    const mode = first(meta().dataMode, 'fixture');
    const listedLive = state.setsmartListed.status === 'ready' && state.setsmartListed.totalUniverse > 0;
    $('#dataStatusText').textContent = listedLive
      ? 'ข้อมูลผสม · SETSMART Live + Demo'
      : mode === 'fixture' ? 'ข้อมูลสาธิต · เปิด SETSMART เมื่อเข้าหน้าตลาด' : `ข้อมูล ${mode}`;
    $('#dataStatusButton').className = `data-chip ${listedLive || mode !== 'fixture' ? 'is-partial' : 'is-demo'}`;
    renderRmSwitcher();
  }

  function commonHead(kicker, title, description, actions = '', modeLabel = 'ข้อมูลสาธิต') {
    return `<header class="v3-page-head">
      <div><p class="eyebrow">${esc(kicker)}</p><h1>${esc(title)}</h1><p>${esc(description)}</p></div>
      <div class="head-actions">${actions}<span class="asof-chip">ข้อมูล ณ ${esc(formatDate(first(meta().asOf, '2026-07-14')))}</span><span class="mode-chip">${esc(modeLabel)}</span></div>
    </header>`;
  }

  function render() {
    $$('.nav-item').forEach((button) => button.classList.toggle('is-active', button.dataset.view === state.view));
    const renderers = { today: renderToday, clients: renderClients, goals: renderGoals, portfolios: renderPortfolioAllocation, market: renderMarket, queue: renderQueue, audit: renderAudit };
    $('#appRoot').innerHTML = (renderers[state.view] || renderToday)();
    if (state.view === 'portfolios' && state.builderAnalysisStatus === 'ready' && ['performance','builder','compare'].includes(state.portfolioWorkspace)) queueMicrotask(drawBuilderCharts);
  }

  function summaryValue(key, fallback) {
    const value = today().summary?.[key];
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function caseClass(item) {
    if (item.lane === 'GROWTH') return 'growth';
    if (item.domain === 'DATA' || list(item.missingData).length) return 'data';
    return 'care';
  }

  function filteredCases() {
    const all = activeRmCases();
    if (state.todayFilter === 'care') return all.filter((item) => item.lane === 'CARE');
    if (state.todayFilter === 'growth') return all.filter((item) => item.lane === 'GROWTH');
    if (state.todayFilter === 'data') return all.filter((item) => item.domain === 'DATA' || list(item.missingData).length);
    if (state.todayFilter === 'handoff') return all.filter((item) => item.channel === 'HANDOFF' || item.specialistType);
    return all;
  }

  function actionCard(item, index) {
    const css = caseClass(item);
    const clientName = first(item.clientName, item.client?.name, 'ลูกค้าสาธิต');
    const clientRef = first(item.clientRef, item.friendlyClientId, item.clientDisplayId, `ลูกค้า ${index + 1}`);
    const goalName = first(item.affectedGoalName, item.goalName, item.affectedGoal?.name, list(item.affectedGoals)[0]?.name, 'เป้าหมายที่ต้องยืนยัน');
    const due = first(item.dueLabel, item.dueAt ? formatDate(item.dueAt) : null, 'วันนี้');
    const confirmOnly = item.state === 'CONFIRM_DATA' || item.channel === 'CONFIRM_DATA'
      || item.dataGate?.onlyAllowedNextAction === 'CONFIRM_DATA';
    const actionControls = confirmOnly
      ? `<button class="compact-button primary" type="button" data-open-case="${esc(item.actionId)}">ยืนยันข้อมูล</button><button class="compact-button" type="button" data-show-reason="${esc(item.actionId)}">ดูเหตุผล</button><span class="source-line">ข้อมูลสำคัญยังขาด · ยังเลื่อน/ส่งต่อ/ปิดเคสไม่ได้</span>`
      : `<button class="compact-button primary" type="button" data-open-case="${esc(item.actionId)}">เปิดเคส</button><button class="compact-button" type="button" data-show-reason="${esc(item.actionId)}">ดูเหตุผล</button><button class="compact-button" type="button" data-quick="SNOOZE" data-action-id="${esc(item.actionId)}">เลื่อนไปวันถัดไป</button><button class="compact-button" type="button" data-quick="HANDOFF" data-action-id="${esc(item.actionId)}">ส่งต่อ</button><button class="compact-button warn" type="button" data-quick="DISMISS" data-action-id="${esc(item.actionId)}">ไม่เกี่ยวข้อง</button>`;
    return `<article class="action-card-v3 ${css}">
      <div class="priority-badge">${esc(first(item.priorityTier, 'P2'))}</div>
      <div class="action-main">
        <div class="action-kicker"><span class="lane-pill">${item.lane === 'GROWTH' ? 'Growth' : 'Care'}</span><span>${esc(first(item.domainLabel, item.domain, 'INVESTMENT'))}</span><span>${esc(clientRef)}</span><span>ภายใน ${esc(due)}</span></div>
        <h3>${esc(clientName)} · ${esc(first(item.title, 'ทบทวนสิ่งที่ต้องดูแล'))}</h3>
        <p>${esc(first(item.whyNow, item.reason, 'มีข้อมูลที่ควรตรวจร่วมกับลูกค้าก่อนตัดสินใจ'))}</p>
        <div class="goal-line"><span>เป้าหมายที่ได้รับผลกระทบ</span><b>${esc(goalName)}</b><span>·</span><span>${esc(first(item.channelLabel, channelLabel(item.channel)))}</span></div>
      </div>
      <div class="action-buttons">
        ${actionControls}
      </div>
    </article>`;
  }

  function channelLabel(channel) {
    return ({ CALL: 'โทรคุย', MEETING: 'นัดหมาย', REVIEWED_MESSAGE: 'ข้อความที่ RM ตรวจ', CONFIRM_DATA: 'ยืนยันข้อมูล', HANDOFF: 'ส่งต่อผู้เชี่ยวชาญ', NO_ACTION: 'ยังไม่ดำเนินการ' })[channel] || channel || 'ยืนยันข้อมูล';
  }

  function renderToday() {
    const visible = filteredCases().slice(0, 5);
    const rmCaseList = activeRmCases();
    const summary = {
      p0Care: rmCaseList.filter((item) => item.priorityTier === 'P0' && item.lane === 'CARE').length,
      p1Care: rmCaseList.filter((item) => item.priorityTier === 'P1' && item.lane === 'CARE').length,
      growth: rmCaseList.filter((item) => item.lane === 'GROWTH').length,
      dataCases: rmCaseList.filter((item) => item.domain === 'DATA' || list(item.missingData).length).length,
      overdueHandoffs: queue().filter((item) => item.owner === activeRmOwner() && item.overdue).length,
      completedToday: rmCaseList.filter((item) => item.state === 'COMPLETED').length,
    };
    const capacity = obj(today().capacity);
    const remaining = first(capacity.remainingCallMinutes, capacity.remainingMinutes, meta().remainingCallCapacityMinutes, 0);
    const total = first(capacity.totalCallMinutes, capacity.totalMinutes, meta().totalCallCapacityMinutes, remaining);
    const used = Math.max(0, total - remaining);
    const whyLower = first(visible[0]?.lowerPriorityExplanation, visible[1]?.lowerPriorityExplanation, 'เคสลำดับถัดไปยังไม่เร่งด่วน เพราะไม่พบการละเมิดกรอบและเป้าหมายหลักยังมีเงินเผื่อเพียงพอ');
    const headline = visible[0] ? `${first(visible[0].clientName, 'ลูกค้า')}: ${first(visible[0].title, 'ทบทวนสิ่งที่ต้องดูแล')}` : `${activeRmOwner()} ยังไม่มีเคสเร่งด่วนในมุมมองนี้`;
    const headlineExplanation = visible[0] ? first(visible[0].whyNow, visible[0].reason, 'ตรวจข้อมูลก่อนเลือกการดำเนินการ') : 'ระบบไม่สร้างการติดต่อเมื่อไม่จำเป็น สามารถเปิดรายชื่อลูกค้า 6 รายเพื่อตรวจรอบทบทวนได้';
    return `<section class="v3-page" data-page="today">
      ${commonHead('Today in 5 minutes', '5 นาทีแรกของวันนี้', 'เห็นเฉพาะสิ่งที่ควรได้รับความสนใจก่อน พร้อมเหตุผล เป้าหมาย และขั้นตอนถัดไป')}
      <div class="five-minute-hero">
        <article class="hero-card"><p class="eyebrow">สิ่งสำคัญที่สุด · ${esc(rmShortName())}</p><h2>${esc(headline)}</h2><p>${esc(headlineExplanation)}</p><div class="hero-path"><span>1 · เข้าใจเหตุผล</span><i>→</i><span>2 · ตรวจข้อมูล</span><i>→</i><span>3 · เตรียมคุย</span><i>→</i><span>4 · RM ตัดสินใจ</span></div></article>
        <article class="capacity-card"><header><div><p class="eyebrow">กำลังติดต่อวันนี้</p><h3>เวลาที่เหลือสำหรับการโทร</h3></div><span class="role-chip">ไม่เกินกรอบติดต่อ</span></header><div class="capacity-number">${esc(number.format(remaining))} <span>นาที</span></div><div class="capacity-track" aria-label="ใช้เวลา ${used} จาก ${total} นาที"><i style="width:${Math.min(100, Math.max(0, used / total * 100))}%"></i></div><div class="capacity-list"><span><b>${esc(first(capacity.callsRemaining, 3))}</b>สายที่ยังรับได้</span><span><b>${esc(first(capacity.contactsLast7Days, 2))}</b>รายที่ติดต่อใน 7 วัน</span><span><b>${esc(first(capacity.quietHourBlocks, 1))}</b>ช่วงห้ามรบกวน</span></div></article>
      </div>
      <div class="summary-strip">
        <article class="mini-summary care"><span>P0 Care ต้องดูแลก่อน</span><strong>${summary.p0Care}</strong></article>
        <article class="mini-summary care"><span>P1 Care ภายในวันนี้</span><strong>${summary.p1Care}</strong></article>
        <article class="mini-summary growth"><span>โอกาส Growth ที่ผ่านเงื่อนไข</span><strong>${summary.growth}</strong></article>
        <article class="mini-summary data"><span>เคสข้อมูลหรือโปรไฟล์</span><strong>${summary.dataCases}</strong></article>
        <article class="mini-summary"><span>ส่งต่อล่าช้า</span><strong>${summary.overdueHandoffs}</strong></article>
        <article class="mini-summary"><span>ดำเนินการแล้ววันนี้</span><strong>${summary.completedToday}</strong></article>
      </div>
      <div class="today-layout">
        <div>
          <div class="section-bar"><div><h2>เคสที่ควรเปิดก่อน</h2><p>แสดงไม่เกิน 5 เคส และให้ Care มาก่อน Growth เสมอ</p></div><span class="asof-chip">${visible.length} เคส</span></div>
          <div class="saved-views" role="group" aria-label="มุมมองที่บันทึกไว้">
            ${[['all','5 เคสแรก'],['care','Care ที่ต้องดูแล'],['data','ข้อมูลไม่ครบ'],['handoff','รอผู้เชี่ยวชาญ'],['growth','Growth ที่ผ่านเงื่อนไข']].map(([id,label]) => `<button class="filter-chip ${state.todayFilter === id ? 'is-active' : ''}" type="button" data-today-filter="${id}">${label}</button>`).join('')}
          </div>
          <div class="case-list">${visible.length ? visible.map(actionCard).join('') : '<div class="empty-v3">ไม่มีเคสในมุมมองนี้</div>'}</div>
          <div class="why-lower"><strong>ทำไมเคสถัดไปอยู่ลำดับต่ำกว่า:</strong> ${esc(whyLower)}</div>
        </div>
        <aside class="side-stack">
          <article class="panel-card"><h3>แผน 5 นาที</h3><ol class="minute-plan"><li>เปิด P0 และอ่าน “เกิดอะไรขึ้น”</li><li>ดูข้อมูลที่ขาดก่อนคุยเรื่องผลิตภัณฑ์</li><li>เตรียม 3 คำถามและ 3 ข้อเท็จจริง</li><li>RM เลือกการดำเนินการและบันทึกเหตุผล</li></ol></article>
          <article class="panel-card"><h3>หลักจัดคิวที่ใช้วันนี้</h3><div class="policy-note">หน้าที่ดูแลลูกค้าและประโยชน์ต่อลูกค้ามาก่อน AUM หรือโอกาสทางธุรกิจ เคส Growth จะไม่แซง Care ที่จำเป็น</div></article>
          <article class="panel-card"><h3>งานส่งต่อที่ต้องตาม</h3><div class="handoff-mini">${queue().filter((item) => item.owner === activeRmOwner() && (item.type === 'HANDOFF' || item.specialistType)).slice(0,3).map((item) => `<article><div><strong>${esc(first(item.title,item.topic,'รอผู้เชี่ยวชาญ'))}</strong><small>${esc(first(item.owner,item.specialistType,'ผู้เชี่ยวชาญ'))}</small></div><b>${esc(first(item.dueLabel,item.due,'วันนี้'))}</b></article>`).join('') || '<p class="source-line">ไม่มีงานส่งต่อล่าช้า</p>'}</div></article>
        </aside>
      </div>
    </section>`;
  }

  function normalizedClient(client) {
    const clientGoals = list(first(client.goals, goals().filter((goal) => goal.clientId === first(client.clientId, client.id))));
    const primary = clientGoals.find((goal) => goal.isPrimary) || clientGoals[0] || {};
    return {
      ...client,
      clientId: first(client.clientId, client.id),
      ref: first(client.clientRef, client.friendlyClientId, client.displayId, 'ลูกค้าสาธิต'),
      name: first(client.name, client.displayName, 'ลูกค้าสาธิต'),
      primaryGoal: first(client.primaryGoal, primary.name, 'ยังไม่ยืนยันเป้าหมาย'),
      fundedRatio: first(client.fundedRatio, primary.fundedRatio),
      actionId: first(client.actionId, cases().find((item) => item.clientId === first(client.clientId, client.id))?.actionId),
    };
  }

  function normalizedMonitorRow(raw, index) {
    const source = obj(raw);
    const sourceId = first(source.clientId, source.id);
    const base = normalizedClient(clients().find((client) => first(client.clientId, client.id) === sourceId) || source);
    const routeActionId = source.openCaseActionId !== undefined ? source.openCaseActionId : source.actionId;
    const relatedCase = cases().find((item) => item.actionId === routeActionId || item.clientId === sourceId) || {};
    const missingData = list(first(source.missingData, relatedCase.missingData));
    const readinessBlocker = first(source.readinessBlocker, source.kycProductReadinessBlocker, missingData[0], source.dataReady === false ? 'ข้อมูลสำคัญยังไม่พร้อม' : null);
    return {
      ...base,
      ...source,
      clientId: first(sourceId, base.clientId, `client-row-${index + 1}`),
      clientRef: first(source.clientRef, base.ref, `ลูกค้า ${index + 1}`),
      name: first(source.name, base.name, 'ลูกค้าสาธิต'),
      rmOwner: first(source.rmOwner, source.owner, base.rmOwner, base.owner, 'ยังไม่ระบุ RM'),
      aum: Number(first(source.aum, source.portfolioValue, base.aum, base.portfolioValue, 0)),
      availableLiquidity: Number(first(source.availableLiquidity, source.liquidity, base.availableLiquidity, 0)),
      mainGoal: first(source.mainGoal, source.primaryGoal, base.primaryGoal, 'ยังไม่ยืนยันเป้าหมาย'),
      whyNow: first(source.whyNow, relatedCase.whyNow, base.whyNow, 'ทบทวนเป้าหมาย สภาพคล่อง และข้อมูลล่าสุด'),
      priorityTier: first(source.priorityTier, relatedCase.priorityTier, base.priorityTier, 'P3'),
      channel: first(source.channel, relatedCase.channel, base.channel, 'NO_ACTION'),
      dueAt: first(source.dueAt, relatedCase.dueAt, base.dueAt),
      readinessBlocker,
      monitorActionId: source.actionId,
      actionId: first(routeActionId, relatedCase.actionId, base.actionId),
      recentTransactionActivity: first(source.recentTransactionActivity, base.recentTransactionActivity, 0),
      goalDueSoon: Boolean(first(source.goalDueSoon, base.goalDueSoon, false)),
      riskBreach: Boolean(first(source.riskBreach, base.riskBreach, false)),
      lastContactAt: first(source.lastContactAt, base.lastContactAt),
      contactCount30Days: Number(first(source.contactCount30Days, base.contactCount30Days, 0)),
      dataReady: source.dataReady !== undefined ? Boolean(source.dataReady) : !readinessBlocker,
      lane: first(source.lane, relatedCase.lane, base.lane, 'CARE'),
      mandatoryCare: Boolean(first(source.mandatoryCare, relatedCase.mandatoryCare, false)),
      benefitUrgencyScore: Number(first(source.benefitUrgencyScore, source.rankingEvidence?.benefitUrgency, base.benefitUrgencyScore, 0)),
      goalImpactScore: Number(first(source.goalImpactScore, source.rankingEvidence?.goalImpact, base.goalImpactScore, 0)),
      channelCapacityScore: Number(first(source.channelCapacityScore, source.rankingEvidence?.channelCapacity, base.channelCapacityScore, 0)),
      businessValue: Number(first(source.businessValue, base.businessValue, 0)),
    };
  }

  function clientMonitorRows() {
    const monitorRows = list(state.data?.clientMonitor?.rows);
    return (monitorRows.length ? monitorRows : clients()).map(normalizedMonitorRow);
  }

  function numericDate(value, fallback = 0) {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function rankingCompare(left, right) {
    const factors = [
      [Boolean(left.mandatoryCare), Boolean(right.mandatoryCare)],
      [Number(left.benefitUrgencyScore) || 0, Number(right.benefitUrgencyScore) || 0],
      [Number(left.goalImpactScore) || 0, Number(right.goalImpactScore) || 0],
      [Number(left.channelCapacityScore) || 0, Number(right.channelCapacityScore) || 0],
      [Number(left.businessValue) || 0, Number(right.businessValue) || 0],
    ];
    for (const [a, b] of factors) if (a !== b) return a > b ? -1 : 1;
    return String(left.clientRef).localeCompare(String(right.clientRef), 'th');
  }

  function sortableClientValue(row, key) {
    if (key === 'dueAt' || key === 'lastContactAt') return numericDate(row[key], Number.MAX_SAFE_INTEGER);
    if (key === 'rmOwner') return String(row.rmOwner || '');
    if (key === 'goalDueSoon' || key === 'riskBreach' || key === 'dataReady') return row[key] ? 1 : 0;
    const value = Number(row[key]);
    return Number.isFinite(value) ? value : 0;
  }

  function sortClientMonitorRows(rows) {
    if (state.clientSort === 'ranking') {
      const ranked = [...rows].sort(rankingCompare);
      return state.clientSortDirection === 'asc' ? ranked.reverse() : ranked;
    }
    const direction = state.clientSortDirection === 'asc' ? 1 : -1;
    return [...rows].sort((left, right) => {
      const a = sortableClientValue(left, state.clientSort);
      const b = sortableClientValue(right, state.clientSort);
      const compared = typeof a === 'string' ? a.localeCompare(b, 'th') : a - b;
      return compared === 0 ? String(left.clientRef).localeCompare(String(right.clientRef), 'th') : compared * direction;
    });
  }

  function filteredClientMonitorRows() {
    const rows = clientMonitorRows();
    const queryText = state.clientQuery.trim().toLocaleLowerCase('th-TH');
    const aumThreshold = median(rows.map((row) => row.aum));
    const liquidityThreshold = median(rows.map((row) => row.availableLiquidity));
    const asOf = String(first(meta().asOf, new Date().toISOString())).slice(0, 10);
    const matchesSavedView = (row) => {
      if (state.clientSavedView === 'contact-today') return row.channel !== 'NO_ACTION' && (['P0', 'P1'].includes(row.priorityTier) || (row.dueAt && String(row.dueAt).slice(0, 10) <= asOf));
      if (state.clientSavedView === 'high-aum-liquidity') return row.aum >= aumThreshold && row.availableLiquidity >= liquidityThreshold;
      if (state.clientSavedView === 'goal-due') return row.goalDueSoon;
      if (state.clientSavedView === 'risk-breach') return row.riskBreach;
      if (state.clientSavedView === 'not-ready') return !row.dataReady || Boolean(row.readinessBlocker);
      if (state.clientSavedView === 'handoff') return row.channel === 'HANDOFF';
      if (state.clientSavedView === 'no-contact') return row.channel === 'NO_ACTION';
      return true;
    };
    const filtered = rows.filter((row) => {
      const searchable = [row.name, row.clientRef, row.rmOwner, row.mainGoal, row.whyNow].join(' ').toLocaleLowerCase('th-TH');
      return (!queryText || searchable.includes(queryText))
        && (state.clientOwnerFilter === 'all' || row.rmOwner === state.clientOwnerFilter)
        && (state.clientReadinessFilter === 'all' || (state.clientReadinessFilter === 'ready' ? row.dataReady && !row.readinessBlocker : !row.dataReady || Boolean(row.readinessBlocker)))
        && matchesSavedView(row);
    });
    return sortClientMonitorRows(filtered);
  }

  function clientSortHeader(label, key) {
    const active = state.clientSort === key;
    const arrow = active ? (state.clientSortDirection === 'asc' ? ' ↑' : ' ↓') : '';
    return `<button type="button" class="client-sort-head ${active ? 'is-active' : ''}" data-client-sort="${esc(key)}">${esc(label)}${arrow}</button>`;
  }

  function renderClientMonitorCards(rows) {
    return `<div class="client-grid">${rows.map((client) => `<article class="client-card-v3"><header><div><p class="eyebrow">${esc(client.clientRef)}</p><h3>${esc(client.name)}</h3></div><span class="priority-pill ${esc(String(client.priorityTier).toLowerCase())}">${esc(client.priorityTier)}</span></header><p>${esc(client.whyNow)}</p><div class="client-facts"><span><b>${fmtMoney(client.aum)}</b>AUM</span><span><b>${fmtMoney(client.availableLiquidity)}</b>สภาพคล่องใช้ได้</span><span><b>${esc(client.mainGoal)}</b>เป้าหมายหลัก</span><span><b>${esc(client.rmOwner)}</b>RM เจ้าของ</span></div><button class="compact-button primary" type="button" ${client.actionId ? `data-open-case="${esc(client.actionId)}"` : 'disabled'}>เปิดเคส</button></article>`).join('') || '<div class="empty-v3">ไม่พบลูกค้าที่ตรงกับตัวกรอง</div>'}</div>`;
  }

  function renderClientMonitorTable(rows) {
    if (!rows.length) return '<div class="empty-v3">ไม่พบลูกค้าที่ตรงกับตัวกรอง</div>';
    return `<div class="table-wrap client-monitor-table-wrap"><table class="v3-table client-monitor-table"><thead><tr><th>Client</th><th>${clientSortHeader('RM owner', 'rmOwner')}</th><th>${clientSortHeader('AUM', 'aum')}</th><th>${clientSortHeader('Available liquidity', 'availableLiquidity')}</th><th>เป้าหมายหลัก</th><th>ทำไมต้องดูตอนนี้</th><th>${clientSortHeader('Priority', 'ranking')}</th><th>ช่องทาง</th><th>${clientSortHeader('Due date', 'dueAt')}</th><th>${clientSortHeader('KYC / ความพร้อม', 'dataReady')}</th><th>เปิดเคส</th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${esc(row.name)}</strong><small>${esc(row.clientRef)}</small></td><td>${esc(row.rmOwner)}</td><td class="number-cell">${fmtMoney(row.aum)}</td><td class="number-cell">${fmtMoney(row.availableLiquidity)}</td><td><strong>${esc(row.mainGoal)}</strong>${row.goalDueSoon ? '<small class="warning-text">ใกล้ถึงกำหนด</small>' : ''}</td><td class="why-now-cell">${esc(row.whyNow)}${row.riskBreach ? '<small class="warning-text">พอร์ตเกินกรอบ</small>' : ''}</td><td><span class="priority-pill ${esc(String(row.priorityTier).toLowerCase())}">${esc(row.priorityTier)}</span></td><td>${esc(channelLabel(row.channel))}</td><td>${row.dueAt ? esc(formatDate(row.dueAt)) : '—'}</td><td>${row.readinessBlocker ? `<span class="readiness-status is-blocked">${esc(row.readinessBlocker)}</span>` : '<span class="readiness-status is-ready">พร้อม</span>'}</td><td><button class="compact-button primary" type="button" ${row.actionId ? `data-open-case="${esc(row.actionId)}"` : 'disabled'}>เปิดเคส</button></td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderClients() {
    const rows = filteredClientMonitorRows();
    const owners = [...new Set(clientMonitorRows().map((row) => row.rmOwner))].sort((a, b) => a.localeCompare(b, 'th'));
    const savedViews = [['all','ทั้งหมด'],['contact-today','ต้องติดต่อวันนี้'],['high-aum-liquidity','AUM สูงและมีสภาพคล่อง'],['goal-due','เป้าหมายใกล้ถึงกำหนด'],['risk-breach','พอร์ตเกินกรอบ'],['not-ready','KYC/บัญชียังไม่พร้อม'],['handoff','รอผู้เชี่ยวชาญ'],['no-contact','ยังไม่ควรติดต่อ']];
    return `<section class="v3-page">
      ${commonHead('ดูแลลูกค้า', 'ลูกค้า', 'เคสที่ต้องดูแลมาก่อนผลประโยชน์และโอกาสทางธุรกิจ คะแนน ML เป็นเพียงข้อมูลประกอบ')}
      <div class="client-monitor-toolbar"><label class="inline-search"><span>⌕</span><input id="clientSearchV3" type="search" value="${esc(state.clientQuery)}" placeholder="ชื่อ เลขอ้างอิง RM เป้าหมาย หรือเหตุผล"></label><div class="view-toggle" role="group" aria-label="รูปแบบการแสดงลูกค้า"><button type="button" data-client-view="table" class="${state.clientViewMode === 'table' ? 'is-active' : ''}">ตาราง</button><button type="button" data-client-view="cards" class="${state.clientViewMode === 'cards' ? 'is-active' : ''}">การ์ด</button></div></div>
      <div class="saved-views client-saved-views" role="group" aria-label="มุมมองลูกค้าที่บันทึกไว้">${savedViews.map(([id,label]) => `<button class="filter-chip ${state.clientSavedView === id ? 'is-active' : ''}" type="button" data-client-saved-view="${id}">${label}</button>`).join('')}</div>
      <div class="client-monitor-controls"><label>เรียงตาม<select id="clientSortV3" class="select-control"><option value="ranking" ${state.clientSort === 'ranking' ? 'selected' : ''}>ลำดับดูแลลูกค้า</option><option value="aum" ${state.clientSort === 'aum' ? 'selected' : ''}>AUM</option><option value="availableLiquidity" ${state.clientSort === 'availableLiquidity' ? 'selected' : ''}>สภาพคล่องใช้ได้</option><option value="recentTransactionActivity" ${state.clientSort === 'recentTransactionActivity' ? 'selected' : ''}>รายการล่าสุด</option><option value="dueAt" ${state.clientSort === 'dueAt' ? 'selected' : ''}>ความเร่งด่วน / วันครบกำหนด</option><option value="goalDueSoon" ${state.clientSort === 'goalDueSoon' ? 'selected' : ''}>เป้าหมายใกล้ถึงกำหนด</option><option value="riskBreach" ${state.clientSort === 'riskBreach' ? 'selected' : ''}>พอร์ตเกินกรอบ</option><option value="lastContactAt" ${state.clientSort === 'lastContactAt' ? 'selected' : ''}>ติดต่อล่าสุด</option><option value="contactCount30Days" ${state.clientSort === 'contactCount30Days' ? 'selected' : ''}>จำนวนครั้งที่ติดต่อ</option><option value="dataReady" ${state.clientSort === 'dataReady' ? 'selected' : ''}>ความพร้อมข้อมูล</option><option value="rmOwner" ${state.clientSort === 'rmOwner' ? 'selected' : ''}>RM เจ้าของ</option></select></label><label>RM เจ้าของ<select id="clientOwnerFilterV3" class="select-control"><option value="all">ทุก RM</option>${owners.map((owner) => `<option value="${esc(owner)}" ${state.clientOwnerFilter === owner ? 'selected' : ''}>${esc(owner)}</option>`).join('')}</select></label><label>ความพร้อม<select id="clientReadinessFilterV3" class="select-control"><option value="all" ${state.clientReadinessFilter === 'all' ? 'selected' : ''}>ทั้งหมด</option><option value="ready" ${state.clientReadinessFilter === 'ready' ? 'selected' : ''}>พร้อม</option><option value="blocked" ${state.clientReadinessFilter === 'blocked' ? 'selected' : ''}>มี blocker</option></select></label><button type="button" class="sort-direction-button" data-client-sort-direction aria-label="สลับทิศทางการเรียง">${state.clientSortDirection === 'asc' ? 'น้อย → มาก' : 'มาก → น้อย'}</button><span class="asof-chip">${rows.length} ลูกค้า</span></div>
      <p class="client-ranking-note"><strong>ลำดับหลัก:</strong> Mandatory Care → ประโยชน์และความเร่งด่วน → ผลต่อเป้าหมาย → ช่องทางและกำลังรองรับ → มูลค่าธุรกิจ</p>
      ${state.clientViewMode === 'cards' ? renderClientMonitorCards(rows) : renderClientMonitorTable(rows)}
    </section>`;
  }

  function normalizedGoal(goal) {
    return {
      ...goal,
      name: first(goal.name, goal.title, 'เป้าหมาย'),
      targetAmount: first(goal.targetAmount, goal.target, 0),
      currentFunding: first(goal.currentFunding, goal.currentValue, goal.allocatedValue, 0),
      fundedRatio: first(goal.fundedRatio, goal.target ? Number(goal.currentFunding || goal.currentValue || 0) / Number(goal.target) : null),
      baseProbability: first(goal.baseSuccessProbability, goal.baseProbability, goal.successProbability),
      stressProbability: first(goal.stressSuccessProbability, goal.stressProbability),
      shortfall: first(goal.shortfall, Math.max(0, Number(goal.targetAmount || goal.target || 0) - Number(goal.currentFunding || goal.currentValue || 0))),
    };
  }

  function goalIcon(type) {
    return ({ EMERGENCY: 'ฉ', EDUCATION: 'ศ', RETIREMENT: 'ก', HOME: 'บ', HEALTHCARE: 'ส', GROWTH: 'ต', LEGACY: 'ม' })[type] || 'ป';
  }

  function renderGoals() {
    const rmClientIds = activeRmClientIds();
    const visibleGoals = goals().filter((goal) => rmClientIds.has(goal.clientId));
    return `<section class="v3-page">
      ${commonHead('Goal Ledger', 'เป้าหมายของลูกค้า', `มุมมอง ${activeRmOwner()} · เงินก้อนเดียวถูกจัดสรรให้แต่ละเป้าหมายเพียงครั้งเดียว และกันเงินสำรองก่อนเสมอ`)}
      <div class="toolbar-row"><div class="saved-views"><button class="filter-chip is-active">ทุกเป้าหมาย</button><button class="filter-chip">ใกล้ถึงกำหนด</button><button class="filter-chip">โอกาสสำเร็จลดลง</button><button class="filter-chip">ข้อมูลไม่ครบ</button></div><span class="asof-chip">ยอดจัดสรรไม่ซ้ำกัน</span></div>
      <div class="goal-grid">${visibleGoals.map((raw) => { const goal = normalizedGoal(raw); const width = Math.min(100, Math.max(0, Number(goal.fundedRatio || 0) * 100)); return `<article class="goal-card"><header><div><p class="eyebrow">${esc(first(goal.clientName,goal.clientRef,'ลูกค้าสาธิต'))}</p><h3>${esc(goal.name)}</h3><p>กำหนด ${esc(first(goal.targetDate,goal.date,goal.horizonLabel,'รอยืนยัน'))}</p></div><span class="goal-icon">${goalIcon(goal.type)}</span></header><div class="funded-ring" aria-label="มีเงินแล้ว ${fmtPct(goal.fundedRatio)}"><i style="width:${width}%"></i></div><div class="goal-stats"><span><b>${fmtMoney(goal.targetAmount)}</b>เป้าหมาย</span><span><b>${fmtMoney(goal.currentFunding)}</b>เงินที่จัดสรร</span><span><b>${fmtPct(goal.baseProbability)}</b>โอกาสสำเร็จฐาน</span><span><b class="stress-value">${fmtPct(goal.stressProbability)}</b>เมื่อเกิดความเครียด</span><span><b>${fmtMoney(goal.shortfall)}</b>เงินที่ยังขาด</span><span><b>${fmtMoney(first(goal.requiredMonthlyContribution, goal.monthlyContribution, 0))}</b>เงินเติมต่อเดือน</span></div><p class="source-line">ทบทวนครั้งถัดไป ${esc(first(goal.nextReview, 'ภายใน 90 วัน'))} · ${esc(first(goal.sourceLabel, 'ข้อมูลสาธิต Client 360'))}</p></article>`; }).join('') || '<div class="empty-v3">ยังไม่มี Goal Ledger</div>'}</div>
    </section>`;
  }

  function renderPortfolioAllocation() {
    const book = obj(state.builderBook);
    if (book.status === 'loading' || book.status === 'idle') return `<section class="v3-page">${commonHead('Unified Portfolio Workspace', 'พอร์ตและการจัดสรร', 'กำลังโหลดพอร์ตลูกค้าและสินทรัพย์จริงจาก SETSMART', '', 'SETSMART Live + Demo Client Holdings')}<div class="empty-v3"><h2>กำลังเตรียมพอร์ตลูกค้า 30 ราย</h2><p>ระบบกำลังจับคู่สถานะถือครองสาธิตกับ symbol และราคาจริงจาก SETSMART</p></div></section>`;
    if (book.status === 'error') return `<section class="v3-page">${commonHead('Unified Portfolio Workspace', 'พอร์ตและการจัดสรร', 'ยังโหลด workspace ไม่สำเร็จ')}<div class="empty-v3"><h2>เปิดพอร์ตและการจัดสรรไม่สำเร็จ</h2><p>${esc(book.error)}</p><button class="primary-button" type="button" data-builder-reload>ลองอีกครั้ง</button></div></section>`;
    const rmPortfolios = list(book.portfolios).filter((item) => item.rmOwner === activeRmOwner());
    if (!state.builderClientId) {
      const monitorByClient = new Map(list(state.data?.clientMonitor?.rows).map((row) => [row.clientId, row]));
      return `<section class="v3-page portfolio-client-list-page">
        ${commonHead('Unified Portfolio Workspace', 'พอร์ตและการจัดสรร', 'เลือกลูกค้าก่อน แล้วดูพอร์ต วิเคราะห์ความเสี่ยง ปรับน้ำหนัก และบันทึกเป็น Draft Proposal ในหน้าเดียว', '', `SETSMART Live · ${new Intl.NumberFormat('th-TH').format(Number(book.totalUniverse||0))} assets`)}
        <div class="source-separation-banner"><strong>ลูกค้า ${esc(rmPortfolios.length)} ราย · ${esc(activeRmOwner())}</strong><span>เลือก RM คนอื่นได้จากมุมขวาบน</span><span>Asset/ราคา: SETSMART จริง ณ ${esc(book.marketAsOf)}</span></div>
        <div class="table-wrap portfolio-client-list"><table class="v3-table"><thead><tr><th>Client</th><th>RM Owner</th><th>AUM</th><th>Portfolio Value</th><th>Available Liquidity</th><th>Main Goal</th><th>Risk Status</th><th>Last Review</th><th>Priority</th><th>Action</th></tr></thead><tbody>${rmPortfolios.map((item) => { const monitor = obj(monitorByClient.get(item.clientId)); return `<tr><td><strong>${esc(item.clientName)}</strong><small>${esc(item.clientRef)}</small></td><td>${esc(item.rmOwner)}</td><td>${fmtMoney(first(monitor.aum,item.portfolioValue))}</td><td>${fmtMoney(item.portfolioValue)}</td><td>${fmtMoney(monitor.availableLiquidity)}</td><td>${esc(first(monitor.mainGoal,item.primaryGoal))}</td><td>${monitor.riskBreach?'<span class="readiness-status is-blocked">เกินกรอบ</span>':'<span class="readiness-status is-ready">อยู่ในกรอบ</span>'}</td><td>${esc(formatDate(first(monitor.lastContactAt,item.marketAsOf)))}</td><td><span class="priority-pill ${esc(String(first(monitor.priorityTier,'P3')).toLowerCase())}">${esc(first(monitor.priorityTier,'P3'))}</span></td><td><div class="row-actions"><button class="compact-button primary" type="button" data-portfolio-open="${esc(item.clientId)}" data-workspace="overview">ดูและจัดพอร์ต</button><button class="compact-button" type="button" data-portfolio-open="${esc(item.clientId)}" data-workspace="overview">เปิดสรุปอย่างเดียว</button></div></td></tr>`; }).join('')}</tbody></table></div>
      </section>`;
    }
    const portfolio = builderPortfolio();
    const holdings = list(state.builderDraftHoldings);
    const totalWeight = holdings.reduce((sum,item)=>sum+Number(first(item.draftWeight,0)),0);
    const residualCash = Math.max(0,1-totalWeight);
    const overWeight = totalWeight>1+1e-9;
    const maxPositionRows = holdings.filter((item)=>Number(first(item.draftWeight,0))>.35+1e-9);
    const analysis = obj(state.builderAnalysis);
    const comparisons = list(analysis.comparisons);
    const typeLabels = {CS:'หุ้นสามัญ',CSF:'หุ้นต่างประเทศ',DR:'DR',ETF:'ETF',UT:'Unit Trust',W:'Warrant',DWC:'DW Call',DWP:'DW Put'};
    const comparisonMetric = (value,kind='pct') => kind==='number' ? fmtNumber(value,2) : kind==='money' ? fmtMoney(value) : fmtPct(value);
    const comparisonTable = comparisons.length ? `<div class="table-wrap builder-comparison-table"><table class="v3-table"><thead><tr><th>ผลเปรียบเทียบ</th>${comparisons.map((item)=>`<th>${esc(item.label)}</th>`).join('')}</tr></thead><tbody>${[
      ['มูลค่าเริ่มต้นสาธิต','startingValue','money'],['P&L ย้อนหลัง (บาท)','periodPnl','money'],['มูลค่าปลายงวดจาก price return','endingValue','money'],['ผลตอบแทนรวมของช่วง','periodReturn'],['ผลตอบแทนต่อปี','annualizedReturn'],['ความผันผวนต่อปี','volatility'],['Best Year','bestYear'],['Worst Year','worstYear'],['ขาดทุนสูงสุด','maxDrawdown'],['Sharpe','sharpe','number'],['Sortino','sortino','number'],['Calmar','calmar','number'],['Downside Deviation','downsideDeviation'],['Historical VaR 95%','var95'],['CVaR / Expected Shortfall','cvar95'],['จำนวนข้อมูล','observationCount','number'],
    ].map(([label,key,kind])=>`<tr><th>${esc(label)}</th>${comparisons.map((item)=>`<td>${comparisonMetric(item.metrics?.[key],kind)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
    const resultPanel = state.builderAnalysisStatus === 'loading'
      ? '<div class="empty-v3"><h2>กำลังวิเคราะห์ข้อมูลย้อนหลังจริง</h2><p>ดึงประวัติราคาแต่ละ symbol และจับคู่เฉพาะวันที่ตรงกัน โดยไม่ forward-fill</p></div>'
      : state.builderAnalysisStatus === 'error'
        ? `<div class="policy-note"><strong>ยังวิเคราะห์ไม่ได้:</strong> ${esc(state.builderAnalysisError)}<br>ลองลดจำนวน asset หรือเลือกช่วงที่มีประวัติร่วมกันมากขึ้น</div>`
        : comparisons.length
          ? `<div class="builder-results-head"><div><p class="eyebrow">ผลจาก deterministic calculator</p><h2>Current vs RM Draft vs Model Diagnostic vs No-action</h2><p>${esc(analysis.period?.startDate)} ถึง ${esc(analysis.period?.endDate)} · ${esc(analysis.period?.observationCount)} วันที่ตรงกันจริง</p></div><span class="status-pill">${esc(analysis.calculationId)}</span></div>${comparisonTable}<p class="source-line"><strong>P&L ย้อนหลัง:</strong> มูลค่าเริ่มต้นสาธิต × price return ของช่วง โดยสมมติว่าไม่มี cash flow · ไม่ใช่ realized/unrealized P&L และไม่ใช่ total return</p><div class="builder-chart-grid"><article class="chart-card-v3"><div class="chart-head"><div><h3>Growth of THB 1</h3><p>Price return จาก SETSMART · ไม่ใช่ total return</p></div></div><div class="chart-wrap"><canvas id="builderGrowthChart" aria-label="Growth of one baht"></canvas></div></article><article class="chart-card-v3"><div class="chart-head"><div><h3>Efficient frontier</h3><p>Historical arithmetic mean + shrunk covariance · diagnostic only</p></div></div><div class="chart-wrap"><canvas id="builderFrontierChart" aria-label="Efficient frontier"></canvas></div></article></div><article class="portfolio-section"><div class="section-bar compact"><div><h2>น้ำหนักจาก Model Diagnostic</h2><p>RM เลือกใช้ แก้ไข หรือไม่ใช้ก็ได้ ไม่มีการส่งคำสั่งซื้อขาย</p></div><button class="compact-button primary" type="button" data-builder-apply-model>นำมาเป็น RM Draft</button></div><div class="model-weight-grid">${list(analysis.model?.weights).filter((item)=>item.weight>.0001).map((item)=>`<article><strong>${esc(item.symbol)}</strong><span>${fmtPct(item.weight)}</span></article>`).join('')}</div>${list(analysis.warnings).map((warning)=>`<p class="source-line">• ${esc(warning)}</p>`).join('')}</article>`
          : '<div class="empty-v3"><h2>ปรับน้ำหนักแล้วกด “วิเคราะห์พอร์ต”</h2><p>ผลทุกตัวเลขจะมาจากประวัติราคาจริงและ calculator ฝั่ง backend</p></div>';
    const assetDiagnosticTable = list(analysis.assetDiagnostics).length ? `<article class="portfolio-section asset-diagnostics"><div class="section-bar compact"><div><h2>Asset diagnostics</h2><p>ค่าที่ใช้สร้าง frontier · historical arithmetic price return · ไม่ใช่ forecast</p></div></div><div class="table-wrap"><table class="v3-table"><thead><tr><th>Asset</th><th>Expected Return</th><th>Volatility</th><th>Sharpe</th><th>Current</th><th>Draft</th><th>AI Model</th><th>Min / Max</th><th>Return contribution</th></tr></thead><tbody>${list(analysis.assetDiagnostics).map((row)=>`<tr><td><strong>${esc(row.symbol)}</strong></td><td>${fmtPct(row.expectedReturn)}</td><td>${fmtPct(row.volatility)}</td><td>${fmtNumber(row.sharpe,2)}</td><td>${fmtPct(row.currentWeight)}</td><td>${fmtPct(row.draftWeight)}</td><td>${fmtPct(row.modelWeight)}</td><td>${fmtPct(row.minWeight)} / ${fmtPct(row.maxWeight)}</td><td>${fmtPct(row.expectedReturnContribution)}</td></tr>`).join('')}</tbody></table></div></article>` : '';
    const selectedClient = clients().find((client) => client.clientId === state.builderClientId) || {};
    const monitor = list(state.data?.clientMonitor?.rows).find((row) => row.clientId === state.builderClientId) || {};
    const clientGoals = list(selectedClient.goals);
    const currentComparison = comparisons.find((item) => item.id === 'CURRENT');
    const draftComparison = comparisons.find((item) => item.id === 'DRAFT');
    const currentMetrics = obj(currentComparison?.metrics);
    const draftMetrics = obj(draftComparison?.metrics);
    const workspaceTabs = [['overview','ภาพรวม'],['performance','ผลตอบแทน'],['risk','ความเสี่ยง'],['builder','จัดพอร์ต'],['compare','เปรียบเทียบ'],['goals','ผลต่อเป้าหมาย'],['history','ประวัติร่าง']];
    const workspaceHeader = `<div class="portfolio-workspace-sticky"><div class="workspace-client-selector"><label><span>ลูกค้า</span><select id="builderClientSelect">${rmPortfolios.map((item)=>`<option value="${esc(item.clientId)}" ${item.clientId===state.builderClientId?'selected':''}>${esc(item.clientName)} · ${esc(item.rmOwner)}</option>`).join('')}</select></label><button type="button" class="compact-button" data-portfolio-list>กลับรายชื่อลูกค้า</button></div><div class="workspace-client-facts"><div><span>Client ID</span><strong>${esc(portfolio.clientRef)}</strong></div><div><span>RM Owner</span><strong>${esc(portfolio.rmOwner)}</strong></div><div><span>AUM / Portfolio</span><strong>${fmtMoney(first(monitor.aum,portfolio.portfolioValue))}</strong></div><div><span>Available liquidity</span><strong>${fmtMoney(monitor.availableLiquidity)}</strong></div><div><span>Main goals</span><strong>${esc(clientGoals.slice(0,2).map((goal)=>goal.name).join(' · ')||portfolio.primaryGoal)}</strong></div><div><span>Suitability</span><strong>${esc(first(portfolio.suitabilityStatus,'รอยืนยัน'))}</strong></div><div><span>Source / status</span><strong>SETSMART Live + Demo Client</strong></div><div><span>As-of / Benchmark</span><strong>${esc(portfolio.marketAsOf)} · No-action</strong></div></div><nav class="portfolio-workspace-tabs" aria-label="พื้นที่ทำงานพอร์ต">${workspaceTabs.map(([id,label])=>`<button type="button" data-portfolio-workspace="${id}" class="${state.portfolioWorkspace===id?'is-active':''}">${label}</button>`).join('')}</nav></div>`;
    const workspaceShell = (content) => `<section class="v3-page unified-portfolio-workspace">${commonHead('Client Portfolio Workspace', 'พอร์ตและการจัดสรร', 'ดูพอร์ต วิเคราะห์ความเสี่ยง ปรับน้ำหนัก และบันทึกข้อเสนอโดยไม่แก้ Current Portfolio', '', `SETSMART Live · ${new Intl.NumberFormat('th-TH').format(Number(book.totalUniverse||0))} assets`)}${workspaceHeader}<div class="source-separation-banner"><strong>Asset และราคา: SETSMART จริง ณ ${esc(portfolio.marketAsOf)}</strong><span>ลูกค้า/จำนวนหน่วย/สถานะถือครอง: Demo Client Data</span><span>Approved shelf/eligibility: ต้องยืนยันจากนโยบายธนาคาร</span></div>${content}</section>`;
    const holdingsTable = `<div class="table-wrap"><table class="v3-table"><thead><tr><th>Product</th><th>ประเภท</th><th>Current Weight</th><th>Market Value</th><th>Price/NAV</th><th>Source</th><th>Approved shelf</th><th>Readiness</th></tr></thead><tbody>${list(portfolio.holdings).map((holding)=>`<tr><td><strong>${esc(holding.symbol)}</strong><small>${esc(holding.productId)}</small></td><td>${esc(first(typeLabels[holding.securityType],holding.securityType))}</td><td>${fmtPct(holding.currentWeight)}</td><td>${fmtMoney(holding.marketValue)}</td><td>${fmtNumber(holding.close,4)}</td><td>SETSMART · ${esc(holding.marketAsOf)}</td><td>ต้องยืนยัน</td><td>ต้องยืนยันนโยบาย</td></tr>`).join('')}</tbody></table></div>`;
    if (state.portfolioWorkspace === 'overview') {
      const overviewMetrics = [
        ['Start Balance',fmtMoney(currentMetrics.startingValue),'startBalance','มูลค่าเริ่มต้นสาธิตของช่วง'],['Net Contribution','แสดงใน cash-flow ledger','netContribution','ไม่ปนกับ price-return P&L'],['Net Withdrawal','แสดงใน cash-flow ledger','netWithdrawal','ไม่ปนกับ price-return P&L'],['End Balance',fmtMoney(currentMetrics.endingValue),'endBalance','มูลค่าจาก price return โดยสมมติ no-flow'],['TWR','ต้องใช้ valuation รอบ cash flow','twr','ใช้วัดผลงานพอร์ตเมื่อมี cash flow'],['XIRR','ต้องใช้ cash-flow ledger ที่ reconcile แล้ว','xirr','ประสบการณ์เงินจริงของลูกค้า'],['CAGR',currentMetrics.periodReturn==null?'ใช้ไม่ได้':fmtPct(currentMetrics.annualizedReturn),'cagr','แสดงเฉพาะ no-flow price-return diagnostic'],['Expected Return',fmtPct(currentMetrics.annualizedReturn),'expectedReturn','Historical geometric price return'],['Volatility',fmtPct(currentMetrics.volatility),'volatility','annualised ตามความถี่จริง'],['Max Drawdown',fmtPct(currentMetrics.maxDrawdown),'maxDrawdown','จาก running peak'],['Sharpe',fmtNumber(currentMetrics.sharpe,2),'sharpe','ผลตอบแทนส่วนเกินต่อความผันผวน'],['Sortino',fmtNumber(currentMetrics.sortino,2),'sortino','เทียบ downside deviation'],['Calmar',fmtNumber(currentMetrics.calmar,2),'calmar','ผลตอบแทนต่อ drawdown'],['VaR',fmtPct(currentMetrics.var95),'var','Historical empirical 95%'],['CVaR',fmtPct(currentMetrics.cvar95),'cvar','ค่าเฉลี่ย tail loss 5%'],['Observation count',fmtNumber(currentMetrics.observationCount,0),'observations','วันที่ตรงกันจริง ไม่มี forward fill']
      ];
      return workspaceShell(`<div class="workspace-section-head"><div><h2>ภาพรวมพอร์ตปัจจุบัน</h2><p>Current และ Draft เป็นคนละ object · Current ไม่ถูกแก้จนกว่าจะผ่าน human approval</p></div><button class="primary-button" type="button" data-portfolio-workspace="builder">สร้าง RM Draft</button></div><div class="allocation-summary-grid"><article class="portfolio-section"><h3>Current allocation · ${esc(portfolio.holdingCount)} assets</h3><div class="holding-symbol-list overview-allocation">${list(portfolio.holdings).map((holding)=>`<span>${esc(holding.symbol)} <b>${fmtPct(holding.currentWeight)}</b></span>`).join('')}</div>${holdingsTable}</article><article class="portfolio-section"><h3>Performance summary</h3><p class="source-line">${currentMetrics.expectedReturnMethod||'กำลังคำนวณ'} · ${esc(analysis.period?.startDate||'—')} ถึง ${esc(analysis.period?.endDate||'—')}</p><div class="metric-grid-v3 portfolio-metrics">${overviewMetrics.map((row)=>metricCard(...row)).join('')}</div></article></div>`);
    }
    if (state.portfolioWorkspace === 'performance') {
      const details = obj(analysis.strategyDetails?.CURRENT);
      return workspaceShell(`<article class="portfolio-section builder-results">${resultPanel}</article><div class="analytics-chart-grid"><article class="chart-card-v3"><h3>Annual returns</h3><div class="year-bars">${list(details.calendarYears).map((row)=>`<div><span>${esc(row.year)}</span><i class="${row.value<0?'negative':''}" style="width:${Math.min(100,Math.abs(row.value)*400)}%"></i><b>${fmtPct(row.value)}</b></div>`).join('')||'<p>ข้อมูลยังไม่พอ</p>'}</div></article><article class="chart-card-v3"><h3>Monthly return heatmap</h3><div class="monthly-heatmap">${list(details.monthly).map((row)=>`<span class="${row.value<0?'negative':'positive'}"><b>${esc(row.month)}</b>${fmtPct(row.value)}</span>`).join('')||'<p>ข้อมูลยังไม่พอ</p>'}</div></article><article class="chart-card-v3"><h3>Drawdown</h3><p>Peak ${esc(details.drawdownEvents?.peakDate||'—')} · Trough ${esc(details.drawdownEvents?.troughDate||'—')} · Recovery ${esc(details.drawdownEvents?.recoveryDate||'ยังไม่ฟื้น')}</p></article><article class="chart-card-v3"><h3>Rolling 12M / Volatility</h3><p>${esc(list(details.rolling12MReturn).length)} จุด · calculator result เดียวกัน · ไม่ smooth</p></article></div>`);
    }
    if (state.portfolioWorkspace === 'risk') {
      const labels = list(analysis.correlation?.symbols);
      return workspaceShell(`<article class="portfolio-section"><div class="workspace-section-head"><div><h2>ความเสี่ยงและการกระจาย</h2><p>Common dates only · no forward-fill · technical PCA ซ่อนใน audit detail</p></div><span class="asof-chip">${esc(analysis.period?.observationCount||0)} observations</span></div><div class="risk-summary-grid"><div><h3>Correlation matrix</h3><div class="table-wrap"><table class="v3-table correlation-table"><thead><tr><th></th>${labels.map((label)=>`<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${labels.map((label,row)=>`<tr><th>${esc(label)}</th>${labels.map((_,column)=>`<td>${fmtNumber(analysis.correlation?.values?.[row]?.[column],2)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div><div class="risk-cards"><article><span>Effective holdings</span><strong>${fmtNumber(analysis.risk?.effectiveHoldings,1)}</strong></article><article><span>Residual cash</span><strong>${fmtPct(analysis.immediateImpact?.residualCashWeight)}</strong></article><article><span>Concentration สูงสุด</span><strong>${fmtPct(analysis.immediateImpact?.concentration)}</strong></article><article><span>Suitability / readiness</span><strong>ต้องยืนยัน policy</strong></article></div><div><h3>Top concentration</h3><ol class="risk-contributors">${list(analysis.risk?.topConcentrations).map((row)=>`<li><span>${esc(row.symbol)}</span><b>${fmtPct(row.weight)}</b></li>`).join('')}</ol></div><div><h3>Top risk contributors</h3><ol class="risk-contributors">${list(analysis.risk?.topRiskContributors).map((row)=>`<li><span>${esc(row.symbol)}</span><b>${fmtPct(row.contribution)}</b></li>`).join('')}</ol></div></div><details class="evidence-details"><summary>Model & Audit detail</summary><p>Covariance: ${esc(JSON.stringify(analysis.covariance||{}))}</p><p>Issuer/sector/currency: ไม่รองรับโดย listed EOD contract; ห้ามเดา</p></details></article>`);
    }
    if (state.portfolioWorkspace === 'compare') return workspaceShell(`<article class="portfolio-section builder-results">${resultPanel}</article>${assetDiagnosticTable}`);
    if (state.portfolioWorkspace === 'goals') return workspaceShell(`<article class="portfolio-section"><div class="workspace-section-head"><div><h2>ผลต่อเป้าหมาย</h2><p>RM ต้องเห็นว่า Draft กระทบเป้าหมายใด; ไม่สร้างตัวเลขหลังปรับจน validated goal calculator พร้อม</p></div></div><div class="table-wrap"><table class="v3-table"><thead><tr><th>Goal</th><th>Target / Date</th><th>Funded ratio</th><th>Base / Stress</th><th>Expected shortfall</th><th>CVaR shortfall</th><th>เติมต่อเดือน</th><th>Before / After Draft</th></tr></thead><tbody>${clientGoals.map((goal)=>`<tr><td><strong>${esc(goal.name)}</strong></td><td>${fmtMoney(first(goal.targetAmount,goal.target))}<small>${esc(goal.targetDate)}</small></td><td>${fmtPct(goal.fundedRatio)}</td><td>${fmtPct(goal.baseSuccessProbability)} / ${fmtPct(goal.stressSuccessProbability)}</td><td>${fmtMoney(goal.shortfall)}</td><td>ยังไม่มี validated projection</td><td>${fmtMoney(goal.requiredMonthlyContribution)}</td><td><span class="status-pill">Before พร้อม · After รอ calculator</span></td></tr>`).join('')}</tbody></table></div></article>`);
    if (state.portfolioWorkspace === 'history') return workspaceShell(`<article class="portfolio-section"><div class="workspace-section-head"><div><h2>ประวัติ Draft Proposal</h2><p>Draft แยกจาก Current และไม่มี auto-approval/auto-trade</p></div><button class="primary-button" type="button" data-builder-save>บันทึกร่างปัจจุบัน</button></div><div class="draft-history-list">${list(state.builderSavedDrafts).map((draft)=>`<article><div><strong>${esc(draft.draftId)}</strong><span>${esc(formatDate(draft.updatedAt))} · ${esc(draft.calculationId||'ยังไม่คำนวณ')}</span></div><div><span>${draft.holdings.length} assets · cash ${fmtPct(draft.residualCashWeight)}</span><button class="compact-button" type="button" data-builder-load-draft="${esc(draft.draftId)}">โหลดร่าง</button></div></article>`).join('')||'<div class="empty-v3">ยังไม่มีร่างที่บันทึก</div>'}</div></article>`);
    return `<section class="v3-page builder-page unified-portfolio-workspace">
      ${commonHead('Client Portfolio Workspace', 'พอร์ตและการจัดสรร', 'AI เรียก deterministic calculator เพื่อสร้าง Model Diagnostic; RM เพิ่ม ลด และแก้น้ำหนักใน Draft ได้เอง', '', `SETSMART Live · ${new Intl.NumberFormat('th-TH').format(Number(book.totalUniverse||0))} assets`)}
      ${workspaceHeader}
      <div class="builder-client-bar"><label><span>เลือกลูกค้า (${esc(rmPortfolios.length)} ราย)</span><select id="builderClientSelect">${rmPortfolios.map((item)=>`<option value="${esc(item.clientId)}" ${item.clientId===state.builderClientId?'selected':''}>${esc(item.clientName)} · ${esc(item.rmOwner)} · ${fmtMoney(item.portfolioValue)}</option>`).join('')}</select></label><div><span>RM เจ้าของ</span><strong>${esc(portfolio.rmOwner)}</strong></div><div><span>มูลค่าพอร์ต</span><strong>${fmtMoney(portfolio.portfolioValue)}</strong></div><div><span>เป้าหมายหลัก</span><strong>${esc(portfolio.primaryGoal)}</strong></div><div><span>ถืออยู่</span><strong>${esc(portfolio.holdingCount)} assets</strong></div></div>
      <div class="source-separation-banner"><strong>Asset และราคา: SETSMART จริง ณ ${esc(portfolio.marketAsOf)}</strong><span>ลูกค้า/จำนวนหน่วย/สถานะถือครอง: Demo Client Data</span><span>Approved shelf/eligibility: ต้องยืนยันจากนโยบายธนาคาร</span></div>
      <div class="builder-workspace">
        <article class="portfolio-section builder-editor"><div class="section-bar"><div><p class="eyebrow">RM Draft</p><h2>RM กำหนด asset และน้ำหนัก</h2><p>น้ำหนักต่ำกว่า 100% ถือเป็นเงินสด · มากกว่า 100% ถูกบล็อก</p></div><div class="builder-actions"><button type="button" class="compact-button" data-builder-reset>เริ่มจากพอร์ตปัจจุบัน</button><button type="button" class="compact-button" data-builder-equal>น้ำหนักเท่ากัน</button></div></div>
          <div class="table-wrap"><table class="v3-table builder-holdings-table"><thead><tr><th>Asset จริง</th><th>ประเภท</th><th>ราคาล่าสุด</th><th>จำนวนหน่วยสาธิต</th><th>Current</th><th>RM Draft</th><th>มูลค่าร่าง</th><th></th></tr></thead><tbody>${holdings.map((holding)=>`<tr><td><strong>${esc(holding.symbol)}</strong><small>${esc(holding.productId)} · SETSMART</small></td><td>${esc(first(typeLabels[holding.securityType],holding.securityType,'—'))}</td><td>${holding.close==null?'—':fmtNumber(holding.close,4)}<small>${esc(holding.marketAsOf||book.marketAsOf)}</small></td><td>${holding.quantity==null?'เพิ่มใหม่':new Intl.NumberFormat('th-TH',{maximumFractionDigits:2}).format(holding.quantity)}</td><td>${fmtPct(first(holding.currentWeight,0))}</td><td><label class="weight-input"><input type="number" min="0" max="100" step="0.1" value="${(Number(first(holding.draftWeight,0))*100).toFixed(1)}" data-builder-weight="${esc(holding.productId)}"><span>%</span></label></td><td>${fmtMoney(Number(first(holding.draftWeight,0))*Number(portfolio.portfolioValue||0))}</td><td><button type="button" class="icon-button" data-builder-remove="${esc(holding.productId)}" aria-label="ลบ ${esc(holding.symbol)}">×</button></td></tr>`).join('')}</tbody></table></div>
          <div class="builder-total ${overWeight?'is-invalid':''}"><div><span>น้ำหนักที่จัดแล้ว</span><strong>${fmtPct(totalWeight)}</strong></div><div><span>เงินสดคงเหลือ</span><strong>${fmtPct(residualCash)}</strong></div><div><span>Max position 35%</span><strong>${maxPositionRows.length?`${maxPositionRows.length} จุดเกินกรอบ`:'ผ่าน'}</strong></div><div><span>สถานะ</span><strong>${overWeight?'เกิน 100% · วิเคราะห์ไม่ได้':'พร้อมวิเคราะห์ร่าง'}</strong></div></div>
        </article>
        <aside class="portfolio-section builder-search"><div class="section-bar compact"><div><h2>Product Universe</h2><p>ค้นจาก SETSMART ${new Intl.NumberFormat('th-TH').format(Number(book.totalUniverse||0))} รายการ</p></div></div><label class="builder-search-input"><span>Symbol</span><input id="builderAssetSearch" type="search" value="${esc(state.builderAssetQuery)}" placeholder="เช่น PTT, AOT, TDEX"><button class="primary-button" type="button" data-builder-search>ค้นหา</button></label><label class="builder-type-filter"><span>ประเภท</span><select id="builderAssetType"><option value="All">ทั้งหมด</option>${['CS','DR','ETF','UT'].map((type)=>`<option value="${type}" ${state.builderAssetType===type?'selected':''}>${esc(typeLabels[type])}</option>`).join('')}</select></label><div class="builder-search-results">${state.builderAssetSearchStatus==='loading'?'<p>กำลังค้นหา SETSMART…</p>':list(state.builderAssetResults).map((row)=>{const added=holdings.some((holding)=>holding.productId===row.productId);return `<article draggable="true"><div><strong>${esc(row.symbol)}</strong><span>${esc(first(typeLabels[row.securityType],row.securityType))} · ${row.close==null?'—':fmtNumber(row.close,4)}</span></div><button type="button" class="compact-button" data-builder-add="${esc(row.productId)}" ${added||holdings.length>=12?'disabled':''}>${added?'อยู่ในพอร์ต':'เพิ่ม'}</button></article>`;}).join('')||'<p>ใส่ symbol เพื่อค้นหา asset จริง</p>'}</div><div class="policy-note"><strong>ไม่ใช่รายการที่อนุมัติ:</strong> การพบใน SETSMART ไม่ได้แปลว่าผ่าน approved shelf, suitability หรือ eligibility</div></aside>
        <aside class="portfolio-section builder-impact"><div class="section-bar compact"><div><h2>Immediate Impact</h2><p>อัปเดตจาก calculator service เมื่อ RM เปลี่ยนน้ำหนัก</p></div><span class="status-pill">${esc(state.builderAnalysisStatus)}</span></div><div class="impact-metric-list">${[['Expected return',draftMetrics.annualizedReturn,'pct'],['Volatility',draftMetrics.volatility,'pct'],['MaxDD',draftMetrics.maxDrawdown,'pct'],['Sharpe',draftMetrics.sharpe,'number'],['VaR 95%',draftMetrics.var95,'pct'],['CVaR',draftMetrics.cvar95,'pct'],['Liquidity / cash',analysis.immediateImpact?.residualCashWeight,'pct'],['Turnover',analysis.immediateImpact?.turnover,'pct'],['Concentration',analysis.immediateImpact?.concentration,'pct']].map(([label,value,kind])=>`<div><span>${esc(label)}</span><strong>${kind==='number'?fmtNumber(value,2):fmtPct(value)}</strong></div>`).join('')}</div><div class="policy-note"><strong>Fees / policy / readiness:</strong> ต้องใช้ Bank Product Catalog และ policy feed · AI ไม่เดา</div><div class="ai-model-note"><strong>AI Model Diagnostic</strong><p>Question/Trigger → deterministic model → validator → คำอธิบาย → RM ตัดสินใจ</p><button class="compact-button primary" type="button" data-builder-apply-model ${analysis.model?.weights?'':'disabled'}>นำ model มาเป็น RM Draft</button></div></aside>
      </div>
      <article class="portfolio-section builder-config"><div class="section-bar"><div><p class="eyebrow">Portfolio Optimization Configuration</p><h2>RM เลือกวิธีวิเคราะห์</h2><p>โครงสร้างแบบ Portfolio Visualizer แต่ใช้ข้อมูลไทยและ governance ของ FIN AI</p></div><div class="builder-actions"><button class="compact-button" type="button" data-builder-reset>Discard / Reset</button><button class="compact-button" type="button" data-builder-save ${overWeight||!holdings.length?'disabled':''}>บันทึก Draft Proposal</button><button class="compact-button primary" type="button" data-builder-compare ${overWeight||!holdings.length?'disabled':''}>เปรียบเทียบ</button><button class="primary-button" type="button" data-builder-analyze ${overWeight||!holdings.length?'disabled':''}>วิเคราะห์พอร์ต</button></div></div><div class="builder-config-grid"><label><span>ช่วงข้อมูล</span><select id="builderPeriod"><option value="1Y" ${state.builderPeriod==='1Y'?'selected':''}>1 ปี</option><option value="3Y" ${state.builderPeriod==='3Y'?'selected':''}>3 ปี</option><option value="5Y" ${state.builderPeriod==='5Y'?'selected':''}>5 ปี</option></select></label><label><span>Optimization Goal</span><select id="builderMethod"><option value="MAX_RETURN_TARGET_VOL" ${state.builderMethod==='MAX_RETURN_TARGET_VOL'?'selected':''}>ผลตอบแทนสูงสุดภายใต้ความผันผวนเป้าหมาย</option><option value="MIN_VARIANCE" ${state.builderMethod==='MIN_VARIANCE'?'selected':''}>Minimum Variance</option><option value="MAX_SHARPE" ${state.builderMethod==='MAX_SHARPE'?'selected':''}>Maximum Sharpe</option></select></label><label><span>Target Annual Volatility</span><div class="weight-input"><input id="builderTargetVol" type="number" min="1" max="40" step="0.5" value="${esc(state.builderTargetVolatility)}"><span>%</span></div></label><label><span>ข้อจำกัดตำแหน่ง</span><input value="Long-only · Max 35% · ≤12 assets" disabled></label><label><span>Expected Return Method</span><input value="Historical arithmetic price return" disabled></label><label><span>Covariance</span><input value="Common dates · shrinkage · PSD" disabled></label><label><span>Compared Allocation</span><input value="Current · Draft · AI Model · No-action" disabled></label><label><span>Robust Optimization</span><input value="ยังไม่เปิดใช้ · ต้อง validate ก่อน" disabled></label></div><p class="source-line">Model จาก deterministic calculator เป็น diagnostic เท่านั้น RM แก้ได้ ไม่มี auto-trade/auto-approve และไม่มีการอ้างว่าชนะตลาด</p></article>
      <article class="portfolio-section builder-results">${resultPanel}</article>
      <article class="portfolio-section client-holding-book"><div class="section-bar"><div><p class="eyebrow">Client Holding Book · ${esc(rmPortfolios.length)} clients</p><h2>ลูกค้าคนไหนถือ asset อะไร</h2><p>คลิก “เปิดพอร์ต” เพื่อโหลดทุกสถานะถือครองของลูกค้ารายนั้นเข้า RM Draft</p></div><span class="asof-chip">${esc(rmPortfolios.reduce((sum,item)=>sum+item.holdings.length,0))} positions</span></div><div class="table-wrap"><table class="v3-table"><thead><tr><th>ลูกค้า</th><th>RM</th><th>มูลค่าพอร์ต</th><th>ทุก asset ที่ถือ</th><th></th></tr></thead><tbody>${rmPortfolios.map((item)=>`<tr class="${item.clientId===state.builderClientId?'is-selected':''}"><td><strong>${esc(item.clientName)}</strong><small>${esc(item.clientRef)}</small></td><td>${esc(item.rmOwner)}</td><td>${fmtMoney(item.portfolioValue)}</td><td><div class="holding-symbol-list">${list(item.holdings).map((holding)=>`<span title="${esc(fmtMoney(holding.marketValue))}">${esc(holding.symbol)} <b>${fmtPct(holding.currentWeight)}</b></span>`).join('')}</div></td><td><button class="compact-button primary" type="button" data-builder-client="${esc(item.clientId)}">เปิดพอร์ต</button></td></tr>`).join('')}</tbody></table></div></article>
    </section>`;
  }

  function metricCard(label, value, metricId, meaning) {
    return `<article class="metric-card-v3"><span>${esc(label)}</span><strong>${esc(value)}</strong><div class="metric-actions"><button type="button" data-metric="${esc(metricId)}" data-meaning="${esc(meaning)}">แปลความหมาย</button><button type="button" data-metric-data="${esc(metricId)}">ข้อมูลที่ใช้</button></div></article>`;
  }

  function renderPortfolio() {
    const perf = performance();
    const metrics = obj(perf.metrics);
    const analytics = obj(perf.analytics);
    const summary = obj(analytics.summary);
    const portfolioClients = clients().map(normalizedClient).filter((client) => client.clientId === perf.clientId);
    const selectedClient = portfolioClients[0] || {};
    const holdings = list(perf.holdings);
    const allocation = state.allocationMode === 'fund'
      ? list(first(perf.allocationByMasterFund, perf.allocation))
      : list(first(perf.allocationByAssetClass, perf.allocation));
    const filteredHoldings = state.selectedAllocationKey
      ? holdings.filter((item) => state.allocationMode === 'fund'
        ? item.masterFundId === state.selectedAllocationKey
        : item.assetClass === state.selectedAllocationKey)
      : holdings;
    const colors = ['#18243f','#ef7622','#315ea8','#17745a','#a86508','#8b5fa7'];
    let offset = 0;
    const donutSegments = allocation.map((item, index) => {
      const weight = Math.max(0, Number(item.weight || 0));
      const key = first(item.key, item.masterFundId, item.assetClass, item.name);
      const segment = `<circle role="button" tabindex="0" aria-label="${esc(first(item.name,key))} ${esc(fmtPct(weight))}" data-allocation-key="${esc(key)}" cx="21" cy="21" r="15.915" pathLength="100" fill="none" stroke="${colors[index % colors.length]}" stroke-width="7" stroke-dasharray="${weight * 100} ${100 - weight * 100}" stroke-dashoffset="-${offset * 100}" class="${state.selectedAllocationKey === key ? 'is-selected' : ''}"></circle>`;
      offset += weight;
      return segment;
    }).join('');
    const calendarReturns = list(analytics.calendarYearReturns);
    const heatmap = list(analytics.monthlyReturnHeatmap);
    const correlation = obj(analytics.correlationMatrix);
    const correlationLabels = list(first(correlation.labels, correlation.names, correlation.symbols));
    const correlationValues = list(first(correlation.values, correlation.matrix));
    const goalImpact = list(first(analytics.goalImpact, perf.goalAttribution));
    const goalImpactRows = goalImpact.map((goal) => {
      const before = obj(first(goal.before, goal));
      const after = obj(first(goal.after, goal.afterAction));
      return {
        ...goal,
        fundedRatio: first(before.fundedRatio, goal.fundedRatio),
        baseSuccessProbability: first(before.baseSuccessProbability, goal.baseSuccessProbability),
        stressSuccessProbability: first(before.stressSuccessProbability, goal.stressSuccessProbability),
        shortfall: first(before.shortfall, goal.shortfall),
        requiredMonthlyContribution: first(before.requiredMonthlyContribution, goal.requiredMonthlyContribution),
        afterAvailable: goal.afterAvailable === true,
        afterBaseSuccessProbability: goal.afterAvailable === true ? first(after.baseSuccessProbability, null) : null,
      };
    });
    const metricRows = [
      ['Start Balance', fmtMoney(first(governedValue(summary.startBalance), perf.series?.[0]?.value)), 'startBalance', 'มูลค่าพอร์ต ณ วันแรกของช่วงที่เลือก'],
      ['Net Contribution', fmtMoney(first(governedValue(summary.netContribution), perf.flows?.filter((item)=>item.amount>0).reduce((sum,item)=>sum+item.amount,0),0)), 'netContribution', 'เงินที่ลูกค้าเติมเข้าพอร์ตในช่วงข้อมูล'],
      ['Net Withdrawal', fmtMoney(first(governedValue(summary.netWithdrawal), Math.abs(perf.flows?.filter((item)=>item.amount<0).reduce((sum,item)=>sum+item.amount,0) || 0))), 'netWithdrawal', 'เงินที่ลูกค้าถอนออกจากพอร์ตในช่วงข้อมูล'],
      ['End Balance', fmtMoney(first(governedValue(summary.endBalance), perf.series?.at(-1)?.value)), 'endBalance', 'มูลค่าพอร์ต ณ วันสุดท้ายของช่วงที่เลือก'],
      ['กำไร/ขาดทุนสุทธิของช่วง (P&L)', fmtMoney(governedValue(summary.periodPnl)), 'periodPnl', 'การเปลี่ยนแปลงมูลค่าพอร์ตหลังตัดเงินที่ลูกค้าเติมและบวกเงินที่ถอนกลับ เพื่อไม่เรียกเงินเติมว่าเป็นกำไร'],
      ['กำไร/ขาดทุนที่รับรู้แล้ว', summary.realizedPnl?.available === false ? 'ยังไม่มีต้นทุนที่ยืนยัน' : fmtMoney(governedValue(summary.realizedPnl)), 'realizedPnl', 'กำไรหรือขาดทุนจากรายการขายที่เกิดขึ้นแล้ว ต้องมีต้นทุนราย lot และธุรกรรมที่ตรวจสอบได้'],
      ['กำไร/ขาดทุนที่ยังไม่รับรู้', summary.unrealizedPnl?.available === false ? 'ยังไม่มีต้นทุนที่ยืนยัน' : fmtMoney(governedValue(summary.unrealizedPnl)), 'unrealizedPnl', 'ส่วนต่างระหว่างมูลค่าปัจจุบันกับต้นทุนคงเหลือ ต้องมีต้นทุนราย lot ที่ตรวจสอบได้'],
      ['TWR', fmtPct(first(metrics.twr, perf.twr)), 'twr', 'ผลตอบแทนของพอร์ตโดยตัดผลของเงินเข้าออก ใช้ดูผลการบริหารพอร์ต'],
      ['XIRR', fmtPct(first(metrics.xirr, perf.xirr)), 'xirr', 'ผลตอบแทนตามประสบการณ์เงินจริงของลูกค้า โดยคำนึงถึงวันและจำนวนเงินเข้าออก'],
      ['CAGR', first(metrics.cagr, perf.cagr) == null ? 'ใช้ไม่ได้เมื่อมีเงินเข้าออก' : fmtPct(first(metrics.cagr, perf.cagr)), 'cagr', 'ใช้ได้เมื่อไม่มีเงินเข้าออกเท่านั้น และใช้จำนวนวันจริง'],
      ['Expected Return', governedValue(summary.expectedReturn) == null ? 'ข้อมูลยังไม่พอ' : fmtPct(governedValue(summary.expectedReturn)), 'expectedReturn', first(summary.expectedReturn?.method,'คำนวณจากสมมติฐานที่อนุมัติและน้ำหนักพอร์ต')],
      ['Annualised Volatility', fmtPct(first(metrics.annualizedVolatility, metrics.volatility)), 'volatility', 'ดูว่าผลตอบแทนแกว่งมากเพียงใด โดยปรับตามความถี่จริงของข้อมูล'],
      ['Best Year', governedValue(summary.bestYear) == null ? 'ข้อมูลยังไม่พอ' : `${summary.bestYear.year} · ${fmtPct(governedValue(summary.bestYear))}`, 'bestYear', 'ผลตอบแทนปีปฏิทินที่สูงที่สุดในช่วงข้อมูล'],
      ['Worst Year', governedValue(summary.worstYear) == null ? 'ข้อมูลยังไม่พอ' : `${summary.worstYear.year} · ${fmtPct(governedValue(summary.worstYear))}`, 'worstYear', 'ผลตอบแทนปีปฏิทินที่ต่ำที่สุดในช่วงข้อมูล'],
      ['Maximum Drawdown', fmtPct(first(metrics.maxDrawdown, perf.maxDrawdown)), 'maxDrawdown', 'การลดลงมากที่สุดจากจุดสูงสุดถึงจุดต่ำสุดในช่วงข้อมูลที่เลือก'],
      ['Sharpe', fmtNumber(metrics.sharpe,2), 'sharpe', 'ผลตอบแทนส่วนเกินต่อความผันผวนหนึ่งหน่วย'],
      ['Sortino', fmtNumber(metrics.sortino,2), 'sortino', 'ผลตอบแทนส่วนเกินต่อความผันผวนด้านลบหนึ่งหน่วย'],
      ['Calmar', fmtNumber(metrics.calmar,2), 'calmar', 'ผลตอบแทนทบต้นของ TWR path ต่อขนาดขาดทุนสูงสุด'],
      ['Downside Deviation', fmtPct(first(metrics.downsideDeviation, metrics.annualizedDownsideDeviation)), 'downside', 'วัดเฉพาะการแกว่งต่ำกว่าเกณฑ์ขั้นต่ำ'],
      ['Historical VaR 95%', fmtPct(first(metrics.var95, metrics.var)), 'var', 'ค่าขาดทุนที่ข้อมูลย้อนหลัง 95% ของวันไม่เกิน'],
      ['CVaR / Expected Shortfall', fmtPct(first(metrics.cvar95, metrics.cvar)), 'cvar', 'ค่าเฉลี่ยขาดทุนใน 5% ของวันที่แย่ที่สุด'],
      ['Market Beta', summary.marketBeta?.available === false || governedValue(summary.marketBeta) == null ? 'ใช้ไม่ได้' : fmtNumber(governedValue(summary.marketBeta),2), 'marketBeta', 'ความไวต่อ benchmark จากวันที่ตรงกันเท่านั้น'],
      ['จำนวนข้อมูล', `${esc(first(perf.observationCount, list(perf.series).length))} วัน`, 'observations', 'จำนวนวันที่มี NAV ตรงกันจริง ไม่มีการเติมผลตอบแทน'],
    ];
    return `<section class="v3-page">
      ${commonHead('Governed performance · Fixture', 'พอร์ตและความเสี่ยง', 'Portfolio Visualizer-style evidence โดยไม่เปลี่ยน workflow เดิม และไม่ smooth ข้อมูล', '')}
      <div class="portfolio-identity"><div><span>ลูกค้า</span><strong>${esc(first(perf.clientName,selectedClient.name,'คุณชญานิน อ.'))}</strong><small>${esc(first(perf.clientRef,selectedClient.ref,'FIN • 7K3P'))}</small></div><div><span>RM เจ้าของ</span><strong>${esc(first(perf.rmOwner,selectedClient.owner,'RM คุณพลอย'))}</strong><small>ประมาณ 6 ลูกค้าต่อ RM</small></div><div><span>มูลค่าพอร์ต</span><strong>${fmtMoney(first(governedValue(summary.endBalance),perf.series?.at(-1)?.value))}</strong><small>THB</small></div><div><span>Benchmark</span><strong>${esc(first(perf.benchmarkName,'เกณฑ์นโยบาย 30/40/30'))}</strong><small>${esc(summary.marketBeta?.available === false ? 'beta ใช้ไม่ได้' : `beta ${fmtNumber(governedValue(summary.marketBeta),2)}`)}</small></div><div><span>As-of</span><strong>${esc(formatDate(first(perf.asOf,meta().asOf)))}</strong><small>${esc(first(perf.periodLabel,'ช่วงข้อมูลที่เลือก'))}</small></div><div><span>Data status</span><strong>Fixture / Demo</strong><small>${esc(first(perf.returnTypeLabel,'NAV return · ไม่ใช่ total return'))}</small></div></div>
      <article class="portfolio-section"><div class="section-bar compact"><div><h2>Allocation + Performance Summary</h2><p>คลิก segment เพื่อ filter ตารางและเส้นข้อมูล · รวม share class ก่อนวัด diversification</p></div><div class="range-buttons">${['1M','3M','6M','1Y','3Y','5Y','SI'].map((range) => `<button type="button" data-range="${range}" class="${state.performanceRange === range ? 'is-active' : ''}">${range === 'SI' ? 'Since inception' : range}</button>`).join('')}</div></div><div class="allocation-summary-grid"><div class="allocation-panel"><div class="allocation-toggle"><button type="button" data-allocation-mode="asset" class="${state.allocationMode === 'asset' ? 'is-active' : ''}">Asset class</button><button type="button" data-allocation-mode="fund" class="${state.allocationMode === 'fund' ? 'is-active' : ''}">Master fund</button><button type="button" data-allocation-clear ${state.selectedAllocationKey ? '' : 'disabled'}>ล้าง filter</button></div><div class="allocation-layout"><div class="donut-svg"><svg viewBox="0 0 42 42" aria-label="Allocation donut">${donutSegments}</svg><div class="donut-label"><b>${esc(fmtNumber(first(governedValue(summary.effectiveHoldings),perf.effectiveHoldings,allocation.length),1))}</b>กองทุนเทียบเท่า</div></div><div class="allocation-legend">${allocation.map((item,index)=>{const key=first(item.key,item.masterFundId,item.assetClass,item.name);return `<button type="button" data-allocation-key="${esc(key)}" class="${state.selectedAllocationKey===key?'is-active':''}"><i style="background:${colors[index%colors.length]}"></i><span>${esc(first(item.name,key))}</span><b>${fmtPct(item.weight)}</b></button>`;}).join('')}</div></div><div class="table-wrap holding-table-wrap"><table class="v3-table"><thead><tr><th>กองทุน / Share class</th><th>Master fund</th><th>Asset class</th><th>มูลค่า</th><th>น้ำหนัก</th></tr></thead><tbody>${filteredHoldings.map((item)=>`<tr><td><strong>${esc(first(item.name,item.fundId))}</strong><small>${esc(first(item.fundId,'—'))}</small></td><td>${esc(first(item.masterFundId,'—'))}</td><td>${esc(first(item.assetClass,'—'))}</td><td>${fmtMoney(item.value)}</td><td>${fmtPct(item.weight)}</td></tr>`).join('')}</tbody></table></div></div><div class="performance-summary"><div class="metric-grid-v3 portfolio-metrics">${metricRows.map((row)=>metricCard(...row)).join('')}</div></div></div></article>
      <article class="chart-card-v3"><div class="chart-head"><div><h3>Portfolio value · THB</h3><p>${state.selectedAllocationKey ? `กำลัง filter: ${esc(state.selectedAllocationKey)}` : 'พอร์ตทั้งหมด'} · จุดจริงจาก governed result object</p></div><div class="chart-controls"><button type="button" data-chart-zoom="out">−</button><button type="button" data-chart-zoom="in">+</button><button type="button" data-chart-zoom="reset">รีเซ็ต</button></div></div><div class="chart-wrap"><canvas id="portfolioValueChart" role="img" aria-label="กราฟมูลค่าพอร์ตและ benchmark"></canvas></div><div class="chart-legend interactive"><button type="button" data-chart-legend="portfolio" class="${state.chartVisibility.portfolio?'is-active':''}">พอร์ต / ส่วนที่เลือก</button><button type="button" data-chart-legend="benchmark" class="benchmark ${state.chartVisibility.benchmark?'is-active':''}">Benchmark</button><button type="button" data-chart-legend="flows" class="flow ${state.chartVisibility.flows?'is-active':''}">Contribution / Withdrawal</button></div></article>
      <article class="chart-card-v3"><div class="chart-head"><div><h3>Drawdown</h3><p>จาก running peak · tooltip แสดง peak / trough / recovery เมื่อมีข้อมูล</p></div><button class="compact-button" type="button" data-metric="maxDrawdown">วิธีตีความ</button></div><div class="chart-wrap compact"><canvas id="drawdownChart" role="img" aria-label="กราฟ drawdown ของพอร์ต"></canvas></div></article>
      <div class="analytics-chart-grid"><article class="chart-card-v3"><div class="chart-head"><div><h3>Calendar-year return</h3><p>ไม่ smooth ข้อมูล</p></div></div><div class="year-bars">${calendarReturns.map((item)=>`<div><span>${esc(item.year)}</span><i class="${item.value<0?'negative':''}" style="width:${Math.min(100,Math.abs(Number(first(item.value,item.return,0)))*400)}%"></i><b>${fmtPct(first(item.value,item.return))}</b></div>`).join('') || '<p class="source-line">ข้อมูลยังไม่พอ</p>'}</div></article><article class="chart-card-v3"><div class="chart-head"><div><h3>Monthly return heatmap</h3><p>สีแสดง sign และขนาด ไม่ใช่การพยากรณ์</p></div></div><div class="monthly-heatmap">${heatmap.map((item)=>`<span class="${Number(first(item.value,item.return,0))<0?'negative':'positive'}" style="--heat:${Math.min(1,Math.abs(Number(first(item.value,item.return,0)))*20)}" title="${esc(first(item.month,item.date))}: ${esc(fmtPct(first(item.value,item.return)))}"><b>${esc(first(item.month,item.date))}</b>${fmtPct(first(item.value,item.return))}</span>`).join('') || '<p class="source-line">ข้อมูลยังไม่พอ</p>'}</div></article><article class="chart-card-v3"><div class="chart-head"><div><h3>Rolling 12M return</h3><p>ผลตอบแทนย้อนหลัง 12 เดือน ณ แต่ละวัน</p></div></div><div class="chart-wrap mini"><canvas id="rollingReturnChart" role="img" aria-label="Rolling 12 month return"></canvas></div></article><article class="chart-card-v3"><div class="chart-head"><div><h3>Rolling volatility</h3><p>annualised ตามความถี่จริง</p></div></div><div class="chart-wrap mini"><canvas id="rollingVolChart" role="img" aria-label="Rolling volatility"></canvas></div></article></div>
      <div class="risk-goal-grid">
        <article class="portfolio-section"><div class="section-bar compact"><div><h2>Risk & Diversification</h2><p>PCA ซ่อนใน audit drawer</p></div><span class="asof-chip">common valid dates · no forward-fill</span></div><div class="risk-summary-grid"><div><h3>Correlation matrix</h3><div class="table-wrap"><table class="v3-table correlation-table"><thead><tr><th></th>${correlationLabels.map((label)=>`<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${correlationLabels.map((label,row)=>`<tr><th>${esc(label)}</th>${correlationLabels.map((_,col)=>`<td>${fmtNumber(correlationValues[row]?.[col],2)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div><div class="risk-cards"><article><span>Effective holdings</span><strong>${fmtNumber(first(governedValue(summary.effectiveHoldings),perf.effectiveHoldings),1)}</strong></article><article><span>Master-fund duplication</span><strong>${esc(list(analytics.duplicationWarnings).length ? `${list(analytics.duplicationWarnings).length} จุด` : 'ไม่พบ')}</strong></article><article><span>Currency exposure</span><strong>${esc(list(analytics.currencyExposure).map((item)=>`${item.currency} ${fmtPct(item.weight)}`).join(' · ') || 'THB 100%')}</strong></article></div><div><h3>Top concentration risks</h3><ul class="warning-list">${list(analytics.concentrationRisks).slice(0,5).map((item)=>`<li>${esc(first(item.label,item.message,item.name))} ${first(item.value,item.weight)!=null?`· ${fmtPct(first(item.value,item.weight))}`:''}</li>`).join('') || '<li>ไม่พบ concentration ที่เกินเกณฑ์สาธิต</li>'}</ul></div><div><h3>Top 5 risk contributors</h3><ol class="risk-contributors">${list(analytics.topRiskContributors).slice(0,5).map((item)=>`<li><span>${esc(first(item.name,item.label,item.key))}</span><b>${fmtPct(first(item.riskShare,item.contribution,item.weight))}</b></li>`).join('') || '<li><span>ข้อมูลยังไม่พอ</span></li>'}</ol></div></div><details class="evidence-details"><summary>เปิด Quant / PCA detail</summary><div><p>รายละเอียด PCA, covariance settings, input hash และ validation traces อยู่ใน audit detail เท่านั้น ไม่ใช้เป็น RM mode</p><p class="source-line">${esc(first(analytics.audit?.calculationId,perf.audit?.calculationId,'—'))}</p></div></details></article>
        <article class="portfolio-section"><div class="section-bar compact"><div><h2>Goal Impact</h2><p>เชื่อมพอร์ตกับชื่อเป้าหมายโดยตรง</p></div><span class="asof-chip">ก่อน action · ผลหลัง action ต้องคำนวณก่อน</span></div><div class="table-wrap"><table class="v3-table goal-impact-table"><thead><tr><th>Goal</th><th>Target / Date</th><th>Funded</th><th>Base / Stress</th><th>Shortfall</th><th>เติมต่อเดือน</th><th>ผลหลัง action</th></tr></thead><tbody>${goalImpactRows.map((goal)=>`<tr><td><strong>${esc(first(goal.name,goal.goalName))}</strong></td><td>${fmtMoney(first(goal.targetAmount,goal.target))}<small>${esc(first(goal.targetDate,'—'))}</small></td><td>${fmtPct(goal.fundedRatio)}</td><td>${fmtPct(first(goal.baseSuccessProbability,goal.baseProbability))} / ${fmtPct(first(goal.stressSuccessProbability,goal.stressProbability))}</td><td>${fmtMoney(goal.shortfall)}</td><td>${fmtMoney(first(goal.requiredMonthlyContribution,0))}</td><td>${goal.afterAvailable ? `${fmtPct(goal.baseSuccessProbability)} → ${fmtPct(goal.afterBaseSuccessProbability)}` : '<span class="status-pill">ยังไม่คำนวณ</span>'}</td></tr>`).join('') || '<tr><td colspan="7">ยังไม่มี Goal Ledger</td></tr>'}</tbody></table></div><p class="source-line">${esc(first(perf.returnTypeLabel,'NAV return · ไม่ใช่ total return'))} · ${esc(first(perf.sourceLabel,'FixtureMutualFundAdapter'))} · ${esc(first(perf.periodLabel,'5 ปี'))}</p></article>
      </div>
    </section>`;
  }

  function renderMarket() {
    const tabs = [['setsmart','SETSMART Live'],['nav','กองทุน Demo'],['category','ผลตอบแทนตามประเภท'],['events','เหตุการณ์ตลาด'],['impact','ผลกระทบต่อลูกค้า'],['quality','คุณภาพข้อมูล']];
    const listed = obj(state.setsmartListed);
    const listedRows = list(listed.items);
    const securityTypeLabels = {
      All: 'ทั้งหมด', CS: 'หุ้นสามัญ', CSF: 'หุ้นต่างประเทศ', DR: 'DR',
      DWC: 'DW Call', DWP: 'DW Put', ETF: 'ETF', PS: 'หุ้นบุริมสิทธิ',
      PSF: 'หุ้นบุริมสิทธิต่างประเทศ', UT: 'Unit Trust', W: 'Warrant',
    };
    const typeCounts = Object.entries(obj(listed.countsByType))
      .filter(([, count]) => Number(count) > 0)
      .sort(([left], [right]) => left.localeCompare(right, 'en'));
    const pageStart = Number(listed.filteredTotal) > 0 ? Number(listed.offset || 0) + 1 : 0;
    const pageEnd = Math.min(Number(listed.filteredTotal || 0), Number(listed.offset || 0) + listedRows.length);
    const cacheState = first(listed.cache?.state, '—');
    const marketNumber = (value, digits = 2) => Number.isFinite(Number(value))
      ? new Intl.NumberFormat('th-TH', { maximumFractionDigits: digits }).format(Number(value))
      : '—';
    let content;
    if (state.marketTab === 'setsmart' && listed.status === 'loading') content = `<div class="empty-v3"><h2>กำลังดึงข้อมูล SETSMART</h2><p>Backend กำลังเรียกคลังหลักทรัพย์ EOD จริงด้วย credential ฝั่ง server แล้วส่งเฉพาะหน้าที่ต้องแสดง</p></div>`;
    else if (state.marketTab === 'setsmart' && listed.status === 'error') content = `<div class="empty-v3"><h2>ยังดึง SETSMART ไม่สำเร็จ</h2><p>${esc(first(listed.error,'SETSMART_LISTED_UNAVAILABLE'))}</p><button class="primary-button" type="button" data-reload-setsmart>ลองอีกครั้ง</button></div>`;
    else if (state.marketTab === 'setsmart') content = `<div class="audit-grid"><article class="audit-card"><span>แหล่งข้อมูล</span><strong>SETSMART · Live EOD</strong></article><article class="audit-card"><span>ข้อมูล ณ</span><strong>${esc(formatDate(listed.asOf))}</strong></article><article class="audit-card"><span>คลังสินทรัพย์จริง</span><strong>${esc(new Intl.NumberFormat('th-TH').format(Number(listed.totalUniverse || 0)))} รายการ</strong></article><article class="audit-card"><span>ผลลัพธ์หลังกรอง</span><strong>${esc(new Intl.NumberFormat('th-TH').format(Number(listed.filteredTotal || 0)))} รายการ</strong></article></div>${cacheState === 'STALE_FALLBACK' ? '<div class="policy-note"><strong>คำเตือน:</strong> SETSMART ตอบกลับไม่สำเร็จ จึงแสดง cache ล่าสุด กรุณาตรวจวันที่ข้อมูลก่อนใช้</div>' : ''}<div class="market-facets"><button type="button" data-setsmart-type="All" class="${state.setsmartAssetType === 'All' ? 'is-active' : ''}"><span>ทั้งหมด</span><b>${esc(new Intl.NumberFormat('th-TH').format(Number(listed.totalUniverse || 0)))}</b></button>${typeCounts.map(([type,count]) => `<button type="button" data-setsmart-type="${esc(type)}" class="${state.setsmartAssetType === type ? 'is-active' : ''}"><span>${esc(first(securityTypeLabels[type],type))}</span><b>${esc(new Intl.NumberFormat('th-TH').format(Number(count)))}</b></button>`).join('')}</div><div class="market-toolbar-v3"><label><span>ค้นหา Symbol</span><input id="setsmartAssetSearch" type="search" value="${esc(state.setsmartAssetQuery)}" placeholder="เช่น TDEX, PTT, AOT" autocomplete="off"></label><button class="primary-button" type="button" data-setsmart-search>ค้นหา</button><label><span>ประเภท</span><select id="setsmartAssetTypeFilter"><option value="All">ทั้งหมด</option>${typeCounts.map(([type,count]) => `<option value="${esc(type)}" ${state.setsmartAssetType === type ? 'selected' : ''}>${esc(first(securityTypeLabels[type],type))} (${esc(count)})</option>`).join('')}</select></label><label><span>แสดงต่อหน้า</span><select id="setsmartAssetPageSize">${[25,50,100,200].map((size) => `<option value="${size}" ${Number(state.setsmartAssetLimit) === size ? 'selected' : ''}>${size}</option>`).join('')}</select></label><button class="compact-button" type="button" data-reload-setsmart>รีเฟรช</button></div><div class="table-wrap market-table-wrap"><table class="v3-table"><thead><tr><th>Symbol</th><th>ประเภท</th><th>ราคาปิด</th><th>NAV ตาม contract</th><th>มูลค่าซื้อขาย</th><th>Market cap</th><th>แหล่งข้อมูล</th></tr></thead><tbody>${listedRows.map((row) => `<tr><td><strong>${esc(row.symbol)}</strong><small>${esc(row.adjustedPriceFlag === 'Y' ? 'Adjusted price' : 'Unadjusted price')}</small></td><td>${esc(first(securityTypeLabels[row.securityType],row.securityType))}<small>${esc(row.securityType)}</small></td><td>${marketNumber(row.close,4)}<small>ราคาซื้อขาย · ไม่ใช่ NAV</small></td><td>${row.nav == null ? '—' : marketNumber(row.nav,4)}<small>${esc(row.navField === 'bvps' ? 'field: bvps' : 'NOT SUPPORTED')}</small></td><td>${row.totalValue == null ? '—' : fmtMoney(row.totalValue)}</td><td>${row.marketCap == null ? '—' : fmtMoney(row.marketCap)}</td><td><span class="status-pill">SETSMART Live</span><small>${esc(row.returnType)} · ไม่ใช่ total return</small></td></tr>`).join('') || '<tr><td colspan="7">ไม่พบสินทรัพย์ที่ตรงกับคำค้นและประเภทนี้</td></tr>'}</tbody></table></div><div class="pagination-v3"><span>แสดง ${esc(pageStart)}–${esc(pageEnd)} จาก ${esc(new Intl.NumberFormat('th-TH').format(Number(listed.filteredTotal || 0)))} · cache ${esc(cacheState)}</span><div><button class="compact-button" type="button" data-setsmart-page="previous" ${listed.previousOffset == null ? 'disabled' : ''}>ก่อนหน้า</button><button class="compact-button" type="button" data-setsmart-page="next" ${listed.nextOffset == null ? 'disabled' : ''}>ถัดไป</button></div></div><div class="policy-note"><strong>ขอบเขตที่ยืนยัน:</strong> คลังนี้มาจาก Company Fundamental Data API Specification V1.0 จริง ใช้ค้นหาหลักทรัพย์ตามประเภทที่สิทธิ์ API ส่งกลับ ปัจจุบัน close คือราคาซื้อขาย และ bvps เป็น NAV เฉพาะ UT/ETF ตาม contract ระบบไม่เดาชื่อผู้ออก สกุลเงิน ความเสี่ยง approved shelf suitability หรือกองทุนเปิดทุก share class</div>`;
    else if (state.marketTab === 'events') content = `<div class="market-grid">${list(state.data?.marketEvents).map((item) => `<article class="fund-card-v3"><header><div><p class="eyebrow">${esc(first(item.severityLabel,'เหตุการณ์เฝ้าดู'))}</p><h3>${esc(item.title)}</h3></div><span class="status-pill">${esc(first(item.asOf,meta().asOf))}</span></header><p>${esc(item.summary)}</p><div class="policy-note">${esc(first(item.implication,'ใช้เป็น trigger ให้ตรวจเป้าหมาย ไม่ใช้สั่งซื้อขาย'))}</div></article>`).join('') || '<div class="empty-v3">ยังไม่มีเหตุการณ์ที่ต้องยกระดับ</div>'}</div>`;
    else if (state.marketTab === 'quality') content = `<div class="audit-grid"><article class="audit-card"><span>ข้อมูลตลาดจดทะเบียน</span><strong>${listed.status === 'ready' ? 'SETSMART Live' : esc(first(listed.status,'ยังไม่เรียก'))}</strong></article><article class="audit-card"><span>พอร์ตกองทุนเปิด</span><strong>Fixture / Demo</strong></article><article class="audit-card"><span>วันที่ SETSMART</span><strong>${esc(formatDate(listed.asOf))}</strong></article><article class="audit-card"><span>กฎสำคัญ</span><strong>ห้ามปน market fact กับ bank policy</strong></article></div><div class="table-wrap"><table class="v3-table"><thead><tr><th>กองทุน Demo</th><th>ข้อมูลล่าสุด</th><th>จำนวนข้อมูล</th><th>ประเภทผลตอบแทน</th><th>สถานะ</th></tr></thead><tbody>${funds().map((fund) => `<tr><td><strong>${esc(first(fund.nameTh,fund.name,fund.fundCode))}</strong></td><td>${esc(formatDate(first(fund.navAsOf,fund.freshness?.asOf,meta().asOf)))}</td><td>${esc(first(fund.observationCount,fund.dataQuality?.observationCount,'—'))}</td><td>${esc(first(fund.returnTypeLabel,fund.returnType,'NAV_RETURN'))}</td><td>Fixture / Demo</td></tr>`).join('')}</tbody></table></div>`;
    else content = `<div class="market-grid">${funds().filter((fund) => state.marketTab !== 'nav' || first(fund.approved,true)).map((fund) => `<article class="fund-card-v3"><header><div><p class="eyebrow">${esc(first(fund.fundCode,fund.shareClassId,fund.masterFundId))}</p><h3>${esc(first(fund.nameTh,fund.name,'กองทุนไทยตัวอย่าง'))}</h3><p>${esc(first(fund.amcNameTh,fund.amc,'AMC ตัวอย่าง'))}</p></div><span class="status-pill">เสี่ยง ${esc(first(fund.riskLevel,'—'))}</span></header><p>${esc(first(fund.objectiveTh,fund.objective,fund.summary,'ข้อมูลสาธิตของกองทุนรวมไทย'))}</p><div class="fund-tags"><span>${esc(first(fund.assetClassLabel,fund.assetClass,'กองทุนรวม'))}</span><span>${esc(first(fund.liquidityLabel,fund.liquidity,'T+2'))}</span><span>${esc(first(fund.returnTypeLabel,'NAV return'))}</span></div><button class="compact-button primary" type="button" data-explain-fund="${esc(first(fund.fundId,fund.shareClassId,fund.masterFundId))}">อธิบายให้ฉันเข้าใจ</button></article>`).join('') || '<div class="empty-v3">ไม่มีข้อมูลที่ผ่านเงื่อนไข</div>'}</div>`;
    return `<section class="v3-page">${commonHead('Market facts + governed product context', 'เหตุการณ์ตลาดและกองทุนไทย', 'ใช้ SETSMART จริงเฉพาะ field ที่ contract ยืนยัน และติดป้ายข้อมูลสาธิตของกองทุนเปิดแยกกัน', '', state.marketTab === 'setsmart' && listed.status === 'ready' ? `SETSMART Live · ${new Intl.NumberFormat('th-TH').format(Number(listed.totalUniverse || 0))} assets` : 'ข้อมูลผสม')}<div class="tabs-v3">${tabs.map(([id,label]) => `<button type="button" data-market-tab="${id}" class="${state.marketTab === id ? 'is-active' : ''}">${label}</button>`).join('')}</div>${content}</section>`;
  }

  function renderQueue() {
    const items = queue().filter((item) => item.owner === activeRmOwner());
    return `<section class="v3-page">${commonHead('Owner, capacity and follow-through', 'คิวและการส่งต่อ', 'เห็นสาย นัดหมาย ข้อความที่ตรวจแล้ว การส่งต่อ กำหนดเวลา และข้อจำกัดการติดต่อในที่เดียว')}
      <div class="summary-strip"><article class="mini-summary"><span>โทรวันนี้</span><strong>${items.filter((item) => first(item.type,item.channel) === 'CALL').length}</strong></article><article class="mini-summary"><span>นัดหมาย</span><strong>${items.filter((item) => first(item.type,item.channel) === 'MEETING').length}</strong></article><article class="mini-summary"><span>ข้อความที่ RM ตรวจ</span><strong>${items.filter((item) => first(item.type,item.channel) === 'REVIEWED_MESSAGE').length}</strong></article><article class="mini-summary data"><span>รอข้อมูล</span><strong>${items.filter((item) => first(item.type,item.channel) === 'CONFIRM_DATA').length}</strong></article><article class="mini-summary growth"><span>ส่งต่อผู้เชี่ยวชาญ</span><strong>${items.filter((item) => first(item.type,item.channel) === 'HANDOFF').length}</strong></article><article class="mini-summary care"><span>ล่าช้า</span><strong>${items.filter((item) => item.overdue).length}</strong></article></div>
      <div class="queue-layout"><div class="queue-stack">${items.map((item) => `<article class="queue-card"><span class="queue-type">${esc(({CALL:'โทร',MEETING:'นัด',REVIEWED_MESSAGE:'ข้อ',CONFIRM_DATA:'ถาม',HANDOFF:'ส่ง'})[first(item.type,item.channel)] || 'งาน')}</span><div><h3>${esc(first(item.title,item.topic,'งานติดตาม'))}</h3><p>${esc(first(item.clientName,item.client,'ลูกค้าสาธิต'))} · เจ้าของ ${esc(first(item.owner,activeRmOwner()))}</p></div><time>${esc(first(item.dueLabel,item.due,'วันนี้'))}</time></article>`).join('') || '<div class="empty-v3">ไม่มีงานค้าง</div>'}</div><aside class="side-stack"><article class="panel-card"><h3>ข้อจำกัดการติดต่อ</h3><div class="client-facts"><span><b>ไม่เกิน 2 ครั้ง</b>ใน 7 วัน</span><span><b>ไม่เกิน 5 ครั้ง</b>ใน 30 วัน</span><span><b>20:00–08:00</b>ช่วงห้ามรบกวน</span><span><b>1 แคมเปญ</b>ไม่เสนอซ้ำ</span></div></article><article class="panel-card"><h3>สิ่งที่การส่งต่อพกไปด้วย</h3><ul class="evidence-list"><li>ภาพรวมลูกค้าและเป้าหมาย</li><li>พอร์ต ความเสี่ยง และข้อมูลที่ขาด</li><li>คำถามที่ถามแล้วและความต้องการลูกค้า</li><li>เหตุผล แหล่งข้อมูล และวันครบกำหนด</li></ul></article></aside></div>
    </section>`;
  }

  function replayStrategyLabel(strategyId) {
    return ({
      CURRENT_NO_ACTION: 'พอร์ตปัจจุบัน · ไม่ดำเนินการ',
      ELIGIBLE_APPROVED_MODEL: 'โมเดลที่อนุมัติและลูกค้ามีสิทธิ์',
      SIMPLE_POLICY_BENCHMARK: 'เกณฑ์นโยบายแบบง่าย',
      GOAL_BASED_CANDIDATE: 'ทางเลือกที่ยึดเป้าหมายและสภาพคล่อง',
    })[strategyId] || strategyId;
  }

  function replayStatusLabel(status) {
    return ({ COMPLETE: 'มีผลทดสอบย้อนหลัง', NOT_RUN: 'ยังไม่ได้รัน', NOT_COLLECTED: 'ยังไม่มีข้อมูลจริง' })[status] || status || '—';
  }

  function renderReplayValidation(replay) {
    if (!replay.resultType) return '<div class="empty-v3">ยังไม่มีผล Historical Replay ใน build นี้</div>';
    const dataset = obj(replay.dataset);
    const protocol = obj(replay.protocol);
    const replayAudit = obj(replay.audit);
    const strategies = list(replay.strategies);
    const separation = obj(replay.resultSeparation);
    const separationItems = [separation.historicalReplay, separation.namedStress, separation.forwardSimulation, separation.livePilot].filter(Boolean);
    const stressPeriods = list(replay.stressPeriods);
    const pitPassed = replayAudit.pointInTimeAssertionsPassed === true
      && replayAudit.deterministicCalculationIds === true
      && replayAudit.replayableFromSeed === true;
    return `<section class="replay-section" aria-label="Historical replay validation">
      <div class="replay-head">
        <div><p class="eyebrow">Historical replay validation · ข้อมูลสังเคราะห์</p><h2>ตรวจระบบย้อนหลังโดยใช้เฉพาะข้อมูลที่มี ณ วันนั้น</h2><p>ใช้ตรวจการคำนวณ เป้าหมาย ข้อจำกัด alerts และภาระงาน RM ไม่ได้ใช้หา alpha หรือประกาศว่าทางเลือกใดเป็นผู้ชนะ</p></div>
        <span class="status-pill ${pitPassed ? 'pass' : 'warning'}">${pitPassed ? 'ผ่าน point-in-time checks' : 'ต้องตรวจ point-in-time'}</span>
      </div>
      <div class="replay-facts">
        <article><span>กองทุนไทยสังเคราะห์</span><strong>${esc(first(dataset.fundCount,'—'))} กอง</strong><small>${esc(first(dataset.returnType,'NAV_RETURN'))} · ไม่ใช่ total return</small></article>
        <article><span>ช่วงข้อมูล</span><strong>${esc(formatDate(dataset.historyStart))} – ${esc(formatDate(dataset.historyEnd))}</strong><small>${esc(first(dataset.observationFrequency,'BUSINESS_DAY_NAV'))}</small></article>
        <article><span>วันตัดสินใจ</span><strong>${esc(first(protocol.decisionDateCount,'—'))} เดือน</strong><small>${esc(first(protocol.method,'MONTHLY_WALK_FORWARD'))}</small></article>
        <article><span>ช่วงตลาดรุนแรง</span><strong>${esc(stressPeriods.length)} ช่วง</strong><small>ใช้เพื่อประเมินผลภายหลัง ไม่ใช่ข้อมูลล่วงหน้า</small></article>
      </div>
      <div class="replay-callout"><strong>วิธีอ่าน:</strong> เปรียบเทียบ trade-off หลายด้านร่วมกัน ไม่มีการเลือก “กองทุนชนะ” อัตโนมัติ และผลนี้ไม่ใช่ผลของกองทุน ลูกค้า หรือ pilot จริง</div>
      <div class="section-bar compact"><div><h3>ผลเปรียบเทียบแบบ walk-forward</h3><p>ตัวเลขทุกแถวใช้ 59 monthly decision dates และ frozen information set ก่อนประเมินเดือนถัดไป</p></div><span class="asof-chip">${esc(String(replay.calculationId || '').slice(0,30))}</span></div>
      <div class="table-wrap replay-table-wrap"><table class="v3-table replay-table"><thead><tr><th>ทางเลือกที่ตรวจ</th><th>TWR / XIRR</th><th>Volatility / CVaR</th><th>ขาดทุนสูงสุด</th><th>เป้าหมายสำเร็จ / Shortfall</th><th>Turnover</th><th>ค่ากองทุน / ธุรกรรม</th><th>ผิดสภาพคล่อง / Suitability</th><th>Care / False positive</th><th>ภาระงาน RM</th></tr></thead><tbody>${strategies.map((strategy) => { const metrics = obj(strategy.metrics); const workload = obj(metrics.rmWorkloadGenerated); const falsePositive = obj(metrics.falsePositiveAlertEvaluation); return `<tr><td><strong>${esc(replayStrategyLabel(strategy.strategyId))}</strong><small>${esc(strategy.strategyId)}</small></td><td>${esc(fmtPct(metrics.twr))} / ${metrics.xirrStatus === 'AVAILABLE' ? esc(fmtPct(metrics.xirr)) : 'ใช้ไม่ได้'}</td><td>${metrics.annualizedVolatilityStatus === 'AVAILABLE' ? esc(fmtPct(metrics.annualizedVolatility)) : 'ใช้ไม่ได้'} / ${esc(fmtPct(metrics.empiricalCVaR))}</td><td>${esc(fmtPct(metrics.maximumDrawdown))}</td><td>${esc(fmtPct(metrics.goalSuccessRate))} / ${esc(fmtPct(metrics.normalizedGoalShortfall))}</td><td>${esc(fmtPct(metrics.turnover))}</td><td>${esc(fmtMoney(metrics.productFeeEstimate))} / ${esc(fmtMoney(metrics.transactionCost))}</td><td>${esc(first(metrics.liquidityViolations,0))} / ${esc(first(metrics.suitabilityViolations,0))}</td><td>${esc(first(metrics.careAlerts,0))} / ${falsePositive.status === 'NOT_APPLICABLE' ? 'ใช้ไม่ได้' : esc(fmtPct(metrics.falsePositiveAlertRate))}</td><td>${esc(first(workload.actionCount,0))} งาน · ${esc(first(workload.estimatedMinutes,0))} นาที</td></tr>`; }).join('')}</tbody></table></div>
      <div class="replay-lower-grid">
        <article class="case-section"><h3>3 ช่วงตลาดรุนแรงที่ตรวจ</h3><div class="stress-list">${stressPeriods.map((period) => `<div><strong>${esc(period.nameTh)}</strong><span>${esc(formatDate(period.startDate))} – ${esc(formatDate(period.endDate))}</span><small>${esc(first(period.dataUse,'EVALUATION_ONLY')).replaceAll('_',' ')}</small></div>`).join('')}</div></article>
        <article class="case-section"><h3>แยกประเภทผลลัพธ์ชัดเจน</h3><div class="result-separation">${separationItems.map((item) => `<div><span>${esc(item.resultType)}</span><strong>${esc(replayStatusLabel(item.status))}</strong><small>${esc(item.meaningTh)}</small></div>`).join('')}</div></article>
      </div>
      <details class="evidence-details"><summary>ดูร่องรอยการ replay</summary><div class="replay-audit-details"><p><b>Calculation ID:</b> ${esc(replay.calculationId)}</p><p><b>Input hash:</b> ${esc(replay.inputHash)}</p><p><b>Model / assumptions:</b> ${esc(replay.modelVersion)} / ${esc(replay.assumptionVersion)}</p><p><b>Snapshot checks:</b> ${esc(first(replayAudit.decisionSnapshotCount,'—'))} วันตัดสินใจ · ตัด revision ที่ยังใช้ไม่ได้ ${esc(first(replayAudit.excludedUnavailableRevisionCount,'—'))} รายการ</p></div></details>
      <div class="claim-warning">${esc(first(replay.claimPolicy?.statementTh,'ผลทดสอบย้อนหลังไม่ใช่หลักฐานเชิงสาเหตุด้านรายได้หรือการรักษาลูกค้า'))}</div>
    </section>`;
  }

  function renderAudit() {
    const audit = obj(state.data?.audit);
    const replay = obj(state.data?.replay);
    const events = list(first(audit.events, state.data?.auditEvents));
    return `<section class="v3-page">${commonHead('Model & Audit Console', 'ตรวจสอบย้อนหลัง', 'RM ดูสรุปได้ แต่ไม่มีสิทธิ์เปลี่ยนสูตร สมมติฐาน กรอบความเสี่ยง หรือกติกานโยบาย')}
      <div class="audit-banner"><span class="audit-lock">◈</span><div><h2>มุมมองอ่านอย่างเดียวสำหรับ RM</h2><p>การเปิดร่องรอยเต็มต้องใช้บทบาท Quant / Model Owner, Risk, Compliance, System Administrator หรือ Auditor</p></div><span class="role-chip">RM · Read only</span></div>
      <div class="audit-grid"><article class="audit-card"><span>Model version</span><strong>${esc(first(audit.modelVersion,meta().modelVersion,'quant-v3.0.0'))}</strong></article><article class="audit-card"><span>Assumption version</span><strong>${esc(first(audit.assumptionVersion,meta().assumptionVersion,'fixture-2026-07'))}</strong></article><article class="audit-card"><span>Rule version</span><strong>${esc(first(audit.ruleVersion,meta().ruleVersion,'care-growth-v3'))}</strong></article><article class="audit-card"><span>Input hash</span><strong>${esc(String(first(audit.inputHash,'รอเปิดเคส')).slice(0,20))}</strong></article><article class="audit-card"><span>ผลที่ไม่มี metadata</span><strong>${esc(first(audit.numericResultsMissingMetadata,0))}</strong></article><article class="audit-card"><span>เส้นทางส่ง/ซื้อขายอัตโนมัติ</span><strong>${esc(first(audit.autoExecutionPaths,0))}</strong></article></div>
      ${renderReplayValidation(replay)}
      <div class="section-bar"><div><h2>ร่องรอย Action Card</h2><p>ทุก transition เก็บผู้ดำเนินการ เวลา เหตุผล และสถานะก่อน–หลัง</p></div><span class="asof-chip">Append-only demo log</span></div>
      <div class="table-wrap"><table class="v3-table"><thead><tr><th>เวลา</th><th>เลขอ้างอิง</th><th>ผู้ดำเนินการ</th><th>เหตุผล</th><th>สถานะเดิม → ใหม่</th><th>Calculation</th></tr></thead><tbody>${events.map((event) => `<tr><td>${esc(formatDate(first(event.timestamp,event.at)))}</td><td><strong>${esc(first(event.actionRef,event.actionId,event.eventId))}</strong></td><td>${esc(actorLabel(event))}</td><td>${esc(first(event.reason,event.decision,'สร้างเคส'))}</td><td>${esc(first(event.previousState,'—'))} → ${esc(first(event.nextState,event.state,'—'))}</td><td>${esc(first(event.calculationId,event.modelRunId,'—'))}</td></tr>`).join('') || '<tr><td colspan="6">ยังไม่มีเหตุการณ์ที่บันทึก</td></tr>'}</tbody></table></div>
    </section>`;
  }

  async function openCase(actionId, step = 'understand') {
    try {
      const payload = await api(`/api/v3/actions/${encodeURIComponent(actionId)}`);
      state.activeCase = payload;
      state.activeCaseId = actionId;
      state.caseStep = step;
      state.selectedDecision = first(payload.decision?.decision, null);
      state.handoffReviewed = false;
      state.feedback = {};
      state.draftText = first(payload.draft?.text, payload.card?.draftedMessage, payload.conversation?.draftedMessage, '');
      renderCase();
      $('#caseOverlay').classList.add('is-open');
      $('#caseOverlay').setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    } catch (error) { showToast(`เปิดเคสไม่สำเร็จ: ${error.message}`, 'error'); }
  }

  function closeCase() {
    $('#caseOverlay').classList.remove('is-open');
    $('#caseOverlay').setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    state.activeCase = null;
    state.activeCaseId = null;
    state.handoffReviewed = false;
    state.feedback = {};
  }

  function casePayload() { return obj(state.activeCase); }
  function card() { return obj(first(casePayload().card, casePayload().actionCard)); }
  function caseClient() { return obj(first(casePayload().client, casePayload().client360)); }
  function caseGoals() { return list(first(casePayload().goals, casePayload().goalLedger, caseClient().goals)); }
  function criticalMissing() { return list(first(card().missingData, casePayload().missingData)).length > 0 || first(card().state, '') === 'CONFIRM_DATA'; }

  function renderCase() {
    const c = card(); const client = caseClient();
    $('#caseHeader').innerHTML = `<button type="button" class="icon-button" data-close-case aria-label="ปิด">×</button><div class="case-header-main"><p class="eyebrow">${esc(first(c.friendlyActionId,c.actionRef,c.actionId))} · ${esc(first(client.clientRef,client.friendlyClientId,'ลูกค้าสาธิต'))}</p><h2 id="caseTitle">${esc(first(client.name,client.displayName,'ลูกค้าสาธิต'))} · ${esc(first(c.title,'ทบทวนเคส'))}</h2><p>${esc(first(c.whyNow,'ตรวจเหตุผล เป้าหมาย และข้อมูลก่อนตัดสินใจ'))}</p></div><div class="case-header-tags"><span class="lane-pill">${c.lane === 'GROWTH' ? 'Growth' : 'Care'}</span><span class="status-pill">${esc(first(c.priorityTier,'P1'))}</span><span class="asof-chip">ข้อมูล ณ ${esc(formatDate(first(casePayload().asOf,meta().asOf)))}</span></div>`;
    $('#caseSteps').innerHTML = stepLabels.map(([id,label], index) => `<button type="button" data-case-step="${id}" class="${state.caseStep === id ? 'is-active' : ''}"><span>${index + 1}</span>${label}</button>`).join('');
    const renderers = { understand: renderCaseUnderstand, verify: renderCaseVerify, prepare: renderCasePrepare, decide: renderCaseDecide, record: renderCaseRecord };
    $('#caseBody').innerHTML = `<div class="case-content">${(renderers[state.caseStep] || renderCaseUnderstand)()}</div>`;
    if (state.caseStep === 'record') enhanceFeedbackControls();
    if (state.caseStep === 'decide' && state.selectedDecision === 'HANDOFF') enhanceHandoffReview();
    renderCaseFooter();
  }

  function enhanceFeedbackControls() {
    const ambiguous = $('[data-feedback="priority"]', $('#caseBody'));
    if (!ambiguous) return;
    ambiguous.dataset.feedback = 'priorityHigh';
    ambiguous.textContent = 'ลำดับสูงเกินไป';
    ambiguous.classList.toggle('is-selected', Boolean(state.feedback.priorityHigh));
    const low = ambiguous.cloneNode(false);
    low.dataset.feedback = 'priorityLow';
    low.textContent = 'ลำดับต่ำเกินไป';
    low.classList.toggle('is-selected', Boolean(state.feedback.priorityLow));
    ambiguous.after(low);
  }

  function enhanceHandoffReview() {
    const review = $('.handoff-review', $('#caseBody'));
    const grid = review && $('.coach-grid', review);
    if (!review || !grid) return;
    const preview = obj(casePayload().handoffPreview);
    const holdings = document.createElement('article');
    holdings.className = 'coach-card';
    holdings.innerHTML = `<h3>พอร์ตปัจจุบัน</h3><ul>${list(preview.currentHoldings).slice(0,5).map((item) => `<li>${esc(item.name)} · ${fmtMoney(item.value)}</li>`).join('') || '<li>รอข้อมูลรายการถือครอง</li>'}</ul>`;
    const preferences = document.createElement('article');
    preferences.className = 'coach-card';
    preferences.innerHTML = `<h3>ความต้องการลูกค้า</h3><p>ช่องทาง ${esc(first(preview.clientPreferences?.preferredChannel,'รอยืนยัน'))} · ช่วงไม่รบกวน ${esc(first(preview.clientPreferences?.quietHours,'รอยืนยัน'))}</p>`;
    grid.append(holdings, preferences);
    const sources = document.createElement('p');
    sources.className = 'source-line';
    sources.textContent = `ครบกำหนด ${preview.dueDate ? formatDate(preview.dueDate) : 'รอกำหนด'} · แหล่งข้อมูล ${list(preview.sourceReferences).join(', ') || 'รอแหล่งอ้างอิง'}`;
    review.append(sources);
  }

  function renderCaseUnderstand() {
    const c = card(); const goal = normalizedGoal(caseGoals()[0] || {}); const evidence = list(c.evidence); const missing = list(c.missingData);
    return `<div class="decision-grid"><article class="decision-block"><span class="number">1</span><h3>เกิดอะไรขึ้น</h3><p>${esc(first(c.title,'พอร์ตและเป้าหมายต้องทบทวน'))}</p></article><article class="decision-block"><span class="number">2</span><h3>ทำไมจึงสำคัญ</h3><p>${esc(first(c.whyNow,'เป้าหมายใกล้ถึงกำหนดและความเสี่ยงอาจเกินกรอบ'))}</p></article><article class="decision-block"><span class="number">3</span><h3>เป้าหมายที่ได้รับผลกระทบ</h3><p>${esc(goal.name)} · เป้า ${fmtMoney(goal.targetAmount)} · กำหนด ${esc(first(goal.targetDate,goal.horizonLabel,'รอยืนยัน'))}</p></article><article class="decision-block action"><span class="number">4</span><h3>ต้องทำอะไรต่อ</h3><p>${esc(first(c.nextAction,channelLabel(c.channel)))}</p></article><article class="decision-block"><span class="number">5</span><h3>ต้องถามลูกค้าอะไร</h3><p>${esc(asArrayText(first(casePayload().coach?.questions,casePayload().questions))[0] || 'ยืนยันเป้าหมาย วันใช้เงิน และเงินสำรอง')}</p></article><article class="decision-block warning"><span class="number">6</span><h3>ข้อควรระวัง</h3><p>${esc(first(asArrayText(first(casePayload().coach?.warnings,casePayload().warnings))[0], 'ยังไม่มีคำสั่งซื้อขาย และตัวเลขเป็นผลจากข้อมูลย้อนหลัง'))}</p></article></div>
      <div class="case-two-col"><section class="case-section"><h3>หลักฐานสำคัญ</h3><ul class="evidence-list">${evidence.slice(0,4).map((item) => `<li><strong>${esc(first(item.label,item.title,item.type,'หลักฐาน'))}</strong> · ${esc(first(item.plainMeaning,item.description,item.value,'ตรวจแล้ว'))}</li>`).join('') || '<li>Client 360 และ Goal Ledger เวอร์ชันล่าสุด</li><li>NAV กองทุนไทยที่มีวันที่และแหล่งข้อมูล</li><li>ผลคำนวณเดียวกันในทุกมุมมอง</li>'}</ul><p class="source-line">แหล่งข้อมูล: ${esc(first(casePayload().sourceLabel, evidence[0]?.sourceRef, 'FixtureMutualFundAdapter'))} · ${esc(first(c.modelRunId,'model-run-v3'))}</p></section><section class="case-section"><h3>ข้อมูลที่ยังขาด</h3>${missing.length ? `<ul class="warning-list">${missing.map((item) => `<li>${esc(typeof item === 'string' ? item : first(item.label,item.field,item.reason))}</li>`).join('')}</ul><div class="blocked-banner"><span>!</span><div>ข้อมูลนี้มีผลต่อความเหมาะสมหรือเป้าหมาย ขั้นตอนถัดไปที่อนุญาตคือ <strong>ยืนยันข้อมูล</strong> เท่านั้น</div></div>` : '<ul class="evidence-list"><li>ข้อมูลสำคัญพร้อมสำหรับ RM ทบทวน</li></ul>'}</section></div>
      <details class="evidence-details"><summary>ดูรายละเอียดหลักฐาน สมมติฐาน และร่องรอยการคำนวณ</summary><div><div class="audit-grid"><article class="audit-card"><span>Calculation ID</span><strong>${esc(first(c.calculationId,c.modelRunId,'calc-v3'))}</strong></article><article class="audit-card"><span>Model version</span><strong>${esc(first(c.modelVersion,meta().modelVersion,'quant-v3'))}</strong></article><article class="audit-card"><span>Input hash</span><strong>${esc(String(first(c.inputHash,'อยู่ใน audit')).slice(0,24))}</strong></article></div><p class="source-line">RM อ่านสรุปได้ แต่ไม่สามารถแก้สูตร สมมติฐาน กรอบความเสี่ยง หรือ policy rule</p></div></details>`;
  }

  function renderCaseVerify() {
    const checks = list(first(casePayload().verification, casePayload().checks));
    const defaults = [
      { label: 'ตัวตนและ KYC ยังเป็นปัจจุบัน', status: 'PASS', detail: 'ระบบบันทึกล่าสุดพร้อมแหล่งข้อมูล' },
      { label: 'Suitability ยังเป็นปัจจุบัน', status: criticalMissing() ? 'MISSING' : 'PASS', detail: criticalMissing() ? 'ต้องให้ลูกค้ายืนยันก่อน' : 'ยังอยู่ในรอบทบทวน' },
      { label: 'Mandate และสิทธิ์ผลิตภัณฑ์', status: 'PASS', detail: 'RM ไม่มีสิทธิ์แก้ข้อมูลต้นทาง' },
      { label: 'สภาพคล่องและเงินสำรอง', status: 'PASS', detail: 'กันเงินสำรอง 6 เดือนก่อน' },
      { label: 'เป้าหมายที่ได้รับผลกระทบ', status: 'PASS', detail: 'Goal Ledger ระบุยอดและวันใช้เงิน' },
      { label: 'Holdings และ NAV', status: 'PASS', detail: 'NAV ล่าสุดใน fixture พร้อมจำนวนข้อมูล' },
      { label: 'Product eligibility', status: 'PASS', detail: 'แสดงเฉพาะกองทุนที่ผ่าน approved shelf' },
    ];
    const rows = checks.length ? checks : defaults;
    const missing = list(card().missingData);
    return `<div class="section-bar"><div><h2>ตรวจข้อมูลก่อนเตรียมข้อเสนอ</h2><p>ถ้าข้อมูลสำคัญขาด ระบบจะไม่เปิดการดำเนินการอื่น</p></div><span class="status-pill">${criticalMissing() ? 'ต้องยืนยันข้อมูล' : 'พร้อมทบทวน'}</span></div><div class="verify-list">${rows.map((item) => { const pass = ['PASS','READY','CURRENT',true].includes(first(item.status,item.ready)); return `<article class="verify-row ${pass ? '' : 'missing'}"><span class="verify-state">${pass ? '✓' : '!'}</span><div><h3>${esc(first(item.label,item.name,item.field))}</h3><p>${esc(first(item.detail,item.reason,item.sourceLabel,'ตรวจตามข้อมูลล่าสุด'))}</p></div><b>${pass ? 'พร้อม' : 'ต้องยืนยัน'}</b></article>`; }).join('')}</div>${criticalMissing() ? `<div class="blocked-banner"><span>!</span><div><strong>ยังวิเคราะห์ได้บางส่วน แต่ห้ามเสนอผลิตภัณฑ์</strong><br>${esc(first(casePayload().missingDataAssistant?.whyItMatters,'ข้อมูลที่ขาดอาจเปลี่ยนทั้งเป้าหมาย สภาพคล่อง และความเหมาะสม'))}<br><br><strong>คำถามที่ควรถาม:</strong> ${esc(first(casePayload().missingDataAssistant?.exactQuestion, missing[0]?.question, 'ช่วยยืนยันข้อมูลที่เปลี่ยนไปจากครั้งล่าสุดได้ไหมครับ?'))}</div></div>` : ''}`;
  }

  function renderCasePrepare() {
    const coach = obj(first(casePayload().coach, casePayload().conversationCoach));
    const controlledAi = obj(coach.controlledAi);
    const questions = asArrayText(coach.questions);
    const facts = asArrayText(first(coach.facts, coach.explain));
    const warnings = asArrayText(coach.warnings);
    const comparisons = list(first(casePayload().comparisons, casePayload().eligibleModels));
    return `<div class="section-bar"><div><h2>เตรียมบทสนทนา</h2><p>ใช้เฉพาะหลักฐานที่อนุมัติและตัวเลขที่ผ่าน validator</p></div><span class="asof-chip">ช่องทาง: ${esc(channelLabel(card().channel))}</span></div><div class="talk-opening"><strong>เปิดบทสนทนาอย่างไร</strong><br>${esc(first(coach.opening,'วันนี้ผมอยากทบทวนเป้าหมายและข้อมูลที่อาจเปลี่ยน เพื่อให้การดูแลไม่เริ่มจากการขายกองทุนครับ'))}</div>${controlledAi.workflowId ? `<details class="evidence-details"><summary>ดูที่มาของคำอธิบายที่ตรวจแล้ว</summary><div><p>คำถามหรือเหตุการณ์ → เลือกเครื่องมือที่อนุมัติ → คำนวณและตรวจผล → อธิบาย → RM ตัดสินใจ</p><p>${esc(controlledAi.explanation?.text)}</p><p class="source-line">ระบบไม่ส่งข้อความ ไม่ซื้อขาย และไม่แก้ KYC หรือ suitability</p></div></details>` : ''}<div class="coach-grid" style="margin-top:10px"><article class="coach-card"><h3>เป้าหมายการคุย</h3><p>${esc(first(coach.objective,card().clientBenefit,'ยืนยันเป้าหมาย สภาพคล่อง และสิ่งที่ลูกค้ากังวลก่อนดูทางเลือก'))}</p></article><article class="coach-card"><h3>คำถามที่ควรถาม</h3><ol>${(questions.length ? questions : ['เป้าหมายและวันใช้เงินยังเหมือนเดิมไหม','มีเงินก้อนใดต้องใช้ก่อนกำหนดหรือไม่','ระดับการลดลงแบบนี้ทำให้กังวลเพียงใด']).slice(0,3).map((item) => `<li>${esc(item)}</li>`).join('')}</ol></article><article class="coach-card"><h3>ประเด็นที่ควรอธิบาย</h3><ul>${(facts.length ? facts : ['ผลต่อเป้าหมาย ไม่ใช่เพียงผลตอบแทน','NAV return ไม่รวมเงินปันผล','ทางเลือกไม่มีคำสั่งซื้อขายอัตโนมัติ']).slice(0,3).map((item) => `<li>${esc(item)}</li>`).join('')}</ul></article><article class="coach-card"><h3>สิ่งที่ไม่ควรพูด</h3><ul>${(warnings.length ? warnings : ['ห้ามรับประกันผลตอบแทน','ห้ามบอกว่ากองทุนหนึ่ง “ดีที่สุด”','ห้ามกล่าวว่าตัวเลขความเสี่ยงคือการพยากรณ์']).slice(0,3).map((item) => `<li>${esc(item)}</li>`).join('')}</ul></article><article class="coach-card"><h3>เมื่อลูกค้าไม่เห็นด้วย</h3><p>${esc(first(coach.objectionResponse,'รับฟังสิ่งที่กังวล ย้อนกลับไปยืนยันเป้าหมาย และบันทึกว่า “ยังไม่ดำเนินการ” ได้โดยไม่กดดัน'))}</p></article><article class="coach-card"><h3>สรุปหลังคุย</h3><p>${esc(first(coach.afterCall,'ทวนสิ่งที่ลูกค้ายืนยัน การตัดสินใจ เหตุผล และวันทบทวนครั้งถัดไป'))}</p></article></div>
      <div class="section-bar"><div><h3>ทางเลือกที่ผ่านเงื่อนไข</h3><p>เปรียบเทียบได้ไม่เกิน 3 ทางเลือก และไม่มีการเลือกผู้ชนะอัตโนมัติ</p></div></div><div class="compare-grid">${(comparisons.length ? comparisons : funds().filter((fund) => first(fund.eligible,fund.approved,true)).slice(0,3)).slice(0,3).map((item) => `<article class="compare-card"><h3>${esc(first(item.name,item.nameTh,item.title,'ทางเลือก'))}</h3><p>${esc(first(item.purpose,item.objective,'ใช้ตามบทบาทที่กำหนดในเป้าหมาย'))}</p><div class="compare-list"><span>ระดับความเสี่ยง<b>${esc(first(item.riskLevel,'—'))}</b></span><span>ความผันผวนย้อนหลัง<b>${item.volatility != null ? fmtPct(item.volatility) : 'ข้อมูลยังไม่พอ'}</b></span><span>ขาดทุนสูงสุด<b>${item.maxDrawdown != null ? fmtPct(item.maxDrawdown) : 'ข้อมูลยังไม่พอ'}</b></span><span>สภาพคล่อง<b>${esc(first(item.liquidityLabel,item.liquidity,'T+2'))}</b></span><span>ค่าใช้จ่าย<b>${esc(first(item.feeLabel,item.fees,'ดูหนังสือชี้ชวน'))}</b></span><span>ความเสี่ยงค่าเงิน<b>${esc(first(item.fxRiskLabel,item.fxRisk,'ไม่มี/ตามกองทุน'))}</b></span></div><div class="suitability-note">${esc(first(item.fitExplanation,item.suitabilityNote,'เหมาะกว่าเมื่อเงื่อนไขเป้าหมายและสภาพคล่องตรงกัน'))}</div><button class="compact-button" style="margin-top:8px" type="button" data-explain-fund="${esc(first(item.fundId,item.shareClassId,item.id))}">อธิบายให้ฉันเข้าใจ</button></article>`).join('') || '<div class="empty-v3">ข้อมูลยังไม่พอสำหรับเปรียบเทียบ</div>'}</div>`;
  }

  function renderCaseDecide() {
    const choices = [
      ['APPROVE_DRAFT','อนุมัติร่าง'],['EDIT','แก้ไข'],['REQUEST_INFO','ขอข้อมูลเพิ่ม'],['HANDOFF','ส่งต่อผู้เชี่ยวชาญ'],['NO_ACTION','ไม่มีการดำเนินการ'],
    ];
    const preview = obj(casePayload().handoffPreview);
    const handoffReview = state.selectedDecision === 'HANDOFF' ? `<section class="case-section handoff-review"><div class="section-bar"><div><h3>ตรวจชุดข้อมูลก่อนส่งต่อ</h3><p>ยังเป็นร่าง · ระบบจะไม่ส่งจนกว่า RM ตรวจและบันทึก</p></div><span class="status-pill">DRAFT</span></div><div class="coach-grid"><article class="coach-card"><h3>ภาพรวมลูกค้า</h3><p>${esc(first(preview.clientSnapshotSummary,'รอสรุป Client 360'))}</p></article><article class="coach-card"><h3>เป้าหมายที่ได้รับผลกระทบ</h3><p>${esc(list(preview.affectedGoals).join(', ') || 'รอยืนยัน')}</p></article><article class="coach-card"><h3>ความเสี่ยงหลัก</h3><p>${esc(first(preview.keyRisk,card().whyNow))}</p></article><article class="coach-card"><h3>เหตุผลที่ส่งต่อ</h3><p>${esc(first(preview.reasonForHandoff,'ต้องการผู้เชี่ยวชาญช่วยทบทวน'))}</p></article><article class="coach-card"><h3>สิ่งที่ถามแล้ว</h3><ul>${list(preview.questionsAlreadyAsked).slice(0,3).map((item)=>`<li>${esc(item)}</li>`).join('') || '<li>ยังไม่มีบันทึก</li>'}</ul></article><article class="coach-card"><h3>ข้อมูลที่ยังขาด</h3><ul>${list(preview.missingInformation).slice(0,3).map((item)=>`<li>${esc(item)}</li>`).join('') || '<li>ไม่มีข้อมูลสำคัญที่ขาด</li>'}</ul></article></div><label class="handoff-review-check"><input type="checkbox" data-handoff-reviewed ${state.handoffReviewed ? 'checked' : ''}> ฉันตรวจเป้าหมาย พอร์ต ความเสี่ยง คำถาม และข้อมูลที่ขาดแล้ว</label></section>` : '';
    return `<div class="section-bar"><div><h2>RM ตัดสินใจ</h2><p>อนุมัติร่างไม่ได้หมายถึงส่งข้อความ ระบบนี้ไม่มีปุ่ม “อนุมัติ & ส่ง”</p></div><span class="role-chip">Human decision required</span></div><section class="case-section draft-box"><label>ร่างสำหรับ RM ตรวจ<textarea id="draftMessage">${esc(state.draftText)}</textarea></label><p class="source-line">ข้อความนี้สร้างจาก approved evidence และผลคำนวณที่อ้างอิงได้ RM ต้องตรวจและบันทึกก่อนใช้</p></section><div class="decision-buttons">${choices.map(([id,label]) => { const disabled = criticalMissing() && id !== 'REQUEST_INFO'; return `<button class="decision-choice ${state.selectedDecision === id ? 'is-selected' : ''}" type="button" data-decision="${id}" ${disabled ? 'disabled title="ข้อมูลสำคัญยังขาด"' : ''}>${label}</button>`; }).join('')}</div>${criticalMissing() ? '<div class="blocked-banner"><span>!</span><div>ข้อมูลสำคัญยังขาด การดำเนินการที่อนุญาตเพียงอย่างเดียวคือ <strong>ขอข้อมูลเพิ่ม</strong></div></div>' : ''}${handoffReview}<p class="no-send-note">ระบบไม่ส่งข้อความ ไม่ทำรายการซื้อขาย และไม่เปลี่ยน KYC/suitability อัตโนมัติ</p>`;
  }

  function renderCaseRecord() {
    const decisionLabel = ({ APPROVE_DRAFT:'อนุมัติร่าง',EDIT:'แก้ไข',REQUEST_INFO:'ขอข้อมูลเพิ่ม',HANDOFF:'ส่งต่อผู้เชี่ยวชาญ',NO_ACTION:'ไม่มีการดำเนินการ' })[state.selectedDecision] || 'ยังไม่ได้เลือก';
    return `<div class="section-bar"><div><h2>บันทึกผลและวันทบทวน</h2><p>เก็บการตัดสินใจ การแก้ไข เหตุผล เจ้าของ เวลา ผลลัพธ์ และรอบถัดไป</p></div></div><div class="record-summary"><strong>การตัดสินใจ:</strong> ${esc(decisionLabel)}<br>ร่างที่แก้ไขและข้อมูลประกอบจะเก็บพร้อม audit event แบบ append-only</div><form class="record-form" id="recordForm" style="margin-top:12px"><label>เหตุผลในการตัดสินใจ<textarea name="reason" required placeholder="สรุปเหตุผลที่ลูกค้าและผู้ตรวจสอบเข้าใจได้"></textarea></label><label>ผลลัพธ์<select name="outcome"><option value="PENDING">รอติดตาม</option><option value="CLIENT_CONFIRMED">ลูกค้ายืนยันข้อมูล</option><option value="HANDOFF_ACCEPTED">ผู้เชี่ยวชาญรับเคส</option><option value="NO_CHANGE">ยังไม่เปลี่ยนแผน</option></select></label><label>เจ้าของงาน<input name="owner" value="${esc(activeRmOwner())}" required></label><label>ทบทวนครั้งถัดไป<input type="date" name="nextReview" value="2026-08-15" required></label><label class="wide">บันทึกหลังคุย<textarea name="notes" placeholder="สิ่งที่ลูกค้ายืนยัน ความกังวล และสิ่งที่ต้องติดตาม"></textarea></label></form><section class="case-section" style="margin-top:12px"><h3>ข้อเสนอแนะต่อคุณภาพการตัดสินใจ</h3><div class="decision-buttons"><button class="decision-choice ${state.feedback.useful ? 'is-selected' : ''}" type="button" data-feedback="useful">คำแนะนำมีประโยชน์</button><button class="decision-choice ${state.feedback.clear ? 'is-selected' : ''}" type="button" data-feedback="clear">อธิบายเข้าใจง่าย</button><button class="decision-choice ${state.feedback.missing ? 'is-selected' : ''}" type="button" data-feedback="missing">ขาดข้อมูลสำคัญ</button><button class="decision-choice ${state.feedback.priority ? 'is-selected' : ''}" type="button" data-feedback="priority">ลำดับสูง/ต่ำเกินไป</button><button class="decision-choice ${state.feedback.handoff ? 'is-selected' : ''}" type="button" data-feedback="handoff">ผู้เชี่ยวชาญตอบครบ</button></div><p class="source-line">เก็บเป็น training label สำหรับอนาคต ไม่เปลี่ยน production rule ทันที</p></section>`;
  }

  function renderCaseFooter() {
    const index = stepLabels.findIndex(([id]) => id === state.caseStep);
    const previous = stepLabels[index - 1]; const next = stepLabels[index + 1];
    const handoffReviewRequired = state.caseStep === 'decide' && state.selectedDecision === 'HANDOFF' && !state.handoffReviewed;
    const footerNote = handoffReviewRequired ? 'ตรวจชุดข้อมูลส่งต่อและทำเครื่องหมายยืนยันก่อน' : criticalMissing() ? 'ข้อมูลสำคัญยังขาด · ยืนยันข้อมูลก่อน' : 'ผลคำนวณเดียวกันใน summary, evidence และ audit';
    $('#caseFooter').innerHTML = `<div class="case-footer-note">${footerNote}</div><div class="case-footer-actions">${previous ? `<button class="secondary-button" type="button" data-case-step="${previous[0]}">ย้อนกลับ</button>` : ''}${next ? `<button class="primary-button" type="button" data-case-step="${next[0]}" ${handoffReviewRequired ? 'disabled' : ''}>ถัดไป · ${next[1]}</button>` : `<button class="primary-button orange" type="button" data-save-record ${state.selectedDecision && (state.selectedDecision !== 'HANDOFF' || state.handoffReviewed) ? '' : 'disabled'}>บันทึกผล</button>`}</div>`;
  }

  function openSide(eyebrow, title, html) {
    $('#sideEyebrow').textContent = eyebrow;
    $('#sideTitle').textContent = title;
    $('#sideBody').innerHTML = html;
    $('#sideOverlay').classList.add('is-open');
    $('#sideOverlay').setAttribute('aria-hidden', 'false');
  }
  function closeSide() { $('#sideOverlay').classList.remove('is-open'); $('#sideOverlay').setAttribute('aria-hidden', 'true'); }

  function showReason(actionId) {
    const item = cases().find((candidate) => candidate.actionId === actionId) || {};
    openSide('Why this client?', first(item.clientName,'เหตุผลการจัดลำดับ'), `<div class="explain-hero"><h3>${esc(first(item.whyNow,'ควรดูแลเคสนี้ก่อน'))}</h3><p>${esc(first(item.clientBenefit,'ประโยชน์ต่อลูกค้าและหน้าที่ดูแลมาก่อนโอกาสทางธุรกิจ'))}</p></div><div class="explain-list"><article><h3>เกิดอะไรขึ้น</h3><p>${esc(first(item.title,'ตรวจพบ trigger ที่ต้องทบทวน'))}</p></article><article><h3>เป้าหมายใดได้รับผลกระทบ</h3><p>${esc(first(item.affectedGoalName,item.goalName,'เป้าหมายหลักของลูกค้า'))}</p></article><article><h3>ทำไมอยู่เหนือเคสถัดไป</h3><p>${esc(first(item.priorityExplanation,item.whyHigher,'เป็น Care ที่มี time sensitivity และผ่าน hard gate'))}</p></article><article><h3>ทำไมเคสถัดไปต่ำกว่า</h3><p>${esc(first(item.lowerPriorityExplanation,today().whyNextLower,'ไม่มีการละเมิดกรอบ และเป้าหมายยังมี buffer เพียงพอ'))}</p></article><article><h3>ข้อจำกัด</h3><p>ลำดับนี้มาจาก rule version ${esc(first(meta().ruleVersion,'care-growth-v3'))} ไม่ใช่คำสั่งขาย และ RM บันทึกเหตุผลคัดค้านได้</p></article></div>`);
  }

  async function explainFund(fundId) {
    try {
      const local = funds().find((item) => [item.fundId,item.shareClassId,item.masterFundId,item.id].includes(fundId));
      const payload = local?.explanation ? local : await api(`/api/v3/funds/${encodeURIComponent(fundId)}`);
      const fund = obj(first(payload.fund,payload)); const explanation = obj(first(payload.explanation,fund.explanation));
      openSide('I don’t know this product', first(fund.nameTh,fund.name,'กองทุนไทยตัวอย่าง'), `<div class="explain-hero"><h3>อธิบายใน 60 วินาที</h3><p>${esc(first(explanation.sixtySecond,explanation.summary,fund.summary,'กองทุนนี้รวมเงินของผู้ลงทุนไปลงทุนตามนโยบายที่ระบุ ผลตอบแทนขึ้นกับสินทรัพย์และขาดทุนได้'))}</p></div><div class="explain-list">${[
        ['กองทุนนี้ลงทุนอะไร',first(explanation.investsIn,fund.objectiveTh,'ดูนโยบายการลงทุนจากเอกสารกองทุน')],
        ['ได้ผลตอบแทนจากอะไร',first(explanation.returnDrivers,'ดอกเบี้ย การเปลี่ยนแปลงราคา และ/หรือเงินปันผลตามสินทรัพย์')],
        ['ขาดทุนได้อย่างไร',first(explanation.lossMechanisms,explanation.mainRisks,'มูลค่าสินทรัพย์ลดลง ผู้ออกตราสารผิดนัด หรืออัตราแลกเปลี่ยนเคลื่อนไหว')],
        ['ค่าใช้จ่าย',first(explanation.fees,fund.feeLabel,'ตรวจหนังสือชี้ชวนล่าสุดก่อนอธิบาย')],
        ['สภาพคล่อง',first(explanation.liquidity,fund.liquidityLabel,'ตรวจวันรับเงินและ cut-off ก่อนใช้')],
        ['ความเสี่ยงค่าเงิน',first(explanation.fxRisk,fund.fxRiskLabel,'ขึ้นกับนโยบายลงทุนและการป้องกันความเสี่ยง')],
        ['เหมาะกับเป้าหมายแบบใด',first(explanation.suitableGoals,'เป้าหมายที่ระยะเวลาและความเสี่ยงสอดคล้องกัน')],
        ['ไม่เหมาะกับใคร',first(explanation.notSuitableFor,'ผู้ที่ต้องใช้เงินเร็วหรือรับความผันผวนไม่ได้ตามระดับกองทุน')],
        ['ระยะเวลาถือครองที่ควรพิจารณา',first(explanation.holdingPeriod,'พิจารณาตามสินทรัพย์และวันใช้เงินของเป้าหมาย')],
      ].map(([title,text]) => `<article><h3>${esc(title)}</h3><p>${esc(text)}</p></article>`).join('')}</div><p class="source-line">แหล่งข้อมูล: ${esc(first(explanation.sourceLabel,fund.source?.sourceRef,'ข้อมูลสังเคราะห์'))} · วันที่ ${esc(formatDate(first(explanation.asOf,fund.freshness?.asOf,meta().asOf)))}</p>`);
    } catch (error) { showToast(`ยังเปิดคำอธิบายไม่ได้: ${error.message}`, 'error'); }
  }

  async function quickAction(actionId, decision) {
    if (decision === 'HANDOFF') { await openCase(actionId, 'decide'); state.selectedDecision = 'HANDOFF'; renderCase(); return; }
    const labels = { SNOOZE: 'เลื่อนไปวันถัดไปแล้ว', DISMISS: 'ทำเครื่องหมายว่าไม่เกี่ยวข้องแล้ว' };
    try {
      await api(`/api/v3/actions/${encodeURIComponent(actionId)}/decisions`, { method: 'POST', body: JSON.stringify({ decision, reason: decision === 'SNOOZE' ? 'RM เลื่อนไปทบทวนวันถัดไป' : 'RM ระบุว่าไม่เกี่ยวข้องกับลูกค้ารายนี้', actor: activeRmOwner(), idempotencyKey: makeIdempotencyKey(actionId, decision) }) });
      state.data = await api('/api/v3/bootstrap'); updateChrome(); render(); showToast(labels[decision] || 'บันทึกแล้ว');
    } catch (error) { showToast(`บันทึกไม่สำเร็จ: ${error.message}`, 'error'); }
  }

  async function saveRecord() {
    if (!state.selectedDecision) return showToast('กรุณาเลือกการตัดสินใจก่อน', 'error');
    if (state.selectedDecision === 'HANDOFF' && !state.handoffReviewed) return showToast('กรุณาตรวจชุดข้อมูลส่งต่อและยืนยันก่อน', 'error');
    const form = $('#recordForm');
    if (!form || !form.reportValidity()) return;
    const formData = Object.fromEntries(new FormData(form).entries());
    try {
      await api(`/api/v3/actions/${encodeURIComponent(state.activeCaseId)}/decisions`, { method: 'POST', body: JSON.stringify({ decision: state.selectedDecision, reason: formData.reason, owner: formData.owner, outcome: formData.outcome, nextReview: formData.nextReview, notes: formData.notes, editedDraft: state.draftText, handoffReviewed: state.handoffReviewed, feedback: Object.keys(state.feedback).filter((key) => state.feedback[key]), actor: activeRmOwner(), actorRole: 'RM', idempotencyKey: makeIdempotencyKey(state.activeCaseId,state.selectedDecision) }) });
      closeCase(); state.data = await api('/api/v3/bootstrap'); updateChrome(); render(); showToast('บันทึกการตัดสินใจและวันทบทวนแล้ว');
    } catch (error) { showToast(`บันทึกไม่สำเร็จ: ${error.message}`, 'error'); }
  }

  function showMetric(metricId, suppliedMeaning) {
    const mapping = {
      periodPnl: { title: 'กำไร/ขาดทุนสุทธิของช่วง (P&L)', key: 'periodPnl', meaning: 'กำไรหรือขาดทุนของพอร์ตในช่วงที่เลือก หลังตัดเงินเติมและเงินถอนออกจากการเปลี่ยนแปลงมูลค่า', formula: 'มูลค่าปลายงวด − มูลค่าต้นงวด − เงินเติม + เงินถอน', limitation: 'เป็น P&L รวมของช่วง ไม่ใช่ realized P&L และไม่บอกผลตอบแทนเป็นเปอร์เซ็นต์', action: 'ใช้คู่กับ TWR และ XIRR เพื่อแยกจำนวนเงินบาทที่เปลี่ยนจากอัตราผลตอบแทน' },
      realizedPnl: { title: 'กำไร/ขาดทุนที่รับรู้แล้ว', key: 'realizedPnl', meaning: 'กำไรหรือขาดทุนจากหน่วยลงทุนที่ขายแล้ว ระบบจะแสดงเมื่อมีธุรกรรมและต้นทุนราย lot ที่ตรวจสอบย้อนกลับได้เท่านั้น', formula: 'ยอดขายสุทธิ − ต้นทุนของหน่วยที่ขาย ตามวิธี cost basis ที่อนุมัติ', limitation: 'ข้อมูลสาธิตปัจจุบันไม่มีต้นทุนราย lot และธุรกรรมขายที่ยืนยัน จึงไม่อนุมานจาก withdrawal', action: 'ขอข้อมูลต้นทุนและรายการขายจากระบบทะเบียนก่อนใช้ตัวเลขนี้คุยกับลูกค้า' },
      unrealizedPnl: { title: 'กำไร/ขาดทุนที่ยังไม่รับรู้', key: 'unrealizedPnl', meaning: 'ส่วนต่างของหน่วยลงทุนที่ยังถืออยู่ ระหว่างมูลค่าปัจจุบันกับต้นทุนคงเหลือที่ตรวจสอบแล้ว', formula: 'มูลค่าปัจจุบันของหน่วยคงเหลือ − ต้นทุนคงเหลือ', limitation: 'ข้อมูลสาธิตปัจจุบันไม่มีต้นทุนราย lot ที่ reconcile กับหน่วยคงเหลือ จึงไม่สร้างค่าประมาณ', action: 'ยืนยันหน่วยคงเหลือและต้นทุนจากระบบทะเบียนก่อนอธิบายกำไรที่ยังไม่ขาย' },
      twr: { title: 'TWR', key: 'twr', meaning: 'ผลตอบแทนแบบเชื่อมช่วงโดยตัดเงินเข้าออก ใช้ดูผลการบริหาร ไม่ใช่ประสบการณ์เงินจริงทั้งหมดของลูกค้า', formula: '(1+r₁) × (1+r₂) × … − 1 โดยแต่ละช่วงหักผลของเงินเข้าออก', limitation: 'ผลลัพธ์ขึ้นกับเวลาประเมินมูลค่าและความครบถ้วนของ cash flow', action: 'ใช้แยกผลการบริหารออกจากจังหวะที่ลูกค้าใส่หรือถอนเงิน' },
      xirr: { title: 'XIRR', key: 'xirr', meaning: 'ผลตอบแทนตามประสบการณ์เงินจริงของลูกค้า โดยคำนึงถึงจำนวนเงินและวันที่เข้าออก', formula: 'แก้สมการ Σ CFᵢ/(1+r)^(วันᵢ/365.25) = 0', limitation: 'อาจมีหลายคำตอบหรือไม่มีคำตอบเมื่อรูปแบบกระแสเงินไม่เหมาะสม', action: 'ใช้คุยถึงประสบการณ์เงินจริงของลูกค้า ไม่ใช้แทน TWR ในการวัดผู้จัดการกองทุน' },
      cagr: { title: 'CAGR', key: 'cagr', meaning: 'อัตราเติบโตทบต้นต่อปีระหว่างต้นงวดและปลายงวด ใช้ได้เมื่อไม่มีเงินเข้าออกภายนอก', formula: '(Vₜ/V₀)^(365.25/จำนวนวัน) − 1', limitation: 'พอร์ตนี้มี cash flow จึงไม่แสดง CAGR และต้องใช้ TWR/XIRR ตามวัตถุประสงค์แทน', action: 'อย่าฝืนใช้ CAGR เมื่อมีเงินเข้าออก เพราะจะทำให้ตีความคลาดเคลื่อน' },
      volatility: { title: 'ความผันผวนต่อปี', key: 'annualizedVolatility', meaning: 'ขนาดการแกว่งของผลตอบแทนโดยเฉลี่ย ไม่ได้บอกทิศทางว่าจะกำไรหรือขาดทุน', formula: 'ส่วนเบี่ยงเบนมาตรฐานของ return × √จำนวนงวดต่อปี', limitation: 'สมมติว่าความถี่และรูปแบบการแกว่งย้อนหลังใช้เปรียบเทียบได้ และไม่บอกผลขาดทุนปลายหางโดยตรง', action: 'เทียบกับความสามารถรับการแกว่งและระยะเวลาของเป้าหมาย' },
      maxDrawdown: { title: 'ขาดทุนสูงสุด', key: 'maxDrawdown', meaning: 'การลดลงมากที่สุดจากจุดสูงสุดถึงจุดต่ำสุดในช่วงข้อมูลที่เลือก ใช้ช่วยอธิบายว่าลูกค้าเคยต้องทนเห็นพอร์ตลดลงมากเพียงใด', formula: 'DDₜ = Wₜ/max(Wᵤ)−1; MaxDD = min(DDₜ)', limitation: 'สะท้อนเพียงเหตุการณ์ที่อยู่ในช่วงข้อมูล และไม่ได้บอกระยะเวลาฟื้นตัวทั้งหมด', action: 'ถามลูกค้าว่ารับการลดลงระดับนี้ได้หรือไม่ก่อนพิจารณาความเสี่ยงเพิ่ม' },
      downside: { title: 'Downside deviation', key: 'downsideDeviation', meaning: 'วัดเฉพาะการแกว่งของผลตอบแทนที่ต่ำกว่าเกณฑ์ขั้นต่ำ ไม่ถือผลตอบแทนด้านดีเป็นความเสี่ยง', formula: '√E[min(r−MAR,0)²] × √จำนวนงวดต่อปี', limitation: 'ผลขึ้นกับเกณฑ์ขั้นต่ำ MAR และจำนวนข้อมูลด้านลบ', action: 'ใช้ร่วมกับ Sortino เมื่อสนใจความเสี่ยงต่ำกว่าเป้าหมายมากกว่าความผันผวนรวม' },
      sharpe: { title: 'Sharpe', key: 'sharpe', meaning: 'ผลตอบแทนส่วนเกินต่อความผันผวนรวมหนึ่งหน่วย ใช้เปรียบเทียบเมื่อช่วงข้อมูลและวิธีตรงกัน', formula: '(ค่าเฉลี่ย return − risk-free rate) ÷ volatility แล้วปรับเป็นรายปี', limitation: 'นับการแกว่งด้านบวกเป็นความเสี่ยงและไวต่อสมมติฐาน risk-free rate', action: 'ใช้เป็นหลักฐานเสริม ไม่ใช้ตัดสินผลิตภัณฑ์จากอันดับเพียงค่าเดียว' },
      sortino: { title: 'Sortino', key: 'sortino', meaning: 'ผลตอบแทนส่วนเกินต่อความผันผวนด้านลบหนึ่งหน่วย', formula: '(ค่าเฉลี่ย return − MAR) ÷ downside deviation แล้วปรับเป็นรายปี', limitation: 'ไวต่อ MAR และข้อมูลด้านลบจำนวนน้อย', action: 'ใช้เปรียบเทียบ downside trade-off ภายใต้ช่วงและสมมติฐานเดียวกัน' },
      calmar: { title: 'Calmar', key: 'calmar', meaning: 'อัตราเติบโตทบต้นของเส้นทางผลตอบแทนที่ตัด cash flow แล้ว เมื่อเทียบกับขนาดการขาดทุนสูงสุด', formula: 'อัตราเติบโตทบต้นรายปีของ TWR return path ÷ |Max Drawdown|', limitation: 'ไวต่อช่วงข้อมูลและใช้ไม่ได้เมื่อ MaxDD เป็นศูนย์; ตัวตั้งไม่ใช่ CAGR แบบต้นงวด–ปลายงวดของมูลค่าพอร์ตที่มีเงินเข้าออก', action: 'ใช้ดู trade-off ระหว่างการเติบโตกับ drawdown โดยยังต้องดู TWR, XIRR และเป้าหมายแยกกัน' },
      var: { title: 'VaR 95% ต่อวัน', key: 'var95', meaning: 'ค่าขาดทุนที่ข้อมูลย้อนหลัง 95% ของวันไม่เกิน แต่วันที่แย่กว่ายังเกิดขึ้นได้', formula: 'quantile เชิงประจักษ์ 95% ของ loss โดย L = −return', limitation: 'ไม่ได้บอกความเสียหายเมื่อหลุด VaR และอาศัยข้อมูลย้อนหลัง', action: 'ใช้กำหนดว่าควรเปิดดู tail loss ต่อด้วย CVaR ไม่ใช้เป็นเพดานขาดทุนรับประกัน' },
      cvar: { title: 'CVaR 95% ต่อวัน', key: 'cvar95', meaning: 'ใน 5% ของวันที่แย่ที่สุด พอร์ตขาดทุนเฉลี่ยประมาณค่านี้ จากข้อมูลย้อนหลัง ไม่ใช่การคาดการณ์พรุ่งนี้', formula: 'ค่าเฉลี่ย loss ที่มากกว่าหรือเท่ากับ empirical VaR 95%', limitation: 'ค่าปลายหางอาจไม่เสถียรเมื่อจำนวน observations น้อย และไม่ใช่ forecast', action: 'ใช้เตรียมคำอธิบายความเสียหายช่วงรุนแรงและตรวจว่าสอดคล้องกับเป้าหมายหรือไม่' },
      observations: { title: 'จำนวนข้อมูล', key: 'observationCount', meaning: 'จำนวนวันที่มี NAV/return ที่ใช้ได้จริงในชุดคำนวณ', formula: 'นับ observations ที่ผ่านการตรวจวันที่และคุณภาพ โดยไม่ forward-fill return', limitation: 'จำนวนมากไม่ได้รับประกันว่าครอบคลุมทุกสภาวะตลาด', action: 'หากข้อมูลน้อยหรือช่วงไม่ครอบคลุม stress ที่เกี่ยวข้อง ให้ชะลอข้อสรุปและขอข้อมูลเพิ่ม' },
    };
    const spec = mapping[metricId] || { title: metricId, key: metricId, meaning: suppliedMeaning || 'ใช้ประกอบการตัดสินใจร่วมกับเป้าหมายและข้อจำกัด', formula: 'ดู formulaId ในร่องรอยการคำนวณ', limitation: 'ข้อมูลย้อนหลังไม่รับประกันอนาคต', action: 'ใช้ร่วมกับเป้าหมาย สภาพคล่อง และ suitability' };
    const detail = obj(performance().metricDetails?.[spec.key]);
    const sourceRefs = list(detail.sourceRefs);
    const period = obj(detail.period);
    const periodText = first(period.label, period.start && period.end ? `${period.start} ถึง ${period.end}` : null, performance().periodLabel, 'ตามช่วงที่เลือก');
    const auditLine = [detail.formulaId, detail.calculationId].filter(Boolean).join(' · ');
    openSide('อธิบายตัวเลข', spec.title, `<div class="explain-hero"><h3>ความหมายแบบใช้คุยกับลูกค้า</h3><p>${esc(spec.meaning)}</p></div><div class="explain-list"><article><h3>สูตร</h3><p>${esc(spec.formula)}</p>${auditLine ? `<p class="source-line">${esc(auditLine)}</p>` : ''}</article><article><h3>ช่วงข้อมูลและหน่วย</h3><p>${esc(periodText)} · ${esc(first(performance().observationCount,'—'))} observations · ${esc(first(detail.unit,performance().currency,'THB'))}</p></article><article><h3>แหล่งข้อมูลและวันที่</h3><p>${esc(sourceRefs.length ? sourceRefs.join(', ') : first(performance().sourceLabel,'FixtureMutualFundAdapter'))}</p><p class="source-line">ข้อมูล ณ ${esc(formatDate(first(detail.asOf,performance().asOf,meta().asOf)))} · ${esc(first(performance().returnTypeLabel,'NAV return'))}</p></article><article><h3>ข้อจำกัด</h3><p>${esc(spec.limitation)} ข้อมูลย้อนหลังไม่รับประกันอนาคต</p></article><article><h3>RM ควรทำอะไร</h3><p>${esc(spec.action)} ไม่ใช้ตัวเลขนี้สั่งซื้อขายเพียงอย่างเดียว</p></article></div>`);
  }

  function metricDetailKey(metricId) {
    return ({ volatility:'annualizedVolatility',downside:'downsideDeviation',var:'var95',cvar:'cvar95',observations:'observationCount' })[metricId] || metricId;
  }

  function showMetricData(metricId) {
    const perf = performance();
    const key = metricDetailKey(metricId);
    const detail = obj(perf.metricDetails?.[key]);
    const audit = obj(first(detail.audit, perf.analytics?.audit, perf.audit));
    const period = obj(first(detail.period, audit.period));
    const sourceRefs = list(first(detail.sourceRefs, audit.sourceRefs));
    const reasonCodes = list(first(detail.reasonCodes, audit.reasonCodes));
    openSide('ข้อมูลที่ใช้', key, `<div class="explain-hero"><h3>Governed result object เดียวกับกราฟและตาราง</h3><p>หน้า summary, chart, table และ drawer อ้างอิง calculation เดียวกัน ไม่คำนวณเลขใหม่ใน browser</p></div><div class="explain-list"><article><h3>ค่าและหน่วย</h3><p>${esc(detail.value == null ? 'ดูค่าจาก summary ที่ตรวจแล้ว' : `${detail.value} ${first(detail.unit,'')}`)}</p></article><article><h3>ช่วงข้อมูล</h3><p>${esc(first(period.label,period.start&&period.end?`${period.start} ถึง ${period.end}`:null,perf.periodLabel,'—'))} · ${esc(first(detail.observationCount,perf.observationCount,'—'))} observations</p></article><article><h3>แหล่งข้อมูล</h3><p>${esc(sourceRefs.join(', ') || first(perf.sourceLabel,'FixtureMutualFundAdapter · DEMO'))}</p><p class="source-line">As-of ${esc(formatDate(first(detail.asOf,audit.asOf,perf.asOf)))} · ${esc(first(perf.returnTypeLabel,'NAV return'))}</p></article><article><h3>ร่องรอยการคำนวณ</h3><p>Formula ${esc(first(detail.formulaId,audit.formulaId,'—'))}</p><p>Calculation ${esc(first(detail.calculationId,audit.calculationId,'—'))}</p><p>Model ${esc(first(detail.modelVersion,audit.modelVersion,'—'))} · Assumptions ${esc(first(detail.assumptionVersion,audit.assumptionVersion,'—'))}</p><p class="source-line">Input hash ${esc(first(detail.inputHash,audit.inputHash,'—'))}</p></article><article><h3>Reason codes / ข้อจำกัด</h3><p>${esc(reasonCodes.join(', ') || 'FIXTURE_DATA · VALIDATED_RESULT')}</p></article></div>`);
  }

  function setupCanvas(canvas, height) {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, rect.width || canvas.parentElement.clientWidth || 700);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d'); ctx.setTransform(ratio,0,0,ratio,0,0);
    return { canvas, ctx, width, height };
  }

  function drawBuilderCharts() {
    const analysis=obj(state.builderAnalysis);
    const growth=list(analysis.growth);
    drawLineChart($('#builderGrowthChart'),growth,[{key:'current',color:'#697287'},{key:'draft',color:'#ef7622'},{key:'model',color:'#17745a'}],(value)=>`฿${Number(value).toFixed(2)}`,{
      height:270,
      tooltip:(row)=>`${formatDate(row.date)}\nCurrent ฿${Number(row.current).toFixed(3)}\nRM Draft ฿${Number(row.draft).toFixed(3)}\nModel ฿${Number(row.model).toFixed(3)}`,
    });
    drawBuilderFrontier($('#builderFrontierChart'),list(analysis.frontier),obj(analysis.model));
  }

  function drawBuilderFrontier(canvas,points,model) {
    const view=setupCanvas(canvas,270); if(!view||!points.length)return;
    const {ctx,width,height}=view; const pad={l:55,r:20,t:18,b:35};
    const volatilities=points.map((point)=>Number(point.volatility)).filter(Number.isFinite);
    const returns=points.map((point)=>Number(point.expectedReturn)).filter(Number.isFinite);
    const minX=Math.min(...volatilities),maxX=Math.max(...volatilities);const minY=Math.min(...returns),maxY=Math.max(...returns);
    const x=(value)=>pad.l+(value-minX)/(maxX-minX||1)*(width-pad.l-pad.r);
    const y=(value)=>pad.t+(maxY-value)/(maxY-minY||1)*(height-pad.t-pad.b);
    ctx.clearRect(0,0,width,height);ctx.strokeStyle='#d9dce1';ctx.fillStyle='#697287';ctx.font='9px system-ui';
    for(let index=0;index<=4;index+=1){const xx=pad.l+index*(width-pad.l-pad.r)/4;const yy=pad.t+index*(height-pad.t-pad.b)/4;ctx.beginPath();ctx.moveTo(xx,pad.t);ctx.lineTo(xx,height-pad.b);ctx.stroke();ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(width-pad.r,yy);ctx.stroke();ctx.fillText(fmtPct(minX+(maxX-minX)*index/4),xx-12,height-12);ctx.fillText(fmtPct(maxY-(maxY-minY)*index/4),4,yy+3);}
    ctx.beginPath();ctx.strokeStyle='#315ea8';ctx.lineWidth=2;points.forEach((point,index)=>{const xx=x(Number(point.volatility)),yy=y(Number(point.expectedReturn));if(index===0)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy);});ctx.stroke();
    points.forEach((point)=>{ctx.fillStyle='#315ea8';ctx.beginPath();ctx.arc(x(Number(point.volatility)),y(Number(point.expectedReturn)),3,0,Math.PI*2);ctx.fill();});
    if(Number.isFinite(Number(model.volatility))&&Number.isFinite(Number(model.expectedReturn))){ctx.fillStyle='#ef7622';ctx.beginPath();ctx.arc(x(Number(model.volatility)),y(Number(model.expectedReturn)),6,0,Math.PI*2);ctx.fill();ctx.fillStyle='#18243f';ctx.fillText('Model',x(Number(model.volatility))+8,y(Number(model.expectedReturn))+3);}
  }

  function filteredPerformanceSeries() {
    const perf = performance(); const series = list(first(perf.series, perf.valueSeries));
    if (!series.length) return [];
    const days = { '1M':31,'3M':93,'6M':186,'1Y':366,'3Y':1096,'5Y':1830,SI:Infinity }[state.performanceRange] || 366;
    const lastDate = new Date(`${first(series.at(-1).date,meta().asOf)}T00:00:00Z`).getTime();
    const cutoff = lastDate - days * 86400000;
    const ranged = Number.isFinite(days) ? series.filter((item) => new Date(`${item.date}T00:00:00Z`).getTime() >= cutoff) : series;
    const visibleCount = Math.max(2, Math.ceil(ranged.length / Math.max(1, state.performanceZoom)));
    return ranged.slice(-visibleCount);
  }

  function drawPortfolioCharts() {
    const rawSeries = filteredPerformanceSeries();
    const selectedKey = state.selectedAllocationKey;
    const componentField = state.allocationMode === 'fund' ? 'masterFundValues' : 'assetClassValues';
    const series = selectedKey ? rawSeries.map((row) => ({ ...row, selectedValue: row[componentField]?.[selectedKey] })) : rawSeries;
    const lines = [];
    if (state.chartVisibility.portfolio) lines.push({ key: selectedKey ? 'selectedValue' : 'value', color: '#18243f' });
    if (state.chartVisibility.benchmark) lines.push({ key: 'benchmarkValue', color: '#ef7622' });
    if (!lines.length) lines.push({ key: selectedKey ? 'selectedValue' : 'value', color: '#b9bec8' });
    drawLineChart($('#portfolioValueChart'), series, lines, (value) => `${number.format(value/1_000_000)} ลบ.`, { showFlows: state.chartVisibility.flows });
    drawDrawdown($('#drawdownChart'), series);
    const analytics = obj(performance().analytics);
    drawLineChart($('#rollingReturnChart'), list(analytics.rolling12MReturns), [{ key: 'value', color: '#17745a' }], fmtPct, { height: 180 });
    drawLineChart($('#rollingVolChart'), list(analytics.rollingVolatility), [{ key: 'value', color: '#315ea8' }], fmtPct, { height: 180 });
  }

  function drawLineChart(canvas, rows, lines, formatY, options = {}) {
    const view = setupCanvas(canvas, options.height || 280); if (!view || rows.length < 2) return;
    const { ctx, width, height } = view; const pad = { l:58,r:18,t:18,b:28 };
    const values = rows.flatMap((row) => lines.map((line) => Number(row[line.key])).filter(Number.isFinite));
    const min = Math.min(...values); const max = Math.max(...values); const spread = max-min || 1;
    const x = (index) => pad.l + index/(rows.length-1)*(width-pad.l-pad.r);
    const y = (value) => pad.t + (max-value)/spread*(height-pad.t-pad.b);
    ctx.clearRect(0,0,width,height); ctx.strokeStyle='#d9dce1'; ctx.fillStyle='#697287'; ctx.font='9px system-ui'; ctx.lineWidth=1;
    for (let i=0;i<=4;i+=1) { const yy=pad.t+i*(height-pad.t-pad.b)/4; ctx.beginPath(); ctx.moveTo(pad.l,yy); ctx.lineTo(width-pad.r,yy); ctx.stroke(); const label=formatY(max-i*spread/4); ctx.fillText(label,4,yy+3); }
    lines.forEach((line) => { ctx.beginPath(); ctx.strokeStyle=line.color; ctx.lineWidth=2; rows.forEach((row,index) => { const value=Number(row[line.key]); if (!Number.isFinite(value)) return; const xx=x(index), yy=y(value); if (index===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy); }); ctx.stroke(); });
    if (options.showFlows) list(performance().flows).forEach((flow) => { const index=rows.findIndex((row) => row.date>=flow.date); if (index<0) return; ctx.fillStyle=Number(flow.amount)>=0?'#17745a':'#b33a46'; ctx.beginPath(); ctx.arc(x(index),height-pad.b,4,0,Math.PI*2); ctx.fill(); });
    ctx.fillStyle='#697287'; ctx.fillText(formatDate(rows[0].date),pad.l,height-8); const endLabel=formatDate(rows.at(-1).date); ctx.fillText(endLabel,width-pad.r-ctx.measureText(endLabel).width,height-8);
    bindChartHover(canvas, rows, options.tooltip || ((row) => `${formatDate(row.date)}\nพอร์ต ${fmtMoney(row.value)}\nอ้างอิง ${fmtMoney(row.benchmarkValue)}`));
  }

  function drawDrawdown(canvas, rows) {
    const view=setupCanvas(canvas,145); if(!view||rows.length<2)return; const {ctx,width,height}=view; const pad={l:58,r:18,t:12,b:24};
    const values=rows.map((row)=>Number(first(row.drawdown,0))); const min=Math.min(...values,-0.001);
    const x=(i)=>pad.l+i/(rows.length-1)*(width-pad.l-pad.r); const y=(v)=>pad.t+(0-v)/(0-min)*(height-pad.t-pad.b);
    ctx.clearRect(0,0,width,height); ctx.strokeStyle='#d9dce1'; ctx.beginPath(); ctx.moveTo(pad.l,pad.t); ctx.lineTo(width-pad.r,pad.t); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x(0),y(0)); rows.forEach((row,i)=>ctx.lineTo(x(i),y(Number(first(row.drawdown,0))))); ctx.lineTo(x(rows.length-1),y(min)); ctx.lineTo(x(0),y(min)); ctx.closePath(); const grad=ctx.createLinearGradient(0,pad.t,0,height-pad.b); grad.addColorStop(0,'rgba(179,58,70,.15)'); grad.addColorStop(1,'rgba(179,58,70,.55)'); ctx.fillStyle=grad; ctx.fill();
    ctx.beginPath(); ctx.strokeStyle='#b33a46'; ctx.lineWidth=1.5; rows.forEach((row,i)=>{const yy=y(Number(first(row.drawdown,0))); if(i===0)ctx.moveTo(x(i),yy);else ctx.lineTo(x(i),yy);});ctx.stroke();
    const governedEvents=obj(performance().analytics?.drawdownEvents); const maximumDrawdown=obj(performance().analytics?.summary?.maximumDrawdown); const eventDate=(key)=>first(governedEvents[key],maximumDrawdown[key]); const indexForDate=(date)=>date?rows.findIndex((row)=>row.date===date):-1; const peakIndex=indexForDate(eventDate('peakDate')); const troughIndex=indexForDate(eventDate('troughDate')); const recoveryIndex=indexForDate(eventDate('recoveryDate'));
    [[peakIndex,'#17745a'],[troughIndex,'#b33a46'],[recoveryIndex,'#315ea8']].forEach(([index,color])=>{if(index<0)return;ctx.fillStyle=color;ctx.beginPath();ctx.arc(x(index),y(Number(first(rows[index].drawdown,0))),3.5,0,Math.PI*2);ctx.fill();});
    ctx.fillStyle='#697287';ctx.font='9px system-ui';ctx.fillText('0%',16,pad.t+3);ctx.fillText(fmtPct(min),8,height-pad.b); bindChartHover(canvas,rows,(row)=>{const index=rows.indexOf(row);const marker=index===peakIndex?' · จุดสูงสุด':index===troughIndex?' · จุดต่ำสุด':index===recoveryIndex?' · ฟื้นกลับถึงจุดเดิม':'';return `${formatDate(row.date)}${marker}\nลดจากจุดสูงสุด ${fmtPct(first(row.drawdown,0))}`;});
  }

  function bindChartHover(canvas, rows, formatter) {
    canvas.onmousemove=(event)=>{ const rect=canvas.getBoundingClientRect(); const ratio=(event.clientX-rect.left)/rect.width; const index=Math.min(rows.length-1,Math.max(0,Math.round(ratio*(rows.length-1)))); let tip=canvas.parentElement.querySelector('.chart-tooltip'); if(!tip){tip=document.createElement('div');tip.className='chart-tooltip';canvas.parentElement.appendChild(tip);} tip.innerHTML=formatter(rows[index]).split('\n').map(esc).join('<br>'); tip.style.left=`${Math.min(rect.width-42,Math.max(42,event.clientX-rect.left))}px`;tip.style.top=`${Math.max(38,event.clientY-rect.top)}px`;tip.hidden=false;};
    canvas.onmouseleave=()=>{const tip=canvas.parentElement.querySelector('.chart-tooltip');if(tip)tip.hidden=true;};
  }

  function searchResults(query) {
    const q=query.trim().toLocaleLowerCase('th-TH'); if(!q)return [];
    const results=[];
    clients().map(normalizedClient).forEach((client)=>{if([client.name,client.ref,client.primaryGoal].join(' ').toLocaleLowerCase('th-TH').includes(q))results.push({type:'client',title:client.name,subtitle:`${client.ref} · ${client.primaryGoal}`,actionId:client.actionId});});
    goals().map(normalizedGoal).forEach((goal)=>{if([goal.name,goal.clientName,goal.goalId].join(' ').toLocaleLowerCase('th-TH').includes(q))results.push({type:'goal',title:goal.name,subtitle:first(goal.clientName,'เป้าหมายลูกค้า'),view:'goals'});});
    funds().forEach((fund)=>{if([fund.nameTh,fund.name,fund.fundCode,fund.amcNameTh].join(' ').toLocaleLowerCase('th-TH').includes(q))results.push({type:'fund',title:first(fund.nameTh,fund.name),subtitle:first(fund.fundCode,fund.amcNameTh),fundId:first(fund.fundId,fund.shareClassId,fund.masterFundId)});});
    cases().forEach((item)=>{if([item.actionId,item.friendlyActionId,item.title,item.clientName].join(' ').toLocaleLowerCase('th-TH').includes(q))results.push({type:'action',title:first(item.title,item.actionId),subtitle:first(item.clientName,item.friendlyActionId),actionId:item.actionId});});
    return results.slice(0,10);
  }

  function renderSearch(query) {
    const popover=$('#searchPopover'); const results=searchResults(query); if(!query.trim()){popover.hidden=true;return;}
    popover.innerHTML=results.length?results.map((item)=>`<button class="search-result" type="button" data-search-type="${esc(item.type)}" ${item.actionId?`data-open-case="${esc(item.actionId)}"`:''} ${item.fundId?`data-explain-fund="${esc(item.fundId)}"`:''} ${item.view?`data-view="${esc(item.view)}"`:''}><span class="goal-icon">${esc(({client:'ล',goal:'ป',fund:'ก',action:'ง'})[item.type]||'•')}</span><span><b>${esc(item.title)}</b><small>${esc(item.subtitle)}</small></span><span>${esc(item.type)}</span></button>`).join(''):'<div class="empty-v3">ไม่พบข้อมูลที่ตรงกับคำค้น</div>'; popover.hidden=false;
  }

  function bindGlobalEvents() {
    if (document.body.dataset.v3Bound) return; document.body.dataset.v3Bound='true';
    document.addEventListener('click', async (event) => {
      if (state.rmMenuOpen && !event.target.closest('.rm-switcher')) { state.rmMenuOpen = false; renderRmSwitcher(); }
      const target=event.target.closest('button,[data-view],[data-allocation-key]'); if(!target)return;
      if(target.hasAttribute('data-rm-profile-toggle')){state.rmMenuOpen=!state.rmMenuOpen;renderRmSwitcher();return;}
      if(target.dataset.rmSwitch){switchActiveRm(target.dataset.rmSwitch);return;}
      if(target.matches('[data-retry]'))return initialize();
      if(target.dataset.clientView){state.clientViewMode=target.dataset.clientView;render();return;}
      if(target.dataset.clientSavedView){state.clientSavedView=target.dataset.clientSavedView;render();return;}
      if(target.dataset.clientSort){if(state.clientSort===target.dataset.clientSort)state.clientSortDirection=state.clientSortDirection==='asc'?'desc':'asc';else{state.clientSort=target.dataset.clientSort;state.clientSortDirection=['dueAt','lastContactAt','rmOwner'].includes(state.clientSort)?'asc':'desc';}render();return;}
      if(target.hasAttribute('data-client-sort-direction')){state.clientSortDirection=state.clientSortDirection==='asc'?'desc':'asc';render();return;}
      if(target.dataset.view){const nextView=['builder','portfolio'].includes(target.dataset.view)?'portfolios':target.dataset.view;if(state.view==='portfolios'&&nextView!=='portfolios'&&!confirmDraftDiscard())return;state.view=nextView;$('#searchPopover').hidden=true;if(nextView==='portfolios'){state.builderClientId=null;state.portfolioWorkspace='list';updatePortfolioUrl({clientId:null,workspace:'list'});}else if(window.location.pathname==='/portfolios'){window.history.pushState({view:nextView},'', '/');}render();if(state.view==='market')await loadSetSmartListed();if(state.view==='portfolios')await loadBuilderBook();return;}
      if(target.dataset.todayFilter){state.todayFilter=target.dataset.todayFilter;render();return;}
      if(target.dataset.openCase){$('#searchPopover').hidden=true;return openCase(target.dataset.openCase);}
      if(target.dataset.showReason)return showReason(target.dataset.showReason);
      if(target.dataset.quick)return quickAction(target.dataset.actionId,target.dataset.quick);
      if(target.hasAttribute('data-reload-setsmart')){await loadSetSmartListed(true);return;}
      if(target.hasAttribute('data-setsmart-search')){state.setsmartAssetQuery=String($('#setsmartAssetSearch')?.value || '').trim();state.setsmartAssetOffset=0;await loadSetSmartListed(true);return;}
      if(target.dataset.setsmartType){state.setsmartAssetType=target.dataset.setsmartType;state.setsmartAssetOffset=0;await loadSetSmartListed(true);return;}
      if(target.dataset.setsmartPage){const next=target.dataset.setsmartPage==='next'?state.setsmartListed.nextOffset:state.setsmartListed.previousOffset;if(next!=null){state.setsmartAssetOffset=Number(next);await loadSetSmartListed(true);}return;}
      if(target.dataset.marketTab){state.marketTab=target.dataset.marketTab;render();if(state.marketTab==='setsmart')await loadSetSmartListed();return;}
      if(target.hasAttribute('data-builder-reload')){await loadBuilderBook(true);return;}
      if(target.dataset.portfolioOpen){await openPortfolioClient(target.dataset.portfolioOpen,target.dataset.workspace||'overview');window.scrollTo({top:0,behavior:'smooth'});return;}
      if(target.hasAttribute('data-portfolio-list')){if(!confirmDraftDiscard())return;state.builderClientId=null;state.portfolioWorkspace='list';state.builderDirty=false;updatePortfolioUrl({clientId:null,workspace:'list'});render();return;}
      if(target.dataset.portfolioWorkspace){switchPortfolioWorkspace(target.dataset.portfolioWorkspace);return;}
      if(target.dataset.builderClient){await openPortfolioClient(target.dataset.builderClient,'overview');window.scrollTo({top:0,behavior:'smooth'});return;}
      if(target.hasAttribute('data-builder-reset')){resetBuilderDraft();render();scheduleBuilderAnalysis();return;}
      if(target.hasAttribute('data-builder-equal')){const weight=state.builderDraftHoldings.length?1/state.builderDraftHoldings.length:0;state.builderDraftHoldings=state.builderDraftHoldings.map((holding)=>({...holding,draftWeight:weight}));state.builderDirty=true;state.builderAnalysis=null;render();scheduleBuilderAnalysis();return;}
      if(target.hasAttribute('data-builder-search')){state.builderAssetQuery=String($('#builderAssetSearch')?.value||'').trim();await searchBuilderAssets();return;}
      if(target.dataset.builderAdd){const row=state.builderAssetResults.find((item)=>item.productId===target.dataset.builderAdd);if(row&&!state.builderDraftHoldings.some((item)=>item.productId===row.productId)&&state.builderDraftHoldings.length<12){state.builderDraftHoldings.push({...row,currentWeight:0,draftWeight:0,quantity:null,marketValue:0,marketAsOf:row.date,marketSource:'SETSMART',clientHoldingSource:'RM_DRAFT'});state.builderDirty=true;state.builderAnalysis=null;render();scheduleBuilderAnalysis();}return;}
      if(target.dataset.builderRemove){state.builderDraftHoldings=state.builderDraftHoldings.filter((holding)=>holding.productId!==target.dataset.builderRemove);state.builderDirty=true;state.builderAnalysis=null;render();scheduleBuilderAnalysis();return;}
      if(target.hasAttribute('data-builder-analyze')){await analyzeBuilder();return;}
      if(target.hasAttribute('data-builder-save')){await saveBuilderDraft();return;}
      if(target.hasAttribute('data-builder-compare')){state.portfolioWorkspace='compare';updatePortfolioUrl({workspace:'compare'});if(state.builderAnalysisStatus!=='ready')await analyzeBuilder();else render();return;}
      if(target.dataset.builderLoadDraft){const draft=state.builderSavedDrafts.find((item)=>item.draftId===target.dataset.builderLoadDraft);if(draft){const sources=[...list(builderPortfolio().holdings),...state.builderDraftHoldings,...state.builderAssetResults];state.builderDraftHoldings=list(draft.holdings).map((item)=>{const source=sources.find((row)=>row.productId===item.productId)||{productId:item.productId,symbol:item.productId.replace('SETSMART:',''),currentWeight:0,quantity:null,marketValue:0,marketSource:'SETSMART'};return {...source,draftWeight:item.weight};});state.builderDraftMeta=draft;state.builderDirty=false;state.portfolioWorkspace='builder';updatePortfolioUrl({workspace:'builder'});render();scheduleBuilderAnalysis();}return;}
      if(target.hasAttribute('data-builder-apply-model')){const modelWeights=list(state.builderAnalysis?.model?.weights);const sourceRows=[...state.builderDraftHoldings,...list(state.builderAnalysis?.currentPortfolio?.holdings)];state.builderDraftHoldings=modelWeights.map((model)=>{const source=sourceRows.find((item)=>item.productId===model.productId)||{productId:model.productId,symbol:model.symbol,currentWeight:0,quantity:null,marketValue:0,marketSource:'SETSMART'};return {...source,draftWeight:model.weight};});state.builderDirty=true;state.builderAnalysis=null;state.builderAnalysisStatus='idle';render();scheduleBuilderAnalysis();return;}
      if(target.dataset.range){state.performanceRange=target.dataset.range;state.performanceZoom=1;render();return;}
      if(target.dataset.allocationMode){state.allocationMode=target.dataset.allocationMode;state.selectedAllocationKey=null;render();return;}
      if(target.dataset.allocationKey){state.selectedAllocationKey=target.dataset.allocationKey;render();return;}
      if(target.hasAttribute('data-allocation-clear')){state.selectedAllocationKey=null;render();return;}
      if(target.dataset.chartLegend){const key=target.dataset.chartLegend;state.chartVisibility[key]=!state.chartVisibility[key];render();return;}
      if(target.dataset.chartZoom){state.performanceZoom=target.dataset.chartZoom==='reset'?1:target.dataset.chartZoom==='in'?Math.min(8,state.performanceZoom*2):Math.max(1,state.performanceZoom/2);render();return;}
      if(target.dataset.explainFund){$('#searchPopover').hidden=true;return explainFund(target.dataset.explainFund);}
      if(target.dataset.metric)return showMetric(target.dataset.metric,target.dataset.meaning);
      if(target.dataset.metricData)return showMetricData(target.dataset.metricData);
      if(target.matches('[data-close-case]'))return closeCase();
      if(target.matches('[data-close-side]'))return closeSide();
      if(target.dataset.caseStep){if(target.dataset.caseStep==='record'&&state.selectedDecision==='HANDOFF'&&!state.handoffReviewed){showToast('ตรวจชุดข้อมูลส่งต่อและยืนยันก่อน','error');return;}state.caseStep=target.dataset.caseStep;renderCase();return;}
      if(target.dataset.decision){state.selectedDecision=target.dataset.decision;state.handoffReviewed=false;if(state.caseStep==='decide')renderCase();return;}
      if(target.matches('[data-save-record]'))return saveRecord();
      if(target.dataset.feedback){const key=target.dataset.feedback;state.feedback[key]=!state.feedback[key];if(state.feedback[key]&&key==='priorityHigh')state.feedback.priorityLow=false;if(state.feedback[key]&&key==='priorityLow')state.feedback.priorityHigh=false;if(key.startsWith('priority'))renderCase();else target.classList.toggle('is-selected',state.feedback[key]);showToast('เลือกไว้แล้ว · จะบันทึกเป็น training label เมื่อปิดเคส');return;}
    });
    const updateBuilderWeight=(input)=>{const holding=state.builderDraftHoldings.find((item)=>item.productId===input.dataset.builderWeight);if(!holding)return;holding.draftWeight=Math.max(0,Number(input.value||0)/100);state.builderDirty=true;state.builderAnalysis=null;state.builderAnalysisStatus='idle';render();scheduleBuilderAnalysis();};
    document.addEventListener('input',(event)=>{if(event.target.id==='clientSearchV3'){state.clientQuery=event.target.value;render();$('#clientSearchV3')?.focus();}if(event.target.id==='draftMessage')state.draftText=event.target.value;if(event.target.id==='globalSearch')renderSearch(event.target.value);if(event.target.matches('[data-builder-weight]'))updateBuilderWeight(event.target);});
    document.addEventListener('change',async (event)=>{if(event.target.id==='portfolioClientSelect'){state.selectedClientId=event.target.value;render();}if(event.target.id==='builderClientSelect'){await openPortfolioClient(event.target.value,state.portfolioWorkspace);}if(event.target.id==='builderAssetType'){state.builderAssetType=event.target.value;await searchBuilderAssets();}if(event.target.id==='builderPeriod'){state.builderPeriod=event.target.value;state.builderAnalysis=null;render();scheduleBuilderAnalysis();}if(event.target.id==='builderMethod'){state.builderMethod=event.target.value;state.builderAnalysis=null;render();scheduleBuilderAnalysis();}if(event.target.id==='builderTargetVol'){state.builderTargetVolatility=Number(event.target.value||12);state.builderAnalysis=null;render();scheduleBuilderAnalysis();}if(event.target.id==='clientSortV3'){state.clientSort=event.target.value;state.clientSortDirection=['dueAt','lastContactAt','rmOwner'].includes(state.clientSort)?'asc':'desc';render();}if(event.target.id==='clientOwnerFilterV3'){state.clientOwnerFilter=event.target.value;render();}if(event.target.id==='clientReadinessFilterV3'){state.clientReadinessFilter=event.target.value;render();}if(event.target.id==='setsmartAssetTypeFilter'){state.setsmartAssetType=event.target.value;state.setsmartAssetOffset=0;await loadSetSmartListed(true);}if(event.target.id==='setsmartAssetPageSize'){state.setsmartAssetLimit=Number(event.target.value);state.setsmartAssetOffset=0;await loadSetSmartListed(true);}if(event.target.matches('[data-handoff-reviewed]')){state.handoffReviewed=event.target.checked;renderCaseFooter();}});
    document.addEventListener('keydown',async (event)=>{if(event.key==='Enter'&&event.target.id==='builderAssetSearch'){event.preventDefault();state.builderAssetQuery=event.target.value.trim();await searchBuilderAssets();return;}if(event.key==='Enter'&&event.target.id==='setsmartAssetSearch'){event.preventDefault();state.setsmartAssetQuery=event.target.value.trim();state.setsmartAssetOffset=0;await loadSetSmartListed(true);return;}if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-allocation-key]')){event.preventDefault();event.target.click();return;}if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();$('#globalSearch').focus();}if(event.key==='Escape'){if(state.rmMenuOpen){state.rmMenuOpen=false;renderRmSwitcher();$('#rmProfileButton')?.focus();}else if($('#sideOverlay').classList.contains('is-open'))closeSide();else if($('#caseOverlay').classList.contains('is-open'))closeCase();else $('#searchPopover').hidden=true;}});
    $('#caseOverlay').addEventListener('click',(event)=>{if(event.target===$('#caseOverlay'))closeCase();});
    $('#sideOverlay').addEventListener('click',(event)=>{if(event.target===$('#sideOverlay'))closeSide();});
    window.addEventListener('resize',()=>{if(state.view==='portfolios'&&state.builderAnalysisStatus==='ready'&&['performance','builder','compare'].includes(state.portfolioWorkspace))drawBuilderCharts();});
    window.addEventListener('popstate',async()=>{const route=portfolioRouteState();if(route.active){state.view='portfolios';state.builderClientId=route.clientId;state.portfolioWorkspace=route.clientId?route.workspace:'list';await loadBuilderBook();if(state.builderClientId)await openPortfolioClient(state.builderClientId,state.portfolioWorkspace,{skipConfirm:true,replace:true});else render();}else{state.view='today';render();}});
    window.addEventListener('beforeunload',(event)=>{if(state.builderDirty){event.preventDefault();event.returnValue='';}});
  }

  initialize();
})();
