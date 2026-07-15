'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_REPLAY_SEED,
  buildDecisionDates,
  createHistoricalReplayFixtures,
} = require('../lib/v3/replay-fixtures');
const {
  RESULT_TYPES,
  STRATEGY_IDS,
  REQUIRED_METRICS,
  buildPointInTimeSnapshot,
  assertPointInTimeSnapshot,
  evaluateFundEligibility,
  buildReplayAlternatives,
  prioritizeReplayActions,
  empiricalVaRCVaR,
  calculateMaxDrawdown,
  createResultSeparation,
  runHistoricalReplay,
  validateHistoricalReplayResult,
} = require('../lib/v3/replay');

let cachedFixtures;
let cachedReplay;

function fixtures() {
  if (!cachedFixtures) cachedFixtures = createHistoricalReplayFixtures();
  return cachedFixtures;
}

function replay() {
  if (!cachedReplay) cachedReplay = runHistoricalReplay({ fixtures: fixtures() });
  return cachedReplay;
}

test('fixture universe has 12 synthetic Thai funds, 3-5 years of dated raw NAV, monthly dates and three stress periods', () => {
  const data = fixtures();
  assert.equal(data.seed, DEFAULT_REPLAY_SEED);
  assert.equal(data.funds.length, 12);
  assert.equal(data.fundCount, 12);
  assert.equal(data.synthetic, true);
  assert.equal(data.returnType, 'NAV_RETURN');
  assert.equal(data.isTotalReturn, false);
  assert.equal(data.stressPeriods.length, 3);
  assert.deepEqual(data.stressPeriods.map((period) => period.stressId), [
    'STRESS_COVID_LIQUIDITY_2020',
    'STRESS_GLOBAL_RATE_2022',
    'STRESS_THAI_EQUITY_2023',
  ]);
  assert.equal(data.decisionDates.length, 59);
  assert.deepEqual(data.decisionDates, buildDecisionDates('2020-02-01', '2024-12-01'));

  for (const fund of data.funds) {
    assert.equal(fund.thaiRegistered, true);
    assert.equal(fund.currency, 'THB');
    assert.equal(fund.masterFundId, fund.fundId);
    assert.ok(fund.navHistory.length >= 750, `${fund.fundId} has fewer than three years of business-day NAV`);
    assert.ok(fund.navHistory.length <= 1310, `${fund.fundId} exceeds five years of business-day NAV`);
    assert.ok(fund.navHistory.every((row) => row.returnType === 'NAV_RETURN' && row.isTotalReturn === false));
    assert.ok(fund.navHistory.every((row) => row.availableAt > row.date));
  }
});

test('point-in-time snapshot gates effective dates and publication dates across every governed input class', () => {
  const snapshot = buildPointInTimeSnapshot(fixtures(), '2023-09-01');
  assert.equal(assertPointInTimeSnapshot(snapshot), true);
  assert.equal(snapshot.pointInTimeValidated, true);
  assert.ok(snapshot.lineage.maxObservedAt <= snapshot.asOf);
  assert.ok(snapshot.lineage.maxAvailableAt <= snapshot.asOf);
  assert.equal(snapshot.client.suitability.maxRiskLevel, 5);
  assert.notEqual(
    snapshot.funds.find((fund) => fund.fundId === 'THF-GL-H-009').classification.versionId,
    'THF-GL-H-009-CLASS-future-revision'
  );
  assert.notEqual(
    snapshot.funds.find((fund) => fund.fundId === 'THF-BD-GOV-003').factsheet.versionId,
    'THF-BD-GOV-003-FACT-future-revision'
  );
  assert.notEqual(snapshot.holdings.snapshotId, 'HOLD-SYN-FUTURE-REVISION');
  assert.ok(snapshot.lineage.excludedUnavailableRevisionIds.includes('THF-GL-H-009-CLASS-future-revision'));
  assert.ok(snapshot.lineage.excludedUnavailableRevisionIds.includes('THF-BD-GOV-003-FACT-future-revision'));
  assert.ok(snapshot.lineage.excludedUnavailableRevisionIds.includes('HOLD-SYN-FUTURE-REVISION'));
});

