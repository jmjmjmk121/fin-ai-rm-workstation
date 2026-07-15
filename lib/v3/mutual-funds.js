'use strict';

const {
  MUTUAL_FUND_FIXTURES,
  FUND_SHARE_CLASSES,
  FIXTURE_IDS,
} = require('./mutual-fund-fixtures');

const PROVIDER_METHODS = Object.freeze([
  'getFundMaster',
  'getFundProfile',
  'getShareClasses',
  'getNavHistory',
  'getFundDocuments',
  'getFundAllocation',
]);

const ARRAY_RESULT_METHODS = new Set([
  'getFundMaster',
  'getShareClasses',
  'getNavHistory',
  'getFundDocuments',
]);

function providerError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  if (Number.isFinite(Number(details.retryAfterMs))) error.retryAfterMs = Math.max(0, Number(details.retryAfterMs));
  if (Number.isFinite(Number(details.statusCode))) error.statusCode = Number(details.statusCode);
  return error;
}

function finiteOption(value, fallback, { min = 0, integer = false } = {}) {
  const parsed = value == null || value === '' ? Number(fallback) : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || integer && !Number.isInteger(parsed)) return Number(fallback);
  return parsed;
}

function providerPolicyFromEnv(env = {}) {
  return Object.freeze({
    timeoutMs: finiteOption(env.SETSMART_TIMEOUT_MS, 8000, { min: 1, integer: true }),
    cacheTtlMs: finiteOption(env.SETSMART_CACHE_TTL_MS, 900000, { min: 0, integer: true }),
    staleFallbackMs: finiteOption(env.SETSMART_STALE_FALLBACK_MS, 86400000, { min: 0, integer: true }),
    maxRetries: finiteOption(env.SETSMART_MAX_RETRIES, 2, { min: 0, integer: true }),
    retryBaseMs: finiteOption(env.SETSMART_RETRY_BASE_MS, 250, { min: 0, integer: true }),
    failureBackoffMs: finiteOption(env.SETSMART_FAILURE_BACKOFF_MS, 60000, { min: 0, integer: true }),
  });
}

function normalizedProviderMode(options = {}, env = {}) {
  return upper(options.mode || env.MUTUAL_FUND_DATA_MODE || env.MUTUAL_FUND_PROVIDER_MODE || 'FIXTURE');
}

function sanitizedSetSmartError(error) {
  const statusCode = Number(error && (error.statusCode || error.status));
  const code = upper(error && error.code);
  const retryAfterMs = Number(error && error.retryAfterMs);
  if (statusCode === 429 || code.includes('RATE_LIMIT') || code === 'TOO_MANY_REQUESTS') {
    return providerError('SETSMART_RATE_LIMITED', { statusCode: 429, retryAfterMs });
  }
  if (statusCode === 408 || error && error.name === 'AbortError' || code.includes('TIMEOUT')) {
    return providerError('SETSMART_TIMEOUT', { statusCode: 504 });
  }
  if (/^SETSMART_(?:RATE_LIMITED|TIMEOUT|PROVIDER_UNAVAILABLE)$/.test(code)) {
    return providerError(code, { statusCode, retryAfterMs });
  }
  return providerError('SETSMART_PROVIDER_UNAVAILABLE', { statusCode: statusCode >= 400 ? statusCode : 503 });
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(providerError('SETSMART_TIMEOUT', { statusCode: 504 })), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

function cloneValue(value, seen = new WeakMap()) {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const result = [];
    seen.set(value, result);
    for (const item of value) result.push(cloneValue(item, seen));
    return result;
  }
  const result = {};
  seen.set(value, result);
  for (const [key, item] of Object.entries(value)) result[key] = cloneValue(item, seen);
  return result;
}

