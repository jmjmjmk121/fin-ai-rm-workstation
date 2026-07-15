'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ProductDataProviderRegistry,
  SetSmartListedProductDataProvider,
  productIdForSymbol,
  symbolFromProductId,
} = require('../lib/v3/product-registry');

const SOURCE_REF = 'https://www.setsmart.com/api/listed-company-api/eod-price-by-security-type?securityType=All';

function row(symbol, securityType, close, extra = {}) {
  return {
    date: '2026-07-15', symbol, securityType, adjustedPriceFlag: 'Y',
    prior: close - 0.1, open: close - 0.05, high: close + 0.1, low: close - 0.2,
    close, average: close, aomVolume: 100, aomValue: close * 100,
    trVolume: 0, trValue: 0, totalVolume: 100, totalValue: close * 100,
    pe: null, pbv: null, bvps: securityType === 'ETF' ? close + 0.01 : null,
    dividendYield: null, marketCap: close * 1000000, volumeTurnover: 0.1,
    priceReturnBasis: 'CLOSE_PRICE', returnType: 'PRICE_RETURN', totalReturnAvailable: false,
    nav: securityType === 'ETF' ? close + 0.01 : null,
    navField: securityType === 'ETF' ? 'bvps' : null,
    navSemantics: securityType === 'ETF' ? 'SETSMART_BVPS_DEFINED_AS_NAV_FOR_LISTED_UT_OR_ETF' : 'NOT_SUPPORTED',
    source: { provider: 'SETSMART', sourceRef: SOURCE_REF, endpointContract: 'Company Fundamental Data API Specification V1.0' },
    ...extra,
  };
}

function latestResult(observations) {
  return {
    provider: 'SETSMART', requestedAsOf: '2026-07-15', marketAsOf: observations[0]?.date || null,
    adjustedPriceFlag: 'Y', observations, observationCount: observations.length,
    cache: { state: 'LIVE', ageMs: 0 },
    source: { sourceRef: SOURCE_REF, returnType: 'PRICE_RETURN', totalReturnAvailable: false },
  };
}

function stubProvider(observations) {
  return {
    latestCalls: [],
    historyCalls: [],
    async getLatestBySecurityType(query) {
      this.latestCalls.push(query);
      const filtered = query.securityType === 'All'
        ? observations
        : observations.filter((item) => item.securityType === query.securityType);
      return latestResult(filtered);
    },
    async getBySymbol(query) {
      this.historyCalls.push(query);
      return {
        observations: observations.filter((item) => item.symbol === query.symbol),
        source: { sourceRef: SOURCE_REF, returnType: 'PRICE_RETURN', totalReturnAvailable: false },
      };
    },
    providerStatus() { return { state: 'TEST_READY' }; },
  };
}

test('search uses All latest EOD, stable IDs, deterministic sorting, pagination, and type counts', async () => {
  const listedProvider = stubProvider([
    row('ZZZ', 'CS', 12),
    row('AAA', 'ETF', 10),
    row('BBB', 'CS', 11),
  ]);
  const provider = new SetSmartListedProductDataProvider({ listedProvider, asOfDate: '2026-07-15' });
  const result = await provider.searchProducts({ sortBy: 'close', sortDirection: 'desc', offset: 1, limit: 2 });

  assert.equal(listedProvider.latestCalls[0].securityType, 'All');
  assert.deepEqual(result.products.map((item) => item.productId), ['SETSMART:BBB', 'SETSMART:AAA']);
  assert.deepEqual(result.countsBySecurityType, { CS: 2, ETF: 1 });
  assert.equal(result.total, 3);
  assert.equal(result.returned, 2);
  assert.equal(result.marketAsOf, '2026-07-15');
  assert.equal(result.returnType, 'PRICE_RETURN');
  assert.equal(result.totalReturnAvailable, false);
});

test('typed search filters upstream and maps unsupported facts without inventing product policy', async () => {
  const listedProvider = stubProvider([row('AAA', 'ETF', 10), row('BBB', 'CS', 20)]);
  const provider = new SetSmartListedProductDataProvider({ listedProvider, asOfDate: '2026-07-15' });
  const result = await provider.searchProducts({ securityType: 'ETF', q: 'aa', minClose: 9, limit: 50 });
  const product = result.products[0];

  assert.equal(listedProvider.latestCalls[0].securityType, 'ETF');
  assert.equal(product.productId, 'SETSMART:AAA');
  assert.equal(product.name, 'AAA');
  assert.equal(product.nameSemantics, 'SETSMART_SYMBOL_USED_AS_DISPLAY_NAME');
  assert.equal(product.source.type, 'SETSMART');
  assert.equal(product.source.asOf, '2026-07-15');
  assert.equal(product.marketData.close, 10);
  assert.equal(product.marketData.returnType, 'PRICE_RETURN');
  assert.equal(product.facts.issuerOrProvider.availability, 'NOT_SUPPORTED');
  assert.equal(product.facts.currency.value, null);
  assert.equal(product.facts.risk.availability, 'NOT_SUPPORTED');
  assert.equal(product.facts.fees.availability, 'NOT_SUPPORTED');
  assert.equal(product.facts.eligibility.availability, 'MISSING');
  assert.equal(product.facts.approvedShelfStatus.reasonCode, 'BANK_POLICY_APPROVED_SHELF_STATUS_REQUIRED');
});