test('point-in-time input hash changes when accepted NAV or assumption content changes under the same references', () => {
  const date = '2023-09-01';
  const baseData = createHistoricalReplayFixtures();
  const baseline = buildPointInTimeSnapshot(baseData, date);

  const changedAssumptionData = JSON.parse(JSON.stringify(baseData));
  const activeAssumption = changedAssumptionData.capitalMarketAssumptions.find((item) => item.assumptionId === 'CMA-SYN-v2');
  activeAssumption.transactionCostBps += 1;
  const changedAssumption = buildPointInTimeSnapshot(changedAssumptionData, date);
  assert.notEqual(changedAssumption.lineage.inputHash, baseline.lineage.inputHash);

  const changedNavData = JSON.parse(JSON.stringify(baseData));
  const acceptedNav = changedNavData.funds[0].navHistory.find((row) => row.availableAt <= date);
  acceptedNav.nav = Number((acceptedNav.nav + 0.01).toFixed(6));
  const changedNav = buildPointInTimeSnapshot(changedNavData, date);
  assert.notEqual(changedNav.lineage.inputHash, baseline.lineage.inputHash);
});

test('point-in-time guard rejects a future NAV, benchmark, factsheet, or availability reference', () => {
  const navLeak = buildPointInTimeSnapshot(fixtures(), '2022-06-01');
  navLeak.funds[0].navHistory.push({ date: '2022-06-02', availableAt: '2022-06-03', nav: 99 });
  assert.throws(() => assertPointInTimeSnapshot(navLeak), /after replay date|future/i);

  const benchmarkLeak = buildPointInTimeSnapshot(fixtures(), '2022-06-01');
  benchmarkLeak.benchmarks[0].history.push({ date: '2022-06-02', availableAt: '2022-06-03', level: 99 });
  assert.throws(() => assertPointInTimeSnapshot(benchmarkLeak), /after replay date|future/i);

  const productLeak = buildPointInTimeSnapshot(fixtures(), '2022-06-01');
  productLeak.funds[0].factsheet.publishedAt = '2022-06-02';
  assert.throws(() => assertPointInTimeSnapshot(productLeak), /after replay date|future/i);
});

test('unavailable retroactive revisions are traced but cannot change decisions or calculation IDs', () => {
  const data = createHistoricalReplayFixtures();
  const baseSnapshot = buildPointInTimeSnapshot(data, '2022-05-01');
  const baseAlternatives = buildReplayAlternatives(baseSnapshot, { wealth: 3000000 });
  const baseRun = runHistoricalReplay({
    fixtures: data,
    decisionDates: ['2022-05-01', '2022-06-01'],
  });

  const cash = data.funds.find((fund) => fund.fundId === 'THF-MM-001');
  cash.navHistory.push({
    date: '2022-04-29', observedAt: '2022-04-29', availableAt: '2026-01-01', nav: 999,
    rawNav: 999, currency: 'THB', returnType: 'NAV_RETURN', isTotalReturn: false,
    sourceRef: 'fixture://injected/future-nav-revision',
  });
  cash.classificationHistory.push({
    versionId: 'INJECTED-FUTURE-CLASSIFICATION', effectiveFrom: '2020-01-01', publishedAt: '2026-01-01',
    assetClass: 'GOLD', policyBucket: 'REAL_ASSET', riskLevel: 8,
    sourceRef: 'fixture://injected/future-classification',
  });
  data.capitalMarketAssumptions.push({
    assumptionId: 'INJECTED-FUTURE-CMA', effectiveFrom: '2020-01-01', publishedAt: '2026-01-01',
    annualExpectedReturns: { CASH: 9 }, transactionCostBps: 9999,
    sourceRef: 'fixture://injected/future-cma',
  });

  const guardedSnapshot = buildPointInTimeSnapshot(data, '2022-05-01');
  const guardedAlternatives = buildReplayAlternatives(guardedSnapshot, { wealth: 3000000 });
  const guardedRun = runHistoricalReplay({
    fixtures: data,
    decisionDates: ['2022-05-01', '2022-06-01'],
  });
  assert.equal(guardedSnapshot.lineage.inputHash, baseSnapshot.lineage.inputHash);
  assert.deepEqual(guardedAlternatives, baseAlternatives);
  assert.equal(guardedRun.calculationId, baseRun.calculationId);
  assert.deepEqual(
    Object.fromEntries(Object.entries(guardedRun.strategyResults).map(([id, value]) => [id, value.metrics])),
    Object.fromEntries(Object.entries(baseRun.strategyResults).map(([id, value]) => [id, value.metrics]))
  );
  assert.ok(guardedSnapshot.lineage.excludedUnavailableRevisionIds.includes('INJECTED-FUTURE-CLASSIFICATION'));
  assert.ok(guardedSnapshot.lineage.excludedUnavailableRevisionIds.includes('INJECTED-FUTURE-CMA'));
  assert.ok(guardedSnapshot.lineage.excludedUnavailableRevisionIds.includes('fixture://injected/future-nav-revision'));
});

