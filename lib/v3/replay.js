'use strict';

// Governed walk-forward validation for the FIN AI RM Cockpit. This module is
// intentionally a policy and calculation validator, not an alpha optimiser.
// A decision made at t is built from a point-in-time snapshot at t, frozen, and
// only then evaluated with observations available at the next monthly date.

const crypto = require('node:crypto');
const { createHistoricalReplayFixtures } = require('./replay-fixtures');
const {
  calculateTWR,
  calculateXIRR,
  calculateAnnualizedVolatility,
} = require('./quant');

const RESULT_TYPES = Object.freeze({
  HISTORICAL_REPLAY: 'HISTORICAL_REPLAY',
  NAMED_STRESS: 'NAMED_STRESS',
  FORWARD_SIMULATION: 'FORWARD_SIMULATION',
  SYNTHETIC_SCENARIO: 'SYNTHETIC_SCENARIO',
  LIVE_PILOT: 'LIVE_PILOT',
});

const STRATEGY_IDS = Object.freeze({
  CURRENT_NO_ACTION: 'CURRENT_NO_ACTION',
  ELIGIBLE_APPROVED_MODEL: 'ELIGIBLE_APPROVED_MODEL',
  SIMPLE_POLICY_BENCHMARK: 'SIMPLE_POLICY_BENCHMARK',
  GOAL_BASED_CANDIDATE: 'GOAL_BASED_CANDIDATE',
});

const STRATEGY_ORDER = Object.freeze(Object.values(STRATEGY_IDS));
const REQUIRED_METRICS = Object.freeze([
  'twr',
  'xirr',
  'annualizedVolatility',
  'goalSuccessRate',
  'normalizedGoalShortfall',
  'empiricalCVaR',
  'maximumDrawdown',
  'turnover',
  'productFeeEstimate',
  'transactionCost',
  'estimatedTotalCost',
  'liquidityViolations',
  'suitabilityViolations',
  'careAlerts',
  'falsePositiveAlertRate',
  'rmWorkloadGenerated',
]);

const BUCKET_RISK_LEVEL = Object.freeze({
  CASH: 1,
  FIXED_INCOME: 4,
  BALANCED: 5,
  THAI_EQUITY: 6,
  GLOBAL_EQUITY: 6,
  REAL_ASSET: 8,
});

const BENCHMARK_BUCKET = Object.freeze({
  'BM-TH-CASH': 'CASH',
  'BM-TH-BOND': 'FIXED_INCOME',
  'BM-TH-EQUITY': 'THAI_EQUITY',
  'BM-GLOBAL-EQUITY': 'GLOBAL_EQUITY',
  'BM-REAL-ASSET': 'REAL_ASSET',
});

