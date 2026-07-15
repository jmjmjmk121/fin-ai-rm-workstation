"use strict";

// Annual, illustrative capital-market assumptions for the six Thai asset buckets
// used by the RM workbench. They are deliberately separated from live fund data:
// a production bank should approve/version these assumptions before using them in
// advice. Returns and covariance entries are decimal annual rates (0.07 = 7%).

const ASSET_KEYS = Object.freeze([
  "cash",
  "thaiGovBond",
  "thaiCorpBond",
  "thaiEquityCore",
  "thaiEquityDividend",
  "thaiReit",
]);

const ASSET_LABELS = Object.freeze([
  "เงินสดและกองทุนตลาดเงินไทย",
  "พันธบัตรรัฐบาลไทย",
  "หุ้นกู้ไทย Investment Grade",
  "หุ้นไทย Core Equity",
  "หุ้นไทย Dividend Equity",
  "Thai REIT & Infrastructure",
]);

const ANNUAL_EXPECTED_RETURNS = Object.freeze([
  0.018,
  0.028,
  0.038,
  0.073,
  0.066,
  0.061,
]);

const ANNUAL_VOLATILITIES = Object.freeze([
  0.009,
  0.045,
  0.060,
  0.190,
  0.170,
  0.160,
]);

const CORRELATION_MATRIX = Object.freeze([
  Object.freeze([1.00, 0.10, 0.08, 0.02, 0.03, 0.02]),
  Object.freeze([0.10, 1.00, 0.55, -0.05, 0.00, 0.10]),
  Object.freeze([0.08, 0.55, 1.00, 0.15, 0.18, 0.20]),
  Object.freeze([0.02, -0.05, 0.15, 1.00, 0.80, 0.55]),
  Object.freeze([0.03, 0.00, 0.18, 0.80, 1.00, 0.60]),
  Object.freeze([0.02, 0.10, 0.20, 0.55, 0.60, 1.00]),
]);

const ANNUAL_COVARIANCE = Object.freeze(
  CORRELATION_MATRIX.map((row, i) => Object.freeze(
    row.map((correlation, j) =>
      correlation * ANNUAL_VOLATILITIES[i] * ANNUAL_VOLATILITIES[j]
    )
  ))
);

const THAI_ASSET_ASSUMPTIONS = Object.freeze({
  frequency: "annual",
  assetKeys: ASSET_KEYS,
  assetLabels: ASSET_LABELS,
  expectedReturns: ANNUAL_EXPECTED_RETURNS,
  volatilities: ANNUAL_VOLATILITIES,
  correlations: CORRELATION_MATRIX,
  covariance: ANNUAL_COVARIANCE,
});

const DEFAULT_TOLERANCE = 1e-10;
const MAX_ENUMERATED_ASSETS = 20;

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
}

function validateMarketAssumptions(expectedReturns, covariance) {
  if (!Array.isArray(expectedReturns) || expectedReturns.length === 0) {
    throw new TypeError("expectedReturns must be a non-empty array");
  }
  if (expectedReturns.length > MAX_ENUMERATED_ASSETS) {
    throw new RangeError(`exact active-set enumeration supports at most ${MAX_ENUMERATED_ASSETS} assets`);
  }
  expectedReturns.forEach((value, i) => assertFiniteNumber(value, `expectedReturns[${i}]`));

  const n = expectedReturns.length;
  if (!Array.isArray(covariance) || covariance.length !== n) {
    throw new TypeError("covariance must be a square matrix matching expectedReturns");
  }
  for (let i = 0; i < n; i += 1) {
    if (!Array.isArray(covariance[i]) || covariance[i].length !== n) {
      throw new TypeError("covariance must be a square matrix matching expectedReturns");
    }
    for (let j = 0; j < n; j += 1) {
      assertFiniteNumber(covariance[i][j], `covariance[${i}][${j}]`);
      const scale = Math.max(1, Math.abs(covariance[i][j]), Math.abs(covariance[j][i]));
      if (Math.abs(covariance[i][j] - covariance[j][i]) > 1e-12 * scale) {
        throw new RangeError("covariance must be symmetric");
      }
    }
  }
  choleskyDecomposition(covariance);
  return n;
}

