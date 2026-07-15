'use strict';

const SETSMART_LISTED_BASE_URL = 'https://www.setsmart.com/api/listed-company-api';
const SETSMART_LISTED_SPEC_URL = 'https://media.set.or.th/set/Documents/2022/Oct/05_1_Company_Fundamental_Specification.pdf';
const OFFICIAL_EOD_FIELDS = Object.freeze([
  'date', 'symbol', 'securityType', 'adjustedPriceFlag', 'prior', 'open', 'high', 'low', 'close', 'average',
  'aomVolume', 'aomValue', 'trVolume', 'trValue', 'totalVolume', 'totalValue', 'pe', 'pbv', 'bvps',
  'dividendYield', 'marketCap', 'volumeTurnover',
]);
const SECURITY_TYPES = new Set(['All', 'CS', 'CSF', 'PS', 'PSF', 'W', 'TSR', 'DWC', 'DWP', 'DR', 'ETF', 'UT']);

function providerError(code, statusCode = 503, details = {}) {
  return Object.assign(new Error(code), { code, statusCode, ...details });
}

function parseFinite(value, fallback, { minimum = 0, integer = true } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) return fallback;
  return integer ? Math.floor(parsed) : parsed;
}

function validateIsoDate(value, code = 'SETSMART_LISTED_DATE_INVALID') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) throw providerError(code, 400);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw providerError(code, 400);
  return value;
}