function canonicalize(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
    return output;
  }
  return String(value);
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function normalizeDate(value, name = 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${name} must be YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${name} must be a valid date`);
  }
  return value;
}

function addMonths(value, months) {
  const date = new Date(`${normalizeDate(value)}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function daysBetween(startDate, endDate) {
  const start = new Date(`${normalizeDate(startDate)}T00:00:00.000Z`).getTime();
  const end = new Date(`${normalizeDate(endDate)}T00:00:00.000Z`).getTime();
  return (end - start) / 86400000;
}

function latestAvailableVersion(records, asOf, options = {}) {
  if (!Array.isArray(records)) return null;
  const effectiveField = options.effectiveField || 'effectiveFrom';
  const availableField = options.availableField || 'publishedAt';
  const candidates = records.filter((record) => {
    const effective = record[effectiveField];
    const available = record[availableField];
    if (!effective || !available || effective > asOf || available > asOf) return false;
    if (record.validTo && record.validTo < asOf) return false;
    return true;
  });
  candidates.sort((a, b) => {
    const effective = a[effectiveField].localeCompare(b[effectiveField]);
    if (effective !== 0) return effective;
    const available = a[availableField].localeCompare(b[availableField]);
    if (available !== 0) return available;
    return String(a.versionId || a.snapshotId || a.modelId || '').localeCompare(
      String(b.versionId || b.snapshotId || b.modelId || '')
    );
  });
  return candidates.length ? { ...candidates[candidates.length - 1] } : null;
}

function maxDate(values) {
  const present = values.filter(Boolean);
  return present.length ? present.sort().at(-1) : null;
}

function buildPointInTimeSnapshot(fixtures, asOfValue) {
  if (!fixtures || typeof fixtures !== 'object') throw new TypeError('fixtures are required');
  const asOf = normalizeDate(asOfValue, 'asOf');
  if (fixtures.availableThrough && asOf > fixtures.availableThrough) {
    throw new RangeError(`asOf ${asOf} is after fixture availability ${fixtures.availableThrough}`);
  }

  const funds = [];
  const inputRefs = [];
  const excludedUnavailableRevisionIds = [];
  for (const sourceFund of fixtures.funds || []) {
    if (sourceFund.inceptionDate > asOf) continue;
    const classification = latestAvailableVersion(sourceFund.classificationHistory, asOf);
    const factsheet = latestAvailableVersion(sourceFund.factsheetHistory, asOf, {
      effectiveField: 'asOf', availableField: 'publishedAt',
    });
    const shelf = latestAvailableVersion(sourceFund.shelfHistory, asOf);
    const dataQuality = latestAvailableVersion(sourceFund.qualityHistory, asOf);
    const navHistory = (sourceFund.navHistory || [])
      .filter((row) => row.date <= asOf && row.availableAt <= asOf)
      .map((row) => ({ ...row }));
    for (const [history, effectiveField, availableField] of [
      [sourceFund.classificationHistory, 'effectiveFrom', 'publishedAt'],
      [sourceFund.factsheetHistory, 'asOf', 'publishedAt'],
      [sourceFund.shelfHistory, 'effectiveFrom', 'publishedAt'],
      [sourceFund.qualityHistory, 'effectiveFrom', 'publishedAt'],
    ]) {
      for (const record of history || []) {
        if (record[effectiveField] <= asOf && record[availableField] > asOf) {
          excludedUnavailableRevisionIds.push(record.versionId || record.sourceRef);
        }
      }
    }
    for (const row of sourceFund.navHistory || []) {
      if (row.date <= asOf && row.availableAt > asOf) {
        excludedUnavailableRevisionIds.push(row.sourceRef);
      }
    }
    const lastNav = navHistory.at(-1) || null;
    const fund = {
      fundId: sourceFund.fundId,
      masterFundId: sourceFund.masterFundId,
      fundCode: sourceFund.fundCode,
      nameTh: sourceFund.nameTh,
      nameEn: sourceFund.nameEn,
      amcCode: sourceFund.amcCode,
      thaiRegistered: sourceFund.thaiRegistered,
      currency: sourceFund.currency,
      inceptionDate: sourceFund.inceptionDate,
      synthetic: sourceFund.synthetic === true,
      classification,
      factsheet,
      shelf,
      dataQuality,
      navHistory,
    };
    funds.push(fund);
    for (const [kind, record, observedField, availableField] of [
      ['CLASSIFICATION', classification, 'effectiveFrom', 'publishedAt'],
      ['FACTSHEET', factsheet, 'asOf', 'publishedAt'],
      ['APPROVED_SHELF', shelf, 'effectiveFrom', 'publishedAt'],
      ['DATA_QUALITY', dataQuality, 'effectiveFrom', 'publishedAt'],
    ]) {
      if (!record) continue;
      inputRefs.push({
        kind,
        entityId: sourceFund.fundId,
        versionId: record.versionId,
        observedAt: record[observedField],
        availableAt: record[availableField],
        sourceRef: record.sourceRef,
      });
    }
    if (lastNav) {
      inputRefs.push({
        kind: 'NAV_SERIES',
        entityId: sourceFund.fundId,
        versionId: `${sourceFund.fundId}:${navHistory[0].date}/${lastNav.date}`,
        observedAt: lastNav.date,
        availableAt: lastNav.availableAt,
        observationCount: navHistory.length,
        lastValue: lastNav.nav,
        sourceRef: lastNav.sourceRef,
      });
    }
  }

  const benchmarks = (fixtures.benchmarks || []).map((sourceBenchmark) => {
    const history = (sourceBenchmark.history || [])
      .filter((row) => row.date <= asOf && row.availableAt <= asOf)
      .map((row) => ({ ...row }));
    for (const row of sourceBenchmark.history || []) {
      if (row.date <= asOf && row.availableAt > asOf) {
        excludedUnavailableRevisionIds.push(row.sourceRef);
      }
    }
    const last = history.at(-1);
    if (last) {
      inputRefs.push({
        kind: 'BENCHMARK_SERIES',
        entityId: sourceBenchmark.benchmarkId,
        versionId: `${sourceBenchmark.benchmarkId}:${history[0].date}/${last.date}`,
        observedAt: last.date,
        availableAt: last.availableAt,
        observationCount: history.length,
        lastValue: last.level,
        sourceRef: last.sourceRef,
      });
    }
    return {
      benchmarkId: sourceBenchmark.benchmarkId,
      nameTh: sourceBenchmark.nameTh,
      bucket: sourceBenchmark.bucket,
      synthetic: sourceBenchmark.synthetic === true,
      history,
    };
  });

  const holdings = latestAvailableVersion(fixtures.portfolioHoldings, asOf, {
    effectiveField: 'asOf', availableField: 'availableAt',
  });
  const client = latestAvailableVersion(fixtures.clientSnapshots, asOf, {
    effectiveField: 'asOf', availableField: 'availableAt',
  });
  const approvedModel = latestAvailableVersion(fixtures.approvedModels, asOf);
  const policyBenchmark = latestAvailableVersion(fixtures.policyBenchmarks, asOf);
  const assumptions = latestAvailableVersion(fixtures.capitalMarketAssumptions, asOf);

  for (const [records, effectiveField, availableField] of [
    [fixtures.portfolioHoldings, 'asOf', 'availableAt'],
    [fixtures.clientSnapshots, 'asOf', 'availableAt'],
    [fixtures.approvedModels, 'effectiveFrom', 'publishedAt'],
    [fixtures.policyBenchmarks, 'effectiveFrom', 'publishedAt'],
    [fixtures.capitalMarketAssumptions, 'effectiveFrom', 'publishedAt'],
  ]) {
    for (const record of records || []) {
      if (record[effectiveField] <= asOf && record[availableField] > asOf) {
        excludedUnavailableRevisionIds.push(
          record.versionId || record.snapshotId || record.modelId || record.policyId || record.assumptionId || record.sourceRef
        );
      }
    }
  }

  for (const [kind, record, observedField, availableField] of [
    ['PORTFOLIO_HOLDINGS', holdings, 'asOf', 'availableAt'],
    ['CLIENT_SNAPSHOT', client, 'asOf', 'availableAt'],
    ['APPROVED_MODEL', approvedModel, 'effectiveFrom', 'publishedAt'],
    ['POLICY_BENCHMARK', policyBenchmark, 'effectiveFrom', 'publishedAt'],
    ['ASSUMPTION', assumptions, 'effectiveFrom', 'publishedAt'],
  ]) {
    if (!record) continue;
    inputRefs.push({
      kind,
      entityId: record.portfolioId || record.clientId || record.modelId || record.policyId || record.assumptionId,
      versionId: record.snapshotId || record.modelId || record.policyId || record.assumptionId,
      observedAt: record[observedField],
      availableAt: record[availableField],
      sourceRef: record.sourceRef,
    });
  }

  const marketEvents = (fixtures.marketEvents || [])
    .filter((event) => event.startedAt <= asOf && event.detectedAt <= asOf)
    .map((event) => {
      const closureKnown = Boolean(event.closurePublishedAt && event.closurePublishedAt <= asOf);
      const visible = {
        eventId: event.eventId,
        nameTh: event.nameTh,
        startedAt: event.startedAt,
        detectedAt: event.detectedAt,
        affectedBuckets: [...event.affectedBuckets],
        severity: event.severity,
        status: closureKnown ? 'CLOSED' : 'ACTIVE',
        endedAt: closureKnown ? event.endedAt : null,
        closurePublishedAt: closureKnown ? event.closurePublishedAt : null,
        sourceRef: event.sourceRef,
      };
      inputRefs.push({
        kind: 'MARKET_EVENT',
        entityId: event.eventId,
        versionId: event.eventId,
        observedAt: event.startedAt,
        availableAt: event.detectedAt,
        sourceRef: event.sourceRef,
      });
      if (closureKnown) {
        inputRefs.push({
          kind: 'MARKET_EVENT_CLOSURE',
          entityId: event.eventId,
          versionId: `${event.eventId}:closure`,
          observedAt: event.endedAt,
          availableAt: event.closurePublishedAt,
          sourceRef: event.sourceRef,
        });
      }
      return visible;
    });

  const lineage = {
    inputRefs,
    maxObservedAt: maxDate(inputRefs.map((ref) => ref.observedAt)),
    maxAvailableAt: maxDate(inputRefs.map((ref) => ref.availableAt)),
    excludedUnavailableRevisionIds: [...new Set(excludedUnavailableRevisionIds)].sort(),
  };
  lineage.inputHash = stableHash({
    datasetId: fixtures.datasetId,
    asOf,
    inputRefs,
    acceptedPointInTimeInputs: {
      dataOrigin: fixtures.origin,
      currency: fixtures.currency,
      returnType: fixtures.returnType,
      isTotalReturn: fixtures.isTotalReturn,
      funds,
      benchmarks,
      holdings,
      client,
      approvedModel,
      policyBenchmark,
      assumptions,
      marketEvents,
    },
  });

  const snapshot = {
    datasetId: fixtures.datasetId,
    asOf,
    dataOrigin: fixtures.origin,
    currency: fixtures.currency,
    returnType: fixtures.returnType,
    isTotalReturn: fixtures.isTotalReturn,
    funds,
    benchmarks,
    holdings,
    client,
    approvedModel,
    policyBenchmark,
    assumptions,
    marketEvents,
    lineage,
  };
  assertPointInTimeSnapshot(snapshot);
  snapshot.pointInTimeValidated = true;
  return snapshot;
}

function assertNotAfter(value, asOf, label) {
  if (value && value > asOf) throw new RangeError(`${label} ${value} is after replay date ${asOf}`);
}

function assertPointInTimeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('snapshot is required');
  const asOf = normalizeDate(snapshot.asOf, 'snapshot.asOf');
  for (const fund of snapshot.funds || []) {
    if (fund.inceptionDate > asOf) throw new RangeError(`future fund ${fund.fundId} leaked into ${asOf}`);
    for (const row of fund.navHistory || []) {
      assertNotAfter(row.date, asOf, `${fund.fundId} NAV observation`);
      assertNotAfter(row.availableAt, asOf, `${fund.fundId} NAV availability`);
    }
    for (const [name, record, effectiveField, availableField] of [
      ['classification', fund.classification, 'effectiveFrom', 'publishedAt'],
      ['factsheet', fund.factsheet, 'asOf', 'publishedAt'],
      ['shelf', fund.shelf, 'effectiveFrom', 'publishedAt'],
      ['data quality', fund.dataQuality, 'effectiveFrom', 'publishedAt'],
    ]) {
      if (!record) continue;
      assertNotAfter(record[effectiveField], asOf, `${fund.fundId} ${name} effective date`);
      assertNotAfter(record[availableField], asOf, `${fund.fundId} ${name} availability`);
    }
  }
  for (const benchmark of snapshot.benchmarks || []) {
    for (const row of benchmark.history || []) {
      assertNotAfter(row.date, asOf, `${benchmark.benchmarkId} observation`);
      assertNotAfter(row.availableAt, asOf, `${benchmark.benchmarkId} availability`);
    }
  }
  for (const [name, record, observedField, availableField] of [
    ['holdings', snapshot.holdings, 'asOf', 'availableAt'],
    ['client', snapshot.client, 'asOf', 'availableAt'],
    ['approved model', snapshot.approvedModel, 'effectiveFrom', 'publishedAt'],
    ['policy benchmark', snapshot.policyBenchmark, 'effectiveFrom', 'publishedAt'],
    ['assumption', snapshot.assumptions, 'effectiveFrom', 'publishedAt'],
  ]) {
    if (!record) continue;
    assertNotAfter(record[observedField], asOf, `${name} observed date`);
    assertNotAfter(record[availableField], asOf, `${name} availability`);
  }
  for (const event of snapshot.marketEvents || []) {
    assertNotAfter(event.startedAt, asOf, `${event.eventId} start`);
    assertNotAfter(event.detectedAt, asOf, `${event.eventId} detection`);
    if (event.endedAt) {
      assertNotAfter(event.endedAt, asOf, `${event.eventId} end`);
      assertNotAfter(event.closurePublishedAt, asOf, `${event.eventId} closure availability`);
    }
  }
  for (const ref of snapshot.lineage?.inputRefs || []) {
    assertNotAfter(ref.observedAt, asOf, `${ref.kind} observed date`);
    assertNotAfter(ref.availableAt, asOf, `${ref.kind} availability`);
  }
  if (snapshot.lineage?.maxObservedAt) assertNotAfter(snapshot.lineage.maxObservedAt, asOf, 'lineage max observed date');
  if (snapshot.lineage?.maxAvailableAt) assertNotAfter(snapshot.lineage.maxAvailableAt, asOf, 'lineage max availability');
  return true;
}

function evaluateFundEligibility(fund, client, options = {}) {
  const minNavObservations = options.minNavObservations == null ? 20 : options.minNavObservations;
  const reasonCodes = [];
  if (!fund.thaiRegistered) reasonCodes.push('NOT_THAI_REGISTERED');
  if (!fund.classification) reasonCodes.push('CLASSIFICATION_UNAVAILABLE');
  if (!fund.factsheet) reasonCodes.push('FACTSHEET_UNAVAILABLE');
  if (!fund.shelf || fund.shelf.status !== 'APPROVED') reasonCodes.push('NOT_ON_APPROVED_SHELF');
  if (!fund.shelf || !Array.isArray(fund.shelf.permissions) || !fund.shelf.permissions.includes('ADVISE')) {
    reasonCodes.push('ADVICE_PERMISSION_MISSING');
  }
  if (!fund.dataQuality || fund.dataQuality.status !== 'PASS') reasonCodes.push('DATA_QUALITY_FAILED');
  if (!client || !client.suitability || client.suitability.current !== true) reasonCodes.push('SUITABILITY_NOT_CURRENT');
  if (fund.classification && client?.suitability
    && fund.classification.riskLevel > client.suitability.maxRiskLevel) {
    reasonCodes.push('RISK_LEVEL_EXCEEDS_SUITABILITY');
  }
  if ((fund.navHistory || []).length < minNavObservations) reasonCodes.push('INSUFFICIENT_NAV_HISTORY');
  return {
    fundId: fund.fundId,
    eligible: reasonCodes.length === 0,
    reasonCodes,
    checkedAsOf: fund.navHistory?.at(-1)?.availableAt || null,
  };
}

function normalizeWeights(weights) {
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) throw new TypeError('weights must be an object');
  const cleaned = {};
  let total = 0;
  for (const [key, value] of Object.entries(weights)) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new RangeError(`weight ${key} must be finite and non-negative`);
    if (number === 0) continue;
    cleaned[key] = number;
    total += number;
  }
  if (!(total > 0)) throw new RangeError('weights must have a positive sum');
  for (const key of Object.keys(cleaned)) cleaned[key] /= total;
  return cleaned;
}

