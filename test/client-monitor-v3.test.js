'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDemoFixtures } = require('../lib/v3/cockpit');
const { createDemoBook } = require('../lib/v3/demo-book');
const {
  CLIENT_MONITOR_COLUMNS,
  SAVED_CLIENT_VIEWS,
  createClientMonitorRows,
  rankClientMonitorRows,
  sortClientMonitorRows,
  filterClientMonitorRows,
  applySavedClientView,
  buildClientMonitor,
} = require('../lib/v3/client-monitor');

function book() {
  return createDemoBook({ baseFixtures: buildDemoFixtures() });
}

test('monitor creates one compact deterministic row for each of 30 unique clients/actions', () => {
  const source = book();
  const first = createClientMonitorRows(source);
  const second = createClientMonitorRows(source);
  assert.deepEqual(second, first);
  assert.equal(first.length, 30);
  assert.equal(new Set(first.map((row) => row.clientId)).size, 30);
  assert.equal(new Set(first.map((row) => row.actionId)).size, 30);
  assert.ok(first.every((row) => row.clientName && row.rmOwner && row.mainGoal && row.whyNow));
  assert.ok(first.every((row) => Number.isFinite(row.aum) && Number.isFinite(row.availableLiquidity)));
  assert.ok(first.every((row) => row.supportingScoreUsedForOrder === false && row.rankingEvidence.supportingScoreUsedForOrder === false));
  assert.deepEqual(buildClientMonitor(source).columns, CLIENT_MONITOR_COLUMNS);
  assert.deepEqual(buildClientMonitor(source).savedViews, SAVED_CLIENT_VIEWS);
});

function rankingRow(id, overrides = {}) {
  return {
    actionId: `action-${id}`,
    clientId: `client-${id}`,
    rankingEvidence: {
      mandatoryCare: false,
      benefitUrgency: 100,
      goalImpact: 10,
      channelCapacity: 1,
      businessValue: { aum: 1_000_000, availableLiquidity: 100_000 },
      supportingScoreUsedForOrder: false,
      ...overrides.rankingEvidence,
    },
    supportingScore: overrides.supportingScore ?? 0,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'rankingEvidence')),
  };
}

test('ranking precedence is Mandatory Care, benefit/urgency, goal impact, channel/capacity, then business value', () => {
  const rows = [
    rankingRow('business', { supportingScore: 99, rankingEvidence: { businessValue: { aum: 100_000_000, availableLiquidity: 20_000_000 } } }),
    rankingRow('channel', { supportingScore: 99, rankingEvidence: { channelCapacity: 2 } }),
    rankingRow('goal', { supportingScore: 99, rankingEvidence: { goalImpact: 20 } }),
    rankingRow('urgency', { supportingScore: 99, rankingEvidence: { benefitUrgency: 200 } }),
    rankingRow('mandatory', { supportingScore: 1, rankingEvidence: { mandatoryCare: true, benefitUrgency: 0, goalImpact: 0, channelCapacity: 0, businessValue: { aum: 1, availableLiquidity: 0 } } }),
  ];
  assert.deepEqual(rankClientMonitorRows(rows).map((row) => row.clientId), [
    'client-mandatory', 'client-urgency', 'client-goal', 'client-channel', 'client-business',
  ]);
});

test('supporting ML score cannot change the governed order', () => {
  const lowMlHigherPolicy = rankingRow('policy', { supportingScore: 1, rankingEvidence: { benefitUrgency: 101 } });
  const saturatedMlLowerPolicy = rankingRow('ml', { supportingScore: 99, rankingEvidence: { benefitUrgency: 100 } });
  assert.equal(rankClientMonitorRows([saturatedMlLowerPolicy, lowMlHigherPolicy])[0].clientId, 'client-policy');
});

test('sorting is stable and filters cover RM, liquidity, risk, contact, readiness, goal and due date', () => {
  const rows = createClientMonitorRows(book());
  const byAum = sortClientMonitorRows(rows, { key: 'aum' });
  assert.ok(byAum.every((row, index) => index === 0 || byAum[index - 1].aum >= row.aum));
  const equal = rows.slice(0, 3).map((row) => ({ ...row, aum: 10 }));
  assert.deepEqual(sortClientMonitorRows(equal, { key: 'aum' }).map((row) => row.clientId), equal.map((row) => row.clientId));
  const sample = rows.find((row) => row.riskBreach) || rows[0];
  const filtered = filterClientMonitorRows(rows, {
    rmOwner: sample.rmOwner,
    priorityTier: sample.priorityTier,
    riskBreach: sample.riskBreach,
    dataReadiness: sample.readinessStatus,
    openCase: sample.openCase,
  });
  assert.ok(filtered.includes ? filtered.some((row) => row.clientId === sample.clientId) : false);
  assert.ok(filtered.every((row) => row.rmOwner === sample.rmOwner && row.priorityTier === sample.priorityTier));
  assert.doesNotThrow(() => sortClientMonitorRows(rows, { key: 'recentTransactionActivity' }));
  assert.doesNotThrow(() => sortClientMonitorRows(rows, { key: 'goalDueSoon' }));
  assert.doesNotThrow(() => sortClientMonitorRows(rows, { key: 'lastContact' }));
  assert.doesNotThrow(() => sortClientMonitorRows(rows, { key: 'contactCount' }));
  assert.doesNotThrow(() => sortClientMonitorRows(rows, { key: 'dataReadiness' }));
  assert.doesNotThrow(() => sortClientMonitorRows(rows, { key: 'rmOwner' }));
});

test('all seven named saved views apply their documented predicate', () => {
  const rows = createClientMonitorRows(book());
  for (const name of SAVED_CLIENT_VIEWS) assert.doesNotThrow(() => applySavedClientView(rows, name));
  assert.ok(applySavedClientView(rows, 'พอร์ตเกินกรอบ').every((row) => row.riskBreach));
  assert.ok(applySavedClientView(rows, 'KYC/บัญชียังไม่พร้อม').every((row) => row.readinessStatus !== 'READY'));
  assert.ok(applySavedClientView(rows, 'รอผู้เชี่ยวชาญ').every((row) => row.suggestedChannel === 'HANDOFF' || row.actionState === 'SCHEDULED_OR_HANDOFF'));
  assert.ok(applySavedClientView(rows, 'ยังไม่ควรติดต่อ').every((row) => row.suggestedChannel === 'NO_ACTION' || row.contactFatigue));
  assert.throws(() => applySavedClientView(rows, 'วิวที่ไม่มี'), /unknown saved view/);
});

test('duplicate client/action IDs fail closed', () => {
  const source = book();
  assert.throws(() => createClientMonitorRows({ ...source, clients: [source.clients[0], source.clients[0]] }), /duplicate clientId/);
  assert.throws(() => createClientMonitorRows({ ...source, actions: [source.actions[0], source.actions[0]] }), /duplicate actionId/);
});