test('point-in-time shelf, quality and suitability rules exclude ineligible funds from proposed strategies', () => {
  const beforeGoldApproval = buildPointInTimeSnapshot(fixtures(), '2022-01-15');
  const afterGoldApproval = buildPointInTimeSnapshot(fixtures(), '2022-03-01');
  assert.equal(beforeGoldApproval.funds.find((fund) => fund.fundId === 'THF-GOLD-011').shelf.status, 'NOT_APPROVED');
  assert.equal(afterGoldApproval.funds.find((fund) => fund.fundId === 'THF-GOLD-011').shelf.status, 'APPROVED');

  const qualityFail = buildPointInTimeSnapshot(fixtures(), '2022-08-01');
  const qualityPass = buildPointInTimeSnapshot(fixtures(), '2022-11-01');
  assert.equal(qualityFail.funds.find((fund) => fund.fundId === 'THF-BD-CR-004').dataQuality.status, 'FAIL');
  assert.equal(qualityPass.funds.find((fund) => fund.fundId === 'THF-BD-CR-004').dataQuality.status, 'PASS');

  const riskFive = buildPointInTimeSnapshot(fixtures(), '2023-09-01');
  const smallCap = riskFive.funds.find((fund) => fund.fundId === 'THF-EQ-SC-008');
  const eligibility = evaluateFundEligibility(smallCap, riskFive.client);
  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.reasonCodes.includes('RISK_LEVEL_EXCEEDS_SUITABILITY'));
  assert.ok(eligibility.reasonCodes.includes('NOT_ON_APPROVED_SHELF'));

  const alternatives = buildReplayAlternatives(riskFive, { wealth: 3300000 });
  for (const strategyId of [STRATEGY_IDS.ELIGIBLE_APPROVED_MODEL, STRATEGY_IDS.GOAL_BASED_CANDIDATE]) {
    const alternative = alternatives[strategyId];
    assert.equal(alternative.eligibleOnly, true);
    assert.ok(alternative.selections.every((selection) => selection.eligibility.eligible));
    for (const fundId of Object.keys(alternative.weights)) {
      const fund = riskFive.funds.find((item) => item.fundId === fundId);
      assert.ok(fund.classification.riskLevel <= 5);
    }
  }
});

test('market events appear only after detection and their closure is hidden until published', () => {
  const beforeDetection = buildPointInTimeSnapshot(fixtures(), '2023-08-02');
  assert.ok(!beforeDetection.marketEvents.some((event) => event.eventId === 'EVENT-THAI-EQUITY-2023'));
  const afterDetection = buildPointInTimeSnapshot(fixtures(), '2023-09-01');
  const active = afterDetection.marketEvents.find((event) => event.eventId === 'EVENT-THAI-EQUITY-2023');
  assert.equal(active.status, 'ACTIVE');
  assert.equal(active.endedAt, null);
  const afterClosure = buildPointInTimeSnapshot(fixtures(), '2023-12-15');
  const closed = afterClosure.marketEvents.find((event) => event.eventId === 'EVENT-THAI-EQUITY-2023');
  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.endedAt, '2023-11-30');
});

