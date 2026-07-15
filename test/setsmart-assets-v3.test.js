'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { paginateSetSmartAssets } = require('../server');

function row(symbol, securityType, extra = {}) {
  return {
    date: '2026-07-15', symbol, securityType, adjustedPriceFlag: 'Y', prior: 10, close: 11,
    nav: securityType === 'UT' || securityType === 'ETF' ? 10.5 : null,
    navField: securityType === 'UT' || securityType === 'ETF' ? 'bvps' : null,
    totalVolume: 100, totalValue: 1100, marketCap: 100000, dividendYield: null,
    returnType: 'PRICE_RETURN', totalReturnAvailable: false,
    source: { provider: 'SETSMART', sourceRef: 'https://www.setsmart.com/api/listed-company-api/eod-price-by-security-type?securityType=All' },
    ...extra,
  };
}

test('broad SETSMART universe is counted by type and browser payload is bounded', () => {
  const observations = [];
  for (let index = 0; index < 250; index += 1) observations.push(row(`STOCK${String(index).padStart(3, '0')}`, 'CS'));
  observations.push(row('SCBSET', 'UT'), row('TDEX', 'ETF'));
  const result = paginateSetSmartAssets({
    observations, marketAsOf: '2026-07-15', adjustedPriceFlag: 'Y', cache: { state: 'LIVE' }, source: { provider: 'SETSMART' },
  }, { limit: 500, offset: 0 });
  assert.equal(result.totalUniverse, 252);
  assert.equal(result.countsByType.CS, 250);
  assert.equal(result.countsByType.UT, 1);
  assert.equal(result.limit, 200);
  assert.equal(result.items.length, 200);
  assert.equal(result.nextOffset, 200);
});

test('asset search and type filter are deterministic and page-safe', () => {
  const result = paginateSetSmartAssets({
    observations: [row('SCBSET', 'UT'), row('TDEX', 'ETF'), row('SCB', 'CS')],
    marketAsOf: '2026-07-15', adjustedPriceFlag: 'Y', cache: { state: 'LIVE' }, source: { provider: 'SETSMART' },
  }, { securityType: 'UT', query: 'scb', limit: 10, offset: 0 });
  assert.equal(result.filteredTotal, 1);
  assert.equal(result.items[0].productId, 'SETSMART:SCBSET');
  assert.equal(result.items[0].returnType, 'PRICE_RETURN');
  assert.equal(result.items[0].totalReturnAvailable, false);
  assert.doesNotMatch(JSON.stringify(result), /api-key|SETSMART_API_KEY/i);
});

test('unsupported security types fail instead of silently broadening the universe', () => {
  assert.throws(
    () => paginateSetSmartAssets({ observations: [] }, { securityType: 'MUTUAL_FUND' }),
    (error) => error.statusCode === 400 && error.message === 'SETSMART_LISTED_SECURITY_TYPE_INVALID'
  );
});