function stableSerialize(value, seen = new WeakSet()) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (seen.has(value)) throw providerError('MUTUAL_FUND_CACHE_ARGUMENT_CIRCULAR');
  seen.add(value);
  let encoded;
  if (Array.isArray(value)) {
    encoded = `[${value.map((item) => stableSerialize(item, seen)).join(',')}]`;
  } else {
    encoded = `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key], seen)}`).join(',')}}`;
  }
  seen.delete(value);
  return encoded;
}

function isSensitiveKey(key) {
  return /^(api[-_]?key|authorization|credentials?|secret|access[-_]?token|refresh[-_]?token)$/i.test(String(key));
}

function redactSecrets(value, secrets, seen = new WeakMap()) {
  const secretValues = secrets.filter((secret) => typeof secret === 'string' && secret.length > 0);
  if (typeof value === 'string') {
    return secretValues.reduce((text, secret) => text.split(secret).join('[REDACTED]'), value);
  }
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const result = [];
    seen.set(value, result);
    for (const item of value) result.push(redactSecrets(item, secretValues, seen));
    return result;
  }
  const result = {};
  seen.set(value, result);
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    if (secretValues.some((secret) => key.includes(secret))) continue;
    result[key] = redactSecrets(item, secretValues, seen);
  }
  return result;
}

function upper(value) {
  return String(value == null ? '' : value).trim().toUpperCase();
}

function toStringSet(value) {
  if (value == null) return null;
  const items = value instanceof Set ? [...value] : Array.isArray(value) ? value : [value];
  return new Set(items.filter((item) => item != null).map((item) => String(item)));
}

function fundIdentifiers(fund) {
  return new Set([
    fund && fund.masterFundId,
    fund && fund.fundId,
    fund && fund.shareClassId,
    ...(Array.isArray(fund && fund.shareClassIds) ? fund.shareClassIds : []),
  ].filter(Boolean).map(String));
}

function intersects(left, right) {
  if (!left || !right) return false;
  for (const item of left) if (right.has(item)) return true;
  return false;
}

function isThaiRegistered(fund) {
  if (!fund || typeof fund !== 'object') return false;
  if (fund.thaiRegistered === false) return false;
  if (fund.thaiRegistered === true) return true;
  const country = upper(
    fund.registrationCountryCode
    || fund.registeredCountryCode
    || fund.domicileCountryCode
    || fund.registrationCountry
    || fund.domicile
  );
  return country === 'TH' || country === 'THA' || country === 'THAILAND' || country === 'ประเทศไทย';
}

function approvedShelfStatus(fund, asOf) {
  const shelf = fund && fund.approvedShelf || {};
  const status = upper(shelf.status || fund && fund.approvedStatus);
  if (fund && fund.approved === false) return false;
  const explicitlyApproved = fund && fund.approved === true || shelf.approved === true || status === 'APPROVED';
  if (!explicitlyApproved) return false;
  if (asOf && shelf.validFrom && String(asOf) < String(shelf.validFrom)) return false;
  if (asOf && shelf.validTo && String(asOf) > String(shelf.validTo)) return false;
  return true;
}

function dataQualityPasses(fund, query) {
  const quality = fund && (fund.dataQuality || fund.quality) || {};
  const status = upper(quality.status || fund && fund.qualityStatus);
  const allowed = new Set((query.allowedQualityStatuses || (query.allowQualityWarnings ? ['PASS', 'WARN'] : ['PASS'])).map(upper));
  if (!allowed.has(status)) return false;
  if (quality.requiredFieldsComplete === false) return false;
  if (query.requireFresh !== false && (!fund || !fund.freshness || fund.freshness.isStale !== false)) return false;
  return true;
}

function permittedForCandidate(fund, query) {
  let allowedActions = fund && fund.permissions;
  if (!Array.isArray(allowedActions)) {
    const permissionObject = fund && fund.permission || {};
    allowedActions = permissionObject.allowedActions || permissionObject.actions || [];
  }
  const allowed = new Set((allowedActions || []).map(upper));
  const required = upper(query.requiredPermission || query.permission || 'ADVISE');
  if (!required || !allowed.has(required)) return false;

  const granted = toStringSet(query.grantedPermissions || query.actorPermissions);
  if (granted && !new Set([...granted].map(upper)).has(required)) return false;

  const permissionedIds = toStringSet(
    query.permissionedFundIds
    || query.allowedFundIds
    || query.client && query.client.permissionedFundIds
  );
  if (permissionedIds && !intersects(fundIdentifiers(fund), permissionedIds)) return false;
  return true;
}

function eligibleForClient(fund, query) {
  const eligibility = fund && fund.eligibility || {};
  const status = upper(eligibility.status || fund && fund.eligibilityStatus);
  if (status !== 'ELIGIBLE' && status !== 'APPROVED') return false;

  const identifiers = fundIdentifiers(fund);
  const eligibleIds = toStringSet(
    query.eligibleFundIds
    || query.client && query.client.eligibleFundIds
  );
  if (eligibleIds && !intersects(identifiers, eligibleIds)) return false;

  const excludedIds = toStringSet(
    query.ineligibleFundIds
    || query.excludedFundIds
    || query.client && query.client.ineligibleFundIds
  );
  if (excludedIds && intersects(identifiers, excludedIds)) return false;

  const clientId = query.clientId || query.client && query.client.clientId;
  if (clientId && Array.isArray(eligibility.excludedClientIds) && eligibility.excludedClientIds.map(String).includes(String(clientId))) return false;

  const riskValue = query.clientRiskLevel != null
    ? query.clientRiskLevel
    : query.client && (query.client.riskLevel != null ? query.client.riskLevel : query.client.suitabilityRiskLevel);
  if (riskValue != null) {
    const clientRisk = Number(riskValue);
    const minRisk = Number(eligibility.minClientRiskLevel != null ? eligibility.minClientRiskLevel : fund.riskLevel);
    if (!Number.isFinite(clientRisk) || !Number.isFinite(minRisk) || clientRisk < minRisk) return false;
    if (Array.isArray(eligibility.allowedClientRiskLevels) && !eligibility.allowedClientRiskLevels.map(Number).includes(clientRisk)) return false;
  }
  return true;
}

/**
 * Applies the governed candidate-universe intersection. A missing governance
 * field fails closed; callers cannot opt an unapproved product back in.
 */
function evaluateCandidateEligibility(fund, query = {}) {
  const reasonCodes = [];
  if (!isThaiRegistered(fund)) reasonCodes.push('NOT_THAI_REGISTERED');
  if (!approvedShelfStatus(fund, query.asOf)) reasonCodes.push('NOT_ON_APPROVED_SHELF');
  if (!eligibleForClient(fund, query)) reasonCodes.push('CLIENT_INELIGIBLE');
  if (!dataQualityPasses(fund, query)) reasonCodes.push('DATA_QUALITY_FAILED');
  if (!permittedForCandidate(fund, query)) reasonCodes.push('PERMISSION_DENIED');

  const approvedIds = toStringSet(query.approvedFundIds || query.approvedShelfFundIds);
  if (approvedIds && !intersects(fundIdentifiers(fund), approvedIds) && !reasonCodes.includes('NOT_ON_APPROVED_SHELF')) {
    reasonCodes.push('NOT_ON_APPROVED_SHELF');
  }
  return { eligible: reasonCodes.length === 0, reasonCodes };
}

function matchesMasterQuery(fund, query) {
  if (query.masterFundId && String(fund.masterFundId) !== String(query.masterFundId)) return false;
  if (query.fundId && !fundIdentifiers(fund).has(String(query.fundId))) return false;
  const amc = query.amcCode || query.amc;
  if (amc && upper(fund.amcCode) !== upper(amc) && upper(fund.amcNameTh) !== upper(amc)) return false;
  if (query.assetClass && upper(fund.assetClass) !== upper(query.assetClass)) return false;
  if (query.maxRiskLevel != null && Number(fund.riskLevel) > Number(query.maxRiskLevel)) return false;
  if (query.riskLevel != null && Number(fund.riskLevel) !== Number(query.riskLevel)) return false;
  const text = String(query.search || query.text || '').trim().toLocaleLowerCase('th-TH');
  if (text) {
    const haystack = [fund.masterFundId, fund.fundCode, fund.nameTh, fund.nameEn, fund.amcCode, fund.amcNameTh]
      .filter(Boolean).join(' ').toLocaleLowerCase('th-TH');
    if (!haystack.includes(text)) return false;
  }
  return true;
}

function filterCandidateUniverse(funds, query = {}) {
  if (!Array.isArray(funds)) throw providerError('MUTUAL_FUND_MASTER_RESULT_INVALID');
  return funds
    .filter((fund) => evaluateCandidateEligibility(fund, query).eligible)
    .filter((fund) => matchesMasterQuery(fund, query))
    .map((fund) => cloneValue(fund));
}

const filterCandidateFunds = filterCandidateUniverse;

function validateFundId(fundId) {
  if (typeof fundId !== 'string' || fundId.trim() === '') throw providerError('MUTUAL_FUND_ID_REQUIRED');
  return fundId.trim();
}

function validateIsoDate(value, code) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw providerError(code);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw providerError(code);
  return value;
}

function validateDateRange(startDate, endDate) {
  const start = validateIsoDate(startDate, 'MUTUAL_FUND_START_DATE_INVALID');
  const end = validateIsoDate(endDate, 'MUTUAL_FUND_END_DATE_INVALID');
  if (start && end && start > end) throw providerError('MUTUAL_FUND_DATE_RANGE_INVALID');
  return { start, end };
}

class MutualFundDataProvider {
  async getFundMaster(_query) { throw providerError('MUTUAL_FUND_PROVIDER_NOT_IMPLEMENTED'); }
  async getFundProfile(_fundId) { throw providerError('MUTUAL_FUND_PROVIDER_NOT_IMPLEMENTED'); }
  async getShareClasses(_masterFundId) { throw providerError('MUTUAL_FUND_PROVIDER_NOT_IMPLEMENTED'); }
  async getNavHistory(_fundId, _startDate, _endDate) { throw providerError('MUTUAL_FUND_PROVIDER_NOT_IMPLEMENTED'); }
  async getFundDocuments(_fundId) { throw providerError('MUTUAL_FUND_PROVIDER_NOT_IMPLEMENTED'); }
  async getFundAllocation(_fundId, _asOf) { throw providerError('MUTUAL_FUND_PROVIDER_NOT_IMPLEMENTED'); }
}

class FixtureMutualFundAdapter extends MutualFundDataProvider {
  constructor(options = {}) {
    super();
    const fixtures = options.fixtures || MUTUAL_FUND_FIXTURES;
    this.mode = 'fixture';
    Object.defineProperty(this, '_fixtures', { value: cloneValue(fixtures), enumerable: false });
    if (!Array.isArray(this._fixtures.masters) || !Array.isArray(this._fixtures.shareClasses)) {
      throw providerError('MUTUAL_FUND_FIXTURES_INVALID');
    }
  }

  _shareClass(fundId) {
    return this._fixtures.shareClasses.find((item) => item.fundId === fundId || item.shareClassId === fundId) || null;
  }

  _master(masterFundId) {
    return this._fixtures.masters.find((item) => item.masterFundId === masterFundId) || null;
  }

  _resolveMaster(fundId) {
    const direct = this._master(fundId);
    if (direct) return direct;
    const shareClass = this._shareClass(fundId);
    return shareClass ? this._master(shareClass.masterFundId) : null;
  }

  _resolveShareClass(fundId) {
    const direct = this._shareClass(fundId);
    if (direct) return direct;
    const master = this._master(fundId);
    if (!master) return null;
    const classes = this._fixtures.shareClasses.filter((item) => item.masterFundId === master.masterFundId);
    if (classes.length !== 1) throw providerError('MUTUAL_FUND_SHARE_CLASS_REQUIRED');
    return classes[0];
  }

  async getFundMaster(query = {}) {
    if (query == null || typeof query !== 'object' || Array.isArray(query)) throw providerError('MUTUAL_FUND_QUERY_INVALID');
    return filterCandidateUniverse(this._fixtures.masters, query);
  }

  async getFundProfile(fundId) {
    const normalizedId = validateFundId(fundId);
    const master = this._resolveMaster(normalizedId);
    if (!master) throw providerError('MUTUAL_FUND_NOT_FOUND');
    const profile = this._fixtures.profiles && this._fixtures.profiles[master.masterFundId];
    if (!profile) throw providerError('MUTUAL_FUND_PROFILE_NOT_FOUND');
    const result = cloneValue(profile);
    result.fundId = normalizedId;
    const shareClass = this._shareClass(normalizedId);
    if (shareClass) result.shareClass = cloneValue(shareClass);
    return result;
  }

  async getShareClasses(masterFundId) {
    const normalizedId = validateFundId(masterFundId);
    if (!this._master(normalizedId)) throw providerError('MUTUAL_FUND_NOT_FOUND');
    return this._fixtures.shareClasses
      .filter((item) => item.masterFundId === normalizedId)
      .map((item) => cloneValue(item));
  }

  async getNavHistory(fundId, startDate, endDate) {
    const normalizedId = validateFundId(fundId);
    const { start, end } = validateDateRange(startDate, endDate);
    const shareClass = this._resolveShareClass(normalizedId);
    if (!shareClass) throw providerError('MUTUAL_FUND_NOT_FOUND');
    const rows = this._fixtures.navHistory && this._fixtures.navHistory[shareClass.fundId];
    if (!Array.isArray(rows)) throw providerError('MUTUAL_FUND_NAV_NOT_FOUND');
    return rows
      .filter((row) => (!start || row.date >= start) && (!end || row.date <= end))
      .map((row) => cloneValue(row));
  }

  async getFundDocuments(fundId) {
    const normalizedId = validateFundId(fundId);
    const master = this._resolveMaster(normalizedId);
    if (!master) throw providerError('MUTUAL_FUND_NOT_FOUND');
    return (this._fixtures.documents && this._fixtures.documents[master.masterFundId] || []).map((item) => cloneValue(item));
  }

  async getFundAllocation(fundId, asOf) {
    const normalizedId = validateFundId(fundId);
    const date = validateIsoDate(asOf, 'MUTUAL_FUND_AS_OF_DATE_INVALID');
    const master = this._resolveMaster(normalizedId);
    if (!master) throw providerError('MUTUAL_FUND_NOT_FOUND');
    const snapshots = this._fixtures.allocations && this._fixtures.allocations[master.masterFundId] || [];
    const eligible = snapshots.filter((item) => !date || item.asOf <= date).sort((a, b) => a.asOf.localeCompare(b.asOf));
    return eligible.length ? cloneValue(eligible[eligible.length - 1]) : null;
  }
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rewriteMockMetadata(value, seed, seen = new WeakMap()) {
  if (typeof value === 'string') return value.startsWith('fixture://') ? `mock://${value.slice('fixture://'.length)}` : value;
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const result = Array.isArray(value) ? [] : {};
  seen.set(value, result);
  for (const [key, item] of Object.entries(value)) result[key] = rewriteMockMetadata(item, seed, seen);
  if (!Array.isArray(result) && result.source && result.source.provider === 'FIXTURE') {
    result.source.provider = 'MOCK';
    result.source.mockSeed = seed;
  }
  if (!Array.isArray(result) && result.freshness && result.freshness.status === 'FIXTURE') result.freshness.status = 'MOCK';
  return result;
}

