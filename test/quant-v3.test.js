"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveNavReturns,
  calculateTWR,
  calculateXIRR,
  calculateCAGRNoFlows,
  inferFrequency,
  calculateAnnualizedVolatility,
  calculateDrawdownSeries,
  calculateDownsideDeviation,
  calculateSharpeRatio,
  calculateSortinoRatio,
  calculateCalmarRatio,
  calculateHistoricalVaRCVaR,
  calculateCovarianceAndCorrelation,
  shrinkCovariance,
  verifyPositiveSemidefinite,
  repairCovariancePSD,
  groupHoldingsByMasterFund,
  calculateEffectiveHoldings,
  calculatePcaDiversification,
  calculatePerformance,
} = require("../lib/v3/quant");

function close(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    "expected " + actual + " to be within " + tolerance + " of " + expected
  );
}

test("raw NAV is explicitly NAV return and is never labelled total return", () => {
  const raw = deriveNavReturns([
    { date: "2026-01-01", nav: 10 },
    { date: "2026-01-02", nav: 10.5 },
    { date: "2026-01-03", nav: 10.29 },
  ], {
    metadata: {
      calculationId: "calc-nav-raw",
      sourceRefs: ["fixture://nav/FUND-A"],
      asOf: "2026-01-03",
    },
  });
  assert.equal(raw.returnType, "NAV_RETURN");
  assert.equal(raw.isTotalReturn, false);
  assert.equal(raw.label, "NAV return");
  assert.match(raw.warnings[0], /not be labelled total return/i);
  close(raw.returns[0].return, 0.05);
  close(raw.returns[1].return, -0.02);
  assert.equal(raw.audit.calculationId, "calc-nav-raw");
  assert.deepEqual(raw.audit.sourceRefs, ["fixture://nav/FUND-A"]);
  assert.match(raw.audit.inputHash, /^[a-f0-9]{64}$/);
});

test("adjusted NAV is used only when the complete adjusted series is present", () => {
  const adjusted = deriveNavReturns([
    { date: "2026-01-01", nav: 10, adjustedNav: 10 },
    { date: "2026-01-02", nav: 9.9, adjustedNav: 10.1 },
  ]);
  assert.equal(adjusted.returnType, "ADJUSTED_NAV_RETURN");
  assert.equal(adjusted.navFieldUsed, "adjustedNav");
  close(adjusted.returns[0].return, 0.01);

  const incomplete = deriveNavReturns([
    { date: "2026-01-01", nav: 10, adjustedNav: 10 },
    { date: "2026-01-02", nav: 9.9 },
  ]);
  assert.equal(incomplete.returnType, "NAV_RETURN");
  close(incomplete.returns[0].return, -0.01);
  assert.match(incomplete.warnings.join(" "), /incomplete/i);
});

test("TWR removes external contributions before linking subperiod returns", () => {
  const result = calculateTWR([
    { date: "2026-01-01", value: 100 },
    { date: "2026-02-01", value: 110 },
    { date: "2026-03-01", value: 165, externalFlow: 50 },
  ]);
  close(result.subperiods[0].return, 0.10);
  close(result.subperiods[1].return, 115 / 110 - 1);
  close(result.twr, 0.15);
  assert.match(result.cashFlowConvention, /positive = contribution/i);
});

test("XIRR solves irregular dated client cash flows using actual days over 365.25", () => {
  const result = calculateXIRR([
    { date: "2024-01-01", amount: -1000 },
    { date: "2024-07-01", amount: -200 },
    { date: "2025-02-01", amount: 1300 },
  ]);
  const base = new Date("2024-01-01T00:00:00Z").getTime();
  const yearFraction = (date) => (
    new Date(date + "T00:00:00Z").getTime() - base
  ) / 86400000 / 365.25;
  const residual = -1000
    - 200 / (1 + result.xirr) ** yearFraction("2024-07-01")
    + 1300 / (1 + result.xirr) ** yearFraction("2025-02-01");
  assert.ok(result.converged);
  assert.ok(Math.abs(residual) < 1e-7);
  assert.equal(result.dayCountConvention, "actual days / 365.25");
});

