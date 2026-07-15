'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPortfolioAnalytics } = require('../lib/v3/portfolio-analytics');

function monthEnd(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
}

function makeFixture(overrides = {}) {
  const dates = [monthEnd(2022, 11)];
  for (let index = 0; index < 36; index += 1) dates.push(monthEnd(2023 + Math.floor(index / 12), index % 12));
  const flowByDate = new Map([
    ['2023-06-30', 100_000],
    ['2024-09-30', -50_000],
  ]);
  const portfolioReturns = dates.slice(1).map((date, index) => ({
    date,
    return: 0.004 + ((index % 7) - 3) * 0.003 + (index === 14 ? -0.08 : 0),
  }));
  const benchmarkReturns = dates.slice(1).map((date, index) => ({
    date,
    return: 0.0035 + ((index % 5) - 2) * 0.0025 + (index === 14 ? -0.055 : 0),
  }));
  let portfolioValue = 1_000_000;
  let benchmarkValue = 1_000_000;
  const series = [{ date: dates[0], value: portfolioValue, benchmarkValue, externalFlow: 0 }];
  for (let index = 0; index < portfolioReturns.length; index += 1) {
    const date = portfolioReturns[index].date;
    const flow = flowByDate.get(date) || 0;
    portfolioValue = portfolioValue * (1 + portfolioReturns[index].return) + flow;
    benchmarkValue = benchmarkValue * (1 + benchmarkReturns[index].return) + flow;
    series.push({ date, value: portfolioValue, benchmarkValue, externalFlow: flow });
  }
  const fundReturns = (shift, missingDates = []) => portfolioReturns
    .filter((row) => !missingDates.includes(row.date))
    .map((row, index) => ({ date: row.date, return: row.return + shift + ((index % 3) - 1) * 0.001 }));
  return {
    series,
    returns: portfolioReturns,
    flows: [...flowByDate].map(([date, amount]) => ({ date, amount })),
    returnType: 'NAV_RETURN',
    currency: 'THB',
    fixture: true,
    sourceRefs: ['fixture://portfolio/P-001', 'fixture://nav/monthly'],
    holdings: [
      { fundId: 'TH-EQ-A', masterFundId: 'TH-EQ', name: 'หุ้นไทย A', value: 300_000, assetClass: 'หุ้นไทย', currency: 'THB' },
      { fundId: 'TH-EQ-D', masterFundId: 'TH-EQ', name: 'หุ้นไทย D', value: 200_000, assetClass: 'หุ้นไทย', currency: 'THB' },
      { fundId: 'TH-BOND-A', masterFundId: 'TH-BOND', name: 'ตราสารหนี้ A', value: 300_000, assetClass: 'ตราสารหนี้', currency: 'THB' },
      { fundId: 'TH-GLOBAL-A', masterFundId: 'TH-GLOBAL', name: 'หุ้นโลก A', value: 200_000, assetClass: 'หุ้นต่างประเทศ', currency: 'THB', currencyExposures: { USD: 0.7, THB: 0.3 } },
    ],
    returnsByFund: {
      'TH-EQ-A': fundReturns(0.002),
      'TH-EQ-D': fundReturns(0.0015, ['2024-03-31']),
      'TH-BOND-A': fundReturns(-0.002, ['2023-08-31', '2025-02-28']),
      'TH-GLOBAL-A': fundReturns(0.003, ['2024-11-30']),
    },
    goals: [{
      goalId: 'goal-education',
      name: 'ค่าเรียนบุตร',
      targetAmount: 2_000_000,
      targetDate: '2030-06-30',
      currentFunding: 1_200_000,
      baseSuccessProbability: 0.72,
      stressSuccessProbability: 0.48,
      requiredMonthlyContribution: 12_000,
      afterAction: {
        currentFunding: 1_300_000,
        baseSuccessProbability: 0.78,
        stressSuccessProbability: 0.56,
        requiredMonthlyContribution: 9_000,
      },
    }],
    ...overrides,
  };
}

