'use strict';

const { ASSET_KEYS, ANNUAL_EXPECTED_RETURNS, ANNUAL_COVARIANCE, portfolioMetrics } = require('./frontier');
const { ASSET_LABELS } = require('./case-data');

function weightsToArray(weights) {
  return ASSET_KEYS.map((key) => Number(weights[key] || 0));
}

function arrayToWeights(values) {
  return Object.fromEntries(ASSET_KEYS.map((key, index) => [key, values[index]]));
}

function normalizeWeights(weights) {
  const raw = weightsToArray(weights);
  if (raw.some((value) => !Number.isFinite(value) || value < -1e-12)) throw new Error('PORTFOLIO_WEIGHTS_INVALID');
  const values = raw.map((value) => Math.max(0, value));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) throw new Error('PORTFOLIO_WEIGHTS_EMPTY');
  return arrayToWeights(values.map((value) => value / total));
}

function weightedShock(weights, shocks) {
  const normalized = normalizeWeights(weights);
  return ASSET_KEYS.reduce((total, key) => total + normalized[key] * Number(shocks[key] || 0), 0);
}

function hashSeed(text) {
  let hash = 2166136261;
  for (const char of String(text)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function normalSample(random) {
  const u1 = Math.max(random(), 1e-12);
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function percentile(sorted, p) {
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - index) + sorted[hi] * (index - lo);
}

function simulateGoal(client, weights, immediateShock = 0, paths = 5000) {
  const normalized = normalizeWeights(weights);
  const metrics = portfolioMetrics(weightsToArray(normalized), ANNUAL_EXPECTED_RETURNS, ANNUAL_COVARIANCE, 0.018);
  const years = Math.max(0.25, Number(client.goal.years));
  const currentCapital = Number(client.goal.currentCapital);
  if (!(currentCapital >= 0)) throw new Error('GOAL_CURRENT_CAPITAL_REQUIRED');
  const annualContribution = Math.max(0, Number(client.goal.annualContribution || 0));
  const start = currentCapital * Math.max(0.05, 1 + immediateShock);
  // Common random numbers: base/current/candidate/model projections for the
  // same client use identical standard-normal draws. This reduces Monte Carlo
  // noise in pairwise comparisons without pretending the projection is exact.
  const random = seededRandom(hashSeed(`${client.id}:${client.goal.name}:${paths}`));
  const values = [];
  const steps = Math.max(1, Math.round(years * 12));
  const dt = years / steps;
  // CMA expected returns are effective annual simple returns. log1p converts
  // them to the continuously compounded drift used by the lognormal process.
  const drift = (Math.log1p(metrics.expectedReturn) - 0.5 * metrics.variance) * dt;
  const diffusion = metrics.volatility * Math.sqrt(dt);
  const contributionPerStep = annualContribution * dt;
  for (let i = 0; i < paths; i += 1) {
    let value = start;
    for (let step = 0; step < steps; step += 1) {
      value = value * Math.exp(drift + diffusion * normalSample(random)) + contributionPerStep;
    }
    values.push(value);
  }
  values.sort((a, b) => a - b);
  const successes = values.filter((value) => value >= client.goal.target).length;
  return {
    probability: successes / paths,
    p05: percentile(values, 0.05),
    median: percentile(values, 0.50),
    p95: percentile(values, 0.95),
    paths,
    startCapital: start,
    currentCapital,
    annualContribution,
    expectedReturn: metrics.expectedReturn,
    volatility: metrics.volatility,
  };
}

function responseLevel(client, lossRate, probabilityDrop, candidate = null) {
  if (client.mandatory) return { level: 3, label: 'ระดับ 3 · โทรทันที', action: 'รับผิดชอบเคสตาม SLA และส่ง owner ที่เกี่ยวข้อง', trade: 'ห้ามเสนอผลิตภัณฑ์ระหว่าง service recovery' };
  const dataBlocked = !client.dataReady || !client.profileFresh || client.goalReady === false;
  const blockedTrade = 'ข้อมูลยังไม่พร้อม จึงติดต่อเพื่อดูแลได้แต่ห้ามจัดพอร์ตหรือเสนอรายการซื้อขาย';
  const candidateTrade = candidate?.recommendedForScenario
    ? 'ทางเลือกปรับบางส่วนลดความเสียหายในฉากนี้โดยไม่ทำให้โอกาสถึงเป้าหมายลดลงอย่างมีนัยสำคัญ แต่ต้องให้ลูกค้ายืนยันก่อน'
    : 'ยังไม่ควรปรับพอร์ตจากข่าวนี้: ทางเลือกที่คำนวณไม่ได้ทำให้ทั้งความเสียหายและเป้าหมายดีขึ้นพร้อมกัน';
  if (lossRate >= 0.20 || probabilityDrop >= 0.15) return { level: 3, label: 'ระดับ 3 · โทรวันนี้', action: dataBlocked ? 'RM โทรดูแลเหตุการณ์และขอข้อมูลที่จำเป็น โดยยังไม่ให้คำแนะนำ' : 'RM โทรและให้ผู้เชี่ยวชาญการลงทุนทบทวนเคส', trade: dataBlocked ? blockedTrade : candidateTrade };
  if (lossRate >= 0.10 || probabilityDrop >= 0.08) return { level: 2, label: 'ระดับ 2 · โทรภายในวันนี้', action: dataBlocked ? 'RM โทรดูแลเหตุการณ์และขอข้อมูลที่จำเป็น' : 'ยืนยันเป้าหมาย สภาพคล่อง และความสามารถรับขาดทุน', trade: dataBlocked ? blockedTrade : candidateTrade };
  if (dataBlocked) return { level: 2, label: 'ระดับ 2 · ขอข้อมูลก่อน', action: 'ส่งรายการยืนยันและติดตามภายใน 2 วัน', trade: blockedTrade };
  if (lossRate >= 0.05 || probabilityDrop >= 0.04) return { level: 1, label: 'ระดับ 1 · ติดต่อภายใน 3 วัน', action: 'ส่งข้อความก่อนและเปิดทางให้นัด RM หากลูกค้ากังวล', trade: 'ยังไม่ต้องซื้อขายหากข้อตกลงและเป้าหมายไม่เปลี่ยน' };
  return { level: 0, label: 'ระดับ 0 · เฝ้าดู', action: 'อัปเดตผ่านข้อความอัตโนมัติที่ RM อนุมัติ', trade: 'ไม่ซื้อขายจากพาดหัวข่าวเพียงอย่างเดียว' };
}

function runStress(client, scenario, targetWeights, targetGoalWeights = targetWeights) {
  if (!scenario) throw new Error('SCENARIO_NOT_FOUND');
  const currentShock = weightedShock(client.portfolio, scenario.shocks);
  const targetShock = weightedShock(targetWeights, scenario.shocks);
  const partialWeights = blendWeights(client.portfolio, targetWeights, 0.50);
  const partialShock = weightedShock(partialWeights, scenario.shocks);
  const goalTarget = normalizeWeights(targetGoalWeights);
  const goalPartial = blendWeights(client.portfolio, goalTarget, 0.50);
  const targetGoalShock = weightedShock(goalTarget, scenario.shocks);
  const partialGoalShock = weightedShock(goalPartial, scenario.shocks);
  const baseGoal = simulateGoal(client, client.portfolio, 0);
  const currentGoal = simulateGoal(client, client.portfolio, currentShock);
  const targetGoal = simulateGoal(client, goalTarget, targetGoalShock);
  const partialGoal = simulateGoal(client, goalPartial, partialGoalShock);
  const lossRate = Math.max(0, -currentShock);
  const probabilityDrop = Math.max(0, baseGoal.probability - currentGoal.probability);
  const candidate = {
    name: 'ปรับครึ่งหนึ่งของส่วนที่เบน',
    weights: partialWeights,
    shockReturn: partialShock,
    lossBaht: Math.max(0, -partialShock * client.aum),
    valueAfterShock: client.aum * (1 + partialShock),
    goal: partialGoal,
    lossImprovementBaht: Math.max(0, -currentShock * client.aum) - Math.max(0, -partialShock * client.aum),
    goalProbabilityChange: partialGoal.probability - currentGoal.probability,
    trades: tradeList(normalizeWeights(client.portfolio), partialWeights, client.aum),
  };
  candidate.recommendedForScenario = candidate.lossImprovementBaht > client.aum * 0.001
    && candidate.goalProbabilityChange >= -0.01;
  const tradeoff = candidate.recommendedForScenario
    ? 'ทางเลือกปรับบางส่วนช่วยลดความเสียหายภายใต้ฉากนี้ และโอกาสถึงเป้าหมายไม่ลดลงเกิน 1 จุดเปอร์เซ็นต์'
    : 'ไม่มีทางเลือกที่ชนะทุกด้าน: ระบบจึงไม่สรุปให้ซื้อขายจากฉากเหตุการณ์เพียงอย่างเดียว RM ต้องยืนยันเป้าหมายและความต้องการสภาพคล่องก่อน';
  return {
    scenario: { id: scenario.id, name: scenario.name, plainName: scenario.plainName, narrative: scenario.narrative, horizon: scenario.horizon, calibration: scenario.calibration },
    current: {
      shockReturn: currentShock,
      lossBaht: Math.max(0, -currentShock * client.aum),
      valueAfterShock: client.aum * (1 + currentShock),
      goal: currentGoal,
    },
    approvedModel: {
      shockReturn: targetShock,
      lossBaht: Math.max(0, -targetShock * client.aum),
      valueAfterShock: client.aum * (1 + targetShock),
      goal: targetGoal,
    },
    candidate,
    baseGoal,
    probabilityDrop,
    response: responseLevel(client, lossRate, probabilityDrop, candidate),
    tradeoff,
    shocks: ASSET_KEYS.map((key) => ({ key, label: ASSET_LABELS[key], shock: Number(scenario.shocks[key] || 0) })),
    methodology: 'กำหนดความเสียหายฉับพลันตามสถานการณ์ แล้วจำลองเส้นทางเป้าหมายรายเดือน 5,000 เส้นทางด้วย lognormal โดยใช้เงินในเป้าหมาย เงินเติมต่อปี และน้ำหนักของ goal bucket ที่ระบุ เหตุการณ์รุนแรงมาจาก scenario shock ไม่ได้มาจากการแจกแจง lognormal',
  };
}

function blendWeights(current, target, fraction) {
  return normalizeWeights(Object.fromEntries(ASSET_KEYS.map((key) => [key, current[key] + fraction * (target[key] - current[key])])));
}

function tradeList(fromWeights, toWeights, aum) {
  return ASSET_KEYS.map((key) => {
    const delta = (toWeights[key] - fromWeights[key]) * aum;
    return { key, label: ASSET_LABELS[key], deltaBaht: delta, direction: delta > 1 ? 'buy' : delta < -1 ? 'sell' : 'hold' };
  }).filter((item) => item.direction !== 'hold').sort((a, b) => Math.abs(b.deltaBaht) - Math.abs(a.deltaBaht));
}

function proposalMetrics(weights) {
  return portfolioMetrics(weightsToArray(normalizeWeights(weights)), ANNUAL_EXPECTED_RETURNS, ANNUAL_COVARIANCE, 0.018);
}

function proposeRebalance(client, model) {
  if (!model) throw new Error('MODEL_NOT_FOUND');
  if (client.mandatory) {
    return {
      blocked: true,
      reason: 'เคสร้องเรียนต้องปิด service recovery ก่อน ระบบจึงปิดหน้าจัดพอร์ตและการเสนอผลิตภัณฑ์',
      canExecute: false,
      noCrossSell: true,
    };
  }
  if (!client.dataReady || !client.profileFresh || client.goalReady === false) {
    return {
      blocked: true,
      reason: client.goalReady === false
        ? 'ต้องยืนยันจำนวนเงิน วันใช้เงิน และสกุลเงินของเป้าหมายก่อน จึงยังไม่คำนวณข้อเสนอซื้อขาย'
        : 'ต้องให้ลูกค้ายืนยันข้อมูลและความเสี่ยงก่อน จึงยังไม่คำนวณข้อเสนอซื้อขาย',
      canExecute: false,
    };
  }
  const current = normalizeWeights(client.portfolio);
  const target = normalizeWeights(model.weights);
  const partial = blendWeights(current, target, 0.50);
  const assumedNewMoney = Math.min(client.aum * 0.05, Math.max(0, client.liquidCash - client.monthlyExpense * 6));
  const cashFirst = { ...current };
  let remaining = assumedNewMoney / client.aum;
  const deficits = ASSET_KEYS.filter((key) => key !== 'cash' && target[key] > current[key]);
  const deficitTotal = deficits.reduce((sum, key) => sum + target[key] - current[key], 0);
  if (remaining > 0 && deficitTotal > 0) {
    const funded = Math.min(remaining, current.cash);
    cashFirst.cash -= funded;
    for (const key of deficits) cashFirst[key] += funded * ((target[key] - current[key]) / deficitTotal);
  }
  const cashFirstNormalized = normalizeWeights(cashFirst);
  const gap = ASSET_KEYS.reduce((sum, key) => sum + Math.abs(current[key] - target[key]), 0) / 2;
  const recommended = gap >= 0.08 && client.goal.years <= 5 ? 'partial' : assumedNewMoney > client.aum * 0.01 ? 'cashFirst' : 'noTrade';
  const options = [
    {
      id: 'cashFirst', name: 'ใช้เงินที่ยืนยันว่าไม่จำเป็นต่อสภาพคล่องก่อน',
      description: assumedNewMoney > 0 ? `มีวงเงินที่อาจใช้ได้ประมาณ ${Math.round(assumedNewMoney)} บาท แต่ต้องให้ลูกค้ายืนยันก่อน` : 'ยังไม่พบเงินส่วนเกินหลังกันสำรอง 6 เดือน จึงไม่สร้างรายการซื้อ',
      weights: cashFirstNormalized, trades: tradeList(current, cashFirstNormalized, client.aum), requiresConfirmation: true,
    },
    {
      id: 'partial', name: 'ปรับเฉพาะครึ่งหนึ่งของส่วนที่เบน',
      description: 'ลดการซื้อขายเกินจำเป็นและขยับเข้าใกล้กรอบพอร์ตสาธิตทีละขั้น',
      weights: partial, trades: tradeList(current, partial, client.aum), requiresConfirmation: true,
    },
    {
      id: 'noTrade', name: 'ยังไม่ซื้อขาย',
      description: 'ใช้เมื่อเป้าหมายยังไม่ยืนยัน ต้นทุนไม่คุ้ม หรือความเสี่ยงยังอยู่ในกรอบ',
      weights: current, trades: [], requiresConfirmation: false,
    },
  ].map((option) => ({ ...option, recommended: option.id === recommended, metrics: proposalMetrics(option.weights) }));
  return {
    blocked: false, canExecute: false, model: { id: model.id, name: model.name, riskRange: model.riskRange, weights: target, buckets: model.buckets, selectionReasons: model.selectionReasons, caseStudyOnly: model.caseStudyOnly },
    current: { weights: current, metrics: proposalMetrics(current) },
    gap,
    options,
    executionMessage: 'ข้อเสนอนี้ยังไม่ใช่คำสั่งซื้อขาย: RM ตรวจ → ลูกค้าอนุมัติ → ผู้มีอำนาจตรวจซ้ำ → ระบบซื้อขายเดิม → ยืนยันรายการ',
  };
}

module.exports = {
  weightsToArray, arrayToWeights, normalizeWeights, weightedShock, simulateGoal, responseLevel, runStress, blendWeights, tradeList, proposeRebalance,
};
