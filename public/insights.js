/* FIN-AI analysis centre. Loaded after app.js as a classic script. */
'use strict';

(() => {
  const root = document.getElementById('insightsRoot');
  if (!root) return;

  const TABS = [
    ['business', 'ภาพรวมงานและธุรกิจ'],
    ['market', 'ตลาดไทยและ API'],
    ['client', 'พอร์ตและความเสี่ยง'],
    ['model', 'แบบจำลองพอร์ต'],
  ];
  const COLORS = {
    ink: '#172033', navy: '#18243f', blue: '#315ea8', blueSoft: '#dbe7f6',
    orange: '#ef7622', orangeSoft: '#f5dfcf', green: '#17745a', red: '#b23b3b',
    amber: '#a86508', line: '#d1d4d9', muted: '#687188', paper: '#f8f7f4',
  };
  const CHANNEL_LABELS = { call: 'RM โทรหรือนัดคุย', message: 'AI ร่างข้อความให้ RM ตรวจ', confirm: 'ขอข้อมูลลูกค้าก่อน' };
  const state = {
    initialized: false,
    activeTab: 'business',
    business: null,
    market: null,
    selectedClientId: '',
    clientCache: new Map(),
    frontierCache: new Map(),
    errors: {},
    loading: new Set(),
    crisis: null,
    crisisError: '',
    crisisLoading: false,
    crisisInputs: { clients: 3000, rmCount: 20, severity: 25 },
  };

  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
  const finite = (value) => Number.isFinite(Number(value));
  const number = (value) => finite(value) ? Number(value) : null;
  const fmtInt = (value) => number(value) == null ? '—' : new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(Number(value));
  const fmtBaht = (value, compact = false) => {
    const n = number(value);
    if (n == null) return '—';
    if (compact && Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} พันลบ.`;
    if (compact && Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(Math.abs(n) >= 10_000_000 ? 1 : 2)} ลบ.`;
    return `${new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(n)} บาท`;
  };
  const fmtPct = (value, digits = 1, signed = false) => {
    const n = number(value);
    if (n == null) return '—';
    const sign = signed && n > 0 ? '+' : '';
    return `${sign}${(n * 100).toFixed(digits)}%`;
  };
  const fmtRatio = (value, digits = 2) => number(value) == null ? '—' : Number(value).toFixed(digits);
  const labelDate = (value) => value ? esc(String(value).slice(0, 10)) : 'ไม่ระบุวันข้อมูล';

  async function getJson(url) {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function shell() {
    root.innerHTML = `
      <header class="insights-hero insights-toolbar">
        <div>
          <p class="insights-eyebrow">FIN-AI · มุมมองตรวจสอบ</p>
          <p>ตัวเลขทุกชุดแยกข้อมูลจริง สมมติฐาน และ simulation ออกจากกันอย่างชัดเจน</p>
        </div>
        <label class="insights-client-picker" for="insightsClientSelect">
          <span>ลูกค้าที่วิเคราะห์</span>
          <select id="insightsClientSelect" aria-label="เลือกลูกค้าสำหรับการวิเคราะห์"><option value="">กำลังโหลดรายชื่อลูกค้า…</option></select>
        </label>
      </header>
      <div class="insights-tabbar" role="tablist" aria-label="ส่วนวิเคราะห์">
        ${TABS.map(([id, label], index) => `<button type="button" role="tab" id="insights-tab-${id}" aria-controls="insights-panel" aria-selected="${index === 0}" class="${index === 0 ? 'is-active' : ''}" data-insights-tab="${id}">${label}</button>`).join('')}
      </div>
      <section id="insights-panel" class="insights-panel" role="tabpanel" tabindex="0" aria-labelledby="insights-tab-business">
        ${loadingBlock('กำลังเชื่อมข้อมูลวิเคราะห์…')}
      </section>
      <footer class="insights-footnote">ตัวเลขทุกชุดระบุสถานะข้อมูล · SET SMART ใช้เป็นบริบทตลาดจดทะเบียน ไม่ใช่ NAV กองทุนรวม · ไม่มีการส่งข้อความหรือซื้อขายอัตโนมัติ</footer>
    `;
  }

  function loadingBlock(message) {
    return `<div class="insights-state" role="status"><span class="insights-spinner" aria-hidden="true"></span><strong>${esc(message)}</strong></div>`;
  }

  function emptyBlock(title, detail) {
    return `<div class="insights-state"><strong>${esc(title)}</strong><p>${esc(detail)}</p></div>`;
  }

  function notice(tone, title, detail) {
    return `<div class="insights-notice ${esc(tone)}"><strong>${esc(title)}</strong><p>${esc(detail)}</p></div>`;
  }

  function metricCard(label, value, note = '', tone = '') {
    return `<article class="insights-metric ${esc(tone)}"><span>${esc(label)}</span><strong>${esc(value)}</strong>${note ? `<small>${esc(note)}</small>` : ''}</article>`;
  }

  function populateClients() {
    const select = document.getElementById('insightsClientSelect');
    if (!select) return;
    const queue = state.business?.queue || [];
    const unique = [];
    const seen = new Set();
    for (const row of queue) {
      if (!row.clientId || seen.has(row.clientId)) continue;
      seen.add(row.clientId);
      unique.push(row);
    }
    if (!state.selectedClientId && unique[0]) state.selectedClientId = unique[0].clientId;
    select.innerHTML = unique.length
      ? unique.map((row) => `<option value="${esc(row.clientId)}" ${row.clientId === state.selectedClientId ? 'selected' : ''}>${esc(row.clientName)} · ${esc(row.clientId)}</option>`).join('')
      : '<option value="">ยังไม่มีรายชื่อลูกค้าจาก API</option>';
    select.disabled = !unique.length;
  }

  async function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    shell();
    const [businessResult, marketResult] = await Promise.allSettled([
      getJson('/api/analytics/business'),
      getJson('/api/market/thai'),
    ]);
    if (businessResult.status === 'fulfilled') state.business = businessResult.value;
    else state.errors.business = businessResult.reason?.message || 'โหลดภาพรวมไม่สำเร็จ';
    if (marketResult.status === 'fulfilled') state.market = marketResult.value;
    else state.errors.market = marketResult.reason?.message || 'โหลดตลาดไม่สำเร็จ';
    populateClients();
    renderPanel();
    loadCrisis();
  }

  async function ensureClient(kind) {
    const id = state.selectedClientId;
    if (!id) return;
    const cache = kind === 'client' ? state.clientCache : state.frontierCache;
    const loadKey = `${kind}:${id}`;
    if (cache.has(id) || state.loading.has(loadKey)) return;
    state.loading.add(loadKey);
    delete state.errors[loadKey];
    renderPanel();
    const url = kind === 'client'
      ? `/api/analytics/client/${encodeURIComponent(id)}`
      : `/api/frontier?clientId=${encodeURIComponent(id)}`;
    try { cache.set(id, await getJson(url)); }
    catch (error) { state.errors[loadKey] = error.message || 'โหลดข้อมูลไม่สำเร็จ'; }
    finally { state.loading.delete(loadKey); renderPanel(); }
  }

  function setTab(tab) {
    if (!TABS.some(([id]) => id === tab)) return;
    state.activeTab = tab;
    root.querySelectorAll('[data-insights-tab]').forEach((button) => {
      const active = button.dataset.insightsTab === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    renderPanel();
    if (tab === 'client' || tab === 'model') ensureClient(tab);
    if (tab === 'business' && !state.crisis && !state.crisisLoading) loadCrisis();
  }

  function renderPanel() {
    const panel = document.getElementById('insights-panel');
    if (!panel) return;
    const picker = root.querySelector('.insights-client-picker');
    if (picker) picker.hidden = state.activeTab !== 'client' && state.activeTab !== 'model';
    panel.setAttribute('aria-labelledby', `insights-tab-${state.activeTab}`);
    if (state.activeTab === 'business') panel.innerHTML = renderBusiness();
    if (state.activeTab === 'market') panel.innerHTML = renderMarket();
    if (state.activeTab === 'client') panel.innerHTML = renderClient();
    if (state.activeTab === 'model') panel.innerHTML = renderModel();
    requestAnimationFrame(drawActiveCharts);
  }

  function channelRows(groups = {}) {
    const entries = Object.entries(groups);
    const max = Math.max(1, ...entries.map(([, row]) => number(row.count) || 0));
    if (!entries.length) return '<p class="insights-muted">ไม่มีข้อมูลการกระจายช่องทาง</p>';
    return entries.map(([key, row]) => `
      <div class="insights-workload-row">
        <div><strong>${esc(CHANNEL_LABELS[key] || key)}</strong><small>${fmtInt(row.estimatedMinutes)} นาที · AUM ${fmtBaht(row.aumBaht, true)}</small></div>
        <div class="insights-progress"><span style="width:${Math.max(3, ((number(row.count) || 0) / max) * 100)}%"></span></div>
        <b>${fmtInt(row.count)}</b>
      </div>`).join('');
  }

  function renderTransformationAnswer() {
    const capabilities = [
      ['เงินฝากและสภาพคล่อง', 'ตรวจเงินสำรอง กระแสเงินสด และวันใช้เงิน', 'จัด bucket เงินพร้อมใช้หรือชวนทบทวนเงินที่นิ่ง'],
      ['การลงทุน', 'ตรวจ goal gap ความเสี่ยง และพอร์ตที่เบนจากแผน', 'เปรียบเทียบทางเลือกกองทุนไทยและผลต่อเป้าหมาย'],
      ['สินเชื่อ', 'ตรวจ funding need และความสามารถชำระ ไม่บังคับขายสินทรัพย์ทันที', 'RM ขอความยินยอมแล้วส่งต่อผู้เชี่ยวชาญพร้อมบริบท'],
      ['ประกันและความคุ้มครอง', 'ตรวจผู้พึ่งพารายได้ ภาระหนี้ และช่องว่างความคุ้มครอง', 'RM ถามขั้นต่ำและส่งต่อผู้เชี่ยวชาญ ไม่เลือกกรมธรรม์เอง'],
    ];
    return `<section class="insights-transformation" aria-labelledby="transformationTitle">
      <div class="insights-transformation-head"><div><p class="insights-kicker">คำตอบต่อ Key Question</p><h2 id="transformationTitle">AI เชื่อม 4 ธุรกิจให้เป็นวงจรดูแลลูกค้าตลอดชีวิต</h2><p>FIN-AI ไม่เริ่มจากสินค้าที่ต้องการขาย แต่เริ่มจาก KYC เป้าหมาย life event และ need ของลูกค้า แล้วเปลี่ยนเป็นบทสนทนาหรือการส่งต่อที่เหมาะสม</p></div><span class="insights-status live">Whole-wealth relationship loop</span></div>
      <div class="insights-capability-grid">${capabilities.map(([name, detect, action]) => `<article><strong>${name}</strong><span><b>AI ช่วยเห็น:</b> ${detect}</span><span><b>RM ทำต่อ:</b> ${action}</span></article>`).join('')}</div>
      <ol class="insights-relationship-loop">
        <li><b>รวม Client 360</b><span>KYC · goal · holdings · cash flow · debt · coverage · consent</span></li>
        <li><b>ตรวจจับการเปลี่ยนแปลง</b><span>market event · life event · data conflict · unmet need</span></li>
        <li><b>ตรวจ Safe Gate</b><span>suitability · eligibility · affordability · consent</span></li>
        <li><b>เลือก Next-Best Conversation</b><span>โทร · ร่างข้อความ · ขอข้อมูล · ส่งต่อ · ยังไม่ทำอะไร</span></li>
        <li><b>ปิดวงและเรียนรู้</b><span>owner · deadline · client response · audit trail · pilot outcome</span></li>
      </ol>
      <p class="insights-source-line"><strong>สำหรับ RM ที่ไม่รู้ประกันหรือสินเชื่อลึก:</strong> ระบบให้เพียงคำถามคัดกรอง เหตุผล และปุ่มส่งต่อผู้เชี่ยวชาญพร้อมความยินยอม—not product selection.</p>
    </section>`;
  }

  function renderBusiness() {
    if (!state.business) return emptyBlock('ยังเปิดภาพรวมไม่ได้', state.errors.business || 'API ยังไม่ส่งข้อมูลภาพรวมงาน');
    const data = state.business;
    const h = data.headline || {};
    const c = data.channelMix || {};
    const topQueue = (data.queue || []).slice(0, 8);
    return `
      <div class="insights-section-head"><div><p class="insights-eyebrow">ภาพรวมที่ใช้จัดทรัพยากร</p><h2>งานที่ต้องดูแลและบริบทธุรกิจ</h2><p>AUM ใช้เป็นบริบทความสัมพันธ์และเป็นตัวตัดสินลำดับสุดท้าย ไม่ใช่รายได้ที่ระบบสมมติขึ้น</p></div></div>
      ${renderTransformationAnswer()}
      <div class="insights-metric-grid six">
        ${metricCard('ลูกค้าในคิว', fmtInt(h.clientCount), `AUM รวม ${fmtBaht(h.totalAumBaht, true)}`, 'blue')}
        ${metricCard('ต้องเริ่มวันนี้ / SLA', fmtInt(h.dueTodayOrSlaCount), `${fmtInt(h.dueTodayOrSlaMinutes)} นาที`, 'red')}
        ${metricCard('RM โทรหรือนัดคุย', fmtInt(c.humanCallCount), 'ใช้เวลาคนกับเคสซับซ้อน', 'orange')}
        ${metricCard('ข้อความที่ AI ช่วยร่าง', fmtInt(c.assistedMessageCount), 'RM ตรวจและอนุมัติก่อนส่ง', 'green')}
        ${metricCard('ต้องยืนยัน KYC / Goal', fmtInt(c.dataConfirmationCount), 'ปิดคำแนะนำจนลูกค้าตอบ', 'amber')}
        ${metricCard('งานติดตาม', fmtInt(h.followupCount), 'มีเจ้าของและสถานะ', 'amber')}
      </div>
      ${renderCrisisSimulator()}
      <div class="insights-two-col">
        <article class="insights-card">
          <header><div><p class="insights-kicker">Workload routing</p><h3>เลือกช่องทางให้เหมาะกับงาน</h3></div></header>
          ${channelRows(data.workload?.byChannel)}
          <div class="insights-subnotice"><strong>ยังไม่อ้างว่าประหยัดเวลา</strong><span>${esc(c.note || 'ต้องมี baseline ก่อนและหลังใช้งานจริง')}</span></div>
        </article>
        <article class="insights-card">
          <header><div><p class="insights-kicker">Capacity · คิวงานจริง 6 เคส</p><h3>กำลังคนจริงต้องเชื่อมตารางงานก่อน</h3></div></header>
          <div class="insights-capacity-number"><strong>${fmtInt(data.capacity?.requiredTodayOrSlaMinutes)}</strong><span>นาทีที่ต้องใช้กับเคสวันนี้ / SLA</span></div>
          <p>${esc(data.capacity?.status || 'ยังคำนวณ utilization ไม่ได้')}</p>
          <ul class="insights-clean-list">${(data.capacity?.whatIsNeeded || []).map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
        </article>
      </div>
      <article class="insights-card insights-wide">
        <header><div><p class="insights-kicker">Transparent queue</p><h3>เหตุผลที่รายชื่อนี้มาก่อน</h3></div><span class="insights-status neutral">ไม่มีคะแนน ML ลึกลับ</span></header>
        <div class="insights-table-wrap"><table class="insights-table"><thead><tr><th>ลำดับ</th><th>ลูกค้า</th><th>เหตุผล</th><th>ช่องทาง</th><th>กำหนด</th><th>AUM</th></tr></thead><tbody>
          ${topQueue.map((row) => `<tr><td>${fmtInt(row.position)}</td><td><strong>${esc(row.clientName)}</strong><small>${esc(row.clientId)}</small></td><td>${esc(row.reason || '—')}</td><td>${esc(CHANNEL_LABELS[row.channel] || row.channel || '—')}</td><td>${esc(row.due || '—')}</td><td>${fmtBaht(row.aumBaht, true)}</td></tr>`).join('')}
        </tbody></table></div>
        <details class="insights-details"><summary>กติกาจัดลำดับและข้อจำกัด</summary><ol>${(data.queuePolicy?.rulesInOrder || []).map((item) => `<li>${esc(item)}</li>`).join('')}</ol><p>${esc(data.queuePolicy?.ethicsGuardrail || '')}</p></details>
      </article>
      <div class="insights-two-col">
        <article class="insights-card"><header><div><p class="insights-kicker">Follow-up</p><h3>งานส่งต่อไม่หายระหว่างทีม</h3></div></header>${renderFollowups(data.followups)}</article>
        <article class="insights-card"><header><div><p class="insights-kicker">Value discipline</p><h3>สิ่งที่วัดได้และยังวัดไม่ได้</h3></div></header>
          <div class="insights-capacity-number"><strong>${fmtBaht(data.businessValue?.aumInQueueBaht, true)}</strong><span>AUM ในคิว ไม่ใช่รายได้</span></div>
          <p>${esc(data.businessValue?.note || '')}</p>
          <div class="insights-null-metrics"><span>รายได้ประมาณการ <b>${data.businessValue?.revenueEstimateBaht == null ? 'ยังไม่คำนวณ' : fmtBaht(data.businessValue.revenueEstimateBaht)}</b></span><span>Conversion <b>${data.businessValue?.conversionEstimate == null ? 'ยังไม่คำนวณ' : fmtPct(data.businessValue.conversionEstimate)}</b></span></div>
        </article>
      </div>`;
  }

  function renderFollowups(followups = {}) {
    const rows = followups.items || [];
    if (!rows.length) return '<p class="insights-muted">ยังไม่มีงานติดตาม</p>';
    return `<div class="insights-mini-list">${rows.slice(0, 6).map((item) => `<div><span><strong>${esc(item.client)}</strong><small>${esc(item.topic)}</small></span><span><b>${esc(item.status)}</b><small>${esc(item.owner)}</small></span></div>`).join('')}</div>`;
  }

  function renderCrisisSimulator() {
    const i = state.crisisInputs;
    return `<section class="insights-crisis" aria-labelledby="crisisTitle">
      <header>
        <div><p class="insights-kicker">Crisis book simulator · ข้อมูลลูกค้าสังเคราะห์</p><h2 id="crisisTitle">ถ้าพอร์ตลูกค้าจำนวนมากลดลงพร้อมกัน RM จะรับมืออย่างไร</h2><p>จำลองวันตลาดรุนแรงเพื่อดูคิวและกำลังคน ไม่ใช่ผลทำนายและไม่ใช่ข้อมูลลูกค้าจริง</p></div>
        <span class="insights-status crisis">Simulation only</span>
      </header>
      <blockquote class="insights-crisis-story"><strong>ภาพวันวิกฤต:</strong> ค่าเริ่มต้นจำลองลูกค้าที่ถือสินทรัพย์เสี่ยง 75% เมื่อสินทรัพย์เสี่ยงลดลง 25% พอร์ตจึงลดลง 18.75% ลูกค้ารีบถามว่า “ทำไมพอร์ตขาดทุนหนักขนาดนี้?” แต่ RM หนึ่งคนดูแลลูกค้าหลายร้อยราย หากหลายคนติดต่อพร้อมกัน สายและข้อความจะสะสมจนความเชื่อมั่นเริ่มลดลง</blockquote>
      <p class="insights-crisis-scope">จำลองลูกค้า AUM 2–50 ล้านบาทต่อราย · ปรับได้ 100–10,000 ราย และ RM 1–100 คน · ข้อมูลทั้งหมดเป็นข้อมูลสังเคราะห์</p>
      <ol class="insights-pipeline insights-pipeline-visible" aria-label="ขั้นตอนที่ FIN-AI ช่วย RM">
        <li><b>คำนวณทุกพอร์ต</b><span>quant คำนวณจาก exposure สังเคราะห์รายลูกค้า</span></li>
        <li><b>คาดปริมาณสาย</b><span>ML ช่วยวางกำลังคน ไม่ตัดสินแทน RM</span></li>
        <li><b>จัดช่องทาง</b><span>หน้าที่และความเสียหายมาก่อนยอดเงิน</span></li>
        <li><b>ร่างคำอธิบาย</b><span>LLM ใช้เฉพาะตัวเลขที่ engine คำนวณ</span></li>
        <li><b>RM ตรวจและอนุมัติ</b><span>ไม่ส่งข้อความและไม่ซื้อขายอัตโนมัติ</span></li>
      </ol>
      <div class="insights-slider-grid">
        <label><span>จำนวนลูกค้า <b id="crisisClientsValue">${fmtInt(i.clients)} คน</b></span><input type="range" min="100" max="10000" step="100" value="${i.clients}" data-crisis-input="clients"></label>
        <label><span>จำนวน RM <b id="crisisRmValue">${fmtInt(i.rmCount)} คน</b></span><input type="range" min="1" max="100" step="1" value="${i.rmCount}" data-crisis-input="rmCount"></label>
        <label><span>สินทรัพย์เสี่ยงในตลาด <b id="crisisSeverityValue">-${i.severity.toFixed(2)}%</b></span><input type="range" min="10" max="35" step="0.25" value="${i.severity}" data-crisis-input="severity"></label>
      </div>
      <div id="crisisResult">${renderCrisisResult()}</div>
      <details class="insights-details crisis-pipeline"><summary>ดูคำอธิบายเชิงเทคนิคของแต่ละขั้นตอน</summary>
        <ol class="insights-pipeline">
          <li><b>เครื่องคำนวณพอร์ต</b><span>คำนวณผลกระทบรายพอร์ตจาก exposure สังเคราะห์และ scenario shock</span></li>
          <li><b>แบบจำลองแนวโน้มติดต่อ</b><span>ประมาณปริมาณการติดต่อจากข้อมูลพอร์ตและพฤติกรรม เพื่อช่วยวางกำลังคน</span></li>
          <li><b>กติกาจัดช่องทาง</b><span>เลือกโทร ร่างข้อความ หรือเฝ้าดู โดยหน้าที่และความเสียหายต่อลูกค้ามาก่อน</span></li>
          <li><b>ผู้ช่วยร่างข้อความ</b><span>ร่างคำอธิบายจากผลคำนวณที่มีแหล่งอ้างอิง ไม่สร้างตัวเลขเอง</span></li>
          <li><b>RM อนุมัติ</b><span>RM ตรวจ แก้ และอนุมัติก่อนสื่อสาร; ไม่มีการซื้อขายอัตโนมัติ</span></li>
        </ol>
      </details>
    </section>`;
  }

  function pick(object, paths) {
    for (const path of paths) {
      let current = object;
      for (const key of path.split('.')) current = current && current[key];
      if (current !== undefined && current !== null) return current;
    }
    return null;
  }

  function simSide(data, side, fallbackTitle) {
    const block = data?.[side] || data?.comparison?.[side] || {};
    const title = block.label || fallbackTitle;
    const assisted = side === 'withFinAi';
    const metrics = [
      [assisted ? 'RM โทรเคสซับซ้อน' : 'สายที่ RM ต้องรับ', pick(block, ['calls', 'callCount', 'humanCalls']), 'สาย'],
      [assisted ? 'ร่างข้อความรอ RM อนุมัติ' : 'ข้อความที่ช่วยแบ่งสาย', pick(block, ['messages', 'messageCount', 'assistedMessages']), 'ข้อความ'],
      [assisted ? 'เฝ้าดูและยกระดับเมื่อมี trigger' : 'ยังไม่ได้คัดกรองเชิงรุก', pick(block, ['monitoring', 'monitorCount', 'monitorOnly']), 'เคส'],
      ['เวลาคิวทั้งหมด', pick(block, ['queueMinutes', 'requiredMinutes']), 'นาที'],
      ['เวลาเกินกำลังวันนี้', pick(block, ['queueOverCapacityMinutes']), 'นาที'],
      ['RM ที่ยังเกินกำลัง', pick(block, ['overloadedRmCount']), 'คน'],
    ];
    return `<article class="insights-crisis-side ${side === 'withFinAi' ? 'with' : 'without'}"><h3>${esc(title)}</h3><small class="insights-planning-label">ค่าประมาณเพื่อวางแผนจากสมมติฐานเวลาที่แสดง</small><div>${metrics.map(([label, value, unit]) => `<span><small>${label}</small><strong>${value == null ? '—' : `${fmtInt(value)} ${unit}`}</strong></span>`).join('')}</div>${finite(block.capacityUtilization) ? `<p>ใช้กำลัง RM ${fmtPct(block.capacityUtilization)}</p>` : ''}${block.description ? `<p>${esc(block.description)}</p>` : ''}</article>`;
  }

  function renderCrisisResult() {
    if (state.crisisLoading) return loadingBlock('กำลังจำลองทั้ง book…');
    if (!state.crisis) return emptyBlock('ยังไม่มีผลจำลอง', state.crisisError || 'ปรับตัวเลื่อนเพื่อเรียก simulation API');
    const data = state.crisis;
    const headline = data.headline || data.summary || {};
    return `
      <div class="insights-crisis-headline">
        ${metricCard('พอร์ตที่ลดตั้งแต่ 8%', fmtInt(pick(headline, ['affectedCount', 'clientsAffected', 'affectedClients'])), 'ผลจากสถานการณ์จำลอง', 'red')}
        ${metricCard('โมเดลคาดว่าจะติดต่อ', fmtInt(pick(headline, ['contactingCount', 'contacts', 'inboundCount'])), 'ไม่ใช่จำนวนสายจริง', 'orange')}
        ${metricCard('AUM ของพอร์ตที่ลดตั้งแต่ 8%', fmtBaht(pick(headline, ['aumRepresentedBaht', 'affectedAumBaht', 'aumBaht']), true), 'ไม่ใช่รายได้', 'blue')}
        ${metricCard('พอร์ตลูกค้าตัวอย่างลดลง', fmtPct(pick(headline, ['exampleLossRate']), 2), fmtBaht(pick(headline, ['exampleLossBaht']), true), 'red')}
        ${metricCard('RM ในการจำลอง', fmtInt(headline.rmCount), `เฉลี่ย ${fmtRatio(headline.averageClientsPerRm, 0)} ลูกค้า / RM`, 'green')}
      </div>
      <div class="insights-equation"><strong>สูตรพอร์ตตัวอย่าง:</strong> ${fmtPct(pick(headline, ['exampleRiskyAssetShare']), 0)} สินทรัพย์เสี่ยง × ${fmtPct(data.inputs?.riskyAssetShock, 2)} shock = <b>-${fmtPct(Math.abs(number(pick(headline, ['exampleLossRate'])) || 0), 2)}</b></div>
      <div class="insights-crisis-compare">
        ${simSide(data, 'withoutFinAi', 'ไม่มี FIN-AI')}
        <div class="insights-versus" aria-hidden="true">→</div>
        ${simSide(data, 'withFinAi', 'ใช้ FIN-AI ช่วยจัดเส้นทาง')}
      </div>
      ${renderCrisisEvidence(data)}
      ${data.note || data.assumptions?.note ? `<p class="insights-source-line">${esc(data.note || data.assumptions.note)}</p>` : ''}`;
  }

  function renderCrisisEvidence(data) {
    const ml = data.mlModel || {};
    const comparison = data.comparison || {};
    const top = (data.topClients || []).slice(0, 10);
    const channel = { call: 'RM โทร', message: 'ข้อความส่วนบุคคล', monitor: 'เฝ้าดู' };
    return `
      <div class="insights-two-col insights-crisis-evidence">
        <article class="insights-card">
          <header><div><p class="insights-kicker">Actual ML component · synthetic data</p><h3>โมเดลคาดแนวโน้มลูกค้าติดต่อ</h3></div><span class="insights-status crisis">Prototype ML</span></header>
          <div class="insights-ml-metrics"><span><small>โมเดล</small><strong>${esc(ml.type || '—')}</strong></span><span><small>ข้อมูลฝึกสังเคราะห์</small><strong>${fmtInt(ml.trainingRows)} แถว</strong></span><span><small>ข้อมูลทดสอบสังเคราะห์</small><strong>${fmtInt(ml.validationRows)} แถว</strong></span><span><small>Holdout AUC</small><strong>${fmtRatio(ml.syntheticValidationAuc, 3)}</strong></span></div>
          <p>${esc(ml.governance || 'ML ช่วยประมาณแนวโน้มเท่านั้น กติกาหน้าที่และประโยชน์ลูกค้าต้องมาก่อนคะแนน')}</p>
        </article>
        <article class="insights-card">
          <header><div><p class="insights-kicker">Capacity arithmetic</p><h3>ผลต่างเกิดจากสมมติฐานใด</h3></div></header>
          <div class="insights-ml-metrics"><span><small>เวลาคิวที่ต่างกัน</small><strong>${fmtInt(comparison.queueMinutesDifference)} นาที</strong></span><span><small>เวลาเกินกำลังที่ต่างกัน</small><strong>${fmtInt(comparison.overCapacityMinutesDifference)} นาที</strong></span><span><small>เวลาต่อสายเดิม</small><strong>${fmtRatio(data.assumptions?.contactMinutesPerCall, 1)} นาที</strong></span><span><small>เวลาตรวจข้อความ</small><strong>${fmtRatio(data.assumptions?.aiMessageReviewMinutes, 1)} นาที</strong></span></div>
          <p>${esc(comparison.note || data.assumptions?.note || '')}</p>
        </article>
      </div>
      ${renderRmRoster(data.rmRoster || [])}
      ${top.length ? `<details class="insights-details"><summary>ดูตัวอย่างคิวที่ระบบจัดจากลูกค้าสังเคราะห์</summary><div class="insights-table-wrap"><table class="insights-table compact"><thead><tr><th>ลูกค้า</th><th>ผลขาดทุนสมมติ</th><th>แนวโน้มติดต่อ</th><th>ช่องทาง</th><th>AUM</th></tr></thead><tbody>${top.map((item) => `<tr><td><strong>${esc(item.name)}</strong><small>${esc(item.id)}</small></td><td>${fmtPct(-Math.abs(number(item.lossRate) || 0))}<small>${fmtBaht(item.lossBaht, true)}</small></td><td>${fmtPct(item.contactProbability, 0)}</td><td>${esc(channel[item.channel] || item.channel || '—')}</td><td>${fmtBaht(item.aumBaht, true)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}`;
  }

  function renderRmRoster(roster) {
    if (!roster.length) return '';
    const shown = roster.slice(0, 20);
    return `<article class="insights-card insights-wide insights-rm-roster">
      <header><div><p class="insights-kicker">Synthetic RM roster</p><h3>กระจายลูกค้าสังเคราะห์ลง RM รายคน</h3><p>เรียง RM ที่มีเวลาคิวหลังใช้ FIN-AI มากที่สุดก่อน แสดง ${fmtInt(shown.length)} จาก ${fmtInt(roster.length)} คน</p></div><span class="insights-status neutral">${fmtInt(roster.length)} RM</span></header>
      <div class="insights-table-wrap"><table class="insights-table"><thead><tr><th>RM</th><th>ลูกค้า</th><th>โมเดลคาดว่าจะติดต่อ</th><th>RM โทร</th><th>ร่างข้อความ</th><th>ไม่มี FIN-AI</th><th>ใช้ FIN-AI</th><th>เวลาเกินกำลัง</th></tr></thead><tbody>${shown.map((row) => `<tr><td><strong>${esc(row.rmName)}</strong><small>${esc(row.rmId)}</small></td><td>${fmtInt(row.clientCount)}</td><td>${fmtInt(row.expectedContacts)}</td><td>${fmtInt(row.calls)}</td><td>${fmtInt(row.messages)}</td><td>${fmtInt(row.manualQueueMinutes)} นาที</td><td>${fmtInt(row.assistedQueueMinutes)} นาที</td><td>${fmtInt(row.assistedOverCapacityMinutes)} นาที</td></tr>`).join('')}</tbody></table></div>
      <p class="insights-source-line">ข้อมูล RM และลูกค้าเป็น synthetic ทั้งหมด การลดเวลามาจากสมมติฐานงานที่แสดง ไม่ใช่ผล pilot จริง</p>
    </article>`;
  }

  async function loadCrisis() {
    state.crisisLoading = true;
    state.crisisError = '';
    updateCrisisResult();
    const i = state.crisisInputs;
    const query = new URLSearchParams({ clients: String(i.clients), rmCount: String(i.rmCount), shock: String(-i.severity) });
    try { state.crisis = await getJson(`/api/simulation/crisis?${query}`); }
    catch (error) { state.crisis = null; state.crisisError = `Simulation API ยังไม่พร้อม (${error.message})`; }
    finally { state.crisisLoading = false; updateCrisisResult(); }
  }

  function updateCrisisResult() {
    const target = document.getElementById('crisisResult');
    if (target) target.innerHTML = renderCrisisResult();
  }

  function renderMarket() {
    if (!state.market) return emptyBlock('ยังเปิดข้อมูลตลาดไม่ได้', state.errors.market || 'API ยังไม่ส่งข้อมูลตลาดไทย');
    const market = state.market;
    const live = market.mode === 'live';
    const partial = market.mode === 'partial';
    return `
      <div class="insights-section-head"><div><p class="insights-eyebrow">Thailand first</p><h2>ตลาดไทยและสถานะ API</h2><p>ใช้ข้อมูลตลาดจดทะเบียนเป็นบริบทประกอบการสนทนา ไม่ใช้แทน NAV กองทุนหรือรายการผลิตภัณฑ์ที่องค์กรอนุมัติ</p></div><span class="insights-status ${live ? 'live' : partial ? 'partial' : 'neutral'}">${esc(market.label || market.mode || 'ไม่ทราบสถานะ')}</span></div>
      ${notice(live ? 'success' : partial ? 'warning' : 'neutral', live ? 'เชื่อม SET SMART แล้ว' : partial ? 'ข้อมูล live ได้บางส่วน' : 'ยังไม่ใช้ค่าตลาด live', market.explanation || '')}
      <div class="insights-market-grid">${(market.proxies || []).map(renderMarketProxy).join('') || emptyBlock('ไม่มี market proxy', 'API ไม่ได้ส่งรายการสินทรัพย์')}</div>
      <div class="insights-two-col">
        <article class="insights-card"><header><div><p class="insights-kicker">Data lineage</p><h3>เส้นทางข้อมูลที่ตรวจสอบได้</h3></div></header>
          <ol class="insights-pipeline compact"><li><b>SET SMART</b><span>Adjusted close ของ ETF/หลักทรัพย์ตัวแทนตลาดไทย</span></li><li><b>FIN-AI server adapter</b><span>เก็บ API key ฝั่ง server ตรวจ schema วันข้อมูล และ cache</span></li><li><b>Market context</b><span>แสดงสถานการณ์ตลาดให้ RM ไม่ใช่ NAV หรือคำสั่งซื้อขาย</span></li></ol>
        </article>
        <article class="insights-card"><header><div><p class="insights-kicker">Product boundary</p><h3>ข้อมูลกองทุนมาจากคนละแหล่ง</h3></div></header><p>ชื่อกองทุน NAV ค่าธรรมเนียม สภาพคล่อง และระดับความเสี่ยง ต้องอ่านจาก SEC Fund Daily Info, factsheet และรายการผลิตภัณฑ์ที่องค์กรอนุมัติฉบับล่าสุด</p><div class="insights-subnotice"><strong>API key ไม่ออกจาก server</strong><span>Browser เห็นเฉพาะข้อมูลที่ normalize แล้ว</span></div></article>
      </div>`;
  }

  function renderMarketProxy(proxy) {
    const isLive = proxy.status === 'live';
    const isStale = proxy.status === 'stale';
    const hasValue = (isLive || isStale) && finite(proxy.lastClose);
    return `<article class="insights-market-card ${isLive ? 'is-live' : isStale ? 'is-stale' : ''}"><header><div><strong>${esc(proxy.symbol)}</strong><span>${esc(proxy.label)}</span></div><span class="insights-status ${isLive ? 'live' : isStale ? 'partial' : 'neutral'}">${isLive ? 'LIVE' : isStale ? 'STALE' : esc(proxy.status || 'ไม่มีข้อมูล')}</span></header>${hasValue ? `<div class="insights-market-price"><strong>${fmtRatio(proxy.lastClose, 2)}</strong><b class="${number(proxy.oneDayMove) >= 0 ? 'positive' : 'negative'}">${fmtPct(proxy.oneDayMove, 2, true)}</b></div><div class="insights-market-moves"><span>1 วัน <b>${fmtPct(proxy.oneDayMove, 2, true)}</b></span><span>5 วัน <b>${fmtPct(proxy.fiveDayMove, 2, true)}</b></span><span>1 เดือน <b>${fmtPct(proxy.oneMonthMove, 2, true)}</b></span></div><p>ข้อมูล ณ ${labelDate(proxy.dataAsOf)} · ${fmtInt(proxy.observations)} จุด · ${esc(proxy.cache || 'cache n/a')}</p><small>${esc(proxy.source || '')}</small>${proxy.monitoring ? `<div class="insights-market-signal"><strong>${esc(proxy.monitoring.label)}</strong><span>${esc(proxy.monitoring.talkingPoint)}</span></div>` : ''}` : `<div class="insights-no-value">ไม่แสดงราคาแทนด้วยค่าจำลอง</div><small>${esc(proxy.errorCode || proxy.reason || 'ไม่มีข้อมูลที่ผ่านการตรวจ')}</small>`}<footer>ตัวแทนบริบท: ${esc(proxy.proxyFor || '—')} · SET SMART close ไม่ใช่ NAV กองทุนรวม</footer></article>`;
  }

  function clientPayload() { return state.clientCache.get(state.selectedClientId); }
  function frontierPayload() { return state.frontierCache.get(state.selectedClientId); }

  function renderClient() {
    if (!state.selectedClientId) return emptyBlock('ยังเลือกลูกค้าไม่ได้', 'โหลดภาพรวมงานเพื่อรับรายชื่อลูกค้าก่อน');
    const loadKey = `client:${state.selectedClientId}`;
    if (state.loading.has(loadKey)) return loadingBlock('กำลังคำนวณพอร์ต เป้าหมาย และสถานการณ์จาก engine เดียวกับหน้า RM…');
    const data = clientPayload();
    if (!data) return emptyBlock('ยังเปิดการวิเคราะห์ไม่ได้', state.errors[loadKey] || 'เลือกแท็บนี้อีกครั้งเพื่อโหลดข้อมูล');
    const p = data.portfolios || {};
    const current = p.current || {};
    const model = p.approvedModel || {};
    const goal = data.goalProjection || {};
    const scenarios = data.scenarioComparison || [];
    const worst = [...scenarios].sort((a, b) => (number(b.currentPortfolio?.lossBaht) || 0) - (number(a.currentPortfolio?.lossBaht) || 0))[0];
    const volDiff = number(p.signedChange?.volatility);
    const probabilityDiff = (number(goal.approvedModelBase?.probabilityOfReachingTarget) || 0) - (number(goal.currentPortfolioBase?.probabilityOfReachingTarget) || 0);
    const gate = data.adviceGate || {};
    return `
      <div class="insights-section-head"><div><p class="insights-eyebrow">Client analytics · ${esc(data.client?.id)}</p><h2>${esc(data.client?.name || 'ลูกค้า')}</h2><p>${esc(data.client?.segment || '')} · AUM ${fmtBaht(data.client?.aum, true)} · เป้าหมาย ${esc(data.client?.goal?.name || 'ยังไม่ระบุ')}</p></div><span class="insights-status ${gate.recommendationUsable ? 'live' : 'blocked'}">${gate.recommendationUsable ? 'ใช้เตรียมคำแนะนำได้' : 'Diagnostic only'}</span></div>
      ${notice(gate.recommendationUsable ? 'success' : 'warning', gate.recommendationUsable ? 'ข้อมูลผ่าน gate สำหรับกรณีศึกษา' : 'ยังห้ามใช้เป็นคำแนะนำ', gate.reason || '')}
      <div class="insights-plain-summary"><strong>RM ควรรู้อะไรจากหน้านี้</strong><ul><li>${volDiff == null ? 'ยังเปรียบเทียบความเสี่ยงไม่ได้' : volDiff < 0 ? `กรอบพอร์ตเปรียบเทียบลดความผันผวนคาดหมาย ${fmtPct(Math.abs(volDiff))}` : `กรอบพอร์ตเปรียบเทียบเพิ่มความผันผวนคาดหมาย ${fmtPct(volDiff)}`}</li><li>${worst ? `เหตุการณ์ที่กระทบพอร์ตปัจจุบันมากที่สุดในชุดทดสอบคือ “${esc(worst.plainName || worst.name)}” ขาดทุนสมมติ ${fmtBaht(worst.currentPortfolio?.lossBaht, true)}` : 'ยังไม่มีผลทดสอบสถานการณ์'}</li><li>โอกาสถึงเป้าหมายของกรอบเปรียบเทียบ ${probabilityDiff >= 0 ? 'เพิ่ม' : 'ลด'} ${fmtPct(Math.abs(probabilityDiff))}; ต้องพิจารณาควบคู่กับ downside และข้อมูลลูกค้าที่ลงนาม</li></ul></div>
      <div class="insights-metric-grid five">
        ${metricCard('ผลตอบแทนคาดหมาย/ปี', fmtPct(current.metrics?.expectedReturn), 'พอร์ตปัจจุบัน', 'blue')}
        ${metricCard('ความผันผวน/ปี', fmtPct(current.metrics?.volatility), 'พอร์ตปัจจุบัน', 'orange')}
        ${metricCard('โอกาสถึงเป้าหมาย', fmtPct(goal.currentPortfolioBase?.probabilityOfReachingTarget), `เป้าหมาย ${fmtBaht(goal.targetBaht, true)}`, 'green')}
        ${metricCard('VaR 95% · 1 วัน', fmtBaht(current.oneDayRisk?.valueAtRisk95Baht, true), 'Normal diagnostic', 'red')}
        ${metricCard('ES 95% · 1 วัน', fmtBaht(current.oneDayRisk?.expectedShortfall95Baht, true), 'ไม่แทน fat-tail scenario', 'amber')}
      </div>
      <div class="insights-chart-grid">
        ${chartCard('allocationChart', 'พอร์ตปัจจุบันเทียบกรอบเปรียบเทียบ', 'น้ำหนักสินทรัพย์ไทย 6 กลุ่ม', 'allocation')}
        ${chartCard('riskContributionChart', 'อะไรเป็นตัวขับความเสี่ยง', 'น้ำหนักเงินเทียบสัดส่วน contribution ต่อ variance', 'risk contribution')}
      </div>
      <article class="insights-card insights-wide"><header><div><p class="insights-kicker">Named stress scenarios</p><h3>เหตุการณ์รุนแรงเทียบแบบเดียวกันทุกพอร์ต</h3></div><span class="insights-status neutral">ไม่ใช่การพยากรณ์</span></header><div class="insights-canvas-wrap"><canvas id="scenarioChart" role="img" aria-label="เปรียบเทียบขาดทุนในแต่ละสถานการณ์ของพอร์ตปัจจุบันและกรอบพอร์ต"></canvas></div>${scenarioTable(scenarios)}</article>
      <div class="insights-two-col">
        <article class="insights-card"><header><div><p class="insights-kicker">Goal projection</p><h3>ช่วงผลลัพธ์ 5,000 เส้นทาง</h3></div></header>${goalBlock(goal)}</article>
        <article class="insights-card"><header><div><p class="insights-kicker">Advanced metrics</p><h3>เปิดเมื่อ RM ต้องการตรวจตัวเลข</h3></div></header>${advancedMetrics(data)}</article>
      </div>
      <article class="insights-card insights-wide"><header><div><p class="insights-kicker">Correlation assumptions</p><h3>สินทรัพย์เคลื่อนไหวร่วมกันเพียงใด</h3></div></header><div class="insights-canvas-wrap heatmap"><canvas id="correlationChart" role="img" aria-label="Correlation heatmap ของสินทรัพย์ไทยหกกลุ่ม"></canvas></div>${correlationTable(data.correlation)}</article>
      ${notice('neutral', 'ไม่มี historical backtest ในหน้านี้', data.historicalBacktest?.reason || 'ยังไม่มี time series ที่ตรวจสอบแล้ว')}`;
  }

  function chartCard(id, title, subtitle, aria) {
    return `<article class="insights-card"><header><div><p class="insights-kicker">Quant engine</p><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div></header><div class="insights-canvas-wrap"><canvas id="${esc(id)}" role="img" aria-label="กราฟ ${esc(aria)}"></canvas></div></article>`;
  }

  function goalBlock(goal) {
    const current = goal.currentPortfolioBase || {};
    const model = goal.approvedModelBase || {};
    const range = (item) => `${fmtBaht(item.distributionBaht?.p05, true)} — ${fmtBaht(item.distributionBaht?.p95, true)}`;
    return `<div class="insights-goal-compare"><div><span>พอร์ตปัจจุบัน</span><strong>${fmtPct(current.probabilityOfReachingTarget)}</strong><small>ช่วง 5–95%: ${range(current)}</small></div><div><span>กรอบเปรียบเทียบ</span><strong>${fmtPct(model.probabilityOfReachingTarget)}</strong><small>ช่วง 5–95%: ${range(model)}</small></div></div><p class="insights-source-line">${esc(goal.method || '')}</p><details class="insights-details"><summary>ข้อควรระวัง</summary><p>${esc(goal.caveat || '')}</p></details>`;
  }

  function advancedMetrics(data) {
    const current = data.portfolios?.current || {};
    const risk = current.oneDayRisk || {};
    return `<details class="insights-details" open><summary>ตัวเลขพอร์ตปัจจุบัน</summary><dl class="insights-dl"><div><dt>Sharpe ratio</dt><dd>${fmtRatio(current.metrics?.sharpeRatio)}</dd></div><div><dt>Variance/ปี</dt><dd>${fmtRatio(current.metrics?.variance, 5)}</dd></div><div><dt>Daily volatility</dt><dd>${fmtPct(risk.dailyVolatility, 2)}</dd></div><div><dt>VaR 95%</dt><dd>${fmtPct(risk.valueAtRisk95Rate, 2)}</dd></div><div><dt>Expected shortfall 95%</dt><dd>${fmtPct(risk.expectedShortfall95Rate, 2)}</dd></div></dl><p>${esc(risk.limitation || '')}</p></details><details class="insights-details"><summary>Capital-market assumptions</summary><p>${esc(data.assumptions?.status || '')}</p><p>หน่วย: ${esc(data.assumptions?.frequency || '')}</p></details>`;
  }

  function scenarioTable(scenarios) {
    return `<details class="insights-details"><summary>ดูตัวเลขทุกสถานการณ์</summary><div class="insights-table-wrap"><table class="insights-table compact"><thead><tr><th>สถานการณ์</th><th>พอร์ตปัจจุบัน</th><th>กรอบเปรียบเทียบ</th><th>ส่วนต่างโอกาสถึงเป้าหมาย<br>(กรอบ − ปัจจุบัน)</th></tr></thead><tbody>${scenarios.map((item) => `<tr><td><strong>${esc(item.plainName || item.name)}</strong><small>${esc(item.horizon || '')}</small></td><td>${fmtBaht(item.currentPortfolio?.lossBaht, true)}<small>${fmtPct(item.currentPortfolio?.shockReturn)}</small></td><td>${fmtBaht(item.approvedModel?.lossBaht, true)}<small>${fmtPct(item.approvedModel?.shockReturn)}</small></td><td>${fmtPct(item.signedComparison?.modelMinusCurrentGoalProbability, 1, true)}</td></tr>`).join('')}</tbody></table></div><p class="insights-source-line">ช่วงเวลาข้างชื่อเป็นบริบทของสถานการณ์ แต่ engine ใช้ conditional shock ณ จุดเริ่มต้นแล้วจำลองเส้นทางหลัง shock; ยังไม่ใช่ stressed regime ที่คงอยู่ตลอดช่วงดังกล่าว</p></details>`;
  }

  function correlationTable(correlation = {}) {
    const labels = correlation.assetLabels || [];
    const matrix = correlation.matrix || [];
    return `<details class="insights-details"><summary>ดู correlation matrix เป็นตาราง</summary><div class="insights-table-wrap"><table class="insights-table matrix"><thead><tr><th></th>${labels.map((label) => `<th title="${esc(label)}">${esc(label.slice(0, 12))}</th>`).join('')}</tr></thead><tbody>${matrix.map((row, i) => `<tr><th>${esc((labels[i] || '').slice(0, 12))}</th>${row.map((value) => `<td>${fmtRatio(value, 2)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
  }

  function renderModel() {
    if (!state.selectedClientId) return emptyBlock('ยังเลือกลูกค้าไม่ได้', 'โหลดภาพรวมงานเพื่อรับรายชื่อลูกค้าก่อน');
    const loadKey = `model:${state.selectedClientId}`;
    if (state.loading.has(loadKey)) return loadingBlock('กำลังสร้าง efficient frontier จาก covariance และ constraints ชุดเดียวกัน…');
    const data = frontierPayload();
    if (!data) return emptyBlock('ยังเปิดแบบจำลองไม่ได้', state.errors[loadKey] || 'เลือกแท็บนี้อีกครั้งเพื่อโหลดข้อมูล');
    const client = data.client || {};
    const gate = client.adviceGate || {};
    const current = client.current || {};
    const caseModel = client.caseStudyModel || {};
    if (gate.recommendationUsable === false) return `
      <div class="insights-section-head"><div><p class="insights-eyebrow">Exact long-only optimization</p><h2>แบบจำลองพอร์ต</h2><p>เครื่องมือเชิงวิเคราะห์ถูกแยกจากสิทธิ์ในการให้คำแนะนำ และจะไม่ข้าม KYC, suitability หรือข้อมูลเป้าหมาย</p></div><span class="insights-status blocked">Diagnostic only</span></div>
      ${notice('warning', 'ยังเปิดการเปรียบเทียบพอร์ตรายลูกค้าไม่ได้', gate.reason || 'ต้องให้ลูกค้ายืนยัน KYC, suitability และข้อมูลเป้าหมายก่อน')}
      ${emptyBlock('Safe gate ปิดอยู่', 'กลับไปหน้าลูกค้าเพื่อดูข้อมูลที่ขาดและขอให้ลูกค้ายืนยัน ระบบจะไม่ใช้กราฟ optimizer เป็นคำแนะนำระหว่างนี้')}`;
    return `
      <div class="insights-section-head"><div><p class="insights-eyebrow">Exact long-only optimization</p><h2>แบบจำลองพอร์ต</h2><p>เส้น efficient frontier เป็น analytical reference ภายใต้ข้อจำกัดที่ประกาศ ไม่ใช่พอร์ตแนะนำหรือกรอบที่องค์กรอนุมัติแล้ว</p></div><span class="insights-status neutral">ไม่มี CML · ไม่มี backtest ปลอม</span></div>
      ${notice('success', 'KYC / Suitability / Goal gate ผ่านสำหรับการวิเคราะห์', gate.reason || 'ยังต้องให้ RM และลูกค้าอนุมัติก่อนทุก action')}
      ${notice('warning', 'อ่านกราฟนี้อย่างไร', 'จุดที่อยู่ซ้ายกว่ามีความเสี่ยงคาดหมายน้อยกว่า จุดที่อยู่สูงกว่ามีผลตอบแทนคาดหมายมากกว่า แต่พอร์ตใช้งานจริงยังต้องผ่าน liquidity, concentration, suitability, fee และ product-shelf constraints')}
      <div class="insights-metric-grid four">
        ${metricCard('พอร์ตปัจจุบัน · ผลตอบแทน', fmtPct(current.expectedReturn), `ความเสี่ยง ${fmtPct(current.volatility)}`, 'blue')}
        ${metricCard('กรอบหลายเป้าหมาย · ผลตอบแทน', fmtPct(caseModel.expectedReturn), `ความเสี่ยง ${fmtPct(caseModel.volatility)}`, 'orange')}
        ${metricCard('Global minimum variance', fmtPct(data.globalMinimumVariance?.volatility), `ผลตอบแทน ${fmtPct(data.globalMinimumVariance?.expectedReturn)}`, 'green')}
        ${metricCard('สินทรัพย์ในแบบจำลอง', fmtInt(data.assumptions?.assetKeys?.length), 'ไทย 6 กลุ่ม', 'amber')}
      </div>
      <article class="insights-card insights-wide frontier-card"><header><div><p class="insights-kicker">Efficient set</p><h3>ความเสี่ยงคาดหมายเทียบผลตอบแทนคาดหมายต่อปี</h3></div></header><div class="insights-canvas-wrap frontier"><canvas id="frontierInsightsChart" role="img" aria-label="Efficient frontier ของสินทรัพย์ไทยภายใต้ข้อจำกัด long-only"></canvas></div><div class="insights-legend"><span class="frontier">Efficient frontier</span><span class="cloud">พอร์ตที่เป็นไปได้</span><span class="current">พอร์ตปัจจุบัน</span><span class="model">กรอบหลายเป้าหมาย</span></div></article>
      <div class="insights-chart-grid">
        <article class="insights-card"><header><div><p class="insights-kicker">Allocation</p><h3>พอร์ตปัจจุบันเทียบกรอบหลายเป้าหมาย</h3></div></header><div class="insights-canvas-wrap"><canvas id="modelAllocationChart" role="img" aria-label="น้ำหนักพอร์ตปัจจุบันเทียบกรอบหลายเป้าหมาย"></canvas></div>${modelBuckets(caseModel)}</article>
        <article class="insights-card"><header><div><p class="insights-kicker">Model comparison</p><h3>กรอบอ้างอิงในชุดเดียวกัน</h3></div></header>${modelTable(data.models || [])}</article>
      </div>
      <div class="insights-two-col"><article class="insights-card"><header><div><p class="insights-kicker">Declared constraints</p><h3>สิ่งที่ optimizer ทำและไม่ได้ทำ</h3></div></header><ul class="insights-clean-list">${(data.constraints || []).map((item) => `<li>${esc(item)}</li>`).join('')}</ul></article><article class="insights-card"><header><div><p class="insights-kicker">Governance</p><h3>ทำไมกรอบใช้งานจริงอาจไม่อยู่บนเส้น</h3></div></header><p>${esc(data.policyNote || '')}</p><p class="insights-source-line">${esc(data.referenceStatus || '')}</p></article></div>`;
  }

  function modelBuckets(model) {
    const buckets = model.buckets || [];
    if (!buckets.length) return '';
    return `<details class="insights-details"><summary>แบ่งเงินตามเป้าหมาย</summary><div class="insights-buckets">${buckets.map((item) => `<div><strong>${esc(item.name)}</strong><b>${fmtBaht(item.amount, true)}</b><small>${fmtPct(item.share)} · ${esc(item.template)}</small></div>`).join('')}</div></details>`;
  }

  function modelTable(models) {
    return `<div class="insights-table-wrap"><table class="insights-table compact"><thead><tr><th>กรอบ</th><th>ผลตอบแทน</th><th>ความเสี่ยง</th><th>Sharpe</th></tr></thead><tbody>${models.map((model) => `<tr><td><strong>${esc(model.name)}</strong></td><td>${fmtPct(model.expectedReturn)}</td><td>${fmtPct(model.volatility)}</td><td>${fmtRatio(model.sharpeRatio)}</td></tr>`).join('')}</tbody></table></div><p class="insights-source-line">ใช้ expected returns และ covariance ชุดเดียวกัน จึงเปรียบเทียบได้โดยไม่สลับสมมติฐาน</p>`;
  }

  function setupCanvas(id, requestedHeight) {
    const canvas = document.getElementById(id);
    if (!canvas || !canvas.parentElement) return null;
    const width = Math.max(300, canvas.parentElement.clientWidth || 700);
    const height = requestedHeight;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = '12px Inter, "Noto Sans Thai", Tahoma, sans-serif';
    ctx.textBaseline = 'middle';
    return { canvas, ctx, width, height };
  }

  function clipped(text, length) { const value = String(text || ''); return value.length > length ? `${value.slice(0, length - 1)}…` : value; }

  function drawGroupedHorizontal(id, labels, first, second, options = {}) {
    const height = Math.max(330, labels.length * 50 + 66);
    const view = setupCanvas(id, height);
    if (!view) return;
    const { ctx, width } = view;
    const left = width < 560 ? 118 : 190;
    const right = 48;
    const top = 40;
    const rowH = (height - top - 28) / Math.max(1, labels.length);
    const values = [...first, ...second].map((value) => number(value) || 0);
    const min = Math.min(0, ...values);
    const max = Math.max(0.01, ...values);
    const span = max - min || 1;
    const x = (value) => left + ((value - min) / span) * (width - left - right);
    const zero = x(0);
    ctx.strokeStyle = COLORS.line; ctx.beginPath(); ctx.moveTo(zero, top - 10); ctx.lineTo(zero, height - 20); ctx.stroke();
    ctx.fillStyle = COLORS.muted; ctx.fillText(options.firstLabel || 'พอร์ตปัจจุบัน', left, 14); ctx.fillStyle = options.firstColor || COLORS.blue; ctx.fillRect(left - 18, 10, 12, 8);
    ctx.fillStyle = COLORS.muted; ctx.fillText(options.secondLabel || 'กรอบเปรียบเทียบ', left + 135, 14); ctx.fillStyle = options.secondColor || COLORS.orange; ctx.fillRect(left + 117, 10, 12, 8);
    labels.forEach((label, index) => {
      const y = top + index * rowH;
      ctx.fillStyle = COLORS.ink; ctx.textAlign = 'left'; ctx.fillText(clipped(label, width < 560 ? 16 : 27), 4, y + 9);
      ctx.fillStyle = COLORS.blueSoft; ctx.fillRect(left, y, width - left - right, 25);
      const draw = (value, yy, color) => {
        const end = x(number(value) || 0); ctx.fillStyle = color; ctx.fillRect(Math.min(zero, end), yy, Math.max(1, Math.abs(end - zero)), 9);
      };
      draw(first[index], y + 1, options.firstColor || COLORS.blue);
      draw(second[index], y + 14, options.secondColor || COLORS.orange);
      ctx.textAlign = 'right'; ctx.fillStyle = COLORS.muted; ctx.fillText(fmtPct(first[index], 0), width - 3, y + 5); ctx.fillText(fmtPct(second[index], 0), width - 3, y + 18);
    });
    ctx.textAlign = 'left';
  }

  function drawAllocation(data, id = 'allocationChart') {
    const labels = data.assumptions?.assetLabels || [];
    const keys = data.assumptions?.assetKeys || [];
    const current = keys.map((key) => data.portfolios?.current?.weights?.[key]);
    const model = keys.map((key) => data.portfolios?.approvedModel?.weights?.[key]);
    drawGroupedHorizontal(id, labels, current, model);
  }

  function drawRiskContribution(data) {
    const assets = data.portfolios?.current?.riskContributions?.assets || [];
    drawGroupedHorizontal('riskContributionChart', assets.map((item) => item.label), assets.map((item) => item.weight), assets.map((item) => item.varianceShare), { firstLabel: 'น้ำหนักเงิน', secondLabel: 'สัดส่วนความเสี่ยง', firstColor: COLORS.blue, secondColor: COLORS.red });
  }

  function drawScenario(data) {
    const scenarios = data.scenarioComparison || [];
    drawGroupedHorizontal('scenarioChart', scenarios.map((item) => item.plainName || item.name), scenarios.map((item) => item.currentPortfolio?.lossBaht / data.client.aum), scenarios.map((item) => item.approvedModel?.lossBaht / data.client.aum), { firstLabel: 'พอร์ตปัจจุบัน', secondLabel: 'กรอบเปรียบเทียบ', firstColor: COLORS.red, secondColor: COLORS.orange });
  }

  function heatColor(value) {
    const v = Math.max(-1, Math.min(1, Number(value) || 0));
    if (v < 0) { const t = Math.abs(v); return `rgb(${Math.round(242 - t * 110)},${Math.round(244 - t * 78)},${Math.round(248 - t * 28)})`; }
    const t = v; return `rgb(${Math.round(248 - t * 9)},${Math.round(247 - t * 112)},${Math.round(243 - t * 176)})`;
  }

  function drawCorrelation(data) {
    const corr = data.correlation || {};
    const labels = corr.assetLabels || [];
    const matrix = corr.matrix || [];
    const view = setupCanvas('correlationChart', 470);
    if (!view || !labels.length) return;
    const { ctx, width, height } = view;
    const left = width < 620 ? 78 : 165; const top = 78; const size = Math.min((width - left - 12) / labels.length, (height - top - 15) / labels.length);
    labels.forEach((label, i) => {
      ctx.fillStyle = COLORS.muted; ctx.textAlign = 'right'; ctx.fillText(clipped(label, width < 620 ? 9 : 18), left - 7, top + i * size + size / 2);
      ctx.save(); ctx.translate(left + i * size + size / 2, top - 8); ctx.rotate(-Math.PI / 4); ctx.textAlign = 'left'; ctx.fillText(clipped(label, width < 620 ? 8 : 15), 0, 0); ctx.restore();
    });
    matrix.forEach((row, i) => row.forEach((value, j) => {
      ctx.fillStyle = heatColor(value); ctx.fillRect(left + j * size, top + i * size, size - 1, size - 1);
      if (size > 38) { ctx.fillStyle = Math.abs(value) > 0.72 ? '#fff' : COLORS.ink; ctx.textAlign = 'center'; ctx.fillText(Number(value).toFixed(2), left + j * size + size / 2, top + i * size + size / 2); }
    }));
    ctx.textAlign = 'left';
  }

  function drawFrontier(data) {
    const view = setupCanvas('frontierInsightsChart', 500);
    if (!view) return;
    const { ctx, width, height } = view;
    const left = width < 600 ? 54 : 72, right = 22, top = 25, bottom = 58;
    const frontier = data.frontier || [], cloud = data.cloud || [];
    const marks = [data.client?.current, data.client?.caseStudyModel, ...(data.models || []), data.globalMinimumVariance].filter(Boolean);
    const xs = [...frontier, ...cloud, ...marks].map((p) => number(p.volatility)).filter((v) => v != null);
    const ys = [...frontier, ...cloud, ...marks].map((p) => number(p.expectedReturn)).filter((v) => v != null);
    if (!xs.length || !ys.length) return;
    const maxX = Math.max(...xs, 0.01) * 1.12, maxY = Math.max(...ys, 0.01) * 1.18;
    const x = (v) => left + (Number(v) / maxX) * (width - left - right);
    const y = (v) => height - bottom - (Number(v) / maxY) * (height - top - bottom);
    ctx.strokeStyle = COLORS.line; ctx.fillStyle = COLORS.muted; ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i += 1) {
      const xv = maxX * i / 5, yv = maxY * i / 5;
      ctx.beginPath(); ctx.moveTo(x(xv), top); ctx.lineTo(x(xv), height - bottom); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(left, y(yv)); ctx.lineTo(width - right, y(yv)); ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillText(`${(xv * 100).toFixed(0)}%`, x(xv), height - bottom + 18);
      ctx.textAlign = 'right'; ctx.fillText(`${(yv * 100).toFixed(1)}%`, left - 7, y(yv));
    }
    ctx.fillStyle = 'rgba(49,94,168,.18)'; for (const point of cloud) { ctx.beginPath(); ctx.arc(x(point.volatility), y(point.expectedReturn), 1.8, 0, Math.PI * 2); ctx.fill(); }
    const sorted = [...frontier].sort((a, b) => a.expectedReturn - b.expectedReturn);
    ctx.strokeStyle = COLORS.orange; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.beginPath(); sorted.forEach((point, i) => i ? ctx.lineTo(x(point.volatility), y(point.expectedReturn)) : ctx.moveTo(x(point.volatility), y(point.expectedReturn))); ctx.stroke();
    const point = (item, color, radius, label) => { if (!item || !finite(item.volatility) || !finite(item.expectedReturn)) return; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x(item.volatility), y(item.expectedReturn), radius, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = COLORS.paper; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = COLORS.ink; ctx.textAlign = 'left'; ctx.fillText(label, Math.min(width - 120, x(item.volatility) + 8), Math.max(13, y(item.expectedReturn) - 10)); };
    point(data.client?.current, COLORS.red, 6, 'พอร์ตปัจจุบัน');
    point(data.client?.caseStudyModel, COLORS.green, 6, 'กรอบหลายเป้าหมาย');
    point(data.globalMinimumVariance, COLORS.navy, 5, 'Min variance');
    ctx.fillStyle = COLORS.muted; ctx.textAlign = 'center'; ctx.fillText('ความเสี่ยงคาดหมายต่อปี', (left + width - right) / 2, height - 15);
    ctx.save(); ctx.translate(15, (top + height - bottom) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('ผลตอบแทนคาดหมายต่อปี', 0, 0); ctx.restore();
    ctx.textAlign = 'left';
  }

  function drawModelAllocation(data) {
    const keys = data.assumptions?.assetKeys || [];
    const labels = data.assumptions?.assetLabels || keys;
    drawGroupedHorizontal('modelAllocationChart', labels, keys.map((key) => data.client?.current?.weights?.[key]), keys.map((key) => data.client?.caseStudyModel?.weights?.[key]), { secondLabel: 'กรอบหลายเป้าหมาย' });
  }

  function drawActiveCharts() {
    if (state.activeTab === 'client') {
      const data = clientPayload(); if (!data) return;
      drawAllocation(data); drawRiskContribution(data); drawScenario(data); drawCorrelation(data);
    }
    if (state.activeTab === 'model') {
      const data = frontierPayload(); if (!data) return;
      drawFrontier(data); drawModelAllocation(data);
    }
  }

  root.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-insights-tab]');
    if (tab) setTab(tab.dataset.insightsTab);
  });
  root.addEventListener('change', (event) => {
    if (event.target.id === 'insightsClientSelect') {
      state.selectedClientId = event.target.value;
      if (state.activeTab === 'client' || state.activeTab === 'model') ensureClient(state.activeTab);
      else renderPanel();
    }
  });
  root.addEventListener('input', (event) => {
    const key = event.target.dataset.crisisInput;
    if (!key) return;
    state.crisisInputs[key] = Number(event.target.value);
    const labels = { clients: ['crisisClientsValue', `${fmtInt(state.crisisInputs.clients)} คน`], rmCount: ['crisisRmValue', `${fmtInt(state.crisisInputs.rmCount)} คน`], severity: ['crisisSeverityValue', `-${state.crisisInputs.severity.toFixed(2)}%`] };
    const target = document.getElementById(labels[key][0]); if (target) target.textContent = labels[key][1];
    clearTimeout(loadCrisis.timer); loadCrisis.timer = setTimeout(loadCrisis, 320);
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-view="insights"]')) queueMicrotask(initialize);
  });
  async function openInsightsTab(tabId = 'business') {
    await initialize();
    setTab(tabId);
  }
  window.finAiInsights = { openTab: openInsightsTab };
  document.addEventListener('finai:open-insights', (event) => {
    openInsightsTab(event.detail?.tab || 'business');
  });
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawActiveCharts, 120); });
  if (document.getElementById('view-insights')?.classList.contains('is-visible')) initialize();
})();
