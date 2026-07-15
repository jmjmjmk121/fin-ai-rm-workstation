'use strict';

const crypto = require('node:crypto');
const {
  calculateTWR,
  calculateXIRR,
  calculateCAGRNoFlows,
  calculatePerformance,
  calculateCovarianceAndCorrelation,
  calculateEffectiveHoldings,
  groupHoldingsByMasterFund,
  inferFrequency,
} = require('./quant');

const DAY_MS = 24 * 60 * 60 * 1000;
const ROLLING_YEAR_DAYS = 365.25;
const MIN_ROLLING_COVERAGE_DAYS = 335;
const DEFAULT_MODEL_VERSION = 'fin-ai-portfolio-analytics-v3';
const DEFAULT_ASSUMPTION_VERSION = 'portfolio-analytics-assumptions-v1';

function canonicalize(value) {
  if (value === null || value === undefined) return value == null ? value : null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function isoDate(value, label = 'date') {
  const normalized = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00.000Z`
    : value;
  const time = new Date(normalized).getTime();
  if (!Number.isFinite(time)) throw new TypeError(`${label} must be a valid date`);
  return new Date(time).toISOString().slice(0, 10);
}

function timeOf(date) {
  return new Date(`${date}T00:00:00.000Z`).getTime();
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be a finite number`);
  return number;
}

function numeric(value) {
  if (value && typeof value === 'object') {
    if (value.available === false || value.availability === 'MISSING' || value.availability === 'NOT_SUPPORTED') return null;
    if (value.value !== undefined) return numeric(value.value);
  }
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compound(values) {
  return values.reduce((growth, value) => growth * (1 + value), 1) - 1;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sampleCovariance(left, right) {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = average(left);
  const rightMean = average(right);
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += (left[index] - leftMean) * (right[index] - rightMean);
  }
  return total / (left.length - 1);
}

function normalizeFlows(input) {
  const source = input.cashFlows || input.flows;
  if (!Array.isArray(source)) return [];
  const byDate = new Map();
  source.forEach((flow, index) => {
    if (!flow || typeof flow !== 'object') throw new TypeError(`cashFlows[${index}] must be an object`);
    const date = isoDate(flow.date ?? flow.asOf, `cashFlows[${index}].date`);
    const amount = finite(flow.amount ?? flow.externalFlow ?? flow.cashFlow, `cashFlows[${index}].amount`);
    byDate.set(date, (byDate.get(date) || 0) + amount);
  });
  return [...byDate.entries()].map(([date, amount]) => ({ date, amount })).sort((a, b) => timeOf(a.date) - timeOf(b.date));
}

function normalizeValueSeries(input, flows) {
  const source = input.series || input.valuations || input.portfolioSeries;
  if (!Array.isArray(source) || source.length < 2) throw new RangeError('at least two dated portfolio valuations are required');
  const explicitFlowByDate = new Map(flows.map((flow) => [flow.date, flow.amount]));
  const hasExplicitFlows = flows.length > 0;
  const rows = source.map((row, index) => {
    if (!row || typeof row !== 'object') throw new TypeError(`series[${index}] must be an object`);
    const date = isoDate(row.date ?? row.asOf, `series[${index}].date`);
    const value = finite(row.value ?? row.portfolioValue ?? row.wealth, `series[${index}].value`);
    if (!(value > 0)) throw new RangeError(`series[${index}].value must be greater than zero`);
    const embeddedFlow = finite(row.externalFlow ?? row.cashFlow ?? row.netFlow ?? 0, `series[${index}].externalFlow`);
    const benchmarkCandidate = row.benchmarkValue ?? row.benchmark;
    const benchmarkValue = benchmarkCandidate == null ? null : finite(benchmarkCandidate, `series[${index}].benchmarkValue`);
    if (benchmarkValue != null && !(benchmarkValue > 0)) throw new RangeError('benchmark values must be greater than zero');
    return {
      date,
      value,
      benchmarkValue,
      externalFlow: hasExplicitFlows ? (explicitFlowByDate.get(date) || 0) : embeddedFlow,
    };
  }).sort((a, b) => timeOf(a.date) - timeOf(b.date));
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index].date === rows[index - 1].date) throw new RangeError(`duplicate portfolio valuation date ${rows[index].date}`);
  }
  for (const flow of flows) {
    if (flow.date >= rows[0].date && flow.date <= rows.at(-1).date && !rows.some((row) => row.date === flow.date)) {
      throw new RangeError(`cash flow date ${flow.date} has no same-date valuation; flows are not forward-filled`);
    }
  }
  return rows;
}

