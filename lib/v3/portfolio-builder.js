'use strict';

const crypto = require('crypto');
const {
  calculateCovarianceAndCorrelation,
  calculatePerformance,
  calculateEffectiveHoldings,
} = require('./quant');
const { buildEfficientFrontier } = require('../frontier');

const ALLOWED_INITIAL_TYPES = Object.freeze(['ETF', 'UT', 'CS', 'DR']);
const MAX_BUILDER_ASSETS = 12;
const MIN_COMMON_OBSERVATIONS = 20;
const MAX_POSITION_WEIGHT = 0.35;

function builderError(code, statusCode = 400, details = {}) {
  return Object.assign(new Error(code), { code, statusCode, ...details });
}

function stableHash(value) {
  return parseInt(crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8), 16) >>> 0;
}

function calculationHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function candidateBuckets(observations) {
  const rows = (Array.isArray(observations) ? observations : [])
    .filter((row) => row && ALLOWED_INITIAL_TYPES.includes(row.securityType))
    .filter((row) => Number.isFinite(Number(row.close)) && Number(row.close) > 0)
    .sort((left, right) => finite(right.totalValue) - finite(left.totalValue) || String(left.symbol).localeCompare(String(right.symbol), 'en'));
  const buckets = Object.fromEntries(ALLOWED_INITIAL_TYPES.map((type) => [type, rows.filter((row) => row.securityType === type)]));
  if (!rows.length) throw builderError('BUILDER_LIVE_UNIVERSE_EMPTY', 503);
  return { rows, buckets };
}

function selectRealAssetRows(clientId, count, observations) {
  const { rows, buckets } = candidateBuckets(observations);
  // Default demo positions use listed equity/ETF instruments with observable
  // traded prices. DR, DW, warrants and listed UT remain searchable, but are not
  // silently seeded into a client portfolio because their history/terms require
  // additional product-readiness review.
  const typePattern = ['ETF', 'CS', 'CS', 'CS', 'CS', 'ETF', 'CS', 'CS', 'CS', 'ETF', 'CS', 'CS'];
  const used = new Set();
  const selected = [];
  const seed = stableHash(clientId);
  for (let index = 0; index < count; index += 1) {
    const requestedType = typePattern[index % typePattern.length];
    const typed = buckets[requestedType] && buckets[requestedType].length ? buckets[requestedType] : rows;
    const pool = requestedType === 'CS' ? typed.slice(0, 250) : typed;
    let cursor = (seed + index * 37) % pool.length;
    let candidate = pool[cursor];
    let attempts = 0;
    while (used.has(candidate.symbol) && attempts < pool.length) {
      cursor = (cursor + 1) % pool.length;
      candidate = pool[cursor];
      attempts += 1;
    }
    if (used.has(candidate.symbol)) {
      candidate = rows.find((row) => !used.has(row.symbol));
    }
    if (!candidate) break;
    used.add(candidate.symbol);
    selected.push(candidate);
  }
  if (selected.length !== count) throw builderError('BUILDER_LIVE_UNIVERSE_INSUFFICIENT', 503);
  return selected;
}