function bucketWeightsFromFundWeights(snapshot, weights) {
  const fundMap = new Map(snapshot.funds.map((fund) => [fund.fundId, fund]));
  const buckets = {};
  for (const [fundId, weight] of Object.entries(weights)) {
    const bucket = fundMap.get(fundId)?.classification?.policyBucket || 'UNKNOWN';
    buckets[bucket] = (buckets[bucket] || 0) + weight;
  }
  return normalizeWeights(buckets);
}

function chooseEligibleFunds(snapshot, targetBucketWeights, options = {}) {
  const minNavObservations = options.minNavObservations == null ? 20 : options.minNavObservations;
  const eligible = snapshot.funds
    .map((fund) => ({ fund, eligibility: evaluateFundEligibility(fund, snapshot.client, { minNavObservations }) }))
    .filter((item) => item.eligibility.eligible);
  const cashFund = eligible
    .filter((item) => item.fund.classification.policyBucket === 'CASH')
    .sort((a, b) => a.fund.factsheet.annualFeePct - b.fund.factsheet.annualFeePct
      || a.fund.fundId.localeCompare(b.fund.fundId))[0];
  if (!cashFund) throw new RangeError(`no eligible cash fund at ${snapshot.asOf}`);

  const weights = {};
  const selections = [];
  const reasonCodes = [];
  for (const [bucket, targetWeight] of Object.entries(targetBucketWeights)) {
    if (!(targetWeight > 0)) continue;
    const candidates = eligible
      .filter((item) => item.fund.classification.policyBucket === bucket)
      .sort((a, b) => a.fund.factsheet.annualFeePct - b.fund.factsheet.annualFeePct
        || a.fund.fundId.localeCompare(b.fund.fundId));
    const selected = candidates[0] || cashFund;
    if (!candidates.length) reasonCodes.push(`BUCKET_${bucket}_FALLBACK_TO_CASH`);
    weights[selected.fund.fundId] = (weights[selected.fund.fundId] || 0) + targetWeight;
    selections.push({
      requestedBucket: bucket,
      selectedFundId: selected.fund.fundId,
      selectedBucket: selected.fund.classification.policyBucket,
      targetWeight,
      fallbackUsed: !candidates.length,
      eligibility: selected.eligibility,
      sourceRefs: [selected.fund.shelf.sourceRef, selected.fund.factsheet.sourceRef, selected.fund.classification.sourceRef],
    });
  }
  return { weights: normalizeWeights(weights), selections, reasonCodes: [...new Set(reasonCodes)] };
}

function currentAlternative(snapshot) {
  if (!snapshot.holdings) throw new RangeError(`portfolio holdings unavailable at ${snapshot.asOf}`);
  const weights = normalizeWeights(Object.fromEntries(
    snapshot.holdings.holdings.map((holding) => [holding.fundId, holding.weight])
  ));
  return {
    strategyId: STRATEGY_IDS.CURRENT_NO_ACTION,
    nameTh: 'พอร์ตปัจจุบัน / ไม่ดำเนินการ',
    instrumentType: 'FUND',
    weights,
    bucketWeights: bucketWeightsFromFundWeights(snapshot, weights),
    policyRule: 'OBSERVED_CURRENT_PORTFOLIO_HELD_WITH_NO_TRADE_UNTIL_NEXT_MONTH',
    eligibleOnly: false,
    reasonCodes: ['NO_ACTION_COMPARATOR'],
    sourceRefs: [snapshot.holdings.sourceRef],
  };
}

function approvedModelAlternative(snapshot, options = {}) {
  if (!snapshot.approvedModel) throw new RangeError(`approved model unavailable at ${snapshot.asOf}`);
  const selection = chooseEligibleFunds(snapshot, snapshot.approvedModel.weights, options);
  return {
    strategyId: STRATEGY_IDS.ELIGIBLE_APPROVED_MODEL,
    nameTh: 'แบบพอร์ตที่อนุมัติและลูกค้ามีสิทธิ์',
    instrumentType: 'FUND',
    weights: selection.weights,
    bucketWeights: bucketWeightsFromFundWeights(snapshot, selection.weights),
    policyRule: 'APPROVED_MODEL_WITH_POINT_IN_TIME_ELIGIBILITY',
    modelId: snapshot.approvedModel.modelId,
    eligibleOnly: true,
    selections: selection.selections,
    reasonCodes: selection.reasonCodes,
    sourceRefs: [snapshot.approvedModel.sourceRef, ...selection.selections.flatMap((item) => item.sourceRefs)],
  };
}

function policyBenchmarkAlternative(snapshot) {
  if (!snapshot.policyBenchmark) throw new RangeError(`policy benchmark unavailable at ${snapshot.asOf}`);
  const weights = normalizeWeights(snapshot.policyBenchmark.weights);
  const bucketWeights = {};
  for (const [benchmarkId, weight] of Object.entries(weights)) {
    const bucket = BENCHMARK_BUCKET[benchmarkId];
    if (!bucket) throw new RangeError(`unknown benchmark bucket for ${benchmarkId}`);
    bucketWeights[bucket] = (bucketWeights[bucket] || 0) + weight;
  }
  return {
    strategyId: STRATEGY_IDS.SIMPLE_POLICY_BENCHMARK,
    nameTh: 'เกณฑ์นโยบายแบบง่าย',
    instrumentType: 'BENCHMARK',
    weights,
    bucketWeights: normalizeWeights(bucketWeights),
    policyRule: 'FIXED_POLICY_BENCHMARK_NO_ALPHA_SELECTION',
    eligibleOnly: false,
    reasonCodes: ['NON_INVESTABLE_COMPARATOR'],
    sourceRefs: [snapshot.policyBenchmark.sourceRef],
  };
}

function monthsUntil(startDate, endDate) {
  if (endDate <= startDate) return 0;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return Math.max(0, (end.getUTCFullYear() - start.getUTCFullYear()) * 12
    + end.getUTCMonth() - start.getUTCMonth());
}

function goalPolicyWeights(snapshot, wealth) {
  const horizonMonths = monthsUntil(snapshot.asOf, snapshot.client.goal.targetDate);
  const protectedLiquidityRatio = Math.min(0.60, snapshot.client.liquidityReserve / Math.max(wealth, 1));
  let weights;
  if (horizonMonths <= 12) {
    weights = { CASH: Math.max(0.40, protectedLiquidityRatio), FIXED_INCOME: 0.50, BALANCED: 0.10 };
  } else if (horizonMonths <= 24) {
    weights = { CASH: Math.max(0.30, protectedLiquidityRatio), FIXED_INCOME: 0.50, BALANCED: 0.10, THAI_EQUITY: 0.05, GLOBAL_EQUITY: 0.05 };
  } else if (horizonMonths <= 36) {
    weights = { CASH: Math.max(0.20, protectedLiquidityRatio), FIXED_INCOME: 0.40, BALANCED: 0.10, THAI_EQUITY: 0.15, GLOBAL_EQUITY: 0.10, REAL_ASSET: 0.05 };
  } else {
    weights = { CASH: Math.max(0.15, protectedLiquidityRatio), FIXED_INCOME: 0.30, BALANCED: 0.10, THAI_EQUITY: 0.20, GLOBAL_EQUITY: 0.15, REAL_ASSET: 0.10 };
  }
  return { weights: normalizeWeights(weights), horizonMonths, protectedLiquidityRatio };
}

function goalBasedAlternative(snapshot, wealth, options = {}) {
  const policy = goalPolicyWeights(snapshot, wealth);
  const selection = chooseEligibleFunds(snapshot, policy.weights, options);
  return {
    strategyId: STRATEGY_IDS.GOAL_BASED_CANDIDATE,
    nameTh: 'ทางเลือกตามเป้าหมายและสภาพคล่อง',
    instrumentType: 'FUND',
    weights: selection.weights,
    bucketWeights: bucketWeightsFromFundWeights(snapshot, selection.weights),
    policyRule: 'GOAL_HORIZON_AND_LIQUIDITY_RULE_NO_ALPHA_OPTIMISATION',
    eligibleOnly: true,
    horizonMonths: policy.horizonMonths,
    protectedLiquidityRatio: policy.protectedLiquidityRatio,
    selections: selection.selections,
    reasonCodes: ['LIQUIDITY_FIRST', ...selection.reasonCodes],
    sourceRefs: [snapshot.client.sourceRef, ...selection.selections.flatMap((item) => item.sourceRefs)],
  };
}

function buildReplayAlternatives(snapshot, options = {}) {
  const wealth = Number(options.wealth ?? snapshot.client?.goal?.startingFunding);
  if (!(wealth > 0)) throw new RangeError('wealth must be greater than zero');
  return {
    [STRATEGY_IDS.CURRENT_NO_ACTION]: currentAlternative(snapshot),
    [STRATEGY_IDS.ELIGIBLE_APPROVED_MODEL]: approvedModelAlternative(snapshot, options),
    [STRATEGY_IDS.SIMPLE_POLICY_BENCHMARK]: policyBenchmarkAlternative(snapshot),
    [STRATEGY_IDS.GOAL_BASED_CANDIDATE]: goalBasedAlternative(snapshot, wealth, options),
  };
}

function lastObservation(history) {
  if (!Array.isArray(history) || !history.length) return null;
  return history[history.length - 1];
}

