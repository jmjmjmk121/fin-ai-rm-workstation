'use strict';

const state = {
  data: null,
  offline: false,
  activeView: 'today',
  activeClient: null,
  activeStep: 'summary',
  prepared: null,
  rebalance: null,
  stress: null,
  scenarioId: 'tariff',
  selectedOption: null,
  referralConsentByClient: {},
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function fmtBaht(value, compact = false) {
  const number = Number(value || 0);
  if (compact && Math.abs(number) >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 1 : 2)} ลบ.`;
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(number) + ' บาท';
}

function fmtPct(value, digits = 1) {
  return `${(Number(value || 0) * 100).toFixed(digits)}%`;
}

function fmtDate(value) {
  try { return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
  catch { return value; }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}

async function loadData() {
  try {
    state.data = await fetchJson('/api/workbench');
  } catch (error) {
    state.data = await fetchJson('./demo-data.json');
    state.offline = true;
  }
  state.scenarioId = state.data.scenarios[0]?.id || 'tariff';
  renderApp();
}

function renderApp() {
  $('#todayBadge').textContent = state.data.todayCount ?? state.data.clients.length;
  $('#todayCount').textContent = state.data.todayCount ?? state.data.clients.filter((client) => client.mandatory || client.due.includes('วันนี้')).length;
  $('#followupBadge').textContent = state.data.followups.length;
  $('#asOfText').textContent = `อัปเดต ${fmtDate(state.data.generatedAt)} · ข้อมูลลูกค้าสาธิต`;
  const market = state.data.market;
  $('#dataStatusText').textContent = market.label;
  $('#dataStatusButton').classList.toggle('is-live', market.mode === 'live');
  $('#dataStatusButton').classList.toggle('is-partial', market.mode === 'partial');
  $('#dataStatusButton').classList.toggle('is-demo', market.mode === 'demo');
  $('#dataStatusButton').setAttribute('aria-label', `${market.label} เปิดรายละเอียดแหล่งข้อมูลตลาด`);
  renderSummary();
  renderQueue();
  renderClients();
  renderFollowups();
}

function renderSummary() {
  $('#summaryGrid').innerHTML = state.data.summary.map((card) => `
    <article class="summary-card ${escapeHtml(card.tone)}">
      <div class="summary-icon">${escapeHtml(card.icon)}</div>
      <div><strong>${escapeHtml(card.value)}</strong><span>${escapeHtml(card.label)}</span>${card.sub ? `<span>${escapeHtml(card.sub)}</span>` : ''}</div>
    </article>
  `).join('');
}

const GROUPS = [
  { id: 'mandatory', title: 'ต้องโทรวันนี้', description: 'เรื่องที่ธนาคารมีหน้าที่ต้องรับผิดชอบ ลัดคิวโดยไม่ดูยอดขาย', filter: (client) => client.mandatory },
  { id: 'call', title: 'ควรโทรหรือนัดคุย', description: 'ต้องใช้ RM ทำความเข้าใจหลายมิติหรืออธิบายข้อดีข้อเสีย', filter: (client) => !client.mandatory && client.channel === 'call' },
  { id: 'message', title: 'ส่งข้อความได้', description: 'สื่อสารเชิงรุกโดยไม่แย่งเวลาสายจากเคสที่ซับซ้อน', filter: (client) => client.channel === 'message' },
  { id: 'confirm', title: 'ขอข้อมูลก่อน', description: 'ยังไม่แนะนำผลิตภัณฑ์หรือจัดพอร์ตจนกว่าลูกค้าจะยืนยัน', filter: (client) => client.channel === 'confirm' },
];

function actionLabel(client) {
  if (client.mandatory) return 'เตรียมโทร';
  if (client.channel === 'message') return 'ดูข้อความ';
  if (client.channel === 'confirm') return 'เตรียมคำขอ';
  return 'เตรียมคุย';
}

function renderQueue() {
  $('#queueSections').innerHTML = GROUPS.map((group) => {
    const clients = state.data.clients.filter(group.filter);
    if (!clients.length) return '';
    return `
      <section class="queue-group">
        <header class="queue-header"><div><h2>${escapeHtml(group.title)}</h2><p>${escapeHtml(group.description)}</p></div><span class="count">${clients.length} เคส</span></header>
        <div class="task-list">${clients.map(renderTaskCard).join('')}</div>
      </section>
    `;
  }).join('');
}

function renderTaskCard(client) {
  return `
    <article class="task-card">
      <div class="task-person"><span class="avatar">${escapeHtml(client.initials)}</span><div><strong>${escapeHtml(client.name)}</strong><small>${escapeHtml(client.segment)} · ${fmtBaht(client.aum, true)}</small></div></div>
      <div class="task-reason"><strong>${escapeHtml(client.reason)}</strong><p>เป้าหมายของการติดต่อ: ${escapeHtml(client.objective)}</p></div>
      <div class="task-action"><span class="due-label">${escapeHtml(client.due)} · ~${escapeHtml(client.callMinutes)} นาที</span><button class="primary-button" type="button" data-open-client="${escapeHtml(client.id)}">${actionLabel(client)}</button></div>
    </article>
  `;
}

function renderClients(query = '') {
  const normalized = query.trim().toLowerCase();
  const clients = state.data.clients.filter((client) => !normalized || `${client.name} ${client.id} ${client.segment}`.toLowerCase().includes(normalized));
  $('#clientList').innerHTML = clients.length ? clients.map((client) => `
    <article class="client-row">
      <div class="name"><span class="avatar">${escapeHtml(client.initials)}</span><div><strong>${escapeHtml(client.name)}</strong><p>${escapeHtml(client.id)}</p></div></div>
      <p>${escapeHtml(client.segment)}<br><strong>${fmtBaht(client.aum, true)}</strong></p>
      <div class="need">${escapeHtml(client.reason)}</div>
      <button class="secondary-button" type="button" data-open-client="${escapeHtml(client.id)}">เปิดลูกค้า</button>
    </article>
  `).join('') : '<div class="empty-state">ไม่พบลูกค้าที่ค้นหา</div>';
}

function renderFollowups() {
  $('#followupList').innerHTML = state.data.followups.map((item) => `
    <article class="followup-row">
      <div><strong>${escapeHtml(item.client)}</strong><p>${escapeHtml(item.clientId)}</p></div>
      <div><strong>${escapeHtml(item.topic)}</strong><p>เจ้าของงาน: ${escapeHtml(item.owner)}</p></div>
      <div><p>กำหนดติดตาม</p><strong>${escapeHtml(item.due)}</strong></div>
      <span class="status-pill">${escapeHtml(item.status)}</span>
    </article>
  `).join('');
}

function setView(view) {
  state.activeView = view;
  $$('.nav-item').forEach((button) => button.classList.toggle('is-active', button.dataset.view === view));
  $$('.view').forEach((section) => section.classList.toggle('is-visible', section.id === `view-${view}`));
}

async function loadPrepared(clientId) {
  if (state.offline && state.data.precomputed?.[clientId]) return state.data.precomputed[clientId].prepare;
  return fetchJson(`/api/clients/${encodeURIComponent(clientId)}/prepare`);
}

async function loadRebalance(clientId) {
  if (state.offline && state.data.precomputed?.[clientId]) return state.data.precomputed[clientId].rebalance;
  return fetchJson(`/api/clients/${encodeURIComponent(clientId)}/rebalance`);
}

async function loadStress(clientId, scenarioId) {
  if (state.offline && state.data.precomputed?.[clientId]?.stress?.[scenarioId]) return state.data.precomputed[clientId].stress[scenarioId];
  return fetchJson(`/api/clients/${encodeURIComponent(clientId)}/stress`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenarioId }),
  });
}

async function openClient(clientId) {
  state.activeClient = state.data.clients.find((client) => client.id === clientId);
  state.activeStep = workflowFor(state.activeClient)[0].id;
  state.prepared = null;
  state.rebalance = null;
  state.stress = null;
  state.selectedOption = null;
  $('#workspaceAvatar').textContent = state.activeClient.initials;
  $('#workspaceClientName').textContent = state.activeClient.name;
  $('#workspaceClientMeta').textContent = `${state.activeClient.id} · ${state.activeClient.segment} · ${fmtBaht(state.activeClient.aum, true)}`;
  $('#workspaceDue').textContent = state.activeClient.due;
  renderStepNav();
  $('#clientWorkspace').classList.add('is-open');
  $('#clientWorkspace').setAttribute('aria-hidden', 'false');
  $('#scrim').classList.add('is-visible');
  $('#workspaceBody').innerHTML = '<div class="empty-state">AI กำลังรวมข้อมูล ตรวจข้อจำกัด และเตรียมคำอธิบาย…</div>';
  try {
    [state.prepared, state.rebalance] = await Promise.all([loadPrepared(clientId), loadRebalance(clientId)]);
    const recommended = state.rebalance?.options?.find((option) => option.recommended);
    state.selectedOption = recommended?.id || 'noTrade';
    renderWorkspace();
  } catch (error) {
    $('#workspaceBody').innerHTML = `<div class="empty-state">เตรียมข้อมูลไม่สำเร็จ: ${escapeHtml(error.message)}</div>`;
  }
}

function closeClient() {
  $('#clientWorkspace').classList.remove('is-open');
  $('#clientWorkspace').setAttribute('aria-hidden', 'true');
  $('#scrim').classList.remove('is-visible');
}

function workflowFor(client) {
  if (client.mandatory) return [
    { id: 'summary', label: 'เข้าใจเรื่อง' },
    { id: 'questions', label: 'ยืนยันปัญหา' },
    { id: 'service', label: 'เจ้าของและเวลา' },
    { id: 'conversation', label: 'เตรียมโทร' },
  ];
  if (client.channel === 'message') return [
    { id: 'summary', label: 'ตรวจเหตุผล' },
    { id: 'stress', label: 'ดูผลกระทบ' },
    { id: 'conversation', label: 'ตรวจข้อความ' },
  ];
  if (client.channel === 'confirm') return [
    { id: 'summary', label: 'ดู KYC ที่ขาด' },
    { id: 'questions', label: 'ให้ลูกค้ายืนยัน' },
    { id: 'conversation', label: 'ตรวจคำขอ' },
  ];
  if (client.goalReady === false) return [
    { id: 'summary', label: 'เข้าใจเป้าหมายใหม่' },
    { id: 'questions', label: 'ยืนยันข้อมูลสำคัญ' },
    { id: 'conversation', label: 'เตรียมโทร' },
  ];
  return [
    { id: 'summary', label: 'เข้าใจเคส' },
    { id: 'questions', label: 'สิ่งที่ต้องถาม' },
    { id: 'portfolio', label: 'ทบทวนพอร์ต' },
    { id: 'stress', label: 'เหตุการณ์รุนแรง' },
    { id: 'conversation', label: 'เตรียมคุย' },
  ];
}

function renderStepNav() {
  const steps = workflowFor(state.activeClient);
  $('#stepNav').innerHTML = steps.map((step, index) => `
    <button type="button" data-step="${escapeHtml(step.id)}" class="${step.id === state.activeStep ? 'is-active' : ''}"><span>${index + 1}</span>${escapeHtml(step.label)}</button>
  `).join('');
}

function setStep(step) {
  if (!workflowFor(state.activeClient).some((item) => item.id === step)) return;
  state.activeStep = step;
  $$('#stepNav button').forEach((button) => button.classList.toggle('is-active', button.dataset.step === step));
  renderWorkspace();
}

function renderWorkspace() {
  if (!state.prepared) return;
  $$('#stepNav button').forEach((button) => button.classList.toggle('is-active', button.dataset.step === state.activeStep));
  const renderers = { summary: renderClientSummary, questions: renderQuestions, portfolio: renderPortfolio, stress: renderStress, service: renderServiceRecovery, conversation: renderConversation };
  $('#workspaceBody').innerHTML = renderers[state.activeStep]();
  renderWorkspaceFooter();
  if (state.activeStep === 'stress' && !state.stress) refreshStress();
}

function statusClass(status) {
  if (status === 'ปกติ') return 'state-normal';
  if (status === 'ควรทบทวน') return 'state-review';
  if (status === 'ต้องยืนยัน' || status === 'ต้องดำเนินการ') return 'state-confirm';
  return 'state-unchecked';
}

function renderClientSummary() {
  const client = state.activeClient;
  const kyc = client.kyc || { status: client.dataReady ? 'พร้อมใช้' : 'ต้องยืนยัน', lastReviewed: null, source: 'ข้อมูลสาธิต', clientConfirmed: Boolean(client.dataReady), missingFields: [] };
  const kycDate = kyc.lastReviewed ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' }).format(new Date(`${kyc.lastReviewed}T00:00:00+07:00`)) : 'ไม่ระบุ';
  const guard = !client.dataReady || !client.profileFresh
    ? 'ยังห้ามแนะนำกองทุนหรือจัดพอร์ต เพราะต้องให้ลูกค้ายืนยันข้อมูลก่อน'
    : client.goalReady === false ? 'ข้อมูลเป้าหมายยังไม่ครบ ระบบจึงเตรียมคำถามได้เท่านั้น และยังห้ามคำนวณหรือเสนอพอร์ต'
    : client.mandatory ? 'เคสนี้ต้องแก้เรื่องบริการก่อน ห้ามใช้เป็นจังหวะเสนอผลิตภัณฑ์' : 'ข้อมูลพร้อมสำหรับการเตรียมบทสนทนา แต่ RM และลูกค้ายังต้องอนุมัติก่อนทุกขั้นตอน';
  return `
    <div class="workspace-grid">
      <div>
        <article class="content-card lead-card">
          <span class="lead-label">เหตุผลที่เปิดเคสนี้</span><h3>${escapeHtml(client.reason)}</h3>
          <p>${escapeHtml(client.channelWhy)}</p>
          <div class="objective-box"><strong>สิ่งที่ควรทำตอนนี้</strong><br>${escapeHtml(client.objective)}</div>
          <div class="guard-box"><strong>ขอบเขต:</strong> ${escapeHtml(guard)}</div>
        </article>
        <article class="content-card" style="margin-top:14px">
          <h3>ภาพรวมชีวิตการเงิน</h3>
          <div class="wealth-grid">${client.wealth.map(([name, status, detail]) => `
            <div class="wealth-item"><header><strong>${escapeHtml(name)}</strong><span class="small-pill ${statusClass(status)}">${escapeHtml(status)}</span></header><p>${escapeHtml(detail)}</p></div>
          `).join('')}</div>
        </article>
        ${client.aiSignals?.length ? `<article class="content-card" style="margin-top:14px">
          <h3>AI พบประเด็นจากข้อความที่มีอยู่</h3>
          <p style="font-size:11px">ระบบชี้ประเด็นให้ RM ตรวจ ไม่ถือเป็นข้อเท็จจริงใหม่จนกว่าลูกค้าจะยืนยัน</p>
          ${client.aiSignals.map((signal) => `<div class="signal-card"><strong>${escapeHtml(signal.finding)}</strong><p>${escapeHtml(signal.evidence)}</p><small>ที่มา: ${escapeHtml(signal.source)}</small></div>`).join('')}
        </article>` : ''}
      </div>
      <aside>
        <article class="content-card">
          <h3>KYC & Suitability Gate</h3>
          <p style="font-size:11px">AI ตรวจความครบ ความใหม่ และความขัดกัน แต่ลูกค้าเป็นผู้ยืนยันข้อมูล และระบบไม่อนุมัติ risk profile แทน</p>
          <div class="kyc-gate">
            <div class="kyc-gate-row"><span>สถานะ KYC</span><strong>${escapeHtml(kyc.status)}</strong></div>
            <div class="kyc-gate-row"><span>ทบทวนล่าสุด</span><strong>${escapeHtml(kycDate)} · ${escapeHtml(kyc.source || 'ข้อมูลสาธิต')}</strong></div>
            <div class="kyc-gate-row"><span>Suitability</span><strong>${client.profileFresh ? `ข้อมูลระดับความเสี่ยง ${escapeHtml(client.riskLevel)} อยู่ในกรอบสาธิต` : 'ต้องทบทวนก่อนให้คำแนะนำ'}</strong></div>
            <div class="kyc-gate-row"><span>Goal data</span><strong>${client.goalReady === false ? 'มีข้อมูลเป้าหมายใหม่ที่ต้องให้ลูกค้ายืนยัน' : 'พร้อมใช้ตามข้อมูลที่ลูกค้ายืนยันล่าสุด'}</strong></div>
            <div class="kyc-gate-row"><span>Consent</span><strong>${escapeHtml(kyc.referralConsent || 'ต้องขอก่อนส่งต่อข้อมูล')}</strong></div>
          </div>
          ${kyc.missingFields?.length ? `<div class="kyc-missing"><strong>ยังขาด:</strong> ${kyc.missingFields.map(escapeHtml).join(' · ')}</div>` : ''}
          <div class="guard-box"><strong>Data gate:</strong> ${client.dataReady && client.profileFresh && client.goalReady !== false ? 'เปิดได้เฉพาะข้อเสนอเพื่อทบทวน; ยังต้องผ่าน eligibility และ RM approval' : 'ยังติดต่อเพื่อดูแลได้ แต่ปิดการจัดพอร์ตและการเสนอผลิตภัณฑ์จนกว่าลูกค้าจะยืนยัน'}</div>
        </article>
        <article class="content-card" style="margin-top:14px">
          <h3>ทำไมใช้ช่องทางนี้</h3>
          <div class="why-channel"><span>✓</span><div>${escapeHtml(client.channelWhy)}</div></div>
          <details class="evidence"><summary>ดูที่มาและการจัดลำดับ</summary><p>Mandatory care มาก่อน จากนั้นใช้ client benefit และ complexity เลือกช่องทาง ผลต่อธุรกิจใช้เป็น tie-break เฉพาะเคสที่ผ่านเกณฑ์แล้ว</p></details>
        </article>
        ${client.carePaths?.length ? `<article class="content-card" style="margin-top:14px">
          <h3>เรื่องที่อาจต้องส่งต่อ</h3>
          <p style="font-size:11px">RM คัดกรองและขอความยินยอม ไม่ต้องเลือกผลิตภัณฑ์ที่ตนไม่เชี่ยวชาญ</p>
          <div class="care-path-list">${client.carePaths.map((path) => `<div class="care-path"><strong>${escapeHtml(path.need)}</strong><p>ถาม: ${escapeHtml(path.nextQuestion)}</p><small>${escapeHtml(path.owner)} · ${escapeHtml(path.sla)}<br>${escapeHtml(path.consent)}</small></div>`).join('')}</div>
        </article>` : `<article class="content-card" style="margin-top:14px"><h3>ขอบเขตที่ AI ทำให้</h3><p>${client.mandatory ? 'รวมข้อมูลข้อร้องเรียน ชี้สิ่งที่ต้องยืนยัน และร่างบทสนทนารับผิดชอบ โดยไม่คำนวณหรือเสนอผลิตภัณฑ์' : 'รวมข้อมูลที่เกี่ยวข้อง ชี้สิ่งที่ต้องถาม คำนวณทางเลือก และร่างข้อความ แต่ไม่ตอบแทนลูกค้า ไม่ส่งเอง และไม่ซื้อขายเอง'}</p></article>`}
      </aside>
    </div>`;
}

function renderQuestions() {
  const client = state.activeClient;
  const referralConsentGranted = Boolean(client.kyc?.referralConsentGranted || state.referralConsentByClient[client.id]);
  return `
    <div style="max-width:900px;margin:0 auto">
      <div class="info-strip"><strong>RM ไม่ต้องถามแบบสอบถามทั้งหมดใหม่</strong> — ระบบเลือกเฉพาะข้อมูลที่ขาด เก่า หรือมีผลต่อคำแนะนำ และไม่ตอบแทนลูกค้า</div>
      <div class="question-list">${client.questions.map(([question, why], index) => `
        <article class="question-card"><span class="question-number">${index + 1}</span><div><h3>${escapeHtml(question)}</h3><p>เหตุผลที่ต้องถาม: ${escapeHtml(why)}</p><label><input type="checkbox" data-question-confirmed="${index}"> บันทึกว่าลูกค้ายืนยันแล้ว (เดโม)</label></div></article>
      `).join('')}</div>
      ${client.wealth.some((item) => item[0] === 'ความคุ้มครอง' && item[1] !== 'ปกติ') ? `
        <article class="content-card" style="margin-top:14px"><h3>หากพบความต้องการด้านความคุ้มครอง</h3><p>RM ถามเฉพาะผู้พึ่งพารายได้ ภาระหนี้ และความคุ้มครองที่มีอยู่ จากนั้นกด “ส่งต่อผู้เชี่ยวชาญพร้อมสรุป” โดยไม่เลือกแบบประกันเอง</p></article>` : ''}
      ${client.carePaths?.length ? `<article class="content-card" style="margin-top:14px"><h3>ความยินยอมก่อนส่งต่อ</h3><p>การยินยอมให้พูดคุยไม่ได้แปลว่ายินยอมให้ส่งข้อมูล ระบบจึงแยก consent สำหรับ referral ออกจาก KYC และ suitability</p><label class="consent-check"><input type="checkbox" data-referral-consent ${referralConsentGranted ? 'checked' : ''}> ลูกค้ายืนยันให้ส่งข้อมูลที่จำเป็นพร้อมสรุปไปยังผู้เชี่ยวชาญที่ระบุ</label><div class="guard-box"><strong>Safe gate:</strong> ${referralConsentGranted ? 'เปิดการสร้างงานส่งต่อได้ แต่ยังไม่ถือว่าลูกค้ายอมรับผลิตภัณฑ์' : 'ยังปิดปุ่มส่งต่อจนกว่าลูกค้าจะให้ความยินยอม'}</div></article>` : ''}
    </div>`;
}

function allocationRows(weights, className = '') {
  const labels = Object.fromEntries(state.data.shelf.map((fund) => [fund.asset, fund.displayName]));
  return Object.entries(weights).map(([key, weight]) => `
    <div class="allocation-row ${className}"><span>${escapeHtml(labels[key] || key)}</span><div class="bar"><span style="width:${Math.max(0, Math.min(100, weight * 100))}%"></span></div><b>${fmtPct(weight, 0)}</b></div>
  `).join('');
}

function optionById(id) {
  return state.rebalance?.options?.find((option) => option.id === id);
}

function renderPortfolio() {
  const rebalance = state.rebalance;
  if (rebalance.blocked) return `
    <div style="max-width:760px;margin:0 auto"><article class="content-card lead-card"><span class="lead-label">ยังเปิดขั้นตอนนี้ไม่ได้</span><h3>${escapeHtml(rebalance.reason)}</h3><p>ไปที่ “สิ่งที่ต้องถาม” เพื่อส่งให้ลูกค้ายืนยัน ข้อมูลที่ RM กดเองจะไม่ถูกใช้แทนคำตอบลูกค้า</p></article></div>`;
  const selected = optionById(state.selectedOption) || rebalance.options[0];
  return `
    <div class="workspace-grid">
      <div>
        <article class="content-card">
          <div class="portfolio-header"><div><h3>พอร์ตปัจจุบันเทียบทางเลือกที่เลือก</h3><p>${escapeHtml(rebalance.model.name)} · ${escapeHtml(rebalance.model.riskRange)} · องค์กรต้องยืนยันกรอบก่อนทดลองใช้</p></div><span class="status-pill">ระยะห่างจากกรอบ ${fmtPct(rebalance.gap, 0)}</span></div>
          <div class="metric-row">
            <div class="metric"><span>ผลตอบแทนคาดหมาย/ปี</span><strong>${fmtPct(selected.metrics.expectedReturn)}</strong></div>
            <div class="metric"><span>ความผันผวนคาดหมาย/ปี</span><strong>${fmtPct(selected.metrics.volatility)}</strong></div>
            <div class="metric"><span>สถานะ</span><strong style="font-size:14px">ข้อเสนอเท่านั้น</strong></div>
          </div>
          <div class="legend-inline"><span>พอร์ตปัจจุบัน</span><span>ทางเลือก: ${escapeHtml(selected.name)}</span></div>
          <div class="allocation-list">${allocationRows(rebalance.current.weights)}${allocationRows(selected.weights, 'target')}</div>
          <details class="evidence"><summary>ระบบสร้างกรอบนี้จากอะไร</summary><p>${rebalance.model.selectionReasons?.map(escapeHtml).join(' · ') || 'ใช้ข้อมูลเป้าหมาย สภาพคล่อง และขอบเขตความเสี่ยงที่ลูกค้ายืนยัน'}</p></details>
        </article>
        ${rebalance.model.buckets?.length ? `<article class="content-card" style="margin-top:14px">
          <h3>แบ่งเงินตามหน้าที่ก่อนเลือกกองทุน</h3>
          <div class="bucket-grid">${rebalance.model.buckets.map((bucket) => `<div class="bucket-card"><strong>${escapeHtml(bucket.name)}</strong><b>${fmtBaht(bucket.amount, true)}</b><p>${escapeHtml(bucket.template)} · ${fmtPct(bucket.share, 0)} ของพอร์ต</p></div>`).join('')}</div>
          <div class="guard-box">คะแนนความเสี่ยงเป็นเพียงเพดานหนึ่ง ระบบยังใช้วันใช้เงิน เงินสำรอง ความสามารถรับขาดทุน และสกุลเงินของเป้าหมาย</div>
        </article>` : ''}
        <article class="content-card" style="margin-top:14px">
          <h3>กองทุนไทยที่ทำหน้าที่ในแผน</h3>
          <p style="font-size:11px">เป็นประเภทกองทุนสำหรับกรณีศึกษา ไม่ใช่รายชื่อผลิตภัณฑ์จริง ก่อนใช้จริงต้องจับคู่กับรายการที่องค์กรอนุมัติและข้อมูล ก.ล.ต. ล่าสุด</p>
          <div class="fund-grid">${state.data.shelf.map((fund) => `
            <div class="fund-card"><strong>${escapeHtml(fund.displayName)}</strong><p>${escapeHtml(fund.role)}</p><div class="fund-meta"><span class="small-pill">ระดับความเสี่ยงตามเอกสารกองทุน ${escapeHtml(fund.riskLevel)}</span></div><details><summary>คำอธิบายที่ใช้คุยกับลูกค้า</summary><p><b>ประโยชน์:</b> ${escapeHtml(fund.benefit)}</p><p><b>ความเสี่ยงหลัก:</b> ${escapeHtml(fund.mainRisk)}</p><p><b>เหมาะเมื่อ:</b> ${escapeHtml(fund.suitableFor)}</p><p><b>ไม่เหมาะเมื่อ:</b> ${escapeHtml(fund.notFor)}</p><p><b>ประโยคช่วยอธิบาย:</b> ${escapeHtml(fund.talkingPoint)}</p></details></div>
          `).join('')}</div>
        </article>
      </div>
      <aside>
        <article class="content-card"><h3>ทางเลือกที่เสนอ</h3><div class="option-list">${rebalance.options.map((option) => `
          <label class="option-card ${option.recommended ? 'is-recommended' : ''}"><header><div><h4>${escapeHtml(option.name)}</h4>${option.recommended ? '<span class="small-pill state-review">แนะนำให้คุยก่อน</span>' : ''}</div><input type="radio" name="rebalanceOption" value="${escapeHtml(option.id)}" ${option.id === state.selectedOption ? 'checked' : ''}></header><p>${escapeHtml(option.description)}</p></label>
        `).join('')}</div></article>
        <article class="content-card" style="margin-top:14px"><h3>รายการที่ระบบคำนวณ</h3>${selected.trades.length ? `<div class="checklist">${selected.trades.slice(0,6).map((trade) => `<label><span class="small-pill ${trade.direction === 'buy' ? 'state-normal' : 'state-review'}">${trade.direction === 'buy' ? 'ซื้อ' : 'ขาย'}</span><span>${escapeHtml(trade.label)} <strong>${fmtBaht(Math.abs(trade.deltaBaht))}</strong></span></label>`).join('')}</div>` : '<p>ไม่มีรายการซื้อขาย</p>'}<div class="guard-box">${escapeHtml(rebalance.executionMessage)}</div></article>
      </aside>
    </div>`;
}

async function refreshStress() {
  $('#workspaceBody').innerHTML = '<div class="empty-state">กำลังคำนวณผลกระทบพอร์ตและเป้าหมาย 5,000 เส้นทาง…</div>';
  try {
    state.stress = await loadStress(state.activeClient.id, state.scenarioId);
    renderWorkspace();
  } catch (error) {
    $('#workspaceBody').innerHTML = `<div class="empty-state">คำนวณไม่สำเร็จ: ${escapeHtml(error.message)}</div>`;
  }
}

function renderStress() {
  const scenarios = state.data.scenarios;
  if (!state.stress) return '<div class="empty-state">กำลังเตรียมสถานการณ์…</div>';
  const result = state.stress;
  return `
    <div style="max-width:1050px;margin:0 auto">
      <div class="scenario-picker">${scenarios.map((scenario) => `<button type="button" class="scenario-button ${scenario.id === state.scenarioId ? 'is-active' : ''}" data-scenario="${escapeHtml(scenario.id)}"><strong>${escapeHtml(scenario.plainName)}</strong><small>${escapeHtml(scenario.horizon)}</small></button>`).join('')}</div>
      <div class="stress-result">
        <article class="loss-box"><p>พอร์ตปัจจุบันอาจลดลงทันที</p><strong>${fmtBaht(result.current.lossBaht, true)}</strong><small>${fmtPct(result.current.shockReturn)} ของพอร์ต · เป็นเหตุการณ์สมมติ ไม่ใช่การคาดการณ์</small></article>
        <article class="response-level"><span class="level">${escapeHtml(result.response.label)}</span><h3>${escapeHtml(result.response.action)}</h3><p><strong>ปรับพอร์ตหรือไม่:</strong> ${escapeHtml(result.response.trade)}</p></article>
      </div>
      <article class="content-card" style="margin-top:14px">
        <h3>ตัวเลขที่ RM ใช้อธิบายได้</h3>
        <table class="comparison-table"><thead><tr><th>ผลลัพธ์</th><th>พอร์ตปัจจุบัน</th><th>ปรับครึ่งหนึ่งของส่วนที่เบน</th></tr></thead><tbody>
          <tr><td>มูลค่าพอร์ตหลังเหตุการณ์</td><td>${fmtBaht(result.current.valueAfterShock, true)}</td><td>${fmtBaht(result.candidate.valueAfterShock, true)}</td></tr>
          <tr><td>ขาดทุนทันที</td><td>${fmtBaht(result.current.lossBaht, true)}</td><td>${fmtBaht(result.candidate.lossBaht, true)}</td></tr>
          <tr><td>โอกาสไปถึง “${escapeHtml(state.activeClient.goal.name)}”</td><td>${fmtPct(result.current.goal.probability, 0)}</td><td>${fmtPct(result.candidate.goal.probability, 0)}</td></tr>
          <tr><td>ช่วงผลลัพธ์กึ่งกลาง 90% (P5-P95)</td><td>${fmtBaht(result.current.goal.p05, true)} – ${fmtBaht(result.current.goal.p95, true)}</td><td>${fmtBaht(result.candidate.goal.p05, true)} – ${fmtBaht(result.candidate.goal.p95, true)}</td></tr>
        </tbody></table>
        <div class="guard-box"><strong>ข้อสรุป:</strong> ${escapeHtml(result.tradeoff)}</div>
        ${result.candidate.recommendedForScenario ? `<div class="candidate-trades"><h3>ถ้าลูกค้ายืนยันว่าจะลดความเสี่ยง</h3><p>รายการด้านล่างมาจากส่วนที่พอร์ตเบน ไม่ได้มาจากพาดหัวข่าว และยังไม่ใช่คำสั่งซื้อขาย</p><div class="checklist">${result.candidate.trades.slice(0,6).map((trade) => `<label><span class="small-pill ${trade.direction === 'buy' ? 'state-normal' : 'state-review'}">${trade.direction === 'buy' ? 'ซื้อ' : 'ขาย'}</span><span>${escapeHtml(trade.label)} <strong>${fmtBaht(Math.abs(trade.deltaBaht))}</strong></span></label>`).join('')}</div></div>` : '<div class="info-strip"><strong>ยังไม่สร้างรายการซื้อขาย</strong> — เพราะทางเลือกที่ทดสอบยังไม่ได้ทำให้ความเสียหายและเป้าหมายดีขึ้นพร้อมกัน</div>'}
        <details class="evidence"><summary>ดูค่าความเสียหายรายสินทรัพย์และวิธีคำนวณ</summary><table class="comparison-table"><tbody>${result.shocks.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${fmtPct(item.shock)}</td></tr>`).join('')}</tbody></table><p>เงินในเป้าหมายเริ่มต้น ${fmtBaht(result.current.goal.currentCapital)} · เงินเติมต่อปี ${fmtBaht(result.current.goal.annualContribution)} · ${escapeHtml(result.methodology)} · ${escapeHtml(result.scenario.calibration)}</p></details>
      </article>
    </div>`;
}

function renderConversation() {
  const draft = state.prepared.draft;
  return `
    <div class="conversation-card">
      <div class="info-strip"><strong>AI ร่างจากข้อมูลและผลคำนวณที่แสดงแล้ว</strong> — RM ต้องอ่าน แก้ไข และเลือกว่าจะใช้หรือไม่ ระบบไม่ส่งเอง</div>
      <div class="script-block"><span>เริ่มบทสนทนา</span><p>${escapeHtml(draft.opening)}</p></div>
      <div class="script-block"><span>ประเด็นอธิบาย</span><div class="checklist">${draft.explain.map((item) => `<label><input type="checkbox"><span>${escapeHtml(item)}</span></label>`).join('')}</div></div>
      <div class="script-block"><span>ปิดบทสนทนา</span><p>${escapeHtml(draft.close)}</p></div>
      <div class="guard-box">AI เตรียมข้อความจากข้อมูลที่แสดงในเคส RM ต้องอ่าน แก้ และอนุมัติก่อน ระบบไม่ส่งเอง</div>
    </div>`;
}

function renderServiceRecovery() {
  const client = state.activeClient;
  return `
    <div style="max-width:820px;margin:0 auto">
      <div class="info-strip"><strong>ปิดการเสนอผลิตภัณฑ์ในเคสนี้</strong> — เป้าหมายเดียวคือแก้ปัญหาและรักษา SLA</div>
      <article class="content-card lead-card">
        <span class="lead-label">เจ้าของเรื่อง</span><h3>RM คุณพลอย + ทีมดูแลลูกค้า</h3>
        <p>${escapeHtml(client.reason)}</p>
        <div class="service-timeline">
          <div><span>1</span><strong>โทรรับผิดชอบ</strong><small>${escapeHtml(client.due)}</small></div>
          <div><span>2</span><strong>ยืนยันผลลัพธ์ที่ลูกค้าต้องการ</strong><small>บันทึกคำลูกค้าโดยตรง</small></div>
          <div><span>3</span><strong>ส่งเจ้าของงานและเวลาตอบกลับ</strong><small>สร้างงานในระบบติดตามลูกค้า</small></div>
          <div><span>4</span><strong>ปิดวงกับลูกค้า</strong><small>ลูกค้ายืนยันว่าได้รับการแก้ไข</small></div>
        </div>
        <div class="guard-box">ห้ามเปิดหน้าจัดพอร์ต ห้ามเสนอขายต่อเนื่อง และห้ามใช้ข้อร้องเรียนเป็นจังหวะขาย</div>
      </article>
    </div>`;
}

function renderWorkspaceFooter() {
  const footer = $('#workspaceFooter');
  const steps = workflowFor(state.activeClient);
  const index = steps.findIndex((step) => step.id === state.activeStep);
  const next = steps[index + 1];
  const parts = [];
  if (state.activeStep === 'portfolio') parts.push('<button class="secondary-button" type="button" data-demo-action="save-proposal">บันทึกทางเลือกไว้คุยกับลูกค้า</button>');
  if (state.activeStep === 'questions' && state.activeClient.channel === 'confirm') parts.push('<button class="secondary-button" type="button" data-demo-action="request">บันทึกรายการที่ต้องขอ</button>');
  if (next) {
    const nextLabel = state.activeStep === 'summary' ? 'ไปขั้นตอนถัดไป' : next.label;
    parts.push(`<button class="primary-button ${state.activeStep === 'summary' ? 'orange' : ''}" type="button" data-go-step="${escapeHtml(next.id)}">${escapeHtml(nextLabel)}</button>`);
  } else if (state.activeClient.mandatory) {
    parts.push('<button class="primary-button orange" type="button" data-demo-action="complete-service">บันทึกการรับผิดชอบและสร้างงานติดตาม</button>');
  } else if (state.activeClient.channel === 'message') {
    parts.push('<button class="primary-button orange" type="button" data-demo-action="approve-message">อนุมัติข้อความส่วนบุคคล</button>');
  } else if (state.activeClient.channel === 'confirm') {
    parts.push('<button class="primary-button orange" type="button" data-demo-action="send-request">อนุมัติส่งคำขอยืนยัน</button>');
  } else {
    if (state.activeClient.carePaths?.length) {
      const consentGranted = Boolean(state.activeClient.kyc?.referralConsentGranted || state.referralConsentByClient[state.activeClient.id]);
      parts.push(`<button class="secondary-button" type="button" data-demo-action="handoff" ${consentGranted ? '' : 'disabled aria-disabled="true" title="ต้องให้ลูกค้ายืนยัน consent ก่อน"'}>${consentGranted ? 'สร้างงานส่งต่อพร้อมเจ้าของและ SLA' : 'รอความยินยอมก่อนส่งต่อ'}</button>`);
    }
    parts.push('<button class="primary-button orange" type="button" data-demo-action="complete">บันทึกผลการติดต่อ</button>');
  }
  footer.innerHTML = parts.join('');
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 2400);
}