function buildClientListedPortfolio(client, universeResult) {
  if (!client || !client.clientId) throw builderError('BUILDER_CLIENT_INVALID');
  const sourceHoldings = Array.isArray(client.holdings) && client.holdings.length
    ? client.holdings.slice(0, MAX_BUILDER_ASSETS)
    : [{ value: finite(client.aum, 1) }];
  const marketRows = selectRealAssetRows(client.clientId, sourceHoldings.length, universeResult.observations);
  const sourceTotal = sourceHoldings.reduce((sum, holding) => sum + Math.max(0, finite(holding.value)), 0) || 1;
  const holdings = sourceHoldings.map((holding, index) => {
    const row = marketRows[index];
    const value = Math.max(0, finite(holding.value, sourceTotal / sourceHoldings.length));
    const weight = value / sourceTotal;
    return {
      productId: `SETSMART:${row.symbol}`,
      symbol: row.symbol,
      securityType: row.securityType,
      close: row.close,
      quantity: value / row.close,
      marketValue: value,
      currentWeight: weight,
      draftWeight: weight,
      marketAsOf: row.date,
      marketSource: 'SETSMART',
      marketSourceRef: row.source && row.source.sourceRef,
      returnType: row.returnType || 'PRICE_RETURN',
      totalReturnAvailable: row.totalReturnAvailable === true,
      clientHoldingSource: 'DEMO_CLIENT_HOLDINGS',
      clientHoldingLabel: 'สถานะถือครองสาธิต · สินทรัพย์และราคาจาก SETSMART จริง',
    };
  });
  return {
    clientId: client.clientId,
    clientRef: client.clientRef,
    clientName: client.name,
    rmOwner: client.owner,
    primaryGoal: client.primaryGoal,
    portfolioValue: sourceTotal,
    holdingCount: holdings.length,
    holdings,
    marketAsOf: universeResult.marketAsOf,
    marketSource: 'SETSMART',
    clientDataMode: 'DEMO_CLIENT_DATA',
    approvedShelfStatus: 'MISSING_BANK_POLICY',
    suitabilityStatus: 'READ_ONLY_FROM_CLIENT_SNAPSHOT',
  };
}

function buildClientHoldingBook(clients, universeResult) {
  const portfolios = (Array.isArray(clients) ? clients : []).map((client) => buildClientListedPortfolio(client, universeResult));
  return {
    portfolios,
    clientCount: portfolios.length,
    totalPositions: portfolios.reduce((sum, portfolio) => sum + portfolio.holdings.length, 0),
    uniqueSymbols: [...new Set(portfolios.flatMap((portfolio) => portfolio.holdings.map((holding) => holding.symbol)))].sort(),
    marketAsOf: universeResult.marketAsOf,
    marketSource: 'SETSMART',
    clientDataMode: 'DEMO_CLIENT_DATA',
  };
}

function validateDraftHoldings(holdings) {
  if (!Array.isArray(holdings) || holdings.length === 0) throw builderError('BUILDER_HOLDINGS_REQUIRED');
  if (holdings.length > MAX_BUILDER_ASSETS) throw builderError('BUILDER_ASSET_LIMIT_EXCEEDED');
  const seen = new Set();
  const normalized = holdings.map((holding, index) => {
    const productId = String(holding && holding.productId || '').trim().toUpperCase();
    if (!/^SETSMART:[A-Z0-9._&-]{1,20}$/.test(productId)) throw builderError('BUILDER_PRODUCT_ID_INVALID', 400, { index });
    if (seen.has(productId)) throw builderError('BUILDER_DUPLICATE_PRODUCT_ID', 400, { productId });
    seen.add(productId);
    const weight = Number(holding.weight ?? holding.draftWeight);
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw builderError('BUILDER_WEIGHT_INVALID', 400, { productId });
    return { productId, symbol: productId.slice('SETSMART:'.length), weight };
  });
  const totalWeight = normalized.reduce((sum, holding) => sum + holding.weight, 0);
  if (totalWeight > 1 + 1e-9) throw builderError('BUILDER_WEIGHT_TOTAL_EXCEEDED');
  if (!(totalWeight > 0)) throw builderError('BUILDER_WEIGHT_TOTAL_ZERO');
  return { holdings: normalized, totalWeight, residualCashWeight: Math.max(0, 1 - totalWeight) };
}

function priceReturnSeries(history) {
  const rows = (Array.isArray(history) ? history : [])
    .filter((row) => row && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number(row.close) > 0)
    .sort((left, right) => left.date.localeCompare(right.date, 'en'));
  const seen = new Set();
  const unique = rows.filter((row) => {
    if (seen.has(row.date)) return false;
    seen.add(row.date);
    return true;
  });
  const returns = [];
  for (let index = 1; index < unique.length; index += 1) {
    returns.push({ date: unique[index].date, return: unique[index].close / unique[index - 1].close - 1 });
  }
  return returns;
}

