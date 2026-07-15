'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
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
  evaluateCandidateEligibility,
  groupShareClassesByMaster,
} = require('../lib/v3/mutual-funds');
const {
  FUND_MASTERS,
  FUND_SHARE_CLASSES,
} = require('../lib/v3/mutual-fund-fixtures');

function eligibleSetSmartMaster(extra = {}) {
  return {
    masterFundId: 'TH-CONTRACT-MASTER-001',
    fundCode: 'CONTRACT-DEMO',
    nameTh: 'กองทุนจากสัญญาทดสอบ',
    registrationCountryCode: 'TH',
    thaiRegistered: true,
    riskLevel: 4,
    approved: true,
    approvedShelf: { status: 'APPROVED' },
    eligibility: { status: 'ELIGIBLE', minClientRiskLevel: 3 },
    dataQuality: { status: 'PASS', requiredFieldsComplete: true },
    permissions: ['VIEW', 'ADVISE'],
    source: { provider: 'SETSMART', sourceRefs: ['contract://reviewed-test-contract/fund-master'] },
    freshness: { asOf: '2026-07-14', status: 'CURRENT', isStale: false },
    ...extra,
  };
}

test('provider contract and factory expose the six stable operations and default to fixture mode', () => {
  const provider = createMutualFundProvider({ env: {} });
  assert.ok(provider instanceof MutualFundDataProvider);
  assert.ok(provider instanceof FixtureMutualFundAdapter);
  assert.deepEqual(PROVIDER_METHODS, [
    'getFundMaster',
    'getFundProfile',
    'getShareClasses',
    'getNavHistory',
    'getFundDocuments',
    'getFundAllocation',
  ]);
  for (const method of PROVIDER_METHODS) assert.equal(typeof provider[method], 'function');
  assert.ok(FIXTURE_IDS.masters.length >= 4);
  assert.ok(FIXTURE_IDS.shareClasses.length >= 5);
  assert.equal(new Set(FIXTURE_IDS.masters).size, FIXTURE_IDS.masters.length);
  assert.equal(new Set(FIXTURE_IDS.shareClasses).size, FIXTURE_IDS.shareClasses.length);
});

test('fixture candidate universe is Thai-only and fails closed across shelf, eligibility, quality, and permission gates', async () => {
  const provider = new FixtureMutualFundAdapter();
  const funds = await provider.getFundMaster();
  assert.deepEqual(funds.map((fund) => fund.masterFundId), [
    'TH-MF-CASH-001',
    'TH-MF-BOND-001',
    'TH-MF-EQ-001',
  ]);
  assert.ok(funds.every((fund) => fund.registrationCountryCode === 'TH'));

  const lowRisk = await provider.getFundMaster({ clientRiskLevel: 4 });
  assert.deepEqual(lowRisk.map((fund) => fund.masterFundId), ['TH-MF-CASH-001', 'TH-MF-BOND-001']);

  const noAdvicePermission = await provider.getFundMaster({ grantedPermissions: ['VIEW'] });
  assert.deepEqual(noAdvicePermission, []);

  const approvedByShareClass = await provider.getFundMaster({ approvedFundIds: ['TH-BOND-R'] });
  assert.deepEqual(approvedByShareClass.map((fund) => fund.masterFundId), ['TH-MF-BOND-001']);

  const rejectionCodes = new Map(FUND_MASTERS.map((fund) => [
    fund.masterFundId,
    evaluateCandidateEligibility(fund).reasonCodes,
  ]));
  assert.ok(rejectionCodes.get('TH-MF-GLOBAL-001').includes('NOT_ON_APPROVED_SHELF'));
  assert.ok(rejectionCodes.get('TH-MF-MIXED-STALE-001').includes('DATA_QUALITY_FAILED'));
  assert.ok(rejectionCodes.get('TH-MF-RESTRICTED-001').includes('PERMISSION_DENIED'));
});

test('candidate eligibility fails closed when freshness is missing or unknown', () => {
  assert.equal(evaluateCandidateEligibility(eligibleSetSmartMaster({ freshness: undefined })).eligible, false);
  assert.equal(evaluateCandidateEligibility(eligibleSetSmartMaster({ freshness: { asOf: '2026-07-14', status: 'UNKNOWN', isStale: null } })).eligible, false);
  assert.equal(evaluateCandidateEligibility(eligibleSetSmartMaster()).eligible, true);
});

