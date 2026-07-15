'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SETSMART_LISTED_BASE_URL,
  SetSmartListedEodProvider,
  normalizeEodRow,
  shiftIsoDate,
} = require('../lib/v3/setsmart-listed');

function response(status, payload, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    json: async () => payload,
  };
}

function officialRow(extra = {}) {
  return {
    date: '2026-07-15', symbol: 'SCBSET', securityType: 'UT', adjustedPriceFlag: 'Y',
    prior: 10.1, open: 10.2, high: 10.3, low: 10, close: 10.25, average: 10.2,
    aomVolume: 100, aomValue: 1025, trVolume: 0, trValue: 0, totalVolume: 100, totalValue: 1025,
    pe: null, pbv: null, bvps: 10.4, dividendYield: 2.1, marketCap: 1000000, volumeTurnover: 0.1,
    ...extra,
  };
}

test('normalizes only documented EOD semantics and never calls traded close total return', () => {
  const row = normalizeEodRow(officialRow({ privateVendorField: 'must-not-pass' }), `${SETSMART_LISTED_BASE_URL}/eod-price-by-security-type`);
  assert.equal(row.close, 10.25);
  assert.equal(row.nav, 10.4);
  assert.equal(row.navField, 'bvps');
  assert.equal(row.returnType, 'PRICE_RETURN');
  assert.equal(row.totalReturnAvailable, false);
  assert.equal(row.privateVendorField, undefined);
  assert.match(row.source.specification, /Company_Fundamental_Specification\.pdf/);
});

test('uses the official endpoint and server-side api-key header without returning the credential', async () => {
  const secret = 'server-only-test-key';
  const requests = [];
  const provider = new SetSmartListedEodProvider({
    mode: 'live', env: { SETSMART_API_KEY: secret }, maxRetries: 0,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), header: options.headers['api-key'] });
      return response(200, [officialRow()]);
    },
  });
  const result = await provider.getBySecurityType({ securityType: 'UT', date: '2026-07-15' });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^https:\/\/www\.setsmart\.com\/api\/listed-company-api\/eod-price-by-security-type\?/);
  assert.equal(requests[0].header, secret);
  assert.equal(result.observationCount, 1);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.equal(result.source.returnType, 'PRICE_RETURN');
});

test('latest lookup walks backward without using a future date', async () => {
  const dates = [];
  const provider = new SetSmartListedEodProvider({
    mode: 'live', env: { SETSMART_API_KEY: 'test-key' }, maxRetries: 0,
    fetchImpl: async (url) => {
      const date = new URL(String(url)).searchParams.get('date');
      dates.push(date);
      return response(200, date === '2026-07-13' ? [officialRow({ date })] : []);
    },
  });
  const result = await provider.getLatestBySecurityType({ securityType: 'UT', asOfDate: '2026-07-15', lookbackDays: 4 });
  assert.deepEqual(dates, ['2026-07-15', '2026-07-14', '2026-07-13']);
  assert.equal(result.requestedAsOf, '2026-07-15');
  assert.equal(result.marketAsOf, '2026-07-13');
  assert.equal(result.searchedBackDays, 2);
});

test('retries a sanitized 429 and then succeeds', async () => {
  let calls = 0;
  const delays = [];
  const provider = new SetSmartListedEodProvider({
    mode: 'live', env: { SETSMART_API_KEY: 'test-key' }, maxRetries: 1, retryBaseMs: 1,
    sleep: async (ms) => delays.push(ms),
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? response(429, {}, { 'retry-after': '2' }) : response(200, [officialRow()]);
    },
  });
  const result = await provider.getBySecurityType({ securityType: 'UT', date: '2026-07-15' });
  assert.equal(result.observationCount, 1);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [2000]);
});

test('returns bounded stale cache on a later provider failure', async () => {
  let now = Date.parse('2026-07-15T12:00:00Z');
  let fail = false;
  const provider = new SetSmartListedEodProvider({
    mode: 'live', env: { SETSMART_API_KEY: 'test-key' }, maxRetries: 0,
    cacheTtlMs: 10, staleFallbackMs: 1000, now: () => now,
    fetchImpl: async () => fail ? response(503, {}) : response(200, [officialRow()]),
  });
  await provider.getBySecurityType({ securityType: 'UT', date: '2026-07-15' });
  now += 100;
  fail = true;
  const stale = await provider.getBySecurityType({ securityType: 'UT', date: '2026-07-15' });
  assert.equal(stale.cache.state, 'STALE_FALLBACK');
  assert.equal(stale.cache.errorCode, 'SETSMART_LISTED_UNAVAILABLE');
  assert.equal(stale.observationCount, 1);
});

test('fails closed when live mode or server credential is missing and validates dates', async () => {
  const disabled = new SetSmartListedEodProvider({ env: {}, mode: 'fixture' });
  await assert.rejects(
    () => disabled.getBySecurityType({ securityType: 'UT', date: '2026-07-15' }),
    { code: 'SETSMART_LISTED_LIVE_MODE_DISABLED' }
  );
  const missingKey = new SetSmartListedEodProvider({ env: {}, mode: 'live', fetchImpl: async () => response(200, []) });
  await assert.rejects(
    () => missingKey.getBySecurityType({ securityType: 'ETF', date: '2026-07-15' }),
    { code: 'SETSMART_API_KEY_NOT_CONFIGURED' }
  );
  assert.equal(shiftIsoDate('2026-07-15', -1), '2026-07-14');
});