function portfolioReturns(commonDates, returnMaps, weightsBySymbol) {
  return commonDates.map((date) => ({
    date,
    return: Object.entries(weightsBySymbol).reduce((sum, [symbol, weight]) => sum + weight * returnMaps[symbol].get(date), 0),
  }));
}

function growthSeries(returns) {
  let wealth = 1;
  return returns.map((row) => {
    wealth *= 1 + row.return;
    return { date: row.date, value: wealth };
  });
}

function metricsSummary(performance, startingValue) {
  const normalizedStartingValue = Math.max(0, finite(startingValue));
  const periodReturn = finite(performance.periodReturn);
  const periodPnl = normalizedStartingValue * periodReturn;
  return {
    startingValue: normalizedStartingValue,
    periodReturn,
    periodPnl,
    endingValue: normalizedStartingValue + periodPnl,
    pnlMethod: 'STARTING_VALUE_X_PRICE_RETURN_NO_FLOWS',
    annualizedReturn: performance.annualizedGeometricReturn,
    volatility: performance.volatility.annualizedVolatility,
    maxDrawdown: performance.drawdown.maxDrawdown,
    sharpe: performance.sharpe.sharpe,
    sortino: performance.sortino.sortino,
    calmar: performance.calmar.calmar,
    downsideDeviation: performance.downsideDeviation.annualizedDownsideDeviation,
    var95: performance.historicalRisk.var,
    cvar95: performance.historicalRisk.cvar,
    observationCount: performance.observationCount,
    startDate: performance.startDate,
    endDate: performance.endDate,
    returnType: performance.returnType,
    expectedReturnMethod: 'HISTORICAL_GEOMETRIC_PRICE_RETURN',
  };
}

function compound(values) {
  return values.reduce((growth, value) => growth * (1 + value), 1) - 1;
}

function calendarAndMonthlyReturns(returns) {
  const years = new Map();
  const months = new Map();
  for (const row of returns) {
    const year = row.date.slice(0, 4);
    const month = row.date.slice(0, 7);
    if (!years.has(year)) years.set(year, []);
    if (!months.has(month)) months.set(month, []);
    years.get(year).push(row.return);
    months.get(month).push(row.return);
  }
  return {
    calendarYears: [...years].map(([year, values]) => ({ year: Number(year), value: compound(values) })),
    monthly: [...months].map(([month, values]) => ({ month, value: compound(values) })),
  };
}

function rollingAnalytics(returns, periodsPerYear) {
  const window = Math.max(2, Math.round(periodsPerYear));
  const rolling12MReturn = [];
  const rollingVolatility = [];
  for (let end = window - 1; end < returns.length; end += 1) {
    const rows = returns.slice(end - window + 1, end + 1);
    const values = rows.map((row) => row.return);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
    rolling12MReturn.push({ date: rows.at(-1).date, value: compound(values), observationCount: values.length });
    rollingVolatility.push({ date: rows.at(-1).date, value: Math.sqrt(variance) * Math.sqrt(periodsPerYear), observationCount: values.length });
  }
  return { rolling12MReturn, rollingVolatility };
}

function strategyAnalytics(returns, performance, startingValue) {
  const grouped = calendarAndMonthlyReturns(returns);
  const rolling = rollingAnalytics(returns, performance.periodsPerYear);
  const metrics = metricsSummary(performance, startingValue);
  const completeYears = grouped.calendarYears.map((row) => row.value);
  metrics.bestYear = completeYears.length ? Math.max(...completeYears) : null;
  metrics.worstYear = completeYears.length ? Math.min(...completeYears) : null;
  return {
    metrics,
    returns,
    growth: growthSeries(returns),
    drawdown: performance.drawdown.series.map((row) => ({ date: row.date, value: row.drawdown })),
    drawdownEvents: {
      peakDate: performance.drawdown.peakDate,
      troughDate: performance.drawdown.troughDate,
      recoveryDate: performance.drawdown.recoveryDate,
    },
    calendarYears: grouped.calendarYears,
    monthly: grouped.monthly,
    rolling12MReturn: rolling.rolling12MReturn,
    rollingVolatility: rolling.rollingVolatility,
  };
}