function realizedReturnForAlternative(alternative, startSnapshot, endSnapshot) {
  const evaluationRefs = [];
  let grossReturn = 0;
  if (alternative.instrumentType === 'FUND') {
    const startFunds = new Map(startSnapshot.funds.map((fund) => [fund.fundId, fund]));
    const endFunds = new Map(endSnapshot.funds.map((fund) => [fund.fundId, fund]));
    for (const [fundId, weight] of Object.entries(alternative.weights)) {
      const start = lastObservation(startFunds.get(fundId)?.navHistory);
      const end = lastObservation(endFunds.get(fundId)?.navHistory);
      if (!start || !end || !(start.nav > 0) || end.date <= start.date) {
        throw new RangeError(`cannot evaluate ${fundId} from ${startSnapshot.asOf} to ${endSnapshot.asOf}`);
      }
      const componentReturn = end.nav / start.nav - 1;
      grossReturn += weight * componentReturn;
      evaluationRefs.push({
        instrumentId: fundId,
        sourceType: 'NAV_RETURN',
        weight,
        startDate: start.date,
        startAvailableAt: start.availableAt,
        endDate: end.date,
        endAvailableAt: end.availableAt,
        componentReturn,
        sourceRefs: [start.sourceRef, end.sourceRef],
      });
    }
  } else {
    const startBenchmarks = new Map(startSnapshot.benchmarks.map((item) => [item.benchmarkId, item]));
    const endBenchmarks = new Map(endSnapshot.benchmarks.map((item) => [item.benchmarkId, item]));
    for (const [benchmarkId, weight] of Object.entries(alternative.weights)) {
      const start = lastObservation(startBenchmarks.get(benchmarkId)?.history);
      const end = lastObservation(endBenchmarks.get(benchmarkId)?.history);
      if (!start || !end || !(start.level > 0) || end.date <= start.date) {
        throw new RangeError(`cannot evaluate ${benchmarkId} from ${startSnapshot.asOf} to ${endSnapshot.asOf}`);
      }
      const componentReturn = end.level / start.level - 1;
      grossReturn += weight * componentReturn;
      evaluationRefs.push({
        instrumentId: benchmarkId,
        sourceType: 'BENCHMARK_RETURN',
        weight,
        startDate: start.date,
        startAvailableAt: start.availableAt,
        endDate: end.date,
        endAvailableAt: end.availableAt,
        componentReturn,
        sourceRefs: [start.sourceRef, end.sourceRef],
      });
    }
  }
  return { grossReturn, evaluationRefs };
}

function calculateTurnover(previousWeights, nextWeights) {
  if (!previousWeights) return 0;
  const keys = new Set([...Object.keys(previousWeights), ...Object.keys(nextWeights)]);
  let total = 0;
  for (const key of keys) total += Math.abs((nextWeights[key] || 0) - (previousWeights[key] || 0));
  return total / 2;
}

function evaluateConstraints(alternative, snapshot, wealth) {
  const violations = { liquidity: [], suitability: [] };
  const cashWeight = alternative.bucketWeights.CASH || 0;
  const liquidValue = cashWeight * wealth;
  if (liquidValue + 1e-8 < snapshot.client.liquidityReserve) {
    violations.liquidity.push({
      reasonCode: 'LIQUIDITY_RESERVE_NOT_PRESERVED',
      liquidValue,
      requiredValue: snapshot.client.liquidityReserve,
    });
  }

  if (alternative.instrumentType === 'FUND') {
    const fundMap = new Map(snapshot.funds.map((fund) => [fund.fundId, fund]));
    for (const [fundId, weight] of Object.entries(alternative.weights)) {
      const fund = fundMap.get(fundId);
      if (weight > 0 && fund?.classification?.riskLevel > snapshot.client.suitability.maxRiskLevel) {
        violations.suitability.push({
          reasonCode: 'RISK_LEVEL_EXCEEDS_SUITABILITY',
          instrumentId: fundId,
          riskLevel: fund.classification.riskLevel,
          maxRiskLevel: snapshot.client.suitability.maxRiskLevel,
          weight,
        });
      }
    }
  } else {
    for (const [bucket, weight] of Object.entries(alternative.bucketWeights)) {
      if (weight > 0 && BUCKET_RISK_LEVEL[bucket] > snapshot.client.suitability.maxRiskLevel) {
        violations.suitability.push({
          reasonCode: 'POLICY_BUCKET_EXCEEDS_SUITABILITY',
          instrumentId: bucket,
          riskLevel: BUCKET_RISK_LEVEL[bucket],
          maxRiskLevel: snapshot.client.suitability.maxRiskLevel,
          weight,
        });
      }
    }
  }
  return {
    liquidityViolation: violations.liquidity.length > 0,
    suitabilityViolation: violations.suitability.length > 0,
    violations,
  };
}

function eventImpact(alternative, snapshot) {
  return snapshot.marketEvents
    .filter((event) => event.status === 'ACTIVE')
    .map((event) => {
      const exposedWeight = event.affectedBuckets.reduce(
        (sum, bucket) => sum + (alternative.bucketWeights[bucket] || 0), 0
      );
      return {
        eventId: event.eventId,
        nameTh: event.nameTh,
        severity: event.severity,
        exposedWeight,
        sourceRef: event.sourceRef,
      };
    })
    .filter((impact) => impact.exposedWeight > 0);
}

function createReplayAction({ strategyId, date, constraints, currentDrawdown, normalizedShortfall, impacts }) {
  const reasonCodes = [];
  const mandatory = constraints.liquidityViolation || constraints.suitabilityViolation;
  if (constraints.liquidityViolation) reasonCodes.push('LIQUIDITY_RESERVE_NOT_PRESERVED');
  if (constraints.suitabilityViolation) reasonCodes.push('SUITABILITY_VIOLATION');
  if (currentDrawdown <= -0.08) reasonCodes.push('DRAWDOWN_ALERT');
  if (impacts.some((impact) => impact.exposedWeight >= 0.25)) reasonCodes.push('MARKET_EVENT_CLIENT_IMPACT');

  let lane = 'NO_ACTION';
  let priorityTier = 'P3';
  if (mandatory) {
    lane = 'CARE';
    priorityTier = constraints.suitabilityViolation ? 'P0' : 'P1';
  } else if (currentDrawdown <= -0.08 || impacts.some((impact) => impact.exposedWeight >= 0.25)) {
    lane = 'CARE';
    priorityTier = 'P1';
  } else if (normalizedShortfall > 0.01) {
    lane = 'GROWTH';
    priorityTier = normalizedShortfall > 0.08 ? 'P1' : 'P2';
    reasonCodes.push('GOAL_SHORTFALL');
  } else {
    reasonCodes.push('NO_ACTION_VALID');
  }
  const input = { strategyId, date, lane, priorityTier, mandatory, reasonCodes };
  return {
    actionId: `replay-action-${stableHash(input).slice(0, 18)}`,
    strategyId,
    date,
    lane,
    priorityTier,
    mandatoryCare: mandatory,
    reasonCodes,
    estimatedRmMinutes: lane === 'CARE' ? 20 : lane === 'GROWTH' ? 15 : 0,
  };
}

function prioritizeReplayActions(actions) {
  const tier = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const lane = { CARE: 0, GROWTH: 1, NO_ACTION: 2 };
  return [...actions].sort((a, b) => lane[a.lane] - lane[b.lane]
    || Number(b.mandatoryCare) - Number(a.mandatoryCare)
    || tier[a.priorityTier] - tier[b.priorityTier]
    || a.strategyId.localeCompare(b.strategyId));
}

function requiredFundingPath(client, date, replayStartDate, initialFunding) {
  const targetDate = client.goal.targetDate;
  const totalDays = Math.max(1, daysBetween(replayStartDate, targetDate));
  const elapsedDays = Math.max(0, Math.min(totalDays, daysBetween(replayStartDate, date)));
  const progress = elapsedDays / totalDays;
  return initialFunding + (client.goal.targetAmount - initialFunding) * progress;
}

function expectedAnnualReturn(alternative, assumptions) {
  let total = 0;
  for (const [bucket, weight] of Object.entries(alternative.bucketWeights)) {
    total += weight * (assumptions.annualExpectedReturns[bucket] || 0);
  }
  return total;
}

function estimatePointInTimeProductFee(alternative, snapshot, startingWealth, endDate) {
  if (alternative.instrumentType !== 'FUND') {
    return {
      annualFeeRate: 0,
      amount: 0,
      treatment: 'NOT_APPLICABLE_NON_INVESTABLE_BENCHMARK',
      sourceDetails: [],
    };
  }
  const funds = new Map(snapshot.funds.map((fund) => [fund.fundId, fund]));
  const sourceDetails = [];
  let annualFeeRate = 0;
  for (const [fundId, weight] of Object.entries(alternative.weights)) {
    const fund = funds.get(fundId);
    const feePct = Number(fund?.factsheet?.annualFeePct);
    if (!fund?.factsheet || !Number.isFinite(feePct) || feePct < 0) {
      throw new RangeError(`point-in-time product fee unavailable for ${fundId} at ${snapshot.asOf}`);
    }
    if (fund.factsheet.publishedAt > snapshot.asOf) {
      throw new RangeError(`future product fee leaked for ${fundId} at ${snapshot.asOf}`);
    }
    annualFeeRate += weight * feePct / 100;
    sourceDetails.push({
      fundId,
      weight,
      annualFeePct: feePct,
      factsheetVersionId: fund.factsheet.versionId,
      factsheetAsOf: fund.factsheet.asOf,
      publishedAt: fund.factsheet.publishedAt,
      sourceRef: fund.factsheet.sourceRef,
    });
  }
  const accrualDays = daysBetween(snapshot.asOf, endDate);
  return {
    annualFeeRate,
    amount: startingWealth * annualFeeRate * accrualDays / 365.25,
    accrualDays,
    treatment: 'ESTIMATED_FOR_DISCLOSURE_ALREADY_EMBEDDED_IN_NAV_NOT_DEDUCTED_AGAIN',
    sourceDetails,
  };
}