test('default replay compares four required strategies in a monthly walk-forward with no alpha or full-sample optimisation', () => {
  const result = replay();
  assert.equal(result.resultType, RESULT_TYPES.HISTORICAL_REPLAY);
  assert.equal(result.resultClass, RESULT_TYPES.HISTORICAL_REPLAY);
  assert.equal(result.protocol.method, 'MONTHLY_WALK_FORWARD');
  assert.equal(result.protocol.decisionDateCount, 59);
  assert.equal(result.protocol.fullSampleOptimization, false);
  assert.equal(result.protocol.alphaObjective, false);
  assert.equal(result.protocol.weightsFrozenBeforeEvaluation, true);
  assert.deepEqual(Object.keys(result.strategyResults), Object.values(STRATEGY_IDS));
  assert.equal(result.strategyResults[STRATEGY_IDS.CURRENT_NO_ACTION].metrics.turnover, 0);
  assert.equal(result.strategyResults[STRATEGY_IDS.CURRENT_NO_ACTION].metrics.transactionCost, 0);
  assert.match(result.protocol.comparatorDefinitions[STRATEGY_IDS.CURRENT_NO_ACTION], /zero replay-generated trade/);
  assert.equal(validateHistoricalReplayResult(result), true);
});

test('every decision uses data available by t and evaluates only after frozen selection input', () => {
  const result = replay();
  for (const strategy of Object.values(result.strategyResults)) {
    assert.equal(strategy.steps.length, 59);
    for (const step of strategy.steps) {
      assert.ok(step.pointInTime.decisionDataMaxObservedAt <= step.decision.date);
      assert.ok(step.pointInTime.decisionDataMaxAvailableAt <= step.decision.date);
      assert.equal(step.pointInTime.selectionInputEnd, step.decision.date);
      assert.equal(step.pointInTime.outOfSampleStartExclusive, step.decision.date);
      assert.equal(step.pointInTime.outOfSampleEndInclusive, step.evaluation.endDate);
      assert.ok(step.evaluation.endDate > step.decision.date);
      assert.ok(step.evaluation.evaluationDataMaxAvailableAt <= step.evaluation.endDate);
      assert.ok(step.evaluation.evaluationRefs.every((ref) => ref.endDate > step.decision.date));
      assert.ok(step.evaluation.evaluationRefs.every((ref) => ref.endAvailableAt <= step.evaluation.endDate));
      assert.ok(step.cost.productFeeSourceDetails.every(
        (detail) => detail.publishedAt <= step.decision.date
      ));
      assert.match(step.cost.productFeeTreatment, /EMBEDDED_IN_NAV|NON_INVESTABLE_BENCHMARK/);
      assert.equal(step.pointInTime.futureDataInDecision, false);
    }
  }
});

test('all required metrics, denominator definitions, transaction costs and RM workload formulas are reported', () => {
  const result = replay();
  for (const strategy of Object.values(result.strategyResults)) {
    for (const metric of REQUIRED_METRICS) assert.ok(metric in strategy.metrics, metric);
    assert.ok(strategy.metrics.goalSuccessRate >= 0 && strategy.metrics.goalSuccessRate <= 1);
    assert.ok(Number.isFinite(strategy.metrics.twr));
    assert.equal(strategy.metrics.twrStatus, 'AVAILABLE');
    assert.equal(strategy.metrics.xirrStatus, 'AVAILABLE');
    assert.ok(Number.isFinite(strategy.metrics.xirr));
    assert.equal(strategy.metrics.annualizedVolatilityStatus, 'AVAILABLE');
    assert.ok(Number.isFinite(strategy.metrics.annualizedVolatility));
    assert.ok(strategy.metrics.normalizedGoalShortfall >= 0);
    assert.ok(Number.isFinite(strategy.metrics.empiricalCVaR));
    assert.ok(strategy.metrics.maximumDrawdown <= 0);
    assert.ok(strategy.metrics.turnover >= 0);
    assert.ok(strategy.metrics.productFeeEstimate >= 0);
    assert.ok(strategy.metrics.transactionCost >= 0);
    assert.equal(
      strategy.metrics.estimatedTotalCost,
      strategy.metrics.productFeeEstimate + strategy.metrics.transactionCost
    );
    assert.ok(Number.isInteger(strategy.metrics.liquidityViolations));
    assert.ok(Number.isInteger(strategy.metrics.suitabilityViolations));
    assert.ok(Number.isInteger(strategy.metrics.careAlerts));
    assert.match(strategy.metrics.falsePositiveAlertEvaluation.denominator, /Non-mandatory Care/);
    assert.match(strategy.metrics.rmWorkloadGenerated.formula, /20 minutes per Care.*15 minutes per Growth/);
    const expectedMinutes = strategy.metrics.rmWorkloadGenerated.careAlertCount * 20
      + strategy.metrics.rmWorkloadGenerated.growthOpportunityCount * 15;
    assert.equal(strategy.metrics.rmWorkloadGenerated.estimatedMinutes, expectedMinutes);
    assert.match(strategy.audit.calculationId, /^replay-metric-[a-f0-9]{20}$/);
    assert.match(strategy.audit.inputHash, /^[a-f0-9]{64}$/);
    assert.match(strategy.audit.performanceValidation.calculationId, /^replay-performance-[a-f0-9]{20}$/);
    const linkedTwr = strategy.steps.reduce(
      (growth, step) => growth * (1 + step.evaluation.netReturn), 1
    ) - 1;
    assert.ok(Math.abs(strategy.metrics.twr - linkedTwr) < 1e-12);
  }
  assert.equal(
    result.strategyResults[STRATEGY_IDS.SIMPLE_POLICY_BENCHMARK].metrics.productFeeEstimate,
    0
  );
});