function portfolioRiskContributors(symbols, weights, covariance) {
  const marginal = symbols.map((_, row) => covariance[row].reduce((sum, value, column) => sum + value * weights[column], 0));
  const variance = weights.reduce((sum, weight, index) => sum + weight * marginal[index], 0);
  return symbols.map((symbol, index) => ({
    symbol,
    weight: weights[index],
    contribution: variance > 0 ? weights[index] * marginal[index] / variance : null,
  })).sort((left, right) => Math.abs(right.contribution || 0) - Math.abs(left.contribution || 0));
}

function stabilizeCovariance(covariance) {
  const maxDiagonal = Math.max(...covariance.map((row, index) => Math.abs(row[index])), 1e-8);
  const ridge = Math.max(1e-10, maxDiagonal * 1e-8);
  return { ridge, covariance: covariance.map((row, index) => row.map((value, column) => value + (index === column ? ridge : 0))) };
}

function constraintResult(weights, options = {}) {
  const maxPositionWeight = finite(options.maxPositionWeight, MAX_POSITION_WEIGHT);
  const violations = weights
    .map((weight, index) => ({ index, weight }))
    .filter((item) => item.weight > maxPositionWeight + 1e-9)
    .map((item) => ({ code: 'MAX_POSITION_EXCEEDED', index: item.index, weight: item.weight, limit: maxPositionWeight }));
  return { passed: violations.length === 0, maxPositionWeight, violations };
}

function chooseOptimized(frontier, method, targetVolatility) {
  if (method === 'MIN_VARIANCE') return frontier.globalMinimumVariance;
  if (method === 'MAX_SHARPE') {
    return frontier.points.reduce((best, point) => point.sharpeRatio > best.sharpeRatio ? point : best, frontier.points[0]);
  }
  const feasible = frontier.points.filter((point) => point.volatility <= targetVolatility + 1e-9);
  return feasible.length ? feasible.reduce((best, point) => point.expectedReturn > best.expectedReturn ? point : best) : frontier.globalMinimumVariance;
}

function projectWeightsToCap(weights, maxPositionWeight) {
  const cap = finite(maxPositionWeight, MAX_POSITION_WEIGHT);
  if (!(cap > 0) || cap > 1) throw builderError('BUILDER_MAX_POSITION_INVALID');
  if (weights.length * cap < 1 - 1e-9) throw builderError('BUILDER_MAX_POSITION_INFEASIBLE', 422);
  const base = weights.map((weight) => Math.max(0, finite(weight)));
  const projected = Array(weights.length).fill(0);
  let open = base.map((_, index) => index);
  let remaining = 1;
  while (open.length) {
    const baseTotal = open.reduce((sum, index) => sum + base[index], 0);
    const candidates = open.map((index) => ({
      index,
      weight: baseTotal > 1e-15 ? base[index] / baseTotal * remaining : remaining / open.length,
    }));
    const capped = candidates.filter((item) => item.weight > cap + 1e-12);
    if (!capped.length) {
      for (const item of candidates) projected[item.index] = item.weight;
      remaining = 0;
      break;
    }
    for (const item of capped) {
      projected[item.index] = cap;
      remaining -= cap;
    }
    const cappedIndexes = new Set(capped.map((item) => item.index));
    open = open.filter((index) => !cappedIndexes.has(index));
  }
  const residual = 1 - projected.reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(residual) > 1e-12) {
    const index = projected.findIndex((weight) => weight + residual >= -1e-12 && weight + residual <= cap + 1e-12);
    if (index < 0) throw builderError('BUILDER_CONSTRAINT_PROJECTION_FAILED', 422);
    projected[index] += residual;
  }
  return projected;
}

function portfolioPoint(weights, expectedReturns, covariance) {
  const expectedReturn = weights.reduce((sum, weight, index) => sum + weight * expectedReturns[index], 0);
  const variance = weights.reduce((sum, weight, row) => sum + weight * covariance[row]
    .reduce((inner, value, column) => inner + value * weights[column], 0), 0);
  const volatility = Math.sqrt(Math.max(0, variance));
  return { weights, expectedReturn, volatility, sharpeRatio: volatility > 0 ? expectedReturn / volatility : null };
}

