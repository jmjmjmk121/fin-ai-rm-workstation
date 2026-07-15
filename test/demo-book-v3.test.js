'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDemoFixtures } = require('../lib/v3/cockpit');
const {
  DEFAULT_DEMO_BOOK_SEED,
  DEMO_BOOK_DATASET_ID,
  DEMO_DATA_LABEL,
  DEMO_FUND_SHELF,
  validateDemoBook,
  createDemoBook,
} = require('../lib/v3/demo-book');

function uniqueCount(values) {
  return new Set(values).size;
}

test('fixed seed produces the same five-RM, thirty-client demo book on every run', () => {
  const first = createDemoBook();
  const second = createDemoBook({ seed: DEFAULT_DEMO_BOOK_SEED });
  assert.deepEqual(second, first);
  assert.equal(first.metadata.datasetId, DEMO_BOOK_DATASET_ID);
  assert.equal(first.metadata.seed, DEFAULT_DEMO_BOOK_SEED);
  assert.equal(first.rms.length, 5);
  assert.equal(first.clients.length, 30);
  assert.equal(first.actions.length, 30);
  assert.equal(first.rms[0].rmId, 'rm_CBF935782024B772FA6D');
  assert.equal(first.clients[0].clientId, 'clt_69B6AECAF41521112183');
  assert.equal(first.actions[0].actionId, 'act_041ADA31432F6E44AD5A');
  assert.notEqual(createDemoBook({ seed: 'another-fixed-seed' }).clients[0].clientId, first.clients[0].clientId);
  assert.equal(validateDemoBook(first), true);
});

test('exactly six unique clients belong to each RM and client/action IDs never duplicate', () => {
  const book = createDemoBook();
  const assignmentCounts = new Map(book.rms.map((rm) => [rm.rmId, 0]));
  for (const client of book.clients) assignmentCounts.set(client.rmId, assignmentCounts.get(client.rmId) + 1);
  assert.deepEqual([...assignmentCounts.values()], [6, 6, 6, 6, 6]);
  assert.equal(uniqueCount(book.clients.map((client) => client.clientId)), 30);
  assert.equal(uniqueCount(book.clients.map((client) => client.displayRef)), 30);
  assert.equal(uniqueCount(book.clients.map((client) => client.name)), 30);
  assert.equal(uniqueCount(book.actions.map((action) => action.actionId)), 30);
  assert.ok(book.clients.every((client) => /^(clt_[A-Z0-9]{20})$/.test(client.clientId)));
  assert.ok(book.actions.every((action) => /^(act_[A-Z0-9]{20})$/.test(action.actionId)));
  assert.ok(book.clients.every((client) => !/^C-\d+$/.test(client.clientId)));
  assert.ok(book.actions.every((action) => clientActionMatches(book, action)));
});

test('existing normalized clients are preserved by identity and enriched without mutating the source fixture', () => {
  const baseFixtures = buildDemoFixtures();
  const before = JSON.stringify(baseFixtures);
  const book = createDemoBook({ baseFixtures });
  assert.equal(JSON.stringify(baseFixtures), before);
  for (const baseClient of baseFixtures.clients) {
    const enriched = book.clients.find((client) => client.clientId === baseClient.clientId);
    assert.ok(enriched, `missing preserved client ${baseClient.clientId}`);
    assert.equal(enriched.name, baseClient.name);
    assert.equal(enriched.displayRef, baseClient.displayRef);
    assert.ok(enriched.goals.length >= 2 && enriched.goals.length <= 4);
    assert.ok(enriched.holdings.length >= 5 && enriched.holdings.length <= 12);
    assert.ok(enriched.contributions.length > 0);
    assert.ok(enriched.withdrawals.length > 0);
    assert.ok(enriched.contactHistory.length > 0);
  }
  for (const baseAction of baseFixtures.actions) {
    assert.ok(book.actions.some((action) => action.actionId === baseAction.actionId && action.clientId === baseAction.clientId));
  }
});

