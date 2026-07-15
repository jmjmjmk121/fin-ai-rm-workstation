'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLIENTS, MODELS, SCENARIOS } = require('../lib/case-data');
const { orderedClients, prepareClientCase, stressClient, rebalanceClient, buildFrontierPayload, modelFor } = require('../lib/workbench');
const { weightedShock, responseLevel } = require('../lib/stress');
const { alignSeriesByDate, normalizeRows, SETSMART_ENDPOINT, supportsBvpsAsNav, fetchSetSmartSeries } = require('../lib/setsmart');

function sumWeights(weights) {
  return Object.values(weights).reduce((sum, value) => sum + value, 0);
}

test('mandatory care is first and business value never jumps the mandatory lane', () => {
  const clients = orderedClients();
  assert.equal(clients[0].id, 'C-3091');
  assert.equal(clients[0].mandatory, true);
  assert.ok(clients.slice(1).every((client) => !client.mandatory));
});

test('2m market drawdown routes to message while 48.5m multi-need case routes to RM call', () => {
  const small = CLIENTS.find((client) => client.id === 'C-2012');
  const large = CLIENTS.find((client) => client.id === 'C-1048');
  assert.equal(small.channel, 'message');
  assert.equal(large.channel, 'call');
  assert.match(small.channelWhy, /ไม่แย่งเวลาสาย/);
  assert.match(large.channelWhy, /หลายเรื่องเชื่อมกัน/);
});

test('stale client data blocks portfolio advice', () => {
  const result = rebalanceClient('C-5078');
  assert.equal(result.blocked, true);
  assert.equal(result.canExecute, false);
  assert.match(result.reason, /ยืนยันข้อมูล/);
});

test('complaint and unconfirmed foreign-currency goal cannot open portfolio advice', () => {
  const complaint = rebalanceClient('C-3091');
  const foreignGoal = rebalanceClient('C-6312');
  assert.equal(complaint.blocked, true);
  assert.equal(complaint.noCrossSell, true);
  assert.equal(foreignGoal.blocked, true);
  assert.match(foreignGoal.reason, /สกุลเงิน/);
});

test('rebalance options are calculated, long-only, budget-feasible, and never executable automatically', () => {
  const result = rebalanceClient('C-4124');
  assert.equal(result.blocked, false);
  assert.equal(result.canExecute, false);
  assert.equal(result.options.length, 3);
  for (const option of result.options) {
    assert.ok(Math.abs(sumWeights(option.weights) - 1) < 1e-10);
    assert.ok(Object.values(option.weights).every((weight) => weight >= 0));
    assert.ok(Number.isFinite(option.metrics.expectedReturn));
    assert.ok(Number.isFinite(option.metrics.volatility));
    if (option.trades.length) assert.equal(option.requiresConfirmation, true);
  }
  const partial = result.options.find((option) => option.id === 'partial');
  assert.ok(partial.trades.some((trade) => trade.direction === 'sell'));
  assert.ok(partial.trades.some((trade) => trade.direction === 'buy'));
});

test('stress losses are recomputed from client weights and scenario shocks', () => {
  const client = CLIENTS.find((item) => item.id === 'C-4124');
  const scenario = SCENARIOS.covid;
  const result = stressClient(client.id, scenario.id);
  const shock = weightedShock(client.portfolio, scenario.shocks);
  assert.ok(Math.abs(result.current.shockReturn - shock) < 1e-12);
  assert.ok(Math.abs(result.current.lossBaht - Math.max(0, -shock * client.aum)) < 1e-6);
  assert.equal(result.current.goal.paths, 5000);
  assert.equal(result.current.goal.currentCapital, client.goal.currentCapital);
  assert.equal(result.current.goal.annualContribution, client.goal.annualContribution);
  assert.ok(result.current.goal.probability >= 0 && result.current.goal.probability <= 1);
  assert.equal(result.response.level, 3);
});

test('scenario candidate is re-stressed and can recommend no-trade when it does not improve both dimensions', () => {
  const improves = stressClient('C-4124', 'covid');
  assert.ok(improves.candidate.lossBaht < improves.current.lossBaht);
  assert.equal(improves.candidate.recommendedForScenario, true);
  const tradeoff = stressClient('C-1048', 'covid');
  assert.equal(tradeoff.candidate.recommendedForScenario, false);
  assert.match(tradeoff.response.trade, /ยังไม่ควรปรับพอร์ต/);
});

