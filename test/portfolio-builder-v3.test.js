'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzePortfolioBuilder,
  buildClientHoldingBook,
  buildClientListedPortfolio,
  createPortfolioDraftStore,
  validateDraftHoldings,
} = require('../lib/v3/portfolio-builder');

function marketRow(symbol, securityType, close, totalValue) {
  return {
    date: '2026-07-15', symbol, securityType, close, totalValue,
    returnType: 'PRICE_RETURN', totalReturnAvailable: false,
    source: { provider: 'SETSMART', sourceRef: `setsmart://eod/${symbol}` },
  };
}

function universe() {
  return {
    marketAsOf: '2026-07-15', observationCount: 8,
    observations: [
      marketRow('TDEX', 'ETF', 10, 5_000_000),
      marketRow('1DIV', 'ETF', 14, 4_000_000),
      marketRow('AAA', 'CS', 20, 9_000_000),
      marketRow('BBB', 'CS', 15, 8_000_000),
      marketRow('CCC', 'CS', 8, 7_000_000),
      marketRow('DDD', 'CS', 6, 6_000_000),
      marketRow('AAPL80', 'DR', 11, 5_000_000),
      marketRow('SCBSET', 'UT', 9, 1_000_000),
    ],
  };
}

function client(index, holdingCount = 3) {
  return {
    clientId: `CLIENT-${String(index).padStart(3, '0')}`,
    clientRef: `FIN-${index}`,
    name: `ลูกค้า ${index}`,
    owner: `RM ${index % 5}`,
    primaryGoal: 'เกษียณ',
    holdings: Array.from({ length: holdingCount }, (_, holdingIndex) => ({ value: 1_000_000 + holdingIndex * 100_000 })),
  };
}

function datedHistory(symbol, phase) {
  let close = 10 + phase;
  const rows = [];
  for (let index = 0; index < 80; index += 1) {
    const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
    const dailyReturn = 0.0003 + Math.sin(index * (0.13 + phase * 0.03) + phase) * 0.006 + (index % (7 + phase)) * 0.00007;
    close *= 1 + dailyReturn;
    rows.push({
      productId: `SETSMART:${symbol}`, symbol, date, close,
      returnType: 'PRICE_RETURN', totalReturnAvailable: false,
      source: { type: 'SETSMART', sourceRef: `setsmart://history/${symbol}` },
    });
  }
  return rows;
}

test('holding book exposes many clients and maps every demo position to a real SETSMART row', () => {
  const clients = Array.from({ length: 30 }, (_, index) => client(index + 1, 3));
  const book = buildClientHoldingBook(clients, universe());
  assert.equal(book.clientCount, 30);
  assert.equal(book.totalPositions, 90);
  assert.ok(book.uniqueSymbols.length >= 3);
  for (const portfolio of book.portfolios) {
    assert.equal(portfolio.holdings.length, 3);
    assert.ok(portfolio.holdings.every((holding) => holding.productId.startsWith('SETSMART:')));
    assert.ok(portfolio.holdings.every((holding) => holding.marketSource === 'SETSMART'));
    assert.ok(portfolio.holdings.every((holding) => holding.clientHoldingSource === 'DEMO_CLIENT_HOLDINGS'));
  }
});

test('same client receives a deterministic live-asset portfolio with weights and quantities', () => {
  const first = buildClientListedPortfolio(client(7, 4), universe());
  const second = buildClientListedPortfolio(client(7, 4), universe());
  assert.deepEqual(first, second);
  assert.equal(first.holdingCount, 4);
  assert.ok(Math.abs(first.holdings.reduce((sum, holding) => sum + holding.currentWeight, 0) - 1) < 1e-12);
  assert.ok(first.holdings.every((holding) => holding.quantity > 0));
  assert.equal(first.clientDataMode, 'DEMO_CLIENT_DATA');
});

test('RM draft validates residual cash and blocks duplicate, negative, and over-100% weights', () => {
  const valid = validateDraftHoldings([
    { productId: 'SETSMART:TDEX', weight: 0.4 },
    { productId: 'SETSMART:AAA', weight: 0.35 },
  ]);
  assert.equal(valid.totalWeight, 0.75);
  assert.equal(valid.residualCashWeight, 0.25);
  assert.throws(() => validateDraftHoldings([
    { productId: 'SETSMART:TDEX', weight: 0.6 },
    { productId: 'SETSMART:AAA', weight: 0.5 },
  ]), { code: 'BUILDER_WEIGHT_TOTAL_EXCEEDED' });
  assert.throws(() => validateDraftHoldings([
    { productId: 'SETSMART:TDEX', weight: 0.5 },
    { productId: 'SETSMART:TDEX', weight: 0.5 },
  ]), { code: 'BUILDER_DUPLICATE_PRODUCT_ID' });
});