function replayPerformanceValidation(steps, runContext, scopeId) {
  if (!Array.isArray(steps) || !steps.length) {
    return {
      twr: null,
      twrStatus: 'UNAVAILABLE_NO_OBSERVATIONS',
      xirr: null,
      xirrStatus: 'UNAVAILABLE_NO_OBSERVATIONS',
      annualizedVolatility: null,
      annualizedVolatilityStatus: 'UNAVAILABLE_NO_OBSERVATIONS',
      audit: null,
    };
  }
  const returns = steps.map((step) => ({
    date: step.evaluation.endDate,
    return: step.evaluation.netReturn,
  }));
  const periods = steps.map((step) => ({
    startDate: step.decision.date,
    endDate: step.evaluation.endDate,
    startValue: step.decision.startingWealth,
    endValue: step.evaluation.endingWealth,
    endingFlow: step.evaluation.contribution,
  }));
  const validationInput = {
    scopeId,
    periods,
    returns,
    initialWealth: steps[0].decision.startingWealth,
    terminalWealth: steps.at(-1).evaluation.endingWealth,
  };
  const inputHash = stableHash(validationInput);
  const calculationId = `replay-performance-${inputHash.slice(0, 20)}`;
  const sourceRefs = [...new Set(steps.flatMap((step) => [
    ...step.decision.sourceRefs,
    ...step.evaluation.evaluationRefs.flatMap((ref) => ref.sourceRefs),
    ...step.cost.productFeeSourceDetails.map((detail) => detail.sourceRef),
  ]))];
  const metadata = {
    metadata: {
      calculationId,
      inputHash,
      modelVersion: 'fin-ai-replay-v2',
      assumptionVersion: steps.at(-1).decision.assumptionId,
      asOf: steps.at(-1).evaluation.endDate,
      period: `${steps[0].decision.date}/${steps.at(-1).evaluation.endDate}`,
      currency: 'THB',
      sourceRefs,
      reasonCodes: ['MONTHLY_WALK_FORWARD_OUT_OF_SAMPLE', 'NO_LOOKAHEAD'],
    },
  };
  const twrResult = calculateTWR({ periods }, metadata);
  const xirrFlows = [{ date: steps[0].decision.date, amount: -steps[0].decision.startingWealth }];
  for (const step of steps) {
    if (step.evaluation.contribution) {
      xirrFlows.push({ date: step.evaluation.endDate, amount: -step.evaluation.contribution });
    }
  }
  xirrFlows.push({ date: steps.at(-1).evaluation.endDate, amount: steps.at(-1).evaluation.endingWealth });
  let xirrResult = null;
  let xirrStatus = 'AVAILABLE';
  let xirrReasonCode = null;
  try {
    xirrResult = calculateXIRR(xirrFlows, metadata);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    xirrStatus = 'UNAVAILABLE_INVALID_CASH_FLOW_SERIES';
    xirrReasonCode = String(error.message);
  }
  let volatilityResult = null;
  let annualizedVolatilityStatus = 'AVAILABLE';
  if (returns.length >= 2) {
    volatilityResult = calculateAnnualizedVolatility(returns, { ...metadata, frequency: 'monthly' });
  } else {
    annualizedVolatilityStatus = 'UNAVAILABLE_INSUFFICIENT_OBSERVATIONS';
  }
  return {
    twr: twrResult.twr,
    twrStatus: 'AVAILABLE',
    xirr: xirrResult ? xirrResult.xirr : null,
    xirrStatus,
    xirrReasonCode,
    annualizedVolatility: volatilityResult ? volatilityResult.annualizedVolatility : null,
    annualizedVolatilityStatus,
    observationCount: returns.length,
    frequency: 'MONTHLY',
    cashFlowConvention: 'TWR removes end-of-period contributions; XIRR uses client perspective with contributions negative and terminal wealth positive.',
    audit: {
      calculationId,
      inputHash,
      asOf: steps.at(-1).evaluation.endDate,
      period: `${steps[0].decision.date}/${steps.at(-1).evaluation.endDate}`,
      sourceRefs,
      formulaIds: {
        twr: twrResult.audit.formulaId,
        xirr: xirrResult ? xirrResult.audit.formulaId : 'XIRR_UNAVAILABLE_GOVERNED_STATUS_V1',
        annualizedVolatility: volatilityResult
          ? volatilityResult.audit.formulaId
          : 'ANNUALIZED_VOLATILITY_UNAVAILABLE_GOVERNED_STATUS_V1',
      },
      modelVersion: 'fin-ai-replay-v2',
      seed: runContext.seed,
    },
  };
}

function empiricalVaRCVaR(returns, confidenceLevel = 0.95) {
  if (!Array.isArray(returns) || !returns.length) throw new RangeError('at least one return is required');
  if (!(confidenceLevel > 0 && confidenceLevel < 1)) throw new RangeError('confidenceLevel must be between zero and one');
  const losses = returns.map((value) => -Number(value)).sort((a, b) => a - b);
  if (losses.some((value) => !Number.isFinite(value))) throw new TypeError('returns must be finite');
  const orderStatistic = Math.max(1, Math.ceil(confidenceLevel * losses.length));
  const valueAtRisk = losses[orderStatistic - 1];
  const tail = losses.filter((loss) => loss >= valueAtRisk);
  const conditionalValueAtRisk = tail.reduce((sum, value) => sum + value, 0) / tail.length;
  return {
    confidenceLevel,
    valueAtRisk,
    conditionalValueAtRisk,
    tailObservationCount: tail.length,
    observationCount: losses.length,
    finiteSampleRule: 'nearest-rank VaR; CVaR averages every observed loss greater than or equal to VaR',
  };
}

function calculateMaxDrawdown(wealthValues) {
  if (!Array.isArray(wealthValues) || !wealthValues.length) throw new RangeError('wealth values are required');
  let peak = -Infinity;
  let maximumDrawdown = 0;
  for (const value of wealthValues) {
    if (!(Number.isFinite(value) && value > 0)) throw new RangeError('wealth values must be finite and positive');
    peak = Math.max(peak, value);
    maximumDrawdown = Math.min(maximumDrawdown, value / peak - 1);
  }
  return maximumDrawdown;
}

function returnIndex(returns) {
  const values = [1];
  for (const value of returns) values.push(values.at(-1) * (1 + value));
  return values;
}

function summarizeStrategy(state, runContext) {
  const returns = state.steps.map((step) => step.evaluation.netReturn);
  const performanceValidation = replayPerformanceValidation(state.steps, runContext, state.strategyId);
  const shortfalls = state.steps.map((step) => step.goal.normalizedShortfall);
  const goalSuccesses = state.steps.filter((step) => step.goal.onTrack).length;
  const care = state.steps.filter((step) => step.action.lane === 'CARE');
  const growth = state.steps.filter((step) => step.action.lane === 'GROWTH');
  const actionable = [...care, ...growth];
  const falsePositiveEligible = care.filter((step) => !step.action.mandatoryCare);
  const falsePositives = falsePositiveEligible.filter((step) => step.alertEvaluation.falsePositive).length;
  const projectionErrors = state.steps.map((step) => step.goal.projectionAbsoluteErrorNormalized);
  const projectionCorrect = state.steps.filter(
    (step) => step.goal.projectedOnTrack === step.goal.onTrack
  ).length;
  const risk = empiricalVaRCVaR(returns, runContext.confidenceLevel);
  const metricsInput = {
    strategyId: state.strategyId,
    returns,
    wealthSeries: state.wealthSeries,
    steps: state.steps.map((step) => ({
      date: step.decision.date,
      netReturn: step.evaluation.netReturn,
      contribution: step.evaluation.contribution,
      turnover: step.cost.turnover,
      cost: step.cost.amount,
      productFeeEstimate: step.cost.productFeeEstimate,
      onTrack: step.goal.onTrack,
      shortfall: step.goal.normalizedShortfall,
      constraints: step.constraints,
      action: step.action,
    })),
  };
  const calculationId = `replay-metric-${stableHash(metricsInput).slice(0, 20)}`;
  return {
    strategyId: state.strategyId,
    nameTh: state.nameTh,
    metrics: {
      twr: performanceValidation.twr,
      twrStatus: performanceValidation.twrStatus,
      xirr: performanceValidation.xirr,
      xirrStatus: performanceValidation.xirrStatus,
      xirrReasonCode: performanceValidation.xirrReasonCode,
      annualizedVolatility: performanceValidation.annualizedVolatility,
      annualizedVolatilityStatus: performanceValidation.annualizedVolatilityStatus,
      goalSuccessRate: goalSuccesses / state.steps.length,
      normalizedGoalShortfall: shortfalls.reduce((sum, value) => sum + value, 0) / shortfalls.length,
      terminalNormalizedGoalShortfall: shortfalls.at(-1),
      empiricalVaR: risk.valueAtRisk,
      empiricalCVaR: risk.conditionalValueAtRisk,
      cvarConfidenceLevel: risk.confidenceLevel,
      cvarTailObservationCount: risk.tailObservationCount,
      maximumDrawdown: calculateMaxDrawdown(returnIndex(returns)),
      turnover: state.steps.reduce((sum, step) => sum + step.cost.turnover, 0),
      productFeeEstimate: state.steps.reduce((sum, step) => sum + step.cost.productFeeEstimate, 0),
      transactionCost: state.steps.reduce((sum, step) => sum + step.cost.amount, 0),
      estimatedTotalCost: state.steps.reduce(
        (sum, step) => sum + step.cost.productFeeEstimate + step.cost.amount, 0
      ),
      productFeeTreatment: 'Estimated point-in-time factsheet fee for disclosure; fund NAV already embeds product fees, so the estimate is not deducted again.',
      liquidityViolations: state.steps.filter((step) => step.constraints.liquidityViolation).length,
      suitabilityViolations: state.steps.filter((step) => step.constraints.suitabilityViolation).length,
      careAlerts: care.length,
      falsePositiveAlertRate: falsePositiveEligible.length ? falsePositives / falsePositiveEligible.length : 0,
      falsePositiveAlertEvaluation: {
        status: falsePositiveEligible.length ? 'MEASURED' : 'NOT_APPLICABLE',
        eligibleAlertCount: falsePositiveEligible.length,
        falsePositiveCount: falsePositives,
        denominator: 'Non-mandatory Care alerts only; policy and suitability breaches are never relabelled false positives from market outcomes.',
      },
      rmWorkloadGenerated: {
        actionCount: actionable.length,
        careAlertCount: care.length,
        growthOpportunityCount: growth.length,
        estimatedMinutes: actionable.reduce((sum, step) => sum + step.action.estimatedRmMinutes, 0),
        formula: '20 minutes per Care alert + 15 minutes per Growth opportunity; No Action creates zero RM minutes.',
      },
      goalProjectionValidation: {
        observationCount: state.steps.length,
        onTrackClassificationAccuracy: projectionCorrect / state.steps.length,
        meanAbsoluteProjectionErrorNormalized: projectionErrors.reduce((sum, value) => sum + value, 0) / projectionErrors.length,
        method: 'Point-in-time capital-market assumptions; one-month projection checked against next-month realised wealth',
      },
      marketEventClientImpacts: state.steps.reduce((sum, step) => sum + step.marketEventImpacts.length, 0),
      observationCount: state.steps.length,
    },
    audit: {
      calculationId,
      inputHash: stableHash(metricsInput),
      formulaIds: {
        goalSuccessRate: 'REPLAY_GOAL_ON_TRACK_FREQUENCY_V1',
        normalizedGoalShortfall: 'REPLAY_NORMALIZED_GOAL_SHORTFALL_V1',
        twr: performanceValidation.audit.formulaIds.twr,
        xirr: performanceValidation.audit.formulaIds.xirr,
        annualizedVolatility: performanceValidation.audit.formulaIds.annualizedVolatility,
        empiricalCVaR: 'EMPIRICAL_CVAR_FINITE_SAMPLE_V1',
        maximumDrawdown: 'PERFORMANCE_RETURN_PATH_MAX_DRAWDOWN_V1',
        turnover: 'HALF_L1_POLICY_BUCKET_TURNOVER_V1',
        productFeeEstimate: 'POINT_IN_TIME_WEIGHTED_FACTSHEET_FEE_ESTIMATE_V1',
        transactionCost: 'TURNOVER_TIMES_COST_BPS_V1',
        estimatedTotalCost: 'PRODUCT_FEE_ESTIMATE_PLUS_TRANSACTION_COST_V1',
        falsePositiveAlertRate: 'NON_MANDATORY_CARE_FALSE_POSITIVE_V1',
      },
      performanceValidation: performanceValidation.audit,
      modelVersion: 'fin-ai-replay-v2',
      assumptionVersion: state.steps.at(-1).decision.assumptionId,
      seed: runContext.seed,
    },
    terminalWealth: state.wealth,
    returnType: state.instrumentType === 'FUND' ? 'NAV_RETURN' : 'BENCHMARK_RETURN',
    isTotalReturn: false,
    steps: state.steps,
  };
}

