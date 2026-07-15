'use strict';

const {
  SECURITY_TYPES,
  SETSMART_LISTED_SPEC_URL,
  createSetSmartListedProvider,
} = require('./setsmart-listed');
const {
  unavailableFact,
  validateProductRecord,
} = require('./product-contracts');

const DEFAULT_SEARCH_LIMIT = 1000;
const MAX_SEARCH_LIMIT = 5000;
const PRODUCT_ID_PREFIX = 'SETSMART:';
const PRODUCT_SORT_FIELDS = Object.freeze([
  'symbol',
  'securityType',
  'close',
  'marketCap',
  'totalValue',
  'totalVolume',
]);
const MARKET_FIELDS = Object.freeze([
  'prior', 'open', 'high', 'low', 'close', 'average',
  'aomVolume', 'aomValue', 'trVolume', 'trValue',
  'totalVolume', 'totalValue', 'pe', 'pbv', 'bvps',
  'dividendYield', 'marketCap', 'volumeTurnover', 'nav',
]);

function productError(code, statusCode = 400, details = {}) {
  return Object.assign(new Error(code), { code, statusCode, ...details });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function normalizeSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9._&-]{1,20}$/.test(symbol)) throw productError('PRODUCT_SYMBOL_INVALID');
  return symbol;
}

function productIdForSymbol(symbol) {
  return `${PRODUCT_ID_PREFIX}${normalizeSymbol(symbol)}`;
}

function symbolFromProductId(productId) {
  const value = String(productId || '').trim();
  if (!value.toUpperCase().startsWith(PRODUCT_ID_PREFIX)) {
    throw productError('PRODUCT_PROVIDER_NOT_SUPPORTED');
  }
  return normalizeSymbol(value.slice(PRODUCT_ID_PREFIX.length));
}

function normalizeSecurityType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  const canonical = normalized === 'ALL' ? 'All' : normalized;
  if (!SECURITY_TYPES.has(canonical)) throw productError('PRODUCT_SECURITY_TYPE_INVALID');
  return canonical;
}

function requestedSecurityTypes(query) {
  const supplied = query.securityTypes ?? query.securityType;
  if (supplied == null || supplied === '') return null;
  const values = Array.isArray(supplied) ? supplied : [supplied];
  if (values.length === 0) return null;
  const normalized = [...new Set(values.map(normalizeSecurityType))];
  if (normalized.includes('All')) return null;
  return normalized.sort();
}

function strictNonNegativeInteger(value, fallback, code) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw productError(code);
  return parsed;
}

function optionalFinite(value, code) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw productError(code);
  return parsed;
}

function validateOptionalIsoDate(value, code) {
  if (value == null || value === '') return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw productError(code);
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw productError(code);
  return text;
}

function sourceFromObservation(observation) {
  const sourceRef = observation?.source?.sourceRef || SETSMART_LISTED_SPEC_URL;
  return Object.freeze({
    type: 'SETSMART',
    sourceRef,
    asOf: observation.date,
    version: observation?.source?.endpointContract || 'Company Fundamental Data API Specification V1.0',
  });
}

function unsupportedMarketFact(field, source) {
  return unavailableFact('NOT_SUPPORTED', `SETSMART_LISTED_EOD_${field.toUpperCase()}_NOT_SUPPORTED`, source);
}

function missingPolicyFact(field, source) {
  return unavailableFact('MISSING', `BANK_POLICY_${field.toUpperCase()}_REQUIRED`, source);
}

function mapMarketData(observation, source) {
  const marketData = {
    asOf: observation.date,
    adjustedPriceFlag: observation.adjustedPriceFlag,
    priceReturnBasis: observation.priceReturnBasis,
    returnType: observation.returnType,
    totalReturnAvailable: observation.totalReturnAvailable,
    navField: observation.navField,
    navSemantics: observation.navSemantics,
    source,
  };
  for (const field of MARKET_FIELDS) {
    marketData[field] = observation[field] == null ? null : observation[field];
  }
  return marketData;
}

