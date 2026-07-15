'use strict';

const { createHash } = require('node:crypto');

const DEFAULT_DEMO_BOOK_SEED = 'fin-ai-rm-book-v3-fixed-2026-07-15';
const DEMO_BOOK_DATASET_ID = 'fin-ai-client-book-demo-v3';
const DEFAULT_AS_OF = '2026-07-15';
const DEMO_DATA_LABEL = 'ข้อมูลสาธิต (Fixture/Demo)';

const RM_NAMES = Object.freeze([
  'RM คุณพลอย',
  'RM คุณนนท์',
  'RM คุณเมย์',
  'RM คุณภัทร',
  'RM คุณอิง',
]);

const GENERATED_CLIENT_NAMES = Object.freeze([
  'คุณกมลชนก ร.', 'คุณชลธิชา ม.', 'คุณณัฐดนัย ว.', 'คุณปาริชาติ ส.', 'คุณรวิศ ก.',
  'คุณลลิตา พ.', 'คุณศุภชัย น.', 'คุณอัญชลี ต.', 'คุณธีรภัทร จ.', 'คุณพิมพ์ชนก ล.',
  'คุณอธิป ค.', 'คุณวราภรณ์ ด.', 'คุณกฤตภาส ห.', 'คุณชนากานต์ บ.', 'คุณภูริทัต อ.',
  'คุณมณีรัตน์ ย.', 'คุณศรัณย์ ฟ.', 'คุณสุภาวดี ข.', 'คุณธนกฤต ช.', 'คุณนภัสสร ป.',
  'คุณวายุ ก.', 'คุณวรินดา ง.', 'คุณภูวดล ถ.', 'คุณจิราพร ศ.', 'คุณสิรวิชญ์ ม.',
  'คุณปวีณา ร.', 'คุณอัครเดช พ.', 'คุณเมธาวี ว.', 'คุณกรวิชญ์ ส.', 'คุณรินรดา จ.',
]);

const GOAL_TEMPLATES = Object.freeze([
  Object.freeze({ type: 'EMERGENCY_RESERVE', name: 'เงินสำรองฉุกเฉิน', years: 1, targetMultiple: 1.20 }),
  Object.freeze({ type: 'EDUCATION', name: 'ค่าเรียนบุตร', years: 5, targetMultiple: 1.65 }),
  Object.freeze({ type: 'RETIREMENT', name: 'เกษียณ', years: 18, targetMultiple: 2.30 }),
  Object.freeze({ type: 'HOME', name: 'ซื้อบ้าน', years: 7, targetMultiple: 1.75 }),
  Object.freeze({ type: 'HEALTHCARE', name: 'ค่ารักษาพยาบาล', years: 10, targetMultiple: 1.50 }),
  Object.freeze({ type: 'WEALTH_GROWTH', name: 'เพิ่มความมั่งคั่งระยะยาว', years: 12, targetMultiple: 2.10 }),
  Object.freeze({ type: 'LEGACY', name: 'ส่งต่อทรัพย์สินให้ครอบครัว', years: 20, targetMultiple: 2.50 }),
]);

function fund(masterFundId, shareClass, nameTh, assetClass, currencyExposure) {
  const shareClassId = `${masterFundId}-${shareClass}`;
  return Object.freeze({
    fundId: shareClassId,
    shareClassId,
    masterFundId,
    shareClass,
    nameTh: `${nameTh} ชนิด${shareClass === 'A' ? 'สะสมมูลค่า' : shareClass === 'D' ? 'จ่ายเงินปันผล' : 'เพื่อการออม'}`,
    assetClass,
    registrationCountryCode: 'TH',
    thaiRegistered: true,
    currency: 'THB',
    currencyExposure: Object.freeze({ ...currencyExposure }),
    returnType: 'NAV_RETURN',
    isTotalReturn: false,
    dataMode: 'FIXTURE',
    dataLabel: DEMO_DATA_LABEL,
    isSynthetic: true,
  });
}

