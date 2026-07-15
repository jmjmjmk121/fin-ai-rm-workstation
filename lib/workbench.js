'use strict';

const { CLIENTS, FOLLOW_UPS, APPROVED_SHELF, MODELS, SCENARIOS, ASSET_LABELS } = require('./case-data');
const { getThaiMarketContext } = require('./setsmart');
const { runStress, proposeRebalance, weightsToArray } = require('./stress');
const { adviceGate, buildClientAnalytics, buildBusinessAnalytics } = require('./analytics');
const {
  ASSET_KEYS, ASSET_LABELS: FRONTIER_LABELS, ANNUAL_EXPECTED_RETURNS, ANNUAL_VOLATILITIES,
  ANNUAL_COVARIANCE, buildEfficientFrontier, generateRandomCloud, portfolioMetrics,
} = require('./frontier');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getClient(clientId) {
  const client = CLIENTS.find((item) => item.id === clientId);
  if (!client) throw Object.assign(new Error('CLIENT_NOT_FOUND'), { statusCode: 404 });
  return clone(client);
}

function priorityRank(client) {
  if (client.mandatory) return 0;
  const benefit = { high: 1, medium: 2, low: 3 }[client.clientBenefit] ?? 4;
  const due = client.due.includes('วันนี้') || client.due.includes('24 ชั่วโมง') ? 0
    : client.due.includes('3 วัน') ? 1
      : client.due.includes('5 วัน') ? 2
        : client.due.includes('7 วัน') ? 3 : 4;
  const complexity = client.channel === 'call' ? 0 : client.channel === 'confirm' ? 1 : 2;
  // AUM is intentionally the final tie-break only. It cannot jump mandatory
  // care, client benefit, due date, or the channel required for safe handling.
  const relationshipTieBreak = Math.min(9.9, client.aum / 5_000_000);
  return 10_000 + benefit * 1_000 + due * 100 + complexity * 10 - relationshipTieBreak;
}

function orderedClients() {
  return CLIENTS.map(clone).sort((a, b) => priorityRank(a) - priorityRank(b));
}

function isDueToday(client) {
  return Boolean(client.mandatory || client.due.includes('วันนี้') || client.due.includes('24 ชั่วโมง'));
}

function summaryCards(clients) {
  const today = clients.filter(isDueToday).length;
  const calls = clients.filter((item) => item.channel === 'call').length;
  const messages = clients.filter((item) => item.channel === 'message').length;
  const confirms = clients.filter((item) => item.channel === 'confirm').length;
  const minutes = clients.reduce((sum, item) => sum + item.callMinutes, 0);
  return [
    { id: 'all', label: 'เรื่องที่ต้องเริ่มวันนี้', value: today, icon: today, tone: 'all', sub: `จากคิวทั้งหมด ${clients.length} เรื่อง` },
    { id: 'call', label: 'RM โทรหรือนัดคุย', value: calls, icon: 'โทร', tone: 'call' },
    { id: 'message', label: 'ส่งข้อความได้', value: messages, icon: 'ส่ง', tone: 'message' },
    { id: 'confirm', label: `เวลารวมประมาณ ${minutes} นาที`, value: confirms, icon: 'ถาม', tone: 'confirm', sub: 'เคสต้องขอข้อมูลก่อน' },
  ];
}

const NEAR_TERM_WEIGHTS = Object.freeze({
  cash: 0.30, thaiGovBond: 0.45, thaiCorpBond: 0.20,
  thaiEquityCore: 0.05, thaiEquityDividend: 0, thaiReit: 0,
});

function addWeighted(target, weights, fraction) {
  for (const key of ASSET_KEYS) target[key] += Number(weights[key] || 0) * fraction;
}

function goalTemplate(client) {
  const years = Number(client.goal.years);
  if (years <= 3) return { id: 'near-term', name: 'เป้าหมายใกล้ใช้เงิน', weights: NEAR_TERM_WEIGHTS };
  if (years <= 5 || client.riskLevel <= 4) return MODELS.preserve;
  if (years <= 10 || client.riskLevel <= 6) return MODELS.balanced;
  return MODELS.growth;
}

function longTermTemplate(client) {
  if (client.riskLevel <= 4) return MODELS.preserve;
  if (client.riskLevel <= 6) return MODELS.balanced;
  return MODELS.growth;
}

