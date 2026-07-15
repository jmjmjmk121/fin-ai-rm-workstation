'use strict';

// These records are synthetic and exist only so the application can operate in
// fixture mode until a documented SETSMART mutual-fund contract is supplied.
// Names and identifiers intentionally do not represent real products.

const FIXTURE_AS_OF = '2026-07-14';
const FIXTURE_DATASET_ID = 'thai-mutual-funds-v3-synthetic';

function source(section, asOf = FIXTURE_AS_OF) {
  const sourceRef = `fixture://${FIXTURE_DATASET_ID}/${section}`;
  return {
    provider: 'FIXTURE',
    datasetId: FIXTURE_DATASET_ID,
    sourceRef,
    sourceRefs: [sourceRef],
    asOf,
    synthetic: true,
  };
}

function freshness(asOf = FIXTURE_AS_OF) {
  return {
    asOf,
    datasetAsOf: FIXTURE_AS_OF,
    status: 'FIXTURE',
    isStale: false,
    warningTh: 'ข้อมูลสังเคราะห์สำหรับทดสอบ ไม่ใช่ข้อมูลผลิตภัณฑ์จริง',
  };
}

function governance({ approved = true, quality = 'PASS', permissions = ['VIEW', 'ADVISE'], minClientRiskLevel = 1 } = {}) {
  return {
    approved: approved,
    approvedShelf: {
      status: approved ? 'APPROVED' : 'NOT_APPROVED',
      shelfVersion: 'SHELF-FIXTURE-2026-07',
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
    },
    eligibility: {
      status: 'ELIGIBLE',
      minClientRiskLevel,
      reasonCodes: [],
    },
    dataQuality: {
      status: quality,
      navAsOf: quality === 'PASS' ? FIXTURE_AS_OF : '2025-12-30',
      observationCount: quality === 'PASS' ? 1305 : 8,
      requiredFieldsComplete: quality === 'PASS',
    },
    permissions: [...permissions],
  };
}

function makeMaster({
  masterFundId,
  fundCode,
  nameTh,
  nameEn,
  amcCode,
  assetClass,
  riskLevel,
  shareClassIds,
  approved,
  quality,
  permissions,
  minClientRiskLevel,
}) {
  return {
    masterFundId,
    fundCode,
    nameTh,
    nameEn,
    amcCode,
    amcNameTh: `บริษัทหลักทรัพย์จัดการกองทุนตัวอย่าง ${amcCode}`,
    registrationCountryCode: 'TH',
    registrationCountry: 'Thailand',
    thaiRegistered: true,
    currency: 'THB',
    assetClass,
    riskLevel,
    shareClassIds: [...shareClassIds],
    returnType: 'NAV_RETURN',
    isTotalReturn: false,
    distributionsIncluded: false,
    isSynthetic: true,
    ...governance({ approved, quality, permissions, minClientRiskLevel }),
    source: source(`master/${masterFundId}`),
    freshness: freshness(),
  };
}

