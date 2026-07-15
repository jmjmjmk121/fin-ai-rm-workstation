'use strict';

/**
 * FIN AI RM Cockpit v3 domain engine.
 *
 * This module deliberately has no transport, persistence, or third-party
 * dependencies.  It is an in-memory reference implementation for the P0
 * workflow: Client 360, Goal Ledger, ranked Action Cards, human decisions,
 * specialist handoff preparation, and an append-only audit trail.
 */

const ACTION_STATES = Object.freeze([
  'DETECTED',
  'DATA_CHECK',
  'CONFIRM_DATA',
  'BLOCKED',
  'ELIGIBLE',
  'HUMAN_REVIEW',
  'APPROVED_OR_EDITED',
  'DISMISSED',
  'SCHEDULED_OR_HANDOFF',
  'COMPLETED',
  'EXPIRED_OR_CANCELLED',
]);

const ALLOWED_TRANSITIONS = deepFreeze({
  DETECTED: ['DATA_CHECK', 'DISMISSED', 'EXPIRED_OR_CANCELLED'],
  DATA_CHECK: ['CONFIRM_DATA', 'BLOCKED', 'ELIGIBLE', 'DISMISSED', 'EXPIRED_OR_CANCELLED'],
  CONFIRM_DATA: ['DATA_CHECK', 'BLOCKED', 'DISMISSED', 'EXPIRED_OR_CANCELLED'],
  BLOCKED: ['DATA_CHECK', 'DISMISSED', 'EXPIRED_OR_CANCELLED'],
  ELIGIBLE: ['HUMAN_REVIEW', 'CONFIRM_DATA', 'DISMISSED', 'EXPIRED_OR_CANCELLED'],
  HUMAN_REVIEW: ['APPROVED_OR_EDITED', 'CONFIRM_DATA', 'SCHEDULED_OR_HANDOFF', 'DISMISSED', 'EXPIRED_OR_CANCELLED'],
  APPROVED_OR_EDITED: ['SCHEDULED_OR_HANDOFF', 'COMPLETED', 'EXPIRED_OR_CANCELLED'],
  DISMISSED: [],
  SCHEDULED_OR_HANDOFF: ['COMPLETED', 'EXPIRED_OR_CANCELLED'],
  COMPLETED: [],
  EXPIRED_OR_CANCELLED: [],
});

const DECISIONS = Object.freeze([
  'APPROVE_DRAFT',
  'EDIT_DRAFT',
  'REQUEST_INFORMATION',
  'HANDOFF',
  'NO_ACTION',
]);

const PROHIBITED_OPERATIONS = Object.freeze([
  'APPROVE_AND_SEND',
  'AUTO_SEND',
  'SEND',
  'TRADE',
  'AUTO_TRADE',
  'EXECUTE_TRADE',
]);

const MODEL_AUDIT_ROLES = new Set([
  'QUANT',
  'MODEL_OWNER',
  'RISK',
  'COMPLIANCE',
  'SYSTEM_ADMINISTRATOR',
  'AUDITOR',
]);

const HARD_DATA_GATES = deepFreeze([
  {
    key: 'identityKycCurrent',
    label: 'ข้อมูลยืนยันตัวตนและ KYC เป็นปัจจุบัน',
    owner: 'ลูกค้าและฝ่ายดูแลข้อมูลลูกค้า',
    question: 'ขอยืนยันข้อมูลส่วนตัวและสถานะ KYC ปัจจุบันอีกครั้งได้ไหมคะ/ครับ',
  },
  {
    key: 'suitabilityCurrent',
    label: 'แบบประเมินความเหมาะสมยังใช้ได้',
    owner: 'ลูกค้าและ RM',
    question: 'ความสามารถและความตั้งใจรับความเสี่ยงของคุณยังเหมือนครั้งล่าสุดหรือไม่คะ/ครับ',
  },
  {
    key: 'mandateCurrent',
    label: 'ขอบเขตการให้บริการและคำสั่งลูกค้ายังใช้ได้',
    owner: 'RM และฝ่ายปฏิบัติการ',
    question: 'ขอยืนยันขอบเขตการดูแลและข้อจำกัดการลงทุนก่อนพิจารณาทางเลือกนะคะ/ครับ',
  },
  {
    key: 'liquidityCurrent',
    label: 'ข้อมูลเงินสำรองและแผนใช้เงินเป็นปัจจุบัน',
    owner: 'ลูกค้า',
    question: 'ใน 12 เดือนข้างหน้า มีเงินก้อนใดที่ต้องเตรียมใช้ และต้องการสำรองรายจ่ายกี่เดือนคะ/ครับ',
  },
  {
    key: 'affectedGoalsConfirmed',
    label: 'ยอดและวันที่ของเป้าหมายที่ได้รับผลกระทบได้รับการยืนยัน',
    owner: 'ลูกค้า',
    question: 'ยอดเป้าหมาย วันเริ่มใช้เงิน และสกุลเงินยังเป็นข้อมูลล่าสุดหรือไม่คะ/ครับ',
  },
  {
    key: 'holdingsNavCurrent',
    label: 'รายการถือครองและ NAV เป็นข้อมูลล่าสุด',
    owner: 'ระบบพอร์ตและผู้ให้บริการข้อมูลกองทุน',
    question: 'กรุณารอการยืนยันรายการถือครองและ NAV ล่าสุดก่อนใช้ตัวเลขประกอบคำแนะนำ',
  },
  {
    key: 'productEligibilityChecked',
    label: 'ตรวจสิทธิและรายชื่อผลิตภัณฑ์ที่อนุญาตแล้ว',
    owner: 'ฝ่ายผลิตภัณฑ์และ Compliance',
    question: 'ต้องตรวจว่าทางเลือกอยู่ในรายชื่อที่อนุญาตและลูกค้ามีสิทธิก่อนอธิบายผลิตภัณฑ์',
  },
]);

const DEMO_IDS = deepFreeze({
  clients: {
    education: 'clt_01J2K6P8QZ7M4N5V9X3C',
    missingData: 'clt_01J2K6Q1AR8N5P6W0Y4D',
    protection: 'clt_01J2K6Q9BS9P6Q7X1Z5E',
    retirementGrowth: 'clt_01J2K6R2CT0Q7R8Y2A6F',
    surplusGrowth: 'clt_01J2K6RADU1R8S9Z3B7G',
    fatigued: 'clt_01J2K6S3EV2S9T0A4C8H',
    handoff: 'clt_01J2K6SBFW3T0V1B5D9J',
    completed: 'clt_01J2K6T4GX4V1W2C6E0K',
  },
  snapshots: {
    education: 'snp_01J2K70A4M6P8R2V5X9Z',
    missingData: 'snp_01J2K70B5N7Q9S3W6Y0A',
    protection: 'snp_01J2K70C6P8R0T4X7Z1B',
    retirementGrowth: 'snp_01J2K70D7Q9S1V5Y8A2C',
    surplusGrowth: 'snp_01J2K70E8R0T2W6Z9B3D',
    fatigued: 'snp_01J2K70F9S1V3X7A0C4E',
    handoff: 'snp_01J2K70G0T2W4Y8B1D5F',
    completed: 'snp_01J2K70H1V3X5Z9C2E6G',
  },
  goals: {
    educationReserve: 'gol_01J2K72A6M8Q0V4Y7B1D',
    education: 'gol_01J2K72B7N9R1W5Z8C2E',
    educationRetirement: 'gol_01J2K72C8P0S2X6A9D3F',
    missingRetirement: 'gol_01J2K72D9Q1T3Y7B0E4G',
    protection: 'gol_01J2K72E0R2V4Z8C1F5H',
    retirementGrowth: 'gol_01J2K72F1S3W5A9D2G6J',
    surplusGrowth: 'gol_01J2K72G2T4X6B0E3H7K',
    fatigued: 'gol_01J2K72H3V5Y7C1F4J8M',
    handoff: 'gol_01J2K72J4W6Z8D2G5K9N',
    completed: 'gol_01J2K72K5X7A9E3H6M0P',
  },
  actions: {
    education: 'act_01J2K74A8N0R3W6Z9C2F',
    missingData: 'act_01J2K74B9P1S4X7A0D3G',
    protection: 'act_01J2K74C0Q2T5Y8B1E4H',
    retirementGrowth: 'act_01J2K74D1R3V6Z9C2F5J',
    surplusGrowth: 'act_01J2K74E2S4W7A0D3G6K',
    fatigued: 'act_01J2K74F3T5X8B1E4H7M',
    handoff: 'act_01J2K74G4V6Y9C2F5J8N',
    completed: 'act_01J2K74H5W7Z0D3G6K9P',
  },
});

