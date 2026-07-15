'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createFinAiV3Application,
  HOLDING_TO_FIXTURE,
} = require('../lib/v3/application');
const { DEMO_IDS } = require('../lib/v3/cockpit');

function assertApproximatelyEqual(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test('v3 bootstrap composes the governed fixture vertical slice without exposing a credential', async () => {
  const app = createFinAiV3Application({ mode: 'fixture' });
  const payload = await app.bootstrap();
  const serialized = JSON.stringify(payload);

  assert.equal(payload.meta.dataMode, 'fixture');
  assert.equal(payload.meta.sourceStatus, 'SYNTHETIC_FIXTURE_NO_NETWORK');
  assert.equal(payload.meta.informationSetAsOf, '2026-07-15');
  assert.equal(payload.meta.marketDataAsOf, '2026-07-14');
  assert.equal(payload.meta.provider.status.state, 'FIXTURE_READY');
  assert.equal(payload.today.cases.length, 5);
  assert.equal(payload.today.cases[0].actionId, DEMO_IDS.actions.education);
  assert.equal(payload.today.cases[0].priorityTier, 'P0');
  assert.equal(payload.today.cases[0].lane, 'CARE');
  assert.equal(payload.clients.length, 30);
  assert.equal(payload.meta.rms.length, 5);
  assert.equal(new Set(payload.clients.map((client) => client.clientId)).size, 30);
  assert.equal(payload.clientMonitor.rows.length, 30);
  assert.equal(new Set(payload.clientMonitor.rows.map((row) => row.clientId)).size, 30);
  assert.equal(new Set(payload.clientMonitor.rows.map((row) => row.actionId)).size, 30);
  assert.equal(payload.clientMonitor.supportingScoreIsPrimary, false);
  assert.deepEqual(payload.clientMonitor.rankingPolicy, [
    'MANDATORY_CARE',
    'CLIENT_BENEFIT_URGENCY',
    'GOAL_IMPACT',
    'CHANNEL_CAPACITY',
    'BUSINESS_VALUE',
  ]);
  assert.ok(payload.clientMonitor.rows.every((row) => Number.isFinite(row.aum) && Number.isFinite(row.availableLiquidity)));
  assert.ok(payload.clientMonitor.rows.every((row) => row.name && row.rmOwner && row.mainGoal && row.whyNow));
  const routableActionIds = new Set(Object.values(DEMO_IDS.actions));
  assert.ok(payload.clientMonitor.rows.every((row) => row.openCaseActionId === null || routableActionIds.has(row.openCaseActionId)));
  assert.ok(payload.goals.length >= 60 && payload.goals.length <= 120);
  assert.ok(payload.clients.every((client) => client.goals.length >= 2 && client.goals.length <= 4));
  assert.ok(payload.clients.every((client) => client.holdings.length >= 5 && client.holdings.length <= 12));
  assert.ok(payload.clients.every((client) => client.contributions.length && client.withdrawals.length && client.contactHistory.length));
  assert.equal(payload.funds.length, 3);
  assert.doesNotMatch(serialized, /SETSMART_API_KEY|authorization|access[-_]?token/i);
});

test('performance payload supplies clickable-chart data and labels raw NAV honestly', async () => {
  const app = createFinAiV3Application({ mode: 'fixture' });
  const performance = await app.buildPerformance();

  assert.ok(performance.series.length >= 1_000);
  assert.ok(performance.flows.length > 0);
  assert.equal(performance.currency, 'THB');
  assert.match(performance.returnTypeLabel, /NAV return/);
  assert.match(performance.returnTypeLabel, /\u0e2d\u0e32\u0e08\u0e44\u0e21\u0e48\u0e23\u0e27\u0e21\u0e40\u0e07\u0e34\u0e19\u0e1b\u0e31\u0e19\u0e1c\u0e25/);
  assert.doesNotMatch(performance.returnTypeLabel, /^total return$/i);
  assert.ok(performance.series.some((row) => row.drawdown < 0));
  assert.ok(performance.metricDetails.twr.calculationId);
  assert.ok(performance.metricDetails.cvar95.inputHash);
  assert.equal(
    performance.metrics.periodPnl,
    performance.analytics.summary.endBalance.value
      - performance.analytics.summary.startBalance.value
      - performance.analytics.summary.netContribution.value
      + performance.analytics.summary.netWithdrawal.value
  );
  assert.equal(performance.metricDetails.realizedPnl.available, false);
  assert.equal(performance.metricDetails.unrealizedPnl.available, false);
  assert.equal(performance.metricDetails.maxDrawdown.value, performance.metrics.maxDrawdown);
  const governedDrawdowns = new Map(performance.analytics.drawdownSeries.map((row) => [row.date, row.drawdown]));
  assert.ok(performance.series.every((row) => row.drawdown === (governedDrawdowns.get(row.date) ?? 0)));
  assert.deepEqual(
    performance.analytics.drawdownEvents,
    {
      peakDate: performance.metricDetails.maxDrawdown.peakDate,
      troughDate: performance.metricDetails.maxDrawdown.troughDate,
      recoveryDate: performance.metricDetails.maxDrawdown.recoveryDate,
      resultRef: performance.analytics.drawdownEvents.resultRef,
    }
  );
  assert.ok(performance.analytics.goalImpact.every((goal) => goal.afterAvailable === false && goal.after === null));
  assert.equal(new Set(performance.allocation.map((row) => row.masterFundId)).size, performance.allocation.length);
  assert.ok(performance.effectiveHoldings <= performance.allocation.length);
});

test('Action Card detail is goal-first, comparison is capped at three, and approval never sends or trades', async () => {
  const app = createFinAiV3Application({ mode: 'fixture' });
  const detail = await app.actionDetail(DEMO_IDS.actions.education);

  assert.equal(detail.card.priorityTier, 'P0');
  assert.equal(detail.goals[0].type, 'EDUCATION');
  assert.ok(detail.verification.every((item) => item.status === 'PASS'));
  assert.ok(detail.comparisons.length > 0 && detail.comparisons.length <= 3);
  assert.ok(detail.comparisons.every((item) => item.riskLevel <= 5 && item.eligibility.passed));
  assert.equal(detail.draft.reviewRequired, true);
  assert.equal(detail.draft.canSend, false);

  const result = await app.recordDecision(DEMO_IDS.actions.education, {
    decision: 'APPROVE_DRAFT',
    reason: '\u0e22\u0e37\u0e19\u0e22\u0e31\u0e19\u0e40\u0e1b\u0e49\u0e32\u0e2b\u0e21\u0e32\u0e22 \u0e2a\u0e20\u0e32\u0e1e\u0e04\u0e25\u0e48\u0e2d\u0e07 \u0e41\u0e25\u0e30\u0e2b\u0e25\u0e31\u0e01\u0e10\u0e32\u0e19\u0e41\u0e25\u0e49\u0e27',
    owner: 'RM \u0e04\u0e38\u0e13\u0e1e\u0e25\u0e2d\u0e22',
    outcome: 'CLIENT_CONFIRMED',
    nextReview: '2026-08-15',
    actor: 'RM \u0e04\u0e38\u0e13\u0e1e\u0e25\u0e2d\u0e22',
    actorRole: 'RM',
    idempotencyKey: 'application-v3-approve-1',
  });

  assert.equal(result.sent, false);
  assert.equal(result.traded, false);
  assert.equal(result.completion.action.state, 'COMPLETED');
  const humanEvents = app.engine.getAuditTrail(DEMO_IDS.actions.education, { role: 'RM' });
  assert.ok(humanEvents.some((event) => event.actor.actorId === 'rm-demo-ploy' && event.actor.role === 'RM'));
  assert.ok(humanEvents.every((event) => event.actor.role !== 'ADMIN'));
});

test('decision request cannot self-assert an administrator identity', async () => {
  const app = createFinAiV3Application({ mode: 'fixture' });
  await app.recordDecision(DEMO_IDS.actions.education, {
    decision: 'NO_ACTION',
    reason: 'ทดสอบการปลอม role จาก request body',
    actor: 'ผู้ไม่ทราบตัวตน',
    actorRole: 'ADMIN',
    idempotencyKey: 'application-v3-actor-spoof',
  });
  const events = app.engine.getAuditTrail(DEMO_IDS.actions.education, { role: 'RM' });
  assert.ok(events.some((event) => event.eventType === 'HUMAN_DECISION_RECORDED'));
  assert.ok(events.every((event) => event.actor.role !== 'ADMIN'));
  assert.ok(events.some((event) => event.actor.actorId === 'rm-demo-ploy'));
});

test('missing-data Action Card exposes no product comparison and rejects an approval bypass', async () => {
  const app = createFinAiV3Application({ mode: 'fixture' });
  const detail = await app.actionDetail(DEMO_IDS.actions.missingData);

  assert.equal(detail.card.state, 'CONFIRM_DATA');
  assert.equal(detail.comparisons.length, 0);
  assert.ok(detail.missingData.length > 0);
  await assert.rejects(() => app.recordDecision(DEMO_IDS.actions.missingData, {
    decision: 'APPROVE_DRAFT',
    reason: '\u0e1e\u0e22\u0e32\u0e22\u0e32\u0e21\u0e02\u0e49\u0e32\u0e21\u0e01\u0e32\u0e23\u0e22\u0e37\u0e19\u0e22\u0e31\u0e19\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25',
    actor: 'RM \u0e04\u0e38\u0e13\u0e1e\u0e1e\u0e25\u0e2d\u0e22',
    actorRole: 'RM',
    idempotencyKey: 'application-v3-missing-bypass-1',
  }), /CONFIRM_DATA_IS_THE_ONLY_ALLOWED_NEXT_ACTION|only CONFIRM_DATA|HUMAN_REVIEW|invalid state|not allowed/i);
});

test('historical replay summary is deterministic, point-in-time, walk-forward, and clearly separated from scenarios and live outcomes', () => {
  const first = createFinAiV3Application({ mode: 'fixture' }).replaySummary();
  const repeated = createFinAiV3Application({ mode: 'fixture' }).replaySummary();

  assert.equal(first.resultType, 'HISTORICAL_REPLAY');
  assert.equal(first.dataset.synthetic, true);
  assert.ok(first.dataset.fundCount >= 10 && first.dataset.fundCount <= 20);
  assert.equal(first.dataset.historyStart, '2020-01-01');
  assert.equal(first.dataset.historyEnd, '2024-12-31');
  assert.equal(first.dataset.returnType, 'NAV_RETURN');
  assert.equal(first.dataset.isTotalReturn, false);

  assert.equal(first.protocol.method, 'MONTHLY_WALK_FORWARD');
  assert.equal(first.protocol.decisionDateCount, 59);
  assert.equal(first.protocol.expandingPointInTimeInformationSet, true);
  assert.equal(first.protocol.weightsFrozenBeforeEvaluation, true);
  assert.equal(first.protocol.fullSampleOptimization, false);
  assert.equal(first.protocol.alphaObjective, false);
  assert.ok(first.protocol.futureInformationProhibited.includes('future NAV'));

  assert.deepEqual(first.strategies.map((strategy) => strategy.strategyId).sort(), [
    'CURRENT_NO_ACTION',
    'ELIGIBLE_APPROVED_MODEL',
    'GOAL_BASED_CANDIDATE',
    'SIMPLE_POLICY_BENCHMARK',
  ]);
  const requiredMetrics = [
    'twr',
    'xirr',
    'annualizedVolatility',
    'goalSuccessRate',
    'normalizedGoalShortfall',
    'empiricalCVaR',
    'maximumDrawdown',
    'turnover',
    'transactionCost',
    'productFeeEstimate',
    'liquidityViolations',
    'suitabilityViolations',
    'careAlerts',
    'falsePositiveAlertRate',
  ];
  for (const strategy of first.strategies) {
    for (const metric of requiredMetrics) assert.ok(metric in strategy.metrics, `${strategy.strategyId} is missing ${metric}`);
    assert.ok(Number.isFinite(strategy.metrics.rmWorkloadGenerated.actionCount));
    assert.ok(Number.isFinite(strategy.metrics.rmWorkloadGenerated.estimatedMinutes));
    assert.ok(strategy.audit.calculationId);
    assert.ok(strategy.audit.inputHash);
  }
  assert.equal(first.stressPeriods.length, 3);
  assert.ok(first.stressPeriods.every((period) => period.resultType === 'NAMED_STRESS'));
  assert.ok(first.stressPeriods.every((period) => period.dataUse === 'EVALUATION_WINDOW_ONLY_NOT_A_DECISION_INPUT'));

  assert.equal(first.audit.pointInTimeAssertionsPassed, true);
  assert.equal(first.audit.deterministicCalculationIds, true);
  assert.equal(first.audit.replayableFromSeed, true);
  assert.equal(first.audit.decisionSnapshotCount, first.protocol.decisionDateCount);
  assert.equal(first.audit.allRequiredMetricsPresent, true);
  assert.equal(first.resultSeparation.historicalReplay.status, 'COMPLETE');
  assert.equal(first.resultSeparation.namedStress.status, 'COMPLETE');
  assert.equal(first.resultSeparation.forwardSimulation.status, 'NOT_RUN');
  assert.equal(first.resultSeparation.forwardSimulation.metrics, null);
  assert.equal(first.resultSeparation.syntheticScenario.status, 'NOT_RUN');
  assert.equal(first.resultSeparation.syntheticScenario.metrics, null);
  assert.equal(first.resultSeparation.livePilot.status, 'NOT_COLLECTED');
  assert.equal(first.resultSeparation.livePilot.metrics, null);
  assert.equal(first.claimPolicy.causalRevenueClaimAllowed, false);
  assert.equal(first.claimPolicy.causalRetentionClaimAllowed, false);

  assert.equal(first.calculationId, repeated.calculationId);
  assert.equal(first.inputHash, repeated.inputHash);
  assert.deepEqual(first.strategies, repeated.strategies);
});

test('governed policy benchmark starts from the same capital as the actual portfolio and then follows its own weights', async () => {
  const app = createFinAiV3Application({ mode: 'fixture' });
  const performance = await app.buildPerformance();
  const fixtureHoldings = performance.holdings.map((holding) => ({
    ...holding,
    fixtureFundId: HOLDING_TO_FIXTURE[holding.fundId],
  }));
  const groupedHoldings = new Map();
  for (const holding of fixtureHoldings) {
    const group = groupedHoldings.get(holding.fixtureFundId) || { fixtureFundId: holding.fixtureFundId, value: 0 };
    group.value += holding.value;
    groupedHoldings.set(holding.fixtureFundId, group);
  }
  const underlyingHoldings = [...groupedHoldings.values()];
  const histories = new Map();
  for (const holding of underlyingHoldings) {
    histories.set(holding.fixtureFundId, await app.provider.getNavHistory(holding.fixtureFundId, '2021-07-14', performance.asOf));
  }
  const netExternalFlows = performance.flows.reduce((sum, flow) => sum + flow.amount, 0);
  const actualUnits = new Map(underlyingHoldings.map((holding) => {
    const nav = histories.get(holding.fixtureFundId);
    const terminalInvestedValue = holding.fixtureFundId === 'TH-CASH-A'
      ? Math.max(1, holding.value - netExternalFlows)
      : holding.value;
    return [holding.fixtureFundId, terminalInvestedValue / nav.at(-1).nav];
  }));
  const actualInitialCapital = underlyingHoldings.reduce((sum, holding) => (
    sum + actualUnits.get(holding.fixtureFundId) * histories.get(holding.fixtureFundId)[0].nav
  ), 0);
  const policyWeights = new Map([
    ['TH-CASH-A', 0.30],
    ['TH-BOND-A', 0.40],
    ['TH-EQ-A', 0.30],
    ['TH-GLOBAL-A', 0],
  ]);
  const benchmarkUnits = new Map(underlyingHoldings.map((holding) => [
    holding.fixtureFundId,
    actualInitialCapital * policyWeights.get(holding.fixtureFundId) / histories.get(holding.fixtureFundId)[0].nav,
  ]));
  const benchmarkInitialCapital = underlyingHoldings.reduce((sum, holding) => (
    sum + benchmarkUnits.get(holding.fixtureFundId) * histories.get(holding.fixtureFundId)[0].nav
  ), 0);
  assertApproximatelyEqual(benchmarkInitialCapital, actualInitialCapital);

  const firstPublishedDate = performance.series[0].date;
  const expectedFirstActualValue = underlyingHoldings.reduce((sum, holding) => {
    const observation = histories.get(holding.fixtureFundId).find((row) => row.date === firstPublishedDate);
    return sum + actualUnits.get(holding.fixtureFundId) * observation.nav;
  }, 0);
  const expectedFirstBenchmarkValue = underlyingHoldings.reduce((sum, holding) => {
    const observation = histories.get(holding.fixtureFundId).find((row) => row.date === firstPublishedDate);
    return sum + benchmarkUnits.get(holding.fixtureFundId) * observation.nav;
  }, 0);
  assertApproximatelyEqual(performance.series[0].value, expectedFirstActualValue);
  assertApproximatelyEqual(performance.series[0].benchmarkValue, expectedFirstBenchmarkValue);
});

test('specialist handoff requires explicit packet review and remains queued without send, dispatch, or trade', async () => {
  const app = createFinAiV3Application({ mode: 'fixture' });
  const actionId = DEMO_IDS.actions.education;
  const detail = await app.actionDetail(actionId);

  assert.equal(detail.handoffPreview.status, 'DRAFT_NOT_SENT');
  assert.equal(detail.handoffPreview.requiresRmReview, true);
  assert.ok(detail.handoffPreview.currentHoldings.length > 0);
  assert.ok(detail.handoffPreview.questionsAlreadyAsked.length > 0);
  assert.ok(detail.handoffPreview.sourceReferences.length > 0);
  assert.ok(detail.handoffPreview.sourceReferences.every((sourceRef) => typeof sourceRef === 'string' && sourceRef.length > 0));

  await assert.rejects(() => app.recordDecision(actionId, {
    decision: 'HANDOFF',
    reason: 'Specialist review is required',
    nextReview: '2026-07-18',
    outcome: 'HANDOFF_ACCEPTED',
    handoffReviewed: false,
    actor: 'RM test',
    actorRole: 'RM',
    idempotencyKey: 'application-v3-handoff-unreviewed',
  }), /HANDOFF_PACKET_REVIEW_REQUIRED/);

  const result = await app.recordDecision(actionId, {
    decision: 'HANDOFF',
    reason: 'RM reviewed the complete specialist context packet',
    nextReview: '2026-07-18',
    outcome: 'HANDOFF_ACCEPTED',
    handoffReviewed: true,
    actor: 'RM test',
    actorRole: 'RM',
    idempotencyKey: 'application-v3-handoff-reviewed',
  });
  assert.equal(result.action.state, 'SCHEDULED_OR_HANDOFF');
  assert.equal(result.completion.action.state, 'COMPLETED');
  assert.equal(result.handoffPacket.status, 'QUEUED_AFTER_RM_REVIEW');
  assert.equal(result.handoffPacket.canDispatch, false);
  assert.equal(result.handoffPacket.dispatched, false);
  assert.equal(result.sent, false);
  assert.equal(result.traded, false);
  assert.equal(result.decisionRecord.sent, false);
  assert.equal(result.decisionRecord.traded, false);

  const storedPacket = app.engine.getHandoffPacket(result.handoffPacket.packetId);
  assert.equal(storedPacket.status, 'QUEUED_AFTER_RM_REVIEW');
  assert.equal(storedPacket.canDispatch, false);
  assert.equal(storedPacket.dispatched, false);
});

test('PENDING outcome records the human decision but does not close the case or promote feedback to production truth', async () => {
  const app = createFinAiV3Application({ mode: 'fixture' });
  const actionId = DEMO_IDS.actions.education;
  const result = await app.recordDecision(actionId, {
    decision: 'APPROVE_DRAFT',
    reason: 'Draft reviewed; client outcome is still pending',
    nextReview: '2026-07-22',
    outcome: 'PENDING',
    feedback: ['useful'],
    actor: 'RM test',
    actorRole: 'RM',
    idempotencyKey: 'application-v3-pending-not-complete',
  });

  assert.equal(result.action.state, 'APPROVED_OR_EDITED');
  assert.equal(result.completion, null);
  assert.equal(result.qualityLabel, null);
  assert.equal(result.feedbackDeferred, true);
  assert.equal(result.sent, false);
  assert.equal(result.traded, false);
  assert.equal(app.engine.getActionCard(actionId).state, 'APPROVED_OR_EDITED');
  assert.equal(app.engine.getDecisionQualityLabels(actionId).length, 0);
});

test('a future snooze removes the action from Today without changing the governed action state', async () => {
  const app = createFinAiV3Application({ mode: 'fixture' });
  const actionId = DEMO_IDS.actions.education;
  const before = await app.bootstrap();
  assert.ok(before.today.cases.some((item) => item.actionId === actionId));

  const snooze = await app.recordDecision(actionId, {
    decision: 'SNOOZE',
    reason: 'Move this item to the next work day',
    actor: 'RM test',
    actorRole: 'RM',
    idempotencyKey: 'application-v3-snooze-future',
  });
  assert.equal(snooze.sent, false);
  assert.equal(snooze.traded, false);
  assert.equal(snooze.event.scheduledFor, '2026-07-16');

  const after = await app.bootstrap();
  assert.ok(after.today.cases.every((item) => item.actionId !== actionId));
  assert.ok(after.audit.events.some((event) => event.actionId === actionId && event.type === 'SNOOZE'));
  assert.equal(app.engine.getActionCard(actionId).state, 'ELIGIBLE');
});

test('feedback on a closed case is stored only as a future-training label, never production truth', async () => {
  const app = createFinAiV3Application({ mode: 'fixture' });
  const actionId = DEMO_IDS.actions.education;
  const result = await app.recordDecision(actionId, {
    decision: 'APPROVE_DRAFT',
    reason: 'RM verified evidence and recorded the client response',
    nextReview: '2026-08-15',
    outcome: 'CLIENT_CONFIRMED',
    feedback: ['useful', 'clear', 'missing', 'priorityLow'],
    actor: 'RM test',
    actorRole: 'RM',
    idempotencyKey: 'application-v3-closed-feedback',
  });

  assert.equal(result.completion.action.state, 'COMPLETED');
  assert.equal(result.feedbackDeferred, false);
  assert.equal(result.qualityLabel.labelSource, 'RM_FEEDBACK');
  assert.equal(result.qualityLabel.use, 'FUTURE_TRAINING_LABEL_ONLY');
  assert.equal(result.qualityLabel.productionTruth, false);
  assert.equal(result.qualityLabel.recommendationUseful, true);
  assert.equal(result.qualityLabel.explanationUnderstandable, true);
  assert.equal(result.qualityLabel.priorityAssessment, 'TOO_LOW');
  assert.match(result.qualityLabel.missingImportantInformation, /important|\u0e2a\u0e33\u0e04\u0e31\u0e0d/i);
  assert.equal(app.engine.getDecisionQualityLabels(actionId).length, 1);
  assert.ok(app.engine.getAuditTrail(actionId).some((event) => event.eventType === 'DECISION_QUALITY_LABEL_RECORDED'));
});