const FUND_MASTERS = [
  makeMaster({
    masterFundId: 'TH-MF-CASH-001',
    fundCode: 'DEMO-CASH',
    nameTh: 'กองทุนตลาดเงินไทยตัวอย่าง',
    nameEn: 'Synthetic Thai Money Market Fund',
    amcCode: 'AMC-DEMO-A',
    assetClass: 'MONEY_MARKET',
    riskLevel: 1,
    shareClassIds: ['TH-CASH-A'],
    approved: true,
    quality: 'PASS',
    permissions: ['VIEW', 'ADVISE'],
    minClientRiskLevel: 1,
  }),
  makeMaster({
    masterFundId: 'TH-MF-BOND-001',
    fundCode: 'DEMO-BOND',
    nameTh: 'กองทุนตราสารหนี้ไทยตัวอย่าง',
    nameEn: 'Synthetic Thai Bond Fund',
    amcCode: 'AMC-DEMO-A',
    assetClass: 'FIXED_INCOME',
    riskLevel: 4,
    shareClassIds: ['TH-BOND-A', 'TH-BOND-R'],
    approved: true,
    quality: 'PASS',
    permissions: ['VIEW', 'ADVISE'],
    minClientRiskLevel: 3,
  }),
  makeMaster({
    masterFundId: 'TH-MF-EQ-001',
    fundCode: 'DEMO-TH-EQ',
    nameTh: 'กองทุนหุ้นไทยตัวอย่าง',
    nameEn: 'Synthetic Thai Equity Fund',
    amcCode: 'AMC-DEMO-B',
    assetClass: 'THAI_EQUITY',
    riskLevel: 6,
    shareClassIds: ['TH-EQ-A', 'TH-EQ-D'],
    approved: true,
    quality: 'PASS',
    permissions: ['VIEW', 'ADVISE'],
    minClientRiskLevel: 5,
  }),
  makeMaster({
    masterFundId: 'TH-MF-GLOBAL-001',
    fundCode: 'DEMO-GLOBAL-EQ',
    nameTh: 'กองทุนหุ้นต่างประเทศตัวอย่างที่ยังไม่อยู่ในรายการอนุมัติ',
    nameEn: 'Synthetic Unapproved Global Equity Fund',
    amcCode: 'AMC-DEMO-B',
    assetClass: 'GLOBAL_EQUITY',
    riskLevel: 6,
    shareClassIds: ['TH-GLOBAL-A'],
    approved: false,
    quality: 'PASS',
    permissions: ['VIEW', 'ADVISE'],
    minClientRiskLevel: 5,
  }),
  makeMaster({
    masterFundId: 'TH-MF-MIXED-STALE-001',
    fundCode: 'DEMO-MIXED-STALE',
    nameTh: 'กองทุนผสมตัวอย่างที่ข้อมูลไม่ผ่านเกณฑ์',
    nameEn: 'Synthetic Mixed Fund With Failed Data Quality',
    amcCode: 'AMC-DEMO-C',
    assetClass: 'MIXED',
    riskLevel: 5,
    shareClassIds: ['TH-MIXED-A'],
    approved: true,
    quality: 'FAIL',
    permissions: ['VIEW', 'ADVISE'],
    minClientRiskLevel: 4,
  }),
  makeMaster({
    masterFundId: 'TH-MF-RESTRICTED-001',
    fundCode: 'DEMO-RESTRICTED',
    nameTh: 'กองทุนตัวอย่างที่ดูข้อมูลได้แต่ห้ามแนะนำ',
    nameEn: 'Synthetic View-Only Fund',
    amcCode: 'AMC-DEMO-C',
    assetClass: 'FIXED_INCOME',
    riskLevel: 4,
    shareClassIds: ['TH-RESTRICTED-A'],
    approved: true,
    quality: 'PASS',
    permissions: ['VIEW'],
    minClientRiskLevel: 3,
  }),
];

function masterById(masterFundId) {
  return FUND_MASTERS.find((fund) => fund.masterFundId === masterFundId);
}

function makeShareClass({ fundId, masterFundId, suffixTh, distributionPolicy, minimumInitialInvestment = 1000 }) {
  const master = masterById(masterFundId);
  return {
    fundId,
    shareClassId: fundId,
    masterFundId,
    fundCode: fundId,
    nameTh: `${master.nameTh} ชนิด${suffixTh}`,
    nameEn: `${master.nameEn} (${fundId})`,
    shareClassNameTh: suffixTh,
    registrationCountryCode: 'TH',
    thaiRegistered: true,
    amcCode: master.amcCode,
    assetClass: master.assetClass,
    riskLevel: master.riskLevel,
    currency: 'THB',
    minimumInitialInvestment,
    distributionPolicy,
    navType: 'RAW_NAV',
    returnType: 'NAV_RETURN',
    distributionAdjusted: false,
    isTotalReturn: false,
    isSynthetic: true,
    approved: master.approved,
    approvedShelf: { ...master.approvedShelf },
    eligibility: { ...master.eligibility },
    dataQuality: { ...master.dataQuality },
    permissions: [...master.permissions],
    source: source(`share-class/${fundId}`),
    freshness: freshness(),
  };
}

