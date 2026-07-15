'use strict';

// Legacy market-context compatibility layer.
//
// The repository does not contain an authorised SETSMART market-data contract,
// so this module deliberately contains no vendor URL, header name, endpoint,
// or live response schema. The v3 mutual-fund integration lives in
// lib/v3/mutual-funds.js and likewise fails closed until a documented contract
// and server-side transport are injected.

const SETSMART_ENDPOINT = null;
const MARKET_PROXIES = Object.freeze([
  Object.freeze({ symbol: 'SYN-TH-EQ', label: 'หุ้นไทยจำลอง', proxyFor: 'thaiEquityCore', synthetic: true }),
  Object.freeze({ symbol: 'SYN-TH-DIV', label: 'หุ้นไทยปันผลจำลอง', proxyFor: 'thaiEquityDividend', synthetic: true }),
  Object.freeze({ symbol: 'SYN-TH-BOND', label: 'พันธบัตรไทยจำลอง', proxyFor: 'thaiGovBond', synthetic: true }),
]);

function staleAfterDays() {
  const value = Number(process.env.SETSMART_STALE_AFTER_DAYS || 10);
  return Number.isFinite(value) ? Math.max(3, value) : 10;
}

function ageInCalendarDays(dateText, now = new Date()) {
  const then = new Date(`${dateText}T00:00:00+07:00`);
  if (Number.isNaN(then.getTime())) return Infinity;
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86400000));
}

function sanitizedErrorCode(error) {
  const message = String(error && error.message || error || 'SETSMART_UNAVAILABLE');
  if (message === 'SETSMART_API_KEY_NOT_CONFIGURED') return message;
  if (message === 'SETSMART_DOCUMENTED_CONTRACT_REQUIRED') return message;
  if (message === 'SETSMART_INSUFFICIENT_HISTORY') return message;
  if (/^SETSMART_HTTP_\d{3}$/.test(message)) return message;
  if (error && error.name === 'AbortError') return 'SETSMART_TIMEOUT';
  return 'SETSMART_UNAVAILABLE';
}

// The two helpers below normalize only synthetic legacy fixture rows used by
// regression tests. They are not a claim about any external vendor payload.
function supportsBvpsAsNav(securityType) {
  const value = String(securityType || '').trim().toUpperCase();
  return /ETF|PROPERTY FUND|PFUND|REIT|INFRASTRUCTURE FUND|IFF|UNIT TRUST/.test(value);
}

function normalizeRows(payload, expectedSymbol) {
  const raw = Array.isArray(payload) ? payload : [];
  const byDate = new Map();
  for (const row of raw) {
    const date = String(row.date || '').slice(0, 10);
    const symbol = String(row.symbol || expectedSymbol).toUpperCase();
    const close = Number(row.close);
    const securityType = row.securityType || null;
    const nav = supportsBvpsAsNav(securityType) && row.bvps != null ? Number(row.bvps) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || symbol !== expectedSymbol || !Number.isFinite(close) || close <= 0) continue;
    byDate.set(date, {
      date,
      close,
      nav: Number.isFinite(nav) && nav > 0 ? nav : null,
      securityType,
      adjusted: String(row.adjustedPriceFlag || 'Y').toUpperCase() === 'Y',
      synthetic: true,
    });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

async function fetchSetSmartSeries() {
  const error = new Error('SETSMART_DOCUMENTED_CONTRACT_REQUIRED');
  error.code = 'SETSMART_DOCUMENTED_CONTRACT_REQUIRED';
  throw error;
}

function monitoringSignal(summary) {
  const oneDay = Math.abs(summary.oneDayMove || 0);
  const fiveDay = Math.abs(summary.fiveDayMove || 0);
  if (oneDay >= 0.03 || fiveDay >= 0.07) return {
    level: 'review',
    label: 'ควรตรวจลูกค้าที่มีสัดส่วนสูง',
    talkingPoint: 'ข้อมูลจำลองขยับเกินกรอบเฝ้าดู จึงใช้เป็น trigger ให้ตรวจเป้าหมาย ไม่ใช่คำสั่งซื้อขาย',
  };
  if (oneDay >= 0.015 || fiveDay >= 0.04) return {
    level: 'watch',
    label: 'เฝ้าดูใกล้ชิด',
    talkingPoint: 'ใช้เพื่อเตรียมอธิบายความเสี่ยง ไม่ใช่สัญญาณซื้อขาย',
  };
  return {
    level: 'normal',
    label: 'ติดตามตามปกติ',
    talkingPoint: 'ยังไม่พบ trigger จำลองที่ต้องยกระดับการติดต่อ',
  };
}

function alignSeriesByDate(seriesList) {
  if (!seriesList.length) return { dates: [], series: {} };
  let common = new Set(seriesList[0].rows.map((row) => row.date));
  for (const item of seriesList.slice(1)) {
    const dates = new Set(item.rows.map((row) => row.date));
    common = new Set([...common].filter((date) => dates.has(date)));
  }
  const dates = [...common].sort();
  const series = {};
  for (const item of seriesList) {
    const map = new Map(item.rows.map((row) => [row.date, row.close]));
    series[item.symbol] = dates.map((date) => map.get(date));
  }
  return { dates, series };
}

async function getThaiMarketContext() {
  const checkedAt = new Date().toISOString();
  return {
    mode: 'fixture',
    coverage: 0,
    total: MARKET_PROXIES.length,
    checkedAt,
    requestId: `market-fixture-${checkedAt.slice(0, 10)}`,
    dataAsOf: null,
    fallbackActive: true,
    freshness: { status: 'synthetic-only', staleAfterDays: staleAfterDays() },
    label: 'บริบทตลาดจำลอง',
    explanation: 'ยังไม่มีสัญญา SETSMART ที่อนุมัติ ระบบจึงไม่เรียกเครือข่ายและไม่สมมติ endpoint หรือ schema',
    proxies: MARKET_PROXIES.map((item) => ({ ...item, status: 'synthetic-only' })),
  };
}

module.exports = {
  SETSMART_ENDPOINT,
  MARKET_PROXIES,
  supportsBvpsAsNav,
  normalizeRows,
  fetchSetSmartSeries,
  alignSeriesByDate,
  ageInCalendarDays,
  sanitizedErrorCode,
  monitoringSignal,
  getThaiMarketContext,
};