function mapListedProduct(observation) {
  if (!observation || typeof observation !== 'object' || !observation.date) {
    throw productError('SETSMART_PRODUCT_OBSERVATION_INVALID', 502);
  }
  const symbol = normalizeSymbol(observation.symbol);
  const securityType = normalizeSecurityType(observation.securityType);
  if (securityType === 'All') throw productError('SETSMART_PRODUCT_SECURITY_TYPE_INVALID', 502);
  const source = sourceFromObservation(observation);
  return validateProductRecord({
    productId: productIdForSymbol(symbol),
    name: symbol,
    family: 'LISTED_SECURITY',
    symbol,
    securityType,
    source,
    nameSemantics: 'SETSMART_SYMBOL_USED_AS_DISPLAY_NAME',
    marketData: mapMarketData(observation, source),
    facts: {
      issuerOrProvider: unsupportedMarketFact('issuer_or_provider', source),
      currency: unsupportedMarketFact('currency', source),
      risk: unsupportedMarketFact('risk', source),
      tenorOrLiquidity: unsupportedMarketFact('tenor_or_liquidity', source),
      minimumInvestment: unsupportedMarketFact('minimum_investment', source),
      fees: unsupportedMarketFact('fees', source),
      payoffType: unsupportedMarketFact('payoff_type', source),
      capitalProtection: unsupportedMarketFact('capital_protection', source),
      eligibility: missingPolicyFact('eligibility', source),
      requiredAccounts: missingPolicyFact('required_accounts', source),
      approvedShelfStatus: missingPolicyFact('approved_shelf_status', source),
    },
  });
}

function normalizeSearch(query = {}) {
  const limit = strictNonNegativeInteger(query.limit, DEFAULT_SEARCH_LIMIT, 'PRODUCT_SEARCH_LIMIT_INVALID');
  if (limit > MAX_SEARCH_LIMIT) throw productError('PRODUCT_SEARCH_LIMIT_EXCEEDED');
  const offset = strictNonNegativeInteger(query.offset, 0, 'PRODUCT_SEARCH_OFFSET_INVALID');
  const sortBy = String(query.sortBy || 'symbol');
  if (!PRODUCT_SORT_FIELDS.includes(sortBy)) throw productError('PRODUCT_SEARCH_SORT_INVALID');
  const sortDirection = String(query.sortDirection || query.order || 'asc').toLowerCase();
  if (!['asc', 'desc'].includes(sortDirection)) throw productError('PRODUCT_SEARCH_DIRECTION_INVALID');
  const symbols = query.symbols == null
    ? null
    : new Set((Array.isArray(query.symbols) ? query.symbols : [query.symbols]).map(normalizeSymbol));
  const text = String(query.q ?? query.search ?? query.text ?? '').trim().toUpperCase();
  const filters = {
    minClose: optionalFinite(query.minClose, 'PRODUCT_SEARCH_MIN_CLOSE_INVALID'),
    maxClose: optionalFinite(query.maxClose, 'PRODUCT_SEARCH_MAX_CLOSE_INVALID'),
    minMarketCap: optionalFinite(query.minMarketCap, 'PRODUCT_SEARCH_MIN_MARKET_CAP_INVALID'),
    minTotalValue: optionalFinite(query.minTotalValue, 'PRODUCT_SEARCH_MIN_TOTAL_VALUE_INVALID'),
  };
  if (filters.minClose !== null && filters.maxClose !== null && filters.maxClose < filters.minClose) {
    throw productError('PRODUCT_SEARCH_CLOSE_RANGE_INVALID');
  }
  return Object.freeze({
    securityTypes: requestedSecurityTypes(query),
    symbols,
    text,
    limit,
    offset,
    sortBy,
    sortDirection,
    filters,
    asOfDate: query.asOfDate,
    lookbackDays: query.lookbackDays,
    adjustedPriceFlag: query.adjustedPriceFlag || 'Y',
  });
}

function compareProducts(left, right, sortBy, direction) {
  const leftValue = sortBy === 'symbol' || sortBy === 'securityType'
    ? left[sortBy]
    : left.marketData[sortBy];
  const rightValue = sortBy === 'symbol' || sortBy === 'securityType'
    ? right[sortBy]
    : right.marketData[sortBy];
  const leftMissing = leftValue == null;
  const rightMissing = rightValue == null;
  if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
  let compared = 0;
  if (!leftMissing) {
    compared = typeof leftValue === 'string'
      ? leftValue.localeCompare(rightValue, 'en')
      : leftValue - rightValue;
    if (direction === 'desc') compared *= -1;
  }
  return compared || left.symbol.localeCompare(right.symbol, 'en') || left.securityType.localeCompare(right.securityType, 'en');
}

