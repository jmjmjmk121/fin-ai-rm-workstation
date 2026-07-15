'use strict';

// Synthetic point-in-time records for historical replay. These identifiers and
// prices do not represent real funds. The fixture is deliberately rich enough
// to exercise availability lags, product revisions, shelf changes and three
// historical stress windows without implying that synthetic outcomes happened
// to a real client.

const DEFAULT_REPLAY_SEED = 'fin-ai-thai-fund-replay-v1';
const REPLAY_DATASET_ID = 'thai-mutual-fund-pit-fixture-v1';
const HISTORY_START = '2020-01-01';
const HISTORY_END = '2024-12-31';

const STRESS_PERIODS = Object.freeze([
  Object.freeze({
    stressId: 'STRESS_COVID_LIQUIDITY_2020',
    nameTh: 'วิกฤตสภาพคล่องช่วงโควิด-19',
    startDate: '2020-02-20',
    endDate: '2020-04-30',
    affectedBuckets: ['THAI_EQUITY', 'GLOBAL_EQUITY', 'REAL_ASSET', 'FIXED_INCOME'],
    evaluationOnly: true,
  }),
  Object.freeze({
    stressId: 'STRESS_GLOBAL_RATE_2022',
    nameTh: 'ช่วงดอกเบี้ยโลกปรับขึ้นเร็ว',
    startDate: '2022-04-01',
    endDate: '2022-10-31',
    affectedBuckets: ['FIXED_INCOME', 'BALANCED', 'REAL_ASSET'],
    evaluationOnly: true,
  }),
  Object.freeze({
    stressId: 'STRESS_THAI_EQUITY_2023',
    nameTh: 'ช่วงหุ้นไทยปรับลงปี 2566',
    startDate: '2023-08-01',
    endDate: '2023-11-30',
    affectedBuckets: ['THAI_EQUITY', 'BALANCED', 'REAL_ASSET'],
    evaluationOnly: true,
  }),
]);

const FUND_BLUEPRINTS = Object.freeze([
  fund('THF-MM-001', 'SYN-MM', 'กองทุนตลาดเงินไทยจำลอง', '2020-01-01', 'CASH', 'MONEY_MARKET', 1, 0.25, 1, 10.00, 0.00010, { cash: 1.00 }),
  fund('THF-BD-ST-002', 'SYN-BDST', 'กองทุนตราสารหนี้ระยะสั้นจำลอง', '2020-01-01', 'FIXED_INCOME', 'SHORT_TERM_BOND', 3, 0.45, 1, 10.50, 0.00035, { cash: 0.15, duration: 0.55, credit: 0.30 }),
  fund('THF-BD-GOV-003', 'SYN-BDGOV', 'กองทุนพันธบัตรรัฐบาลไทยจำลอง', '2020-01-01', 'FIXED_INCOME', 'GOVERNMENT_BOND', 4, 0.55, 2, 11.00, 0.00045, { duration: 0.90, cash: 0.10 }),
  fund('THF-BD-CR-004', 'SYN-BDCR', 'กองทุนตราสารหนี้เอกชนไทยจำลอง', '2020-01-01', 'FIXED_INCOME', 'CORPORATE_BOND', 4, 0.70, 2, 11.50, 0.00060, { duration: 0.35, credit: 0.65 }),
  fund('THF-BAL-DEF-005', 'SYN-BALDEF', 'กองทุนผสมเชิงรับจำลอง', '2020-01-01', 'BALANCED', 'BALANCED_DEFENSIVE', 5, 0.90, 3, 12.00, 0.00120, { cash: 0.05, duration: 0.35, credit: 0.20, thai: 0.20, global: 0.15, real: 0.05 }),
  fund('THF-BAL-GRW-006', 'SYN-BALGRW', 'กองทุนผสมเน้นการเติบโตจำลอง', '2020-01-01', 'BALANCED', 'BALANCED_GROWTH', 5, 1.05, 3, 12.50, 0.00170, { duration: 0.20, credit: 0.10, thai: 0.35, global: 0.25, real: 0.10 }),
  fund('THF-EQ-LC-007', 'SYN-THEQLC', 'กองทุนหุ้นไทยขนาดใหญ่จำลอง', '2020-01-01', 'THAI_EQUITY', 'THAI_EQUITY_LARGE_CAP', 6, 1.20, 3, 13.00, 0.00260, { thai: 0.95, cash: 0.05 }),
  fund('THF-EQ-SC-008', 'SYN-THEQSC', 'กองทุนหุ้นไทยขนาดเล็กจำลอง', '2021-01-04', 'THAI_EQUITY', 'THAI_EQUITY_SMALL_CAP', 6, 1.45, 3, 10.00, 0.00380, { thai: 1.10, credit: 0.05 }),
  fund('THF-GL-H-009', 'SYN-GLH', 'กองทุนหุ้นโลกป้องกันค่าเงินจำลอง', '2020-01-01', 'GLOBAL_EQUITY', 'GLOBAL_EQUITY_HEDGED', 6, 1.10, 3, 14.00, 0.00240, { global: 0.95, cash: 0.05, fx: 0.05 }),
  fund('THF-GL-U-010', 'SYN-GLU', 'กองทุนหุ้นโลกไม่ป้องกันค่าเงินจำลอง', '2020-07-01', 'GLOBAL_EQUITY', 'GLOBAL_EQUITY_UNHEDGED', 6, 1.00, 3, 10.00, 0.00270, { global: 0.95, fx: 0.80, cash: 0.05 }),
  fund('THF-GOLD-011', 'SYN-GOLD', 'กองทุนทองคำจำลอง', '2021-07-01', 'REAL_ASSET', 'GOLD', 8, 1.25, 3, 10.00, 0.00280, { gold: 1.00, fx: 0.40 }),
  fund('THF-PROP-012', 'SYN-PROP', 'กองทุนอสังหาริมทรัพย์ไทยจำลอง', '2020-01-01', 'REAL_ASSET', 'THAI_PROPERTY', 8, 1.15, 3, 15.00, 0.00320, { real: 1.00, credit: 0.10 }),
]);