function approximately(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

test('portfolio analytics composes cash-flow-aware summary and governed display series deterministically', () => {
  const fixture = makeFixture();
  const first = buildPortfolioAnalytics(fixture, { riskFreeRate: 0.015, confidenceLevel: 0.95 });
  const repeated = buildPortfolioAnalytics(fixture, { riskFreeRate: 0.015, confidenceLevel: 0.95 });
  const expectedTwr = fixture.returns.reduce((growth, row) => growth * (1 + row.return), 1) - 1;
  let wealth = 1;
  let peak = 1;
  let expectedMaxDrawdown = 0;
  let expectedTroughDate = null;
  for (const row of fixture.returns) {
    wealth *= 1 + row.return;
    peak = Math.max(peak, wealth);
    const drawdown = wealth / peak - 1;
    if (drawdown < expectedMaxDrawdown) {
      expectedMaxDrawdown = drawdown;
      expectedTroughDate = row.date;
    }
  }

  assert.equal(first.audit.calculationId, repeated.audit.calculationId);
  assert.equal(first.audit.inputHash, repeated.audit.inputHash);
  assert.equal(first.audit.deterministic, true);
  assert.equal(first.audit.noSmoothing, true);
  assert.equal(first.audit.calculationTrace.chartsAndTablesUseSameReturnSeries, true);
  assert.equal(first.summary.startBalance.value, 1_000_000);
  assert.equal(first.summary.netContribution.value, 100_000);
  assert.equal(first.summary.netWithdrawal.value, 50_000);
  assert.equal(first.summary.netCashFlow.value, 50_000);
  assert.equal(first.summary.endBalance.value, fixture.series.at(-1).value);
  approximately(
    first.summary.periodPnl.value,
    fixture.series.at(-1).value - fixture.series[0].value - 100_000 + 50_000
  );
  assert.equal(first.summary.periodPnl.formulaId, 'CASH_FLOW_ADJUSTED_PERIOD_PNL_V3');
  assert.match(first.summary.periodPnl.cashFlowConvention, /ending balance - starting balance - contributions \+ withdrawals/);
  approximately(first.summary.twr.value, expectedTwr);
  assert.ok(Number.isFinite(first.summary.xirr.value));
  assert.equal(first.summary.cagr.value, null);
  assert.equal(first.summary.cagr.valid, false);
  assert.equal(first.summary.cagr.reasonCode, 'EXTERNAL_CASH_FLOWS_PRESENT');
  assert.equal(first.summary.expectedReturn.method, 'HISTORICAL_GEOMETRIC_ANNUALISED_TWR');
  assert.match(first.summary.expectedReturn.limitation, /not a forecast|not an alpha/i);
  assert.equal(first.summary.observationCount.value, fixture.returns.length);
  approximately(first.summary.maximumDrawdown.value, expectedMaxDrawdown);
  assert.equal(first.summary.maximumDrawdown.troughDate, expectedTroughDate);
  assert.ok(first.summary.historicalCVaR.value >= first.summary.historicalVaR.value);
  for (const metric of Object.values(first.summary)) {
    assert.ok(metric.resultRef && metric.resultRef.calculationId === first.audit.calculationId);
    assert.ok(metric.resultRef.asOf);
    assert.ok(metric.resultRef.period);
    assert.ok(Array.isArray(metric.resultRef.sourceRefs));
  }
  assert.ok(first.audit.reasonCodes.includes('RAW_NAV_NOT_TOTAL_RETURN'));
  assert.equal(first.audit.dataStatus, 'SYNTHETIC_FIXTURE_DEMO');
});

test('period P&L removes contributions and restores withdrawals instead of treating client cash flows as profit', () => {
  const result = buildPortfolioAnalytics({
    series: [
      { date: '2025-01-31', value: 1_000_000 },
      { date: '2025-02-28', value: 1_150_000, externalFlow: 200_000 },
      { date: '2025-03-31', value: 1_080_000, externalFlow: -100_000 },
    ],
    returnType: 'NAV_RETURN',
    fixture: true,
    sourceRefs: ['fixture://pnl/cash-flow-test'],
    holdings: [{ fundId: 'FUND-A', masterFundId: 'FUND-A', value: 1_080_000, assetClass: 'กองทุนผสม', currency: 'THB' }],
  });

  assert.equal(result.summary.netContribution.value, 200_000);
  assert.equal(result.summary.netWithdrawal.value, 100_000);
  assert.equal(result.summary.periodPnl.value, -20_000);
  assert.equal(result.summary.periodPnl.available, true);
});

test('realized and unrealized P&L are explicitly unavailable without governed transaction cost basis', () => {
  const result = buildPortfolioAnalytics(makeFixture());

  for (const key of ['realizedPnl', 'unrealizedPnl']) {
    assert.equal(result.summary[key].value, null);
    assert.equal(result.summary[key].available, false);
    assert.equal(result.summary[key].availability, 'MISSING');
    assert.ok(result.summary[key].reasonCode.includes('GOVERNED'));
    assert.ok(result.summary[key].requiredInputs.length > 0);
    assert.match(result.summary[key].limitation, /not inferred/i);
    assert.equal(result.summary[key].resultRef.calculationId, result.audit.calculationId);
  }
});

test('calendar, heatmap, rolling return, and rolling volatility all derive from the same unsmoothed returns', () => {
  const fixture = makeFixture();
  const result = buildPortfolioAnalytics(fixture);
  const calendar2023 = result.calendarYearReturns.find((row) => row.year === 2023);
  const expected2023 = fixture.returns.filter((row) => row.date.startsWith('2023-'))
    .reduce((growth, row) => growth * (1 + row.return), 1) - 1;

  approximately(calendar2023.value, expected2023);
  assert.equal(calendar2023.completeYear, true);
  assert.equal(result.monthlyReturnHeatmap.length, 36);
  assert.ok(result.rolling12MReturns.length > 0);
  assert.equal(result.rolling12MReturns.length, result.rollingVolatility.length);
  assert.ok(result.rollingVolatility.every((row) => row.value >= 0));
  for (const row of [...result.calendarYearReturns, ...result.monthlyReturnHeatmap, ...result.rolling12MReturns, ...result.rollingVolatility]) {
    assert.equal(row.resultRef.calculationId, result.audit.calculationId);
  }
  assert.equal(result.summary.bestYear.year, result.calendarYearReturns.reduce((best, row) => row.value > best.value ? row : best).year);
  assert.equal(result.summary.worstYear.year, result.calendarYearReturns.reduce((worst, row) => row.value < worst.value ? row : worst).year);
});

test('market beta and holding correlation use actual common dates without forward fill', () => {
  const fixture = makeFixture();
  const result = buildPortfolioAnalytics(fixture, { minCorrelationObservations: 20, minBetaObservations: 20 });

  assert.equal(result.marketBeta.available, true);
  assert.equal(result.marketBeta.observationCount, 36);
  assert.ok(Number.isFinite(result.marketBeta.value));
  assert.equal(result.correlationMatrix.available, true);
  assert.deepEqual(result.correlationMatrix.symbols.sort(), ['TH-BOND', 'TH-EQ', 'TH-GLOBAL']);
  assert.equal(result.correlationMatrix.matrix.length, 3);
  assert.equal(result.correlationMatrix.commonDates.includes('2024-03-31'), false);
  assert.equal(result.correlationMatrix.commonDates.includes('2023-08-31'), false);
  assert.equal(result.correlationMatrix.commonDates.includes('2024-11-30'), false);
  assert.match(result.correlationMatrix.alignment, /actual valuation dates|no forward-filled/i);
  assert.equal(result.correlationMatrix.observationCount, 32);
});

test('share classes are grouped before concentration and risk contribution analytics', () => {
  const result = buildPortfolioAnalytics(makeFixture());

  approximately(result.summary.effectiveHoldings.value, 1 / (0.5 ** 2 + 0.3 ** 2 + 0.2 ** 2));
  assert.equal(result.duplicationWarnings.length, 1);
  assert.equal(result.duplicationWarnings[0].masterFundId, 'TH-EQ');
  assert.deepEqual(result.duplicationWarnings[0].shareClassIds.sort(), ['TH-EQ-A', 'TH-EQ-D']);
  approximately(result.duplicationWarnings[0].combinedWeight, 0.5);
  assert.equal(result.concentrationRisks[0].id, 'TH-EQ');
  assert.equal(result.concentrationRisks[0].severity, 'HIGH');
  assert.ok(result.topRiskContributors.length > 0 && result.topRiskContributors.length <= 5);
  assert.ok(result.topRiskContributors.every((row) => row.entropyApplied === false && row.canBeNegative === true));
});

test('currency look-through and named goal before/after impact do not invent missing projections', () => {
  const fixture = makeFixture();
  fixture.goals.push({
    goalId: 'goal-retirement',
    name: 'เกษียณ',
    targetAmount: 5_000_000,
    targetDate: '2040-12-31',
    currentFunding: 2_000_000,
    baseSuccessProbability: 0.66,
    stressSuccessProbability: 0.44,
    requiredMonthlyContribution: 15_000,
  });
  const result = buildPortfolioAnalytics(fixture);
  const exposure = Object.fromEntries(result.currencyExposure.map((row) => [row.currency, row.weight]));
  const education = result.goalImpact.find((goal) => goal.goalId === 'goal-education');
  const retirement = result.goalImpact.find((goal) => goal.goalId === 'goal-retirement');

  approximately(exposure.THB, 0.86);
  approximately(exposure.USD, 0.14);
  assert.equal(education.name, 'ค่าเรียนบุตร');
  assert.equal(education.targetAmount, 2_000_000);
  approximately(education.before.fundedRatio, 0.6);
  approximately(education.after.fundedRatio, 0.65);
  approximately(education.change.stressSuccessProbability, 0.08);
  assert.equal(retirement.name, 'เกษียณ');
  assert.equal(retirement.afterAvailable, false);
  assert.equal(retirement.after, null);
  assert.equal(retirement.change, null);
  assert.equal(retirement.resultRef.calculationId, result.audit.calculationId);
});

test('caller-supplied expected return must name its method', () => {
  assert.throws(() => buildPortfolioAnalytics(makeFixture({ expectedReturn: 0.06 })), /explicit method/i);
  const result = buildPortfolioAnalytics(makeFixture({
    expectedReturn: {
      value: 0.06,
      method: 'APPROVED_CAPITAL_MARKET_ASSUMPTION_V2',
      limitation: 'Policy assumption, not a promised return.',
    },
  }));
  assert.equal(result.summary.expectedReturn.value, 0.06);
  assert.equal(result.summary.expectedReturn.method, 'APPROVED_CAPITAL_MARKET_ASSUMPTION_V2');
});

test('chart and table cannot silently use a return series that disagrees with governed valuations', () => {
  const fixture = makeFixture();
  fixture.returns = fixture.returns.map((row, index) => index === 5 ? { ...row, return: row.return + 0.01 } : row);
  assert.throws(() => buildPortfolioAnalytics(fixture), /disagree with the cash-flow-adjusted valuation series/i);
});
