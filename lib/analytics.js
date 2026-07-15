'use strict';

// Analytics for the technical appendix.  This module deliberately reuses the
// same six-asset capital-market assumptions and stress engine as the RM flow.
// It does not infer historical returns or manufacture a backtest from those
// forward-looking assumptions.

const {
  ASSET_KEYS,
  ASSET_LABELS,
  ANNUAL_EXPECTED_RETURNS,
  ANNUAL_VOLATILITIES,
  CORRELATION_MATRIX,
  ANNUAL_COVARIANCE,
  portfolioMetrics,
} = require('./frontier');
const {
  normalizeWeights,
  weightsToArray,
  simulateGoal,
  runStress,
} = require('./stress');
const { SCENARIOS } = require('./case-data');

const RISK_FREE_RATE = 0.018;
const TRADING_DAYS_PER_YEAR = 252;
const NORMAL_95_Z = 1.6448536269514722;
const NORMAL_95_DENSITY = Math.exp(-0.5 * NORMAL_95_Z ** 2) / Math.sqrt(2 * Math.PI);

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function matrixVector(matrix, vector) {
  return matrix.map((row) => row.reduce(
    (total, covariance, index) => total + covariance * vector[index],
    0
  ));
}

function weightsObject(weights) {
  const normalized = normalizeWeights(weights);
  return Object.fromEntries(ASSET_KEYS.map((key) => [key, normalized[key]]));
}

// Normal-parametric one-day risk.  The loss variable is L = -R, therefore a
// positive number denotes a loss.  These figures are not a fat-tail model;
// the named scenario engine below is the separate tail-risk view.
function normalOneDayRisk(metrics, aum) {
  const dailyMean = metrics.expectedReturn / TRADING_DAYS_PER_YEAR;
  const dailyVolatility = metrics.volatility / Math.sqrt(TRADING_DAYS_PER_YEAR);
  const valueAtRisk = NORMAL_95_Z * dailyVolatility - dailyMean;
  const expectedShortfall = (
    dailyVolatility * NORMAL_95_DENSITY / (1 - 0.95)
  ) - dailyMean;

  return {
    label: 'Parametric Normal 1-day VaR / ES (95%)',
    method: 'normal-parametric',
    confidenceLevel: 0.95,
    horizonTradingDays: 1,
    annualizationConvention: `${TRADING_DAYS_PER_YEAR} trading days; annual mean / 252; annual volatility / sqrt(252)`,
    lossSignConvention: 'positive = loss; negative = gain at the stated quantile',
    dailyMeanReturn: dailyMean,
    dailyVolatility,
    valueAtRisk95Rate: valueAtRisk,
    expectedShortfall95Rate: expectedShortfall,
    valueAtRisk95Baht: valueAtRisk * aum,
    expectedShortfall95Baht: expectedShortfall * aum,
    limitation: 'Normal-parametric diagnostic only; it does not capture jumps, skewness, liquidity stress, or fat tails. Use the named scenario comparison for those risks.',
  };
}