// Cholesky both verifies positive definiteness and gives a stable linear solver.
function choleskyDecomposition(matrix, tolerance = 1e-14) {
  const n = matrix.length;
  const lower = Array.from({ length: n }, () => new Array(n).fill(0));
  let largestDiagonal = 0;
  for (let i = 0; i < n; i += 1) largestDiagonal = Math.max(largestDiagonal, Math.abs(matrix[i][i]));
  const threshold = tolerance * Math.max(1, largestDiagonal);

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let value = matrix[i][j];
      for (let k = 0; k < j; k += 1) value -= lower[i][k] * lower[j][k];
      if (i === j) {
        if (!(value > threshold)) throw new RangeError("covariance must be positive definite");
        lower[i][j] = Math.sqrt(value);
      } else {
        lower[i][j] = value / lower[j][j];
      }
    }
  }
  return lower;
}

function isPositiveDefinite(matrix) {
  try {
    if (!Array.isArray(matrix) || matrix.length === 0) return false;
    const n = matrix.length;
    if (matrix.some((row) => !Array.isArray(row) || row.length !== n)) return false;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        if (!Number.isFinite(matrix[i][j]) || Math.abs(matrix[i][j] - matrix[j][i]) > 1e-12) return false;
      }
    }
    choleskyDecomposition(matrix);
    return true;
  } catch (_error) {
    return false;
  }
}

function solveFromCholesky(lower, rightHandSide) {
  const n = lower.length;
  const y = new Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let value = rightHandSide[i];
    for (let j = 0; j < i; j += 1) value -= lower[i][j] * y[j];
    y[i] = value / lower[i][i];
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let value = y[i];
    for (let j = i + 1; j < n; j += 1) value -= lower[j][i] * x[j];
    x[i] = value / lower[i][i];
  }
  return x;
}

function dot(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += a[i] * b[i];
  return total;
}

function rawPortfolioMetrics(weights, expectedReturns, covariance, riskFreeRate) {
  const expectedReturn = dot(weights, expectedReturns);
  let variance = 0;
  for (let i = 0; i < weights.length; i += 1) {
    for (let j = 0; j < weights.length; j += 1) {
      variance += weights[i] * covariance[i][j] * weights[j];
    }
  }
  variance = Math.max(0, variance);
  const volatility = Math.sqrt(variance);
  return {
    expectedReturn,
    variance,
    volatility,
    sharpeRatio: volatility > 0 ? (expectedReturn - riskFreeRate) / volatility : null,
  };
}

function assertLongOnlyWeights(weights, n, tolerance = DEFAULT_TOLERANCE) {
  if (!Array.isArray(weights) || weights.length !== n) {
    throw new TypeError("weights must match the number of assets");
  }
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    assertFiniteNumber(weights[i], `weights[${i}]`);
    if (weights[i] < -tolerance) throw new RangeError("weights must be nonnegative (long-only)");
    total += weights[i];
  }
  if (Math.abs(total - 1) > tolerance) throw new RangeError("weights must sum to 1");
}

function portfolioMetrics(weights, expectedReturns, covariance, riskFreeRate = 0) {
  const n = validateMarketAssumptions(expectedReturns, covariance);
  assertFiniteNumber(riskFreeRate, "riskFreeRate");
  assertLongOnlyWeights(weights, n);
  return rawPortfolioMetrics(weights, expectedReturns, covariance, riskFreeRate);
}

function subsetIndices(mask, n) {
  const indices = [];
  for (let i = 0; i < n; i += 1) if ((mask & (1 << i)) !== 0) indices.push(i);
  return indices;
}

function subsetMatrix(matrix, indices) {
  return indices.map((i) => indices.map((j) => matrix[i][j]));
}

function cleanAndExpandWeights(subsetWeights, indices, n, tolerance) {
  const cleaned = subsetWeights.map((weight) => {
    if (weight < -tolerance) return null;
    return Math.abs(weight) <= tolerance ? 0 : weight;
  });
  if (cleaned.some((weight) => weight === null)) return null;

  const total = cleaned.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) return null;
  const full = new Array(n).fill(0);
  for (let i = 0; i < indices.length; i += 1) full[indices[i]] = cleaned[i] / total;
  return full;
}

function minimumVarianceOnSubset(covariance, indices, n, tolerance) {
  if (indices.length === 1) {
    const weights = new Array(n).fill(0);
    weights[indices[0]] = 1;
    return weights;
  }

  const subCovariance = subsetMatrix(covariance, indices);
  const lower = choleskyDecomposition(subCovariance);
  const ones = new Array(indices.length).fill(1);
  const inverseTimesOne = solveFromCholesky(lower, ones);
  const a = dot(ones, inverseTimesOne);
  if (!(a > 0)) return null;
  return cleanAndExpandWeights(inverseTimesOne.map((value) => value / a), indices, n, tolerance);
}