function constrainFrontier(frontier, expectedReturns, covariance, maxPositionWeight) {
  const candidates = [...frontier.points, frontier.globalMinimumVariance]
    .map((point) => portfolioPoint(projectWeightsToCap(point.weights, maxPositionWeight), expectedReturns, covariance));
  const unique = [...new Map(candidates.map((point) => [point.weights.map((weight) => weight.toFixed(12)).join('|'), point])).values()]
    .sort((left, right) => left.volatility - right.volatility || left.expectedReturn - right.expectedReturn);
  return {
    points: unique,
    globalMinimumVariance: unique.reduce((best, point) => point.volatility < best.volatility ? point : best, unique[0]),
  };
}

async function analyzePortfolioBuilder(input, dependencies) {
  const { client, universeResult, productRegistry } = dependencies || {};
  if (!productRegistry || typeof productRegistry.getHistory !== 'function') throw builderError('BUILDER_PRODUCT_REGISTRY_REQUIRED', 500);
  const current = buildClientListedPortfolio(client, universeResult);
  const draft = validateDraftHoldings(input.holdings);
  const currentWeights = Object.fromEntries(current.holdings.map((holding) => [holding.symbol, holding.currentWeight]));
  const draftWeights = Object.fromEntries(draft.holdings.map((holding) => [holding.symbol, holding.weight]));
  const symbols = [...new Set([...Object.keys(currentWeights), ...Object.keys(draftWeights)])];
  if (symbols.length > MAX_BUILDER_ASSETS) throw builderError('BUILDER_ASSET_LIMIT_EXCEEDED');
  const startDate = String(input.startDate || '');
  const endDate = String(input.endDate || universeResult.marketAsOf || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
    throw builderError('BUILDER_DATE_RANGE_INVALID');
  }
  // Fetch sequentially so an RM portfolio with many positions does not create a
  // burst against the licensed vendor endpoint. The underlying provider still
  // applies timeout/retry/cache/stale rules for each symbol.
  const histories = [];
  for (const symbol of symbols) {
    histories.push(await productRegistry.getHistory(`SETSMART:${symbol}`, startDate, endDate));
  }
  const returnsBySymbol = Object.fromEntries(symbols.map((symbol, index) => [symbol, priceReturnSeries(histories[index])]));
  const sourceRefs = histories.flatMap((history) => history.map((row) => row.source && row.source.sourceRef).filter(Boolean));
  const calculationId = `builder-${calculationHash({ clientId: client.clientId, holdings: draft.holdings, startDate, endDate }).slice(0, 16)}`;
  const metadata = {
    calculationId,
    modelVersion: 'portfolio-builder-v1',
    assumptionVersion: 'historical-price-return-v1',
    sourceRefs: [...new Set(sourceRefs)],
    asOf: endDate,
    currency: 'THB',
  };
  const covariance = calculateCovarianceAndCorrelation(returnsBySymbol, {
    minObservations: MIN_COMMON_OBSERVATIONS,
    metadata,
  });
  if (covariance.excludedSymbols.length || covariance.symbols.length !== symbols.length) {
    throw builderError('BUILDER_INSUFFICIENT_COMMON_HISTORY', 422, { excludedSymbols: covariance.excludedSymbols });
  }
  const returnMaps = Object.fromEntries(symbols.map((symbol) => [symbol, new Map(returnsBySymbol[symbol].map((row) => [row.date, row.return]))]));
  const currentReturns = portfolioReturns(covariance.commonDates, returnMaps, Object.fromEntries(symbols.map((symbol) => [symbol, currentWeights[symbol] || 0])));
  const draftReturns = portfolioReturns(covariance.commonDates, returnMaps, Object.fromEntries(symbols.map((symbol) => [symbol, draftWeights[symbol] || 0])));
  const periodsPerYear = covariance.periodsPerYear;
  const expectedReturns = symbols.map((symbol) => {
    const values = covariance.commonDates.map((date) => returnMaps[symbol].get(date));
    return values.reduce((sum, value) => sum + value, 0) / values.length * periodsPerYear;
  });
  const stabilized = stabilizeCovariance(covariance.covariance);
  const frontier = buildEfficientFrontier(expectedReturns, stabilized.covariance, { pointCount: 11, riskFreeRate: 0 });
  const maxPositionWeight = finite(input.constraints && input.constraints.maxPositionWeight, MAX_POSITION_WEIGHT);
  const constrainedFrontier = constrainFrontier(frontier, expectedReturns, stabilized.covariance, maxPositionWeight);
  const method = ['MIN_VARIANCE', 'MAX_SHARPE', 'MAX_RETURN_TARGET_VOL'].includes(input.method) ? input.method : 'MAX_RETURN_TARGET_VOL';
  const targetVolatility = finite(input.targetVolatility, 0.12);
  const optimized = chooseOptimized(constrainedFrontier, method, targetVolatility);
  const optimizedWeights = Object.fromEntries(symbols.map((symbol, index) => [symbol, optimized.weights[index]]));
  const optimizedReturns = portfolioReturns(covariance.commonDates, returnMaps, optimizedWeights);
  const performanceOptions = { metadata };
  const currentPerformance = calculatePerformance({ returns: currentReturns, returnType: 'PRICE_RETURN' }, performanceOptions);
  const draftPerformance = calculatePerformance({ returns: draftReturns, returnType: 'PRICE_RETURN' }, performanceOptions);
  const optimizedPerformance = calculatePerformance({ returns: optimizedReturns, returnType: 'PRICE_RETURN' }, performanceOptions);
  const currentGrowth = growthSeries(currentReturns);
  const draftGrowth = growthSeries(draftReturns);
  const optimizedGrowth = growthSeries(optimizedReturns);
  const modelConstraints = constraintResult(optimized.weights, input.constraints);
  const draftConstraints = constraintResult(symbols.map((symbol) => draftWeights[symbol] || 0), input.constraints);
  const effectiveHoldings = calculateEffectiveHoldings(draft.holdings.map((holding) => ({ fundId: holding.productId, masterFundId: holding.productId, weight: holding.weight })), { metadata });
  const currentVector = symbols.map((symbol) => currentWeights[symbol] || 0);
  const draftVector = symbols.map((symbol) => draftWeights[symbol] || 0);
  const turnover = draftVector.reduce((sum, weight, index) => sum + Math.abs(weight - currentVector[index]), 0) / 2;
  const strategyDetails = {
    CURRENT: strategyAnalytics(currentReturns, currentPerformance, current.portfolioValue),
    DRAFT: strategyAnalytics(draftReturns, draftPerformance, current.portfolioValue),
    MODEL: strategyAnalytics(optimizedReturns, optimizedPerformance, current.portfolioValue),
    NO_ACTION: strategyAnalytics(currentReturns, currentPerformance, current.portfolioValue),
  };
  const currentGoals = (Array.isArray(client.goals) ? client.goals : []).map((goal) => ({
    goalId: goal.goalId,
    name: goal.name,
    targetAmount: finite(goal.targetAmount ?? goal.target),
    targetDate: goal.targetDate,
    fundedRatio: finite(goal.fundedRatio),
    baseSuccessProbability: finite(goal.baseSuccessProbability),
    stressSuccessProbability: finite(goal.stressSuccessProbability),
    expectedShortfall: finite(goal.shortfall),
    cvarShortfall: null,
    requiredMonthlyContribution: finite(goal.requiredMonthlyContribution),
    afterDraft: null,
    afterStatus: 'VALIDATED_GOAL_PROJECTION_NOT_AVAILABLE',
  }));
  return {
    calculationId,
    clientId: client.clientId,
    marketAsOf: universeResult.marketAsOf,
    period: { startDate: covariance.commonDates[0], endDate: covariance.commonDates.at(-1), observationCount: covariance.observationCount },
    symbols,
    currentPortfolio: current,
    draft: { ...draft, constraints: draftConstraints, effectiveHoldings: effectiveHoldings.effectiveHoldings },
    model: {
      method,
      label: method === 'MIN_VARIANCE' ? 'Minimum Variance' : method === 'MAX_SHARPE' ? 'Maximum Sharpe' : `Maximum Return at ${(targetVolatility * 100).toFixed(1)}% Volatility`,
      targetVolatility,
      expectedReturn: optimized.expectedReturn,
      volatility: optimized.volatility,
      sharpe: optimized.sharpeRatio,
      weights: symbols.map((symbol, index) => ({ productId: `SETSMART:${symbol}`, symbol, weight: optimized.weights[index] })),
      constraints: modelConstraints,
      diagnosticOnly: true,
      approvedModel: false,
    },
    comparisons: [
      { id: 'CURRENT', label: 'Current Portfolio', metrics: strategyDetails.CURRENT.metrics },
      { id: 'DRAFT', label: 'RM Draft', metrics: strategyDetails.DRAFT.metrics },
      { id: 'MODEL', label: 'AI Model Diagnostic', metrics: strategyDetails.MODEL.metrics },
      { id: 'NO_ACTION', label: 'No-action / Benchmark', metrics: strategyDetails.NO_ACTION.metrics },
    ],
    growth: covariance.commonDates.map((date, index) => ({
      date,
      current: currentGrowth[index].value,
      draft: draftGrowth[index].value,
      model: optimizedGrowth[index].value,
    })),
    frontier: constrainedFrontier.points.map((point) => ({ expectedReturn: point.expectedReturn, volatility: point.volatility, sharpe: point.sharpeRatio })),
    correlation: { symbols: covariance.symbols, values: covariance.correlation },
    covariance: { shrinkage: covariance.shrinkage, psd: covariance.psd, ridge: stabilized.ridge, commonDatesOnly: true, forwardFilled: false },
    strategyDetails,
    allocations: {
      CURRENT: symbols.map((symbol) => ({ symbol, weight: currentWeights[symbol] || 0 })),
      DRAFT: symbols.map((symbol) => ({ symbol, weight: draftWeights[symbol] || 0 })),
      MODEL: symbols.map((symbol, index) => ({ symbol, weight: optimized.weights[index] })),
      NO_ACTION: symbols.map((symbol) => ({ symbol, weight: currentWeights[symbol] || 0 })),
    },
    immediateImpact: {
      expectedReturn: draftPerformance.annualizedGeometricReturn,
      expectedReturnMethod: 'HISTORICAL_GEOMETRIC_PRICE_RETURN',
      volatility: draftPerformance.volatility.annualizedVolatility,
      maxDrawdown: draftPerformance.drawdown.maxDrawdown,
      sharpe: draftPerformance.sharpe.sharpe,
      var95: draftPerformance.historicalRisk.var,
      cvar95: draftPerformance.historicalRisk.cvar,
      residualCashWeight: draft.residualCashWeight,
      turnover,
      feeStatus: 'MISSING_BANK_PRODUCT_CATALOG',
      currencyStatus: 'NOT_SUPPORTED_BY_LISTED_EOD_CONTRACT',
      concentration: Math.max(...draftVector),
      goalProjectionStatus: currentGoals.length ? 'VALIDATED_GOAL_PROJECTION_NOT_AVAILABLE' : 'GOAL_LEDGER_MISSING',
      readinessViolations: ['APPROVED_SHELF_NOT_CONNECTED', 'CLIENT_ELIGIBILITY_NOT_CONNECTED'],
    },
    risk: {
      topConcentrations: symbols.map((symbol, index) => ({ symbol, weight: draftVector[index] })).sort((left, right) => right.weight - left.weight).slice(0, 5),
      topRiskContributors: portfolioRiskContributors(symbols, draftVector, covariance.covariance).slice(0, 5),
      effectiveHoldings: effectiveHoldings.effectiveHoldings,
      masterFundDuplicationWarnings: [],
      issuerExposureStatus: 'NOT_SUPPORTED_BY_LISTED_EOD_CONTRACT',
      sectorExposureStatus: 'NOT_SUPPORTED_BY_LISTED_EOD_CONTRACT',
      currencyExposureStatus: 'NOT_SUPPORTED_BY_LISTED_EOD_CONTRACT',
      liquidityExposure: { residualCashWeight: draft.residualCashWeight, productLiquidityStatus: 'MISSING_BANK_PRODUCT_CATALOG' },
    },
    assetDiagnostics: symbols.map((symbol, index) => {
      const volatility = Math.sqrt(Math.max(0, covariance.covariance[index][index]));
      return {
        symbol,
        expectedReturn: expectedReturns[index],
        expectedReturnMethod: 'HISTORICAL_ARITHMETIC_PRICE_RETURN',
        volatility,
        sharpe: volatility > 0 ? expectedReturns[index] / volatility : null,
        currentWeight: currentVector[index],
        draftWeight: draftVector[index],
        modelWeight: optimized.weights[index],
        minWeight: 0,
        maxWeight: finite(input.constraints && input.constraints.maxPositionWeight, MAX_POSITION_WEIGHT),
        expectedReturnContribution: draftVector[index] * expectedReturns[index],
      };
    }),
    goalImpact: currentGoals,
    source: { market: 'SETSMART', clientHoldings: 'DEMO_CLIENT_HOLDINGS', returnType: 'PRICE_RETURN', totalReturnAvailable: false },
    warnings: [
      'ผลวิเคราะห์ใช้ราคาซื้อขายย้อนหลัง ไม่ใช่ total return และไม่ใช่การพยากรณ์',
      'Model Diagnostic เป็นเครื่องมือช่วย RM ไม่ใช่คำสั่งซื้อขายหรือคำแนะนำอัตโนมัติ',
      'Approved shelf และ eligibility ต้องมาจากนโยบายธนาคารก่อนนำร่างไปเสนอ',
    ],
  };
}