function buildMockFixtures(seed) {
  const fixtures = rewriteMockMetadata(MUTUAL_FUND_FIXTURES, seed);
  for (const [fundId, rows] of Object.entries(fixtures.navHistory)) {
    const scale = 1 + ((hashSeed(`${seed}:${fundId}`) % 21) - 10) / 10000;
    for (const row of rows) row.nav = Number((row.nav * scale).toFixed(4));
  }
  fixtures.datasetId = `${fixtures.datasetId}-mock-${seed}`;
  return fixtures;
}

class MockMutualFundAdapter extends FixtureMutualFundAdapter {
  constructor(options = {}) {
    const seed = Number.isFinite(Number(options.seed)) ? Number(options.seed) : 731;
    super({ fixtures: options.fixtures || buildMockFixtures(seed) });
    this.mode = 'mock';
    this.seed = seed;
  }
}

function setSmartOperation(contract, method) {
  const candidate = contract && contract.operations && contract.operations[method] || contract && contract[method];
  if (typeof candidate === 'function') return candidate;
  if (candidate && typeof candidate.execute === 'function') return candidate.execute.bind(candidate);
  return null;
}

function addSetSmartMetadata(item, method, contract) {
  if (item == null || typeof item !== 'object' || Array.isArray(item)) return item;
  const result = cloneValue(item);
  const sourceRefs = result.source && (result.source.sourceRefs || (result.source.sourceRef ? [result.source.sourceRef] : null));
  if (!result.source || !Array.isArray(sourceRefs) || sourceRefs.length === 0 || sourceRefs.some((value) => typeof value !== 'string' || !value.trim())) {
    throw providerError('SETSMART_SOURCE_LINEAGE_REQUIRED');
  }
  result.source = {
    ...result.source,
    provider: 'SETSMART',
    contractId: contract.id || contract.contractId || null,
    contractVersion: contract.version || contract.contractVersion || null,
    sourceRefs: [...sourceRefs],
  };
  if (!result.freshness || typeof result.freshness.isStale !== 'boolean' || !validateIsoDate(result.freshness.asOf, 'SETSMART_FRESHNESS_AS_OF_INVALID')) {
    throw providerError('SETSMART_FRESHNESS_REQUIRED');
  }
  if (method === 'getNavHistory') {
    const returnType = upper(result.returnType || 'UNSPECIFIED');
    const rawNav = upper(result.navType).includes('RAW') || result.distributionAdjusted === false || result.distributionsIncluded === false;
    if (returnType === 'TOTAL_RETURN' && rawNav) throw providerError('SETSMART_CONTRACT_RESULT_INVALID');
    result.returnType = returnType;
    if (!Object.prototype.hasOwnProperty.call(result, 'isTotalReturn')) result.isTotalReturn = returnType === 'TOTAL_RETURN';
  }
  return result;
}

