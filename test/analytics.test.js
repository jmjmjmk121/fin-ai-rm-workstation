'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLIENTS, FOLLOW_UPS } = require('../lib/case-data');
const { modelFor } = require('../lib/workbench');
const { buildClientAnalytics, buildBusinessAnalytics } = require('../lib/analytics');
const { simulateCrisisBook, trainContactModel } = require('../lib/crisis-simulation');
const { ageInCalendarDays, sanitizedErrorCode, monitoringSignal } = require('../lib/setsmart');

test('client analytics reconciles risk contributions and does not fabricate a backtest', () => {
  const client = CLIENTS[0];
  const analytics = buildClientAnalytics(client, modelFor(client));
  const current = analytics.portfolios.current;
  assert.ok(current.metrics.volatility > 0);
  assert.ok(current.oneDayRisk.expectedShortfall95Baht > current.oneDayRisk.valueAtRisk95Baht);
  assert.ok(Math.abs(current.riskContributions.totals.varianceReconciliationError) < 1e-12);
  assert.ok(Math.abs(current.riskContributions.totals.volatilityReconciliationError) < 1e-12);
  assert.equal(analytics.correlation.matrix.length, 6);
  assert.equal(analytics.scenarioComparison.length, 4);
  assert.equal(analytics.historicalBacktest.included, false);
});

test('business analytics exposes transparent queue math and refuses invented capacity or revenue', () => {
  const analytics = buildBusinessAnalytics(CLIENTS, FOLLOW_UPS);
  assert.equal(analytics.queue.length, CLIENTS.length);
  assert.equal(analytics.headline.clientCount, CLIENTS.length);
  assert.equal(analytics.capacity.availableRmMinutes, null);
  assert.equal(analytics.businessValue.revenueEstimateBaht, null);
  assert.equal(analytics.queue[0].mandatory, true);
  assert.equal(analytics.queuePolicy.rulesInOrder.length, 4);
});

test('crisis simulation scales to a large synthetic book and preserves the 18.75% opening example', () => {
  const result = simulateCrisisBook({ clientCount: 1200, rmCount: 8, riskyAssetShock: -0.25 });
  assert.equal(result.inputs.clientCount, 1200);
  assert.equal(result.headline.exampleLossRate, 0.1875);
  assert.equal(
    result.withFinAi.calls + result.withFinAi.messages + result.withFinAi.monitoring,
    1200
  );
  assert.ok(result.headline.contactingCount > 0);
  assert.ok(result.withFinAi.queueMinutes < result.withoutFinAi.queueMinutes);
  assert.ok(result.comparison.queueMinutesDifference > 0);
  assert.ok(result.withoutFinAi.queueOverCapacityMinutes >= result.withFinAi.queueOverCapacityMinutes);
  assert.equal(result.withoutFinAi.missedSlaCount, null);
  assert.equal(result.topClients.length, 12);
  assert.equal(result.rmRoster.length, 8);
  assert.equal(result.rmRoster.reduce((sum, row) => sum + row.clientCount, 0), 1200);
  assert.match(result.status, /synthetic/i);
});

test('crisis staffing sensitivity holds the same synthetic client book fixed', () => {
  const thin = simulateCrisisBook({ clientCount: 800, rmCount: 1, riskyAssetShock: -0.25 });
  const staffed = simulateCrisisBook({ clientCount: 800, rmCount: 20, riskyAssetShock: -0.25 });
  assert.deepEqual(
    thin.topClients.map((client) => [client.id, client.aumBaht, client.lossRate, client.channel]),
    staffed.topClients.map((client) => [client.id, client.aumBaht, client.lossRate, client.channel])
  );
  assert.equal(thin.withFinAi.calls, staffed.withFinAi.calls);
  assert.ok(thin.withFinAi.queueOverCapacityMinutes > staffed.withFinAi.queueOverCapacityMinutes);
});

test('crisis capacity is summed per RM so pooled spare time cannot hide an overloaded RM', () => {
  const result = simulateCrisisBook({ clientCount: 10_000, rmCount: 100, riskyAssetShock: -0.25 });
  const rosterOverCapacity = result.rmRoster.reduce((sum, row) => sum + row.assistedOverCapacityMinutes, 0);
  const overloadedRms = result.rmRoster.filter((row) => row.assistedOverCapacityMinutes > 0).length;
  assert.ok(overloadedRms > 0);
  assert.equal(result.withFinAi.overloadedRmCount, overloadedRms);
  assert.ok(Math.abs(result.withFinAi.queueOverCapacityMinutes - rosterOverCapacity) <= result.rmRoster.length);
  assert.ok(result.withFinAi.queueOverCapacityMinutes > 0);
});

test('crisis RM roster balances all clients and clamps zero inputs to declared minimums', () => {
  const uneven = simulateCrisisBook({ clientCount: 3001, rmCount: 20, riskyAssetShock: -0.25 });
  const loads = uneven.rmRoster.map((row) => row.clientCount).sort((a, b) => a - b);
  assert.equal(loads[loads.length - 1] - loads[0], 1);
  assert.equal(uneven.rmRoster.reduce((sum, row) => sum + row.clientCount, 0), 3001);
  const clamped = simulateCrisisBook({ clientCount: 0, rmCount: 0 });
  assert.equal(clamped.inputs.clientCount, 100);
  assert.equal(clamped.inputs.rmCount, 1);
});

test('frontier payload carries the same KYC advice gate as client analytics', () => {
  const { buildFrontierPayload } = require('../lib/workbench');
  const blocked = buildFrontierPayload('C-5078');
  const open = buildFrontierPayload('C-1048');
  assert.equal(blocked.client.adviceGate.recommendationUsable, false);
  assert.equal(open.client.adviceGate.recommendationUsable, true);
});

test('goal projection uses the declared model goal bucket rather than blended account weights', () => {
  const client = CLIENTS.find((item) => item.id === 'C-2012');
  const model = modelFor(client);
  const analytics = buildClientAnalytics(client, model);
  const { simulateGoal } = require('../lib/stress');
  const expected = simulateGoal(client, model.goalWeights, 0);
  assert.equal(analytics.goalProjection.approvedModelBase.probabilityOfReachingTarget, expected.probability);
  assert.match(analytics.goalProjection.method, /goal-bucket/i);
});

test('prototype ML component is actually fitted and explicitly synthetic', () => {
  const model = trainContactModel();
  assert.equal(model.weights.length, 9);
  assert.ok(model.validationAuc > 0.65 && model.validationAuc < 1);
  assert.match(model.status, /synthetic/i);
});

test('SET SMART freshness and monitoring helpers are deterministic and sanitized', () => {
  assert.equal(ageInCalendarDays('2026-07-14', new Date('2026-07-15T12:00:00+07:00')), 1);
  assert.equal(sanitizedErrorCode(new Error('private vendor message')), 'SETSMART_UNAVAILABLE');
  assert.equal(sanitizedErrorCode(new Error('SETSMART_HTTP_429')), 'SETSMART_HTTP_429');
  assert.equal(monitoringSignal({ oneDayMove: -0.04, fiveDayMove: -0.08 }).level, 'review');
});