const FUND_SHARE_CLASSES = [
  makeShareClass({ fundId: 'TH-CASH-A', masterFundId: 'TH-MF-CASH-001', suffixTh: 'สะสมมูลค่า', distributionPolicy: 'ACCUMULATING', minimumInitialInvestment: 1 }),
  makeShareClass({ fundId: 'TH-BOND-A', masterFundId: 'TH-MF-BOND-001', suffixTh: 'สะสมมูลค่า', distributionPolicy: 'ACCUMULATING' }),
  makeShareClass({ fundId: 'TH-BOND-R', masterFundId: 'TH-MF-BOND-001', suffixTh: 'เพื่อการออม', distributionPolicy: 'ACCUMULATING', minimumInitialInvestment: 500 }),
  makeShareClass({ fundId: 'TH-EQ-A', masterFundId: 'TH-MF-EQ-001', suffixTh: 'สะสมมูลค่า', distributionPolicy: 'ACCUMULATING' }),
  makeShareClass({ fundId: 'TH-EQ-D', masterFundId: 'TH-MF-EQ-001', suffixTh: 'จ่ายเงินปันผล', distributionPolicy: 'DISTRIBUTING' }),
  makeShareClass({ fundId: 'TH-GLOBAL-A', masterFundId: 'TH-MF-GLOBAL-001', suffixTh: 'สะสมมูลค่า', distributionPolicy: 'ACCUMULATING' }),
  makeShareClass({ fundId: 'TH-MIXED-A', masterFundId: 'TH-MF-MIXED-STALE-001', suffixTh: 'สะสมมูลค่า', distributionPolicy: 'ACCUMULATING' }),
  makeShareClass({ fundId: 'TH-RESTRICTED-A', masterFundId: 'TH-MF-RESTRICTED-001', suffixTh: 'สะสมมูลค่า', distributionPolicy: 'ACCUMULATING' }),
];

function profile(masterFundId, details) {
  const master = masterById(masterFundId);
  return {
    masterFundId,
    nameTh: master.nameTh,
    assetClass: master.assetClass,
    riskLevel: master.riskLevel,
    currency: 'THB',
    registrationCountryCode: 'TH',
    investmentPolicyTh: details.investmentPolicyTh,
    returnDriversTh: details.returnDriversTh,
    lossMechanismsTh: details.lossMechanismsTh,
    fees: {
      managementFeePctPerYear: details.managementFeePctPerYear,
      totalExpenseRatioPctPerYear: details.totalExpenseRatioPctPerYear,
      asOf: '2026-06-30',
      fixtureOnly: true,
    },
    liquidity: {
      dealingFrequency: 'BUSINESS_DAILY',
      redemptionSettlementBusinessDays: details.redemptionSettlementBusinessDays,
      warningTh: details.liquidityWarningTh,
    },
    currencyRisk: details.currencyRisk,
    suitableGoalTypes: [...details.suitableGoalTypes],
    unsuitableForTh: details.unsuitableForTh,
    suggestedHoldingPeriodYears: details.suggestedHoldingPeriodYears,
    returnType: 'NAV_RETURN',
    isTotalReturn: false,
    distributionsIncluded: false,
    isSynthetic: true,
    source: source(`profile/${masterFundId}`),
    freshness: freshness(),
  };
}