test("CAGR without flows uses elapsed calendar days and rejects cash flows", () => {
  const result = calculateCAGRNoFlows({
    startValue: 100,
    endValue: 121,
    startDate: "2024-01-01",
    endDate: "2026-01-01",
  });
  const days = 731;
  close(result.cagr, 1.21 ** (365.25 / days) - 1);
  assert.equal(result.elapsedCalendarDays, days);
  assert.throws(() => calculateCAGRNoFlows({
    startValue: 100,
    endValue: 121,
    startDate: "2024-01-01",
    endDate: "2026-01-01",
    cashFlows: [{ amount: 1 }],
  }), /cannot be used when external cash flows exist/);
});

test("frequency is inferred from actual dates and drives volatility annualisation", () => {
  const returns = [
    { date: "2026-01-31", return: 0.01 },
    { date: "2026-02-28", return: -0.01 },
    { date: "2026-03-31", return: 0.02 },
  ];
  const frequency = inferFrequency(returns.map((row) => row.date));
  assert.equal(frequency.frequency, "monthly");
  assert.equal(frequency.periodsPerYear, 12);
  const volatility = calculateAnnualizedVolatility(returns);
  const mean = (0.01 - 0.01 + 0.02) / 3;
  const sampleVariance = (
    (0.01 - mean) ** 2 + (-0.01 - mean) ** 2 + (0.02 - mean) ** 2
  ) / 2;
  close(volatility.annualizedVolatility, Math.sqrt(sampleVariance) * Math.sqrt(12));
});

test("drawdown tracks peak, trough, and recovery on one governed wealth path", () => {
  const result = calculateDrawdownSeries([
    { date: "2026-01-01", return: 0.10 },
    { date: "2026-01-02", return: -0.20 },
    { date: "2026-01-03", return: 0.05 },
    { date: "2026-01-04", return: 0.20 },
  ]);
  close(result.maxDrawdown, -0.20);
  assert.equal(result.peakDate, "2026-01-01");
  assert.equal(result.troughDate, "2026-01-02");
  assert.equal(result.recoveryDate, "2026-01-04");
  assert.equal(result.series.length, 4);
});

test("Sharpe, Sortino, downside deviation, and Calmar expose their governed components", () => {
  const returns = [0.02, -0.01, 0.015, -0.005, 0.01];
  const options = {
    frequency: "monthly",
    riskFreeRate: 0.02,
    minimumAcceptableReturn: 0,
  };
  const downside = calculateDownsideDeviation(returns, options);
  const sharpe = calculateSharpeRatio(returns, options);
  const sortino = calculateSortinoRatio(returns, options);
  const calmar = calculateCalmarRatio(returns, options);
  assert.ok(downside.annualizedDownsideDeviation > 0);
  assert.ok(Number.isFinite(sharpe.sharpe));
  assert.ok(Number.isFinite(sortino.sortino));
  assert.ok(Number.isFinite(calmar.calmar));
  assert.equal(sharpe.periodsPerYear, 12);
  assert.match(calmar.formula, /CAGR/);
});

test("empirical VaR/CVaR uses a non-empty finite-sample tail on losses", () => {
  const risk = calculateHistoricalVaRCVaR(
    [0.02, -0.01, -0.03, 0.01, -0.10],
    { confidenceLevel: 0.80 }
  );
  close(risk.valueAtRisk, 0.03);
  close(risk.conditionalValueAtRisk, 0.065);
  assert.equal(risk.orderStatistic, 4);
  assert.equal(risk.tailObservationCount, 2);

  const tiny = calculateHistoricalVaRCVaR([0.01, -0.02], { confidenceLevel: 0.99 });
  close(tiny.var, 0.02);
  close(tiny.cvar, 0.02);
  assert.equal(tiny.tailObservationCount, 1);
});

