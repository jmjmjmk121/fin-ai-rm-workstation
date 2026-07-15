'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PRODUCT_SOURCES,
  REQUIRED_PRODUCT_FACTS,
  availableFact,
  unavailableFact,
  validateProductRecord,
} = require('../lib/v3/product-contracts');

function source(type, sourceRef) {
  return { type, sourceRef, asOf: '2026-07-15' };
}

function product() {
  const market = source('FIXTURE', 'fixture://phase-0/product/demo-fund');
  const policy = source('BANK_POLICY', 'policy://approved-shelf/demo-v1');
  return {
    productId: 'fixture-product-001',
    name: 'กองทุนตัวอย่างสำหรับทดสอบ contract',
    family: 'MUTUAL_FUND',
    source: market,
    facts: {
      issuerOrProvider: availableFact('AMC ตัวอย่าง', market),
      currency: availableFact('THB', market),
      risk: availableFact({ level: 4 }, market),
      tenorOrLiquidity: availableFact({ dealing: 'DAILY' }, market),
      minimumInvestment: unavailableFact('NOT_SUPPORTED', 'CONTRACT_FIELD_NOT_SUPPORTED', market),
      fees: unavailableFact('MISSING', 'LATEST_FEE_DOCUMENT_REQUIRED', market),
      payoffType: availableFact('NAV', market),
      capitalProtection: availableFact(false, market),
      eligibility: availableFact({ status: 'ELIGIBLE' }, policy),
      requiredAccounts: availableFact(['INVESTMENT_ACCOUNT'], policy),
      approvedShelfStatus: availableFact({ status: 'APPROVED' }, policy),
    },
  };
}

test('ProductSource is exactly the four governed source classes and contains no credential', () => {
  assert.deepEqual(PRODUCT_SOURCES, ['SETSMART', 'BANK_PRODUCT_CATALOG', 'BANK_POLICY', 'FIXTURE']);
  assert.equal(new Set(PRODUCT_SOURCES).size, 4);
  assert.ok(PRODUCT_SOURCES.every((value) => !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(value)));
});

test('product contract requires every universal fact and preserves field-level source separation', () => {
  const result = validateProductRecord(product());
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.facts), true);
  assert.equal(result.source.type, 'FIXTURE');
  assert.equal(result.facts.currency.source.type, 'FIXTURE');
  assert.equal(result.facts.approvedShelfStatus.source.type, 'BANK_POLICY');
  assert.equal(result.facts.minimumInvestment.availability, 'NOT_SUPPORTED');
  assert.equal(result.facts.minimumInvestment.value, null);
  assert.deepEqual(Object.keys(result.facts).sort(), [...REQUIRED_PRODUCT_FACTS].sort());
});

test('missing and unsupported facts must be explicit and can never carry an invented value', () => {
  const missing = product();
  delete missing.facts.fees;
  assert.throws(() => validateProductRecord(missing), { code: 'PRODUCT_FACT_ENVELOPE_REQUIRED' });

  const unsupportedWithValue = product();
  unsupportedWithValue.facts.fees = {
    availability: 'NOT_SUPPORTED',
    value: 0,
    reasonCode: 'CONTRACT_FIELD_NOT_SUPPORTED',
  };
  assert.throws(() => validateProductRecord(unsupportedWithValue), { code: 'PRODUCT_UNAVAILABLE_FACT_HAS_VALUE' });
});

test('source and as-of are mandatory for product records and every fact', () => {
  const invalid = product();
  invalid.facts.risk = { ...invalid.facts.risk, source: { ...invalid.facts.risk.source, asOf: 'tomorrow' } };
  assert.throws(() => validateProductRecord(invalid), { code: 'PRODUCT_SOURCE_AS_OF_INVALID' });

  const inherits = product();
  inherits.facts.currency = { ...inherits.facts.currency, source: null };
  const result = validateProductRecord(inherits);
  assert.deepEqual(result.facts.currency.source, result.source);
});