// Euler decomposition for sigma = sqrt(w' Sigma w):
// component variance_i = w_i (Sigma w)_i, which sums to variance;
// component volatility_i = component variance_i / sigma, which sums to sigma.
function riskContributionAnalytics(weightsArray, metrics) {
  const marginalVariance = matrixVector(ANNUAL_COVARIANCE, weightsArray);
  const componentVariance = weightsArray.map(
    (weight, index) => weight * marginalVariance[index]
  );
  const componentVolatility = componentVariance.map(
    (value) => (metrics.volatility > 0 ? value / metrics.volatility : 0)
  );
  const varianceShares = componentVariance.map(
    (value) => (metrics.variance > 0 ? value / metrics.variance : 0)
  );

  const assets = ASSET_KEYS.map((key, index) => ({
    key,
    label: ASSET_LABELS[index],
    weight: weightsArray[index],
    marginalVariance: marginalVariance[index],
    componentVariance: componentVariance[index],
    componentVolatility: componentVolatility[index],
    varianceShare: varianceShares[index],
  }));
  const summedVariance = sum(componentVariance);
  const summedVolatility = sum(componentVolatility);

  return {
    method: 'Euler decomposition of annual portfolio volatility',
    formula: 'RC_variance_i = w_i*(Sigma*w)_i; RC_volatility_i = RC_variance_i/sigma_p',
    signNote: 'A negative contribution is possible when an asset hedges the rest of the portfolio; contributions are not standalone volatilities.',
    assets,
    totals: {
      portfolioVariance: metrics.variance,
      summedComponentVariance: summedVariance,
      varianceReconciliationError: summedVariance - metrics.variance,
      portfolioVolatility: metrics.volatility,
      summedComponentVolatility: summedVolatility,
      volatilityReconciliationError: summedVolatility - metrics.volatility,
      summedVarianceShare: sum(varianceShares),
    },
  };
}

function portfolioAnalytics(weights, aum) {
  const normalized = weightsObject(weights);
  const weightsArray = weightsToArray(normalized);
  const metrics = portfolioMetrics(
    weightsArray,
    ANNUAL_EXPECTED_RETURNS,
    ANNUAL_COVARIANCE,
    RISK_FREE_RATE
  );

  return {
    weights: normalized,
    metrics: {
      frequency: 'annual',
      expectedReturn: metrics.expectedReturn,
      variance: metrics.variance,
      volatility: metrics.volatility,
      riskFreeRate: RISK_FREE_RATE,
      sharpeRatio: metrics.sharpeRatio,
      status: 'forward-looking illustrative capital-market assumptions; not realized performance',
    },
    oneDayRisk: normalOneDayRisk(metrics, aum),
    riskContributions: riskContributionAnalytics(weightsArray, metrics),
  };
}

function goalDistribution(projection) {
  return {
    probabilityOfReachingTarget: projection.probability,
    distributionBaht: {
      p05: projection.p05,
      median: projection.median,
      p95: projection.p95,
    },
    paths: projection.paths,
    startCapital: projection.startCapital,
    currentCapital: projection.currentCapital,
    annualContribution: projection.annualContribution,
    assumedAnnualExpectedReturn: projection.expectedReturn,
    assumedAnnualVolatility: projection.volatility,
  };
}

function scenarioAnalytics(client, scenario, modelWeights, modelGoalWeights) {
  // runStress is the canonical scenario implementation used by the RM flow;
  // keeping this call here prevents the appendix from silently using different
  // shocks or goal mathematics.
  const result = runStress(client, scenario, modelWeights, modelGoalWeights);
  return {
    id: result.scenario.id,
    name: result.scenario.name,
    plainName: result.scenario.plainName,
    horizon: result.scenario.horizon,
    narrative: result.scenario.narrative,
    calibration: result.scenario.calibration,
    currentPortfolio: {
      shockReturn: result.current.shockReturn,
      lossBaht: result.current.lossBaht,
      valueAfterShock: result.current.valueAfterShock,
      goal: goalDistribution(result.current.goal),
    },
    approvedModel: {
      shockReturn: result.approvedModel.shockReturn,
      lossBaht: result.approvedModel.lossBaht,
      valueAfterShock: result.approvedModel.valueAfterShock,
      goal: goalDistribution(result.approvedModel.goal),
    },
    signedComparison: {
      modelMinusCurrentShockReturn: result.approvedModel.shockReturn - result.current.shockReturn,
      lossReductionBaht: result.current.lossBaht - result.approvedModel.lossBaht,
      modelMinusCurrentGoalProbability: result.approvedModel.goal.probability - result.current.goal.probability,
    },
    candidatePartialAdjustment: {
      name: result.candidate.name,
      weights: cloneJson(result.candidate.weights),
      shockReturn: result.candidate.shockReturn,
      lossBaht: result.candidate.lossBaht,
      lossImprovementBaht: result.candidate.lossImprovementBaht,
      goalProbabilityChange: result.candidate.goalProbabilityChange,
      recommendedForScenario: result.candidate.recommendedForScenario,
      trades: cloneJson(result.candidate.trades),
    },
    response: cloneJson(result.response),
    probabilityDropFromUnshockedBase: result.probabilityDrop,
    tradeoff: result.tradeoff,
    assetShocks: cloneJson(result.shocks),
    methodology: result.methodology,
  };
}