test('fixture NAV history is deterministic, spans about five years, and never labels raw NAV as total return', async () => {
  const provider = new FixtureMutualFundAdapter();
  const firstRead = await provider.getNavHistory('TH-BOND-A');
  const secondRead = await provider.getNavHistory('TH-BOND-A');
  assert.deepEqual(firstRead, secondRead);
  assert.equal(firstRead.length, 1305);
  assert.equal(firstRead[firstRead.length - 1].date, '2026-07-14');
  const spanDays = (new Date(firstRead[firstRead.length - 1].date) - new Date(firstRead[0].date)) / 86400000;
  assert.ok(spanDays >= 365.25 * 4.9);
  assert.ok(firstRead.every((row) => row.returnType === 'NAV_RETURN'));
  assert.ok(firstRead.every((row) => row.navType === 'RAW_NAV'));
  assert.ok(firstRead.every((row) => row.isTotalReturn === false && row.distributionsIncluded === false));
  assert.ok(firstRead.every((row) => row.source.provider === 'FIXTURE' && row.freshness.asOf === row.date));

  const range = await provider.getNavHistory('TH-BOND-A', '2026-07-01', '2026-07-14');
  assert.ok(range.length > 1);
  assert.ok(range.every((row) => row.date >= '2026-07-01' && row.date <= '2026-07-14'));

  firstRead[0].nav = -1;
  assert.ok((await provider.getNavHistory('TH-BOND-A'))[0].nav > 0, 'fixture results are defensive copies');
});

test('share classes of one master fund collapse to one diversification unit', () => {
  const groups = groupShareClassesByMaster([
    { fundId: 'TH-BOND-A', weight: 0.2, marketValue: 200000 },
    { fundId: 'TH-BOND-R', weight: 0.3, marketValue: 300000 },
    { fundId: 'TH-EQ-A', weight: 0.5, marketValue: 500000 },
  ], FUND_SHARE_CLASSES);
  assert.equal(groups.length, 2);
  const bond = groups.find((group) => group.masterFundId === 'TH-MF-BOND-001');
  assert.deepEqual(bond.shareClassIds, ['TH-BOND-A', 'TH-BOND-R']);
  assert.equal(bond.holdingCount, 2);
  assert.equal(bond.totalWeight, 0.5);
  assert.equal(bond.totalMarketValue, 500000);
  assert.equal(bond.independentDiversificationUnit, true);
});

test('mock provider is repeatable for the same seed and remains visibly synthetic', async () => {
  const a = new MockMutualFundAdapter({ seed: 44 });
  const b = new MockMutualFundAdapter({ seed: 44 });
  const c = new MockMutualFundAdapter({ seed: 45 });
  const navA = await a.getNavHistory('TH-EQ-A', '2026-07-01', '2026-07-14');
  const navB = await b.getNavHistory('TH-EQ-A', '2026-07-01', '2026-07-14');
  const navC = await c.getNavHistory('TH-EQ-A', '2026-07-01', '2026-07-14');
  assert.deepEqual(navA, navB);
  assert.notDeepEqual(navA, navC);
  assert.ok(navA.every((row) => row.source.provider === 'MOCK'));
  assert.ok(navA.every((row) => row.source.synthetic === true));
});

test('SETSMART adapter fails closed before transport when the documented contract or key is absent', async () => {
  let transportCalls = 0;
  const transport = async () => {
    transportCalls += 1;
    return [];
  };
  const withoutContract = new SetSmartMutualFundAdapter({
    transport,
    env: { SETSMART_API_KEY: 'unit-test-key' },
  });
  await assert.rejects(
    withoutContract.getFundMaster(),
    (error) => error.code === 'SETSMART_DOCUMENTED_CONTRACT_REQUIRED'
  );
  assert.equal(transportCalls, 0);

  const withoutKey = new SetSmartMutualFundAdapter({
    contract: { documented: true, operations: { getFundMaster: async () => [] } },
    transport,
    env: {},
  });
  await assert.rejects(
    withoutKey.getFundMaster(),
    (error) => error.code === 'SETSMART_API_KEY_NOT_CONFIGURED'
  );
  assert.equal(transportCalls, 0);
});