function validateSetSmartResult(method, value) {
  if (ARRAY_RESULT_METHODS.has(method)) {
    if (!Array.isArray(value)) throw providerError('SETSMART_CONTRACT_RESULT_INVALID');
    return;
  }
  if (method === 'getFundAllocation' && value === null) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw providerError('SETSMART_CONTRACT_RESULT_INVALID');
}

class SetSmartMutualFundAdapter extends MutualFundDataProvider {
  /**
   * The adapter deliberately has no endpoint, auth-header, or response-schema
   * knowledge. A reviewed contract supplies an executor for each operation:
   *   operations.getFundMaster(args, { transport, getApiKey }) => FundMaster[]
   * The executor owns the documented request and parsing rules.
   */
  constructor(options = {}) {
    super();
    const env = options.env || process.env;
    const policy = providerPolicyFromEnv(env);
    this.mode = 'setsmart';
    const timeoutMs = finiteOption(options.timeoutMs, policy.timeoutMs, { min: 1, integer: true });
    Object.defineProperty(this, '_contract', { value: options.contract || null, enumerable: false });
    Object.defineProperty(this, '_transport', { value: options.transport || null, enumerable: false });
    Object.defineProperty(this, '_timeoutMs', { value: timeoutMs, enumerable: false });
    Object.defineProperty(this, '_getConfiguredKey', {
      value: typeof options.keyProvider === 'function'
        ? options.keyProvider
        : () => env && env.SETSMART_API_KEY,
      enumerable: false,
    });
  }