function shiftIsoDate(value, days) {
  const date = new Date(`${validateIsoDate(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function bangkokDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw providerError('SETSMART_LISTED_RESPONSE_SCHEMA_INVALID', 502);
  return number;
}

function validateSecurityType(value) {
  const normalized = String(value || '').toUpperCase();
  if (!SECURITY_TYPES.has(normalized === 'ALL' ? 'All' : normalized)) {
    throw providerError('SETSMART_LISTED_SECURITY_TYPE_INVALID', 400);
  }
  return normalized === 'ALL' ? 'All' : normalized;
}

function validateAdjustedFlag(value = 'Y') {
  const normalized = String(value || '').toUpperCase();
  if (!['Y', 'N'].includes(normalized)) throw providerError('SETSMART_LISTED_ADJUSTED_FLAG_INVALID', 400);
  return normalized;
}

function normalizeEodRow(row, sourceRef) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw providerError('SETSMART_LISTED_RESPONSE_SCHEMA_INVALID', 502);
  }
  const date = validateIsoDate(row.date, 'SETSMART_LISTED_RESPONSE_DATE_INVALID');
  const symbol = String(row.symbol || '').trim();
  if (!symbol) throw providerError('SETSMART_LISTED_RESPONSE_SYMBOL_INVALID', 502);
  const securityType = validateSecurityType(row.securityType);
  const adjustedPriceFlag = validateAdjustedFlag(row.adjustedPriceFlag);
  const official = {};
  for (const field of OFFICIAL_EOD_FIELDS) {
    if (['date', 'symbol', 'securityType', 'adjustedPriceFlag'].includes(field)) continue;
    official[field] = optionalNumber(row[field]);
  }
  const bvpsIsNav = ['UT', 'ETF'].includes(securityType) && official.bvps !== null;
  return Object.freeze({
    date,
    symbol,
    securityType,
    adjustedPriceFlag,
    ...official,
    priceReturnBasis: 'CLOSE_PRICE',
    returnType: 'PRICE_RETURN',
    totalReturnAvailable: false,
    nav: bvpsIsNav ? official.bvps : null,
    navField: bvpsIsNav ? 'bvps' : null,
    navSemantics: bvpsIsNav ? 'SETSMART_BVPS_DEFINED_AS_NAV_FOR_LISTED_UT_OR_ETF' : 'NOT_SUPPORTED',
    source: Object.freeze({
      provider: 'SETSMART',
      sourceRef,
      specification: SETSMART_LISTED_SPEC_URL,
      endpointContract: 'Company Fundamental Data API Specification V1.0',
    }),
    limitations: Object.freeze([
      'ราคาปิดเป็นราคาซื้อขายของหลักทรัพย์จดทะเบียน ไม่ใช่ NAV ของกองทุนเปิดทั่วไป',
      'bvps ใช้เป็น NAV เฉพาะประเภทที่เอกสารทางการระบุ และไม่ใช่ total return',
      'ข้อมูล SETSMART ไม่ยืนยัน approved shelf, suitability หรือ eligibility ของธนาคาร',
    ]),
  });
}

function retryable(error) {
  return error && ['SETSMART_LISTED_RATE_LIMITED', 'SETSMART_LISTED_UNAVAILABLE', 'SETSMART_LISTED_TIMEOUT'].includes(error.code);
}

class SetSmartListedEodProvider {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.now = options.now || (() => Date.now());
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.mode = String(options.mode || this.env.SETSMART_LISTED_DATA_MODE || 'fixture').toLowerCase();
    this.timeoutMs = parseFinite(options.timeoutMs ?? this.env.SETSMART_TIMEOUT_MS, 8000, { minimum: 1 });
    this.maxRetries = parseFinite(options.maxRetries ?? this.env.SETSMART_MAX_RETRIES, 2, { minimum: 0 });
    this.retryBaseMs = parseFinite(options.retryBaseMs ?? this.env.SETSMART_RETRY_BASE_MS, 250, { minimum: 0 });
    this.cacheTtlMs = parseFinite(options.cacheTtlMs ?? this.env.SETSMART_CACHE_TTL_MS, 900000, { minimum: 0 });
    this.staleFallbackMs = parseFinite(options.staleFallbackMs ?? this.env.SETSMART_STALE_FALLBACK_MS, 86400000, { minimum: 0 });
    this.cache = new Map();
    this.lastSuccessAt = null;
    this.lastErrorCode = null;
  }

  providerStatus() {
    return Object.freeze({
      mode: this.mode,
      state: this.mode === 'live'
        ? (this.lastErrorCode ? 'LIVE_DEGRADED' : this.lastSuccessAt ? 'LIVE_READY' : 'LIVE_NOT_YET_CALLED')
        : 'LIVE_DISABLED',
      lastSuccessAt: this.lastSuccessAt,
      lastErrorCode: this.lastErrorCode,
      cacheEntries: this.cache.size,
      credentialStatus: this.env.SETSMART_API_KEY ? 'CONFIGURED_SERVER_SIDE' : 'NOT_CONFIGURED',
      specification: SETSMART_LISTED_SPEC_URL,
    });
  }

  async request(pathname, params) {
    if (this.mode !== 'live') throw providerError('SETSMART_LISTED_LIVE_MODE_DISABLED', 503);
    if (typeof this.fetchImpl !== 'function') throw providerError('SETSMART_LISTED_TRANSPORT_UNAVAILABLE', 503);
    const apiKey = this.env.SETSMART_API_KEY;
    if (!apiKey) throw providerError('SETSMART_API_KEY_NOT_CONFIGURED', 503);
    const url = new URL(`${SETSMART_LISTED_BASE_URL}/${pathname}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const publicUrl = url.toString();
    const cacheKey = publicUrl;
    const cached = this.cache.get(cacheKey);
    const now = this.now();
    if (cached && now - cached.fetchedAt <= this.cacheTtlMs) {
      return { rows: cached.rows, cache: { state: 'FRESH_CACHE', ageMs: now - cached.fetchedAt }, sourceRef: publicUrl };
    }
    let finalError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          method: 'GET',
          headers: { 'api-key': apiKey, accept: 'application/json' },
          signal: controller.signal,
        });
        if (response.status === 429) {
          const retryAfterSeconds = Number(response.headers && response.headers.get && response.headers.get('retry-after'));
          throw providerError('SETSMART_LISTED_RATE_LIMITED', 503, {
            retryAfterMs: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : null,
          });
        }
        if (response.status >= 500) throw providerError('SETSMART_LISTED_UNAVAILABLE', 503);
        if (!response.ok) throw providerError(`SETSMART_LISTED_HTTP_${response.status}`, response.status);
        const payload = await response.json();
        if (!Array.isArray(payload)) throw providerError('SETSMART_LISTED_RESPONSE_SCHEMA_INVALID', 502);
        const rows = Object.freeze(payload.map((row) => normalizeEodRow(row, publicUrl)));
        const fetchedAt = this.now();
        this.cache.set(cacheKey, { rows, fetchedAt });
        this.lastSuccessAt = new Date(fetchedAt).toISOString();
        this.lastErrorCode = null;
        return { rows, cache: { state: 'LIVE', ageMs: 0 }, sourceRef: publicUrl };
      } catch (error) {
        finalError = error && error.name === 'AbortError'
          ? providerError('SETSMART_LISTED_TIMEOUT', 504)
          : error && error.code
            ? error
            : providerError('SETSMART_LISTED_UNAVAILABLE', 503);
        if (!retryable(finalError) || attempt >= this.maxRetries) break;
        await this.sleep(finalError.retryAfterMs ?? this.retryBaseMs * (2 ** attempt));
      } finally {
        clearTimeout(timer);
      }
    }
    this.lastErrorCode = finalError.code || 'SETSMART_LISTED_UNAVAILABLE';
    if (cached && now - cached.fetchedAt <= this.staleFallbackMs) {
      return {
        rows: cached.rows,
        cache: { state: 'STALE_FALLBACK', ageMs: now - cached.fetchedAt, errorCode: this.lastErrorCode },
        sourceRef: publicUrl,
      };
    }
    throw finalError;
  }

  async getBySecurityType({ securityType, date, adjustedPriceFlag = 'Y' }) {
    const validatedType = validateSecurityType(securityType);
    const validatedDate = validateIsoDate(date);
    const flag = validateAdjustedFlag(adjustedPriceFlag);
    const result = await this.request('eod-price-by-security-type', {
      securityType: validatedType, date: validatedDate, adjustedPriceFlag: flag,
    });
    return Object.freeze({
      provider: 'SETSMART',
      mode: 'live',
      securityType: validatedType,
      requestedAsOf: validatedDate,
      marketAsOf: result.rows[0]?.date || validatedDate,
      adjustedPriceFlag: flag,
      observationCount: result.rows.length,
      observations: result.rows,
      cache: Object.freeze(result.cache),
      source: Object.freeze({
        sourceRef: result.sourceRef,
        specification: SETSMART_LISTED_SPEC_URL,
        returnType: 'PRICE_RETURN',
        totalReturnAvailable: false,
      }),
    });
  }

  async getLatestBySecurityType({ securityType, adjustedPriceFlag = 'Y', asOfDate, lookbackDays = 7 } = {}) {
    const upperBound = asOfDate ? validateIsoDate(asOfDate) : shiftIsoDate(bangkokDate(new Date(this.now())), -1);
    const boundedLookback = parseFinite(lookbackDays, 7, { minimum: 1 });
    for (let offset = 0; offset < boundedLookback; offset += 1) {
      const date = shiftIsoDate(upperBound, -offset);
      const result = await this.getBySecurityType({ securityType, date, adjustedPriceFlag });
      if (result.observationCount > 0) return Object.freeze({ ...result, requestedAsOf: upperBound, searchedBackDays: offset });
    }
    return Object.freeze({
      provider: 'SETSMART', mode: 'live', securityType: validateSecurityType(securityType), requestedAsOf: upperBound,
      marketAsOf: null, adjustedPriceFlag: validateAdjustedFlag(adjustedPriceFlag), observationCount: 0,
      observations: Object.freeze([]), searchedBackDays: boundedLookback - 1,
      cache: Object.freeze({ state: 'LIVE', ageMs: 0 }),
      source: Object.freeze({ specification: SETSMART_LISTED_SPEC_URL, returnType: 'PRICE_RETURN', totalReturnAvailable: false }),
    });
  }

  async getBySymbol({ symbol, startDate, endDate, adjustedPriceFlag = 'Y' }) {
    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    if (!/^[A-Z0-9._-]{1,20}$/.test(normalizedSymbol)) throw providerError('SETSMART_LISTED_SYMBOL_INVALID', 400);
    const start = validateIsoDate(startDate, 'SETSMART_LISTED_START_DATE_INVALID');
    const end = endDate ? validateIsoDate(endDate, 'SETSMART_LISTED_END_DATE_INVALID') : undefined;
    if (end && end < start) throw providerError('SETSMART_LISTED_DATE_RANGE_INVALID', 400);
    const flag = validateAdjustedFlag(adjustedPriceFlag);
    const result = await this.request('eod-price-by-symbol', {
      symbol: normalizedSymbol, startDate: start, endDate: end, adjustedPriceFlag: flag,
    });
    return Object.freeze({
      provider: 'SETSMART', mode: 'live', symbol: normalizedSymbol, startDate: start, endDate: end || null,
      adjustedPriceFlag: flag, observationCount: result.rows.length, observations: result.rows,
      marketAsOf: result.rows.at(-1)?.date || null, cache: Object.freeze(result.cache),
      source: Object.freeze({ sourceRef: result.sourceRef, specification: SETSMART_LISTED_SPEC_URL, returnType: 'PRICE_RETURN', totalReturnAvailable: false }),
    });
  }
}

function createSetSmartListedProvider(options = {}) {
  return new SetSmartListedEodProvider(options);
}

module.exports = {
  OFFICIAL_EOD_FIELDS,
  SECURITY_TYPES,
  SETSMART_LISTED_BASE_URL,
  SETSMART_LISTED_SPEC_URL,
  SetSmartListedEodProvider,
  createSetSmartListedProvider,
  normalizeEodRow,
  shiftIsoDate,
};