function summarizeStressPeriods(strategyResults, stressPeriods, runContext) {
  return stressPeriods.map((period) => ({
    stressId: period.stressId,
    nameTh: period.nameTh,
    startDate: period.startDate,
    endDate: period.endDate,
    resultType: RESULT_TYPES.NAMED_STRESS,
    resultClass: RESULT_TYPES.NAMED_STRESS,
    sourceResultType: RESULT_TYPES.HISTORICAL_REPLAY,
    dataUse: 'EVALUATION_WINDOW_ONLY_NOT_A_DECISION_INPUT',
    strategies: Object.fromEntries(STRATEGY_ORDER.map((strategyId) => {
      const steps = strategyResults[strategyId].steps.filter(
        (step) => step.evaluation.startDate <= period.endDate
          && step.evaluation.endDate >= period.startDate
      );
      const returns = steps.map((step) => step.evaluation.netReturn);
      const performanceValidation = replayPerformanceValidation(
        steps,
        runContext,
        `${period.stressId}:${strategyId}`
      );
      return [strategyId, {
        observationCount: steps.length,
        twr: performanceValidation.twr,
        twrStatus: performanceValidation.twrStatus,
        xirr: performanceValidation.xirr,
        xirrStatus: performanceValidation.xirrStatus,
        annualizedVolatility: performanceValidation.annualizedVolatility,
        annualizedVolatilityStatus: performanceValidation.annualizedVolatilityStatus,
        empiricalCVaR: returns.length ? empiricalVaRCVaR(returns, 0.95).conditionalValueAtRisk : null,
        maximumDrawdown: returns.length ? calculateMaxDrawdown(returnIndex(returns)) : null,
        turnover: steps.reduce((sum, step) => sum + step.cost.turnover, 0),
        productFeeEstimate: steps.reduce((sum, step) => sum + step.cost.productFeeEstimate, 0),
        transactionCost: steps.reduce((sum, step) => sum + step.cost.amount, 0),
        estimatedTotalCost: steps.reduce(
          (sum, step) => sum + step.cost.productFeeEstimate + step.cost.amount, 0
        ),
        liquidityViolations: steps.filter((step) => step.constraints.liquidityViolation).length,
        goalSuccessRate: steps.length
          ? steps.filter((step) => step.goal.onTrack).length / steps.length
          : null,
        careAlerts: steps.filter((step) => step.action.lane === 'CARE').length,
        normalizedGoalShortfall: steps.length
          ? steps.reduce((sum, step) => sum + step.goal.normalizedShortfall, 0) / steps.length
          : null,
        audit: performanceValidation.audit,
      }];
    })),
  }));
}

function createResultSeparation(activeType = RESULT_TYPES.HISTORICAL_REPLAY) {
  if (!Object.values(RESULT_TYPES).includes(activeType)) throw new RangeError(`unknown result type ${activeType}`);
  return {
    historicalReplay: {
      resultType: RESULT_TYPES.HISTORICAL_REPLAY,
      resultClass: RESULT_TYPES.HISTORICAL_REPLAY,
      status: activeType === RESULT_TYPES.HISTORICAL_REPLAY ? 'COMPLETE' : 'NOT_RUN',
      meaningTh: 'ผลทดสอบแบบย้อนเวลาโดยใช้เฉพาะข้อมูลที่มีในวันนั้น',
    },
    namedStress: {
      resultType: RESULT_TYPES.NAMED_STRESS,
      resultClass: RESULT_TYPES.NAMED_STRESS,
      status: [RESULT_TYPES.HISTORICAL_REPLAY, RESULT_TYPES.NAMED_STRESS].includes(activeType) ? 'COMPLETE' : 'NOT_RUN',
      metricsLocation: 'stressPeriodResults',
      meaningTh: 'ผลจากช่วงเหตุการณ์ที่ระบุชื่อ ใช้ข้อมูลที่เกิดขึ้นจริงในช่วงประเมินและไม่ใช้ป้ายเหตุการณ์เป็นข้อมูลตัดสินใจล่วงหน้า',
    },
    forwardSimulation: {
      resultType: RESULT_TYPES.FORWARD_SIMULATION,
      resultClass: RESULT_TYPES.FORWARD_SIMULATION,
      status: activeType === RESULT_TYPES.FORWARD_SIMULATION ? 'COMPLETE' : 'NOT_RUN',
      metrics: null,
      meaningTh: 'ผลจำลองอนาคตจากสมมติฐาน แยกจากผลย้อนหลังและช่วงเหตุการณ์ที่ระบุชื่อ',
    },
    syntheticScenario: {
      resultType: RESULT_TYPES.SYNTHETIC_SCENARIO,
      resultClass: RESULT_TYPES.SYNTHETIC_SCENARIO,
      status: activeType === RESULT_TYPES.SYNTHETIC_SCENARIO ? 'COMPLETE' : 'NOT_RUN',
      metrics: null,
      meaningTh: 'ผลจากสมมติฐานอนาคต ไม่ใช่ผลทดสอบย้อนหลัง',
    },
    livePilot: {
      resultType: RESULT_TYPES.LIVE_PILOT,
      resultClass: RESULT_TYPES.LIVE_PILOT,
      status: activeType === RESULT_TYPES.LIVE_PILOT ? 'COMPLETE' : 'NOT_COLLECTED',
      metrics: null,
      meaningTh: 'ผลลัพธ์จากการทดลองใช้งานจริงเท่านั้น',
    },
  };
}