test('stale suitability blocks trading but not urgent crisis care', () => {
  const result = responseLevel({ mandatory: false, dataReady: false, profileFresh: false }, 0.25, 0.20, null);
  assert.equal(result.level, 3);
  assert.match(result.trade, /ห้ามจัดพอร์ต/);
});

test('case-study model separates reserve, explicit goal capital, and long-term money', () => {
  const client = CLIENTS.find((item) => item.id === 'C-4124');
  const model = modelFor(client);
  assert.equal(model.buckets.length, 3);
  assert.ok(Math.abs(model.buckets.reduce((sum, bucket) => sum + bucket.amount, 0) - client.aum) < 1e-6);
  assert.ok(Math.abs(sumWeights(model.weights) - 1) < 1e-12);
  assert.match(model.selectionReasons.join(' '), /ไม่ใช้คะแนนนี้เพียงตัวเดียว/);
});

test('AI preparation exposes a tool trail instead of claiming LLM arithmetic', () => {
  const result = prepareClientCase('C-1048');
  assert.equal(result.orchestration.mode, 'tool-orchestrated-demo');
  assert.ok(result.orchestration.steps.some((step) => step.tool === 'Goal & stress engine'));
  assert.ok(result.orchestration.steps.some((step) => step.tool === 'RM approval' && step.status === 'waiting'));
});

test('efficient-frontier payload and case-study model use the same assumptions', () => {
  const data = buildFrontierPayload('C-4124');
  assert.equal(data.constraints[0], 'long-only');
  assert.equal(data.frontier.length, 41);
  assert.equal(data.assumptions.assetKeys.length, 6);
  const model = data.models.find((item) => item.id === MODELS.balanced.id);
  assert.ok(model);
  assert.ok(Math.abs(sumWeights(model.weights) - 1) < 1e-12);
  assert.equal(data.client.caseStudyModel.id, 'case-C-4124');
  assert.ok(Math.abs(sumWeights(data.client.caseStudyModel.weights) - 1) < 1e-12);
  assert.match(data.referenceStatus, /analytical reference/i);
});

test('legacy SETSMART compatibility layer invents no endpoint and aligns fixture dates without zero fill', async () => {
  assert.equal(SETSMART_ENDPOINT, null);
  await assert.rejects(() => fetchSetSmartSeries('SYN-TH-EQ'), /SETSMART_DOCUMENTED_CONTRACT_REQUIRED/);
  const a = { symbol: 'A', rows: [{ date: '2026-01-01', close: 10 }, { date: '2026-01-02', close: 11 }] };
  const b = { symbol: 'B', rows: [{ date: '2026-01-02', close: 20 }, { date: '2026-01-03', close: 21 }] };
  const aligned = alignSeriesByDate([a, b]);
  assert.deepEqual(aligned.dates, ['2026-01-02']);
  assert.deepEqual(aligned.series.A, [11]);
  assert.deepEqual(aligned.series.B, [20]);
});

test('SETSMART normalization rejects wrong symbols and keeps close separate from optional NAV', () => {
  const rows = normalizeRows([
    { date: '2026-01-02', symbol: 'TDEX', close: 10.5, bvps: 11.2, adjustedPriceFlag: 'Y', securityType: 'ETF' },
    { date: '2026-01-01', symbol: 'TDEX', close: 10.0, bvps: null, adjustedPriceFlag: 'Y', securityType: 'ETF' },
    { date: '2026-01-03', symbol: 'OTHER', close: 9.9, bvps: 10 },
  ], 'TDEX');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, '2026-01-01');
  assert.equal(rows[0].nav, null);
  assert.equal(rows[1].close, 10.5);
  assert.equal(rows[1].nav, 11.2);
  assert.equal(supportsBvpsAsNav('COMMON STOCK'), false);
  assert.equal(normalizeRows([{ date: '2026-01-04', symbol: 'TDEX', close: 10, bvps: 9.8, securityType: 'COMMON STOCK' }], 'TDEX')[0].nav, null);
});