document.addEventListener('click', async (event) => {
  const nav = event.target.closest('[data-view]');
  if (nav) { setView(nav.dataset.view); return; }
  const clientButton = event.target.closest('[data-open-client]');
  if (clientButton) { await openClient(clientButton.dataset.openClient); return; }
  const stepButton = event.target.closest('[data-step], [data-go-step]');
  if (stepButton) { setStep(stepButton.dataset.step || stepButton.dataset.goStep); return; }
  const scenarioButton = event.target.closest('[data-scenario]');
  if (scenarioButton) { state.scenarioId = scenarioButton.dataset.scenario; state.stress = null; await refreshStress(); return; }
  const action = event.target.closest('[data-demo-action]');
  if (action) {
    const messages = {
      request: 'บันทึกคำขอยืนยันแล้ว (เดโม) — ยังไม่ถือว่าลูกค้ายืนยัน',
      'save-proposal': 'บันทึกเป็นข้อเสนอแล้ว — ยังไม่มีการส่งคำสั่งซื้อขาย',
      handoff: 'สร้างงานส่งต่อพร้อมบริบท เจ้าของงาน และเวลาตอบรับแล้ว (เดโม)',
      complete: 'บันทึกผลการติดต่อและสร้างงานติดตามแล้ว (เดโม)',
      'complete-service': 'บันทึกเจ้าของเรื่อง เวลาอัปเดต และงานติดตามแล้ว (เดโม)',
      'approve-message': 'อนุมัติข้อความแล้ว — ระบบพร้อมส่งผ่านช่องทางที่ลูกค้ายินยอม (เดโม)',
      'send-request': 'อนุมัติคำขอยืนยันแล้ว — ยังไม่ถือว่าลูกค้าตอบกลับ (เดโม)',
    };
    showToast(messages[action.dataset.demoAction] || 'บันทึกแล้ว');
  }
});

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-referral-consent]')) {
    state.referralConsentByClient[state.activeClient.id] = event.target.checked;
    renderWorkspaceFooter();
    return;
  }
  if (event.target.name === 'rebalanceOption') {
    state.selectedOption = event.target.value;
    renderWorkspace();
  }
});

$('#clientSearch').addEventListener('input', (event) => renderClients(event.target.value));
$('#dataStatusButton').addEventListener('click', () => {
  setView('insights');
  if (window.finAiInsights?.openTab) window.finAiInsights.openTab('market');
  else document.dispatchEvent(new CustomEvent('finai:open-insights', { detail: { tab: 'market' } }));
});
$('#closeWorkspace').addEventListener('click', closeClient);
$('#scrim').addEventListener('click', closeClient);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeClient(); });

loadData().catch((error) => {
  document.body.innerHTML = `<main class="app-shell"><div class="empty-state"><h1>เปิดข้อมูลเดโมไม่สำเร็จ</h1><p>${escapeHtml(error.message)}</p><p>รัน <code>npm start</code> แล้วเปิด URL ที่แสดงใน terminal</p></div></main>`;
});
