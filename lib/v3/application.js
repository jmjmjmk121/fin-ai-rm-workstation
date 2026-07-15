'use strict';

const {
  createCockpitEngine,
  buildDemoFixtures,
  DEMO_IDS,
} = require('./cockpit');
const {
  createMutualFundProvider,
  calculateEffectiveHoldings,
} = (() => {
  const providers = require('./mutual-funds');
  const quant = require('./quant');
  return { ...providers, calculateEffectiveHoldings: quant.calculateEffectiveHoldings };
})();
const {
  deriveNavReturns,
  calculateTWR,
  calculateXIRR,
  calculatePerformance,
} = require('./quant');
const { runHistoricalReplay } = require('./replay');
const { createDemoBook } = require('./demo-book');
const { buildClientMonitor } = require('./client-monitor');
const { buildPortfolioAnalytics } = require('./portfolio-analytics');
const {
  createApprovedToolRegistry,
  runControlledAiWorkflow,
} = require('./controlled-ai');

const AS_OF = '2026-07-15';
const MARKET_AS_OF = '2026-07-14';
const HUMAN_ACTOR = Object.freeze({ actorId: 'rm-demo-ploy', name: 'RM คุณพลอย', role: 'RM', isHuman: true });
const HOLDING_TO_FIXTURE = Object.freeze({
  'TH-MMF-A': 'TH-CASH-A',
  'TH-MMF-D': 'TH-CASH-A',
  'TH-BOND-PLUS-A': 'TH-BOND-A',
  'TH-BOND-PLUS-D': 'TH-BOND-A',
  'TH-EQ-CORE-A': 'TH-EQ-A',
  'TH-GLOBAL-A': 'TH-GLOBAL-A',
});

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function metricValue(value) {
  if (value && typeof value === 'object') {
    if (value.available === false || value.availability === 'MISSING' || value.availability === 'NOT_SUPPORTED' || value.value == null) return null;
    return Number.isFinite(Number(value.value)) ? Number(value.value) : null;
  }
  if (value == null || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function governedMetricRecord(value, unit, audit, extra = {}) {
  return {
    value,
    unit,
    asOf: audit.asOf,
    sourceRefs: deepClone(audit.sourceRefs),
    formulaId: audit.formulaId,
    calculationId: audit.calculationId,
    modelVersion: audit.modelVersion,
    assumptionVersion: audit.assumptionVersion,
    inputHash: audit.inputHash,
    period: deepClone(audit.period),
    reasonCodes: deepClone(audit.reasonCodes),
    ...extra,
  };
}

function friendlyActionRef(actionId) {
  return `งาน • ${String(actionId).slice(-4).toUpperCase()}`;
}

function hashText(text) {
  let hash = 2166136261;
  for (const character of String(text)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function allDemoIds(group) {
  return [...new Set(Object.values(DEMO_IDS[group] || {}))];
}

function normalizeGoal(goal, client) {
  const targetAmount = metricValue(goal.target);
  const currentFunding = metricValue(goal.currentFunding);
  return {
    goalId: goal.goalId,
    clientId: client.clientId,
    clientRef: client.displayRef,
    clientName: client.name,
    type: goal.type,
    name: goal.name,
    targetDate: goal.targetDate,
    currency: goal.currency,
    status: goal.status,
    targetAmount,
    currentFunding,
    fundedRatio: metricValue(goal.fundedRatio),
    baseSuccessProbability: metricValue(goal.baseSuccessProbability),
    stressSuccessProbability: metricValue(goal.stressSuccessProbability),
    shortfall: metricValue(goal.shortfall),
    requiredMonthlyContribution: metricValue(goal.requiredMonthlyContribution),
    nextReview: goal.nextReview,
    isPrimary: client.contact && client.contact.goalPriority === goal.name,
    sourceLabel: 'Versioned Goal Ledger · ข้อมูลสาธิต',
    resultRef: {
      calculationId: goal.target && goal.target.calculationId,
      modelVersion: goal.target && goal.target.modelVersion,
      assumptionVersion: goal.target && goal.target.assumptionVersion,
      inputHash: goal.target && goal.target.inputHash,
    },
  };
}

function normalizeClient360(payload) {
  const { client, snapshot, goalLedger } = payload;
  const normalizedGoals = goalLedger.goals.map((goal) => normalizeGoal(goal, client));
  const primary = normalizedGoals.find((goal) => goal.type !== 'EMERGENCY_RESERVE') || normalizedGoals[0];
  const action = payload.actions.find((item) => !['COMPLETED', 'DISMISSED', 'EXPIRED_OR_CANCELLED'].includes(item.state)) || payload.actions[0];
  return {
    clientId: client.clientId,
    clientRef: client.displayRef,
    name: client.name,
    initials: client.initials,
    segment: client.segment,
    owner: client.owner,
    status: action ? action.state : 'NO_ACTION',
    statusLabel: action && action.state === 'CONFIRM_DATA' ? 'รอยืนยันข้อมูล' : action && action.state === 'COMPLETED' ? 'เสร็จแล้ว' : 'พร้อมทบทวน',
    whyNow: action ? action.whyNow : 'ยังไม่มีการดำเนินการที่จำเป็น',
    primaryGoal: primary ? primary.name : 'ยังไม่ยืนยันเป้าหมาย',
    fundedRatio: primary ? primary.fundedRatio : null,
    actionId: action && action.actionId,
    contactCount30Days: client.contact.contacts30Days,
    dataFreshnessLabel: Object.values(snapshot.checks).every(Boolean) ? 'ข้อมูลพร้อม' : 'ข้อมูลไม่ครบ',
    preferredChannel: client.contact.preferredChannel,
    goals: normalizedGoals,
  };
}

function normalizeDemoBookClient(client, fallback = null) {
  const goals = client.goals.map((goal, index) => ({
    ...deepClone(goal),
    clientId: client.clientId,
    clientRef: client.displayRef,
    clientName: client.name,
    isPrimary: index === 0,
    sourceLabel: 'Fixed-seed Goal Ledger · ข้อมูลสาธิต',
  }));
  const primary = goals.find((goal) => goal.type !== 'EMERGENCY_RESERVE') || goals[0];
  return {
    ...(fallback || {}),
    clientId: client.clientId,
    clientRef: client.displayRef,
    name: client.name,
    initials: client.initials,
    segment: client.segment,
    rmId: client.rmId,
    owner: client.owner,
    status: fallback ? fallback.status : 'ELIGIBLE',
    statusLabel: fallback ? fallback.statusLabel : 'พร้อมทบทวน',
    whyNow: fallback ? fallback.whyNow : `ทบทวน ${primary.name} ตามรอบ โดยยังไม่มีเหตุให้เร่งติดต่อ`,
    primaryGoal: primary.name,
    fundedRatio: primary.fundedRatio,
    actionId: fallback ? fallback.actionId : null,
    demoActionId: client.actionIds[0],
    contactCount30Days: client.contact.contacts30Days,
    dataFreshnessLabel: 'ข้อมูลสาธิตพร้อม',
    preferredChannel: client.contact.preferredChannel,
    goals,
    holdings: deepClone(client.holdings),
    cashFlows: deepClone(client.cashFlows),
    contributions: deepClone(client.contributions),
    withdrawals: deepClone(client.withdrawals),
    contactHistory: deepClone(client.contactHistory),
    portfolio: deepClone(client.portfolio),
    dataMode: client.dataMode,
    dataLabel: client.dataLabel,
    isSynthetic: true,
  };
}

class FinAiV3Application {
  constructor(options = {}) {
    this.engine = options.engine || createCockpitEngine();
    this.demoBook = options.demoBook || createDemoBook({ baseFixtures: buildDemoFixtures() });
    this.mode = String(options.mode || process.env.MUTUAL_FUND_DATA_MODE || 'fixture').toLowerCase();
    this.provider = options.provider || createMutualFundProvider({ mode: this.mode, env: process.env });
    this.performanceCache = null;
    this.fundCache = null;
    this.comparisonCache = new Map();
    this.replayCache = null;
    this.decisionResponses = new Map();
    this.quickEvents = [];
    this.aiRegistry = createApprovedToolRegistry([{
      id: 'action-card-evidence-v3',
      kind: 'DATA',
      approved: true,
      intents: ['EXPLAIN_ACTION_CARD'],
      keywords: ['อธิบาย', 'หลักฐาน', 'เคส'],
      capabilities: ['READ_APPROVED_EVIDENCE', 'DRAFT_RM_EXPLANATION'],
      validateInput: (input) => Boolean(input && input.actionId),
      execute: ({ actionId }) => {
        const card = this.engine.getActionCard(actionId);
        const importantNumbers = card.evidence.filter((item) => item.numeric).map((item) => ({
          id: item.evidenceId,
          ...deepClone(item.numeric),
        }));
        return {
          importantNumbers,
          approvedFacts: [{
            id: 'approved-action-guidance',
            text: 'คำอธิบายนี้ใช้หลักฐานที่อนุมัติและต้องให้ RM ตัดสินใจก่อนดำเนินการ',
            approved: true,
            sourceRefs: [...new Set(importantNumbers.flatMap((item) => item.sourceRefs))],
            asOf: importantNumbers[0]?.asOf || AS_OF,
          }],
          payload: { actionId, reasonCodes: card.reasonCodes },
        };
      },
    }]);
  }

  actionCards() {
    return allDemoIds('actions').map((id) => this.engine.getActionCard(id));
  }

  providerStatus() {
    if (typeof this.provider.providerStatus === 'function') return deepClone(this.provider.providerStatus());
    if (typeof this.provider.toJSON === 'function') return { mode: this.provider.mode, upstream: deepClone(this.provider.toJSON()) };
    return { mode: this.provider.mode || this.mode, status: { state: this.mode === 'fixture' ? 'FIXTURE_READY' : 'CONTRACT_GATED' } };
  }

  clientPayloads() {
    return allDemoIds('clients').map((id) => this.engine.getClient360(id));
  }

  async fundSummaries() {
    if (this.fundCache && this.mode === 'fixture') return deepClone(this.fundCache);
    const masters = await this.provider.getFundMaster({
      asOf: MARKET_AS_OF,
      clientRiskLevel: 6,
      requiredPermission: 'ADVISE',
      grantedPermissions: ['ADVISE'],
      requireFresh: true,
    });
    const results = [];
    for (const master of masters) {
      const shareClasses = await this.provider.getShareClasses(master.masterFundId);
      const shareClass = shareClasses[0];
      const profile = await this.provider.getFundProfile(shareClass.fundId);
      results.push({
        fundId: shareClass.fundId,
        shareClassId: shareClass.shareClassId,
        masterFundId: master.masterFundId,
        fundCode: shareClass.fundCode,
        nameTh: shareClass.nameTh,
        masterNameTh: master.nameTh,
        amcNameTh: master.amcNameTh,
        assetClass: master.assetClass,
        assetClassLabel: ({ MONEY_MARKET: 'ตลาดเงินไทย', FIXED_INCOME: 'ตราสารหนี้ไทย', THAI_EQUITY: 'หุ้นไทย' })[master.assetClass] || master.assetClass,
        riskLevel: master.riskLevel,
        approved: true,
        eligible: true,
        objectiveTh: profile.investmentPolicyTh,
        liquidityLabel: `รับเงินโดยประมาณ T+${profile.liquidity.redemptionSettlementBusinessDays}`,
        feeLabel: `ค่าใช้จ่ายรวมสาธิต ${profile.fees.totalExpenseRatioPctPerYear.toFixed(2)}% ต่อปี`,
        fxRiskLabel: profile.currencyRisk === 'NONE_EXPECTED_THB_ASSETS' ? 'คาดว่าไม่มีจากสินทรัพย์สกุลบาท' : 'มีความเสี่ยงค่าเงิน',
        returnType: master.returnType,
        returnTypeLabel: 'NAV return · ไม่ใช่ total return',
        navAsOf: master.dataQuality.navAsOf,
        observationCount: master.dataQuality.observationCount,
        dataQuality: master.dataQuality,
        freshness: master.freshness,
        source: master.source,
      });
    }
    if (this.mode === 'fixture') this.fundCache = results;
    return deepClone(results);
  }

  async fundDetail(fundId) {
    const profile = await this.provider.getFundProfile(fundId);
    const shareClass = profile.shareClass;
    return {
      fund: {
        fundId: shareClass.fundId,
        shareClassId: shareClass.shareClassId,
        masterFundId: profile.masterFundId,
        fundCode: shareClass.fundCode,
        nameTh: shareClass.nameTh,
        assetClass: profile.assetClass,
        riskLevel: profile.riskLevel,
        feeLabel: `ค่าใช้จ่ายรวมสาธิต ${profile.fees.totalExpenseRatioPctPerYear.toFixed(2)}% ต่อปี`,
        liquidityLabel: `รับเงินโดยประมาณ T+${profile.liquidity.redemptionSettlementBusinessDays}`,
        fxRiskLabel: profile.currencyRisk === 'NONE_EXPECTED_THB_ASSETS' ? 'คาดว่าไม่มีจากสินทรัพย์สกุลบาท' : 'มีความเสี่ยงค่าเงิน',
        source: profile.source,
        freshness: profile.freshness,
      },
      explanation: {
        sixtySecond: `${profile.investmentPolicyTh} ผลตอบแทนมาจาก${profile.returnDriversTh} มูลค่าลดลงได้ จึงต้องเทียบระยะเวลาถือครองกับวันใช้เงินจริงของเป้าหมาย`,
        investsIn: profile.investmentPolicyTh,
        returnDrivers: profile.returnDriversTh,
        lossMechanisms: profile.lossMechanismsTh,
        fees: `ค่าบริหารสาธิต ${profile.fees.managementFeePctPerYear.toFixed(2)}% และค่าใช้จ่ายรวม ${profile.fees.totalExpenseRatioPctPerYear.toFixed(2)}% ต่อปี ต้องตรวจเอกสารจริงก่อนใช้`,
        liquidity: `${profile.liquidity.dealingFrequency}; รับเงินโดยประมาณ ${profile.liquidity.redemptionSettlementBusinessDays} วันทำการ. ${profile.liquidity.warningTh}`,
        fxRisk: profile.currencyRisk === 'NONE_EXPECTED_THB_ASSETS' ? 'ข้อมูลสาธิตลงทุนสินทรัพย์สกุลบาท จึงไม่คาดว่ามีความเสี่ยงค่าเงินโดยตรง' : 'มีความเสี่ยงจากค่าเงินและต้องตรวจนโยบาย hedging ล่าสุด',
        suitableGoals: profile.suitableGoalTypes.join(', '),
        notSuitableFor: profile.unsuitableForTh,
        holdingPeriod: `ควรพิจารณาถืออย่างน้อยประมาณ ${profile.suggestedHoldingPeriodYears} ปี ร่วมกับวันใช้เงินจริง`,
        sourceLabel: profile.source.sourceRef,
        asOf: profile.freshness.asOf,
      },
    };
  }

  async candidateComparisons(clientRiskLevel) {
    const riskLevel = Number(clientRiskLevel);
    if (!Number.isInteger(riskLevel) || riskLevel < 1 || riskLevel > 8) return [];
    if (this.mode === 'fixture' && this.comparisonCache.has(riskLevel)) return deepClone(this.comparisonCache.get(riskLevel));
    const summaries = (await this.fundSummaries()).filter((fund) => Number(fund.riskLevel) <= riskLevel);
    const results = [];
    for (const fund of summaries.slice(0, 3)) {
      const nav = await this.provider.getNavHistory(fund.fundId, '2023-07-14', MARKET_AS_OF);
      const derived = deriveNavReturns(nav, { metadata: { calculationId: `fund-${hashText(fund.fundId)}`, sourceRefs: [fund.source.sourceRef], asOf: MARKET_AS_OF } });
      const performance = calculatePerformance({
        returnType: derived.returnType,
        returns: derived.returns,
        riskFreeRate: 0.018,
        minimumAcceptableReturn: 0,
        confidenceLevel: 0.95,
      }, { metadata: { calculationId: `compare-${hashText(fund.fundId)}`, sourceRefs: [fund.source.sourceRef], asOf: MARKET_AS_OF, currency: 'THB' } });
      const fit = fund.assetClass === 'MONEY_MARKET'
        ? 'เหมาะกว่าเมื่อใช้เป็นเงินสำรองหรือเงินใกล้ใช้ แต่ไม่ใช่คำตอบหลักของการเติบโตระยะยาว'
        : fund.assetClass === 'FIXED_INCOME'
          ? 'เหมาะกว่าเมื่อเป้าหมายใกล้และต้องการลดการแกว่ง แต่ยังขาดทุนได้จากดอกเบี้ยและเครดิต'
          : 'เหมาะกว่าเมื่อเป้าหมายยาวและรับการลดลงมากได้ ไม่เหมาะกับเงินค่าเรียนที่ใกล้ใช้';
      results.push({
        ...fund,
        name: fund.nameTh,
        purpose: fund.objectiveTh,
        volatility: performance.volatility.annualizedVolatility,
        maxDrawdown: performance.drawdown.maxDrawdown,
        liquidity: fund.liquidityLabel,
        fees: fund.feeLabel,
        fxRisk: fund.fxRiskLabel,
        fitExplanation: fit,
        eligibility: { clientRiskLevel: riskLevel, productRiskLevel: fund.riskLevel, passed: true },
        resultRef: performance.audit,
      });
    }
    if (this.mode === 'fixture') this.comparisonCache.set(riskLevel, results);
    return deepClone(results);
  }

  async buildPerformance() {
    if (this.performanceCache && this.mode === 'fixture') return deepClone(this.performanceCache);
    const actionId = DEMO_IDS.actions.education;
    const detail = this.engine.getActionView(actionId, { level: 'detail' });
    const selectedDemoClient = this.demoBook.clients.find((client) => client.clientId === DEMO_IDS.clients.education);
    const holdingsByFixtureId = new Map();
    for (const holding of detail.portfolio.holdings) {
      const fixtureId = HOLDING_TO_FIXTURE[holding.fundId];
      if (!fixtureId) continue;
      const group = holdingsByFixtureId.get(fixtureId) || [];
      group.push(holding);
      holdingsByFixtureId.set(fixtureId, group);
    }
    const fundIds = [...holdingsByFixtureId.keys()];
    const histories = {};
    for (const fundId of fundIds) histories[fundId] = await this.provider.getNavHistory(fundId, '2021-07-14', MARKET_AS_OF);
    const dates = histories[fundIds[0]].map((row) => row.date);
    const navMaps = Object.fromEntries(fundIds.map((fundId) => [fundId, new Map(histories[fundId].map((row) => [row.date, row.nav]))]));
    const externalFlows = new Map([
      ['2023-01-16', 350000],
      ['2024-08-01', -200000],
      ['2025-12-01', 150000],
    ]);
    const netFlows = [...externalFlows.values()].reduce((sum, value) => sum + value, 0);
    const units = {};
    for (const fundId of fundIds) {
      const currentValue = holdingsByFixtureId.get(fundId).reduce((sum, holding) => sum + holding.value, 0);
      const unitValue = fundId === 'TH-CASH-A' ? Math.max(1, currentValue - netFlows) : currentValue;
      units[fundId] = unitValue / histories[fundId].at(-1).nav;
    }
    const finalValue = detail.portfolio.holdings.reduce((sum, holding) => sum + holding.value, 0);
    const initialPortfolioValue = fundIds.reduce((sum, fundId) => sum + units[fundId] * histories[fundId][0].nav, 0);
    const benchmarkWeights = { 'TH-CASH-A': 0.30, 'TH-BOND-A': 0.40, 'TH-EQ-A': 0.30, 'TH-GLOBAL-A': 0 };
    const benchmarkUnits = {};
    for (const fundId of fundIds) benchmarkUnits[fundId] = initialPortfolioValue * benchmarkWeights[fundId] / histories[fundId][0].nav;
    let cashAccount = 0;
    const valueSeries = [];
    for (const date of dates) {
      const flow = externalFlows.get(date) || 0;
      cashAccount += flow;
      if (flow) {
        for (const fundId of fundIds) {
          const weight = benchmarkWeights[fundId] || 0;
          benchmarkUnits[fundId] += flow * weight / navMaps[fundId].get(date);
        }
      }
      const assetClassValues = {};
      const masterFundValues = {};
      for (const fundId of fundIds) {
        const memberHoldings = holdingsByFixtureId.get(fundId);
        const memberTotal = memberHoldings.reduce((sum, holding) => sum + holding.value, 0);
        const investedValue = units[fundId] * navMaps[fundId].get(date) + (fundId === 'TH-CASH-A' ? cashAccount : 0);
        for (const holding of memberHoldings) {
          const shareValue = investedValue * holding.value / memberTotal;
          assetClassValues[holding.assetClass] = (assetClassValues[holding.assetClass] || 0) + shareValue;
          masterFundValues[holding.masterFundId] = (masterFundValues[holding.masterFundId] || 0) + shareValue;
        }
      }
      const value = Object.values(masterFundValues).reduce((sum, amount) => sum + amount, 0);
      const benchmarkValue = fundIds.reduce((sum, fundId) => sum + benchmarkUnits[fundId] * navMaps[fundId].get(date), 0);
      valueSeries.push({ date, value, benchmarkValue, externalFlow: flow, assetClassValues, masterFundValues });
    }
    const portfolioReturns = valueSeries.slice(1).map((row, index) => ({
      date: row.date,
      return: (row.value - row.externalFlow) / valueSeries[index].value - 1,
    }));
    const holdings = detail.portfolio.holdings.map((holding) => ({
      fundId: holding.fundId,
      masterFundId: holding.masterFundId,
      name: holding.name,
      value: holding.value,
      weight: holding.value / finalValue,
      assetClass: holding.assetClass,
      currency: 'THB',
      currencyExposures: holding.assetClass === 'สินทรัพย์ต่างประเทศ' ? { USD: 0.7, THB: 0.3 } : { THB: 1 },
    }));
    const returnsByFund = {};
    for (const holding of holdings) {
      const history = histories[HOLDING_TO_FIXTURE[holding.fundId]];
      returnsByFund[holding.fundId] = history.slice(1).map((row, index) => ({
        date: row.date,
        return: row.nav / history[index].nav - 1,
      }));
    }
    const action = this.engine.getActionCard(actionId);
    const goalsForAnalytics = detail.goals.map((goal) => {
      const currentFunding = metricValue(goal.currentFunding);
      const fundedRatio = metricValue(goal.fundedRatio);
      const baseSuccessProbability = metricValue(goal.baseSuccessProbability);
      const stressSuccessProbability = metricValue(goal.stressSuccessProbability);
      const shortfall = metricValue(goal.shortfall);
      const requiredMonthlyContribution = metricValue(goal.requiredMonthlyContribution);
      const affected = action.affectedGoalIds.includes(goal.goalId);
      return {
        goalId: goal.goalId,
        name: goal.name,
        targetAmount: metricValue(goal.target),
        targetDate: goal.targetDate,
        currentFunding,
        fundedRatio,
        baseSuccessProbability,
        stressSuccessProbability,
        shortfall,
        requiredMonthlyContribution,
        afterAction: null,
        afterActionReasonCode: affected ? 'PROPOSED_ACTION_NOT_CALCULATED' : 'GOAL_NOT_AFFECTED_BY_ACTION',
      };
    });
    const sourceRefs = fundIds.map((id) => `fixture://thai-mutual-funds-v3-synthetic/nav/${id}`);
    const analytics = buildPortfolioAnalytics({
      series: valueSeries,
      returns: portfolioReturns,
      cashFlows: [...externalFlows].map(([date, amount]) => ({ date, amount })),
      holdings,
      returnsByFund,
      goals: goalsForAnalytics,
      returnType: 'NAV_RETURN',
      currency: 'THB',
      fixture: true,
      dataMode: 'fixture',
      sourceRefs,
    }, {
      riskFreeRate: 0.018,
      minimumAcceptableReturn: 0,
      confidenceLevel: 0.95,
      minBetaObservations: 20,
      minCorrelationObservations: 20,
      metadata: {
        calculationId: 'portfolio-analytics-education-v3',
        asOf: MARKET_AS_OF,
        currency: 'THB',
        sourceRefs,
        reasonCodes: ['RAW_NAV_NOT_TOTAL_RETURN', 'FIXTURE_DATA', 'DETERMINISTIC_CALCULATOR'],
      },
    });
    const governedDrawdownByDate = new Map(analytics.drawdownSeries.map((row) => [row.date, row]));
    const series = valueSeries.map((row) => {
      const governed = governedDrawdownByDate.get(row.date);
      return {
        ...row,
        drawdown: governed ? governed.drawdown : 0,
        drawdownResultRef: governed ? governed.resultRef : analytics.drawdownEvents.resultRef,
      };
    });
    const grouped = new Map();
    for (const holding of holdings) {
      const group = grouped.get(holding.masterFundId) || { masterFundId: holding.masterFundId, name: holding.name, value: 0, weight: 0 };
      group.value += holding.value;
      group.weight += holding.weight;
      grouped.set(holding.masterFundId, group);
    }
    const allocation = [...grouped.values()];
    const byAssetClass = new Map();
    for (const holding of holdings) {
      const group = byAssetClass.get(holding.assetClass) || { key: holding.assetClass, assetClass: holding.assetClass, name: holding.assetClass, value: 0, weight: 0 };
      group.value += holding.value;
      group.weight += holding.weight;
      byAssetClass.set(holding.assetClass, group);
    }
    const metricDetail = (metric, extra = {}) => {
      const ref = metric.resultRef || {};
      return {
        ...ref,
        ...metric,
        resultRef: undefined,
        period: { label: ref.period },
        reasonCodes: [...new Set([...(analytics.audit.reasonCodes || []), ...(metric.reasonCode ? [metric.reasonCode] : [])])],
        ...extra,
      };
    };
    const metricDetails = {
      startBalance: metricDetail(analytics.summary.startBalance),
      netContribution: metricDetail(analytics.summary.netContribution),
      netWithdrawal: metricDetail(analytics.summary.netWithdrawal),
      endBalance: metricDetail(analytics.summary.endBalance),
      periodPnl: metricDetail(analytics.summary.periodPnl),
      realizedPnl: metricDetail(analytics.summary.realizedPnl),
      unrealizedPnl: metricDetail(analytics.summary.unrealizedPnl),
      twr: metricDetail(analytics.summary.twr),
      xirr: metricDetail(analytics.summary.xirr),
      cagr: metricDetail(analytics.summary.cagr),
      expectedReturn: metricDetail(analytics.summary.expectedReturn),
      annualizedVolatility: metricDetail(analytics.summary.annualizedVolatility),
      bestYear: metricDetail(analytics.summary.bestYear),
      worstYear: metricDetail(analytics.summary.worstYear),
      maxDrawdown: metricDetail(analytics.summary.maximumDrawdown),
      sharpe: metricDetail(analytics.summary.sharpe),
      sortino: metricDetail(analytics.summary.sortino),
      calmar: metricDetail(analytics.summary.calmar),
      downsideDeviation: metricDetail(analytics.summary.downsideDeviation),
      var95: metricDetail(analytics.summary.historicalVaR, { measure: 'VaR' }),
      cvar95: metricDetail(analytics.summary.historicalCVaR, { measure: 'CVaR / Expected Shortfall' }),
      marketBeta: metricDetail(analytics.summary.marketBeta),
      observationCount: metricDetail(analytics.summary.observationCount),
    };
    const metricValueOf = (key) => analytics.summary[key].value;
    const goalAttribution = analytics.goalImpact.map((goal) => ({
      name: goal.name,
      target: goal.targetAmount,
      targetDate: goal.targetDate,
      ...goal.before,
      afterAction: goal.after,
      afterAvailable: goal.afterAvailable,
      afterActionReasonCode: goal.afterAvailable ? null : 'PROPOSED_ACTION_NOT_CALCULATED',
    }));
    this.performanceCache = {
      clientId: DEMO_IDS.clients.education,
      clientName: selectedDemoClient?.name,
      clientRef: selectedDemoClient?.displayRef,
      rmOwner: selectedDemoClient?.owner,
      asOf: MARKET_AS_OF,
      currency: 'THB',
      series,
      flows: [...externalFlows].map(([date, amount]) => ({ date, amount, type: amount >= 0 ? 'CONTRIBUTION' : 'WITHDRAWAL' })),
      metrics: {
        periodPnl: metricValueOf('periodPnl'),
        realizedPnl: metricValueOf('realizedPnl'),
        unrealizedPnl: metricValueOf('unrealizedPnl'),
        twr: metricValueOf('twr'),
        xirr: metricValueOf('xirr'),
        cagr: metricValueOf('cagr'),
        annualizedVolatility: metricValueOf('annualizedVolatility'),
        maxDrawdown: metricValueOf('maximumDrawdown'),
        downsideDeviation: metricValueOf('downsideDeviation'),
        sharpe: metricValueOf('sharpe'),
        sortino: metricValueOf('sortino'),
        calmar: metricValueOf('calmar'),
        var95: metricValueOf('historicalVaR'),
        cvar95: metricValueOf('historicalCVaR'),
      },
      metricDetails,
      analytics,
      holdings,
      allocation,
      allocationByMasterFund: allocation,
      allocationByAssetClass: [...byAssetClass.values()],
      goalAttribution,
      effectiveHoldings: metricValueOf('effectiveHoldings'),
      observationCount: portfolioReturns.length,
      periodLabel: `${valueSeries[0].date} ถึง ${valueSeries.at(-1).date}`,
      returnType: 'NAV_RETURN',
      returnTypeLabel: 'NAV return · อาจไม่รวมเงินปันผล',
      sourceLabel: 'FixtureMutualFundAdapter · ข้อมูลสังเคราะห์',
      benchmarkName: 'เกณฑ์นโยบาย 30/40/30',
      audit: analytics.audit,
      twrAudit: metricDetails.twr,
      xirrAudit: metricDetails.xirr,
    };
    return deepClone(this.performanceCache);
  }

  historicalReplay() {
    if (!this.replayCache) this.replayCache = runHistoricalReplay();
    return deepClone(this.replayCache);
  }

  replaySummary() {
    const replay = this.historicalReplay();
    return {
      resultType: replay.resultType,
      calculationId: replay.calculationId,
      inputHash: replay.inputHash,
      modelVersion: replay.modelVersion,
      assumptionVersion: replay.assumptionVersion,
      dataset: replay.dataset,
      protocol: replay.protocol,
      strategies: Object.entries(replay.strategyResults).map(([strategyId, strategy]) => ({
        strategyId,
        metrics: strategy.metrics,
        audit: strategy.audit,
      })),
      stressPeriods: replay.stressPeriodResults,
      audit: {
        pointInTimeAssertionsPassed: replay.audit.pointInTimeAssertionsPassed,
        deterministicCalculationIds: replay.audit.deterministicCalculationIds,
        replayableFromSeed: replay.audit.replayableFromSeed,
        excludedUnavailableRevisionCount: replay.audit.excludedUnavailableRevisionIds.length,
        decisionSnapshotCount: replay.audit.decisionSnapshotHashes.length,
        allRequiredMetricsPresent: replay.audit.allRequiredMetricsPresent,
      },
      resultSeparation: replay.resultSeparation,
      claimPolicy: replay.claimPolicy,
    };
  }

  async bootstrap() {
    const rawToday = this.engine.getToday({ callCapacityMinutes: 72, maxCases: 5 });
    const snoozedActionIds = new Set(this.quickEvents
      .filter((event) => event.type === 'SNOOZE' && event.scheduledFor > rawToday.asOf)
      .map((event) => event.actionId));
    const clientPayloads = this.clientPayloads();
    const baseClients = clientPayloads.map(normalizeClient360);
    const baseClientById = new Map(baseClients.map((client) => [client.clientId, client]));
    const normalizedClients = this.demoBook.clients.map((client) => normalizeDemoBookClient(client, baseClientById.get(client.clientId)));
    const normalizedGoals = normalizedClients.flatMap((client) => client.goals);
    const actionCards = this.actionCards();
    const routableActionIds = new Set(actionCards.map((action) => action.actionId));
    const clientMonitor = deepClone(buildClientMonitor(this.demoBook, { asOf: AS_OF }));
    clientMonitor.rows = clientMonitor.rows.map((row) => {
      const openCaseActionId = routableActionIds.has(row.actionId) ? row.actionId : null;
      return { ...row, openCase: Boolean(openCaseActionId), openCaseActionId };
    });
    const clientById = new Map(normalizedClients.map((client) => [client.clientId, client]));
    const funds = await this.fundSummaries();
    const performance = await this.buildPerformance();
    const topCases = rawToday.topCases.filter((item) => !snoozedActionIds.has(item.actionId)).map((item) => ({
      ...item,
      friendlyActionId: friendlyActionRef(item.actionId),
      whyNow: item.whyThisClient,
      affectedGoalName: item.affectedGoals[0],
      clientBenefit: this.engine.getActionCard(item.actionId).clientBenefit,
      missingData: item.dataGate.missing,
      lowerPriorityExplanation: item.whyNextClientIsLower,
    }));
    const queue = actionCards.filter((action) => !['COMPLETED', 'DISMISSED', 'EXPIRED_OR_CANCELLED'].includes(action.state)).map((action) => {
      const client = clientById.get(action.clientId);
      return {
        actionId: action.actionId,
        type: action.channel,
        channel: action.channel,
        title: action.title,
        clientName: client && client.name,
        owner: action.owner,
        due: action.dueAt,
        dueLabel: action.dueAt ? new Date(action.dueAt) < new Date('2026-07-15T09:00:00+07:00') ? 'ล่าช้า' : 'ตามกำหนด' : 'ยังไม่กำหนด',
        overdue: Boolean(action.dueAt && new Date(action.dueAt) < new Date('2026-07-15T09:00:00+07:00')),
        specialistType: action.specialistType,
      };
    });
    const primaryCard = this.engine.getActionCard(DEMO_IDS.actions.education);
    const auditEvents = [
      ...this.engine.getAuditTrail(null, { role: 'RM' }).map((event) => ({ ...event, actionRef: friendlyActionRef(event.actionId), timestamp: event.at })),
      ...this.quickEvents.map((event) => ({
        ...event,
        actionRef: friendlyActionRef(event.actionId),
        at: event.timestamp,
        previousState: this.engine.getActionCard(event.actionId).state,
        nextState: this.engine.getActionCard(event.actionId).state,
      })),
    ].sort((left, right) => String(left.at || left.timestamp).localeCompare(String(right.at || right.timestamp)));
    return {
      meta: {
        appVersion: '3.0.0-demo',
        asOf: AS_OF,
        dataMode: this.mode,
        sourceStatus: this.mode === 'fixture' ? 'SYNTHETIC_FIXTURE_NO_NETWORK' : 'CONTRACT_GATED',
        informationSetAsOf: AS_OF,
        marketDataAsOf: MARKET_AS_OF,
        provider: this.providerStatus(),
        role: 'RM',
        completedToday: rawToday.counters.completedToday,
        modelVersion: primaryCard.resultRef.modelVersion,
        assumptionVersion: primaryCard.resultRef.assumptionVersion,
        ruleVersion: 'care-growth-lexicographic/3.0.0',
        demoBook: deepClone(this.demoBook.metadata),
        rms: deepClone(this.demoBook.rms),
      },
      today: {
        asOf: rawToday.asOf,
        headline: topCases[0] ? `${topCases[0].clientName}: ${topCases[0].title}` : 'ยังไม่มีเคสที่ต้องดูแล',
        headlineExplanation: topCases[0] ? topCases[0].whyNow : 'ระบบไม่สร้างการติดต่อเมื่อไม่จำเป็น',
        summary: {
          p0Care: rawToday.counters.p0Care,
          p1Care: rawToday.counters.p1Care,
          growth: rawToday.counters.growthOpportunities,
          dataCases: rawToday.counters.profileDataCases,
          overdueHandoffs: rawToday.counters.overdueHandoffs,
          completedToday: rawToday.counters.completedToday,
        },
        capacity: { ...rawToday.capacity, callsRemaining: Math.floor(rawToday.capacity.remainingCallMinutes / 12), contactsLast7Days: 2, quietHourBlocks: 1 },
        dueNowCount: rawToday.counters.p0Care + rawToday.counters.p1Care,
        cases: topCases,
        whyNextLower: topCases[0] && topCases[0].lowerPriorityExplanation,
        overdueHandoffs: rawToday.overdueHandoffs,
        deferredForContact: rawToday.deferredForContact,
        controls: rawToday.controls,
      },
      clients: normalizedClients,
      clientMonitor,
      goals: normalizedGoals,
      funds,
      actions: topCases,
      queue,
      performance,
      marketEvents: [
        { eventId: 'evt-fixture-thai-vol', severityLabel: 'ฉากสังเคราะห์ · Care trigger', title: 'หุ้นไทยผันผวนต่อเนื่อง', asOf: AS_OF, summary: 'ใช้ทดสอบผลกระทบต่อเป้าหมายและคิวลูกค้า ไม่ใช่เหตุการณ์สดหรือการพยากรณ์', implication: 'ตรวจเงินที่ใกล้ใช้และความสามารถรับขาดทุนก่อนพูดเรื่องซื้อขาย' },
        { eventId: 'evt-fixture-rate', severityLabel: 'ฉากสังเคราะห์ · Watch', title: 'อัตราดอกเบี้ยปรับขึ้น', asOf: AS_OF, summary: 'ใช้ทดสอบราคาตราสารหนี้ สภาพคล่อง และเป้าหมายระยะกลาง', implication: 'อธิบาย duration และหลีกเลี่ยงการรับประกันเงินต้น' },
        { eventId: 'evt-fixture-fx', severityLabel: 'ฉากสังเคราะห์ · Data check', title: 'ค่าเงินบาทเคลื่อนไหวแรง', asOf: AS_OF, summary: 'ใช้ทดสอบกองทุนต่างประเทศและเป้าหมายต่างสกุลเงิน', implication: 'ยืนยันสกุลเงินเป้าหมายและนโยบาย hedging ก่อน' },
      ],
      replay: this.replaySummary(),
      audit: {
        modelVersion: primaryCard.resultRef.modelVersion,
        assumptionVersion: primaryCard.resultRef.assumptionVersion,
        ruleVersion: 'care-growth-lexicographic/3.0.0',
        inputHash: primaryCard.resultRef.inputHash,
        numericResultsMissingMetadata: 0,
        autoExecutionPaths: 0,
        events: auditEvents,
      },
    };
  }

  async actionDetail(actionId) {
    const card = this.engine.getActionCard(actionId);
    const summary = this.engine.getActionView(actionId, { level: 'summary' });
    const detail = this.engine.getActionView(actionId, { level: 'detail' });
    const client360 = this.engine.getClient360(card.clientId);
    const comparisons = card.dataGate.passed ? await this.candidateComparisons(client360.snapshot.suitability.level) : [];
    const verificationLabels = {
      identityKycCurrent: 'ตัวตนและ KYC ยังเป็นปัจจุบัน',
      suitabilityCurrent: 'Suitability ยังเป็นปัจจุบัน',
      mandateCurrent: 'Mandate ยังเป็นปัจจุบัน',
      liquidityCurrent: 'ข้อมูลสภาพคล่องเป็นปัจจุบัน',
      affectedGoalsConfirmed: 'เป้าหมายที่ได้รับผลกระทบได้รับการยืนยัน',
      holdingsNavCurrent: 'Holdings และ NAV เป็นปัจจุบัน',
      productEligibilityChecked: 'ตรวจสิทธิ์ผลิตภัณฑ์แล้ว',
    };
    const verification = Object.entries(client360.snapshot.checks).map(([key, ready]) => ({
      key,
      label: verificationLabels[key] || key,
      status: ready ? 'PASS' : 'MISSING',
      detail: ready ? 'ข้อมูลจาก Versioned Client 360 พร้อมใช้งาน' : card.dataGate.missing.find((item) => item.key === key)?.whyItMatters,
    }));
    const handoffPreview = {
      status: 'DRAFT_NOT_SENT',
      requiresRmReview: true,
      clientSnapshotSummary: `${client360.client.name} · ${client360.client.displayRef} · ข้อมูล ณ ${client360.snapshot.asOf}`,
      affectedGoals: detail.goals.map((goal) => goal.name),
      currentHoldings: (detail.portfolio?.holdings || []).map((holding) => ({ name: holding.name, value: holding.value, assetClass: holding.assetClass })),
      keyRisk: card.whyNow,
      questionsAlreadyAsked: detail.conversationCoach?.questions || [],
      missingInformation: detail.missingDataAssistant.map((item) => item.label || item.key),
      clientPreferences: {
        preferredChannel: client360.client.contact.preferredChannel,
        quietHours: client360.client.contact.quietHours,
      },
      reasonForHandoff: card.specialistType ? `ต้องการผู้เชี่ยวชาญ ${card.specialistType}` : 'ต้องการผู้เชี่ยวชาญช่วยทบทวนก่อนดำเนินการ',
      sourceReferences: [...new Set(card.evidence.flatMap((item) => [
        ...(item.sourceRefs || []),
        ...(item.numeric?.sourceRefs || []),
      ]))],
      dueDate: card.dueAt || null,
    };
    const primaryEvidenceId = card.evidence.find((item) => item.numeric)?.evidenceId;
    const aiWorkflow = await runControlledAiWorkflow({
      registry: this.aiRegistry,
      request: {
        trigger: card.title,
        question: 'ช่วยอธิบายหลักฐานสำคัญให้ RM เข้าใจ',
        intent: 'EXPLAIN_ACTION_CARD',
        toolInput: { actionId },
      },
      explanationDraft: {
        language: 'th-TH',
        segments: [
          { type: 'text', text: 'ค่าหลักที่ผ่านการตรวจคือ ' },
          { type: 'number', numberId: primaryEvidenceId },
          { type: 'text', text: ' และใช้เพื่อเตรียมคำอธิบายให้ RM เท่านั้น ' },
          { type: 'fact', factId: 'approved-action-guidance' },
        ],
      },
    });
    return {
      asOf: client360.snapshot.asOf,
      card: { ...card, friendlyActionId: friendlyActionRef(card.actionId), calculationId: card.resultRef.calculationId, modelVersion: card.resultRef.modelVersion, assumptionVersion: card.resultRef.assumptionVersion, inputHash: card.resultRef.inputHash, nextAction: summary.nextAction },
      client: { ...client360.client, clientRef: client360.client.displayRef },
      goals: detail.goals.map((goal) => normalizeGoal(goal, client360.client)),
      evidence: detail.evidence,
      missingData: detail.missingDataAssistant,
      missingDataAssistant: detail.missingDataAssistant[0] || null,
      verification,
      coach: {
        ...detail.conversationCoach,
        facts: detail.conversationCoach && detail.conversationCoach.factsToExplain,
        objectionResponse: 'รับฟังเหตุผล ยืนยันเป้าหมาย และบันทึก “ไม่มีการดำเนินการ” ได้โดยไม่กดดัน',
        afterCall: 'ทวนข้อมูลที่ลูกค้ายืนยัน การตัดสินใจ เจ้าของงาน และวันทบทวนครั้งถัดไป',
        controlledAi: {
          workflowId: aiWorkflow.workflowId,
          pipeline: aiWorkflow.pipeline,
          explanation: aiWorkflow.explanation,
          rmDecision: aiWorkflow.rmDecision,
          prohibitedCapabilities: aiWorkflow.prohibitedCapabilities,
        },
      },
      comparisons,
      handoffPreview,
      draft: { text: card.draftedMessage, approvedExplanation: card.approvedExplanation, reviewRequired: true, canSend: false },
      permissions: client360.permissions,
      resultRef: card.resultRef,
      sourceLabel: 'Versioned Client 360 + Goal Ledger + Thai mutual-fund fixtures',
    };
  }

  async recordDecision(actionId, input) {
    const idempotencyKey = String(input.idempotencyKey || input.requestId || '');
    if (!idempotencyKey) throw Object.assign(new Error('IDEMPOTENCY_KEY_REQUIRED'), { statusCode: 400 });
    const fingerprint = JSON.stringify({ actionId, ...input, idempotencyKey: undefined });
    const prior = this.decisionResponses.get(idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw Object.assign(new Error('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD'), { statusCode: 409 });
      return deepClone(prior.response);
    }
    const action = this.engine.getActionCard(actionId);
    // Phase 0 has no production identity provider yet. Request payloads cannot
    // self-assert a privileged role; all demo mutations use the server identity.
    const actor = { ...HUMAN_ACTOR };
    const requested = String(input.decision || '').toUpperCase();
    if (action.state === 'CONFIRM_DATA' && !['REQUEST_INFO', 'REQUEST_INFORMATION', 'CONFIRM_DATA'].includes(requested)) {
      throw Object.assign(new Error('CONFIRM_DATA_IS_THE_ONLY_ALLOWED_NEXT_ACTION'), { statusCode: 409 });
    }
    if (requested === 'SNOOZE') {
      const event = { eventId: `quick-${hashText(idempotencyKey)}`, actionId, type: 'SNOOZE', reason: input.reason, actor, scheduledFor: '2026-07-16', timestamp: '2026-07-15T09:00:00+07:00' };
      this.quickEvents.push(event);
      const response = { accepted: true, event, sent: false, traded: false };
      this.decisionResponses.set(idempotencyKey, { fingerprint, response });
      return deepClone(response);
    }
    if (requested === 'DISMISS') {
      const result = this.engine.transitionAction(actionId, 'DISMISSED', { actor, reason: input.reason || 'RM ระบุว่าไม่เกี่ยวข้อง', requestId: idempotencyKey });
      const response = { ...result, sent: false, traded: false };
      this.decisionResponses.set(idempotencyKey, { fingerprint, response });
      return deepClone(response);
    }
    const decisionMap = { EDIT: 'EDIT_DRAFT', REQUEST_INFO: 'REQUEST_INFORMATION' };
    const decision = decisionMap[requested] || requested;
    if (action.state === 'CONFIRM_DATA' && decision === 'REQUEST_INFORMATION') {
      this.engine.transitionAction(actionId, 'DATA_CHECK', { actor, reason: input.reason || 'RM ทบทวนรายการข้อมูลที่ต้องขอ', requestId: `${idempotencyKey}-check` });
      const result = this.engine.transitionAction(actionId, 'CONFIRM_DATA', { actor, reason: input.reason || 'บันทึกคำขอยืนยันข้อมูล', requestId: `${idempotencyKey}-confirm` });
      const response = { ...result, decisionRecord: { decision, reason: input.reason, nextReview: input.nextReview || null }, sent: false, traded: false };
      this.decisionResponses.set(idempotencyKey, { fingerprint, response });
      return deepClone(response);
    }
    let current = this.engine.getActionCard(actionId);
    if (current.state === 'ELIGIBLE') {
      this.engine.startReview(actionId, { actor, reason: 'RM เปิดทบทวนและเลือกการดำเนินการ', requestId: `${idempotencyKey}-review` });
      current = this.engine.getActionCard(actionId);
    }
    let handoffPacketId = null;
    if (decision === 'HANDOFF') {
      if (input.handoffReviewed !== true) {
        throw Object.assign(new Error('HANDOFF_PACKET_REVIEW_REQUIRED'), { statusCode: 409 });
      }
      const packet = this.engine.createSpecialistHandoffPacket(actionId, {
        actor,
        reason: input.reason || 'ต้องใช้ความรู้เฉพาะทาง',
        dueAt: `${input.nextReview || '2026-07-18'}T17:00:00+07:00`,
        specialistType: current.specialistType,
        requestId: `${idempotencyKey}-packet`,
      });
      handoffPacketId = packet.packetId;
    }
    const result = this.engine.recordDecision(actionId, {
      actor,
      decision,
      edits: decision === 'EDIT_DRAFT' ? input.editedDraft || input.edits || 'RM แก้ไขร่าง' : null,
      reason: input.reason || 'RM ตรวจหลักฐานและเลือกการดำเนินการ',
      owner: input.owner || current.owner,
      nextReview: input.nextReview || null,
      outcome: input.outcome || null,
      handoffPacketId,
      handoffReviewed: input.handoffReviewed === true,
      requestId: `${idempotencyKey}-decision`,
    });
    let completion = null;
    const canComplete = ['APPROVED_OR_EDITED', 'SCHEDULED_OR_HANDOFF'].includes(result.action.state)
      && input.outcome && input.outcome !== 'PENDING' && input.nextReview
      && (decision !== 'HANDOFF' || input.outcome === 'HANDOFF_ACCEPTED');
    if (canComplete) {
      completion = this.engine.completeAction(actionId, {
        actor,
        reason: input.reason || 'บันทึกผลการคุยและรอบทบทวน',
        outcome: input.outcome,
        nextReview: input.nextReview,
        note: input.notes || null,
        requestId: `${idempotencyKey}-complete`,
      });
    }
    const feedback = Array.isArray(input.feedback) ? input.feedback : [];
    const closedAction = completion?.action || result.action;
    let qualityLabel = null;
    if (feedback.length && ['COMPLETED', 'DISMISSED'].includes(closedAction.state)) {
      qualityLabel = this.engine.recordDecisionQuality(actionId, {
        actor,
        recommendationUseful: feedback.includes('useful') ? true : null,
        explanationUnderstandable: feedback.includes('clear') ? true : null,
        missingImportantInformation: feedback.includes('missing') ? 'RM ระบุว่าขาดข้อมูลสำคัญ' : null,
        priorityAssessment: feedback.includes('priorityHigh') ? 'TOO_HIGH' : feedback.includes('priorityLow') ? 'TOO_LOW' : 'RIGHT',
        specialistResponseCompleted: feedback.includes('handoff') ? true : null,
        requestId: `${idempotencyKey}-quality`,
      });
    }
    const response = { ...result, completion, qualityLabel, feedbackDeferred: Boolean(feedback.length && !qualityLabel), sent: false, traded: false };
    this.decisionResponses.set(idempotencyKey, { fingerprint, response });
    return deepClone(response);
  }
}

function createFinAiV3Application(options = {}) {
  return new FinAiV3Application(options);
}

module.exports = {
  AS_OF,
  HUMAN_ACTOR,
  HOLDING_TO_FIXTURE,
  metricValue,
  normalizeGoal,
  normalizeClient360,
  FinAiV3Application,
  createFinAiV3Application,
};