function normalizeReturnSeries(source, label) {
  if (!Array.isArray(source)) return [];
  const rows = source.map((row, index) => {
    if (Array.isArray(row)) return { date: isoDate(row[0], `${label}[${index}].date`), return: finite(row[1], `${label}[${index}].return`) };
    if (!row || typeof row !== 'object') throw new TypeError(`${label}[${index}] must be a dated return`);
    return {
      date: isoDate(row.date ?? row.asOf, `${label}[${index}].date`),
      return: finite(row.return ?? row.rate ?? row.value, `${label}[${index}].return`),
    };
  }).sort((a, b) => timeOf(a.date) - timeOf(b.date));
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index].date === rows[index - 1].date) throw new RangeError(`${label} contains duplicate date ${rows[index].date}`);
  }
  if (rows.some((row) => row.return < -1)) throw new RangeError(`${label} contains a return below -100%`);
  return rows;
}

function returnsFromValues(series, valueKey = 'value') {
  return series.slice(1).map((row, index) => {
    const prior = series[index];
    const currentValue = row[valueKey];
    const priorValue = prior[valueKey];
    if (!Number.isFinite(currentValue) || !Number.isFinite(priorValue)) return null;
    return {
      date: row.date,
      previousDate: prior.date,
      return: (currentValue - row.externalFlow) / priorValue - 1,
    };
  }).filter(Boolean);
}

function assertSuppliedReturnsAgree(supplied, derived) {
  if (!supplied.length) return;
  if (supplied.length !== derived.length) throw new RangeError('supplied portfolio returns do not cover the same valuation dates');
  for (let index = 0; index < derived.length; index += 1) {
    if (supplied[index].date !== derived[index].date || Math.abs(supplied[index].return - derived[index].return) > 1e-10) {
      throw new RangeError('supplied portfolio returns disagree with the cash-flow-adjusted valuation series');
    }
  }
}

function annualAndMonthlyReturns(returns) {
  const years = new Map();
  const months = new Map();
  for (const row of returns) {
    const year = row.date.slice(0, 4);
    const month = row.date.slice(0, 7);
    if (!years.has(year)) years.set(year, []);
    if (!months.has(month)) months.set(month, []);
    years.get(year).push(row);
    months.get(month).push(row);
  }
  const calendarYears = [...years.entries()].map(([year, rows]) => {
    const coveredMonths = new Set(rows.map((row) => row.date.slice(5, 7))).size;
    return {
      date: `${year}-12-31`,
      year: Number(year),
      value: compound(rows.map((row) => row.return)),
      startDate: rows[0].date,
      endDate: rows.at(-1).date,
      observationCount: rows.length,
      coveredMonths,
      completeYear: coveredMonths >= 10 && rows[0].date.slice(5, 7) <= '02' && rows.at(-1).date.slice(5, 7) >= '11',
    };
  });
  const monthly = [...months.entries()].map(([month, rows]) => ({
    date: `${month}-01`,
    year: Number(month.slice(0, 4)),
    month: Number(month.slice(5, 7)),
    value: compound(rows.map((row) => row.return)),
    observationCount: rows.length,
  }));
  return { calendarYears, monthly };
}

function rollingAnalytics(returns, periodsPerYear) {
  const rollingReturns = [];
  const rollingVolatility = [];
  let windowStart = 0;
  for (let end = 0; end < returns.length; end += 1) {
    const endTime = timeOf(returns[end].date);
    const target = endTime - ROLLING_YEAR_DAYS * DAY_MS;
    while (windowStart < end && timeOf(returns[windowStart].date) < target) windowStart += 1;
    const coverageDays = (endTime - timeOf(returns[windowStart].date)) / DAY_MS;
    const window = returns.slice(windowStart, end + 1);
    if (coverageDays < MIN_ROLLING_COVERAGE_DAYS || window.length < 2) continue;
    const values = window.map((row) => row.return);
    const mean = average(values);
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
    rollingReturns.push({
      date: returns[end].date,
      value: compound(values),
      startDate: window[0].date,
      observationCount: values.length,
    });
    rollingVolatility.push({
      date: returns[end].date,
      value: Math.sqrt(variance) * Math.sqrt(periodsPerYear),
      startDate: window[0].date,
      observationCount: values.length,
      periodsPerYear,
    });
  }
  return { rollingReturns, rollingVolatility };
}