test('SETSMART adapter uses only the injected contract and transport and redacts credentials from results and errors', async () => {
  const secret = 'unit-test-server-secret';
  let capturedRequest;
  const transport = async (request) => {
    capturedRequest = request;
    return [eligibleSetSmartMaster({
      authorization: request.serverCredential,
      contractNote: `authenticated with ${request.serverCredential}`,
      [request.serverCredential]: 'must not survive as a property name',
    })];
  };
  const contract = {
    documented: true,
    id: 'reviewed-test-contract',
    version: '1.0-test',
    operations: {
      getFundMaster: (args, context) => context.transport({
        query: args.query,
        serverCredential: context.getApiKey(),
      }),
    },
  };
  const adapter = new SetSmartMutualFundAdapter({
    contract,
    transport,
    env: { SETSMART_API_KEY: secret },
  });
  const result = await adapter.getFundMaster({ clientRiskLevel: 4 });
  assert.equal(capturedRequest.serverCredential, secret);
  assert.equal(result.length, 1);
  assert.equal(result[0].source.provider, 'SETSMART');
  assert.equal(Object.prototype.hasOwnProperty.call(result[0], 'authorization'), false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.match(result[0].contractNote, /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(adapter), new RegExp(secret));

  const failing = new SetSmartMutualFundAdapter({
    contract: {
      documented: true,
      operations: {
        getFundMaster: async (_args, context) => {
          throw new Error(`vendor exposed ${context.getApiKey()}`);
        },
      },
    },
    transport,
    env: { SETSMART_API_KEY: secret },
  });
  await assert.rejects(
    failing.getFundMaster(),
    (error) => error.code === 'SETSMART_PROVIDER_UNAVAILABLE' && !error.message.includes(secret)
  );
});

test('SETSMART contract cannot label unadjusted raw NAV as total return', async () => {
  const adapter = new SetSmartMutualFundAdapter({
    contract: {
      documented: true,
      operations: {
        getNavHistory: async () => [{
          fundId: 'TH-RAW-A',
          date: '2026-07-14',
          nav: 10.2,
          navType: 'RAW_NAV',
          returnType: 'TOTAL_RETURN',
          distributionAdjusted: false,
          source: { provider: 'SETSMART', sourceRefs: ['contract://reviewed-test-contract/nav/TH-RAW-A'] },
          freshness: { asOf: '2026-07-14', status: 'CURRENT', isStale: false },
        }],
      },
    },
    transport: async () => [],
    env: { SETSMART_API_KEY: 'unit-test-key' },
  });
  await assert.rejects(
    adapter.getNavHistory('TH-RAW-A', '2026-07-01', '2026-07-14'),
    (error) => error.code === 'SETSMART_CONTRACT_RESULT_INVALID'
  );
});

test('SETSMART adapter enforces timeout, sanitizes rate limits, and requires source/freshness lineage', async () => {
  const context = {
    transport: async () => [],
    env: { SETSMART_API_KEY: 'unit-test-key' },
    timeoutMs: 5,
  };
  const timeout = new SetSmartMutualFundAdapter({
    ...context,
    contract: { documented: true, operations: { getFundMaster: async () => new Promise(() => {}) } },
  });
  await assert.rejects(() => timeout.getFundMaster(), { code: 'SETSMART_TIMEOUT' });

  const limited = new SetSmartMutualFundAdapter({
    ...context,
    contract: { documented: true, operations: { getFundMaster: async () => { throw Object.assign(new Error('vendor detail'), { statusCode: 429, retryAfterMs: 17 }); } } },
  });
  await assert.rejects(
    () => limited.getFundMaster(),
    (error) => error.code === 'SETSMART_RATE_LIMITED' && error.retryAfterMs === 17 && !error.message.includes('vendor detail')
  );

  const missingLineage = new SetSmartMutualFundAdapter({
    ...context,
    contract: { documented: true, operations: { getFundMaster: async () => [{ ...eligibleSetSmartMaster(), source: undefined }] } },
  });
  await assert.rejects(() => missingLineage.getFundMaster(), { code: 'SETSMART_SOURCE_LINEAGE_REQUIRED' });
});

test('cached provider applies TTL, defensive copies, and concurrent in-flight de-duplication', async () => {
  let now = 1000;
  let profileCalls = 0;
  let releaseFirst;
  const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
  const base = {
    mode: 'counting-test',
    async getFundMaster() { return []; },
    async getFundProfile(fundId) {
      profileCalls += 1;
      if (profileCalls === 1) await firstPending;
      return { fundId, call: profileCalls };
    },
    async getShareClasses() { return []; },
    async getNavHistory() { return []; },
    async getFundDocuments() { return []; },
    async getFundAllocation() { return null; },
  };
  const cached = new CachedMutualFundProvider(base, { ttlMs: 100, now: () => now });
  const first = cached.getFundProfile('TH-TEST-A');
  const concurrent = cached.getFundProfile('TH-TEST-A');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(profileCalls, 1);
  releaseFirst();
  const [firstValue, concurrentValue] = await Promise.all([first, concurrent]);
  assert.deepEqual(firstValue, concurrentValue);

  firstValue.call = 999;
  assert.equal((await cached.getFundProfile('TH-TEST-A')).call, 1);
  assert.equal(profileCalls, 1);

  now = 1101;
  assert.equal((await cached.getFundProfile('TH-TEST-A')).call, 2);
  assert.equal(profileCalls, 2);
});

test('cached provider retries bounded transient failures, serves visible stale fallback, and applies backoff', async () => {
  let now = 0;
  let calls = 0;
  let fail = false;
  const base = {
    mode: 'setsmart-test',
    async getFundMaster() { return []; },
    async getFundProfile(fundId) {
      calls += 1;
      if (fail) throw Object.assign(new Error('private vendor detail'), { code: 'SETSMART_RATE_LIMITED', retryAfterMs: 0 });
      return { fundId, revision: calls };
    },
    async getShareClasses() { return []; },
    async getNavHistory() { return []; },
    async getFundDocuments() { return []; },
    async getFundAllocation() { return null; },
  };
  const provider = new CachedMutualFundProvider(base, {
    ttlMs: 10,
    staleFallbackMs: 100,
    maxRetries: 1,
    retryBaseMs: 0,
    failureBackoffMs: 20,
    now: () => now,
    sleep: async () => {},
  });
  assert.equal((await provider.getFundProfile('TH-TEST')).revision, 1);
  now = 11;
  fail = true;
  assert.equal((await provider.getFundProfile('TH-TEST')).revision, 1);
  assert.equal(calls, 3, 'one refresh plus one bounded retry');
  assert.equal(provider.providerStatus().status.state, 'STALE_FALLBACK');
  assert.equal(provider.cacheStats().staleFallbackEntries, 1);

  now = 12;
  assert.equal((await provider.getFundProfile('TH-TEST')).revision, 1);
  assert.equal(calls, 3, 'backoff prevents another upstream request');

  now = 112;
  await assert.rejects(() => provider.getFundProfile('TH-TEST'), { code: 'SETSMART_RATE_LIMITED' });
  assert.equal(provider.providerStatus().status.state, 'ERROR');
});

test('provider mode and live resilience policy use the documented environment names', () => {
  assert.equal(normalizedProviderMode({}, { MUTUAL_FUND_DATA_MODE: 'setsmart' }), 'SETSMART');
  assert.equal(normalizedProviderMode({}, { MUTUAL_FUND_PROVIDER_MODE: 'mock' }), 'MOCK');
  assert.deepEqual(providerPolicyFromEnv({
    SETSMART_TIMEOUT_MS: '1200',
    SETSMART_CACHE_TTL_MS: '3000',
    SETSMART_STALE_FALLBACK_MS: '4000',
    SETSMART_MAX_RETRIES: '1',
    SETSMART_RETRY_BASE_MS: '5',
    SETSMART_FAILURE_BACKOFF_MS: '6000',
  }), {
    timeoutMs: 1200,
    cacheTtlMs: 3000,
    staleFallbackMs: 4000,
    maxRetries: 1,
    retryBaseMs: 5,
    failureBackoffMs: 6000,
  });
  const live = createMutualFundProvider({
    env: { MUTUAL_FUND_DATA_MODE: 'setsmart', SETSMART_API_KEY: 'unit-test-key' },
    contract: { documented: true, operations: {} },
    transport: async () => [],
  });
  assert.ok(live instanceof CachedMutualFundProvider);
  assert.equal(live.mode, 'cached:setsmart');
});

test('provider source contains no endpoint guess, logging path, or embedded credential literal', () => {
  const files = [
    path.join(__dirname, '..', 'lib', 'v3', 'mutual-funds.js'),
    path.join(__dirname, '..', 'lib', 'v3', 'mutual-fund-fixtures.js'),
  ];
  const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(source, /https?:\/\//i);
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)\s*\(/);
  assert.doesNotMatch(source, /SETSMART_API_KEY\s*[:=]\s*['"][^'"]+['"]/);
  assert.doesNotMatch(source, /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
});