function runHistoricalReplay(options = {}) {
  const fixtures = options.fixtures || createHistoricalReplayFixtures({ seed: options.seed });
  const confidenceLevel = options.confidenceLevel == null ? 0.95 : Number(options.confidenceLevel);
  if (!(confidenceLevel > 0 && confidenceLevel < 1)) throw new RangeError('confidenceLevel must be between zero and one');
  const selectedDates = (options.decisionDates || fixtures.decisionDates)
    .filter((date) => (!options.startDate || date >= options.startDate)
      && (!options.endDate || date <= options.endDate))
    .map((date) => normalizeDate(date));
  if (!selectedDates.length) throw new RangeError('at least one monthly decision date is required');
  for (let index = 1; index < selectedDates.length; index += 1) {
    if (selectedDates[index] <= selectedDates[index - 1]) throw new RangeError('decision dates must be strictly increasing');
    if (selectedDates[index] !== addMonths(selectedDates[index - 1], 1)) {
      throw new RangeError('historical replay requires consecutive monthly decision dates');
    }
  }
  const finalEvaluationDate = addMonths(selectedDates.at(-1), 1);
  if (finalEvaluationDate > fixtures.availableThrough) {
    throw new RangeError(`future evaluation data are unavailable after ${fixtures.availableThrough}`);
  }

  const firstSnapshot = buildPointInTimeSnapshot(fixtures, selectedDates[0]);
  if (!firstSnapshot.client?.goal) throw new RangeError('point-in-time goal data are required');
  const initialFunding = Number(options.initialWealth || firstSnapshot.client.goal.startingFunding);
  if (!(initialFunding > 0)) throw new RangeError('initial wealth must be greater than zero');
  const states = Object.fromEntries(STRATEGY_ORDER.map((strategyId) => [strategyId, {
    strategyId,
    nameTh: null,
    instrumentType: null,
    wealth: initialFunding,
    performanceIndex: 1,
    performancePeak: 1,
    previousBucketWeights: null,
    wealthSeries: [{ date: selectedDates[0], value: initialFunding }],
    steps: [],
  }]));
  const decisionBatches = [];
  const decisionSnapshotHashes = [];
  const excludedUnavailableRevisionIds = new Set();

  for (const date of selectedDates) {
    const evaluationDate = addMonths(date, 1);
    const decisionSnapshot = buildPointInTimeSnapshot(fixtures, date);
    const evaluationSnapshot = buildPointInTimeSnapshot(fixtures, evaluationDate);
    assertPointInTimeSnapshot(decisionSnapshot);
    assertPointInTimeSnapshot(evaluationSnapshot);
    decisionSnapshotHashes.push({
      date,
      inputHash: decisionSnapshot.lineage.inputHash,
      excludedUnavailableRevisionIds: [...decisionSnapshot.lineage.excludedUnavailableRevisionIds],
    });
    for (const revisionId of decisionSnapshot.lineage.excludedUnavailableRevisionIds) {
      excludedUnavailableRevisionIds.add(revisionId);
    }

    const alternatives = {
      [STRATEGY_IDS.CURRENT_NO_ACTION]: currentAlternative(decisionSnapshot),
      [STRATEGY_IDS.ELIGIBLE_APPROVED_MODEL]: approvedModelAlternative(decisionSnapshot, options),
      [STRATEGY_IDS.SIMPLE_POLICY_BENCHMARK]: policyBenchmarkAlternative(decisionSnapshot),
      [STRATEGY_IDS.GOAL_BASED_CANDIDATE]: goalBasedAlternative(
        decisionSnapshot,
        states[STRATEGY_IDS.GOAL_BASED_CANDIDATE].wealth,
        options
      ),
    };
    const actions = [];

    for (const strategyId of STRATEGY_ORDER) {
      const state = states[strategyId];
      const alternative = alternatives[strategyId];
      state.nameTh = alternative.nameTh;
      state.instrumentType = alternative.instrumentType;
      const startingWealth = state.wealth;
      const constraints = evaluateConstraints(alternative, decisionSnapshot, startingWealth);
      const requiredNow = requiredFundingPath(decisionSnapshot.client, date, selectedDates[0], initialFunding);
      const normalizedShortfallNow = Math.max(0, requiredNow - startingWealth)
        / decisionSnapshot.client.goal.targetAmount;
      const currentDrawdown = state.performanceIndex / state.performancePeak - 1;
      const impacts = eventImpact(alternative, decisionSnapshot);
      const action = createReplayAction({
        strategyId,
        date,
        constraints,
        currentDrawdown,
        normalizedShortfall: normalizedShortfallNow,
        impacts,
      });
      actions.push(action);

      const realised = realizedReturnForAlternative(alternative, decisionSnapshot, evaluationSnapshot);
      const initialPrevious = strategyId === STRATEGY_IDS.CURRENT_NO_ACTION
        ? alternative.bucketWeights
        : currentAlternative(decisionSnapshot).bucketWeights;
      const previousBucketWeights = state.previousBucketWeights || initialPrevious;
      // CURRENT_NO_ACTION is a sequence of one-month, point-in-time baselines:
      // hold the observed current portfolio from t to t+1 without proposing a
      // trade. A changed holdings snapshot at the next decision becomes the new
      // baseline; it is not treated as a recommendation generated by replay.
      const turnover = strategyId === STRATEGY_IDS.CURRENT_NO_ACTION
        ? 0
        : calculateTurnover(previousBucketWeights, alternative.bucketWeights);
      const transactionCostBps = decisionSnapshot.assumptions.transactionCostBps;
      const costRate = turnover * transactionCostBps / 10000;
      const transactionCost = startingWealth * costRate;
      const productFee = estimatePointInTimeProductFee(
        alternative,
        decisionSnapshot,
        startingWealth,
        evaluationDate
      );
      const netReturn = realised.grossReturn - costRate;
      const contribution = decisionSnapshot.client.goal.monthlyContribution;
      const endingWealth = startingWealth * (1 + netReturn) + contribution;
      const expectedReturn = expectedAnnualReturn(alternative, decisionSnapshot.assumptions) / 12;
      const projectedWealth = startingWealth * (1 + expectedReturn - costRate) + contribution;
      const requiredNext = requiredFundingPath(evaluationSnapshot.client, evaluationDate, selectedDates[0], initialFunding);
      const normalizedShortfall = Math.max(0, requiredNext - endingWealth)
        / evaluationSnapshot.client.goal.targetAmount;
      const onTrack = endingWealth >= requiredNext;
      const projectedOnTrack = projectedWealth >= requiredNext;
      const endingPerformanceIndex = state.performanceIndex * (1 + netReturn);
      const endingPerformancePeak = Math.max(state.performancePeak, endingPerformanceIndex);
      const endingDrawdown = endingPerformanceIndex / endingPerformancePeak - 1;
      const falsePositive = action.lane === 'CARE' && !action.mandatoryCare
        && netReturn > -0.005 && endingDrawdown > -0.05;
      const decisionInputHash = stableHash({
        snapshotInputHash: decisionSnapshot.lineage.inputHash,
        strategyId,
        alternative,
        startingWealth,
      });
      const calculationId = `replay-step-${stableHash({
        seed: fixtures.seed, date, evaluationDate, strategyId, decisionInputHash,
      }).slice(0, 20)}`;

      const step = {
        strategyId,
        calculationId,
        decision: {
          date,
          startingWealth,
          weightsFrozenAt: date,
          alternative,
          assumptionId: decisionSnapshot.assumptions.assumptionId,
          decisionInputHash,
          sourceRefs: [...new Set([
            ...alternative.sourceRefs,
            decisionSnapshot.client.sourceRef,
            decisionSnapshot.assumptions.sourceRef,
          ])],
        },
        pointInTime: {
          decisionAsOf: date,
          decisionDataMaxObservedAt: decisionSnapshot.lineage.maxObservedAt,
          decisionDataMaxAvailableAt: decisionSnapshot.lineage.maxAvailableAt,
          decisionSnapshotHash: decisionSnapshot.lineage.inputHash,
          futureDataInDecision: false,
          assertionPassed: true,
          trainingEnd: date,
          selectionInputEnd: date,
          evaluationStart: date,
          outOfSampleStartExclusive: date,
          evaluationEnd: evaluationDate,
          outOfSampleEndInclusive: evaluationDate,
        },
        evaluation: {
          startDate: date,
          endDate: evaluationDate,
          grossReturn: realised.grossReturn,
          netReturn,
          endingWealth,
          contribution,
          evaluationDataMaxAvailableAt: maxDate(
            realised.evaluationRefs.flatMap((ref) => [ref.startAvailableAt, ref.endAvailableAt])
          ),
          evaluationRefs: realised.evaluationRefs,
        },
        cost: {
          turnover,
          turnoverBasis: strategyId === STRATEGY_IDS.CURRENT_NO_ACTION
            ? 'NO_TRADE_AT_EACH_POINT_IN_TIME_DECISION'
            : 'HALF_L1_POLICY_BUCKET_WEIGHTS',
          transactionCostBps,
          amount: transactionCost,
          productFeeAnnualRate: productFee.annualFeeRate,
          productFeeEstimate: productFee.amount,
          productFeeAccrualDays: productFee.accrualDays || 0,
          productFeeTreatment: productFee.treatment,
          productFeeSourceDetails: productFee.sourceDetails,
          estimatedTotalCost: productFee.amount + transactionCost,
          currency: fixtures.currency,
        },
        constraints,
        risk: {
          decisionDrawdown: currentDrawdown,
          endingDrawdown,
          drawdownBasis: 'NET_RETURN_INDEX_EXCLUDING_EXTERNAL_CONTRIBUTIONS',
        },
        goal: {
          goalId: evaluationSnapshot.client.goal.goalId,
          goalNameTh: evaluationSnapshot.client.goal.nameTh,
          targetAmount: evaluationSnapshot.client.goal.targetAmount,
          targetDate: evaluationSnapshot.client.goal.targetDate,
          requiredFundingAtEvaluation: requiredNext,
          onTrack,
          normalizedShortfall,
          projectedWealth,
          projectedOnTrack,
          projectionAbsoluteErrorNormalized: Math.abs(projectedWealth - endingWealth)
            / evaluationSnapshot.client.goal.targetAmount,
        },
        marketEventImpacts: impacts,
        action,
        alertEvaluation: {
          evaluationOnly: true,
          falsePositive,
          rule: 'Only a non-mandatory Care alert may be false positive; policy and suitability breaches remain valid regardless of next-month return.',
        },
      };
      state.steps.push(step);
      state.wealth = endingWealth;
      state.performanceIndex = endingPerformanceIndex;
      state.performancePeak = endingPerformancePeak;
      state.previousBucketWeights = alternative.bucketWeights;
      state.wealthSeries.push({ date: evaluationDate, value: endingWealth });
    }

    const ranked = prioritizeReplayActions(actions);
    decisionBatches.push({
      date,
      calculationId: `replay-priority-${stableHash({ date, actions }).slice(0, 20)}`,
      orderingRule: 'Mandatory Care, then Care, then Growth, then No Action; priority tier breaks ties.',
      orderedActionIds: ranked.map((action) => action.actionId),
      actions: ranked,
    });
  }

  const runContext = { confidenceLevel, seed: fixtures.seed };
  const strategyResults = Object.fromEntries(STRATEGY_ORDER.map((strategyId) => [
    strategyId,
    summarizeStrategy(states[strategyId], runContext),
  ]));
  const resultInput = {
    datasetId: fixtures.datasetId,
    seed: fixtures.seed,
    decisionSnapshotHashes: decisionSnapshotHashes.map(({ date, inputHash }) => ({ date, inputHash })),
    strategyCalculationIds: STRATEGY_ORDER.map((id) => strategyResults[id].audit.calculationId),
    confidenceLevel,
  };
  const inputHash = stableHash(resultInput);
  const result = {
    resultType: RESULT_TYPES.HISTORICAL_REPLAY,
    resultClass: RESULT_TYPES.HISTORICAL_REPLAY,
    calculationId: `historical-replay-${inputHash.slice(0, 20)}`,
    inputHash,
    modelVersion: 'fin-ai-replay-v2',
    assumptionVersion: strategyResults[STRATEGY_IDS.CURRENT_NO_ACTION].audit.assumptionVersion,
    seed: fixtures.seed,
    dataOrigin: fixtures.origin,
    dataset: {
      datasetId: fixtures.datasetId,
      synthetic: fixtures.synthetic === true,
      fundCount: fixtures.funds.length,
      historyStart: fixtures.historyStart,
      historyEnd: fixtures.historyEnd,
      observationFrequency: 'BUSINESS_DAY_NAV',
      decisionFrequency: 'MONTHLY',
      currency: fixtures.currency,
      returnType: fixtures.returnType,
      isTotalReturn: fixtures.isTotalReturn,
      limitations: [...fixtures.limitations],
    },
    protocol: {
      method: 'MONTHLY_WALK_FORWARD',
      decisionDateCount: selectedDates.length,
      firstDecisionDate: selectedDates[0],
      lastDecisionDate: selectedDates.at(-1),
      finalEvaluationDate,
      expandingPointInTimeInformationSet: true,
      weightsFrozenBeforeEvaluation: true,
      fullSampleOptimization: false,
      alphaObjective: false,
      objective: 'Validate calculations, goal alignment, constraints, alerts and RM workload; not market outperformance.',
      comparatorDefinitions: {
        [STRATEGY_IDS.CURRENT_NO_ACTION]: 'At each monthly t, hold the point-in-time observed current portfolio through t+1 with zero replay-generated trade or cost; the next observed snapshot becomes the next baseline.',
        [STRATEGY_IDS.ELIGIBLE_APPROVED_MODEL]: 'Point-in-time approved model populated only with eligible approved-shelf funds.',
        [STRATEGY_IDS.SIMPLE_POLICY_BENCHMARK]: 'Fixed non-investable policy benchmark; no alpha selection.',
        [STRATEGY_IDS.GOAL_BASED_CANDIDATE]: 'Liquidity-first horizon rule populated only with eligible approved-shelf funds; no alpha selection.',
      },
      futureInformationProhibited: [
        'future NAV', 'future fund classifications', 'future factsheets', 'future benchmark data',
        'future portfolio holdings', 'revised product information unavailable at the decision date',
      ],
    },
    strategyResults,
    stressPeriodResults: summarizeStressPeriods(strategyResults, fixtures.stressPeriods, runContext),
    decisionBatches,
    audit: {
      pointInTimeAssertionsPassed: true,
      decisionSnapshotHashes,
      excludedUnavailableRevisionIds: [...excludedUnavailableRevisionIds].sort(),
      deterministicCalculationIds: true,
      replayableFromSeed: true,
      requiredMetrics: [...REQUIRED_METRICS],
      allRequiredMetricsPresent: true,
    },
    resultSeparation: createResultSeparation(RESULT_TYPES.HISTORICAL_REPLAY),
    claimPolicy: {
      alphaClaimAllowed: false,
      marketOutperformanceClaimAllowed: false,
      causalRevenueClaimAllowed: false,
      causalRetentionClaimAllowed: false,
      statementNoAlphaTh: 'ผล validation นี้ใช้ตรวจความถูกต้องและความเหมาะสม ไม่ได้ใช้กล่าวอ้างว่าพอร์ตชนะตลาดหรือสร้าง alpha',
      statementTh: 'ผลทดสอบพอร์ตไม่สามารถใช้อ้างว่ารายได้หรือการรักษาลูกค้าเพิ่มขึ้นเพราะระบบนี้',
    },
  };
  validateHistoricalReplayResult(result);
  return result;
}