const DEMO_FUND_SHELF = Object.freeze([
  fund('TH-DEMO-MM-01', 'A', 'กองทุนตลาดเงินไทยจำลอง', 'MONEY_MARKET', { THB: 1 }),
  fund('TH-DEMO-MM-01', 'R', 'กองทุนตลาดเงินไทยจำลอง', 'MONEY_MARKET', { THB: 1 }),
  fund('TH-DEMO-BDST-02', 'A', 'กองทุนตราสารหนี้ระยะสั้นจำลอง', 'FIXED_INCOME', { THB: 1 }),
  fund('TH-DEMO-BDST-02', 'R', 'กองทุนตราสารหนี้ระยะสั้นจำลอง', 'FIXED_INCOME', { THB: 1 }),
  fund('TH-DEMO-BDGOV-03', 'A', 'กองทุนพันธบัตรรัฐบาลไทยจำลอง', 'FIXED_INCOME', { THB: 1 }),
  fund('TH-DEMO-BDCORP-04', 'A', 'กองทุนตราสารหนี้เอกชนไทยจำลอง', 'FIXED_INCOME', { THB: 1 }),
  fund('TH-DEMO-BAL-05', 'A', 'กองทุนผสมเชิงรับจำลอง', 'BALANCED', { THB: 0.85, USD: 0.15 }),
  fund('TH-DEMO-BAL-05', 'D', 'กองทุนผสมเชิงรับจำลอง', 'BALANCED', { THB: 0.85, USD: 0.15 }),
  fund('TH-DEMO-THEQ-06', 'A', 'กองทุนหุ้นไทยจำลอง', 'THAI_EQUITY', { THB: 1 }),
  fund('TH-DEMO-THEQ-06', 'D', 'กองทุนหุ้นไทยจำลอง', 'THAI_EQUITY', { THB: 1 }),
  fund('TH-DEMO-GLH-07', 'A', 'กองทุนหุ้นโลกป้องกันค่าเงินจำลอง', 'GLOBAL_EQUITY', { THB: 0.9, USD: 0.1 }),
  fund('TH-DEMO-GLU-08', 'A', 'กองทุนหุ้นโลกไม่ป้องกันค่าเงินจำลอง', 'GLOBAL_EQUITY', { THB: 0.2, USD: 0.7, OTHER: 0.1 }),
  fund('TH-DEMO-GLU-08', 'D', 'กองทุนหุ้นโลกไม่ป้องกันค่าเงินจำลอง', 'GLOBAL_EQUITY', { THB: 0.2, USD: 0.7, OTHER: 0.1 }),
  fund('TH-DEMO-GOLD-09', 'A', 'กองทุนทองคำจำลอง', 'REAL_ASSET', { THB: 0.15, USD: 0.85 }),
  fund('TH-DEMO-PROP-10', 'A', 'กองทุนอสังหาริมทรัพย์ไทยจำลอง', 'REAL_ASSET', { THB: 1 }),
  fund('TH-DEMO-ESG-11', 'A', 'กองทุนหุ้นไทยยั่งยืนจำลอง', 'THAI_EQUITY', { THB: 1 }),
  fund('TH-DEMO-RET-12', 'R', 'กองทุนผสมเพื่อเกษียณจำลอง', 'BALANCED', { THB: 0.7, USD: 0.25, OTHER: 0.05 }),
]);