  toJSON() {
    return {
      provider: 'SETSMART',
      contractConfigured: Boolean(this._contract && this._contract.documented === true),
      transportConfigured: Boolean(this._transport),
      contractId: this._contract && (this._contract.id || this._contract.contractId) || null,
      contractVersion: this._contract && (this._contract.version || this._contract.contractVersion) || null,
      timeoutMs: this._timeoutMs,
    };
  }

  async _execute(method, args) {
    const contract = this._contract;
    if (!contract || contract.documented !== true) throw providerError('SETSMART_DOCUMENTED_CONTRACT_REQUIRED');
    if (!this._transport || typeof this._transport !== 'function' && typeof this._transport.request !== 'function') {
      throw providerError('SETSMART_TRANSPORT_REQUIRED');
    }
    const operation = setSmartOperation(contract, method);
    if (!operation) throw providerError('SETSMART_CONTRACT_OPERATION_UNAVAILABLE');

    let apiKey;
    try {
      apiKey = this._getConfiguredKey();
    } catch (_error) {
      throw providerError('SETSMART_API_KEY_NOT_CONFIGURED');
    }
    if (typeof apiKey !== 'string' || apiKey.trim() === '') throw providerError('SETSMART_API_KEY_NOT_CONFIGURED');

    let raw;
    try {
      raw = await withTimeout(operation(cloneValue(args), Object.freeze({
        transport: this._transport,
        getApiKey: () => apiKey,
        contractId: contract.id || contract.contractId || null,
        contractVersion: contract.version || contract.contractVersion || null,
        timeoutMs: this._timeoutMs,
      })), this._timeoutMs);
    } catch (error) {
      throw sanitizedSetSmartError(error);
    }

    const redacted = redactSecrets(raw, [apiKey]);
    validateSetSmartResult(method, redacted);
    const decorated = Array.isArray(redacted)
      ? redacted.map((item) => addSetSmartMetadata(item, method, contract))
      : addSetSmartMetadata(redacted, method, contract);
    return method === 'getFundMaster' ? filterCandidateUniverse(decorated, args.query || {}) : decorated;
  }