function modelFor(client) {
  const reserveAmount = Math.min(client.aum, Math.max(0, Number(client.monthlyExpense || 0) * 6));
  const availableAfterReserve = Math.max(0, client.aum - reserveAmount);
  const goalAmount = Math.min(availableAfterReserve, Math.max(0, Number(client.goal.currentCapital || 0)));
  const longTermAmount = Math.max(0, client.aum - reserveAmount - goalAmount);
  const goalPlan = goalTemplate(client);
  const longTermPlan = longTermTemplate(client);
  const weights = Object.fromEntries(ASSET_KEYS.map((key) => [key, 0]));
  if (client.aum > 0) {
    weights.cash += reserveAmount / client.aum;
    addWeighted(weights, goalPlan.weights, goalAmount / client.aum);
    addWeighted(weights, longTermPlan.weights, longTermAmount / client.aum);
  }
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  for (const key of ASSET_KEYS) weights[key] /= total;
  return {
    id: `case-${client.id}`,
    name: 'กรอบหลายเป้าหมายสำหรับเคสสาธิต',
    riskRange: `ไม่เกินข้อมูลความเสี่ยงระดับ ${client.riskLevel}`,
    weights,
    goalWeights: clone(goalPlan.weights),
    longTermWeights: clone(longTermPlan.weights),
    caseStudyOnly: true,
    buckets: [
      { id: 'reserve', name: 'เงินสำรอง 6 เดือน', amount: reserveAmount, share: reserveAmount / client.aum, template: 'เงินพร้อมใช้' },
      { id: 'goal', name: client.goal.name, amount: goalAmount, share: goalAmount / client.aum, template: goalPlan.name },
      { id: 'long-term', name: 'เงินส่วนที่เหลือ/เป้าหมายระยะยาว', amount: longTermAmount, share: longTermAmount / client.aum, template: longTermPlan.name },
    ],
    selectionReasons: [
      'กันเงินสำรอง 6 เดือนออกก่อน',
      `จับคู่เป้าหมาย “${client.goal.name}” กับเวลาที่เหลือ ${client.goal.years} ปี`,
      `จำกัดความเสี่ยงด้วยข้อมูลลูกค้าระดับ ${client.riskLevel} แต่ไม่ใช้คะแนนนี้เพียงตัวเดียว`,
    ],
  };
}

function conversationDraft(client) {
  if (client.mandatory) {
    return {
      opening: `สวัสดีครับคุณ${client.name.replace(/^คุณ/, '').split(' ')[0]} ผมติดต่อมาเพื่อรับผิดชอบเรื่องที่แจ้งไว้ และขอยืนยันว่าประเด็นสำคัญที่ต้องการให้เราแก้ไขคืออะไรครับ`,
      explain: ['แจ้งเจ้าของเรื่องและเวลาตอบกลับที่ชัดเจน', 'ไม่เสนอผลิตภัณฑ์ระหว่างจัดการข้อร้องเรียน'],
      close: 'ผมจะอัปเดตความคืบหน้าภายในเวลาที่ตกลง และบันทึกสิ่งที่คุณยืนยันไว้ในเคสครับ',
    };
  }
  if (client.channel === 'message') {
    return {
      opening: `สวัสดีครับคุณ${client.name.replace(/^คุณ/, '').split(' ')[0]} ช่วงนี้ตลาดผันผวนและพอร์ตปรับลง แต่จากข้อมูลล่าสุดพอร์ตยังอยู่ในกรอบที่ตกลงกันไว้ครับ`,
      explain: ['เรากำลังติดตามพอร์ตและเป้าหมายให้', 'ยังไม่จำเป็นต้องซื้อขายเพราะข่าวเพียงอย่างเดียว', 'หากแผนใช้เงินหรือความกังวลเปลี่ยน สามารถนัดคุยกับผมได้ทันที'],
      close: 'ต้องการให้ผมโทรสรุปสถานการณ์เพิ่มเติมไหมครับ',
    };
  }
  if (!client.dataReady || !client.profileFresh) {
    return {
      opening: `สวัสดีครับคุณ${client.name.replace(/^คุณ/, '').split(' ')[0]} ผมขอให้ช่วยยืนยันข้อมูลสั้น ๆ ${client.questions.length} ข้อ เพื่อให้คำแนะนำครั้งถัดไปตรงกับสถานการณ์ปัจจุบันครับ`,
      explain: client.questions.map((item) => item[0]),
      close: 'เมื่อได้รับคำยืนยันแล้ว ระบบจึงจะเปิดขั้นตอนทบทวนพอร์ต โดยยังไม่มีการซื้อขายอัตโนมัติครับ',
    };
  }
  return {
    opening: `สวัสดีครับคุณ${client.name.replace(/^คุณ/, '').split(' ')[0]} วันนี้ผมอยากทบทวน ${client.goal.name} และสิ่งที่อาจต้องใช้เงินในช่วงถัดไป เพื่อให้การดูแลไม่ได้มองเฉพาะผลตอบแทนพอร์ตครับ`,
    explain: [client.objective, 'ระบบเตรียมทางเลือกจากกองทุนไทยในกรอบพอร์ตสาธิต แต่จะยังไม่ทำรายการใดจนกว่าลูกค้าจะยืนยัน', 'หากพบเรื่องประกันหรือสินเชื่อ RM จะส่งต่อผู้เชี่ยวชาญพร้อมสรุป ไม่เลือกผลิตภัณฑ์แทน'],
    close: 'ถ้าข้อมูลตรงกัน ผมจะสรุปทางเลือกหลักหนึ่งทาง พร้อมข้อดี ข้อเสีย และผลต่อเป้าหมายให้พิจารณาครับ',
  };
}