function createPortfolioDraftStore(options = {}) {
  const drafts = new Map();
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();
  let sequence = 0;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  return Object.freeze({
    save(input) {
      if (!input || !input.clientId || !input.portfolioId || !input.sourceSnapshotId || !input.createdBy) {
        throw builderError('PORTFOLIO_DRAFT_METADATA_REQUIRED');
      }
      const validated = validateDraftHoldings(input.holdings);
      const timestamp = now();
      const draftId = String(input.draftId || `DRAFT-${calculationHash({ clientId: input.clientId, sequence: sequence += 1, timestamp }).slice(0, 12)}`);
      const previous = drafts.get(draftId);
      if (previous && previous.clientId !== input.clientId) throw builderError('PORTFOLIO_DRAFT_CLIENT_MISMATCH');
      const draft = Object.freeze({
        clientId: String(input.clientId),
        portfolioId: String(input.portfolioId),
        draftId,
        sourceSnapshotId: String(input.sourceSnapshotId),
        createdBy: String(input.createdBy),
        createdAt: previous ? previous.createdAt : timestamp,
        updatedAt: timestamp,
        calculationId: input.calculationId ? String(input.calculationId) : null,
        modelVersion: String(input.modelVersion || 'portfolio-builder-v1'),
        state: 'DRAFT_PROPOSAL',
        holdings: Object.freeze(validated.holdings.map((holding) => Object.freeze({ productId: holding.productId, weight: holding.weight }))),
        residualCashWeight: validated.residualCashWeight,
        humanApprovalRequired: true,
        currentPortfolioMutated: false,
        autoTrade: false,
      });
      drafts.set(draftId, draft);
      return clone(draft);
    },
    list(clientId) {
      return [...drafts.values()].filter((draft) => draft.clientId === clientId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map(clone);
    },
    get(draftId) {
      return drafts.has(draftId) ? clone(drafts.get(draftId)) : null;
    },
  });
}

module.exports = {
  ALLOWED_INITIAL_TYPES,
  MAX_BUILDER_ASSETS,
  MAX_POSITION_WEIGHT,
  analyzePortfolioBuilder,
  buildClientHoldingBook,
  buildClientListedPortfolio,
  createPortfolioDraftStore,
  priceReturnSeries,
  selectRealAssetRows,
  validateDraftHoldings,
};