  async getFundMaster(query = {}) {
    if (query == null || typeof query !== 'object' || Array.isArray(query)) throw providerError('MUTUAL_FUND_QUERY_INVALID');
    return this._execute('getFundMaster', { query: cloneValue(query) });
  }

  async getFundProfile(fundId) {
    return this._execute('getFundProfile', { fundId: validateFundId(fundId) });
  }

  async getShareClasses(masterFundId) {
    return this._execute('getShareClasses', { masterFundId: validateFundId(masterFundId) });
  }

  async getNavHistory(fundId, startDate, endDate) {
    const range = validateDateRange(startDate, endDate);
    return this._execute('getNavHistory', {
      fundId: validateFundId(fundId),
      startDate: range.start,
      endDate: range.end,
    });
  }

  async getFundDocuments(fundId) {
    return this._execute('getFundDocuments', { fundId: validateFundId(fundId) });
  }

  async getFundAllocation(fundId, asOf) {
    return this._execute('getFundAllocation', {
      fundId: validateFundId(fundId),
      asOf: validateIsoDate(asOf, 'MUTUAL_FUND_AS_OF_DATE_INVALID'),
    });
  }
}

function assertProviderContract(provider) {
  if (!provider || PROVIDER_METHODS.some((method) => typeof provider[method] !== 'function')) {
    throw providerError('MUTUAL_FUND_PROVIDER_CONTRACT_INVALID');
  }
}