function prepareClientCase(clientId) {
  const client = getClient(clientId);
  const model = modelFor(client);
  const rebalance = proposeRebalance(client, model);
  const stress = client.mandatory || rebalance.blocked ? null : runStress(client, SCENARIOS.covid, model.weights, model.goalWeights);
  return {
    client,
    draft: conversationDraft(client),
    rebalance,
    stressPreview: stress,
    orchestration: {
      mode: 'tool-orchestrated-demo',
      statement: 'AI agent จัดลำดับและเรียกเครื่องมือ แต่ตัวเลขมาจาก deterministic quant และทุก action ผ่าน policy/RM approval',
      steps: [
        { id: 1, tool: 'Client 360', plain: 'รวมข้อมูลลูกค้าและวันที่อ้างอิง', status: 'complete' },
        { id: 2, tool: 'Policy check', plain: client.dataReady && client.profileFresh ? 'ข้อมูลพร้อมทบทวน' : 'บล็อกคำแนะนำจนกว่าจะยืนยันข้อมูล', status: 'complete' },
        { id: 3, tool: 'Goal & stress engine', plain: 'คำนวณเป้าหมายและสถานการณ์รุนแรง 5,000 เส้นทาง', status: 'complete' },
        { id: 4, tool: 'Multi-goal allocator', plain: rebalance.blocked ? 'ไม่สร้างพอร์ตเพราะ gate ไม่ผ่าน' : `เทียบกับกรอบ “${model.name}”`, status: 'complete' },
        { id: 5, tool: 'Grounded language', plain: 'ร่างคำอธิบายจาก facts และผลคำนวณข้างต้น', status: 'complete' },
        { id: 6, tool: 'RM approval', plain: 'รอ RM ตรวจและเลือกขั้นตอนถัดไป', status: 'waiting' },
      ],
    },
  };
}

function stressClient(clientId, scenarioId) {
  const client = getClient(clientId);
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) throw Object.assign(new Error('SCENARIO_NOT_FOUND'), { statusCode: 404 });
  const model = modelFor(client);
  return runStress(client, scenario, model.weights, model.goalWeights);
}

function rebalanceClient(clientId) {
  const client = getClient(clientId);
  return proposeRebalance(client, modelFor(client));
}