test('a short replay reports governed availability instead of fabricating volatility', () => {
  const result = runHistoricalReplay({
    fixtures: fixtures(),
    decisionDates: ['2022-05-01'],
  });
  for (const strategy of Object.values(result.strategyResults)) {
    assert.equal(strategy.metrics.twrStatus, 'AVAILABLE');
    assert.ok(Number.isFinite(strategy.metrics.twr));
    assert.equal(strategy.metrics.xirrStatus, 'AVAILABLE');
    assert.ok(Number.isFinite(strategy.metrics.xirr));
    assert.equal(strategy.metrics.annualizedVolatility, null);
    assert.equal(
      strategy.metrics.annualizedVolatilityStatus,
      'UNAVAILABLE_INSUFFICIENT_OBSERVATIONS'
    );
    assert.equal(
      strategy.audit.formulaIds.annualizedVolatility,
      'ANNUALIZED_VOLATILITY_UNAVAILABLE_GOVERNED_STATUS_V1'
    );
  }
});

test('three named stress windows are evaluated for every strategy with no decision-time stress labels', () => {
  const result = replay();
  assert.equal(result.stressPeriodResults.length, 3);
  for (const period of result.stressPeriodResults) {
    assert.equal(period.resultType, RESULT_TYPES.NAMED_STRESS);
    assert.equal(period.sourceResultType, RESULT_TYPES.HISTORICAL_REPLAY);
    assert.equal(period.dataUse, 'EVALUATION_WINDOW_ONLY_NOT_A_DECISION_INPUT');
    assert.deepEqual(Object.keys(period.strategies), Object.values(STRATEGY_IDS));
    for (const metrics of Object.values(period.strategies)) {
      assert.ok(metrics.observationCount >= 2);
      assert.ok(Number.isFinite(metrics.twr));
      assert.equal(metrics.xirrStatus, 'AVAILABLE');
      assert.ok(Number.isFinite(metrics.xirr));
      assert.equal(metrics.annualizedVolatilityStatus, 'AVAILABLE');
      assert.ok(Number.isFinite(metrics.annualizedVolatility));
      assert.ok(Number.isFinite(metrics.empiricalCVaR));
      assert.ok(metrics.maximumDrawdown <= 0);
      assert.ok(metrics.turnover >= 0);
      assert.ok(metrics.productFeeEstimate >= 0);
      assert.ok(metrics.transactionCost >= 0);
      assert.ok(metrics.liquidityViolations >= 0);
      assert.ok(metrics.goalSuccessRate >= 0 && metrics.goalSuccessRate <= 1);
      assert.match(metrics.audit.calculationId, /^replay-performance-[a-f0-9]{20}$/);
    }
  }
});