class CachedMutualFundProvider extends MutualFundDataProvider {
  constructor(provider, options = {}) {
    super();
    assertProviderContract(provider);
    const ttlMs = options.ttlMs == null ? 300000 : Number(options.ttlMs);
    if (!Number.isFinite(ttlMs) || ttlMs < 0) throw providerError('MUTUAL_FUND_CACHE_TTL_INVALID');
    const maxEntries = options.maxEntries == null ? 500 : Number(options.maxEntries);
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw providerError('MUTUAL_FUND_CACHE_SIZE_INVALID');
    const staleFallbackMs = finiteOption(options.staleFallbackMs, 86400000, { min: 0, integer: true });
    const maxRetries = finiteOption(options.maxRetries, 2, { min: 0, integer: true });
    const retryBaseMs = finiteOption(options.retryBaseMs, 250, { min: 0, integer: true });
    const failureBackoffMs = finiteOption(options.failureBackoffMs, 60000, { min: 0, integer: true });
    this.mode = `cached:${provider.mode || 'provider'}`;
    Object.defineProperty(this, '_provider', { value: provider, enumerable: false });
    Object.defineProperty(this, '_ttlMs', { value: ttlMs, enumerable: false });
    Object.defineProperty(this, '_maxEntries', { value: maxEntries, enumerable: false });
    Object.defineProperty(this, '_staleFallbackMs', { value: staleFallbackMs, enumerable: false });
    Object.defineProperty(this, '_maxRetries', { value: maxRetries, enumerable: false });
    Object.defineProperty(this, '_retryBaseMs', { value: retryBaseMs, enumerable: false });
    Object.defineProperty(this, '_failureBackoffMs', { value: failureBackoffMs, enumerable: false });
    Object.defineProperty(this, '_now', { value: typeof options.now === 'function' ? options.now : Date.now, enumerable: false });
    Object.defineProperty(this, '_sleep', { value: typeof options.sleep === 'function' ? options.sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms)), enumerable: false });
    Object.defineProperty(this, '_cache', { value: new Map(), enumerable: false });
    Object.defineProperty(this, '_inFlight', { value: new Map(), enumerable: false });
    this._backoffUntil = 0;
    this._lastStatus = Object.freeze({ state: 'READY', at: new Date(Number(this._now())).toISOString(), errorCode: null });
  }

  _key(method, args) {
    return `${method}:${stableSerialize(args)}`;
  }

  _trimCache() {
    while (this._cache.size > this._maxEntries) this._cache.delete(this._cache.keys().next().value);
  }

  _setStatus(state, details = {}) {
    this._lastStatus = Object.freeze({
      state,
      at: new Date(Number(this._now())).toISOString(),
      errorCode: details.errorCode || null,
      method: details.method || null,
      attempts: details.attempts || 0,
      cacheAgeMs: Number.isFinite(details.cacheAgeMs) ? details.cacheAgeMs : null,
      backoffUntil: this._backoffUntil > Number(this._now()) ? new Date(this._backoffUntil).toISOString() : null,
    });
  }

  _retryable(error) {
    return new Set(['SETSMART_RATE_LIMITED', 'SETSMART_TIMEOUT', 'SETSMART_PROVIDER_UNAVAILABLE']).has(error && error.code);
  }

  async _requestWithRetry(method, args) {
    let attempts = 0;
    while (true) {
      attempts += 1;
      try {
        return { value: await this._provider[method](...args), attempts };
      } catch (error) {
        if (!this._retryable(error) || attempts > this._maxRetries) throw Object.assign(error, { attempts });
        const providerDelay = Number(error.retryAfterMs);
        const delay = Number.isFinite(providerDelay)
          ? Math.min(Math.max(0, providerDelay), 30000)
          : Math.min(this._retryBaseMs * 2 ** (attempts - 1), 30000);
        if (delay > 0) await this._sleep(delay);
      }
    }
  }

  async _call(method, args) {
    const key = this._key(method, args);
    const now = Number(this._now());
    const cached = this._cache.get(key);
    if (cached && cached.expiresAt > now) {
      this._setStatus('CACHE_HIT', { method, cacheAgeMs: now - cached.storedAt });
      return cloneValue(cached.value);
    }
    if (cached && this._backoffUntil > now && cached.staleUntil > now) {
      this._setStatus('STALE_FALLBACK', { method, errorCode: 'PROVIDER_BACKOFF_ACTIVE', cacheAgeMs: now - cached.storedAt });
      return cloneValue(cached.value);
    }
    if (this._inFlight.has(key)) return cloneValue(await this._inFlight.get(key));

    const request = Promise.resolve()
      .then(() => this._requestWithRetry(method, args))
      .then(({ value, attempts }) => {
        const storedAt = Number(this._now());
        const stored = cloneValue(value);
        this._cache.set(key, {
          value: stored,
          storedAt,
          expiresAt: storedAt + this._ttlMs,
          staleUntil: storedAt + this._ttlMs + this._staleFallbackMs,
        });
        this._backoffUntil = 0;
        this._setStatus('REFRESHED', { method, attempts });
        this._trimCache();
        return stored;
      })
      .catch((error) => {
        const failedAt = Number(this._now());
        this._backoffUntil = failedAt + this._failureBackoffMs;
        if (cached && cached.staleUntil > failedAt) {
          this._setStatus('STALE_FALLBACK', {
            method,
            errorCode: error && error.code || 'PROVIDER_ERROR',
            attempts: error && error.attempts,
            cacheAgeMs: failedAt - cached.storedAt,
          });
          return cloneValue(cached.value);
        }
        this._setStatus('ERROR', { method, errorCode: error && error.code || 'PROVIDER_ERROR', attempts: error && error.attempts });
        throw error;
      });
    this._inFlight.set(key, request);
    try {
      return cloneValue(await request);
    } finally {
      if (this._inFlight.get(key) === request) this._inFlight.delete(key);
    }
  }

  clear() {
    const count = this._cache.size;
    this._cache.clear();
    this._backoffUntil = 0;
    this._setStatus('READY');
    return count;
  }

  invalidate(method, ...args) {
    if (!PROVIDER_METHODS.includes(method)) return 0;
    if (args.length) return this._cache.delete(this._key(method, args)) ? 1 : 0;
    let removed = 0;
    for (const key of [...this._cache.keys()]) {
      if (key.startsWith(`${method}:`)) {
        this._cache.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  cacheStats() {
    const now = Number(this._now());
    return {
      cachedEntries: this._cache.size,
      freshEntries: [...this._cache.values()].filter((item) => item.expiresAt > now).length,
      staleFallbackEntries: [...this._cache.values()].filter((item) => item.expiresAt <= now && item.staleUntil > now).length,
      inFlightRequests: this._inFlight.size,
      ttlMs: this._ttlMs,
      staleFallbackMs: this._staleFallbackMs,
    };
  }

  providerStatus() {
    return {
      mode: this.mode,
      status: cloneValue(this._lastStatus),
      cache: this.cacheStats(),
      policy: {
        maxRetries: this._maxRetries,
        retryBaseMs: this._retryBaseMs,
        failureBackoffMs: this._failureBackoffMs,
      },
      upstream: typeof this._provider.toJSON === 'function' ? this._provider.toJSON() : { mode: this._provider.mode || 'provider' },
    };
  }

  async getFundMaster(query = {}) { return this._call('getFundMaster', [query]); }
  async getFundProfile(fundId) { return this._call('getFundProfile', [fundId]); }
  async getShareClasses(masterFundId) { return this._call('getShareClasses', [masterFundId]); }
  async getNavHistory(fundId, startDate, endDate) { return this._call('getNavHistory', [fundId, startDate, endDate]); }
  async getFundDocuments(fundId) { return this._call('getFundDocuments', [fundId]); }
  async getFundAllocation(fundId, asOf) { return this._call('getFundAllocation', [fundId, asOf]); }
}

/**
 * Collapses holdings by master fund before diversification is assessed. Two
 * share classes of one master fund therefore remain one independent unit.
 */
function groupShareClassesByMaster(holdings, shareClasses = FUND_SHARE_CLASSES) {
  if (!Array.isArray(holdings)) throw providerError('MUTUAL_FUND_HOLDINGS_INVALID');
  const lookup = new Map();
  for (const shareClass of shareClasses || []) {
    if (shareClass && shareClass.fundId && shareClass.masterFundId) lookup.set(String(shareClass.fundId), String(shareClass.masterFundId));
    if (shareClass && shareClass.shareClassId && shareClass.masterFundId) lookup.set(String(shareClass.shareClassId), String(shareClass.masterFundId));
  }
  const grouped = new Map();
  for (const holding of holdings) {
    if (!holding || typeof holding !== 'object') continue;
    const fundId = String(holding.fundId || holding.shareClassId || holding.masterFundId || '');
    if (!fundId) continue;
    const masterFundId = String(holding.masterFundId || lookup.get(fundId) || fundId);
    if (!grouped.has(masterFundId)) {
      grouped.set(masterFundId, {
        masterFundId,
        shareClassIds: [],
        holdingCount: 0,
        totalWeight: 0,
        totalMarketValue: 0,
        holdings: [],
        independentDiversificationUnit: true,
      });
    }
    const group = grouped.get(masterFundId);
    if (!group.shareClassIds.includes(fundId)) group.shareClassIds.push(fundId);
    group.holdingCount += 1;
    if (Number.isFinite(Number(holding.weight))) group.totalWeight += Number(holding.weight);
    const marketValue = holding.marketValue != null ? Number(holding.marketValue) : holding.value != null ? Number(holding.value) : NaN;
    if (Number.isFinite(marketValue)) group.totalMarketValue += marketValue;
    group.holdings.push(cloneValue(holding));
  }
  return [...grouped.values()];
}

function createMutualFundProvider(options = {}) {
  const env = options.env || process.env;
  const mode = normalizedProviderMode(options, env);
  const policy = providerPolicyFromEnv(env);
  let provider;
  if (mode === 'FIXTURE') {
    provider = new FixtureMutualFundAdapter({ fixtures: options.fixtures });
  } else if (mode === 'MOCK') {
    provider = new MockMutualFundAdapter({ fixtures: options.fixtures, seed: options.seed });
  } else if (mode === 'SETSMART') {
    provider = new SetSmartMutualFundAdapter({
      contract: options.contract,
      transport: options.transport,
      env,
      keyProvider: options.keyProvider,
      timeoutMs: options.timeoutMs == null ? policy.timeoutMs : options.timeoutMs,
    });
  } else {
    throw providerError('MUTUAL_FUND_PROVIDER_MODE_INVALID');
  }

  const defaultLiveCache = mode === 'SETSMART' && options.cache !== false;
  if (options.cache && typeof options.cache === 'object') return new CachedMutualFundProvider(provider, options.cache);
  if (options.cache === true || defaultLiveCache) {
    return new CachedMutualFundProvider(provider, {
      ttlMs: policy.cacheTtlMs,
      staleFallbackMs: policy.staleFallbackMs,
      maxRetries: policy.maxRetries,
      retryBaseMs: policy.retryBaseMs,
      failureBackoffMs: policy.failureBackoffMs,
    });
  }
  return provider;
}

const createMutualFundDataProvider = createMutualFundProvider;

module.exports = {
  PROVIDER_METHODS,
  FIXTURE_IDS,
  MutualFundDataProvider,
  SetSmartMutualFundAdapter,
  FixtureMutualFundAdapter,
  MockMutualFundAdapter,
  CachedMutualFundProvider,
  providerPolicyFromEnv,
  normalizedProviderMode,
  createMutualFundProvider,
  createMutualFundDataProvider,
  evaluateCandidateEligibility,
  filterCandidateUniverse,
  filterCandidateFunds,
  groupShareClassesByMaster,
};