function normalizeHoldings(input, portfolioEndValue) {
  const source = input.holdings;
  if (!Array.isArray(source) || !source.length) throw new RangeError('holdings are required for diversification analytics');
  const suppliedValueTotal = source.reduce((sum, holding) => sum + (numeric(holding && holding.value) || 0), 0);
  const suppliedWeightTotal = source.reduce((sum, holding) => sum + (numeric(holding && holding.weight) || 0), 0);
  if (!(suppliedValueTotal > 0) && !(suppliedWeightTotal > 0)) throw new RangeError('holdings require positive values or weights');
  return source.map((holding, index) => {
    if (!holding || typeof holding !== 'object') throw new TypeError(`holdings[${index}] must be an object`);
    const fundId = String(holding.fundId ?? holding.shareClassId ?? holding.symbol ?? '');
    if (!fundId) throw new TypeError(`holdings[${index}].fundId is required`);
    const masterFundId = String(holding.masterFundId ?? holding.masterId ?? fundId);
    const value = suppliedValueTotal > 0
      ? (numeric(holding.value) || 0)
      : (numeric(holding.weight) || 0) / suppliedWeightTotal * portfolioEndValue;
    const weight = suppliedValueTotal > 0
      ? value / suppliedValueTotal
      : (numeric(holding.weight) || 0) / suppliedWeightTotal;
    return {
      ...holding,
      fundId,
      masterFundId,
      name: String(holding.name ?? holding.nameTh ?? fundId),
      value,
      weight,
      assetClass: String(holding.assetClass ?? 'UNKNOWN'),
      currency: String(holding.currency ?? 'UNKNOWN'),
    };
  });
}

function masterReturnSeries(input, holdings) {
  const supplied = input.returnsByFund || input.returnsByHolding || input.holdingReturns || {};
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) return {};
  const masters = new Map();
  for (const holding of holdings) {
    if (!masters.has(holding.masterFundId)) masters.set(holding.masterFundId, []);
    masters.get(holding.masterFundId).push(holding);
  }
  const output = {};
  for (const [masterFundId, members] of masters) {
    if (Array.isArray(supplied[masterFundId])) {
      output[masterFundId] = normalizeReturnSeries(supplied[masterFundId], `returnsByFund.${masterFundId}`);
      continue;
    }
    const available = members
      .filter((holding) => Array.isArray(supplied[holding.fundId]))
      .map((holding) => ({ holding, rows: normalizeReturnSeries(supplied[holding.fundId], `returnsByFund.${holding.fundId}`) }));
    if (!available.length) continue;
    if (available.length === 1) {
      output[masterFundId] = available[0].rows;
      continue;
    }
    let dates = available[0].rows.map((row) => row.date);
    const maps = available.map((item) => new Map(item.rows.map((row) => [row.date, row.return])));
    for (let index = 1; index < maps.length; index += 1) dates = dates.filter((date) => maps[index].has(date));
    const totalWeight = available.reduce((sum, item) => sum + item.holding.weight, 0);
    output[masterFundId] = dates.map((date) => ({
      date,
      return: available.reduce((sum, item, index) => sum + maps[index].get(date) * item.holding.weight / totalWeight, 0),
    }));
  }
  return output;
}

function enrichGroups(grouping, holdings) {
  return grouping.groups.map((group) => {
    const members = holdings.filter((holding) => holding.masterFundId === group.masterFundId);
    return {
      ...group,
      name: members[0] ? members[0].name : group.masterFundId,
      value: members.reduce((sum, holding) => sum + holding.value, 0),
      assetClass: members[0] ? members[0].assetClass : 'UNKNOWN',
      shareClassCount: members.length,
    };
  });
}

function currencyExposureRows(holdings) {
  const exposures = new Map();
  for (const holding of holdings) {
    const supplied = holding.currencyExposures;
    if (supplied && typeof supplied === 'object' && !Array.isArray(supplied)) {
      const entries = Object.entries(supplied).map(([currency, share]) => [currency, finite(share, `currencyExposures.${currency}`)]);
      if (entries.some(([, share]) => share < 0)) throw new RangeError('currency exposure shares must be non-negative');
      const total = entries.reduce((sum, [, share]) => sum + share, 0);
      if (!(total > 0)) throw new RangeError('currency exposure shares must have a positive sum');
      for (const [currency, share] of entries) exposures.set(currency, (exposures.get(currency) || 0) + holding.weight * share / total);
    } else {
      const currency = String(holding.exposureCurrency ?? holding.underlyingCurrency ?? holding.currency ?? 'UNKNOWN');
      exposures.set(currency, (exposures.get(currency) || 0) + holding.weight);
    }
  }
  return [...exposures.entries()].map(([currency, weight]) => ({ currency, weight })).sort((a, b) => b.weight - a.weight);
}