const FUND_PROFILES = {
  'TH-MF-CASH-001': profile('TH-MF-CASH-001', {
    investmentPolicyTh: 'ลงทุนในเงินฝากและตราสารหนี้ระยะสั้นสกุลบาทตามข้อมูลสังเคราะห์',
    returnDriversTh: 'ดอกเบี้ยระยะสั้นและรายได้จากตราสารหนี้',
    lossMechanismsTh: 'มูลค่าอาจลดลงได้จากความเสี่ยงเครดิต สภาพคล่อง หรือดอกเบี้ย แม้ความผันผวนมักต่ำกว่าเงินลงทุนระยะยาว',
    managementFeePctPerYear: 0.25,
    totalExpenseRatioPctPerYear: 0.36,
    redemptionSettlementBusinessDays: 1,
    liquidityWarningTh: 'ไม่ใช่เงินฝากและไม่ได้รับประกันเงินต้น',
    currencyRisk: 'NONE_EXPECTED_THB_ASSETS',
    suitableGoalTypes: ['EMERGENCY_RESERVE', 'NEAR_TERM_LIQUIDITY'],
    unsuitableForTh: 'ไม่เหมาะเป็นสินทรัพย์หลักสำหรับเป้าหมายเติบโตระยะยาวที่ต้องการผลตอบแทนสูง',
    suggestedHoldingPeriodYears: 0.25,
  }),
  'TH-MF-BOND-001': profile('TH-MF-BOND-001', {
    investmentPolicyTh: 'ลงทุนในพันธบัตรรัฐบาลและตราสารหนี้เอกชนไทยคุณภาพสูงตามข้อมูลสังเคราะห์',
    returnDriversTh: 'ดอกเบี้ยรับ การเปลี่ยนแปลงอัตราดอกเบี้ย และส่วนชดเชยความเสี่ยงเครดิต',
    lossMechanismsTh: 'ขาดทุนได้เมื่อดอกเบี้ยเพิ่มขึ้น ผู้ออกตราสารมีปัญหา หรือสภาพคล่องตลาดลดลง',
    managementFeePctPerYear: 0.55,
    totalExpenseRatioPctPerYear: 0.72,
    redemptionSettlementBusinessDays: 2,
    liquidityWarningTh: 'ราคาขายคืนอาจต่ำกว่าราคาซื้อและระยะรับเงินขึ้นกับวันทำการ',
    currencyRisk: 'NONE_EXPECTED_THB_ASSETS',
    suitableGoalTypes: ['EDUCATION', 'RETIREMENT', 'HOME'],
    unsuitableForTh: 'ไม่เหมาะกับผู้ที่ต้องการรับประกันเงินต้นหรือใช้เงินทันทีโดยไม่มีเงินสำรองอื่น',
    suggestedHoldingPeriodYears: 2,
  }),
  'TH-MF-EQ-001': profile('TH-MF-EQ-001', {
    investmentPolicyTh: 'ลงทุนในหุ้นจดทะเบียนไทยหลายอุตสาหกรรมตามข้อมูลสังเคราะห์',
    returnDriversTh: 'กำไรบริษัท เงินปันผล และการเปลี่ยนแปลงมูลค่าหุ้นไทย',
    lossMechanismsTh: 'ขาดทุนได้มากจากภาวะเศรษฐกิจ ผลประกอบการบริษัท และความผันผวนของตลาดหุ้น',
    managementFeePctPerYear: 1.35,
    totalExpenseRatioPctPerYear: 1.62,
    redemptionSettlementBusinessDays: 3,
    liquidityWarningTh: 'มูลค่ารับซื้อคืนผันผวนและอาจใช้เวลาหลายวันทำการกว่าจะได้รับเงิน',
    currencyRisk: 'NONE_EXPECTED_THB_ASSETS',
    suitableGoalTypes: ['RETIREMENT', 'WEALTH_GROWTH', 'LEGACY'],
    unsuitableForTh: 'ไม่เหมาะกับเงินฉุกเฉิน เป้าหมายระยะสั้น หรือผู้ที่รับการลดลงของมูลค่ามากไม่ได้',
    suggestedHoldingPeriodYears: 5,
  }),
  'TH-MF-GLOBAL-001': profile('TH-MF-GLOBAL-001', {
    investmentPolicyTh: 'ลงทุนในหุ้นต่างประเทศผ่านกองทุนหลักตามข้อมูลสังเคราะห์',
    returnDriversTh: 'ผลประกอบการหุ้นต่างประเทศและอัตราแลกเปลี่ยน',
    lossMechanismsTh: 'ขาดทุนได้จากตลาดหุ้น ค่าเงิน และความเสี่ยงของกองทุนหลัก',
    managementFeePctPerYear: 1.5,
    totalExpenseRatioPctPerYear: 1.9,
    redemptionSettlementBusinessDays: 5,
    liquidityWarningTh: 'วันหยุดต่างประเทศอาจทำให้ซื้อขายหรือรับเงินล่าช้า',
    currencyRisk: 'UNHEDGED_OR_PARTIALLY_HEDGED',
    suitableGoalTypes: ['RETIREMENT', 'WEALTH_GROWTH'],
    unsuitableForTh: 'ยังไม่อยู่ในรายการผลิตภัณฑ์อนุมัติของชุดข้อมูลตัวอย่าง จึงห้ามใช้เป็นคำแนะนำ',
    suggestedHoldingPeriodYears: 5,
  }),
  'TH-MF-MIXED-STALE-001': profile('TH-MF-MIXED-STALE-001', {
    investmentPolicyTh: 'กองทุนผสมตามข้อมูลสังเคราะห์ แต่ข้อมูลปัจจุบันไม่ครบ',
    returnDriversTh: 'ผลตอบแทนจากหุ้นและตราสารหนี้',
    lossMechanismsTh: 'ขาดทุนได้จากทั้งตลาดหุ้น อัตราดอกเบี้ย และเครดิต',
    managementFeePctPerYear: 1.0,
    totalExpenseRatioPctPerYear: 1.25,
    redemptionSettlementBusinessDays: 3,
    liquidityWarningTh: 'ข้อมูล NAV ไม่ผ่านเกณฑ์ความสด จึงห้ามใช้สร้างคำแนะนำ',
    currencyRisk: 'UNKNOWN',
    suitableGoalTypes: ['RETIREMENT'],
    unsuitableForTh: 'ข้อมูลยังไม่พอสำหรับการพิจารณา',
    suggestedHoldingPeriodYears: 3,
  }),
  'TH-MF-RESTRICTED-001': profile('TH-MF-RESTRICTED-001', {
    investmentPolicyTh: 'ตราสารหนี้ไทยตามข้อมูลสังเคราะห์',
    returnDriversTh: 'ดอกเบี้ยรับ',
    lossMechanismsTh: 'อัตราดอกเบี้ยและเครดิต',
    managementFeePctPerYear: 0.65,
    totalExpenseRatioPctPerYear: 0.8,
    redemptionSettlementBusinessDays: 2,
    liquidityWarningTh: 'สิทธิ์ปัจจุบันอนุญาตให้ดูข้อมูลเท่านั้น',
    currencyRisk: 'NONE_EXPECTED_THB_ASSETS',
    suitableGoalTypes: ['RETIREMENT'],
    unsuitableForTh: 'ห้ามใช้เป็นคำแนะนำเมื่อไม่มีสิทธิ์ ADVISE',
    suggestedHoldingPeriodYears: 2,
  }),
};