function adviceGate(client) {
  if (client.mandatory) {
    return {
      recommendationUsable: false,
      reason: 'Service-recovery case: analytics may support monitoring, but product advice and cross-sell are blocked.',
    };
  }
  if (!client.dataReady || !client.profileFresh || client.goalReady === false) {
    return {
      recommendationUsable: false,
      reason: 'Client, suitability, or goal inputs are not confirmed; outputs are diagnostic only until the data gate passes.',
    };
  }
  return {
    recommendationUsable: true,
    reason: 'Input gate passes for case-study analytics; RM and client approval are still required before any action.',
  };
}

function buildClientAnalytics(client, model) {
  if (!client || typeof client !== 'object') throw new TypeError('client is required');
  if (!model || typeof model !== 'object' || !model.weights) throw new TypeError('model.weights is required');
  const aum = finiteNumber(client.aum, NaN);
  if (!(aum > 0)) throw new RangeError('client.aum must be a positive finite number');

  const current = portfolioAnalytics(client.portfolio, aum);
  const approvedModel = portfolioAnalytics(model.weights, aum);
  const currentBaseGoal = simulateGoal(client, current.weights, 0);
  const modelGoalWeights = model.goalWeights || approvedModel.weights;
  const modelBaseGoal = simulateGoal(client, modelGoalWeights, 0);
  const scenarios = Object.values(SCENARIOS).map(
    (scenario) => scenarioAnalytics(client, scenario, approvedModel.weights, modelGoalWeights)
  );

  return {
    client: {
      id: client.id,
      name: client.name,
      segment: client.segment,
      aum,
      riskLevel: client.riskLevel,
      goal: cloneJson(client.goal),
    },
    model: {
      id: model.id || null,
      name: model.name || 'Case-study comparison model',
      riskRange: model.riskRange || null,
    },
    adviceGate: adviceGate(client),
    assumptions: {
      frequency: 'annual decimal return/volatility',
      assetKeys: [...ASSET_KEYS],
      assetLabels: [...ASSET_LABELS],
      expectedReturns: [...ANNUAL_EXPECTED_RETURNS],
      volatilities: [...ANNUAL_VOLATILITIES],
      covariance: ANNUAL_COVARIANCE.map((row) => [...row]),
      status: 'Illustrative, version-controlled capital-market assumptions; production use requires organization approval.',
    },
    portfolios: {
      current,
      approvedModel,
      signedChange: {
        expectedReturn: approvedModel.metrics.expectedReturn - current.metrics.expectedReturn,
        volatility: approvedModel.metrics.volatility - current.metrics.volatility,
        valueAtRisk95Baht: approvedModel.oneDayRisk.valueAtRisk95Baht - current.oneDayRisk.valueAtRisk95Baht,
        expectedShortfall95Baht: approvedModel.oneDayRisk.expectedShortfall95Baht - current.oneDayRisk.expectedShortfall95Baht,
      },
    },
    correlation: {
      dimension: [ASSET_KEYS.length, ASSET_KEYS.length],
      assetKeys: [...ASSET_KEYS],
      assetLabels: [...ASSET_LABELS],
      matrix: CORRELATION_MATRIX.map((row) => [...row]),
      source: 'Same fixed six-asset assumptions used by the frontier and stress engines.',
    },
    goalProjection: {
      targetBaht: finiteNumber(client.goal && client.goal.target),
      horizonYears: finiteNumber(client.goal && client.goal.years),
      currentPortfolioBase: goalDistribution(currentBaseGoal),
      approvedModelBase: goalDistribution(modelBaseGoal),
      method: 'Seeded 5,000-path monthly lognormal projection. The current case uses the current portfolio because holdings are not goal-tagged; the comparison uses the declared goal-bucket weights. This is a projection, not a historical backtest.',
      caveat: 'Percentiles and success probability depend on the stated goal inputs and illustrative capital-market assumptions.',
    },
    scenarioComparison: scenarios,
    historicalBacktest: {
      included: false,
      reason: 'No verified time series was supplied. Forward-looking assumptions and scenario shocks cannot be relabeled as historical performance.',
    },
  };
}

