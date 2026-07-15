'use strict';

const PRODUCT_SOURCES = Object.freeze([
  'SETSMART',
  'BANK_PRODUCT_CATALOG',
  'BANK_POLICY',
  'FIXTURE',
]);

const FACT_AVAILABILITY = Object.freeze(['AVAILABLE', 'MISSING', 'NOT_SUPPORTED']);

const REQUIRED_PRODUCT_FACTS = Object.freeze([
  'issuerOrProvider',
  'currency',
  'risk',
  'tenorOrLiquidity',
  'minimumInvestment',
  'fees',
  'payoffType',
  'capitalProtection',
  'eligibility',
  'requiredAccounts',
  'approvedShelfStatus',
]);

function contractError(code, field) {
  const error = new Error(code);
  error.code = code;
  if (field) error.field = field;
  return error;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function unavailableFact(status, reasonCode, source) {
  if (!['MISSING', 'NOT_SUPPORTED'].includes(status)) throw contractError('PRODUCT_FACT_STATUS_INVALID');
  if (typeof reasonCode !== 'string' || reasonCode.trim() === '') throw contractError('PRODUCT_FACT_REASON_REQUIRED');
  return deepFreeze({
    availability: status,
    value: null,
    reasonCode: reasonCode.trim(),
    source: source || null,
  });
}

function availableFact(value, source) {
  if (value == null) throw contractError('PRODUCT_FACT_VALUE_REQUIRED');
  return Object.freeze({ availability: 'AVAILABLE', value: clone(value), source: source || null });
}

function normalizeFact(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError('PRODUCT_FACT_ENVELOPE_REQUIRED', field);
  }
  if (!FACT_AVAILABILITY.includes(value.availability)) throw contractError('PRODUCT_FACT_STATUS_INVALID', field);
  if (value.availability === 'AVAILABLE' && value.value == null) throw contractError('PRODUCT_FACT_VALUE_REQUIRED', field);
  if (value.availability !== 'AVAILABLE') {
    if (value.value != null) throw contractError('PRODUCT_UNAVAILABLE_FACT_HAS_VALUE', field);
    if (typeof value.reasonCode !== 'string' || value.reasonCode.trim() === '') {
      throw contractError('PRODUCT_FACT_REASON_REQUIRED', field);
    }
  }
  return clone(value);
}

function validateSource(source, field = 'source') {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw contractError('PRODUCT_SOURCE_REQUIRED', field);
  if (!PRODUCT_SOURCES.includes(source.type)) throw contractError('PRODUCT_SOURCE_INVALID', field);
  if (typeof source.sourceRef !== 'string' || source.sourceRef.trim() === '') throw contractError('PRODUCT_SOURCE_REF_REQUIRED', field);
  if (!isIsoDate(source.asOf)) throw contractError('PRODUCT_SOURCE_AS_OF_INVALID', field);
  return clone(source);
}

/**
 * Phase-0 canonical product-fact contract. It deliberately contains no vendor
 * endpoint or response-field assumptions. Each governed fact carries its own
 * source so market facts, bank catalogue facts, policy rules, and fixtures
 * cannot be silently blended.
 */
function validateProductRecord(product) {
  if (!product || typeof product !== 'object' || Array.isArray(product)) throw contractError('PRODUCT_RECORD_REQUIRED');
  for (const field of ['productId', 'name', 'family']) {
    if (typeof product[field] !== 'string' || product[field].trim() === '') throw contractError('PRODUCT_IDENTITY_FIELD_REQUIRED', field);
  }
  const source = validateSource(product.source);
  const facts = {};
  if (!product.facts || typeof product.facts !== 'object' || Array.isArray(product.facts)) {
    throw contractError('PRODUCT_FACTS_REQUIRED', 'facts');
  }
  for (const field of REQUIRED_PRODUCT_FACTS) {
    facts[field] = normalizeFact(product.facts[field], `facts.${field}`);
    facts[field].source = facts[field].source
      ? validateSource(facts[field].source, `facts.${field}.source`)
      : clone(source);
  }
  return deepFreeze({
    ...clone(product),
    productId: product.productId.trim(),
    name: product.name.trim(),
    family: product.family.trim(),
    source,
    facts,
  });
}

module.exports = {
  PRODUCT_SOURCES,
  FACT_AVAILABILITY,
  REQUIRED_PRODUCT_FACTS,
  availableFact,
  unavailableFact,
  validateProductRecord,
};