function buildFrontierPayload(clientId) {
  const frontier = buildEfficientFrontier(ANNUAL_EXPECTED_RETURNS, ANNUAL_COVARIANCE, { pointCount: 41, riskFreeRate: 0.018 });
  const cloud = generateRandomCloud(ANNUAL_EXPECTED_RETURNS, ANNUAL_COVARIANCE, { count: 600, seed: 20260715, riskFreeRate: 0.018 });
  const models = Object.values(MODELS).map((model) => ({
    id: model.id,
    name: model.name,
    weights: model.weights,
    ...portfolioMetrics(weightsToArray(model.weights), ANNUAL_EXPECTED_RETURNS, ANNUAL_COVARIANCE, 0.018),
  }));
  let client = null;
  if (clientId) {
    const record = getClient(clientId);
    const caseStudyModel = modelFor(record);
    const caseStudyMetrics = portfolioMetrics(weightsToArray(caseStudyModel.weights), ANNUAL_EXPECTED_RETURNS, ANNUAL_COVARIANCE, 0.018);
    client = {
      id: record.id,
      name: record.name,
      adviceGate: adviceGate(record),
      current: { weights: record.portfolio, ...portfolioMetrics(weightsToArray(record.portfolio), ANNUAL_EXPECTED_RETURNS, ANNUAL_COVARIANCE, 0.018) },
      caseStudyModel: { ...caseStudyModel, ...caseStudyMetrics },
    };
  }
  return {
    assumptions: {
      assetKeys: ASSET_KEYS,
      assetLabels: FRONTIER_LABELS,
      expectedReturns: ANNUAL_EXPECTED_RETURNS,
      volatilities: ANNUAL_VOLATILITIES,
      covariance: ANNUAL_COVARIANCE,
      units: 'annual decimal return/volatility',
      status: 'illustrative case-study CMA - not fitted from a few market days and not yet organization-approved',
    },
    frontier: frontier.points.map((point) => ({ expectedReturn: point.expectedReturn, volatility: point.volatility, weights: point.weights })),
    globalMinimumVariance: frontier.globalMinimumVariance,
    cloud: cloud.map((point) => ({ expectedReturn: point.expectedReturn, volatility: point.volatility })),
    models,
    client,
    constraints: ['long-only', 'weights sum to 100%', 'same expected returns/covariance for every point', 'no asset-class bounds', 'no CML displayed'],
    referenceStatus: 'Unconstrained analytical reference within the stated long-only simplex; not a recommendation or an organization-approved portfolio set',
    policyNote: 'Production model portfolios may include shelf, concentration, liquidity, suitability, tax, fee and governance constraints that are intentionally absent from this reference curve',
  };
}

function buildBusinessAnalyticsPayload() {
  return buildBusinessAnalytics(CLIENTS.map(clone), FOLLOW_UPS.map(clone));
}

function buildClientAnalyticsPayload(clientId) {
  const client = getClient(clientId);
  return buildClientAnalytics(client, modelFor(client));
}

async function getWorkbench() {
  const clients = orderedClients();
  const market = await getThaiMarketContext();
  return {
    generatedAt: new Date().toISOString(),
    caseStudy: 'Industry-wide RM workflow applied to the KKP EDGE case study',
    clients,
    todayCount: clients.filter(isDueToday).length,
    followups: clone(FOLLOW_UPS),
    summary: summaryCards(clients),
    shelf: clone(APPROVED_SHELF),
    models: clone(MODELS),
    scenarios: Object.values(SCENARIOS).map(clone),
    market,
    sources: [
      { name: 'Client 360 / holdings / KYC', role: 'ข้อมูลลูกค้า', status: 'Synthetic case-study fixture' },
      { name: 'FIN-AI case-study product shelf', role: 'สิทธิ์และผลิตภัณฑ์ที่เสนอได้', status: 'Case-study configuration - the organization must confirm' },
      { name: 'SEC Fund Daily Info / Factsheet', role: 'NAV, risk, fee, liquidity, factsheet', status: 'Fixture in demo; API-ready' },
      { name: 'SET SMART', role: 'Thai listed-market proxies and context', status: market.label },
    ],
    claims: {
      noAutoSend: true,
      noAutoTrade: true,
      figuresIllustrative: true,
      businessValueTieBreakOnly: true,
    },
  };
}

module.exports = {
  getClient, orderedClients, getWorkbench, prepareClientCase, stressClient, rebalanceClient, buildFrontierPayload,
  buildBusinessAnalyticsPayload, buildClientAnalyticsPayload,
  conversationDraft, modelFor, priorityRank, isDueToday,
};