function businessDates(endDate, count) {
  const cursor = new Date(`${endDate}T00:00:00Z`);
  const dates = [];
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.reverse();
}

// 1,305 business-day observations cover approximately five calendar years and
// make every fixture range deterministic across machines and test runs.
const NAV_DATES = businessDates(FIXTURE_AS_OF, 1305);

function buildNavHistory(fundId, startNav, drift, wave, phase) {
  let nav = startNav;
  return NAV_DATES.map((date, index) => {
    if (index > 0) {
      const dailyReturn = drift + Math.sin(index * 0.63 + phase) * wave + Math.cos(index * 0.17 + phase) * wave * 0.35;
      nav = Math.max(0.01, nav * (1 + dailyReturn));
    }
    return {
      fundId,
      date,
      nav: Number(nav.toFixed(4)),
      currency: 'THB',
      navType: 'RAW_NAV',
      returnType: 'NAV_RETURN',
      distributionAdjusted: false,
      distributionsIncluded: false,
      isTotalReturn: false,
      source: source(`nav/${fundId}`, date),
      freshness: freshness(date),
    };
  });
}

const NAV_HISTORY = {
  'TH-CASH-A': buildNavHistory('TH-CASH-A', 10.0, 0.000055, 0.000025, 0.2),
  'TH-BOND-A': buildNavHistory('TH-BOND-A', 11.2, 0.00012, 0.0012, 0.7),
  'TH-BOND-R': buildNavHistory('TH-BOND-R', 10.5, 0.00012, 0.0012, 0.7),
  'TH-EQ-A': buildNavHistory('TH-EQ-A', 15.3, 0.00018, 0.0075, 1.3),
  'TH-EQ-D': buildNavHistory('TH-EQ-D', 9.7, 0.00018, 0.0075, 1.3),
  'TH-GLOBAL-A': buildNavHistory('TH-GLOBAL-A', 12.4, 0.00022, 0.0085, 2.1),
  'TH-MIXED-A': buildNavHistory('TH-MIXED-A', 10.8, 0.00013, 0.004, 0.4).slice(-8),
  'TH-RESTRICTED-A': buildNavHistory('TH-RESTRICTED-A', 10.2, 0.0001, 0.0014, 1.7),
};