function deepClone(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(deepClone);
  const result = {};
  for (const [key, child] of Object.entries(value)) result[key] = deepClone(child);
  return result;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
  return output;
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function deterministicHash(value) {
  const input = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`);
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter((value) => typeof value === 'string' && value.length > 0))];
}

function buildResultRef(key, input, overrides = {}) {
  return deepFreeze({
    calculationId: overrides.calculationId || `calc_${deterministicHash({ key, input }).slice(-8)}`,
    modelRunId: overrides.modelRunId || `run_${deterministicHash({ key, input, run: 1 }).slice(-8)}`,
    modelVersion: overrides.modelVersion || 'fin-ai-goal-engine/3.0.0-demo',
    assumptionVersion: overrides.assumptionVersion || 'rm-policy-fixture/2026-07-15',
    inputHash: overrides.inputHash || deterministicHash(input),
  });
}

function governedNumber(value, options) {
  assertFiniteNumber(value, 'governed number value');
  const required = ['unit', 'asOf', 'sourceRefs', 'formulaId', 'calculationId', 'modelVersion', 'assumptionVersion', 'inputHash', 'reasonCodes'];
  for (const field of required) {
    if (options[field] === undefined || options[field] === null) throw new TypeError(`governed number requires ${field}`);
  }
  if (!Array.isArray(options.sourceRefs) || options.sourceRefs.length === 0) throw new TypeError('sourceRefs must be a non-empty array');
  if (!Array.isArray(options.reasonCodes)) throw new TypeError('reasonCodes must be an array');
  return deepFreeze({
    value,
    unit: options.unit,
    asOf: options.asOf,
    sourceRefs: uniqueStrings(options.sourceRefs),
    formulaId: options.formulaId,
    calculationId: options.calculationId,
    modelVersion: options.modelVersion,
    assumptionVersion: options.assumptionVersion,
    inputHash: options.inputHash,
    reasonCodes: uniqueStrings(options.reasonCodes),
    period: options.period || null,
    observationCount: Number.isInteger(options.observationCount) ? options.observationCount : null,
    frequency: options.frequency || null,
    currency: options.currency || (options.unit === 'THB' ? 'THB' : null),
    limitation: options.limitation || null,
  });
}

function assertGovernedNumber(metric) {
  if (!metric || typeof metric !== 'object') throw new TypeError('metric must be an object');
  const fields = ['value', 'unit', 'asOf', 'sourceRefs', 'formulaId', 'calculationId', 'modelVersion', 'assumptionVersion', 'inputHash', 'reasonCodes'];
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(metric, field)) throw new TypeError(`metric is missing ${field}`);
  }
  assertFiniteNumber(metric.value, 'metric.value');
  if (!Array.isArray(metric.sourceRefs) || metric.sourceRefs.length === 0) throw new TypeError('metric.sourceRefs must not be empty');
  if (!Array.isArray(metric.reasonCodes)) throw new TypeError('metric.reasonCodes must be an array');
  return true;
}

function metricFactory(asOf, resultRef, sourceRefs) {
  return (value, unit, formulaId, reasonCodes, extra = {}) => governedNumber(value, {
    unit,
    asOf,
    sourceRefs,
    formulaId,
    calculationId: resultRef.calculationId,
    modelVersion: resultRef.modelVersion,
    assumptionVersion: resultRef.assumptionVersion,
    inputHash: resultRef.inputHash,
    reasonCodes,
    ...extra,
  });
}

function unavailableMetric(unit, asOf, resultRef, sourceRefs, reasonCode) {
  return deepFreeze({
    value: null,
    available: false,
    availability: 'MISSING',
    unit,
    asOf,
    sourceRefs: uniqueStrings(sourceRefs),
    formulaId: 'NOT_CALCULATED',
    calculationId: resultRef.calculationId,
    modelVersion: resultRef.modelVersion,
    assumptionVersion: resultRef.assumptionVersion,
    inputHash: resultRef.inputHash,
    reasonCodes: [reasonCode],
    limitation: 'ยังไม่มี calculator และสมมติฐานที่ผ่านการอนุมัติ จึงไม่แสดงค่าคำนวณ',
  });
}

function buildGoalLedger(config) {
  const {
    clientId,
    snapshotId,
    asOf,
    totalWealth,
    monthlyExpense,
    emergencyMonths = 6,
    currentlyLiquid,
    capitalLots,
    goals,
    resultRef,
  } = config;
  assertNonEmptyString(clientId, 'clientId');
  assertNonEmptyString(snapshotId, 'snapshotId');
  assertFiniteNumber(totalWealth, 'totalWealth');
  assertFiniteNumber(monthlyExpense, 'monthlyExpense');
  assertFiniteNumber(currentlyLiquid, 'currentlyLiquid');
  if (!Array.isArray(capitalLots) || !Array.isArray(goals)) throw new TypeError('capitalLots and goals must be arrays');
  const lotMap = new Map();
  for (const lot of capitalLots) {
    assertNonEmptyString(lot.lotId, 'capital lot id');
    assertFiniteNumber(lot.amount, `capital lot ${lot.lotId} amount`);
    if (lot.amount < 0) throw new RangeError('capital lot amount cannot be negative');
    if (lotMap.has(lot.lotId)) throw new Error(`duplicate capital lot id: ${lot.lotId}`);
    lotMap.set(lot.lotId, deepClone(lot));
  }

  const seenGoalIds = new Set();
  const assignedLots = new Map();
  const metric = metricFactory(asOf, resultRef, ['fixture:client-360-v3', 'fixture:goal-ledger-v3']);
  const ledgerGoals = goals.map((goal) => {
    assertNonEmptyString(goal.goalId, 'goalId');
    if (seenGoalIds.has(goal.goalId)) throw new Error(`duplicate goal id: ${goal.goalId}`);
    seenGoalIds.add(goal.goalId);
    assertFiniteNumber(goal.target, `goal ${goal.goalId} target`);
    if (goal.target < 0) throw new RangeError('goal target cannot be negative');
    const lotIds = uniqueStrings(goal.capitalLotIds || []);
    let currentFunding = 0;
    for (const lotId of lotIds) {
      const lot = lotMap.get(lotId);
      if (!lot) throw new Error(`unknown capital lot ${lotId} assigned to goal ${goal.goalId}`);
      if (assignedLots.has(lotId)) {
        throw new Error(`capital lot ${lotId} is double-counted by goals ${assignedLots.get(lotId)} and ${goal.goalId}`);
      }
      assignedLots.set(lotId, goal.goalId);
      currentFunding += lot.amount;
    }
    const fundedRatio = goal.target === 0 ? 1 : currentFunding / goal.target;
    const shortfall = Math.max(0, goal.target - currentFunding);
    const baseProbability = Number.isFinite(goal.baseSuccessProbability) ? goal.baseSuccessProbability : null;
    const stressProbability = Number.isFinite(goal.stressSuccessProbability) ? goal.stressSuccessProbability : null;
    const requiredMonthlyContribution = Number.isFinite(goal.requiredMonthlyContribution) ? goal.requiredMonthlyContribution : null;
    const fixtureProjection = (value, unit, field, reasonCode) => value == null
      ? unavailableMetric(unit, asOf, resultRef, ['fixture:goal-ledger-v3'], reasonCode)
      : metric(value, unit, 'FIXTURE_GOAL_PROJECTION_INPUT_V1', ['FIXTURE_INPUT_NOT_CALCULATED', field], {
        availability: 'AVAILABLE',
        limitation: 'ค่าจาก fixture สำหรับสาธิต workflow ไม่ใช่ผลจาก goal projection calculator และไม่ใช่คำรับประกัน',
      });
    return deepFreeze({
      goalId: goal.goalId,
      type: goal.type,
      name: goal.name,
      targetDate: goal.targetDate,
      currency: goal.currency || 'THB',
      status: goal.status || 'ACTIVE',
      target: metric(goal.target, goal.currency || 'THB', 'GOAL_TARGET_SOURCE_VALUE', ['GOAL_TARGET']),
      currentFunding: metric(currentFunding, goal.currency || 'THB', 'SUM_UNIQUE_GOAL_CAPITAL_LOTS', ['NO_DOUBLE_COUNTING']),
      fundedRatio: metric(fundedRatio, 'ratio', 'CURRENT_FUNDING_DIVIDED_BY_GOAL_TARGET', ['GOAL_FUNDED_RATIO']),
      baseSuccessProbability: fixtureProjection(baseProbability, 'probability', 'BASE_SCENARIO', 'BASE_GOAL_PROJECTION_MISSING'),
      stressSuccessProbability: fixtureProjection(stressProbability, 'probability', 'STRESS_SCENARIO', 'STRESS_GOAL_PROJECTION_MISSING'),
      shortfall: metric(shortfall, goal.currency || 'THB', 'MAX_GOAL_TARGET_MINUS_CURRENT_FUNDING_ZERO', ['GOAL_SHORTFALL']),
      requiredMonthlyContribution: fixtureProjection(requiredMonthlyContribution, `${goal.currency || 'THB'}/month`, 'REQUIRED_CONTRIBUTION', 'REQUIRED_CONTRIBUTION_NOT_CALCULATED'),
      nextReview: goal.nextReview,
      capitalLotIds: lotIds,
    });
  });

  const lotTotal = [...lotMap.values()].reduce((sum, lot) => sum + lot.amount, 0);
  const totalAssigned = [...assignedLots.keys()].reduce((sum, lotId) => sum + lotMap.get(lotId).amount, 0);
  if (lotTotal > totalWealth + 1e-6) throw new Error('capital lots exceed total client wealth');
  if (totalAssigned > totalWealth + 1e-6) throw new Error('goal assignments exceed total client wealth');
  const reserveRequired = monthlyExpense * emergencyMonths;
  const protectedCurrentLiquidity = Math.min(currentlyLiquid, reserveRequired);
  const reserveGap = Math.max(0, reserveRequired - currentlyLiquid);
  const availableAfterRequiredReserve = Math.max(0, totalWealth - reserveRequired);

  return deepFreeze({
    ledgerId: `ldg_${deterministicHash({ clientId, snapshotId, asOf }).slice(-8)}`,
    clientId,
    snapshotId,
    version: 1,
    asOf,
    resultRef,
    goals: ledgerGoals,
    liquidityReserve: {
      required: metric(reserveRequired, 'THB', 'MONTHLY_EXPENSE_TIMES_EMERGENCY_MONTHS', ['LIQUIDITY_FIRST']),
      currentlyLiquid: metric(currentlyLiquid, 'THB', 'SUM_LIQUID_HOLDINGS', ['LIQUIDITY_FIRST']),
      protectedFromRecommendation: metric(protectedCurrentLiquidity, 'THB', 'MIN_CURRENT_LIQUIDITY_AND_REQUIRED_RESERVE', ['LIQUIDITY_PROTECTED']),
      additionalNeeded: metric(reserveGap, 'THB', 'MAX_REQUIRED_RESERVE_MINUS_CURRENT_LIQUIDITY_ZERO', ['LIQUIDITY_RESERVE_SHORTFALL']),
      availableAfterRequiredReserve: metric(availableAfterRequiredReserve, 'THB', 'MAX_TOTAL_WEALTH_MINUS_REQUIRED_RESERVE_ZERO', ['LIQUIDITY_FIRST']),
      emergencyMonths,
      status: reserveGap > 0 ? 'SHORTFALL' : 'FUNDED',
      canUseProtectedAmountForInvestment: false,
    },
    totals: {
      totalWealth: metric(totalWealth, 'THB', 'SUM_CLIENT_ASSETS', ['CLIENT_360']),
      capitalLots: metric(lotTotal, 'THB', 'SUM_UNIQUE_CAPITAL_LOTS', ['NO_DOUBLE_COUNTING']),
      assignedAcrossGoals: metric(totalAssigned, 'THB', 'SUM_UNIQUE_GOAL_ASSIGNMENTS', ['NO_DOUBLE_COUNTING']),
      unassigned: metric(Math.max(0, totalWealth - totalAssigned), 'THB', 'MAX_WEALTH_MINUS_ASSIGNED_ZERO', ['NO_DOUBLE_COUNTING']),
    },
    invariants: {
      noDoubleCounting: true,
      assignedDoesNotExceedWealth: totalAssigned <= totalWealth + 1e-6,
      liquidityReserveProtected: true,
    },
  });
}

function validateFundingPlan(ledger, plan) {
  if (!ledger || !ledger.liquidityReserve || !ledger.totals) throw new TypeError('a valid goal ledger is required');
  assertFiniteNumber(plan.postActionLiquidValue, 'postActionLiquidValue');
  const reserveRequired = ledger.liquidityReserve.required.value;
  if (plan.postActionLiquidValue + 1e-6 < reserveRequired) {
    throw new Error(`liquidity reserve must remain at least ${reserveRequired} THB`);
  }
  const seenLots = new Set();
  let allocated = 0;
  for (const allocation of plan.goalAllocations || []) {
    assertFiniteNumber(allocation.amount, 'goal allocation amount');
    if (allocation.amount < 0) throw new RangeError('goal allocation cannot be negative');
    allocated += allocation.amount;
    for (const lotId of allocation.capitalLotIds || []) {
      if (seenLots.has(lotId)) throw new Error(`capital lot ${lotId} is double-counted in proposed plan`);
      seenLots.add(lotId);
    }
  }
  const investable = ledger.totals.totalWealth.value - reserveRequired;
  if (allocated > investable + 1e-6) throw new Error('goal allocations use protected liquidity reserve');
  return deepFreeze({
    valid: true,
    reservePreserved: true,
    postActionLiquidValue: plan.postActionLiquidValue,
    allocated,
    maximumGoalAllocation: investable,
  });
}

function evaluateDataGates(snapshot) {
  const checks = snapshot && snapshot.checks ? snapshot.checks : {};
  const missing = HARD_DATA_GATES.filter((gate) => checks[gate.key] !== true).map((gate) => ({
    key: gate.key,
    whatIsMissing: gate.label,
    whyItMatters: 'หากข้อมูลนี้ไม่พร้อม ระบบต้องไม่แสดงคำแนะนำผลิตภัณฑ์หรือการปรับพอร์ต',
    whoCanProvideIt: gate.owner,
    exactQuestion: gate.question,
    analysisStatus: 'BLOCKED',
  }));
  return deepFreeze({
    passed: missing.length === 0,
    state: missing.length === 0 ? 'ELIGIBLE' : 'CONFIRM_DATA',
    channel: missing.length === 0 ? null : 'CONFIRM_DATA',
    onlyAllowedNextAction: missing.length === 0 ? null : 'CONFIRM_DATA',
    missing,
  });
}

function minuteOfDayForBangkok(instant) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const hour = Number(parts.find((part) => part.type === 'hour').value);
  const minute = Number(parts.find((part) => part.type === 'minute').value);
  return hour * 60 + minute;
}

function parseClockMinute(value) {
  if (!/^\d{2}:\d{2}$/.test(value || '')) throw new TypeError(`invalid clock time: ${value}`);
  const [hour, minute] = value.split(':').map(Number);
  if (hour > 23 || minute > 59) throw new RangeError(`invalid clock time: ${value}`);
  return hour * 60 + minute;
}

function isQuietTime(instant, quietHours) {
  if (!quietHours) return false;
  const [startText, endText] = quietHours.split('-');
  const start = parseClockMinute(startText);
  const end = parseClockMinute(endText);
  const current = minuteOfDayForBangkok(instant);
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function evaluateContactPolicy(contact = {}, action, instant = '2026-07-15T09:00:00+07:00') {
  const reasons = [];
  const warnings = [];
  const mandatoryCare = action.lane === 'CARE' && action.mandatoryCare === true;
  const quiet = isQuietTime(instant, contact.quietHours || '20:00-08:00');
  const max7 = Number.isInteger(contact.maxContacts7Days) ? contact.maxContacts7Days : 2;
  const max30 = Number.isInteger(contact.maxContacts30Days) ? contact.maxContacts30Days : 5;
  const overFrequency = (contact.contacts7Days || 0) >= max7 || (contact.contacts30Days || 0) >= max30;
  const repeatedDeclines = (contact.declinedContacts30Days || 0) >= 2;
  const campaignOverlap = Boolean(contact.campaignOverlap);
  if (quiet) reasons.push('อยู่ในช่วงเวลาที่ลูกค้าไม่ต้องการให้ติดต่อ');
  if (overFrequency) reasons.push('จำนวนการติดต่อถึงเพดาน 7/30 วัน');
  if (repeatedDeclines) reasons.push('ลูกค้าปฏิเสธการติดต่อซ้ำในช่วง 30 วัน');
  if (campaignOverlap) reasons.push('มีแคมเปญหรือการติดต่ออื่นซ้อนอยู่');

  if (quiet) {
    return deepFreeze({ allowedNow: false, recommendation: 'DEFER', reasons, warnings, mandatoryOverrideUsed: false });
  }
  if (mandatoryCare) {
    if (overFrequency || repeatedDeclines || campaignOverlap) warnings.push('เคส Care ที่จำเป็นลัดเพดานได้ แต่ RM ต้องอธิบายเหตุผลและใช้ช่องทางที่ลูกค้าต้องการ');
    return deepFreeze({
      allowedNow: true,
      recommendation: action.channel,
      reasons,
      warnings,
      mandatoryOverrideUsed: overFrequency || repeatedDeclines || campaignOverlap,
    });
  }
  if (overFrequency || repeatedDeclines || campaignOverlap) {
    return deepFreeze({ allowedNow: false, recommendation: 'NO_ACTION', reasons, warnings, mandatoryOverrideUsed: false });
  }
  return deepFreeze({
    allowedNow: true,
    recommendation: contact.preferredChannel || action.channel,
    reasons,
    warnings,
    mandatoryOverrideUsed: false,
  });
}

function validateActionCard(action) {
  const required = [
    'actionId', 'clientId', 'snapshotId', 'lane', 'domain', 'affectedGoalIds', 'title', 'whyNow',
    'clientBenefit', 'priorityTier', 'supportingScore', 'channel', 'owner', 'dueAt', 'evidence',
    'reasonCodes', 'missingData', 'approvedExplanation', 'draftedMessage', 'specialistType', 'state',
    'modelRunId', 'createdAt', 'updatedAt',
  ];
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(action, field)) throw new TypeError(`ActionCard is missing ${field}`);
  }
  if (!['CARE', 'GROWTH'].includes(action.lane)) throw new TypeError('invalid ActionCard lane');
  if (!['DATA', 'LIQUIDITY', 'INVESTMENT', 'RETIREMENT', 'PROTECTION', 'LENDING', 'SERVICE'].includes(action.domain)) throw new TypeError('invalid ActionCard domain');
  if (!['P0', 'P1', 'P2', 'P3'].includes(action.priorityTier)) throw new TypeError('invalid ActionCard priorityTier');
  if (!['CALL', 'MEETING', 'REVIEWED_MESSAGE', 'CONFIRM_DATA', 'HANDOFF', 'NO_ACTION'].includes(action.channel)) throw new TypeError('invalid ActionCard channel');
  if (!ACTION_STATES.includes(action.state)) throw new TypeError('invalid ActionCard state');
  if (!Array.isArray(action.affectedGoalIds) || !Array.isArray(action.evidence) || !Array.isArray(action.reasonCodes) || !Array.isArray(action.missingData)) {
    throw new TypeError('ActionCard list fields must be arrays');
  }
  for (const item of action.evidence) {
    if (item.numeric) assertGovernedNumber(item.numeric);
  }
  if (!action.decisionSafety || action.decisionSafety.canAutoSend !== false || action.decisionSafety.canAutoTrade !== false) {
    throw new Error('ActionCard must explicitly prohibit auto-send and auto-trade');
  }
  return true;
}

function createActionCard(input, snapshot) {
  const gate = evaluateDataGates(snapshot);
  const requestedState = input.state || gate.state;
  const hardGated = !gate.passed;
  const result = {
    actionId: input.actionId,
    clientId: input.clientId,
    snapshotId: input.snapshotId,
    lane: input.lane,
    domain: input.domain,
    affectedGoalIds: [...(input.affectedGoalIds || [])],
    title: input.title,
    whyNow: input.whyNow,
    clientBenefit: input.clientBenefit,
    priorityTier: input.priorityTier,
    supportingScore: input.supportingScore === undefined ? null : input.supportingScore,
    channel: hardGated ? 'CONFIRM_DATA' : input.channel,
    owner: input.owner,
    dueAt: input.dueAt || null,
    evidence: deepClone(input.evidence || []),
    reasonCodes: uniqueStrings(input.reasonCodes),
    missingData: hardGated ? gate.missing.map((item) => item.whatIsMissing) : uniqueStrings(input.missingData),
    approvedExplanation: input.approvedExplanation || null,
    draftedMessage: input.draftedMessage || null,
    specialistType: input.specialistType || null,
    state: hardGated ? 'CONFIRM_DATA' : requestedState,
    modelRunId: input.modelRunId,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt || input.createdAt,
    resultRef: input.resultRef,
    mandatoryCare: Boolean(input.mandatoryCare),
    estimatedMinutes: Number.isFinite(input.estimatedMinutes) ? input.estimatedMinutes : 0,
    dataGate: gate,
    conversationCoach: deepClone(input.conversationCoach || null),
    decisionSafety: {
      requiresHumanDecision: true,
      allowedDecisions: [...DECISIONS],
      canAutoSend: false,
      canAutoTrade: false,
      canExecuteProduct: false,
      approveAndSendAvailable: false,
    },
    decisionRecord: input.decisionRecord || null,
    outcome: input.outcome || null,
  };
  validateActionCard(result);
  return deepFreeze(result);
}

function tierRank(tier) {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[tier] ?? 9;
}

function compareActions(left, right) {
  const leftLane = left.lane === 'CARE' ? 0 : 1;
  const rightLane = right.lane === 'CARE' ? 0 : 1;
  if (leftLane !== rightLane) return leftLane - rightLane;
  if (left.mandatoryCare !== right.mandatoryCare) return left.mandatoryCare ? -1 : 1;
  const tierDifference = tierRank(left.priorityTier) - tierRank(right.priorityTier);
  if (tierDifference !== 0) return tierDifference;
  const scoreDifference = (right.supportingScore || 0) - (left.supportingScore || 0);
  if (scoreDifference !== 0) return scoreDifference;
  const dueDifference = String(left.dueAt || '9999').localeCompare(String(right.dueAt || '9999'));
  if (dueDifference !== 0) return dueDifference;
  return left.actionId.localeCompare(right.actionId);
}

function rankActions(actions) {
  const care = actions.filter((action) => action.lane === 'CARE').sort(compareActions);
  const growth = actions.filter((action) => action.lane === 'GROWTH').sort(compareActions);
  return deepFreeze({ care: deepClone(care), growth: deepClone(growth), ordered: deepClone([...care, ...growth]) });
}

function lowerPriorityExplanation(higher, lower) {
  if (!higher || !lower) return null;
  if (higher.lane === 'CARE' && lower.lane === 'GROWTH') {
    return 'ลำดับถัดไปต่ำกว่า เพราะเป็นโอกาส Growth ขณะที่เคสนี้เป็น Care ที่เกี่ยวกับความเสียหายหรือหน้าที่ดูแลลูกค้า';
  }
  if (higher.priorityTier !== lower.priorityTier) {
    return `ลำดับถัดไปอยู่ระดับ ${lower.priorityTier} ขณะที่เคสนี้อยู่ระดับ ${higher.priorityTier}`;
  }
  return 'ลำดับถัดไปมีความเร่งด่วนน้อยกว่าจากวันครบกำหนดและหลักฐานที่ผ่านกติกาเดียวกัน';
}

function makeEvidence(resultRef, asOf, input) {
  const metric = metricFactory(asOf, resultRef, input.sourceRefs || ['fixture:goal-ledger-v3']);
  return deepFreeze({
    evidenceId: input.evidenceId,
    label: input.label,
    plainMeaning: input.plainMeaning,
    actionImplication: input.actionImplication,
    numeric: metric(input.value, input.unit, input.formulaId, input.reasonCodes || []),
    sourceLabel: input.sourceLabel || 'ข้อมูลสาธิตที่ผ่านการควบคุม',
    sourceDate: asOf,
    dataQuality: input.dataQuality || 'FIXTURE',
  });
}

function standardChecks(overrides = {}) {
  return {
    identityKycCurrent: true,
    suitabilityCurrent: true,
    mandateCurrent: true,
    liquidityCurrent: true,
    affectedGoalsConfirmed: true,
    holdingsNavCurrent: true,
    productEligibilityChecked: true,
    ...overrides,
  };
}

function makeClient(input) {
  return deepFreeze({
    clientId: input.clientId,
    displayRef: input.displayRef,
    name: input.name,
    initials: input.initials,
    segment: input.segment,
    owner: input.owner || 'RM คุณพลอย',
    sourceSystemRefs: deepClone(input.sourceSystemRefs || []),
    contact: {
      lastContactAt: input.lastContactAt || null,
      contacts7Days: input.contacts7Days || 0,
      contacts30Days: input.contacts30Days || 0,
      declinedContacts30Days: input.declinedContacts30Days || 0,
      preferredChannel: input.preferredChannel || 'CALL',
      quietHours: input.quietHours || '20:00-08:00',
      campaignOverlap: Boolean(input.campaignOverlap),
      maxContacts7Days: 2,
      maxContacts30Days: 5,
    },
  });
}

function makeSnapshot(input) {
  return deepFreeze({
    snapshotId: input.snapshotId,
    clientId: input.clientId,
    version: input.version || 1,
    asOf: input.asOf,
    checks: standardChecks(input.checks),
    suitability: {
      level: input.suitabilityLevel || 5,
      confirmedAt: input.suitabilityConfirmedAt || '2026-01-22',
      readOnlyForRm: true,
    },
    liquidity: {
      monthlyExpense: input.monthlyExpense,
      emergencyMonths: input.emergencyMonths || 6,
      currentlyLiquid: input.currentlyLiquid,
      currency: 'THB',
    },
    holdings: deepClone(input.holdings || []),
    goalIds: [...input.goalIds],
    questionsAlreadyAsked: deepClone(input.questionsAlreadyAsked || []),
    clientPreferences: deepClone(input.clientPreferences || {}),
    dataFreshness: deepClone(input.dataFreshness || {
      holdingsAsOf: input.asOf,
      navAsOf: input.asOf,
      kycAsOf: input.suitabilityConfirmedAt || '2026-01-22',
    }),
    sourceSystemRefs: deepClone(input.sourceSystemRefs || []),
  });
}

function demoHolding(fundId, masterFundId, name, value, assetClass, asOf, extra = {}) {
  return deepFreeze({
    fundId,
    masterFundId,
    name,
    registeredIn: 'TH',
    value,
    currency: 'THB',
    assetClass,
    shareClass: extra.shareClass || 'A',
    navAsOf: asOf,
    dataMode: 'FIXTURE',
    liquidity: extra.liquidity || 'ตรวจวันรับเงินจาก factsheet ก่อนทำรายการ',
    fee: extra.fee || 'ใช้ค่าธรรมเนียมจาก approved shelf/factsheet เมื่อเชื่อมข้อมูลจริง',
  });
}

function buildDemoFixtures() {
  const asOf = '2026-07-15';
  const clients = [
    makeClient({
      clientId: DEMO_IDS.clients.education, displayRef: 'FIN • 7K3P', name: 'คุณชญานิน อ.', initials: 'ชอ', segment: '5-15 ล้านบาท',
      sourceSystemRefs: [{ system: 'ROUND1_FIXTURE', key: 'C-4124' }], lastContactAt: '2026-06-25T10:30:00+07:00',
      contacts30Days: 1, preferredChannel: 'CALL',
    }),
    makeClient({
      clientId: DEMO_IDS.clients.missingData, displayRef: 'FIN • 2M8Q', name: 'คุณปิยะดา ล.', initials: 'ปล', segment: '5-15 ล้านบาท',
      sourceSystemRefs: [{ system: 'ROUND1_FIXTURE', key: 'C-5078' }], lastContactAt: '2026-05-11T09:00:00+07:00', preferredChannel: 'CONFIRM_DATA',
    }),
    makeClient({
      clientId: DEMO_IDS.clients.protection, displayRef: 'FIN • 9R4V', name: 'คุณณรินทร์ ว.', initials: 'ณว', segment: '15-50 ล้านบาท',
      sourceSystemRefs: [{ system: 'ROUND1_FIXTURE', key: 'C-1048' }], lastContactAt: '2026-06-01T11:00:00+07:00', preferredChannel: 'CALL',
    }),
    makeClient({
      clientId: DEMO_IDS.clients.retirementGrowth, displayRef: 'FIN • 5T1X', name: 'คุณวรัญญา ส.', initials: 'วส', segment: '2-5 ล้านบาท',
      lastContactAt: '2026-05-20T13:00:00+07:00', preferredChannel: 'MEETING',
    }),
    makeClient({
      clientId: DEMO_IDS.clients.surplusGrowth, displayRef: 'FIN • 4W6Z', name: 'คุณศิริพร จ.', initials: 'ศจ', segment: '5-15 ล้านบาท',
      lastContactAt: '2026-05-01T14:00:00+07:00', preferredChannel: 'REVIEWED_MESSAGE',
    }),
    makeClient({
      clientId: DEMO_IDS.clients.fatigued, displayRef: 'FIN • 8B2D', name: 'คุณอรทัย น.', initials: 'อน', segment: '2-5 ล้านบาท',
      lastContactAt: '2026-07-14T16:00:00+07:00', contacts7Days: 3, contacts30Days: 6, declinedContacts30Days: 2,
      campaignOverlap: true, preferredChannel: 'REVIEWED_MESSAGE',
    }),
    makeClient({
      clientId: DEMO_IDS.clients.handoff, displayRef: 'FIN • 1F7J', name: 'คุณกิตติศักดิ์ พ.', initials: 'กพ', segment: '15-50 ล้านบาท',
      sourceSystemRefs: [{ system: 'ROUND1_FIXTURE', key: 'C-6312' }], lastContactAt: '2026-07-01T10:00:00+07:00', preferredChannel: 'CALL',
    }),
    makeClient({
      clientId: DEMO_IDS.clients.completed, displayRef: 'FIN • 3H9M', name: 'คุณธนภพ ก.', initials: 'ธก', segment: '2-5 ล้านบาท',
      lastContactAt: '2026-07-15T08:30:00+07:00', contacts7Days: 1, contacts30Days: 2, preferredChannel: 'CALL',
    }),
  ];

  const educationHoldings = [
    demoHolding('TH-MMF-A', 'TH-MMF', 'กองทุนตลาดเงินไทย A', 420_000, 'เงินพร้อมใช้', asOf),
    demoHolding('TH-MMF-D', 'TH-MMF', 'กองทุนตลาดเงินไทย D', 200_000, 'เงินพร้อมใช้', asOf, { shareClass: 'D' }),
    demoHolding('TH-BOND-PLUS-A', 'TH-BOND-PLUS', 'กองทุนตราสารหนี้ไทย พลัส A', 2_000_000, 'ตราสารหนี้ไทย', asOf),
    demoHolding('TH-BOND-PLUS-D', 'TH-BOND-PLUS', 'กองทุนตราสารหนี้ไทย พลัส D', 1_100_000, 'ตราสารหนี้ไทย', asOf, { shareClass: 'D' }),
    demoHolding('TH-EQ-CORE-A', 'TH-EQ-CORE', 'กองทุนหุ้นไทยแกนหลัก A', 6_200_000, 'หุ้นไทย', asOf),
    demoHolding('TH-GLOBAL-A', 'TH-GLOBAL', 'กองทุนรวมไทยที่ลงทุนต่างประเทศ A', 2_480_000, 'สินทรัพย์ต่างประเทศ', asOf, { liquidity: 'ตรวจวันรับเงินและวันหยุดต่างประเทศจาก factsheet' }),
  ];

  const snapshots = [
    makeSnapshot({
      snapshotId: DEMO_IDS.snapshots.education, clientId: DEMO_IDS.clients.education, asOf, monthlyExpense: 145_000,
      currentlyLiquid: 620_000, goalIds: [DEMO_IDS.goals.educationReserve, DEMO_IDS.goals.education, DEMO_IDS.goals.educationRetirement],
      holdings: educationHoldings,
      questionsAlreadyAsked: ['ยอดค่าเรียนยังประมาณ 6.5 ล้านบาทหรือไม่', 'มีเงินใหม่ที่จะทยอยเติมใน 12 เดือนหรือไม่'],
      clientPreferences: { preferredChannel: 'CALL', avoidProductJargon: true, goalPriority: 'การศึกษาบุตร' },
      sourceSystemRefs: [{ system: 'ROUND1_FIXTURE', key: 'C-4124' }],
    }),
    makeSnapshot({
      snapshotId: DEMO_IDS.snapshots.missingData, clientId: DEMO_IDS.clients.missingData, asOf, monthlyExpense: 120_000,
      currentlyLiquid: 936_000, goalIds: [DEMO_IDS.goals.missingRetirement],
      checks: { identityKycCurrent: false, suitabilityCurrent: false, affectedGoalsConfirmed: false },
      holdings: [demoHolding('TH-BOND-PLUS-A', 'TH-BOND-PLUS', 'กองทุนตราสารหนี้ไทย พลัส A', 7_800_000, 'ตราสารหนี้ไทย', asOf)],
      clientPreferences: { preferredChannel: 'CONFIRM_DATA' },
      sourceSystemRefs: [{ system: 'ROUND1_FIXTURE', key: 'C-5078' }],
    }),
    makeSnapshot({
      snapshotId: DEMO_IDS.snapshots.protection, clientId: DEMO_IDS.clients.protection, asOf, monthlyExpense: 280_000,
      currentlyLiquid: 6_208_000, goalIds: [DEMO_IDS.goals.protection],
      holdings: [demoHolding('TH-MMF-A', 'TH-MMF', 'กองทุนตลาดเงินไทย A', 6_208_000, 'เงินพร้อมใช้', asOf)],
      questionsAlreadyAsked: ['ครอบครัวมีผู้พึ่งพารายได้กี่คน'], clientPreferences: { specialistConsent: false },
    }),
    makeSnapshot({
      snapshotId: DEMO_IDS.snapshots.retirementGrowth, clientId: DEMO_IDS.clients.retirementGrowth, asOf, monthlyExpense: 65_000,
      currentlyLiquid: 780_000, goalIds: [DEMO_IDS.goals.retirementGrowth],
      holdings: [demoHolding('TH-EQ-CORE-A', 'TH-EQ-CORE', 'กองทุนหุ้นไทยแกนหลัก A', 2_100_000, 'หุ้นไทย', asOf)],
    }),
    makeSnapshot({
      snapshotId: DEMO_IDS.snapshots.surplusGrowth, clientId: DEMO_IDS.clients.surplusGrowth, asOf, monthlyExpense: 90_000,
      currentlyLiquid: 2_200_000, goalIds: [DEMO_IDS.goals.surplusGrowth],
      holdings: [demoHolding('TH-MMF-A', 'TH-MMF', 'กองทุนตลาดเงินไทย A', 9_000_000, 'เงินพร้อมใช้', asOf)],
    }),
    makeSnapshot({
      snapshotId: DEMO_IDS.snapshots.fatigued, clientId: DEMO_IDS.clients.fatigued, asOf, monthlyExpense: 70_000,
      currentlyLiquid: 700_000, goalIds: [DEMO_IDS.goals.fatigued],
      holdings: [demoHolding('TH-BOND-PLUS-A', 'TH-BOND-PLUS', 'กองทุนตราสารหนี้ไทย พลัส A', 3_900_000, 'ตราสารหนี้ไทย', asOf)],
    }),
    makeSnapshot({
      snapshotId: DEMO_IDS.snapshots.handoff, clientId: DEMO_IDS.clients.handoff, asOf, monthlyExpense: 210_000,
      currentlyLiquid: 2_496_000, goalIds: [DEMO_IDS.goals.handoff],
      holdings: [demoHolding('TH-GLOBAL-A', 'TH-GLOBAL', 'กองทุนรวมไทยที่ลงทุนต่างประเทศ A', 31_200_000, 'สินทรัพย์ต่างประเทศ', asOf)],
    }),
    makeSnapshot({
      snapshotId: DEMO_IDS.snapshots.completed, clientId: DEMO_IDS.clients.completed, asOf, monthlyExpense: 80_000,
      currentlyLiquid: 600_000, goalIds: [DEMO_IDS.goals.completed],
      holdings: [demoHolding('TH-BOND-PLUS-A', 'TH-BOND-PLUS', 'กองทุนตราสารหนี้ไทย พลัส A', 3_400_000, 'ตราสารหนี้ไทย', asOf)],
    }),
  ];

  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.snapshotId, snapshot]));
  const ledgerConfigs = [
    {
      clientId: DEMO_IDS.clients.education, snapshotId: DEMO_IDS.snapshots.education, totalWealth: 12_400_000, monthlyExpense: 145_000,
      currentlyLiquid: 620_000,
      capitalLots: [
        { lotId: 'lot_7K3P_liquid', amount: 620_000 },
        { lotId: 'lot_7K3P_education', amount: 4_800_000 },
        { lotId: 'lot_7K3P_longterm', amount: 6_980_000 },
      ],
      goals: [
        { goalId: DEMO_IDS.goals.educationReserve, type: 'EMERGENCY_RESERVE', name: 'เงินสำรองฉุกเฉิน', target: 870_000, targetDate: 'พร้อมใช้ตลอดเวลา', capitalLotIds: ['lot_7K3P_liquid'], baseSuccessProbability: 0.713, stressSuccessProbability: 0.62, requiredMonthlyContribution: 20_834, nextReview: '2026-08-15' },
        { goalId: DEMO_IDS.goals.education, type: 'EDUCATION', name: 'ค่าเรียนบุตร', target: 6_500_000, targetDate: '2030-07-01', capitalLotIds: ['lot_7K3P_education'], baseSuccessProbability: 0.72, stressSuccessProbability: 0.43, requiredMonthlyContribution: 25_000, nextReview: '2026-10-15' },
        { goalId: DEMO_IDS.goals.educationRetirement, type: 'RETIREMENT', name: 'เกษียณ', target: 24_000_000, targetDate: '2043-12-31', capitalLotIds: ['lot_7K3P_longterm'], baseSuccessProbability: 0.66, stressSuccessProbability: 0.51, requiredMonthlyContribution: 38_000, nextReview: '2027-01-15' },
      ],
    },
    { clientId: DEMO_IDS.clients.missingData, snapshotId: DEMO_IDS.snapshots.missingData, totalWealth: 7_800_000, monthlyExpense: 120_000, currentlyLiquid: 936_000, capitalLots: [{ lotId: 'lot_2M8Q_ret', amount: 7_800_000 }], goals: [{ goalId: DEMO_IDS.goals.missingRetirement, type: 'RETIREMENT', name: 'เกษียณ (รอยืนยัน)', target: 20_000_000, targetDate: '2038-12-31', capitalLotIds: ['lot_2M8Q_ret'], baseSuccessProbability: 0.5, stressSuccessProbability: 0.3, requiredMonthlyContribution: 30_000, nextReview: 'หลังยืนยันข้อมูล' }] },
    { clientId: DEMO_IDS.clients.protection, snapshotId: DEMO_IDS.snapshots.protection, totalWealth: 48_500_000, monthlyExpense: 280_000, currentlyLiquid: 6_208_000, capitalLots: [{ lotId: 'lot_9R4V_main', amount: 48_500_000 }], goals: [{ goalId: DEMO_IDS.goals.protection, type: 'PROTECTION', name: 'ความมั่นคงของครอบครัว', target: 50_000_000, targetDate: 'ทบทวนปีนี้', capitalLotIds: ['lot_9R4V_main'], baseSuccessProbability: 0.8, stressSuccessProbability: 0.55, requiredMonthlyContribution: 0, nextReview: '2026-08-15' }] },
    { clientId: DEMO_IDS.clients.retirementGrowth, snapshotId: DEMO_IDS.snapshots.retirementGrowth, totalWealth: 2_100_000, monthlyExpense: 65_000, currentlyLiquid: 780_000, capitalLots: [{ lotId: 'lot_5T1X_ret', amount: 2_100_000 }], goals: [{ goalId: DEMO_IDS.goals.retirementGrowth, type: 'RETIREMENT', name: 'เกษียณ', target: 8_000_000, targetDate: '2044-12-31', capitalLotIds: ['lot_5T1X_ret'], baseSuccessProbability: 0.74, stressSuccessProbability: 0.59, requiredMonthlyContribution: 10_000, nextReview: '2026-11-15' }] },
    { clientId: DEMO_IDS.clients.surplusGrowth, snapshotId: DEMO_IDS.snapshots.surplusGrowth, totalWealth: 9_000_000, monthlyExpense: 90_000, currentlyLiquid: 2_200_000, capitalLots: [{ lotId: 'lot_4W6Z_cash', amount: 2_200_000 }, { lotId: 'lot_4W6Z_wealth', amount: 6_800_000 }], goals: [{ goalId: DEMO_IDS.goals.surplusGrowth, type: 'WEALTH_GROWTH', name: 'เพิ่มความมั่งคั่งระยะยาว', target: 15_000_000, targetDate: '2038-12-31', capitalLotIds: ['lot_4W6Z_cash', 'lot_4W6Z_wealth'], baseSuccessProbability: 0.78, stressSuccessProbability: 0.64, requiredMonthlyContribution: 15_000, nextReview: '2026-12-15' }] },
    { clientId: DEMO_IDS.clients.fatigued, snapshotId: DEMO_IDS.snapshots.fatigued, totalWealth: 3_900_000, monthlyExpense: 70_000, currentlyLiquid: 700_000, capitalLots: [{ lotId: 'lot_8B2D_main', amount: 3_900_000 }], goals: [{ goalId: DEMO_IDS.goals.fatigued, type: 'WEALTH_GROWTH', name: 'เติบโตระยะยาว', target: 7_000_000, targetDate: '2036-12-31', capitalLotIds: ['lot_8B2D_main'], baseSuccessProbability: 0.7, stressSuccessProbability: 0.58, requiredMonthlyContribution: 8_000, nextReview: '2027-01-15' }] },
    { clientId: DEMO_IDS.clients.handoff, snapshotId: DEMO_IDS.snapshots.handoff, totalWealth: 31_200_000, monthlyExpense: 210_000, currentlyLiquid: 2_496_000, capitalLots: [{ lotId: 'lot_1F7J_edu', amount: 31_200_000 }], goals: [{ goalId: DEMO_IDS.goals.handoff, type: 'EDUCATION', name: 'ค่าเรียนต่างประเทศ', target: 4_500_000, targetDate: '2029-07-01', capitalLotIds: ['lot_1F7J_edu'], baseSuccessProbability: 0.82, stressSuccessProbability: 0.6, requiredMonthlyContribution: 0, nextReview: '2026-07-18' }] },
    { clientId: DEMO_IDS.clients.completed, snapshotId: DEMO_IDS.snapshots.completed, totalWealth: 3_400_000, monthlyExpense: 80_000, currentlyLiquid: 600_000, capitalLots: [{ lotId: 'lot_3H9M_home', amount: 3_400_000 }], goals: [{ goalId: DEMO_IDS.goals.completed, type: 'HOME', name: 'ซื้อบ้าน', target: 5_000_000, targetDate: '2032-12-31', capitalLotIds: ['lot_3H9M_home'], baseSuccessProbability: 0.76, stressSuccessProbability: 0.61, requiredMonthlyContribution: 20_000, nextReview: '2027-01-15' }] },
  ];

  const ledgers = ledgerConfigs.map((config) => {
    const input = { ...config, asOf };
    const resultRef = buildResultRef(config.clientId, input);
    return buildGoalLedger({ ...input, resultRef });
  });
  const ledgerByClient = new Map(ledgers.map((ledger) => [ledger.clientId, ledger]));

  function evidenceFor(clientId, values) {
    const ledger = ledgerByClient.get(clientId);
    return values.map((value) => makeEvidence(ledger.resultRef, asOf, value));
  }

  const actionInputs = [
    {
      actionId: DEMO_IDS.actions.education, clientId: DEMO_IDS.clients.education, snapshotId: DEMO_IDS.snapshots.education,
      lane: 'CARE', domain: 'INVESTMENT', affectedGoalIds: [DEMO_IDS.goals.education], priorityTier: 'P0', supportingScore: 96,
      title: 'ลดความเสี่ยงของเงินค่าเรียนก่อนเป้าหมายใกล้ขึ้น',
      whyNow: 'ควรติดต่อวันนี้ เพราะสินทรัพย์เสี่ยงคิดเป็น 70% ของพอร์ต เป้าหมายค่าเรียนบุตรเหลือ 4 ปี และเงินสำรองยังขาด 250,000 บาท',
      clientBenefit: 'ช่วยแยกเงินค่าเรียนและเงินสำรองออกจากความผันผวนที่ไม่จำเป็นก่อนตัดสินใจเรื่องกองทุน',
      channel: 'CALL', owner: 'RM คุณพลอย', dueAt: '2026-07-15T17:00:00+07:00', mandatoryCare: true, estimatedMinutes: 12,
      evidence: evidenceFor(DEMO_IDS.clients.education, [
        { evidenceId: 'ev_risky_share', label: 'สัดส่วนสินทรัพย์เสี่ยง', plainMeaning: 'เงิน 70 จากทุก 100 บาทยังผันผวนตามหุ้นและตลาดต่างประเทศ', actionImplication: 'ยืนยันเงินที่จะใช้ใน 4 ปี ก่อนพิจารณาลดความเสี่ยง', value: 0.70, unit: 'ratio', formulaId: 'RISKY_HOLDINGS_VALUE_DIV_PORTFOLIO_VALUE', reasonCodes: ['RISK_OVER_GOAL_BUDGET'] },
        { evidenceId: 'ev_goal_shortfall', label: 'เงินค่าเรียนที่ยังขาดจากยอดเป้าหมายวันนี้', plainMeaning: 'เงินที่แยกให้เป้าหมายยังต่ำกว่ายอดเป้าหมาย 1.7 ล้านบาท', actionImplication: 'ถามวันจ่ายจริงและแผนเติมเงินก่อนเปรียบเทียบทางเลือก', value: 1_700_000, unit: 'THB', formulaId: 'MAX_GOAL_TARGET_MINUS_CURRENT_FUNDING_ZERO', reasonCodes: ['GOAL_SHORTFALL'] },
        { evidenceId: 'ev_reserve_gap', label: 'เงินสำรองที่ยังขาด', plainMeaning: 'เงินพร้อมใช้ต่ำกว่าเกณฑ์ 6 เดือนอยู่ 250,000 บาท', actionImplication: 'ห้ามนำเงินสำรองไปเพิ่มความเสี่ยง และควรเติมส่วนขาดก่อน', value: 250_000, unit: 'THB', formulaId: 'MAX_REQUIRED_RESERVE_MINUS_CURRENT_LIQUIDITY_ZERO', reasonCodes: ['LIQUIDITY_RESERVE_SHORTFALL'] },
      ]),
      reasonCodes: ['MANDATORY_CARE', 'GOAL_DUE_SOON', 'RISK_OVER_GOAL_BUDGET', 'LIQUIDITY_RESERVE_SHORTFALL'], missingData: [],
      approvedExplanation: 'พอร์ตไม่ได้ผิดเพียงเพราะมีหุ้นมาก แต่เงินค่าเรียนมีเวลาฟื้นตัวจำกัด จึงควรยืนยันยอดและวันที่ แล้วค่อยลดความเสี่ยงเฉพาะส่วนที่เกี่ยวข้อง',
      draftedMessage: 'สวัสดีค่ะคุณชญานิน อยากขอเวลาทบทวนเงินค่าเรียนบุตรและเงินสำรองประมาณ 12 นาที เพื่อยืนยันวันใช้เงินจริงก่อนพิจารณาทางเลือกค่ะ',
      specialistType: 'ผู้เชี่ยวชาญการลงทุนและวางแผนเป้าหมาย', state: 'ELIGIBLE',
      conversationCoach: {
        objective: 'ยืนยันเป้าหมายและสภาพคล่องก่อนพูดถึงการปรับพอร์ต',
        opening: 'วันนี้ขอเริ่มจากเงินที่ต้องใช้แน่นอนก่อนนะคะ แล้วค่อยดูว่าส่วนใดควรรับความเสี่ยงต่อ',
        questions: ['ยอดค่าเรียน 6.5 ล้านบาทและวันจ่ายงวดแรกยังเหมือนเดิมหรือไม่', 'มีเงินใหม่ที่จะเติมใน 12 เดือนหรือไม่', 'ต้องการสำรองค่าใช้จ่ายครอบครัวกี่เดือน'],
        factsToExplain: ['สินทรัพย์เสี่ยง 70% ของพอร์ต', 'เงินค่าเรียนที่แยกไว้ 4.8 ล้านบาท', 'เงินสำรองต่ำกว่า 6 เดือน 250,000 บาท'],
        warnings: ['อย่ารับประกันผลตอบแทน', 'อย่าเสนอซื้อขายก่อนยืนยันข้อมูล'],
      },
    },
    {
      actionId: DEMO_IDS.actions.missingData, clientId: DEMO_IDS.clients.missingData, snapshotId: DEMO_IDS.snapshots.missingData,
      lane: 'CARE', domain: 'DATA', affectedGoalIds: [DEMO_IDS.goals.missingRetirement], priorityTier: 'P1', supportingScore: 99,
      title: 'ยืนยันข้อมูลก่อนวิเคราะห์แผนเกษียณ', whyNow: 'ข้อมูล KYC ความเหมาะสม และเป้าหมายเกษียณยังไม่ยืนยัน จึงยังวิเคราะห์ได้ไม่ครบ',
      clientBenefit: 'ป้องกันคำแนะนำจากข้อมูลเก่าหรือขัดกัน', channel: 'CALL', owner: 'RM คุณพลอย', dueAt: '2026-07-16T17:00:00+07:00', estimatedMinutes: 4,
      evidence: evidenceFor(DEMO_IDS.clients.missingData, [{ evidenceId: 'ev_missing_count', label: 'รายการข้อมูลสำคัญที่ไม่ผ่าน', plainMeaning: 'มี 3 กลุ่มข้อมูลที่ต้องยืนยัน', actionImplication: 'ทำได้เพียงขอข้อมูลเพิ่ม', value: 3, unit: 'items', formulaId: 'COUNT_FAILED_HARD_DATA_GATES', reasonCodes: ['MISSING_CRITICAL_DATA'] }]),
      reasonCodes: ['MISSING_CRITICAL_DATA', 'SUITABILITY_STALE'], missingData: [], approvedExplanation: 'ยังไม่ควรแนะนำกองทุนจนกว่าข้อมูลสำคัญจะพร้อม', draftedMessage: 'ขอรบกวนยืนยันข้อมูลสั้น ๆ 3 เรื่องก่อนทบทวนแผนเกษียณนะคะ', specialistType: null, state: 'ELIGIBLE',
    },
    {
      actionId: DEMO_IDS.actions.protection, clientId: DEMO_IDS.clients.protection, snapshotId: DEMO_IDS.snapshots.protection,
      lane: 'CARE', domain: 'PROTECTION', affectedGoalIds: [DEMO_IDS.goals.protection], priorityTier: 'P1', supportingScore: 84,
      title: 'ทบทวนความคุ้มครองของผู้พึ่งพารายได้', whyNow: 'ลูกค้าเคยถามเรื่องความคุ้มครองและมีผู้พึ่งพารายได้ แต่ยังไม่ยืนยันวงเงินเดิม',
      clientBenefit: 'ช่วยหา gap ก่อนส่งต่อโดยไม่เลือกผลิตภัณฑ์แทนลูกค้า', channel: 'CALL', owner: 'RM คุณพลอย', dueAt: '2026-07-17T17:00:00+07:00', estimatedMinutes: 8,
      evidence: evidenceFor(DEMO_IDS.clients.protection, [{ evidenceId: 'ev_dependants', label: 'ผู้พึ่งพารายได้ที่ต้องยืนยัน', plainMeaning: 'บันทึกเดิมระบุ 2 คน แต่ต้องถามลูกค้าอีกครั้ง', actionImplication: 'ถามภาระและความคุ้มครองเดิมก่อนส่งต่อ', value: 2, unit: 'persons', formulaId: 'APPROVED_CRM_FACT', reasonCodes: ['PROTECTION_REVIEW'] }]),
      reasonCodes: ['PROTECTION_REVIEW', 'CLIENT_ASKED_PREVIOUSLY'], missingData: [], approvedExplanation: 'เริ่มจากความต้องการของครอบครัว ไม่เริ่มจากผลิตภัณฑ์', draftedMessage: 'ขอเวลาทบทวนความคุ้มครองที่คุณเคยสอบถาม เพื่อสรุปข้อมูลก่อนส่งให้ผู้เชี่ยวชาญค่ะ', specialistType: 'ผู้เชี่ยวชาญด้านความคุ้มครอง', state: 'ELIGIBLE',
    },
    {
      actionId: DEMO_IDS.actions.retirementGrowth, clientId: DEMO_IDS.clients.retirementGrowth, snapshotId: DEMO_IDS.snapshots.retirementGrowth,
      lane: 'GROWTH', domain: 'RETIREMENT', affectedGoalIds: [DEMO_IDS.goals.retirementGrowth], priorityTier: 'P2', supportingScore: 98,
      title: 'ทบทวนเงินเติมเพื่อเป้าหมายเกษียณ', whyNow: 'เป้าหมายระยะยาวยังมีเวลา แต่เงินเติมรายเดือนอาจช่วยเพิ่ม buffer ได้', clientBenefit: 'ให้ลูกค้าเห็นทางเลือกเพิ่มเงินโดยไม่เร่งขายผลิตภัณฑ์',
      channel: 'MEETING', owner: 'RM คุณพลอย', dueAt: '2026-07-22T17:00:00+07:00', estimatedMinutes: 0,
      evidence: evidenceFor(DEMO_IDS.clients.retirementGrowth, [{ evidenceId: 'ev_base_prob', label: 'ค่าตัวอย่างของเป้าหมายในฉากฐาน', plainMeaning: 'fixture สำหรับสาธิต workflow ระบุ 74% แต่ยังไม่ใช่ผลจาก goal projection calculator', actionImplication: 'ใช้เปิดการทบทวนข้อมูลเท่านั้น ไม่ใช้เป็นคำรับประกันหรือคำแนะนำ', value: 0.74, unit: 'probability', formulaId: 'FIXTURE_GOAL_PROJECTION_INPUT_V1', reasonCodes: ['RETIREMENT_OPPORTUNITY', 'FIXTURE_INPUT_NOT_CALCULATED'] }]),
      reasonCodes: ['RETIREMENT_OPPORTUNITY'], missingData: [], approvedExplanation: 'ยังไม่เร่งด่วนเพราะไม่มีการละเมิดกรอบและเป้าหมายยังมีเวลา', draftedMessage: 'หากสะดวก เราสามารถทบทวนเงินเติมเพื่อเพิ่ม buffer ของเป้าหมายเกษียณได้ค่ะ', specialistType: null, state: 'ELIGIBLE',
    },
    {
      actionId: DEMO_IDS.actions.surplusGrowth, clientId: DEMO_IDS.clients.surplusGrowth, snapshotId: DEMO_IDS.snapshots.surplusGrowth,
      lane: 'GROWTH', domain: 'LIQUIDITY', affectedGoalIds: [DEMO_IDS.goals.surplusGrowth], priorityTier: 'P2', supportingScore: 82,
      title: 'ถามแผนใช้เงินสดส่วนเกิน', whyNow: 'เงินพร้อมใช้สูงกว่าเงินสำรอง 6 เดือน แต่ยังไม่ทราบแผนใช้เงิน 12 เดือน', clientBenefit: 'แยกเงินที่จะใช้จริงก่อนพิจารณาทางเลือกเติบโต',
      channel: 'REVIEWED_MESSAGE', owner: 'RM คุณพลอย', dueAt: '2026-07-24T17:00:00+07:00', estimatedMinutes: 0,
      evidence: evidenceFor(DEMO_IDS.clients.surplusGrowth, [{ evidenceId: 'ev_surplus_cash', label: 'เงินพร้อมใช้เหนือเกณฑ์สำรอง', plainMeaning: 'มีเงินสดมากกว่าเกณฑ์ 6 เดือน 1.66 ล้านบาท', actionImplication: 'ถามแผนใช้เงินก่อน และยอมรับผลว่าอาจยังไม่ต้องทำอะไร', value: 1_660_000, unit: 'THB', formulaId: 'MAX_CURRENT_LIQUIDITY_MINUS_REQUIRED_RESERVE_ZERO', reasonCodes: ['POTENTIAL_SURPLUS_CASH'] }]),
      reasonCodes: ['POTENTIAL_SURPLUS_CASH'], missingData: [], approvedExplanation: 'เงินสดสูงไม่ได้แปลว่าต้องลงทุนทันที ต้องถามแผนใช้เงินก่อน', draftedMessage: 'อยากขอยืนยันแผนใช้เงินใน 12 เดือน เพื่อดูว่าส่วนใดควรคงพร้อมใช้ค่ะ', specialistType: null, state: 'ELIGIBLE',
    },
    {
      actionId: DEMO_IDS.actions.fatigued, clientId: DEMO_IDS.clients.fatigued, snapshotId: DEMO_IDS.snapshots.fatigued,
      lane: 'GROWTH', domain: 'INVESTMENT', affectedGoalIds: [DEMO_IDS.goals.fatigued], priorityTier: 'P2', supportingScore: 95,
      title: 'ยังไม่ควรติดต่อเพิ่ม', whyNow: 'ลูกค้าได้รับการติดต่อเกินเพดานและปฏิเสธซ้ำ จึงควรรอรอบทบทวนถัดไป', clientBenefit: 'ลดการรบกวนและการเสนอซ้ำซ้อน',
      channel: 'NO_ACTION', owner: 'RM คุณพลอย', dueAt: '2026-08-01T17:00:00+07:00', estimatedMinutes: 0,
      evidence: evidenceFor(DEMO_IDS.clients.fatigued, [{ evidenceId: 'ev_contacts', label: 'จำนวนการติดต่อ 7 วัน', plainMeaning: 'ติดต่อแล้ว 3 ครั้ง เกินเพดานสาธิต 2 ครั้ง', actionImplication: 'ไม่ติดต่อเพิ่ม เว้นแต่เกิด Care ที่จำเป็น', value: 3, unit: 'contacts', formulaId: 'CRM_CONTACT_COUNT_7D', reasonCodes: ['CONTACT_FATIGUE'] }]),
      reasonCodes: ['CONTACT_FATIGUE', 'NO_ACTION_VALID'], missingData: [], approvedExplanation: 'ยังไม่ควรทำอะไร เพราะการติดต่อเพิ่มไม่มีประโยชน์เพียงพอและอาจรบกวนลูกค้า', draftedMessage: null, specialistType: null, state: 'ELIGIBLE',
    },
    {
      actionId: DEMO_IDS.actions.handoff, clientId: DEMO_IDS.clients.handoff, snapshotId: DEMO_IDS.snapshots.handoff,
      lane: 'CARE', domain: 'INVESTMENT', affectedGoalIds: [DEMO_IDS.goals.handoff], priorityTier: 'P1', supportingScore: 78,
      title: 'ติดตามผู้เชี่ยวชาญด้านเงินต่างประเทศ', whyNow: 'การส่งต่อเลยกำหนดรับเคสและเป้าหมายมีการใช้เงินต่างประเทศ', clientBenefit: 'ไม่ให้ลูกค้าต้องเล่าบริบทซ้ำ',
      channel: 'HANDOFF', owner: 'ผู้เชี่ยวชาญ FX', dueAt: '2026-07-14T15:00:00+07:00', estimatedMinutes: 0,
      evidence: evidenceFor(DEMO_IDS.clients.handoff, [{ evidenceId: 'ev_handoff_age', label: 'จำนวนวันที่เกินกำหนด', plainMeaning: 'เกินกำหนดรับเคส 1 วัน', actionImplication: 'RM ติดตามเจ้าของเคส ไม่ส่งข้อมูลใหม่อัตโนมัติ', value: 1, unit: 'days', formulaId: 'BUSINESS_DATE_OVERDUE_COUNT', reasonCodes: ['HANDOFF_OVERDUE'] }]),
      reasonCodes: ['HANDOFF_OVERDUE', 'FX_GOAL'], missingData: [], approvedExplanation: 'ผู้เชี่ยวชาญต้องรับบริบทที่ RM ตรวจแล้ว', draftedMessage: null, specialistType: 'ผู้เชี่ยวชาญด้านเงินตราต่างประเทศ', state: 'SCHEDULED_OR_HANDOFF',
    },
    {
      actionId: DEMO_IDS.actions.completed, clientId: DEMO_IDS.clients.completed, snapshotId: DEMO_IDS.snapshots.completed,
      lane: 'CARE', domain: 'SERVICE', affectedGoalIds: [DEMO_IDS.goals.completed], priorityTier: 'P2', supportingScore: 70,
      title: 'ปิดการติดตามข้อสงสัยค่าธรรมเนียม', whyNow: 'RM อธิบายและบันทึกผลแล้ว', clientBenefit: 'ลูกค้าได้รับคำตอบและวันทบทวนถัดไป',
      channel: 'CALL', owner: 'RM คุณพลอย', dueAt: '2026-07-15T09:00:00+07:00', estimatedMinutes: 0,
      evidence: evidenceFor(DEMO_IDS.clients.completed, [{ evidenceId: 'ev_completed', label: 'การดำเนินการเสร็จแล้ว', plainMeaning: 'ปิดงาน 1 รายการวันนี้', actionImplication: 'รอรอบทบทวนถัดไป', value: 1, unit: 'actions', formulaId: 'COUNT_COMPLETED_ACTIONS', reasonCodes: ['COMPLETED'] }]),
      reasonCodes: ['COMPLETED'], missingData: [], approvedExplanation: 'บันทึกผลตามที่ลูกค้ายืนยัน', draftedMessage: null, specialistType: null, state: 'COMPLETED',
      updatedAt: '2026-07-15T08:45:00+07:00', outcome: { code: 'CLIENT_UNDERSTOOD', note: 'ลูกค้ายืนยันว่าได้รับคำอธิบายครบ', nextReview: '2027-01-15' },
    },
  ];

  const actions = actionInputs.map((input, index) => {
    const ledger = ledgerByClient.get(input.clientId);
    return createActionCard({
      ...input,
      resultRef: ledger.resultRef,
      modelRunId: ledger.resultRef.modelRunId,
      createdAt: `2026-07-${String(10 + Math.min(index, 4)).padStart(2, '0')}T08:00:00+07:00`,
    }, snapshotById.get(input.snapshotId));
  });

  assertUniqueEntityIds({ clients, snapshots, ledgers, actions });
  return deepFreeze({ asOf, clients, snapshots, ledgers, actions });
}

function assertUniqueEntityIds(collections) {
  const specs = [
    ['clientId', collections.clients || []],
    ['snapshotId', collections.snapshots || []],
    ['ledgerId', collections.ledgers || []],
    ['actionId', collections.actions || []],
  ];
  for (const [field, rows] of specs) {
    const seen = new Set();
    for (const row of rows) {
      const value = row[field];
      assertNonEmptyString(value, field);
      if (seen.has(value)) throw new Error(`duplicate ${field}: ${value}`);
      seen.add(value);
    }
  }
  const goalIds = new Set();
  for (const ledger of collections.ledgers || []) {
    for (const goal of ledger.goals) {
      if (goalIds.has(goal.goalId)) throw new Error(`duplicate goalId: ${goal.goalId}`);
      goalIds.add(goal.goalId);
    }
  }
  return true;
}

function publicClient(client) {
  const output = deepClone(client);
  delete output.sourceSystemRefs;
  return output;
}

function publicSnapshot(snapshot) {
  const output = deepClone(snapshot);
  delete output.sourceSystemRefs;
  return output;
}

function assertHumanActor(actor) {
  if (!actor || typeof actor !== 'object') throw new TypeError('a human actor is required');
  assertNonEmptyString(actor.actorId, 'actor.actorId');
  assertNonEmptyString(actor.role, 'actor.role');
  if (['SYSTEM', 'LLM', 'MODEL', 'AI'].includes(actor.role.toUpperCase()) || actor.isHuman === false) {
    throw new Error('human decisions cannot be recorded by a system, model, or LLM actor');
  }
}

function canTransition(previousState, nextState) {
  return Boolean(ALLOWED_TRANSITIONS[previousState] && ALLOWED_TRANSITIONS[previousState].includes(nextState));
}

class CockpitEngine {
  #clients;
  #snapshots;
  #ledgers;
  #actions;
  #auditEvents;
  #idempotency;
  #handoffs;
  #qualityLabels;
  #clock;
  #sequence;
  #asOf;

  constructor(options = {}) {
    const fixtures = options.fixtures ? deepClone(options.fixtures) : buildDemoFixtures();
    assertUniqueEntityIds(fixtures);
    this.#clients = new Map(fixtures.clients.map((item) => [item.clientId, deepFreeze(deepClone(item))]));
    this.#snapshots = new Map(fixtures.snapshots.map((item) => [item.snapshotId, deepFreeze(deepClone(item))]));
    this.#ledgers = new Map(fixtures.ledgers.map((item) => [item.clientId, deepFreeze(deepClone(item))]));
    this.#actions = new Map(fixtures.actions.map((item) => [item.actionId, deepFreeze(deepClone(item))]));
    this.#auditEvents = [];
    this.#idempotency = new Map();
    this.#handoffs = new Map();
    this.#qualityLabels = [];
    this.#clock = typeof options.clock === 'function' ? options.clock : () => '2026-07-15T09:00:00+07:00';
    this.#sequence = 0;
    this.#asOf = fixtures.asOf || '2026-07-15';
    for (const action of this.#actions.values()) {
      this.#appendAudit({
        actionId: action.actionId,
        eventType: 'ACTION_CREATED',
        actor: { actorId: 'system_fixture', role: 'SYSTEM' },
        at: action.createdAt,
        reason: 'สร้าง Action Card จากข้อมูลสาธิตที่ควบคุมแล้ว',
        previousState: null,
        nextState: action.state,
        requestId: null,
        payload: { modelRunId: action.modelRunId, resultRef: action.resultRef },
      });
    }
  }

  #resolveClientId(clientIdOrSourceRef) {
    if (this.#clients.has(clientIdOrSourceRef)) return clientIdOrSourceRef;
    for (const client of this.#clients.values()) {
      if ((client.sourceSystemRefs || []).some((ref) => ref.key === clientIdOrSourceRef)) return client.clientId;
    }
    throw new Error(`unknown client: ${clientIdOrSourceRef}`);
  }

  #requireAction(actionId) {
    const action = this.#actions.get(actionId);
    if (!action) throw new Error(`unknown action: ${actionId}`);
    return action;
  }

  #appendAudit(input) {
    this.#sequence += 1;
    const event = deepFreeze({
      eventId: `evt_${String(this.#sequence).padStart(6, '0')}`,
      actionId: input.actionId,
      eventType: input.eventType,
      actor: deepClone(input.actor),
      at: input.at || this.#clock(),
      reason: input.reason,
      previousState: input.previousState,
      nextState: input.nextState,
      requestId: input.requestId || null,
      payload: deepClone(input.payload || {}),
    });
    this.#auditEvents.push(event);
    return event;
  }

  #withIdempotency(operation, requestId, payload, callback) {
    assertNonEmptyString(requestId, 'requestId');
    const key = `${operation}:${requestId}`;
    const fingerprint = deterministicHash(payload);
    const prior = this.#idempotency.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Error(`idempotency conflict for ${requestId}`);
      return deepClone(prior.result);
    }
    const result = callback();
    this.#idempotency.set(key, deepFreeze({ fingerprint, result: deepClone(result) }));
    return deepClone(result);
  }

  #applyTransition(action, nextState, context, patch = {}, eventType = 'STATE_TRANSITION') {
    if (!canTransition(action.state, nextState)) throw new Error(`transition ${action.state} -> ${nextState} is not allowed`);
    const at = this.#clock();
    const updated = deepFreeze({ ...deepClone(action), ...deepClone(patch), state: nextState, updatedAt: at });
    validateActionCard(updated);
    this.#actions.set(action.actionId, updated);
    this.#appendAudit({
      actionId: action.actionId,
      eventType,
      actor: context.actor,
      at,
      reason: context.reason,
      previousState: action.state,
      nextState,
      requestId: context.requestId,
      payload: context.payload || {},
    });
    return updated;
  }

  getToday(options = {}) {
    const now = options.now || this.#clock();
    const capacity = Number.isFinite(options.callCapacityMinutes) ? Math.max(0, options.callCapacityMinutes) : 40;
    const requestedMax = Number.isInteger(options.maxCases) ? options.maxCases : 5;
    const maxCases = Math.max(0, Math.min(5, requestedMax));
    const allActions = [...this.#actions.values()];
    const openStates = new Set(['DETECTED', 'DATA_CHECK', 'CONFIRM_DATA', 'BLOCKED', 'ELIGIBLE', 'HUMAN_REVIEW']);
    const candidates = rankActions(allActions.filter((action) => openStates.has(action.state))).ordered;
    const selected = [];
    const deferredForCapacity = [];
    const deferredForContact = [];
    let usedCallMinutes = 0;
    for (const action of candidates) {
      const client = this.#clients.get(action.clientId);
      const contact = evaluateContactPolicy(client.contact, action, now);
      if (!contact.allowedNow || action.channel === 'NO_ACTION') {
        deferredForContact.push({ actionId: action.actionId, clientRef: client.displayRef, reason: contact.reasons.join(' · ') || action.whyNow });
        continue;
      }
      const callMinutes = action.channel === 'CALL' ? action.estimatedMinutes : 0;
      if (usedCallMinutes + callMinutes > capacity) {
        deferredForCapacity.push({ actionId: action.actionId, clientRef: client.displayRef, estimatedMinutes: callMinutes });
        continue;
      }
      if (selected.length >= maxCases) continue;
      usedCallMinutes += callMinutes;
      const ledger = this.#ledgers.get(action.clientId);
      const goalNames = action.affectedGoalIds.map((goalId) => ledger.goals.find((goal) => goal.goalId === goalId)).filter(Boolean).map((goal) => goal.name);
      selected.push({
        actionId: action.actionId,
        clientId: action.clientId,
        clientRef: client.displayRef,
        clientName: client.name,
        lane: action.lane,
        domain: action.domain,
        priorityTier: action.priorityTier,
        title: action.title,
        whyThisClient: action.whyNow,
        affectedGoals: goalNames,
        channel: action.channel,
        state: action.state,
        dueAt: action.dueAt,
        estimatedMinutes: action.estimatedMinutes,
        resultRef: deepClone(action.resultRef),
        dataGate: deepClone(action.dataGate),
        contactPolicy: contact,
      });
    }
    for (let index = 0; index < selected.length; index += 1) {
      selected[index].whyLowerThanPrevious = index === 0 ? null : lowerPriorityExplanation(candidates.find((item) => item.actionId === selected[index - 1].actionId), candidates.find((item) => item.actionId === selected[index].actionId));
      selected[index].whyNextClientIsLower = index + 1 < selected.length
        ? lowerPriorityExplanation(candidates.find((item) => item.actionId === selected[index].actionId), candidates.find((item) => item.actionId === selected[index + 1].actionId))
        : null;
    }

    const overdueHandoffs = allActions.filter((action) => action.state === 'SCHEDULED_OR_HANDOFF' && action.dueAt && new Date(action.dueAt) < new Date(now)).map((action) => {
      const client = this.#clients.get(action.clientId);
      return { actionId: action.actionId, clientRef: client.displayRef, clientName: client.name, dueAt: action.dueAt, specialistType: action.specialistType };
    });
    const completedToday = allActions.filter((action) => action.state === 'COMPLETED' && String(action.updatedAt).slice(0, 10) === String(now).slice(0, 10)).length;
    return deepFreeze({
      asOf: this.#asOf,
      generatedAt: now,
      counters: {
        p0Care: allActions.filter((action) => action.lane === 'CARE' && action.priorityTier === 'P0' && action.state !== 'COMPLETED').length,
        p1Care: allActions.filter((action) => action.lane === 'CARE' && action.priorityTier === 'P1' && action.state !== 'COMPLETED').length,
        growthOpportunities: allActions.filter((action) => action.lane === 'GROWTH' && !['COMPLETED', 'DISMISSED', 'EXPIRED_OR_CANCELLED'].includes(action.state)).length,
        profileDataCases: allActions.filter((action) => action.domain === 'DATA' && action.state === 'CONFIRM_DATA').length,
        overdueHandoffs: overdueHandoffs.length,
        completedToday,
        noAction: allActions.filter((action) => action.channel === 'NO_ACTION' || action.state === 'DISMISSED').length,
      },
      capacity: {
        totalCallMinutes: capacity,
        allocatedCallMinutes: usedCallMinutes,
        remainingCallMinutes: Math.max(0, capacity - usedCallMinutes),
        deferredForCapacity,
      },
      topCases: selected,
      overdueHandoffs,
      deferredForContact,
      controls: {
        maxCasesShown: 5,
        careAndGrowthSeparated: true,
        mandatoryCareOutranksGrowth: true,
        contactFrequencyApplied: true,
      },
    });
  }

  getClient360(clientIdOrSourceRef) {
    const clientId = this.#resolveClientId(clientIdOrSourceRef);
    const client = this.#clients.get(clientId);
    const snapshot = [...this.#snapshots.values()].find((item) => item.clientId === clientId);
    const ledger = this.#ledgers.get(clientId);
    const actions = rankActions([...this.#actions.values()].filter((action) => action.clientId === clientId)).ordered;
    return deepFreeze({
      client: publicClient(client),
      snapshot: publicSnapshot(snapshot),
      goalLedger: deepClone(ledger),
      actions: actions.map((action) => deepClone(action)),
      permissions: {
        rmCanEditSuitability: false,
        rmCanEditKyc: false,
        rmCanEditModelAssumptions: false,
        rmCanApproveDraft: true,
        rmCanAutoSend: false,
        rmCanTrade: false,
      },
    });
  }

  getActionCard(actionId) {
    return deepClone(this.#requireAction(actionId));
  }

  #summaryView(action, resultRef) {
    const client = this.#clients.get(action.clientId);
    const ledger = this.#ledgers.get(action.clientId);
    const affectedGoals = action.affectedGoalIds.map((goalId) => ledger.goals.find((goal) => goal.goalId === goalId)).filter(Boolean);
    return {
      level: 1,
      resultRef,
      actionId: action.actionId,
      client: { clientId: client.clientId, displayRef: client.displayRef, name: client.name },
      occurred: action.title,
      whyImportant: action.whyNow,
      affectedGoals: affectedGoals.map((goal) => ({ goalId: goal.goalId, name: goal.name, targetDate: goal.targetDate, fundedRatio: goal.fundedRatio })),
      nextAction: action.dataGate.passed ? action.channel : 'CONFIRM_DATA',
      questions: action.conversationCoach ? action.conversationCoach.questions : action.dataGate.missing.map((item) => item.exactQuestion),
      warnings: [
        ...(action.conversationCoach ? action.conversationCoach.warnings : []),
        ...action.dataGate.missing.map((item) => item.whyItMatters),
      ],
      sources: action.evidence.map((item) => ({ label: item.sourceLabel, date: item.sourceDate, dataQuality: item.dataQuality })),
      decisionSafety: deepClone(action.decisionSafety),
    };
  }

  #detailView(action, resultRef) {
    const snapshot = this.#snapshots.get(action.snapshotId);
    const ledger = this.#ledgers.get(action.clientId);
    const groups = new Map();
    for (const holding of snapshot.holdings) {
      const group = groups.get(holding.masterFundId) || { masterFundId: holding.masterFundId, value: 0, shareClasses: [] };
      group.value += holding.value;
      group.shareClasses.push(deepClone(holding));
      groups.set(holding.masterFundId, group);
    }
    return {
      level: 2,
      resultRef,
      evidence: deepClone(action.evidence),
      portfolio: { holdings: deepClone(snapshot.holdings), masterFundGroups: [...groups.values()] },
      goals: deepClone(ledger.goals.filter((goal) => action.affectedGoalIds.includes(goal.goalId))),
      liquidityReserve: deepClone(ledger.liquidityReserve),
      missingDataAssistant: deepClone(action.dataGate.missing),
      assumptions: [
        'ใช้ข้อมูลสาธิต ณ วันที่ที่ระบุ',
        'ตัวเลขฉากฐานและฉากเครียดไม่ใช่การรับประกันผล',
        'ต้องยืนยัน eligibility, factsheet, ค่าธรรมเนียม และวันรับเงินก่อนตัดสินใจ',
      ],
      conversationCoach: deepClone(action.conversationCoach),
    };
  }

  #auditView(action, resultRef, role) {
    if (!MODEL_AUDIT_ROLES.has(String(role || '').toUpperCase())) throw new Error('Model & Audit Console requires an authorised role');
    const client = this.#clients.get(action.clientId);
    const snapshot = this.#snapshots.get(action.snapshotId);
    return {
      level: 3,
      resultRef,
      actionId: action.actionId,
      rawReasonCodes: deepClone(action.reasonCodes),
      modelRunId: action.modelRunId,
      sourceSystemRefs: deepClone(client.sourceSystemRefs),
      snapshotSourceRefs: deepClone(snapshot.sourceSystemRefs),
      dataGateTrace: deepClone(action.dataGate),
      validation: { actionCardValid: validateActionCard(action), governedEvidenceValid: action.evidence.every((item) => !item.numeric || assertGovernedNumber(item.numeric)) },
      auditTrail: this.getAuditTrail(action.actionId, { role }),
      replay: { inputHash: resultRef.inputHash, modelVersion: resultRef.modelVersion, assumptionVersion: resultRef.assumptionVersion, calculationId: resultRef.calculationId },
    };
  }

  getActionView(actionId, options = {}) {
    const action = this.#requireAction(actionId);
    const resultRef = deepClone(action.resultRef);
    const level = options.level || 'summary';
    if (level === 'summary' || level === 1) return deepFreeze(this.#summaryView(action, resultRef));
    if (level === 'detail' || level === 2) return deepFreeze(this.#detailView(action, resultRef));
    if (level === 'audit' || level === 3) return deepFreeze(this.#auditView(action, resultRef, options.role));
    throw new Error(`unknown view level: ${level}`);
  }

  getActionDetail(actionId) {
    return this.getActionView(actionId, { level: 'detail' });
  }

  getCalculationAudit(actionId, options = {}) {
    return this.getActionView(actionId, { level: 'audit', role: options.role });
  }

  getGovernedViews(actionId, options = {}) {
    const action = this.#requireAction(actionId);
    const sharedResultRef = deepFreeze(deepClone(action.resultRef));
    return deepFreeze({
      summary: this.#summaryView(action, sharedResultRef),
      detail: this.#detailView(action, sharedResultRef),
      audit: this.#auditView(action, sharedResultRef, options.role),
    });
  }

  getAuditTrail(actionId, options = {}) {
    if (actionId) this.#requireAction(actionId);
    const detailed = MODEL_AUDIT_ROLES.has(String(options.role || '').toUpperCase());
    return this.#auditEvents.filter((event) => !actionId || event.actionId === actionId).map((event) => {
      const output = deepClone(event);
      if (!detailed) {
        delete output.payload.resultRef;
        delete output.payload.rawReasonCodes;
      }
      return output;
    });
  }

  startReview(actionId, context) {
    assertHumanActor(context.actor);
    assertNonEmptyString(context.reason, 'reason');
    return this.#withIdempotency('start-review', context.requestId, { actionId, actor: context.actor, reason: context.reason }, () => {
      const action = this.#requireAction(actionId);
      if (!action.dataGate.passed) throw new Error('critical data is missing; only CONFIRM_DATA is allowed');
      const updated = this.#applyTransition(action, 'HUMAN_REVIEW', context, {}, 'HUMAN_REVIEW_STARTED');
      return { action: deepClone(updated), sent: false, traded: false };
    });
  }

  transitionAction(actionId, nextState, context) {
    assertHumanActor(context.actor);
    assertNonEmptyString(context.reason, 'reason');
    if (nextState === 'APPROVED_OR_EDITED') throw new Error('use recordDecision so approval and edits are auditable');
    if (nextState === 'COMPLETED') throw new Error('use completeAction so outcome and next review are recorded');
    return this.#withIdempotency('transition', context.requestId, { actionId, nextState, actor: context.actor, reason: context.reason }, () => {
      const action = this.#requireAction(actionId);
      const snapshot = this.#snapshots.get(action.snapshotId);
      if (['ELIGIBLE', 'HUMAN_REVIEW'].includes(nextState) && !evaluateDataGates(snapshot).passed) {
        throw new Error('critical data is missing; only CONFIRM_DATA is allowed');
      }
      if (nextState === 'SCHEDULED_OR_HANDOFF' && action.state === 'HUMAN_REVIEW') throw new Error('use recordDecision for a handoff decision');
      const updated = this.#applyTransition(action, nextState, context);
      return { action: deepClone(updated), sent: false, traded: false };
    });
  }

  transition(actionId, nextState, context) {
    return this.transitionAction(actionId, nextState, context);
  }

  createSpecialistHandoffPacket(actionId, input) {
    assertHumanActor(input.actor);
    assertNonEmptyString(input.reason, 'reason');
    assertNonEmptyString(input.dueAt, 'dueAt');
    return this.#withIdempotency('handoff-draft', input.requestId, { actionId, reason: input.reason, dueAt: input.dueAt, specialistType: input.specialistType, actor: input.actor }, () => {
      const action = this.#requireAction(actionId);
      const client = this.#clients.get(action.clientId);
      const snapshot = this.#snapshots.get(action.snapshotId);
      const ledger = this.#ledgers.get(action.clientId);
      const packetId = `hnd_${deterministicHash({ actionId, requestId: input.requestId }).slice(-8)}`;
      const packet = deepFreeze({
        packetId,
        actionId,
        status: 'DRAFT_REVIEW_REQUIRED',
        canDispatch: false,
        dispatched: false,
        clientSnapshot: { clientId: client.clientId, displayRef: client.displayRef, name: client.name, segment: client.segment, snapshotId: snapshot.snapshotId, asOf: snapshot.asOf },
        affectedGoals: ledger.goals.filter((goal) => action.affectedGoalIds.includes(goal.goalId)).map((goal) => ({ goalId: goal.goalId, name: goal.name, targetDate: goal.targetDate, currentFunding: goal.currentFunding, shortfall: goal.shortfall })),
        currentHoldings: snapshot.holdings.map((holding) => ({ fundId: holding.fundId, masterFundId: holding.masterFundId, name: holding.name, value: holding.value, currency: holding.currency, navAsOf: holding.navAsOf })),
        keyRisk: action.whyNow,
        questionsAlreadyAsked: deepClone(snapshot.questionsAlreadyAsked),
        missingInformation: deepClone(action.dataGate.missing),
        clientPreferences: deepClone(snapshot.clientPreferences),
        reasonForHandoff: input.reason,
        specialistType: input.specialistType || action.specialistType,
        sourceReferences: action.evidence.map((item) => ({ label: item.sourceLabel, date: item.sourceDate })),
        dueAt: input.dueAt,
        resultRef: deepClone(action.resultRef),
        reviewedBy: null,
        createdBy: deepClone(input.actor),
        createdAt: this.#clock(),
      });
      this.#handoffs.set(packetId, packet);
      this.#appendAudit({ actionId, eventType: 'HANDOFF_PACKET_DRAFTED', actor: input.actor, reason: input.reason, previousState: action.state, nextState: action.state, requestId: input.requestId, payload: { packetId, dispatched: false } });
      return packet;
    });
  }

  getHandoffPacket(packetId) {
    const packet = this.#handoffs.get(packetId);
    if (!packet) throw new Error(`unknown handoff packet: ${packetId}`);
    return deepClone(packet);
  }

  recordDecision(actionId, input) {
    assertHumanActor(input.actor);
    assertNonEmptyString(input.reason, 'reason');
    const decision = String(input.decision || '').toUpperCase();
    if (PROHIBITED_OPERATIONS.includes(decision)) throw new Error(`${decision} is prohibited; approval never sends or trades`);
    if (!DECISIONS.includes(decision)) throw new Error(`unsupported decision: ${decision}`);
    if (decision === 'EDIT_DRAFT') assertNonEmptyString(input.edits, 'edits');
    return this.#withIdempotency('decision', input.requestId, {
      actionId, decision, edits: input.edits || null, reason: input.reason, owner: input.owner || null,
      nextReview: input.nextReview || null, outcome: input.outcome || null, handoffPacketId: input.handoffPacketId || null,
      handoffReviewed: Boolean(input.handoffReviewed), actor: input.actor,
    }, () => {
      const action = this.#requireAction(actionId);
      if (action.state !== 'HUMAN_REVIEW') throw new Error('decision requires HUMAN_REVIEW state');
      let nextState;
      if (decision === 'APPROVE_DRAFT' || decision === 'EDIT_DRAFT') nextState = 'APPROVED_OR_EDITED';
      if (decision === 'REQUEST_INFORMATION') nextState = 'CONFIRM_DATA';
      if (decision === 'NO_ACTION') nextState = 'DISMISSED';
      if (decision === 'HANDOFF') nextState = 'SCHEDULED_OR_HANDOFF';
      let packet = null;
      if (decision === 'HANDOFF') {
        if (!input.handoffPacketId || input.handoffReviewed !== true) throw new Error('RM must review a handoff packet before recording HANDOFF');
        packet = this.#handoffs.get(input.handoffPacketId);
        if (!packet || packet.actionId !== actionId) throw new Error('handoff packet does not belong to this action');
        packet = deepFreeze({ ...deepClone(packet), status: 'QUEUED_AFTER_RM_REVIEW', reviewedBy: deepClone(input.actor), reviewedAt: this.#clock(), canDispatch: false, dispatched: false });
        this.#handoffs.set(packet.packetId, packet);
      }
      const at = this.#clock();
      const decisionRecord = {
        decision,
        edits: decision === 'EDIT_DRAFT' ? input.edits : null,
        reason: input.reason,
        owner: input.owner || action.owner,
        actor: deepClone(input.actor),
        timestamp: at,
        nextReview: input.nextReview || null,
        outcome: input.outcome || null,
        handoffPacketId: packet ? packet.packetId : null,
        sent: false,
        traded: false,
      };
      const patch = {
        decisionRecord,
        draftedMessage: decision === 'EDIT_DRAFT' ? input.edits : action.draftedMessage,
      };
      const updated = this.#applyTransition(action, nextState, { ...input, payload: decisionRecord }, patch, 'HUMAN_DECISION_RECORDED');
      return {
        action: deepClone(updated),
        decisionRecord: deepClone(decisionRecord),
        handoffPacket: packet ? deepClone(packet) : null,
        sent: false,
        traded: false,
        nextManualStep: nextState === 'APPROVED_OR_EDITED' ? 'SCHEDULE_OR_HANDOFF' : null,
      };
    });
  }

  completeAction(actionId, input) {
    assertHumanActor(input.actor);
    assertNonEmptyString(input.reason, 'reason');
    assertNonEmptyString(input.outcome, 'outcome');
    assertNonEmptyString(input.nextReview, 'nextReview');
    return this.#withIdempotency('complete', input.requestId, { actionId, outcome: input.outcome, nextReview: input.nextReview, reason: input.reason, actor: input.actor }, () => {
      const action = this.#requireAction(actionId);
      const outcome = { code: input.outcome, note: input.note || null, nextReview: input.nextReview, recordedBy: deepClone(input.actor), recordedAt: this.#clock() };
      const updated = this.#applyTransition(action, 'COMPLETED', { ...input, payload: outcome }, { outcome }, 'ACTION_COMPLETED');
      return { action: deepClone(updated), outcome: deepClone(outcome), sent: false, traded: false };
    });
  }

  recordDecisionQuality(actionId, input) {
    assertHumanActor(input.actor);
    return this.#withIdempotency('decision-quality', input.requestId, {
      actionId,
      recommendationUseful: input.recommendationUseful,
      explanationUnderstandable: input.explanationUnderstandable,
      missingImportantInformation: input.missingImportantInformation || null,
      priorityAssessment: input.priorityAssessment,
      specialistResponseCompleted: input.specialistResponseCompleted,
      actor: input.actor,
    }, () => {
      const action = this.#requireAction(actionId);
      if (!['COMPLETED', 'DISMISSED'].includes(action.state)) throw new Error('decision-quality feedback is collected after a case is closed');
      if (!['TOO_HIGH', 'RIGHT', 'TOO_LOW'].includes(input.priorityAssessment)) throw new Error('invalid priorityAssessment');
      const label = deepFreeze({
        labelId: `lbl_${deterministicHash({ actionId, requestId: input.requestId }).slice(-8)}`,
        actionId,
        recommendationUseful: input.recommendationUseful === null ? null : Boolean(input.recommendationUseful),
        explanationUnderstandable: input.explanationUnderstandable === null ? null : Boolean(input.explanationUnderstandable),
        missingImportantInformation: input.missingImportantInformation || null,
        priorityAssessment: input.priorityAssessment,
        specialistResponseCompleted: input.specialistResponseCompleted === null ? null : Boolean(input.specialistResponseCompleted),
        labelSource: 'RM_FEEDBACK',
        use: 'FUTURE_TRAINING_LABEL_ONLY',
        productionTruth: false,
        recordedBy: deepClone(input.actor),
        recordedAt: this.#clock(),
      });
      this.#qualityLabels.push(label);
      this.#appendAudit({ actionId, eventType: 'DECISION_QUALITY_LABEL_RECORDED', actor: input.actor, reason: 'บันทึกเป็นป้ายกำกับสำหรับการประเมินในอนาคตเท่านั้น', previousState: action.state, nextState: action.state, requestId: input.requestId, payload: { labelId: label.labelId, productionTruth: false } });
      return label;
    });
  }

  getDecisionQualityLabels(actionId) {
    return this.#qualityLabels.filter((label) => !actionId || label.actionId === actionId).map(deepClone);
  }
}

function createCockpitEngine(options = {}) {
  return new CockpitEngine(options);
}

module.exports = {
  ACTION_STATES,
  ALLOWED_TRANSITIONS,
  DECISIONS,
  PROHIBITED_OPERATIONS,
  HARD_DATA_GATES,
  DEMO_IDS,
  governedNumber,
  assertGovernedNumber,
  buildResultRef,
  buildGoalLedger,
  validateFundingPlan,
  evaluateDataGates,
  evaluateContactPolicy,
  validateActionCard,
  createActionCard,
  compareActions,
  rankActions,
  canTransition,
  assertUniqueEntityIds,
  buildDemoFixtures,
  CockpitEngine,
  createCockpitEngine,
};