test('Care always outranks Growth and mandatory Care wins ties regardless of supporting order', () => {
  const actions = prioritizeReplayActions([
    { actionId: 'growth', strategyId: 'Z', lane: 'GROWTH', priorityTier: 'P0', mandatoryCare: false },
    { actionId: 'care', strategyId: 'B', lane: 'CARE', priorityTier: 'P1', mandatoryCare: false },
    { actionId: 'mandatory', strategyId: 'A', lane: 'CARE', priorityTier: 'P1', mandatoryCare: true },
    { actionId: 'none', strategyId: 'A', lane: 'NO_ACTION', priorityTier: 'P3', mandatoryCare: false },
  ]);
  assert.deepEqual(actions.map((action) => action.actionId), ['mandatory', 'care', 'growth', 'none']);
  assert.equal(replay().decisionBatches.every(
    (batch) => batch.actions.findIndex((action) => action.lane === 'CARE')
      <= batch.actions.findIndex((action) => action.lane === 'GROWTH')
      || !batch.actions.some((action) => action.lane === 'GROWTH')
  ), true);
});

test('empirical CVaR uses a finite observed tail and drawdown uses the governed return path', () => {
  const tail = empiricalVaRCVaR([0.02, -0.01, -0.03, 0.01, -0.10], 0.80);
  assert.equal(tail.valueAtRisk, 0.03);
  assert.equal(tail.conditionalValueAtRisk, 0.065);
  assert.equal(tail.tailObservationCount, 2);
  assert.equal(empiricalVaRCVaR([0.01, -0.02], 0.99).tailObservationCount, 1);
  assert.ok(Math.abs(calculateMaxDrawdown([100, 110, 88, 92.4, 111]) + 0.2) < 1e-12);
});

test('seed and governed calculation IDs are replayable while a different seed changes results', () => {
  const same = runHistoricalReplay({ fixtures: createHistoricalReplayFixtures() });
  assert.equal(same.seed, replay().seed);
  assert.equal(same.calculationId, replay().calculationId);
  assert.equal(same.inputHash, replay().inputHash);
  assert.deepEqual(
    Object.fromEntries(Object.entries(same.strategyResults).map(([id, value]) => [id, value.audit.calculationId])),
    Object.fromEntries(Object.entries(replay().strategyResults).map(([id, value]) => [id, value.audit.calculationId]))
  );
  const different = runHistoricalReplay({
    fixtures: createHistoricalReplayFixtures({ seed: 'different-governed-seed' }),
    decisionDates: ['2020-02-01', '2020-03-01'],
  });
  assert.notEqual(different.inputHash, replay().inputHash);
});

test('historical replay, synthetic scenario and live pilot remain separate with no causal uplift claim', () => {
  const result = replay();
  assert.deepEqual(createResultSeparation().historicalReplay.resultClass, RESULT_TYPES.HISTORICAL_REPLAY);
  assert.equal(result.resultSeparation.historicalReplay.status, 'COMPLETE');
  assert.equal(result.resultSeparation.namedStress.resultClass, RESULT_TYPES.NAMED_STRESS);
  assert.equal(result.resultSeparation.namedStress.status, 'COMPLETE');
  assert.equal(result.resultSeparation.forwardSimulation.resultClass, RESULT_TYPES.FORWARD_SIMULATION);
  assert.equal(result.resultSeparation.forwardSimulation.status, 'NOT_RUN');
  assert.equal(result.resultSeparation.forwardSimulation.metrics, null);
  assert.equal(result.resultSeparation.syntheticScenario.resultClass, RESULT_TYPES.SYNTHETIC_SCENARIO);
  assert.equal(result.resultSeparation.syntheticScenario.status, 'NOT_RUN');
  assert.equal(result.resultSeparation.syntheticScenario.metrics, null);
  assert.equal(result.resultSeparation.livePilot.resultClass, RESULT_TYPES.LIVE_PILOT);
  assert.equal(result.resultSeparation.livePilot.status, 'NOT_COLLECTED');
  assert.equal(result.resultSeparation.livePilot.metrics, null);
  assert.equal(result.claimPolicy.causalRevenueClaimAllowed, false);
  assert.equal(result.claimPolicy.causalRetentionClaimAllowed, false);
  assert.equal(result.claimPolicy.alphaClaimAllowed, false);
  assert.equal(result.claimPolicy.marketOutperformanceClaimAllowed, false);
  assert.match(result.claimPolicy.statementNoAlphaTh, /alpha|ชนะตลาด/i);
  assert.doesNotMatch(result.claimPolicy.statementTh, /เพิ่มรายได้|เพิ่ม retention/i);
});