function validateHistoricalReplayResult(result) {
  if (!result || result.resultType !== RESULT_TYPES.HISTORICAL_REPLAY) {
    throw new TypeError('result must be HISTORICAL_REPLAY');
  }
  if (result.protocol.fullSampleOptimization !== false || result.protocol.alphaObjective !== false) {
    throw new RangeError('historical replay cannot use a full-sample or alpha objective');
  }
  if (!result.audit.pointInTimeAssertionsPassed) throw new RangeError('point-in-time assertions must pass');
  for (const strategyId of STRATEGY_ORDER) {
    const strategy = result.strategyResults[strategyId];
    if (!strategy) throw new RangeError(`missing strategy ${strategyId}`);
    for (const metric of REQUIRED_METRICS) {
      if (!(metric in strategy.metrics)) throw new RangeError(`missing ${metric} for ${strategyId}`);
    }
    if (!Number.isFinite(strategy.metrics.twr)) throw new RangeError(`invalid TWR for ${strategyId}`);
    if (strategy.metrics.xirrStatus === 'AVAILABLE' && !Number.isFinite(strategy.metrics.xirr)) {
      throw new RangeError(`available XIRR must be finite for ${strategyId}`);
    }
    if (strategy.metrics.xirrStatus !== 'AVAILABLE' && strategy.metrics.xirr !== null) {
      throw new RangeError(`unavailable XIRR must be null for ${strategyId}`);
    }
    if (strategy.metrics.annualizedVolatilityStatus === 'AVAILABLE'
      && !(Number.isFinite(strategy.metrics.annualizedVolatility) && strategy.metrics.annualizedVolatility >= 0)) {
      throw new RangeError(`invalid annualized volatility for ${strategyId}`);
    }
    if (!(strategy.metrics.productFeeEstimate >= 0)
      || !(strategy.metrics.transactionCost >= 0)
      || !(strategy.metrics.estimatedTotalCost >= 0)) {
      throw new RangeError(`invalid cost validation for ${strategyId}`);
    }
    for (const step of strategy.steps) {
      if (!step.pointInTime.assertionPassed || step.pointInTime.futureDataInDecision !== false) {
        throw new RangeError(`point-in-time assertion failed for ${strategyId} at ${step.decision.date}`);
      }
      if (step.pointInTime.decisionDataMaxObservedAt > step.decision.date
        || step.pointInTime.decisionDataMaxAvailableAt > step.decision.date) {
        throw new RangeError(`future decision input found for ${strategyId} at ${step.decision.date}`);
      }
      if (step.pointInTime.trainingEnd !== step.decision.date
        || step.pointInTime.evaluationEnd <= step.pointInTime.trainingEnd) {
        throw new RangeError(`invalid walk-forward window for ${strategyId} at ${step.decision.date}`);
      }
      if (step.evaluation.evaluationDataMaxAvailableAt > step.evaluation.endDate) {
        throw new RangeError(`future evaluation input found for ${strategyId} at ${step.decision.date}`);
      }
      if (step.cost.productFeeSourceDetails.some((detail) => detail.publishedAt > step.decision.date)) {
        throw new RangeError(`future fee input found for ${strategyId} at ${step.decision.date}`);
      }
    }
  }
  if (result.stressPeriodResults.length < 3) throw new RangeError('at least three stress periods are required');
  if (result.resultSeparation.historicalReplay.resultType !== RESULT_TYPES.HISTORICAL_REPLAY
    || result.resultSeparation.namedStress.resultType !== RESULT_TYPES.NAMED_STRESS
    || result.resultSeparation.forwardSimulation.resultType !== RESULT_TYPES.FORWARD_SIMULATION
    || result.resultSeparation.syntheticScenario.resultType !== RESULT_TYPES.SYNTHETIC_SCENARIO
    || result.resultSeparation.livePilot.resultType !== RESULT_TYPES.LIVE_PILOT) {
    throw new RangeError('result classes must remain separate');
  }
  if (result.resultSeparation.forwardSimulation.metrics !== null
    || result.resultSeparation.syntheticScenario.metrics !== null
    || result.resultSeparation.livePilot.metrics !== null) {
    throw new RangeError('historical replay metrics cannot be presented as scenario or live-pilot outcomes');
  }
  if (result.claimPolicy.alphaClaimAllowed !== false
    || result.claimPolicy.marketOutperformanceClaimAllowed !== false
    || result.claimPolicy.causalRevenueClaimAllowed !== false
    || result.claimPolicy.causalRetentionClaimAllowed !== false) {
    throw new RangeError('causal revenue and retention claims are prohibited');
  }
  return true;
}

module.exports = {
  RESULT_TYPES,
  STRATEGY_IDS,
  REQUIRED_METRICS,
  stableHash,
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
};