function countsBySecurityType(products) {
  const counts = new Map();
  for (const product of products) counts.set(product.securityType, (counts.get(product.securityType) || 0) + 1);
  return Object.freeze(Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'))));
}

function historyObservation(observation, productId) {
  const source = sourceFromObservation(observation);
  return deepFreeze({
    productId,
    symbol: normalizeSymbol(observation.symbol),
    securityType: normalizeSecurityType(observation.securityType),
    date: observation.date,
    asOf: observation.date,
    adjustedPriceFlag: observation.adjustedPriceFlag,
    prior: observation.prior,
    open: observation.open,
    high: observation.high,
    low: observation.low,
    close: observation.close,
    average: observation.average,
    totalVolume: observation.totalVolume,
    totalValue: observation.totalValue,
    marketCap: observation.marketCap,
    bvps: observation.bvps,
    nav: observation.nav,
    navField: observation.navField,
    navSemantics: observation.navSemantics,
    priceReturnBasis: observation.priceReturnBasis,
    returnType: observation.returnType,
    totalReturnAvailable: observation.totalReturnAvailable,
    source,
  });
}

class SetSmartListedProductDataProvider {
  constructor(options = {}) {
    this.listedProvider = options.listedProvider || createSetSmartListedProvider(options.setSmartOptions || options);
    this.asOfDate = options.asOfDate;
    this.lookbackDays = options.lookbackDays || 7;
    for (const method of ['getLatestBySecurityType', 'getBySymbol']) {
      if (typeof this.listedProvider[method] !== 'function') throw productError('SETSMART_LISTED_PROVIDER_INVALID', 500);
    }
  }

  providerStatus() {
    return typeof this.listedProvider.providerStatus === 'function'
      ? this.listedProvider.providerStatus()
      : Object.freeze({ mode: 'INJECTED', state: 'UNKNOWN' });
  }

  async searchProducts(query = {}) {
    const normalized = normalizeSearch(query);
    const upstreamType = normalized.securityTypes?.length === 1 ? normalized.securityTypes[0] : 'All';
    const result = await this.listedProvider.getLatestBySecurityType({
      securityType: upstreamType,
      adjustedPriceFlag: normalized.adjustedPriceFlag,
      asOfDate: normalized.asOfDate || this.asOfDate,
      lookbackDays: normalized.lookbackDays || this.lookbackDays,
    });
    const products = result.observations.map(mapListedProduct);
    const seen = new Set();
    for (const product of products) {
      if (seen.has(product.productId)) throw productError('SETSMART_DUPLICATE_PRODUCT_ID', 502);
      seen.add(product.productId);
    }
    const filtered = products.filter((product) => {
      if (normalized.securityTypes && !normalized.securityTypes.includes(product.securityType)) return false;
      if (normalized.symbols && !normalized.symbols.has(product.symbol)) return false;
      if (normalized.text && !product.symbol.includes(normalized.text)) return false;
      const market = product.marketData;
      if (normalized.filters.minClose !== null && (market.close == null || market.close < normalized.filters.minClose)) return false;
      if (normalized.filters.maxClose !== null && (market.close == null || market.close > normalized.filters.maxClose)) return false;
      if (normalized.filters.minMarketCap !== null && (market.marketCap == null || market.marketCap < normalized.filters.minMarketCap)) return false;
      if (normalized.filters.minTotalValue !== null && (market.totalValue == null || market.totalValue < normalized.filters.minTotalValue)) return false;
      return true;
    });
    filtered.sort((left, right) => compareProducts(left, right, normalized.sortBy, normalized.sortDirection));
    const page = filtered.slice(normalized.offset, normalized.offset + normalized.limit);
    const sourceRef = result.source?.sourceRef
      || result.observations[0]?.source?.sourceRef
      || SETSMART_LISTED_SPEC_URL;
    return deepFreeze({
      provider: 'SETSMART',
      products: page,
      total: filtered.length,
      returned: page.length,
      offset: normalized.offset,
      limit: normalized.limit,
      countsBySecurityType: countsBySecurityType(filtered),
      requestedAsOf: result.requestedAsOf || normalized.asOfDate || this.asOfDate || null,
      marketAsOf: result.marketAsOf || null,
      adjustedPriceFlag: result.adjustedPriceFlag || normalized.adjustedPriceFlag,
      returnType: result.source?.returnType || 'PRICE_RETURN',
      totalReturnAvailable: result.source?.totalReturnAvailable === true,
      cache: result.cache || null,
      source: {
        type: 'SETSMART',
        sourceRef,
        asOf: result.marketAsOf || result.requestedAsOf || normalized.asOfDate || this.asOfDate || null,
        specification: result.source?.specification || SETSMART_LISTED_SPEC_URL,
      },
    });
  }

  async getProduct(productId) {
    const symbol = symbolFromProductId(productId);
    const result = await this.searchProducts({
      symbols: [symbol],
      asOfDate: this.asOfDate,
      lookbackDays: this.lookbackDays,
      limit: 2,
    });
    if (result.total === 0) throw productError('PRODUCT_NOT_FOUND', 404);
    if (result.total > 1) throw productError('PRODUCT_ID_AMBIGUOUS', 502);
    return result.products[0];
  }

  async getHistory(productId, startDate, endDate) {
    const symbol = symbolFromProductId(productId);
    const canonicalProductId = productIdForSymbol(symbol);
    const result = await this.listedProvider.getBySymbol({
      symbol,
      startDate,
      endDate,
      adjustedPriceFlag: 'Y',
    });
    const observations = result.observations
      .filter((row) => row.date >= startDate && (!endDate || row.date <= endDate))
      .map((row) => {
        if (normalizeSymbol(row.symbol) !== symbol) throw productError('SETSMART_HISTORY_SYMBOL_MISMATCH', 502);
        return historyObservation(row, canonicalProductId);
      })
      .sort((left, right) => left.date.localeCompare(right.date, 'en'));
    const dates = new Set();
    for (const observation of observations) {
      if (dates.has(observation.date)) throw productError('SETSMART_DUPLICATE_HISTORY_DATE', 502);
      dates.add(observation.date);
    }
    return Object.freeze(observations);
  }

  async getCorporateActions(productId, startDate, endDate) {
    symbolFromProductId(productId);
    const start = validateOptionalIsoDate(startDate, 'PRODUCT_CORPORATE_ACTION_START_DATE_INVALID');
    const end = validateOptionalIsoDate(endDate, 'PRODUCT_CORPORATE_ACTION_END_DATE_INVALID');
    if (start && end && end < start) throw productError('PRODUCT_CORPORATE_ACTION_DATE_RANGE_INVALID');
    const asOf = end || start || validateOptionalIsoDate(this.asOfDate, 'PRODUCT_CORPORATE_ACTION_AS_OF_INVALID');
    if (!asOf) throw productError('PRODUCT_CORPORATE_ACTION_AS_OF_REQUIRED');
    return deepFreeze({
      availability: 'NOT_SUPPORTED',
      value: null,
      reasonCode: 'SETSMART_LISTED_EOD_CORPORATE_ACTIONS_NOT_SUPPORTED',
      source: {
        type: 'SETSMART',
        sourceRef: SETSMART_LISTED_SPEC_URL,
        asOf,
      },
    });
  }
}

class ProductDataProviderRegistry {
  constructor(options = {}) {
    const setSmart = options.setSmartProductProvider
      || new SetSmartListedProductDataProvider(options);
    this.providers = new Map([['SETSMART', setSmart]]);
  }

  providerForSource(source = 'SETSMART') {
    const normalized = String(source || '').trim().toUpperCase();
    const provider = this.providers.get(normalized);
    if (!provider) throw productError('PRODUCT_SOURCE_PROVIDER_NOT_REGISTERED');
    return provider;
  }

  providerForProductId(productId) {
    const prefix = String(productId || '').split(':', 1)[0].toUpperCase();
    return this.providerForSource(prefix);
  }

  async searchProducts(query = {}) {
    return this.providerForSource(query.source || 'SETSMART').searchProducts(query);
  }

  async getProduct(productId) {
    return this.providerForProductId(productId).getProduct(productId);
  }

  async getHistory(productId, startDate, endDate) {
    return this.providerForProductId(productId).getHistory(productId, startDate, endDate);
  }

  async getCorporateActions(productId, startDate, endDate) {
    return this.providerForProductId(productId).getCorporateActions(productId, startDate, endDate);
  }

  providerStatus(source = 'SETSMART') {
    const provider = this.providerForSource(source);
    return typeof provider.providerStatus === 'function' ? provider.providerStatus() : null;
  }
}

function createProductDataProviderRegistry(options = {}) {
  return new ProductDataProviderRegistry(options);
}

module.exports = {
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  PRODUCT_SORT_FIELDS,
  ProductDataProviderRegistry,
  SetSmartListedProductDataProvider,
  createProductDataProviderRegistry,
  mapListedProduct,
  productIdForSymbol,
  symbolFromProductId,
};