function calculateMarketBeta(portfolioReturns, benchmarkReturns, minimumObservations) {
  const portfolioMap = new Map(portfolioReturns.map((row) => [row.date, row.return]));
  const aligned = benchmarkReturns.filter((row) => portfolioMap.has(row.date));
  if (aligned.length < minimumObservations) {
    return { available: false, value: null, observationCount: aligned.length, reasonCode: 'INSUFFICIENT_COMMON_BENCHMARK_DATES' };
  }
  const portfolio = aligned.map((row) => portfolioMap.get(row.date));
  const benchmark = aligned.map((row) => row.return);
  const benchmarkVariance = sampleCovariance(benchmark, benchmark);
  if (!(benchmarkVariance > 0)) return { available: false, value: null, observationCount: aligned.length, reasonCode: 'ZERO_BENCHMARK_VARIANCE' };
  return {
    available: true,
    value: sampleCovariance(portfolio, benchmark) / benchmarkVariance,
    observationCount: aligned.length,
    startDate: aligned[0].date,
    endDate: aligned.at(-1).date,
    alignment: 'actual common dates only; no forward-filled returns',
  };
}

function goalMetric(goal, keys) {
  for (const key of keys) {
    if (goal && goal[key] != null) {
      const value = numeric(goal[key]);
      if (value != null) return value;
    }
  }
  return null;
}

function normalizeGoalState(goal) {
  const targetAmount = goalMetric(goal, ['targetAmount', 'target']);
  const currentFunding = goalMetric(goal, ['currentFunding', 'fundedAmount', 'assignedValue']);
  const fundedRatio = goalMetric(goal, ['fundedRatio']) ?? (
    targetAmount > 0 && currentFunding != null ? currentFunding / targetAmount : null
  );
  const shortfall = goalMetric(goal, ['shortfall']) ?? (
    targetAmount != null && currentFunding != null ? Math.max(0, targetAmount - currentFunding) : null
  );
  return {
    currentFunding,
    fundedRatio,
    baseSuccessProbability: goalMetric(goal, ['baseSuccessProbability', 'successProbability']),
    stressSuccessProbability: goalMetric(goal, ['stressSuccessProbability']),
    shortfall,
    requiredMonthlyContribution: goalMetric(goal, ['requiredMonthlyContribution']),
  };
}