function fund(fundId, fundCode, nameTh, inceptionDate, policyBucket, assetClass, riskLevel, feePct, settlementDays, initialNav, idiosyncraticVolatility, exposures) {
  return Object.freeze({
    fundId,
    masterFundId: fundId,
    fundCode,
    nameTh,
    nameEn: `Synthetic Thai Mutual Fund ${fundCode}`,
    amcCode: `AMC-SYN-${String(Number(fundId.slice(-3)) % 4 + 1).padStart(2, '0')}`,
    thaiRegistered: true,
    currency: 'THB',
    inceptionDate,
    policyBucket,
    assetClass,
    riskLevel,
    feePct,
    settlementDays,
    initialNav,
    idiosyncraticVolatility,
    exposures: Object.freeze({ ...exposures }),
  });
}

function isoDate(value) {
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10);
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function businessDates(startDate, endDate) {
  const result = [];
  for (let date = isoDate(startDate); date <= endDate; date = addDays(date, 1)) {
    const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    if (day !== 0 && day !== 6) result.push(date);
  }
  return result;
}

function seedNumber(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = seedNumber(seed);
  return function random() {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normalGenerator(random) {
  let spare = null;
  return function normal() {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    let v = 0;
    while (u <= Number.EPSILON) u = random();
    while (v <= Number.EPSILON) v = random();
    const magnitude = Math.sqrt(-2 * Math.log(u));
    spare = magnitude * Math.sin(2 * Math.PI * v);
    return magnitude * Math.cos(2 * Math.PI * v);
  };
}

function sourceRef(section, id, version) {
  return `fixture://${REPLAY_DATASET_ID}/${section}/${id}/${version}`;
}

function isBetween(date, startDate, endDate) {
  return date >= startDate && date <= endDate;
}

function stressAdjustment(date) {
  const adjustment = { cash: 0, duration: 0, credit: 0, thai: 0, global: 0, real: 0, gold: 0, fx: 0 };
  if (isBetween(date, '2020-02-20', '2020-04-30')) {
    adjustment.duration -= 0.00035;
    adjustment.credit -= 0.00110;
    adjustment.thai -= 0.00530;
    adjustment.global -= 0.00420;
    adjustment.real -= 0.00500;
    adjustment.gold += 0.00070;
    adjustment.fx += 0.00100;
  }
  if (isBetween(date, '2022-04-01', '2022-10-31')) {
    adjustment.duration -= 0.00055;
    adjustment.credit -= 0.00025;
    adjustment.thai -= 0.00020;
    adjustment.global -= 0.00025;
    adjustment.real -= 0.00080;
    adjustment.gold -= 0.00010;
  }
  if (isBetween(date, '2023-08-01', '2023-11-30')) {
    adjustment.credit -= 0.00010;
    adjustment.thai -= 0.00135;
    adjustment.real -= 0.00100;
    adjustment.global += 0.00020;
    adjustment.fx += 0.00015;
  }
  return adjustment;
}

function buildDailyFactors(dates, normal) {
  const factors = new Map();
  for (const date of dates) {
    const shock = stressAdjustment(date);
    factors.set(date, {
      cash: 0.000045 + 0.000025 * normal() + shock.cash,
      duration: 0.000110 + 0.001250 * normal() + shock.duration,
      credit: 0.000120 + 0.001050 * normal() + shock.credit,
      thai: 0.000260 + 0.009200 * normal() + shock.thai,
      global: 0.000300 + 0.008400 * normal() + shock.global,
      real: 0.000190 + 0.006900 * normal() + shock.real,
      gold: 0.000170 + 0.006500 * normal() + shock.gold,
      fx: 0.000010 + 0.003000 * normal() + shock.fx,
    });
  }
  return factors;
}

function buildNavHistory(blueprint, dates, factors, normal) {
  const rows = [];
  let nav = blueprint.initialNav;
  for (const date of dates) {
    if (date < blueprint.inceptionDate) continue;
    const daily = factors.get(date);
    let dailyReturn = -blueprint.feePct / 100 / 252 + blueprint.idiosyncraticVolatility * normal();
    for (const [factorName, exposure] of Object.entries(blueprint.exposures)) {
      dailyReturn += exposure * daily[factorName];
    }
    dailyReturn = Math.max(-0.35, Math.min(0.20, dailyReturn));
    nav = Math.max(0.50, nav * (1 + dailyReturn));
    const availableAt = addDays(date, 1);
    rows.push({
      date,
      observedAt: date,
      availableAt,
      nav: Number(nav.toFixed(8)),
      rawNav: Number(nav.toFixed(8)),
      currency: 'THB',
      returnType: 'NAV_RETURN',
      isTotalReturn: false,
      sourceRef: sourceRef('nav', blueprint.fundId, date),
    });
  }
  return rows;
}

function buildClassificationHistory(blueprint) {
  const initialPublishedAt = addDays(blueprint.inceptionDate, -10);
  const rows = [{
    versionId: `${blueprint.fundId}-CLASS-v1`,
    effectiveFrom: blueprint.inceptionDate,
    publishedAt: initialPublishedAt,
    assetClass: blueprint.assetClass,
    policyBucket: blueprint.policyBucket,
    riskLevel: blueprint.riskLevel,
    sourceRef: sourceRef('classification', blueprint.fundId, 'v1'),
  }];

  const changes = {
    'THF-BAL-GRW-006': { effectiveFrom: '2022-07-01', publishedAt: '2022-06-17', riskLevel: 6 },
    'THF-EQ-SC-008': { effectiveFrom: '2023-07-01', publishedAt: '2023-06-16', riskLevel: 7 },
    'THF-GL-U-010': { effectiveFrom: '2023-03-01', publishedAt: '2023-02-17', riskLevel: 7 },
  };
  if (changes[blueprint.fundId]) {
    const change = changes[blueprint.fundId];
    rows.push({
      versionId: `${blueprint.fundId}-CLASS-v2`,
      effectiveFrom: change.effectiveFrom,
      publishedAt: change.publishedAt,
      assetClass: blueprint.assetClass,
      policyBucket: blueprint.policyBucket,
      riskLevel: change.riskLevel,
      sourceRef: sourceRef('classification', blueprint.fundId, 'v2'),
    });
  }

  // This retroactive revision is intentionally unavailable during every
  // default decision date. It catches code that filters only effective dates.
  if (blueprint.fundId === 'THF-GL-H-009') {
    rows.push({
      versionId: `${blueprint.fundId}-CLASS-future-revision`,
      effectiveFrom: '2022-01-01',
      publishedAt: '2025-03-15',
      assetClass: 'GLOBAL_EQUITY',
      policyBucket: 'GLOBAL_EQUITY',
      riskLevel: 8,
      sourceRef: sourceRef('classification', blueprint.fundId, 'future-revision'),
    });
  }
  return rows;
}

function buildFactsheetHistory(blueprint) {
  const rows = [];
  const inceptionYear = Number(blueprint.inceptionDate.slice(0, 4));
  rows.push({
    versionId: `${blueprint.fundId}-FACT-v1`,
    asOf: blueprint.inceptionDate,
    publishedAt: blueprint.inceptionDate,
    annualFeePct: blueprint.feePct,
    settlementDays: blueprint.settlementDays,
    fxPolicy: blueprint.assetClass.includes('GLOBAL') || blueprint.assetClass === 'GOLD'
      ? (blueprint.assetClass.includes('UNHEDGED') ? 'UNHEDGED' : 'PARTIAL_OR_HEDGED')
      : 'NOT_APPLICABLE',
    liquidityClass: blueprint.settlementDays <= 1 ? 'DAILY_FAST' : 'DAILY',
    sourceRef: sourceRef('factsheet', blueprint.fundId, 'v1'),
  });
  for (let year = inceptionYear + 1; year <= 2024; year += 1) {
    const version = `v${year - inceptionYear + 1}`;
    rows.push({
      versionId: `${blueprint.fundId}-FACT-${version}`,
      asOf: `${year - 1}-12-31`,
      publishedAt: `${year}-01-20`,
      annualFeePct: Number((blueprint.feePct + (year % 2 ? 0.01 : 0)).toFixed(2)),
      settlementDays: blueprint.settlementDays,
      fxPolicy: blueprint.assetClass.includes('GLOBAL') || blueprint.assetClass === 'GOLD'
        ? (blueprint.assetClass.includes('UNHEDGED') ? 'UNHEDGED' : 'PARTIAL_OR_HEDGED')
        : 'NOT_APPLICABLE',
      liquidityClass: blueprint.settlementDays <= 1 ? 'DAILY_FAST' : 'DAILY',
      sourceRef: sourceRef('factsheet', blueprint.fundId, version),
    });
  }
  if (blueprint.fundId === 'THF-BD-GOV-003') {
    rows.push({
      versionId: `${blueprint.fundId}-FACT-future-revision`,
      asOf: '2022-12-31',
      publishedAt: '2025-04-01',
      annualFeePct: 9.99,
      settlementDays: 30,
      fxPolicy: 'NOT_APPLICABLE',
      liquidityClass: 'REVISED_AFTER_REPLAY',
      sourceRef: sourceRef('factsheet', blueprint.fundId, 'future-revision'),
    });
  }
  return rows;
}

function buildShelfHistory(blueprint) {
  let initialStatus = 'APPROVED';
  if (blueprint.fundId === 'THF-GOLD-011') initialStatus = 'NOT_APPROVED';
  const rows = [{
    versionId: `${blueprint.fundId}-SHELF-v1`,
    effectiveFrom: blueprint.inceptionDate,
    publishedAt: blueprint.inceptionDate,
    status: initialStatus,
    permissions: ['VIEW', 'ADVISE'],
    shelfVersion: 'SHELF-SYN-v1',
    sourceRef: sourceRef('approved-shelf', blueprint.fundId, 'v1'),
  }];
  if (blueprint.fundId === 'THF-GOLD-011') {
    rows.push({
      versionId: `${blueprint.fundId}-SHELF-v2`,
      effectiveFrom: '2022-02-01',
      publishedAt: '2022-01-21',
      status: 'APPROVED',
      permissions: ['VIEW', 'ADVISE'],
      shelfVersion: 'SHELF-SYN-v2',
      sourceRef: sourceRef('approved-shelf', blueprint.fundId, 'v2'),
    });
  }
  if (blueprint.fundId === 'THF-EQ-SC-008') {
    rows.push({
      versionId: `${blueprint.fundId}-SHELF-v2`,
      effectiveFrom: '2023-08-01',
      publishedAt: '2023-07-20',
      status: 'NOT_APPROVED',
      permissions: ['VIEW'],
      shelfVersion: 'SHELF-SYN-v3',
      sourceRef: sourceRef('approved-shelf', blueprint.fundId, 'v2'),
    });
  }
  if (blueprint.fundId === 'THF-GL-U-010') {
    rows.push({
      versionId: `${blueprint.fundId}-SHELF-v2`,
      effectiveFrom: '2024-04-01',
      publishedAt: '2024-03-18',
      status: 'NOT_APPROVED',
      permissions: ['VIEW'],
      shelfVersion: 'SHELF-SYN-v4',
      sourceRef: sourceRef('approved-shelf', blueprint.fundId, 'v2'),
    });
  }
  return rows;
}

function buildQualityHistory(blueprint) {
  const rows = [{
    versionId: `${blueprint.fundId}-QUALITY-v1`,
    effectiveFrom: blueprint.inceptionDate,
    publishedAt: blueprint.inceptionDate,
    status: 'PASS',
    reasonCodes: [],
    sourceRef: sourceRef('data-quality', blueprint.fundId, 'v1'),
  }];
  if (blueprint.fundId === 'THF-BD-CR-004') {
    rows.push({
      versionId: `${blueprint.fundId}-QUALITY-v2`,
      effectiveFrom: '2022-06-15',
      publishedAt: '2022-06-15',
      status: 'FAIL',
      reasonCodes: ['FACTSHEET_STALE'],
      sourceRef: sourceRef('data-quality', blueprint.fundId, 'v2'),
    });
    rows.push({
      versionId: `${blueprint.fundId}-QUALITY-v3`,
      effectiveFrom: '2022-10-03',
      publishedAt: '2022-10-03',
      status: 'PASS',
      reasonCodes: [],
      sourceRef: sourceRef('data-quality', blueprint.fundId, 'v3'),
    });
  }
  return rows;
}

function buildFunds(dates, factors, normal) {
  return FUND_BLUEPRINTS.map((blueprint) => ({
    fundId: blueprint.fundId,
    masterFundId: blueprint.masterFundId,
    fundCode: blueprint.fundCode,
    nameTh: blueprint.nameTh,
    nameEn: blueprint.nameEn,
    amcCode: blueprint.amcCode,
    thaiRegistered: true,
    currency: 'THB',
    inceptionDate: blueprint.inceptionDate,
    synthetic: true,
    classificationHistory: buildClassificationHistory(blueprint),
    factsheetHistory: buildFactsheetHistory(blueprint),
    shelfHistory: buildShelfHistory(blueprint),
    qualityHistory: buildQualityHistory(blueprint),
    navHistory: buildNavHistory(blueprint, dates, factors, normal),
  }));
}

const BENCHMARK_DEFINITIONS = Object.freeze([
  Object.freeze({ benchmarkId: 'BM-TH-CASH', nameTh: 'เกณฑ์ตลาดเงินจำลอง', bucket: 'CASH', exposure: { cash: 1.00 } }),
  Object.freeze({ benchmarkId: 'BM-TH-BOND', nameTh: 'เกณฑ์ตราสารหนี้ไทยจำลอง', bucket: 'FIXED_INCOME', exposure: { duration: 0.65, credit: 0.35 } }),
  Object.freeze({ benchmarkId: 'BM-TH-EQUITY', nameTh: 'เกณฑ์หุ้นไทยจำลอง', bucket: 'THAI_EQUITY', exposure: { thai: 1.00 } }),
  Object.freeze({ benchmarkId: 'BM-GLOBAL-EQUITY', nameTh: 'เกณฑ์หุ้นโลกจำลอง', bucket: 'GLOBAL_EQUITY', exposure: { global: 1.00, fx: 0.20 } }),
  Object.freeze({ benchmarkId: 'BM-REAL-ASSET', nameTh: 'เกณฑ์สินทรัพย์จริงจำลอง', bucket: 'REAL_ASSET', exposure: { real: 0.60, gold: 0.40 } }),
]);

function buildBenchmarks(dates, factors) {
  return BENCHMARK_DEFINITIONS.map((definition, index) => {
    let level = 100 + index * 10;
    const history = dates.map((date) => {
      const daily = factors.get(date);
      let dailyReturn = 0;
      for (const [factorName, exposure] of Object.entries(definition.exposure)) {
        dailyReturn += exposure * daily[factorName];
      }
      dailyReturn = Math.max(-0.35, Math.min(0.20, dailyReturn));
      level = Math.max(1, level * (1 + dailyReturn));
      return {
        date,
        observedAt: date,
        availableAt: addDays(date, 1),
        level: Number(level.toFixed(8)),
        currency: 'THB',
        sourceRef: sourceRef('benchmark', definition.benchmarkId, date),
      };
    });
    return { ...definition, history, synthetic: true };
  });
}

function quarterDates() {
  const rows = [];
  for (let year = 2020; year <= 2024; year += 1) {
    for (const month of ['01', '04', '07', '10']) rows.push(`${year}-${month}-01`);
  }
  return rows;
}

function holdingsForYear(year) {
  if (year === 2020) return [
    ['THF-MM-001', 0.10], ['THF-BD-ST-002', 0.25], ['THF-BD-GOV-003', 0.15],
    ['THF-EQ-LC-007', 0.30], ['THF-GL-H-009', 0.15], ['THF-PROP-012', 0.05],
  ];
  if (year === 2021) return [
    ['THF-MM-001', 0.06], ['THF-BD-ST-002', 0.20], ['THF-BD-CR-004', 0.14],
    ['THF-EQ-LC-007', 0.25], ['THF-EQ-SC-008', 0.15], ['THF-GL-H-009', 0.15],
    ['THF-PROP-012', 0.05],
  ];
  if (year === 2022) return [
    ['THF-MM-001', 0.05], ['THF-BD-GOV-003', 0.15], ['THF-BD-CR-004', 0.10],
    ['THF-EQ-LC-007', 0.20], ['THF-EQ-SC-008', 0.20], ['THF-GL-U-010', 0.20],
    ['THF-PROP-012', 0.10],
  ];
  if (year === 2023) return [
    ['THF-MM-001', 0.12], ['THF-BD-ST-002', 0.25], ['THF-BD-GOV-003', 0.15],
    ['THF-BAL-DEF-005', 0.10], ['THF-EQ-LC-007', 0.18], ['THF-GL-H-009', 0.15],
    ['THF-GOLD-011', 0.05],
  ];
  return [
    ['THF-MM-001', 0.15], ['THF-BD-ST-002', 0.25], ['THF-BD-GOV-003', 0.15],
    ['THF-BAL-DEF-005', 0.10], ['THF-EQ-LC-007', 0.15], ['THF-GL-H-009', 0.15],
    ['THF-GOLD-011', 0.05],
  ];
}

function buildPortfolioHoldings() {
  const rows = quarterDates().map((asOf, index) => ({
    snapshotId: `HOLD-SYN-${String(index + 1).padStart(3, '0')}`,
    portfolioId: 'PORT-SYN-GOAL-001',
    asOf,
    availableAt: addDays(asOf, 5),
    holdings: holdingsForYear(Number(asOf.slice(0, 4))).map(([fundId, weight]) => ({ fundId, masterFundId: fundId, weight })),
    sourceRef: sourceRef('portfolio-holdings', 'PORT-SYN-GOAL-001', asOf),
  }));
  rows.push({
    snapshotId: 'HOLD-SYN-FUTURE-REVISION',
    portfolioId: 'PORT-SYN-GOAL-001',
    asOf: '2022-01-01',
    availableAt: '2025-04-15',
    holdings: [{ fundId: 'THF-GOLD-011', masterFundId: 'THF-GOLD-011', weight: 1 }],
    sourceRef: sourceRef('portfolio-holdings', 'PORT-SYN-GOAL-001', 'future-revision'),
  });
  return rows;
}

function buildClientSnapshots() {
  return [
    {
      snapshotId: 'CLIENT-SYN-v1',
      clientId: 'CLIENT-SYN-GOAL-001',
      asOf: '2020-01-01',
      availableAt: '2019-12-20',
      suitability: { maxRiskLevel: 6, current: true },
      liquidityReserve: 300000,
      goal: { goalId: 'GOAL-SYN-EDU-001', nameTh: 'ค่าเรียนบุตร', targetAmount: 4100000, targetDate: '2025-01-01', startingFunding: 2500000, monthlyContribution: 22000 },
      sourceRef: sourceRef('client-snapshot', 'CLIENT-SYN-GOAL-001', 'v1'),
    },
    {
      snapshotId: 'CLIENT-SYN-v2',
      clientId: 'CLIENT-SYN-GOAL-001',
      asOf: '2022-01-01',
      availableAt: '2022-01-10',
      suitability: { maxRiskLevel: 6, current: true },
      liquidityReserve: 330000,
      goal: { goalId: 'GOAL-SYN-EDU-001', nameTh: 'ค่าเรียนบุตร', targetAmount: 4300000, targetDate: '2025-01-01', startingFunding: 2500000, monthlyContribution: 24000 },
      sourceRef: sourceRef('client-snapshot', 'CLIENT-SYN-GOAL-001', 'v2'),
    },
    {
      snapshotId: 'CLIENT-SYN-v3',
      clientId: 'CLIENT-SYN-GOAL-001',
      asOf: '2023-02-01',
      availableAt: '2023-02-06',
      suitability: { maxRiskLevel: 5, current: true },
      liquidityReserve: 350000,
      goal: { goalId: 'GOAL-SYN-EDU-001', nameTh: 'ค่าเรียนบุตร', targetAmount: 4300000, targetDate: '2025-01-01', startingFunding: 2500000, monthlyContribution: 24000 },
      sourceRef: sourceRef('client-snapshot', 'CLIENT-SYN-GOAL-001', 'v3'),
    },
  ];
}

function buildApprovedModels() {
  return [
    {
      modelId: 'MODEL-SYN-BAL-v1',
      nameTh: 'แบบพอร์ตสมดุลที่อนุมัติ รุ่น 1',
      effectiveFrom: '2020-01-01',
      publishedAt: '2019-12-15',
      maxClientRiskLevel: 6,
      weights: { CASH: 0.12, FIXED_INCOME: 0.38, BALANCED: 0.10, THAI_EQUITY: 0.22, GLOBAL_EQUITY: 0.13, REAL_ASSET: 0.05 },
      sourceRef: sourceRef('approved-model', 'MODEL-SYN-BAL', 'v1'),
    },
    {
      modelId: 'MODEL-SYN-BAL-v2',
      nameTh: 'แบบพอร์ตสมดุลที่อนุมัติ รุ่น 2',
      effectiveFrom: '2022-11-01',
      publishedAt: '2022-10-17',
      maxClientRiskLevel: 6,
      weights: { CASH: 0.15, FIXED_INCOME: 0.42, BALANCED: 0.10, THAI_EQUITY: 0.18, GLOBAL_EQUITY: 0.10, REAL_ASSET: 0.05 },
      sourceRef: sourceRef('approved-model', 'MODEL-SYN-BAL', 'v2'),
    },
  ];
}

function buildPolicyBenchmarks() {
  return [{
    policyId: 'POLICY-BM-SYN-v1',
    effectiveFrom: '2020-01-01',
    publishedAt: '2019-12-15',
    weights: { 'BM-TH-CASH': 0.15, 'BM-TH-BOND': 0.40, 'BM-TH-EQUITY': 0.22, 'BM-GLOBAL-EQUITY': 0.15, 'BM-REAL-ASSET': 0.08 },
    sourceRef: sourceRef('policy-benchmark', 'POLICY-BM-SYN', 'v1'),
  }];
}

function buildCapitalMarketAssumptions() {
  return [
    {
      assumptionId: 'CMA-SYN-v1',
      effectiveFrom: '2020-01-01',
      publishedAt: '2019-12-15',
      annualExpectedReturns: { CASH: 0.012, FIXED_INCOME: 0.028, BALANCED: 0.045, THAI_EQUITY: 0.065, GLOBAL_EQUITY: 0.070, REAL_ASSET: 0.045 },
      transactionCostBps: 15,
      sourceRef: sourceRef('capital-market-assumption', 'CMA-SYN', 'v1'),
    },
    {
      assumptionId: 'CMA-SYN-v2',
      effectiveFrom: '2022-07-01',
      publishedAt: '2022-06-20',
      annualExpectedReturns: { CASH: 0.018, FIXED_INCOME: 0.035, BALANCED: 0.048, THAI_EQUITY: 0.060, GLOBAL_EQUITY: 0.065, REAL_ASSET: 0.042 },
      transactionCostBps: 18,
      sourceRef: sourceRef('capital-market-assumption', 'CMA-SYN', 'v2'),
    },
  ];
}

function buildMarketEvents() {
  return [
    {
      eventId: 'EVENT-COVID-LIQUIDITY-2020',
      nameTh: 'ตลาดผันผวนและสภาพคล่องลดลงช่วงโควิด-19',
      startedAt: '2020-02-20',
      detectedAt: '2020-02-24',
      endedAt: '2020-04-30',
      closurePublishedAt: '2020-05-06',
      affectedBuckets: ['THAI_EQUITY', 'GLOBAL_EQUITY', 'REAL_ASSET', 'FIXED_INCOME'],
      severity: 'HIGH',
      sourceRef: sourceRef('market-event', 'EVENT-COVID-LIQUIDITY-2020', 'v1'),
    },
    {
      eventId: 'EVENT-GLOBAL-RATE-2022',
      nameTh: 'ดอกเบี้ยโลกปรับขึ้นเร็ว',
      startedAt: '2022-04-01',
      detectedAt: '2022-04-05',
      endedAt: '2022-10-31',
      closurePublishedAt: '2022-11-07',
      affectedBuckets: ['FIXED_INCOME', 'BALANCED', 'REAL_ASSET'],
      severity: 'MEDIUM',
      sourceRef: sourceRef('market-event', 'EVENT-GLOBAL-RATE-2022', 'v1'),
    },
    {
      eventId: 'EVENT-THAI-EQUITY-2023',
      nameTh: 'หุ้นไทยปรับลงต่อเนื่อง',
      startedAt: '2023-08-01',
      detectedAt: '2023-08-03',
      endedAt: '2023-11-30',
      closurePublishedAt: '2023-12-07',
      affectedBuckets: ['THAI_EQUITY', 'BALANCED', 'REAL_ASSET'],
      severity: 'MEDIUM',
      sourceRef: sourceRef('market-event', 'EVENT-THAI-EQUITY-2023', 'v1'),
    },
  ];
}

function buildDecisionDates(startDate = '2020-02-01', endDate = '2024-12-01') {
  const dates = [];
  let cursor = new Date(`${startDate.slice(0, 7)}-01T00:00:00.000Z`);
  const end = `${endDate.slice(0, 7)}-01`;
  while (cursor.toISOString().slice(0, 10) <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return dates;
}

function createHistoricalReplayFixtures(options = {}) {
  const seed = options.seed || DEFAULT_REPLAY_SEED;
  const dates = businessDates(HISTORY_START, HISTORY_END);
  const random = seededRandom(seed);
  const normal = normalGenerator(random);
  const factors = buildDailyFactors(dates, normal);
  const funds = buildFunds(dates, factors, normal);
  const benchmarks = buildBenchmarks(dates, factors);
  return {
    datasetId: REPLAY_DATASET_ID,
    seed,
    origin: 'SYNTHETIC_FIXTURE',
    synthetic: true,
    generatedFor: 'HISTORICAL_REPLAY_VALIDATION',
    historyStart: HISTORY_START,
    historyEnd: HISTORY_END,
    availableThrough: '2025-01-01',
    currency: 'THB',
    returnType: 'NAV_RETURN',
    isTotalReturn: false,
    limitations: [
      'ข้อมูลนี้เป็นข้อมูลกองทุนสังเคราะห์ ไม่ใช่กองทุนจริงหรือผลลัพธ์ลูกค้าจริง',
      'NAV ดิบอาจไม่รวมเงินปันผล จึงไม่เรียกว่าผลตอบแทนรวม',
    ],
    fundCount: funds.length,
    funds,
    benchmarks,
    portfolioHoldings: buildPortfolioHoldings(),
    clientSnapshots: buildClientSnapshots(),
    approvedModels: buildApprovedModels(),
    policyBenchmarks: buildPolicyBenchmarks(),
    capitalMarketAssumptions: buildCapitalMarketAssumptions(),
    marketEvents: buildMarketEvents(),
    stressPeriods: STRESS_PERIODS.map((period) => ({ ...period, affectedBuckets: [...period.affectedBuckets] })),
    decisionDates: buildDecisionDates(),
  };
}

module.exports = {
  DEFAULT_REPLAY_SEED,
  REPLAY_DATASET_ID,
  HISTORY_START,
  HISTORY_END,
  STRESS_PERIODS,
  FUND_BLUEPRINTS,
  buildDecisionDates,
  createHistoricalReplayFixtures,
};