test('getProduct resolves a safe SETSMART symbol ID and fails closed for unknown providers or symbols', async () => {
  const provider = new SetSmartListedProductDataProvider({ listedProvider: stubProvider([row('AAA', 'ETF', 10)]), asOfDate: '2026-07-15' });
  assert.equal(productIdForSymbol('aaa'), 'SETSMART:AAA');
  assert.equal(symbolFromProductId('setsmart:aaa'), 'AAA');
  assert.equal((await provider.getProduct('SETSMART:AAA')).symbol, 'AAA');
  await assert.rejects(() => provider.getProduct('SETSMART:NOPE'), { code: 'PRODUCT_NOT_FOUND', statusCode: 404 });
  await assert.rejects(() => provider.getProduct('FIXTURE:AAA'), { code: 'PRODUCT_PROVIDER_NOT_SUPPORTED' });
});

test('official SET symbols containing an ampersand remain addressable without broadening the ID grammar', () => {
  assert.equal(productIdForSymbol('f&d'), 'SETSMART:F&D');
  assert.equal(symbolFromProductId('SETSMART:L&E-F'), 'L&E-F');
  assert.throws(() => productIdForSymbol('BAD/SYMBOL'), { code: 'PRODUCT_SYMBOL_INVALID' });
});

test('history uses the symbol endpoint, excludes out-of-window rows, sorts dates, and preserves price-return lineage', async () => {
  const listedProvider = stubProvider([
    row('AAA', 'ETF', 12, { date: '2026-07-16' }),
    row('AAA', 'ETF', 10, { date: '2026-07-14' }),
    row('AAA', 'ETF', 11, { date: '2026-07-15' }),
  ]);
  const provider = new SetSmartListedProductDataProvider({ listedProvider, asOfDate: '2026-07-15' });
  const history = await provider.getHistory('SETSMART:AAA', '2026-07-14', '2026-07-15');

  assert.deepEqual(listedProvider.historyCalls[0], {
    symbol: 'AAA', startDate: '2026-07-14', endDate: '2026-07-15', adjustedPriceFlag: 'Y',
  });
  assert.deepEqual(history.map((item) => item.date), ['2026-07-14', '2026-07-15']);
  assert.ok(history.every((item) => item.returnType === 'PRICE_RETURN'));
  assert.ok(history.every((item) => item.totalReturnAvailable === false));
  assert.ok(history.every((item) => item.source.type === 'SETSMART'));
  assert.equal(Object.isFrozen(history), true);
});

test('corporate actions are explicitly NOT_SUPPORTED by the listed EOD contract', async () => {
  const provider = new SetSmartListedProductDataProvider({ listedProvider: stubProvider([]), asOfDate: '2026-07-15' });
  const result = await provider.getCorporateActions('SETSMART:AAA', '2026-01-01', '2026-07-15');
  assert.equal(result.availability, 'NOT_SUPPORTED');
  assert.equal(result.value, null);
  assert.equal(result.reasonCode, 'SETSMART_LISTED_EOD_CORPORATE_ACTIONS_NOT_SUPPORTED');
  assert.equal(result.source.type, 'SETSMART');
  assert.equal(result.source.asOf, '2026-07-15');
});

test('registry routes SETSMART methods and rejects unregistered sources', async () => {
  const setSmartProductProvider = new SetSmartListedProductDataProvider({
    listedProvider: stubProvider([row('AAA', 'ETF', 10)]),
    asOfDate: '2026-07-15',
  });
  const registry = new ProductDataProviderRegistry({ setSmartProductProvider });
  assert.equal((await registry.searchProducts({ limit: 10 })).total, 1);
  assert.equal((await registry.getProduct('SETSMART:AAA')).productId, 'SETSMART:AAA');
  assert.equal(registry.providerStatus().state, 'TEST_READY');
  await assert.rejects(() => registry.getProduct('FIXTURE:AAA'), { code: 'PRODUCT_SOURCE_PROVIDER_NOT_REGISTERED' });
});

test('duplicate vendor symbols fail rather than creating duplicate product IDs', async () => {
  const provider = new SetSmartListedProductDataProvider({
    listedProvider: stubProvider([row('AAA', 'ETF', 10), row('AAA', 'CS', 11)]),
    asOfDate: '2026-07-15',
  });
  await assert.rejects(() => provider.searchProducts(), { code: 'SETSMART_DUPLICATE_PRODUCT_ID', statusCode: 502 });
});