test('analysis compares Current, RM Draft, model diagnostic, and no-action on the same real dates', async () => {
  const selectedClient = client(4, 3);
  const current = buildClientListedPortfolio(selectedClient, universe());
  const histories = new Map(current.holdings.map((holding, index) => [holding.productId, datedHistory(holding.symbol, index + 1)]));
  const productRegistry = {
    async getHistory(productId) { return histories.get(productId); },
  };
  const result = await analyzePortfolioBuilder({
    clientId: selectedClient.clientId,
    holdings: current.holdings.map((holding) => ({ productId: holding.productId, weight: holding.currentWeight })),
    startDate: '2026-01-01',
    endDate: '2026-03-21',
    method: 'MAX_RETURN_TARGET_VOL',
    targetVolatility: 0.12,
  }, { client: selectedClient, universeResult: universe(), productRegistry });
  assert.deepEqual(result.comparisons.map((item) => item.id), ['CURRENT', 'DRAFT', 'MODEL', 'NO_ACTION']);
  assert.ok(result.period.observationCount >= 20);
  assert.ok(result.comparisons.every((item) => item.metrics.observationCount === result.period.observationCount));
  for (const comparison of result.comparisons) {
    assert.equal(comparison.metrics.startingValue, current.portfolioValue);
    assert.equal(
      comparison.metrics.endingValue,
      comparison.metrics.startingValue + comparison.metrics.periodPnl,
    );
    assert.equal(comparison.metrics.pnlMethod, 'STARTING_VALUE_X_PRICE_RETURN_NO_FLOWS');
  }
  assert.equal(result.covariance.forwardFilled, false);
  assert.equal(result.source.market, 'SETSMART');
  assert.equal(result.source.returnType, 'PRICE_RETURN');
  assert.equal(result.model.diagnosticOnly, true);
  assert.equal(result.model.approvedModel, false);
  assert.equal(result.model.constraints.passed, true);
  assert.ok(result.model.weights.every((item) => item.weight <= 0.35 + 1e-9));
  assert.ok(Math.abs(result.model.weights.reduce((sum, item) => sum + item.weight, 0) - 1) < 1e-9);
  assert.ok(result.growth.length === result.period.observationCount);
  assert.deepEqual(Object.keys(result.strategyDetails), ['CURRENT', 'DRAFT', 'MODEL', 'NO_ACTION']);
  assert.equal(result.strategyDetails.CURRENT.metrics.observationCount, result.period.observationCount);
  assert.equal(result.immediateImpact.expectedReturnMethod, 'HISTORICAL_GEOMETRIC_PRICE_RETURN');
  assert.equal(result.immediateImpact.feeStatus, 'MISSING_BANK_PRODUCT_CATALOG');
  assert.equal(result.goalImpact.every((goal) => goal.afterDraft === null), true);
});

test('saved draft reloads with governed metadata and never mutates current portfolio', () => {
  let tick = 0;
  const store = createPortfolioDraftStore({ now: () => `2026-07-16T10:00:0${tick += 1}.000Z` });
  const current = [{ productId: 'SETSMART:TDEX', weight: 0.6 }, { productId: 'SETSMART:AAA', weight: 0.4 }];
  const saved = store.save({
    clientId: 'CLIENT-001', portfolioId: 'PORTFOLIO-CLIENT-001', sourceSnapshotId: 'SNAPSHOT-001',
    createdBy: 'RM TEST', calculationId: 'builder-test', modelVersion: 'portfolio-builder-v1',
    holdings: [{ productId: 'SETSMART:TDEX', weight: 0.5 }, { productId: 'SETSMART:AAA', weight: 0.25 }],
  });
  saved.holdings[0].weight = 0;
  const reloaded = store.list('CLIENT-001')[0];
  assert.equal(reloaded.holdings[0].weight, 0.5);
  assert.equal(reloaded.residualCashWeight, 0.25);
  assert.equal(reloaded.currentPortfolioMutated, false);
  assert.equal(reloaded.autoTrade, false);
  assert.deepEqual(current, [{ productId: 'SETSMART:TDEX', weight: 0.6 }, { productId: 'SETSMART:AAA', weight: 0.4 }]);
  for (const key of ['clientId','portfolioId','draftId','sourceSnapshotId','createdBy','createdAt','updatedAt','calculationId','modelVersion']) assert.ok(key in reloaded);
});
