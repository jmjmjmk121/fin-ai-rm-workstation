"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ASSET_KEYS,
  ANNUAL_EXPECTED_RETURNS,
  ANNUAL_COVARIANCE,
  THAI_ASSET_ASSUMPTIONS,
  isPositiveDefinite,
  portfolioMetrics,
  solveMinimumVariance,
  solveTargetReturn,
  buildEfficientFrontier,
  generateRandomCloud,
} = require("../lib/frontier");

const EPSILON = 1e-9;

function assertLongOnlyBudget(weights) {
  assert.ok(weights.every((weight) => weight >= -EPSILON), "all weights must be nonnegative");
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  assert.ok(Math.abs(total - 1) < EPSILON, `weights sum to ${total}, not 1`);
}

test("Thai assumptions contain six named buckets and a positive-definite annual covariance", () => {
  assert.deepEqual(ASSET_KEYS, [
    "cash",
    "thaiGovBond",
    "thaiCorpBond",
    "thaiEquityCore",
    "thaiEquityDividend",
    "thaiReit",
  ]);
  assert.equal(THAI_ASSET_ASSUMPTIONS.frequency, "annual");
  assert.equal(ANNUAL_EXPECTED_RETURNS.length, 6);
  assert.equal(ANNUAL_COVARIANCE.length, 6);
  assert.ok(isPositiveDefinite(ANNUAL_COVARIANCE));

  for (let i = 0; i < 6; i += 1) {
    assert.ok(Math.abs(Math.sqrt(ANNUAL_COVARIANCE[i][i]) - THAI_ASSET_ASSUMPTIONS.volatilities[i]) < 1e-12);
  }
});

test("portfolioMetrics uses annual return and covariance math", () => {
  const weights = [0.25, 0.75];
  const expectedReturns = [0.04, 0.08];
  const covariance = [
    [0.01, 0.002],
    [0.002, 0.04],
  ];
  const metrics = portfolioMetrics(weights, expectedReturns, covariance, 0.02);

  assert.ok(Math.abs(metrics.expectedReturn - 0.07) < 1e-12);
  const expectedVariance = 0.25 ** 2 * 0.01
    + 2 * 0.25 * 0.75 * 0.002
    + 0.75 ** 2 * 0.04;
  assert.ok(Math.abs(metrics.variance - expectedVariance) < 1e-12);
  assert.ok(Math.abs(metrics.volatility - Math.sqrt(expectedVariance)) < 1e-12);
  assert.ok(Math.abs(metrics.sharpeRatio - (0.07 - 0.02) / Math.sqrt(expectedVariance)) < 1e-12);
});

test("target-return solver finds the exact long-only active face", () => {
  const expectedReturns = [0, 1, 2];
  const covariance = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  // The unconstrained all-asset solution at target 1.8 has a negative first
  // weight. Exact long-only enumeration therefore selects the {1,2} face.
  const solution = solveTargetReturn(expectedReturns, covariance, 1.8);
  assertLongOnlyBudget(solution.weights);
  assert.ok(Math.abs(solution.expectedReturn - 1.8) < EPSILON);
  assert.ok(Math.abs(solution.weights[0]) < EPSILON);
  assert.ok(Math.abs(solution.weights[1] - 0.2) < EPSILON);
  assert.ok(Math.abs(solution.weights[2] - 0.8) < EPSILON);
  assert.deepEqual(solution.activeSet, [1, 2]);
  assert.ok(Math.abs(solution.variance - 0.68) < EPSILON);
});

test("minimum variance and every efficient-frontier point are feasible", () => {
  const minimumVariance = solveMinimumVariance(ANNUAL_EXPECTED_RETURNS, ANNUAL_COVARIANCE);
  assertLongOnlyBudget(minimumVariance.weights);

  const frontier = buildEfficientFrontier(ANNUAL_EXPECTED_RETURNS, ANNUAL_COVARIANCE, {
    pointCount: 25,
    riskFreeRate: 0.018,
  });
  assert.equal(frontier.points.length, 25);
  assert.ok(Math.abs(frontier.points[0].expectedReturn - minimumVariance.expectedReturn) < EPSILON);
  assert.ok(Math.abs(frontier.points.at(-1).expectedReturn - Math.max(...ANNUAL_EXPECTED_RETURNS)) < EPSILON);

  let priorReturn = -Infinity;
  let priorVolatility = -Infinity;
  for (const point of frontier.points) {
    assertLongOnlyBudget(point.weights);
    assert.ok(Math.abs(point.expectedReturn - point.targetReturn) < 1e-8);
    assert.ok(point.expectedReturn >= priorReturn - EPSILON, "frontier returns must be ordered");
    assert.ok(point.volatility >= priorVolatility - EPSILON, "upper-frontier risk must be non-decreasing");
    priorReturn = point.expectedReturn;
    priorVolatility = point.volatility;
  }
});

test("random cloud is deterministic and stays on the long-only simplex", () => {
  const options = { count: 40, seed: 1441, riskFreeRate: 0.018 };
  const first = generateRandomCloud(ANNUAL_EXPECTED_RETURNS, ANNUAL_COVARIANCE, options);
  const second = generateRandomCloud(ANNUAL_EXPECTED_RETURNS, ANNUAL_COVARIANCE, options);
  const different = generateRandomCloud(ANNUAL_EXPECTED_RETURNS, ANNUAL_COVARIANCE, {
    ...options,
    seed: 1442,
  });

  assert.deepEqual(first, second);
  assert.notDeepEqual(first[0].weights, different[0].weights);
  for (const point of first) {
    assertLongOnlyBudget(point.weights);
    const recomputed = portfolioMetrics(
      point.weights,
      ANNUAL_EXPECTED_RETURNS,
      ANNUAL_COVARIANCE,
      options.riskFreeRate
    );
    assert.ok(Math.abs(point.expectedReturn - recomputed.expectedReturn) < 1e-12);
    assert.ok(Math.abs(point.volatility - recomputed.volatility) < 1e-12);
  }
});

test("exact upper frontier weakly dominates feasible random portfolios at the same return", () => {
  const minimum = solveMinimumVariance(ANNUAL_EXPECTED_RETURNS, ANNUAL_COVARIANCE);
  const cloud = generateRandomCloud(ANNUAL_EXPECTED_RETURNS, ANNUAL_COVARIANCE, { count: 120, seed: 20260715 });
  for (const portfolio of cloud.filter((point) => point.expectedReturn >= minimum.expectedReturn - 1e-10)) {
    const frontierPoint = solveTargetReturn(
      ANNUAL_EXPECTED_RETURNS,
      ANNUAL_COVARIANCE,
      portfolio.expectedReturn
    );
    assert.ok(
      frontierPoint.volatility <= portfolio.volatility + 1e-9,
      `frontier vol ${frontierPoint.volatility} exceeds feasible vol ${portfolio.volatility}`
    );
  }
});

test("invalid covariance and infeasible target return fail clearly", () => {
  assert.equal(isPositiveDefinite([[1, 2], [2, 1]]), false);
  assert.throws(
    () => solveTargetReturn([0.02, 0.05], [[0.01, 0], [0, 0.02]], 0.06),
    /targetReturn must be between/
  );
  assert.throws(
    () => portfolioMetrics([-0.1, 1.1], [0.02, 0.05], [[0.01, 0], [0, 0.02]]),
    /nonnegative/
  );
});