function deepClone(value) {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(deepClone);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, deepClone(child)]));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function seedNumber(seed) {
  let hash = 0x811c9dc5;
  for (const character of String(seed)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = seedNumber(seed);
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function stableOpaqueId(prefix, seed, scope) {
  const digest = createHash('sha256').update(`${seed}|${prefix}|${scope}`, 'utf8').digest('hex').slice(0, 20).toUpperCase();
  return `${prefix}_${digest}`;
}

function integer(random, minimum, maximum) {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function roundMoney(value) {
  return Math.max(0, Math.round(value / 100) * 100);
}

function numericValue(value, fallback = 0) {
  const candidate = value && typeof value === 'object' && Number.isFinite(value.value) ? value.value : value;
  return Number.isFinite(candidate) ? candidate : fallback;
}

function isoDate(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`invalid date: ${value}`);
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${isoDate(value)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addYears(value, years) {
  const date = new Date(`${isoDate(value)}T00:00:00.000Z`);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}

function normalizeExposure(exposure) {
  const entries = Object.entries(exposure || {}).filter(([, value]) => Number.isFinite(value) && value >= 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return { THB: 1 };
  return Object.fromEntries(entries.map(([currency, value]) => [currency, Number((value / total).toFixed(8))]));
}

function inferExposure(holding) {
  if (holding.currencyExposure) return normalizeExposure(holding.currencyExposure);
  const text = `${holding.assetClass || ''} ${holding.name || holding.nameTh || ''}`.toUpperCase();
  if (text.includes('GLOBAL') || text.includes('ต่างประเทศ')) return { THB: 0.2, USD: 0.7, OTHER: 0.1 };
  if (text.includes('GOLD') || text.includes('ทอง')) return { THB: 0.15, USD: 0.85 };
  return { THB: 1 };
}

function normalizeBaseHolding(holding, clientId, index, seed, asOf) {
  const value = numericValue(holding.value, numericValue(holding.marketValue, 250_000));
  const fundId = String(holding.fundId || holding.shareClassId || stableOpaqueId('fnd', seed, `${clientId}:${index}`));
  return {
    ...deepClone(holding),
    holdingId: holding.holdingId || stableOpaqueId('hld', seed, `${clientId}:${fundId}`),
    fundId,
    shareClassId: holding.shareClassId || fundId,
    masterFundId: String(holding.masterFundId || fundId),
    nameTh: holding.nameTh || holding.name || 'กองทุนไทยจำลอง',
    value: roundMoney(value),
    currency: 'THB',
    registrationCountryCode: 'TH',
    thaiRegistered: true,
    navAsOf: holding.navAsOf || asOf,
    currencyExposure: inferExposure(holding),
    returnType: 'NAV_RETURN',
    isTotalReturn: false,
    dataMode: 'FIXTURE',
    dataLabel: DEMO_DATA_LABEL,
    isSynthetic: true,
  };
}

function buildHoldings({ baseSnapshot, clientId, clientIndex, seed, asOf, random }) {
  const merged = new Map();
  for (const [index, holding] of (baseSnapshot && baseSnapshot.holdings || []).entries()) {
    const normalized = normalizeBaseHolding(holding, clientId, index, seed, asOf);
    if (merged.has(normalized.fundId)) merged.get(normalized.fundId).value += normalized.value;
    else merged.set(normalized.fundId, normalized);
  }

  const target = Math.min(12, Math.max(5, merged.size + 2, integer(random, 5, 12)));
  const pairedMasters = ['TH-DEMO-MM-01', 'TH-DEMO-BDST-02', 'TH-DEMO-BAL-05', 'TH-DEMO-THEQ-06', 'TH-DEMO-GLU-08'];
  const pairMaster = pairedMasters[clientIndex % pairedMasters.length];
  const rotated = [
    ...DEMO_FUND_SHELF.filter((item) => item.masterFundId === pairMaster),
    ...DEMO_FUND_SHELF.slice(clientIndex % DEMO_FUND_SHELF.length),
    ...DEMO_FUND_SHELF.slice(0, clientIndex % DEMO_FUND_SHELF.length),
  ];
  for (const template of rotated) {
    if (merged.size >= target) break;
    if (merged.has(template.fundId)) continue;
    const value = roundMoney(integer(random, 2, 40) * 125_000);
    merged.set(template.fundId, {
      ...deepClone(template),
      holdingId: stableOpaqueId('hld', seed, `${clientId}:${template.fundId}`),
      value,
      units: integer(random, 10_000, 450_000),
      navAsOf: asOf,
      sourceRefs: [`fixture://${DEMO_BOOK_DATASET_ID}/holdings/${clientId}/${template.fundId}`],
    });
  }
  return [...merged.values()].slice(0, 12);
}

function aggregateCurrencyExposure(holdings) {
  const total = holdings.reduce((sum, holding) => sum + holding.value, 0);
  const values = {};
  for (const holding of holdings) {
    for (const [currency, weight] of Object.entries(holding.currencyExposure)) {
      values[currency] = (values[currency] || 0) + holding.value * weight;
    }
  }
  if (total <= 0) return { THB: 1 };
  return Object.fromEntries(Object.entries(values).map(([currency, value]) => [currency, Number((value / total).toFixed(8))]));
}

function normalizeGoal(goal) {
  return {
    goalId: goal.goalId,
    type: goal.type || 'WEALTH_GROWTH',
    name: goal.name || 'เป้าหมายการเงิน',
    targetAmount: numericValue(goal.targetAmount, numericValue(goal.target, 1_000_000)),
    targetDate: goal.targetDate || null,
    currentFunding: numericValue(goal.currentFunding, 0),
    baseSuccessProbability: numericValue(goal.baseSuccessProbability, NaN),
    stressSuccessProbability: numericValue(goal.stressSuccessProbability, NaN),
    requiredMonthlyContribution: numericValue(goal.requiredMonthlyContribution, NaN),
    nextReview: goal.nextReview || null,
    preservedFromBase: true,
  };
}

function buildGoals({ baseLedger, clientId, clientIndex, endBalance, seed, asOf, random }) {
  const existing = (baseLedger && baseLedger.goals || []).slice(0, 4).map(normalizeGoal);
  const targetCount = Math.min(4, Math.max(2, existing.length, integer(random, 2, 4)));
  const goals = [...existing];
  const usedNames = new Set(goals.map((goal) => goal.name));
  for (let offset = 0; goals.length < targetCount && offset < GOAL_TEMPLATES.length * 2; offset += 1) {
    const template = GOAL_TEMPLATES[(clientIndex + offset) % GOAL_TEMPLATES.length];
    if (usedNames.has(template.name)) continue;
    const goalIndex = goals.length;
    goals.push({
      goalId: stableOpaqueId('gol', seed, `${clientId}:${goalIndex}:${template.type}`),
      ...template,
      targetDate: addYears(asOf, template.years),
      currentFunding: 0,
      preservedFromBase: false,
    });
    usedNames.add(template.name);
  }

  const maximumAssigned = roundMoney(endBalance * 0.92);
  let existingAssigned = goals.reduce((sum, goal) => sum + (goal.preservedFromBase ? goal.currentFunding : 0), 0);
  if (existingAssigned > maximumAssigned && existingAssigned > 0) {
    const scale = maximumAssigned / existingAssigned;
    for (const goal of goals) if (goal.preservedFromBase) goal.currentFunding = roundMoney(goal.currentFunding * scale);
    existingAssigned = goals.reduce((sum, goal) => sum + (goal.preservedFromBase ? goal.currentFunding : 0), 0);
  }
  const generated = goals.filter((goal) => !goal.preservedFromBase);
  let remaining = Math.max(0, maximumAssigned - existingAssigned);
  if (generated.length === 0 && existingAssigned === 0) {
    remaining = maximumAssigned;
    generated.push(...goals);
  }
  const weights = generated.map(() => 0.5 + random());
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  generated.forEach((goal, index) => {
    goal.currentFunding = roundMoney(remaining * weights[index] / totalWeight);
  });

  return goals.map((goal, index) => {
    const funding = roundMoney(goal.currentFunding);
    const template = GOAL_TEMPLATES.find((item) => item.type === goal.type) || GOAL_TEMPLATES[(clientIndex + index) % GOAL_TEMPLATES.length];
    const targetAmount = roundMoney(Math.max(goal.targetAmount || 0, funding * (goal.targetMultiple || template.targetMultiple), 500_000));
    const fundedRatio = targetAmount === 0 ? 1 : funding / targetAmount;
    const baseSuccess = Number.isFinite(goal.baseSuccessProbability)
      ? goal.baseSuccessProbability
      : Math.min(0.96, Math.max(0.28, fundedRatio + 0.24));
    const stressSuccess = Number.isFinite(goal.stressSuccessProbability)
      ? goal.stressSuccessProbability
      : Math.max(0.08, baseSuccess - (0.12 + random() * 0.12));
    const requiredMonthly = Number.isFinite(goal.requiredMonthlyContribution)
      ? goal.requiredMonthlyContribution
      : roundMoney(Math.max(0, targetAmount - funding) / Math.max(12, (template.years || 5) * 12));
    return {
      goalId: goal.goalId || stableOpaqueId('gol', seed, `${clientId}:${index}:${goal.type}`),
      type: goal.type,
      name: goal.name,
      targetAmount,
      targetDate: goal.targetDate || addYears(asOf, template.years || 5),
      currency: 'THB',
      currentFunding: funding,
      fundedRatio: Number(fundedRatio.toFixed(8)),
      baseSuccessProbability: Number(baseSuccess.toFixed(8)),
      stressSuccessProbability: Number(stressSuccess.toFixed(8)),
      shortfall: Math.max(0, targetAmount - funding),
      requiredMonthlyContribution: requiredMonthly,
      nextReview: goal.nextReview || addDays(asOf, 90 + index * 30),
      dataMode: 'FIXTURE',
      dataLabel: DEMO_DATA_LABEL,
      isSynthetic: true,
    };
  });
}

function buildCashFlows({ clientId, endBalance, seed, asOf, random }) {
  const types = ['CONTRIBUTION', 'CONTRIBUTION', 'WITHDRAWAL', 'CONTRIBUTION', 'WITHDRAWAL', 'CONTRIBUTION'];
  const extra = integer(random, 0, 4);
  for (let index = 0; index < extra; index += 1) types.push(index % 3 === 2 ? 'WITHDRAWAL' : 'CONTRIBUTION');
  const cashFlows = types.map((type, index) => {
    const amountBase = type === 'CONTRIBUTION' ? 0.0075 : 0.004;
    const amount = roundMoney(Math.max(10_000, endBalance * amountBase * (0.55 + random())));
    const date = addDays(asOf, -(1050 - index * 105 + integer(random, 0, 35)));
    return {
      cashFlowId: stableOpaqueId('csh', seed, `${clientId}:${index}:${type}`),
      date,
      type,
      amount,
      signedAmount: type === 'CONTRIBUTION' ? amount : -amount,
      currency: 'THB',
      sourceRefs: [`fixture://${DEMO_BOOK_DATASET_ID}/cash-flows/${clientId}/${index}`],
      dataMode: 'FIXTURE',
      dataLabel: DEMO_DATA_LABEL,
      isSynthetic: true,
    };
  }).sort((left, right) => left.date.localeCompare(right.date));
  return {
    cashFlows,
    contributions: cashFlows.filter((item) => item.type === 'CONTRIBUTION'),
    withdrawals: cashFlows.filter((item) => item.type === 'WITHDRAWAL'),
  };
}

function buildContactHistory({ baseClient, clientId, clientIndex, seed, asOf, random }) {
  const channels = ['CALL', 'MEETING', 'REVIEWED_MESSAGE'];
  const outcomes = ['COMPLETED', 'FOLLOW_UP', 'NO_ANSWER', 'DECLINED'];
  const offsets = [3, 16, 38, 75, 130, 210, 320, 460];
  const count = integer(random, 4, 8);
  const records = [];
  if (baseClient && baseClient.contact && baseClient.contact.lastContactAt) {
    records.push({
      occurredAt: baseClient.contact.lastContactAt,
      channel: baseClient.contact.preferredChannel || 'CALL',
      outcome: 'COMPLETED',
      preservedFromBase: true,
    });
  }
  for (let index = 0; records.length < count; index += 1) {
    const day = addDays(asOf, -(offsets[index % offsets.length] + clientIndex % 5));
    records.push({
      occurredAt: `${day}T${String(9 + index % 7).padStart(2, '0')}:00:00+07:00`,
      channel: channels[(clientIndex + index) % channels.length],
      outcome: outcomes[(clientIndex + index * 2) % outcomes.length],
      preservedFromBase: false,
    });
  }
  const seenTimes = new Set();
  return records
    .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)))
    .filter((record) => !seenTimes.has(record.occurredAt) && seenTimes.add(record.occurredAt))
    .map((record, index) => ({
      contactId: stableOpaqueId('cnt', seed, `${clientId}:${record.occurredAt}:${index}`),
      occurredAt: record.occurredAt,
      channel: record.channel,
      purpose: index % 2 === 0 ? 'ทบทวนเป้าหมายและพอร์ต' : 'ยืนยันข้อมูลลูกค้า',
      outcome: record.outcome,
      declined: record.outcome === 'DECLINED',
      preservedFromBase: record.preservedFromBase,
      dataMode: 'FIXTURE',
      dataLabel: DEMO_DATA_LABEL,
      isSynthetic: true,
    }));
}

function summarizeContact(baseClient, contactHistory, asOf) {
  const base = baseClient && baseClient.contact || {};
  const cutoff7 = addDays(asOf, -7);
  const cutoff30 = addDays(asOf, -30);
  const contacts7Days = contactHistory.filter((item) => item.occurredAt.slice(0, 10) >= cutoff7).length;
  const contacts30Days = contactHistory.filter((item) => item.occurredAt.slice(0, 10) >= cutoff30).length;
  const declinedContacts30Days = contactHistory.filter((item) => item.occurredAt.slice(0, 10) >= cutoff30 && item.declined).length;
  return {
    lastContactAt: contactHistory.length > 0 ? contactHistory[0].occurredAt : null,
    contacts7Days: Math.max(contacts7Days, numericValue(base.contacts7Days, 0)),
    contacts30Days: Math.max(contacts30Days, numericValue(base.contacts30Days, 0)),
    declinedContacts30Days: Math.max(declinedContacts30Days, numericValue(base.declinedContacts30Days, 0)),
    preferredChannel: base.preferredChannel || 'CALL',
    quietHours: base.quietHours || '20:00-08:00',
    campaignOverlap: Boolean(base.campaignOverlap),
    maxContacts7Days: 2,
    maxContacts30Days: 5,
  };
}

function generatedName(index, usedNames) {
  for (let offset = 0; offset < GENERATED_CLIENT_NAMES.length; offset += 1) {
    const name = GENERATED_CLIENT_NAMES[(index + offset) % GENERATED_CLIENT_NAMES.length];
    if (!usedNames.has(name)) return name;
  }
  throw new Error('not enough unique demo client names');
}

function createDemoBook(options = {}) {
  const seed = String(options.seed || DEFAULT_DEMO_BOOK_SEED);
  const asOf = isoDate(options.asOf || DEFAULT_AS_OF);
  const baseFixtures = options.baseFixtures || options.existingFixtures || null;
  const baseClients = deepClone(baseFixtures && baseFixtures.clients || options.baseClients || []).slice(0, 30);
  const baseSnapshots = deepClone(baseFixtures && baseFixtures.snapshots || []);
  const baseLedgers = deepClone(baseFixtures && baseFixtures.ledgers || []);
  const baseActions = deepClone(baseFixtures && baseFixtures.actions || []);
  const snapshotByClient = new Map(baseSnapshots.map((item) => [item.clientId, item]));
  const ledgerByClient = new Map(baseLedgers.map((item) => [item.clientId, item]));
  const actionByClient = new Map();
  for (const action of [...baseActions].sort((left, right) => String(left.actionId).localeCompare(String(right.actionId)))) {
    if (!actionByClient.has(action.clientId)) actionByClient.set(action.clientId, action);
  }

  const rms = RM_NAMES.map((displayName, index) => ({
    rmId: stableOpaqueId('rm', seed, index),
    displayName,
    bookSize: 6,
    dailyCallCapacityMinutes: 72,
    dataMode: 'FIXTURE',
    dataLabel: DEMO_DATA_LABEL,
    isSynthetic: true,
  }));

  const usedNames = new Set(baseClients.map((client) => client.name));
  const clients = [];
  const actions = [];
  for (let index = 0; index < 30; index += 1) {
    const random = seededRandom(`${seed}|client|${index}`);
    const baseClient = baseClients[index] || null;
    const clientId = baseClient && baseClient.clientId || stableOpaqueId('clt', seed, index);
    const rm = rms[Math.floor(index / 6)];
    const name = baseClient && baseClient.name || generatedName(index, usedNames);
    usedNames.add(name);
    const displayRef = baseClient && baseClient.displayRef || `FIN • ${stableOpaqueId('ref', seed, index).slice(-4)}`;
    const snapshot = snapshotByClient.get(clientId) || null;
    const holdings = buildHoldings({ baseSnapshot: snapshot, clientId, clientIndex: index, seed, asOf, random });
    const endBalance = holdings.reduce((sum, holding) => sum + holding.value, 0);
    const goals = buildGoals({ baseLedger: ledgerByClient.get(clientId), clientId, clientIndex: index, endBalance, seed, asOf, random });
    const flowBook = buildCashFlows({ clientId, endBalance, seed, asOf, random });
    const contactHistory = buildContactHistory({ baseClient, clientId, clientIndex: index, seed, asOf, random });
    const contact = summarizeContact(baseClient, contactHistory, asOf);
    const netContribution = flowBook.contributions.reduce((sum, item) => sum + item.amount, 0);
    const netWithdrawal = flowBook.withdrawals.reduce((sum, item) => sum + item.amount, 0);
    const estimatedMarketChange = roundMoney(endBalance * ((random() - 0.35) * 0.12));
    const startBalance = roundMoney(Math.max(100_000, endBalance - netContribution + netWithdrawal - estimatedMarketChange));
    const client = {
      ...(baseClient ? deepClone(baseClient) : {}),
      clientId,
      displayRef,
      name,
      initials: baseClient && baseClient.initials || name.replace(/^คุณ/, '').split(/[ .]/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2),
      segment: baseClient && baseClient.segment || ['2-5 ล้านบาท', '5-15 ล้านบาท', '15-50 ล้านบาท'][index % 3],
      rmId: rm.rmId,
      owner: rm.displayName,
      originalOwner: baseClient && baseClient.owner && baseClient.owner !== rm.displayName ? baseClient.owner : null,
      asOf,
      goals,
      holdings,
      portfolio: {
        currency: 'THB',
        startBalance,
        netContribution,
        netWithdrawal,
        estimatedMarketChange,
        endBalance,
        currencyExposure: aggregateCurrencyExposure(holdings),
        returnType: 'NAV_RETURN',
        isTotalReturn: false,
        masterFundGroupingRequired: true,
      },
      cashFlows: flowBook.cashFlows,
      contributions: flowBook.contributions,
      withdrawals: flowBook.withdrawals,
      contactHistory,
      contact,
      sourceSystemRefs: baseClient && baseClient.sourceSystemRefs || [{ system: 'FIXTURE', key: stableOpaqueId('src', seed, clientId) }],
      dataMode: 'FIXTURE',
      dataLabel: DEMO_DATA_LABEL,
      isSynthetic: true,
    };

    const baseAction = actionByClient.get(clientId);
    const actionId = baseAction && baseAction.actionId || stableOpaqueId('act', seed, clientId);
    const affectedGoalIds = baseAction && Array.isArray(baseAction.affectedGoalIds)
      ? baseAction.affectedGoalIds.filter((goalId) => goals.some((goal) => goal.goalId === goalId))
      : [];
    const action = {
      ...(baseAction ? deepClone(baseAction) : {}),
      actionId,
      clientId,
      rmId: rm.rmId,
      owner: rm.displayName,
      lane: baseAction && baseAction.lane || (index % 3 === 0 ? 'CARE' : 'GROWTH'),
      domain: baseAction && baseAction.domain || ['INVESTMENT', 'RETIREMENT', 'LIQUIDITY', 'DATA'][index % 4],
      affectedGoalIds: affectedGoalIds.length > 0 ? affectedGoalIds : [goals[0].goalId],
      title: baseAction && baseAction.title || `ทบทวน${goals[0].name}`,
      state: baseAction && baseAction.state || 'ELIGIBLE',
      modelRunId: baseAction && baseAction.modelRunId || stableOpaqueId('run', seed, clientId),
      decisionSafety: {
        ...(baseAction && baseAction.decisionSafety || {}),
        canAutoSend: false,
        canAutoTrade: false,
        canExecuteProduct: false,
        approveAndSendAvailable: false,
      },
      dataMode: 'FIXTURE',
      dataLabel: DEMO_DATA_LABEL,
      isSynthetic: true,
    };
    client.actionIds = [actionId];
    clients.push(client);
    actions.push(action);
  }

  const book = {
    metadata: {
      datasetId: DEMO_BOOK_DATASET_ID,
      seed,
      asOf,
      rmCount: rms.length,
      clientCount: clients.length,
      actionCount: actions.length,
      clientsPerRm: 6,
      dataMode: 'FIXTURE',
      dataLabel: DEMO_DATA_LABEL,
      isSynthetic: true,
      returnType: 'NAV_RETURN',
      isTotalReturn: false,
      limitations: [
        'ข้อมูลทั้งหมดเป็นข้อมูลสาธิต ไม่ใช่ลูกค้า กองทุน หรือผลลัพธ์จริง',
        'NAV fixture เป็น NAV return และห้ามเรียก total return',
      ],
    },
    rms,
    clients,
    actions,
    fundShelf: DEMO_FUND_SHELF.map(deepClone),
  };
  validateDemoBook(book);
  return deepFreeze(book);
}

function assertUnique(rows, field) {
  const seen = new Set();
  for (const row of rows) {
    const value = row[field];
    if (typeof value !== 'string' || value.length === 0) throw new Error(`missing ${field}`);
    if (seen.has(value)) throw new Error(`duplicate ${field}: ${value}`);
    seen.add(value);
  }
}

function validateDemoBook(book) {
  if (!book || !book.metadata) throw new TypeError('demo book is required');
  if (book.rms.length !== 5) throw new Error('demo book must contain exactly 5 RMs');
  if (book.clients.length !== 30) throw new Error('demo book must contain exactly 30 clients');
  if (book.actions.length !== 30) throw new Error('demo book must contain exactly 30 actions');
  assertUnique(book.rms, 'rmId');
  assertUnique(book.clients, 'clientId');
  assertUnique(book.clients, 'displayRef');
  assertUnique(book.actions, 'actionId');
  const rmCounts = new Map(book.rms.map((rm) => [rm.rmId, 0]));
  const goalIds = [];
  const cashFlowIds = [];
  const contactIds = [];
  for (const client of book.clients) {
    if (!rmCounts.has(client.rmId)) throw new Error(`unknown RM for client ${client.clientId}`);
    rmCounts.set(client.rmId, rmCounts.get(client.rmId) + 1);
    if (client.goals.length < 2 || client.goals.length > 4) throw new Error(`client ${client.clientId} must have 2-4 goals`);
    if (client.holdings.length < 5 || client.holdings.length > 12) throw new Error(`client ${client.clientId} must have 5-12 holdings`);
    if (client.contributions.length === 0 || client.withdrawals.length === 0) throw new Error(`client ${client.clientId} must have contributions and withdrawals`);
    if (client.cashFlows.length !== client.contributions.length + client.withdrawals.length) throw new Error(`cash-flow split mismatch for ${client.clientId}`);
    if (client.contactHistory.length === 0) throw new Error(`client ${client.clientId} must have contact history`);
    if (client.dataMode !== 'FIXTURE' || client.dataLabel !== DEMO_DATA_LABEL || client.isSynthetic !== true) throw new Error(`client ${client.clientId} is not labelled as demo data`);
    const holdingFunds = new Set();
    const masterCounts = new Map();
    for (const holding of client.holdings) {
      if (holdingFunds.has(holding.fundId)) throw new Error(`duplicate holding fundId for ${client.clientId}`);
      holdingFunds.add(holding.fundId);
      if (!holding.masterFundId || !holding.shareClassId) throw new Error(`holding cannot be grouped by master fund for ${client.clientId}`);
      if (!holding.thaiRegistered || holding.registrationCountryCode !== 'TH') throw new Error(`non-Thai fund in demo book for ${client.clientId}`);
      if (holding.returnType !== 'NAV_RETURN' || holding.isTotalReturn !== false) throw new Error(`fixture holding return label is unsafe for ${client.clientId}`);
      masterCounts.set(holding.masterFundId, (masterCounts.get(holding.masterFundId) || 0) + 1);
    }
    if (![...masterCounts.values()].some((count) => count > 1)) throw new Error(`client ${client.clientId} needs a share-class grouping example`);
    goalIds.push(...client.goals.map((goal) => ({ goalId: goal.goalId })));
    cashFlowIds.push(...client.cashFlows.map((flow) => ({ cashFlowId: flow.cashFlowId })));
    contactIds.push(...client.contactHistory.map((contact) => ({ contactId: contact.contactId })));
  }
  if ([...rmCounts.values()].some((count) => count !== 6)) throw new Error('each RM must own exactly 6 clients');
  assertUnique(goalIds, 'goalId');
  assertUnique(cashFlowIds, 'cashFlowId');
  assertUnique(contactIds, 'contactId');
  const clientIds = new Set(book.clients.map((client) => client.clientId));
  for (const action of book.actions) {
    if (!clientIds.has(action.clientId)) throw new Error(`action ${action.actionId} references an unknown client`);
    if (action.decisionSafety.canAutoSend || action.decisionSafety.canAutoTrade || action.decisionSafety.canExecuteProduct) {
      throw new Error(`action ${action.actionId} exposes prohibited automatic execution`);
    }
  }
  return true;
}

module.exports = {
  DEFAULT_DEMO_BOOK_SEED,
  DEMO_BOOK_DATASET_ID,
  DEFAULT_AS_OF,
  DEMO_DATA_LABEL,
  DEMO_FUND_SHELF,
  stableOpaqueId,
  validateDemoBook,
  createDemoBook,
};