test('every client has two-to-four unique goals, five-to-twelve Thai fund holdings, both flow directions, and contact history', () => {
  const book = createDemoBook({ baseFixtures: buildDemoFixtures() });
  const allGoalIds = [];
  const allFlowIds = [];
  const allContactIds = [];
  for (const client of book.clients) {
    assert.ok(client.goals.length >= 2 && client.goals.length <= 4);
    assert.equal(uniqueCount(client.goals.map((goal) => goal.goalId)), client.goals.length);
    assert.ok(client.goals.every((goal) => goal.name && goal.targetAmount > 0 && goal.targetDate));
    assert.ok(client.goals.every((goal) => goal.fundedRatio >= 0 && goal.baseSuccessProbability >= 0 && goal.stressSuccessProbability >= 0));
    assert.ok(client.holdings.length >= 5 && client.holdings.length <= 12);
    assert.equal(uniqueCount(client.holdings.map((holding) => holding.fundId)), client.holdings.length);
    assert.ok(client.holdings.every((holding) => holding.thaiRegistered && holding.registrationCountryCode === 'TH'));
    assert.ok(client.holdings.every((holding) => holding.masterFundId && holding.shareClassId));
    assert.ok(client.holdings.every((holding) => holding.returnType === 'NAV_RETURN' && holding.isTotalReturn === false));
    const masterIds = client.holdings.map((holding) => holding.masterFundId);
    assert.ok(masterIds.some((masterId) => masterIds.filter((candidate) => candidate === masterId).length > 1));
    assert.ok(client.contributions.every((flow) => flow.type === 'CONTRIBUTION' && flow.signedAmount > 0));
    assert.ok(client.withdrawals.every((flow) => flow.type === 'WITHDRAWAL' && flow.signedAmount < 0));
    assert.equal(client.cashFlows.length, client.contributions.length + client.withdrawals.length);
    assert.ok(client.contactHistory.every((contact) => contact.occurredAt && contact.channel && contact.outcome));
    allGoalIds.push(...client.goals.map((goal) => goal.goalId));
    allFlowIds.push(...client.cashFlows.map((flow) => flow.cashFlowId));
    allContactIds.push(...client.contactHistory.map((contact) => contact.contactId));
  }
  assert.equal(uniqueCount(allGoalIds), allGoalIds.length);
  assert.equal(uniqueCount(allFlowIds), allFlowIds.length);
  assert.equal(uniqueCount(allContactIds), allContactIds.length);
});

test('fixture labels, master-fund grouping, and currency exposure are explicit and safe', () => {
  const book = createDemoBook();
  assert.equal(book.metadata.dataMode, 'FIXTURE');
  assert.equal(book.metadata.dataLabel, DEMO_DATA_LABEL);
  assert.equal(book.metadata.isSynthetic, true);
  assert.equal(book.metadata.returnType, 'NAV_RETURN');
  assert.equal(book.metadata.isTotalReturn, false);
  assert.ok(DEMO_FUND_SHELF.every((fund) => fund.dataMode === 'FIXTURE' && fund.isSynthetic));
  assert.ok(DEMO_FUND_SHELF.every((fund) => fund.thaiRegistered && fund.masterFundId && fund.shareClassId));
  assert.ok(DEMO_FUND_SHELF.some((fund, index, funds) => funds.some((other, otherIndex) => otherIndex !== index && other.masterFundId === fund.masterFundId)));
  for (const client of book.clients) {
    assert.equal(client.dataMode, 'FIXTURE');
    assert.equal(client.dataLabel, DEMO_DATA_LABEL);
    assert.equal(client.isSynthetic, true);
    const exposureTotal = Object.values(client.portfolio.currencyExposure).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(exposureTotal - 1) < 1e-6);
    assert.ok(client.holdings.every((holding) => Math.abs(Object.values(holding.currencyExposure).reduce((sum, value) => sum + value, 0) - 1) < 1e-6));
  }
  assert.ok(book.actions.every((action) => action.decisionSafety.canAutoSend === false));
  assert.ok(book.actions.every((action) => action.decisionSafety.canAutoTrade === false));
  assert.ok(book.actions.every((action) => action.decisionSafety.canExecuteProduct === false));
});

function clientActionMatches(book, action) {
  const client = book.clients.find((candidate) => candidate.clientId === action.clientId);
  return Boolean(client && client.actionIds.includes(action.actionId));
}