function countBy(items, selector) {
  const counts = {};
  for (const item of items) {
    const key = String(selector(item) || 'ไม่ระบุ');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function summarizeBy(items, selector) {
  const groups = {};
  for (const item of items) {
    const key = String(selector(item) || 'ไม่ระบุ');
    if (!groups[key]) groups[key] = { count: 0, estimatedMinutes: 0, aumBaht: 0 };
    groups[key].count += 1;
    groups[key].estimatedMinutes += Math.max(0, finiteNumber(item.callMinutes));
    groups[key].aumBaht += Math.max(0, finiteNumber(item.aum));
  }
  return groups;
}

function dueBucket(client) {
  const due = String(client.due || '');
  if (client.mandatory) return { rank: 0, label: 'mandatory / SLA' };
  if (due.includes('วันนี้') || due.includes('24 ชั่วโมง')) return { rank: 1, label: 'today / 24 hours' };
  if (due.includes('3 วัน')) return { rank: 2, label: 'within 3 days' };
  if (due.includes('5 วัน')) return { rank: 3, label: 'within 5 days' };
  if (due.includes('7 วัน')) return { rank: 4, label: 'within 7 days' };
  if (due.includes('ก่อนให้คำแนะนำ')) return { rank: 5, label: 'before advice' };
  return { rank: 6, label: due || 'unspecified' };
}

function clientBenefitRank(client) {
  if (client.mandatory || client.clientBenefit === 'mandatory') return 0;
  return ({ high: 1, medium: 2, low: 3 }[client.clientBenefit] ?? 4);
}

function channelRank(client) {
  return ({ call: 0, confirm: 1, message: 2 }[client.channel] ?? 3);
}

function transparentQueue(clients) {
  const ranked = clients.map((client, originalIndex) => ({ client, originalIndex }));
  ranked.sort((a, b) => {
    const benefitDifference = clientBenefitRank(a.client) - clientBenefitRank(b.client);
    if (benefitDifference) return benefitDifference;
    const dueDifference = dueBucket(a.client).rank - dueBucket(b.client).rank;
    if (dueDifference) return dueDifference;
    const channelDifference = channelRank(a.client) - channelRank(b.client);
    if (channelDifference) return channelDifference;
    const aumDifference = finiteNumber(b.client.aum) - finiteNumber(a.client.aum);
    return aumDifference || a.originalIndex - b.originalIndex;
  });

  return ranked.map(({ client }, index) => ({
    position: index + 1,
    clientId: client.id,
    clientName: client.name,
    mandatory: Boolean(client.mandatory),
    clientBenefit: client.clientBenefit || null,
    due: client.due || null,
    dueBucket: dueBucket(client).label,
    channel: client.channel || null,
    estimatedMinutes: Math.max(0, finiteNumber(client.callMinutes)),
    aumBaht: Math.max(0, finiteNumber(client.aum)),
    businessPotential: client.businessPotential || null,
    reason: client.reason || null,
    rankInputs: {
      clientBenefitRank: clientBenefitRank(client),
      dueRank: dueBucket(client).rank,
      channelRank: channelRank(client),
      aumUsedOnlyAsFinalTieBreak: true,
    },
  }));
}

function buildBusinessAnalytics(clients, followups) {
  if (!Array.isArray(clients)) throw new TypeError('clients must be an array');
  if (!Array.isArray(followups)) throw new TypeError('followups must be an array');
  const safeClients = clients.filter((client) => client && typeof client === 'object');
  const safeFollowups = followups.filter((item) => item && typeof item === 'object');
  const todayClients = safeClients.filter((client) => dueBucket(client).rank <= 1);
  const queue = transparentQueue(safeClients);
  const totalMinutes = sum(safeClients.map(
    (client) => Math.max(0, finiteNumber(client.callMinutes))
  ));
  const todayMinutes = sum(todayClients.map(
    (client) => Math.max(0, finiteNumber(client.callMinutes))
  ));

  return {
    queuePolicy: {
      type: 'deterministic lexicographic ordering; no opaque ML score',
      rulesInOrder: [
        '1. mandatory duty / client-benefit class',
        '2. stated due window or SLA',
        '3. channel requiring scarce RM attention',
        '4. AUM as final tie-break only',
      ],
      ethicsGuardrail: 'AUM cannot jump a complaint/SLA duty or a higher client-benefit class. Revenue is not estimated without margin and conversion inputs.',
    },
    headline: {
      clientCount: safeClients.length,
      totalAumBaht: sum(safeClients.map((client) => Math.max(0, finiteNumber(client.aum)))),
      estimatedQueueMinutes: totalMinutes,
      dueTodayOrSlaCount: todayClients.length,
      dueTodayOrSlaMinutes: todayMinutes,
      dueTodayOrSlaAumBaht: sum(todayClients.map((client) => Math.max(0, finiteNumber(client.aum)))),
      followupCount: safeFollowups.length,
    },
    queue,
    workload: {
      byChannel: summarizeBy(safeClients, (client) => client.channel),
      byLane: summarizeBy(safeClients, (client) => client.lane),
      bySegment: summarizeBy(safeClients, (client) => client.segment),
      byClientBenefit: summarizeBy(safeClients, (client) => client.clientBenefit),
      byBusinessPotential: summarizeBy(safeClients, (client) => client.businessPotential),
    },
    capacity: {
      requiredQueueMinutes: totalMinutes,
      requiredTodayOrSlaMinutes: todayMinutes,
      availableRmMinutes: null,
      rmHeadcount: null,
      utilizationRate: null,
      status: 'Capacity utilization cannot be calculated because staffed RM minutes and headcount were not supplied.',
      whatIsNeeded: ['RM headcount', 'available client-contact minutes per RM', 'task-level handling-time baseline'],
    },
    channelMix: {
      counts: countBy(safeClients, (client) => client.channel),
      humanCallCount: safeClients.filter((client) => client.channel === 'call').length,
      assistedMessageCount: safeClients.filter((client) => client.channel === 'message').length,
      dataConfirmationCount: safeClients.filter((client) => client.channel === 'confirm').length,
      claimedTimeSavingMinutes: null,
      note: 'The queue shows routing opportunity only. Time savings require an observed before/after baseline.',
    },
    followups: {
      total: safeFollowups.length,
      byStatus: countBy(safeFollowups, (item) => item.status),
      byOwner: countBy(safeFollowups, (item) => item.owner),
      items: cloneJson(safeFollowups),
    },
    businessValue: {
      aumInQueueBaht: sum(safeClients.map((client) => Math.max(0, finiteNumber(client.aum)))),
      aumByPotential: Object.fromEntries(Object.entries(
        summarizeBy(safeClients, (client) => client.businessPotential)
      ).map(([key, value]) => [key, value.aumBaht])),
      revenueEstimateBaht: null,
      conversionEstimate: null,
      note: 'AUM is relationship context, not revenue. Product margin, eligibility, consent, conversion, and incremental-control-group data are required for a defensible value estimate.',
    },
  };
}

module.exports = { adviceGate, buildClientAnalytics, buildBusinessAnalytics };