function documents(masterFundId) {
  return [
    {
      documentId: `${masterFundId}-FACTSHEET`,
      masterFundId,
      documentType: 'FACT_SHEET',
      titleTh: 'หนังสือชี้ชวนส่วนสรุปข้อมูลสำคัญ (เอกสารตัวอย่าง)',
      documentDate: '2026-06-30',
      source: source(`documents/${masterFundId}/factsheet`, '2026-06-30'),
      freshness: freshness('2026-06-30'),
      isSynthetic: true,
    },
    {
      documentId: `${masterFundId}-PROSPECTUS`,
      masterFundId,
      documentType: 'PROSPECTUS',
      titleTh: 'หนังสือชี้ชวนฉบับเต็ม (เอกสารตัวอย่าง)',
      documentDate: '2026-01-02',
      source: source(`documents/${masterFundId}/prospectus`, '2026-01-02'),
      freshness: freshness('2026-01-02'),
      isSynthetic: true,
    },
  ];
}

const FUND_DOCUMENTS = Object.fromEntries(FUND_MASTERS.map((fund) => [fund.masterFundId, documents(fund.masterFundId)]));

function allocation(masterFundId, holdings) {
  return [{
    masterFundId,
    asOf: '2026-06-30',
    currency: 'THB',
    allocationType: 'ASSET_CLASS',
    holdings: holdings.map((item) => ({ ...item })),
    lookThroughAvailable: false,
    isSynthetic: true,
    source: source(`allocation/${masterFundId}`, '2026-06-30'),
    freshness: freshness('2026-06-30'),
  }];
}

const FUND_ALLOCATIONS = {
  'TH-MF-CASH-001': allocation('TH-MF-CASH-001', [
    { labelTh: 'เงินฝากและตราสารหนี้ระยะสั้น', weight: 0.96 },
    { labelTh: 'เงินสดและอื่น ๆ', weight: 0.04 },
  ]),
  'TH-MF-BOND-001': allocation('TH-MF-BOND-001', [
    { labelTh: 'พันธบัตรรัฐบาลไทย', weight: 0.62 },
    { labelTh: 'ตราสารหนี้เอกชนไทย', weight: 0.33 },
    { labelTh: 'เงินสดและอื่น ๆ', weight: 0.05 },
  ]),
  'TH-MF-EQ-001': allocation('TH-MF-EQ-001', [
    { labelTh: 'หุ้นไทย', weight: 0.94 },
    { labelTh: 'เงินสดและอื่น ๆ', weight: 0.06 },
  ]),
  'TH-MF-GLOBAL-001': allocation('TH-MF-GLOBAL-001', [
    { labelTh: 'หน่วยลงทุนกองทุนหลักต่างประเทศ', weight: 0.96 },
    { labelTh: 'เงินสดและอื่น ๆ', weight: 0.04 },
  ]),
  'TH-MF-MIXED-STALE-001': allocation('TH-MF-MIXED-STALE-001', [
    { labelTh: 'หุ้น', weight: 0.5 },
    { labelTh: 'ตราสารหนี้', weight: 0.45 },
    { labelTh: 'เงินสดและอื่น ๆ', weight: 0.05 },
  ]),
  'TH-MF-RESTRICTED-001': allocation('TH-MF-RESTRICTED-001', [
    { labelTh: 'ตราสารหนี้ไทย', weight: 0.97 },
    { labelTh: 'เงินสดและอื่น ๆ', weight: 0.03 },
  ]),
};

const MUTUAL_FUND_FIXTURES = {
  asOf: FIXTURE_AS_OF,
  datasetId: FIXTURE_DATASET_ID,
  masters: FUND_MASTERS,
  shareClasses: FUND_SHARE_CLASSES,
  profiles: FUND_PROFILES,
  navHistory: NAV_HISTORY,
  documents: FUND_DOCUMENTS,
  allocations: FUND_ALLOCATIONS,
};

const FIXTURE_IDS = Object.freeze({
  masters: Object.freeze(FUND_MASTERS.map((fund) => fund.masterFundId)),
  shareClasses: Object.freeze(FUND_SHARE_CLASSES.map((fund) => fund.fundId)),
});

module.exports = {
  FIXTURE_AS_OF,
  FIXTURE_DATASET_ID,
  FUND_MASTERS,
  FUND_SHARE_CLASSES,
  FUND_PROFILES,
  NAV_HISTORY,
  FUND_DOCUMENTS,
  FUND_ALLOCATIONS,
  FIXTURE_IDS,
  MUTUAL_FUND_FIXTURES,
};