function buildPortfolioAnalytics(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('portfolio analytics input is required');
  const flows = normalizeFlows(input);
  const series = normalizeValueSeries(input, flows);
  const derivedReturns = returnsFromValues(series);
  assertSuppliedReturnsAgree(normalizeReturnSeries(input.returns || [], 'returns'), derivedReturns);
  const holdings = normalizeHoldings(input, series.at(-1).value);
  const sourceRefs = [...new Set([
    ...((options.metadata && options.metadata.sourceRefs) || []),
    ...(input.sourceRefs || []),
    ...((input.audit && input.audit.sourceRefs) || []),
  ].map(String))];
  const inputHash = stableHash({
    series,
    flows,
    holdings,
    returnsByFund: input.returnsByFund || input.returnsByHolding || input.holdingReturns || null,
    benchmarkReturns: input.benchmarkReturns || null,
    goals: input.goals || [],
    expectedReturn: input.expectedReturn || options.expectedReturn || null,
    returnType: input.returnType || null,
  });
  const metadata = options.metadata || {};
  const calculationId = metadata.calculationId || `portfolio-analytics-${inputHash.slice(0, 20)}`;
  const asOf = metadata.asOf || input.asOf || series.at(-1).date;
  const period = `${series[0].date}/${series.at(-1).date}`;
  const dataStatus = input.fixture === true || input.dataMode === 'fixture'
    ? 'SYNTHETIC_FIXTURE_DEMO'
    : (input.dataStatus || 'CALLER_SUPPLIED_GOVERNED_DATA');
  const reasonCodes = [...new Set([
    ...(metadata.reasonCodes || []),
    ...(sourceRefs.length ? [] : ['SOURCE_REFS_NOT_SUPPLIED']),
    ...(dataStatus === 'SYNTHETIC_FIXTURE_DEMO' ? ['FIXTURE_DEMO_DATA'] : []),
    ...(input.returnType === 'NAV_RETURN' ? ['RAW_NAV_NOT_TOTAL_RETURN'] : []),
  ])];
  const audit = {
    formulaId: 'PORTFOLIO_ANALYTICS_COMPOSITION_V3',
    calculationId,
    inputHash,
    modelVersion: metadata.modelVersion || DEFAULT_MODEL_VERSION,
    assumptionVersion: metadata.assumptionVersion || DEFAULT_ASSUMPTION_VERSION,
    asOf,
    period,
    currency: metadata.currency || input.currency || 'THB',
    sourceRefs,
    observationCount: derivedReturns.length,
    returnType: input.returnType || 'UNSPECIFIED_RETURN',
    dataStatus,
    reasonCodes,
    deterministic: true,
    noSmoothing: true,
    noForwardFill: true,
  };
  const ref = Object.freeze({
    calculationId: audit.calculationId,
    inputHash: audit.inputHash,
    modelVersion: audit.modelVersion,
    assumptionVersion: audit.assumptionVersion,
    asOf: audit.asOf,
    period: audit.period,
    currency: audit.currency,
    sourceRefs: audit.sourceRefs,
    observationCount: audit.observationCount,
    returnType: audit.returnType,
    dataStatus: audit.dataStatus,
  });
  const metric = (value, unit, formulaId, extra = {}) => ({ value, unit, formulaId, ...extra, resultRef: ref });
  const unavailableMetric = (unit, formulaId, reasonCode, requiredInputs, limitation) => ({
    value: null,
    unit,
    formulaId,
    available: false,
    availability: 'MISSING',
    reasonCode,
    requiredInputs,
    limitation,
    resultRef: ref,
  });
  const rowRef = (row) => ({ ...row, resultRef: ref });
  const quantMetadata = { metadata: { ...metadata, calculationId, inputHash, sourceRefs, asOf, currency: audit.currency, period, reasonCodes } };

  const twr = calculateTWR(series, quantMetadata);
  const clientCashFlows = [{ date: series[0].date, amount: -series[0].value }];
  for (const flow of flows.length ? flows : series.filter((row) => row.externalFlow).map((row) => ({ date: row.date, amount: row.externalFlow }))) {
    clientCashFlows.push({ date: flow.date, amount: -flow.amount });
  }
  clientCashFlows.push({ date: series.at(-1).date, amount: series.at(-1).value });
  const xirr = calculateXIRR(clientCashFlows, quantMetadata);
  const governedPerformance = calculatePerformance({
    returns: derivedReturns,
    returnType: input.returnType || 'UNSPECIFIED_RETURN',
    riskFreeRate: options.riskFreeRate ?? input.riskFreeRate ?? 0,
    minimumAcceptableReturn: options.minimumAcceptableReturn ?? input.minimumAcceptableReturn ?? 0,
    confidenceLevel: options.confidenceLevel ?? input.confidenceLevel ?? 0.95,
  }, quantMetadata);
  const effectiveHoldings = calculateEffectiveHoldings(holdings, quantMetadata);
  const grouping = groupHoldingsByMasterFund(holdings, quantMetadata);
  const groups = enrichGroups(grouping, holdings).sort((a, b) => b.weight - a.weight);
  const normalizedFlows = flows.length ? flows : series.filter((row) => row.externalFlow).map((row) => ({ date: row.date, amount: row.externalFlow }));
  const contributions = normalizedFlows.filter((flow) => flow.amount > 0).reduce((sum, flow) => sum + flow.amount, 0);
  const withdrawals = normalizedFlows.filter((flow) => flow.amount < 0).reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
  const periodPnl = series.at(-1).value - series[0].value - contributions + withdrawals;
  let cagr = null;
  if (!normalizedFlows.some((flow) => Math.abs(flow.amount) > 1e-14)) {
    cagr = calculateCAGRNoFlows({
      startValue: series[0].value,
      endValue: series.at(-1).value,
      startDate: series[0].date,
      endDate: series.at(-1).date,
    }, quantMetadata);
  }

  const { calendarYears, monthly } = annualAndMonthlyReturns(derivedReturns);
  const completeYears = calendarYears.filter((row) => row.completeYear);
  const comparableYears = completeYears.length ? completeYears : calendarYears;
  const bestYear = comparableYears.length ? comparableYears.reduce((best, row) => row.value > best.value ? row : best) : null;
  const worstYear = comparableYears.length ? comparableYears.reduce((worst, row) => row.value < worst.value ? row : worst) : null;
  const frequency = inferFrequency(derivedReturns.map((row) => row.date), quantMetadata);
  const rolling = rollingAnalytics(derivedReturns, frequency.periodsPerYear);

  const suppliedExpected = options.expectedReturn ?? input.expectedReturn;
  let expectedReturnValue;
  let expectedReturnMethod;
  let expectedReturnLimitation;
  if (suppliedExpected != null) {
    expectedReturnValue = numeric(suppliedExpected);
    expectedReturnMethod = typeof suppliedExpected === 'object' ? suppliedExpected.method : null;
    if (expectedReturnValue == null) throw new TypeError('expectedReturn.value must be a finite number');
    if (!expectedReturnMethod) throw new TypeError('a supplied expected return requires an explicit method');
    expectedReturnLimitation = typeof suppliedExpected === 'object' ? suppliedExpected.limitation || null : null;
  } else {
    expectedReturnValue = governedPerformance.annualizedGeometricReturn;
    expectedReturnMethod = 'HISTORICAL_GEOMETRIC_ANNUALISED_TWR';
    expectedReturnLimitation = 'Historical cash-flow-adjusted return; this is not a forecast or an alpha claim.';
  }

  let benchmarkReturns = normalizeReturnSeries(input.benchmarkReturns || [], 'benchmarkReturns');
  if (!benchmarkReturns.length && series.every((row) => row.benchmarkValue != null)) benchmarkReturns = returnsFromValues(series, 'benchmarkValue');
  const beta = calculateMarketBeta(derivedReturns, benchmarkReturns, Math.max(2, Number(options.minBetaObservations ?? 20)));

  const returnsByMaster = masterReturnSeries(input, holdings);
  let covarianceResult = null;
  const correlationSymbols = Object.keys(returnsByMaster);
  if (correlationSymbols.length >= 2) {
    try {
      covarianceResult = calculateCovarianceAndCorrelation(returnsByMaster, {
        ...quantMetadata,
        minObservations: Math.max(2, Number(options.minCorrelationObservations ?? 20)),
        annualize: true,
      });
    } catch (error) {
      if (!/insufficient actual common valuation dates|no symbol has sufficient/i.test(error.message)) throw error;
    }
  }

  const concentrationRisks = [
    ...groups.map((group) => ({
      type: 'MASTER_FUND',
      id: group.masterFundId,
      name: group.name,
      value: group.weight,
      severity: group.weight >= 0.35 ? 'HIGH' : group.weight >= 0.20 ? 'MEDIUM' : 'LOW',
    })),
    ...[...new Set(holdings.map((holding) => holding.assetClass))].map((assetClass) => ({
      type: 'ASSET_CLASS',
      id: assetClass,
      name: assetClass,
      value: holdings.filter((holding) => holding.assetClass === assetClass).reduce((sum, holding) => sum + holding.weight, 0),
      severity: 'INFO',
    })),
  ].sort((a, b) => b.value - a.value).slice(0, 5).map(rowRef);

  const duplicationWarnings = groups.filter((group) => group.shareClassCount > 1).map((group) => rowRef({
    masterFundId: group.masterFundId,
    name: group.name,
    shareClassIds: group.shareClassIds,
    shareClassCount: group.shareClassCount,
    combinedWeight: group.weight,
    warningCode: 'SHARE_CLASSES_SAME_MASTER_NOT_INDEPENDENT_DIVERSIFICATION',
  }));
  const currencyExposure = currencyExposureRows(holdings).map(rowRef);

  let topRiskContributors = [];
  if (covarianceResult) {
    const weights = covarianceResult.symbols.map((symbol) => groups.find((group) => group.masterFundId === symbol)?.weight || 0);
    const includedWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const normalizedWeights = weights.map((weight) => includedWeight > 0 ? weight / includedWeight : 0);
    const sigmaW = covarianceResult.covariance.map((row) => row.reduce((sum, value, index) => sum + value * normalizedWeights[index], 0));
    const portfolioVariance = normalizedWeights.reduce((sum, weight, index) => sum + weight * sigmaW[index], 0);
    topRiskContributors = covarianceResult.symbols.map((symbol, index) => {
      const varianceContribution = normalizedWeights[index] * sigmaW[index];
      return rowRef({
        masterFundId: symbol,
        name: groups.find((group) => group.masterFundId === symbol)?.name || symbol,
        weight: normalizedWeights[index],
        varianceContribution,
        riskShare: portfolioVariance > 0 ? varianceContribution / portfolioVariance : null,
        canBeNegative: true,
        entropyApplied: false,
      });
    }).sort((left, right) => Math.abs(right.varianceContribution) - Math.abs(left.varianceContribution)).slice(0, 5);
  }

  const goalImpact = (input.goals || []).map((goal, index) => {
    if (!goal || typeof goal !== 'object') throw new TypeError(`goals[${index}] must be an object`);
    const before = normalizeGoalState(goal.before || goal);
    const afterInput = goal.afterAction || goal.after || goal.proposed;
    const after = afterInput ? normalizeGoalState({ ...goal, ...afterInput }) : null;
    return rowRef({
      goalId: String(goal.goalId ?? `goal-${index + 1}`),
      name: String(goal.name ?? goal.goalName ?? goal.type ?? `เป้าหมาย ${index + 1}`),
      targetAmount: goalMetric(goal, ['targetAmount', 'target']),
      targetDate: goal.targetDate || null,
      before,
      after,
      afterAvailable: Boolean(after),
      change: after ? {
        fundedRatio: after.fundedRatio != null && before.fundedRatio != null ? after.fundedRatio - before.fundedRatio : null,
        baseSuccessProbability: after.baseSuccessProbability != null && before.baseSuccessProbability != null ? after.baseSuccessProbability - before.baseSuccessProbability : null,
        stressSuccessProbability: after.stressSuccessProbability != null && before.stressSuccessProbability != null ? after.stressSuccessProbability - before.stressSuccessProbability : null,
        shortfall: after.shortfall != null && before.shortfall != null ? after.shortfall - before.shortfall : null,
        requiredMonthlyContribution: after.requiredMonthlyContribution != null && before.requiredMonthlyContribution != null ? after.requiredMonthlyContribution - before.requiredMonthlyContribution : null,
      } : null,
    });
  });

  const marketBeta = metric(beta.value, 'beta', 'MARKET_BETA_COMMON_DATES_V3', {
    available: beta.available,
    observationCount: beta.observationCount,
    startDate: beta.startDate || null,
    endDate: beta.endDate || null,
    alignment: beta.alignment || 'actual common dates only; no forward-filled returns',
    reasonCode: beta.reasonCode || null,
  });
  const summary = {
    startBalance: metric(series[0].value, audit.currency, 'STARTING_PORTFOLIO_VALUE_V3'),
    netContribution: metric(contributions, audit.currency, 'SUM_POSITIVE_EXTERNAL_CASH_FLOWS_V3'),
    netWithdrawal: metric(withdrawals, audit.currency, 'ABS_SUM_NEGATIVE_EXTERNAL_CASH_FLOWS_V3'),
    netCashFlow: metric(contributions - withdrawals, audit.currency, 'NET_EXTERNAL_CASH_FLOW_V3'),
    endBalance: metric(series.at(-1).value, audit.currency, 'ENDING_PORTFOLIO_VALUE_V3'),
    periodPnl: metric(periodPnl, audit.currency, 'CASH_FLOW_ADJUSTED_PERIOD_PNL_V3', {
      available: true,
      cashFlowConvention: 'ending balance - starting balance - contributions + withdrawals',
      reasonCode: 'CASH_FLOW_ADJUSTED_PORTFOLIO_PNL',
    }),
    realizedPnl: unavailableMetric(
      audit.currency,
      'REALIZED_PNL_REQUIRES_GOVERNED_COST_BASIS_V3',
      'GOVERNED_COST_BASIS_AND_DISPOSAL_TRANSACTIONS_NOT_SUPPLIED',
      ['governed acquisition cost basis', 'governed disposal transactions', 'approved cost-basis method'],
      'Realized P&L is not inferred from portfolio value or cash flows because withdrawals are not necessarily disposals and transaction-level cost basis is unavailable.'
    ),
    unrealizedPnl: unavailableMetric(
      audit.currency,
      'UNREALIZED_PNL_REQUIRES_GOVERNED_REMAINING_COST_BASIS_V3',
      'GOVERNED_REMAINING_COST_BASIS_NOT_SUPPLIED',
      ['governed remaining units', 'governed remaining cost basis', 'current governed valuation'],
      'Unrealized P&L is not inferred until remaining-lot cost basis can be reconciled to the governed portfolio valuation.'
    ),
    twr: metric(twr.twr, 'decimal return', twr.audit.formulaId),
    xirr: metric(xirr.xirr, 'decimal annual rate', xirr.audit.formulaId),
    cagr: metric(cagr ? cagr.cagr : null, 'decimal annual rate', 'CAGR_NO_FLOWS_ACT_36525_V3', {
      valid: Boolean(cagr),
      reasonCode: cagr ? null : 'EXTERNAL_CASH_FLOWS_PRESENT',
    }),
    expectedReturn: metric(expectedReturnValue, 'decimal annual rate', 'EXPECTED_RETURN_EXPLICIT_METHOD_V3', {
      method: expectedReturnMethod,
      limitation: expectedReturnLimitation,
    }),
    annualizedVolatility: metric(governedPerformance.volatility.annualizedVolatility, 'decimal annual volatility', governedPerformance.volatility.audit.formulaId),
    bestYear: metric(bestYear ? bestYear.value : null, 'decimal calendar-year return', 'BEST_CALENDAR_YEAR_FROM_COMPLETE_YEARS_V3', { year: bestYear ? bestYear.year : null }),
    worstYear: metric(worstYear ? worstYear.value : null, 'decimal calendar-year return', 'WORST_CALENDAR_YEAR_FROM_COMPLETE_YEARS_V3', { year: worstYear ? worstYear.year : null }),
    maximumDrawdown: metric(governedPerformance.drawdown.maxDrawdown, 'decimal drawdown', governedPerformance.drawdown.audit.formulaId, {
      peakDate: governedPerformance.drawdown.peakDate,
      troughDate: governedPerformance.drawdown.troughDate,
      recoveryDate: governedPerformance.drawdown.recoveryDate,
    }),
    sharpe: metric(governedPerformance.sharpe.sharpe, 'ratio', governedPerformance.sharpe.audit.formulaId),
    sortino: metric(governedPerformance.sortino.sortino, 'ratio', governedPerformance.sortino.audit.formulaId),
    calmar: metric(governedPerformance.calmar.calmar, 'ratio', governedPerformance.calmar.audit.formulaId),
    downsideDeviation: metric(governedPerformance.downsideDeviation.annualizedDownsideDeviation, 'decimal annual downside deviation', governedPerformance.downsideDeviation.audit.formulaId),
    historicalVaR: metric(governedPerformance.historicalRisk.var, 'decimal periodic loss', governedPerformance.historicalRisk.audit.formulaId, { confidenceLevel: governedPerformance.historicalRisk.confidenceLevel }),
    historicalCVaR: metric(governedPerformance.historicalRisk.cvar, 'decimal periodic loss', governedPerformance.historicalRisk.audit.formulaId, { confidenceLevel: governedPerformance.historicalRisk.confidenceLevel }),
    marketBeta,
    observationCount: metric(derivedReturns.length, 'return observations', 'COMMON_GOVERNED_RETURN_OBSERVATION_COUNT_V3'),
    effectiveHoldings: metric(effectiveHoldings.effectiveHoldings, 'effective master-fund holdings', effectiveHoldings.audit.formulaId),
  };

  audit.calculationTrace = {
    twrFormulaId: twr.audit.formulaId,
    xirrFormulaId: xirr.audit.formulaId,
    performanceFormulaId: governedPerformance.audit.formulaId,
    periodPnlFormulaId: summary.periodPnl.formulaId,
    covarianceFormulaId: covarianceResult ? covarianceResult.audit.formulaId : null,
    chartsAndTablesUseSameReturnSeries: true,
  };

  return {
    summary,
    drawdownSeries: governedPerformance.drawdown.series.map(rowRef),
    drawdownEvents: {
      peakDate: governedPerformance.drawdown.peakDate,
      troughDate: governedPerformance.drawdown.troughDate,
      recoveryDate: governedPerformance.drawdown.recoveryDate,
      resultRef: ref,
    },
    calendarYearReturns: calendarYears.map(rowRef),
    monthlyReturnHeatmap: monthly.map(rowRef),
    rolling12MReturns: rolling.rollingReturns.map(rowRef),
    rollingVolatility: rolling.rollingVolatility.map(rowRef),
    marketBeta,
    correlationMatrix: covarianceResult ? {
      available: true,
      symbols: covarianceResult.symbols,
      matrix: covarianceResult.correlation,
      observationCount: covarianceResult.observationCount,
      commonDates: covarianceResult.commonDates,
      alignment: covarianceResult.alignment,
      excluded: covarianceResult.excluded,
      resultRef: ref,
    } : {
      available: false,
      symbols: correlationSymbols,
      matrix: [],
      observationCount: 0,
      commonDates: [],
      alignment: 'actual common dates only; no forward-filled returns',
      excluded: [],
      reasonCode: 'INSUFFICIENT_COMMON_HOLDING_RETURNS',
      resultRef: ref,
    },
    concentrationRisks,
    duplicationWarnings,
    currencyExposure,
    topRiskContributors,
    goalImpact,
    audit,
  };
}

module.exports = {
  buildPortfolioAnalytics,
};