test("covariance aligns only actual common dates and excludes insufficient history", () => {
  const result = calculateCovarianceAndCorrelation({
    FUND_A: [
      { date: "2026-01-01", return: 0.01 },
      { date: "2026-01-02", return: 0.02 },
      { date: "2026-01-03", return: 0.03 },
    ],
    FUND_B: [
      { date: "2025-12-31", return: 0.99 },
      { date: "2026-01-02", return: 0.04 },
      { date: "2026-01-03", return: 0.06 },
      { date: "2026-01-04", return: -0.50 },
    ],
    FUND_C: [
      { date: "2026-01-03", return: 0.01 },
    ],
  }, {
    minObservations: 2,
    annualize: false,
    shrinkage: false,
  });
  assert.deepEqual(result.symbols, ["FUND_A", "FUND_B"]);
  assert.deepEqual(result.commonDates, ["2026-01-02", "2026-01-03"]);
  assert.deepEqual(result.excludedSymbols, ["FUND_C"]);
  close(result.periodicSampleCovariance[0][0], 0.00005);
  close(result.periodicSampleCovariance[0][1], 0.0001);
  close(result.periodicSampleCovariance[1][1], 0.0002);
  assert.match(result.alignment, /no forward-filled returns/);
});

test("constant-correlation shrinkage is transparent and PSD repair clips a negative eigenvalue", () => {
  const shrunk = shrinkCovariance([
    [0.04, 0.01],
    [0.01, 0.09],
  ], { observationCount: 20, intensity: 0.25 });
  assert.equal(shrunk.method, "constant-correlation shrinkage");
  assert.equal(shrunk.intensity, 0.25);
  assert.equal(shrunk.target.length, 2);

  const indefinite = [
    [1, 2],
    [2, 1],
  ];
  assert.equal(verifyPositiveSemidefinite(indefinite).isPSD, false);
  const repaired = repairCovariancePSD(indefinite);
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.isPSDAfter, true);
  assert.ok(repaired.minEigenvalueAfter >= -1e-10);
});

test("share classes are grouped by master fund before effective-holdings math", () => {
  const holdings = [
    { fundId: "MASTER-A-A", masterFundId: "MASTER-A", weight: 0.25 },
    { fundId: "MASTER-A-D", masterFundId: "MASTER-A", weight: 0.25 },
    { fundId: "MASTER-B-A", masterFundId: "MASTER-B", weight: 0.50 },
  ];
  const grouped = groupHoldingsByMasterFund(holdings);
  assert.equal(grouped.masterFundCount, 2);
  assert.equal(grouped.groupedShareClassCount, 1);
  const effective = calculateEffectiveHoldings(holdings);
  close(effective.effectiveHoldings, 2);
  assert.equal(effective.groupedByMasterFund, true);
  assert.deepEqual(effective.symbols, ["MASTER-A", "MASTER-B"]);
});

test("PCA diversification reports one risk dimension for perfectly correlated holdings", () => {
  const pca = calculatePcaDiversification(
    [0.5, 0.5],
    [
      [0.04, 0.04],
      [0.04, 0.04],
    ],
    { symbols: ["A", "B"] }
  );
  close(pca.effectivePcaDimensions, 1, 1e-10);
  close(pca.components.reduce((sum, item) => sum + item.varianceShare, 0), 1);
  assert.match(pca.limitation, /does not use entropy of Euler risk contributions/i);
});

test("high-level performance composition uses the same governed primitives and raw-NAV warning", () => {
  const performance = calculatePerformance({
    returnType: "NAV_RETURN",
    returns: [
      { date: "2026-01-01", return: 0.01 },
      { date: "2026-01-02", return: -0.02 },
      { date: "2026-01-03", return: 0.015 },
      { date: "2026-01-04", return: 0.005 },
    ],
    riskFreeRate: 0.01,
    minimumAcceptableReturn: 0,
    confidenceLevel: 0.95,
  }, {
    metadata: {
      calculationId: "performance-001",
      modelVersion: "quant-v3-test",
      assumptionVersion: "test-assumptions",
      sourceRefs: ["fixture://fund/NAV"],
    },
  });
  assert.equal(performance.isTotalReturn, false);
  assert.match(performance.warnings[0], /not labelled total return/i);
  assert.equal(performance.volatility.audit.modelVersion, "quant-v3-test");
  assert.equal(performance.audit.calculationId, "performance-001");
  assert.ok(Number.isFinite(performance.historicalRisk.cvar));
  assert.equal(performance.drawdown.series.length, 4);
});