// On an active subset S, the exact equality-constrained Markowitz solution is
// w = Sigma^-1(lambda*1 + gamma*mu), where
// lambda=(C-B*r)/(A*C-B^2), gamma=(A*r-B)/(A*C-B^2).
function targetReturnOnSubset(expectedReturns, covariance, targetReturn, indices, tolerance) {
  if (indices.length === 1) {
    if (Math.abs(expectedReturns[indices[0]] - targetReturn) > tolerance) return null;
    const weights = new Array(expectedReturns.length).fill(0);
    weights[indices[0]] = 1;
    return weights;
  }

  const subReturns = indices.map((i) => expectedReturns[i]);
  const subCovariance = subsetMatrix(covariance, indices);
  const lower = choleskyDecomposition(subCovariance);
  const ones = new Array(indices.length).fill(1);
  const inverseTimesOne = solveFromCholesky(lower, ones);
  const inverseTimesReturn = solveFromCholesky(lower, subReturns);
  const a = dot(ones, inverseTimesOne);
  const b = dot(ones, inverseTimesReturn);
  const c = dot(subReturns, inverseTimesReturn);
  const determinant = a * c - b * b;
  const determinantScale = Math.max(Number.MIN_VALUE, Math.abs(a * c), Math.abs(b * b));

  if (Math.abs(determinant) <= 1e-12 * determinantScale) {
    const commonReturn = subReturns[0];
    if (subReturns.some((value) => Math.abs(value - commonReturn) > tolerance)) return null;
    if (Math.abs(targetReturn - commonReturn) > tolerance) return null;
    return minimumVarianceOnSubset(covariance, indices, expectedReturns.length, tolerance);
  }

  const lambda = (c - b * targetReturn) / determinant;
  const gamma = (a * targetReturn - b) / determinant;
  const subsetWeights = inverseTimesOne.map((value, i) =>
    lambda * value + gamma * inverseTimesReturn[i]
  );
  return cleanAndExpandWeights(subsetWeights, indices, expectedReturns.length, tolerance);
}

function activeSet(weights, tolerance = 1e-9) {
  const indices = [];
  for (let i = 0; i < weights.length; i += 1) if (weights[i] > tolerance) indices.push(i);
  return indices;
}

function chooseLowerVariance(current, candidate, comparisonTolerance = 1e-14) {
  if (!current || candidate.variance < current.variance - comparisonTolerance) return candidate;
  return current;
}

function solveMinimumVariance(expectedReturns, covariance, options = {}) {
  const n = validateMarketAssumptions(expectedReturns, covariance);
  const tolerance = options.tolerance == null ? DEFAULT_TOLERANCE : options.tolerance;
  const riskFreeRate = options.riskFreeRate == null ? 0 : options.riskFreeRate;
  assertFiniteNumber(tolerance, "tolerance");
  assertFiniteNumber(riskFreeRate, "riskFreeRate");
  if (!(tolerance > 0)) throw new RangeError("tolerance must be positive");

  let best = null;
  const subsetCount = 2 ** n;
  for (let mask = 1; mask < subsetCount; mask += 1) {
    const indices = subsetIndices(mask, n);
    const weights = minimumVarianceOnSubset(covariance, indices, n, tolerance);
    if (!weights) continue;
    const metrics = rawPortfolioMetrics(weights, expectedReturns, covariance, riskFreeRate);
    best = chooseLowerVariance(best, {
      weights,
      ...metrics,
      activeSet: activeSet(weights),
    });
  }
  if (!best) throw new Error("no feasible long-only minimum-variance portfolio found");
  return best;
}

function solveTargetReturn(expectedReturns, covariance, targetReturn, options = {}) {
  const n = validateMarketAssumptions(expectedReturns, covariance);
  assertFiniteNumber(targetReturn, "targetReturn");
  const tolerance = options.tolerance == null ? DEFAULT_TOLERANCE : options.tolerance;
  const riskFreeRate = options.riskFreeRate == null ? 0 : options.riskFreeRate;
  assertFiniteNumber(tolerance, "tolerance");
  assertFiniteNumber(riskFreeRate, "riskFreeRate");
  if (!(tolerance > 0)) throw new RangeError("tolerance must be positive");

  const minReturn = Math.min(...expectedReturns);
  const maxReturn = Math.max(...expectedReturns);
  if (targetReturn < minReturn - tolerance || targetReturn > maxReturn + tolerance) {
    throw new RangeError(`targetReturn must be between ${minReturn} and ${maxReturn}`);
  }

  let best = null;
  const subsetCount = 2 ** n;
  for (let mask = 1; mask < subsetCount; mask += 1) {
    const indices = subsetIndices(mask, n);
    const weights = targetReturnOnSubset(
      expectedReturns,
      covariance,
      targetReturn,
      indices,
      tolerance
    );
    if (!weights) continue;

    const metrics = rawPortfolioMetrics(weights, expectedReturns, covariance, riskFreeRate);
    if (Math.abs(metrics.expectedReturn - targetReturn) > Math.max(1e-8, tolerance * 10)) continue;
    best = chooseLowerVariance(best, {
      targetReturn,
      weights,
      ...metrics,
      activeSet: activeSet(weights),
    });
  }
  if (!best) throw new Error("no feasible long-only portfolio found for targetReturn");
  return best;
}

function buildEfficientFrontier(expectedReturns, covariance, options = {}) {
  validateMarketAssumptions(expectedReturns, covariance);
  const pointCount = options.pointCount == null ? 41 : options.pointCount;
  const riskFreeRate = options.riskFreeRate == null ? 0 : options.riskFreeRate;
  if (!Number.isInteger(pointCount) || pointCount < 2) {
    throw new RangeError("pointCount must be an integer of at least 2");
  }
  assertFiniteNumber(riskFreeRate, "riskFreeRate");

  const globalMinimumVariance = solveMinimumVariance(expectedReturns, covariance, options);
  const startReturn = globalMinimumVariance.expectedReturn;
  const endReturn = Math.max(...expectedReturns);
  if (Math.abs(endReturn - startReturn) <= 1e-12) {
    return { globalMinimumVariance, points: [{ ...globalMinimumVariance, targetReturn: startReturn }] };
  }

  const points = [];
  for (let i = 0; i < pointCount; i += 1) {
    const targetReturn = i === pointCount - 1
      ? endReturn
      : startReturn + (endReturn - startReturn) * (i / (pointCount - 1));
    points.push(solveTargetReturn(expectedReturns, covariance, targetReturn, {
      ...options,
      riskFreeRate,
    }));
  }
  return { globalMinimumVariance, points };
}

function seededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function generateRandomCloud(expectedReturns, covariance, options = {}) {
  const n = validateMarketAssumptions(expectedReturns, covariance);
  const count = options.count == null ? 1000 : options.count;
  const seed = options.seed == null ? 20260715 : options.seed;
  const riskFreeRate = options.riskFreeRate == null ? 0 : options.riskFreeRate;
  if (!Number.isInteger(count) || count < 1) throw new RangeError("count must be a positive integer");
  assertFiniteNumber(Number(seed), "seed");
  assertFiniteNumber(riskFreeRate, "riskFreeRate");

  const random = seededRandom(seed);
  const cloud = [];
  for (let sample = 0; sample < count; sample += 1) {
    // Independent exponential draws normalized by their sum produce a uniform
    // Dirichlet(1,...,1) draw over the long-only simplex.
    const draws = new Array(n);
    let total = 0;
    for (let i = 0; i < n; i += 1) {
      draws[i] = -Math.log(Math.max(random(), 1e-15));
      total += draws[i];
    }
    const weights = draws.map((value) => value / total);
    cloud.push({
      weights,
      ...rawPortfolioMetrics(weights, expectedReturns, covariance, riskFreeRate),
    });
  }
  return cloud;
}

module.exports = {
  ASSET_KEYS,
  ASSET_LABELS,
  ANNUAL_EXPECTED_RETURNS,
  ANNUAL_VOLATILITIES,
  CORRELATION_MATRIX,
  ANNUAL_COVARIANCE,
  THAI_ASSET_ASSUMPTIONS,
  validateMarketAssumptions,
  isPositiveDefinite,
  portfolioMetrics,
  solveMinimumVariance,
  solveTargetReturn,
  buildEfficientFrontier,
  generateRandomCloud,
};
