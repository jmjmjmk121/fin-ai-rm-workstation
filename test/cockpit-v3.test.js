'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ACTION_STATES,
  ALLOWED_TRANSITIONS,
  DECISIONS,
  PROHIBITED_OPERATIONS,
  DEMO_IDS,
  governedNumber,
  assertGovernedNumber,
  buildResultRef,
  buildGoalLedger,
  validateFundingPlan,
  evaluateContactPolicy,
  validateActionCard,
  rankActions,
  canTransition,
  assertUniqueEntityIds,
  buildDemoFixtures,
  createCockpitEngine,
} = require('../lib/v3/cockpit');

const RM = Object.freeze({ actorId: 'rm_demo_ploy', role: 'RM', displayName: 'RM คุณพลอย', isHuman: true });
const RISK = 'RISK';

test('demo entity IDs are unique, stable, opaque, and the Round-1 reference is never returned to the RM UI', () => {
  const fixtures = buildDemoFixtures();
  assert.equal(assertUniqueEntityIds(fixtures), true);
  assert.equal(new Set(fixtures.clients.map((item) => item.clientId)).size, fixtures.clients.length);
  assert.equal(new Set(fixtures.actions.map((item) => item.actionId)).size, fixtures.actions.length);
  assert.equal(new Set(fixtures.snapshots.map((item) => item.snapshotId)).size, fixtures.snapshots.length);

  const engine = createCockpitEngine();
  const client = engine.getClient360('C-4124');
  const today = engine.getToday();
  assert.equal(client.client.clientId, DEMO_IDS.clients.education);
  assert.equal(client.client.displayRef, 'FIN • 7K3P');
  assert.doesNotMatch(JSON.stringify(client), /C-4124/);
  assert.doesNotMatch(JSON.stringify(today), /C-4124/);
});

test('Today in 5 Minutes is capped at five cases with P0 Care first, lane separation, handoff and capacity counters', () => {
  const engine = createCockpitEngine();
  const today = engine.getToday({ maxCases: 99, callCapacityMinutes: 40 });
  assert.equal(today.topCases.length, 5);
  assert.equal(today.controls.maxCasesShown, 5);
  assert.equal(today.topCases[0].actionId, DEMO_IDS.actions.education);
  assert.equal(today.topCases[0].lane, 'CARE');
  assert.equal(today.topCases[0].priorityTier, 'P0');
  assert.match(today.topCases[0].whyThisClient, /ค่าเรียนบุตร/);
  assert.ok(today.topCases.some((item) => item.lane === 'GROWTH'));
  assert.equal(today.counters.p0Care, 1);
  assert.equal(today.counters.profileDataCases, 1);
  assert.equal(today.counters.overdueHandoffs, 1);
  assert.equal(today.counters.completedToday, 1);
  assert.equal(today.capacity.allocatedCallMinutes, 20);
  assert.equal(today.capacity.remainingCallMinutes, 20);
  assert.ok(today.topCases.some((item) => item.whyNextClientIsLower));
});

test('mandatory Care always outranks a higher-scoring Growth opportunity', () => {
  const ranked = rankActions([
    { actionId: 'act_growth', lane: 'GROWTH', mandatoryCare: false, priorityTier: 'P0', supportingScore: 100, dueAt: '2026-07-15' },
    { actionId: 'act_care', lane: 'CARE', mandatoryCare: true, priorityTier: 'P1', supportingScore: 1, dueAt: '2026-07-20' },
  ]);
  assert.equal(ranked.ordered[0].actionId, 'act_care');
  assert.equal(ranked.care.length, 1);
  assert.equal(ranked.growth.length, 1);
});

test('critical missing data yields CONFIRM_DATA and business score cannot bypass suitability', () => {
  const engine = createCockpitEngine();
  const action = engine.getActionCard(DEMO_IDS.actions.missingData);
  assert.equal(action.supportingScore, 99);
  assert.equal(action.state, 'CONFIRM_DATA');
  assert.equal(action.channel, 'CONFIRM_DATA');
  assert.equal(action.dataGate.onlyAllowedNextAction, 'CONFIRM_DATA');
  assert.ok(action.dataGate.missing.some((item) => item.key === 'suitabilityCurrent'));
  assert.ok(action.dataGate.missing.every((item) => item.exactQuestion && item.whoCanProvideIt));
  assert.throws(() => engine.startReview(action.actionId, {
    requestId: 'req_missing_review_1', actor: RM, reason: 'ลองเปิดคำแนะนำทั้งที่ข้อมูลไม่ครบ',
  }), /only CONFIRM_DATA/);
  engine.transitionAction(action.actionId, 'DATA_CHECK', {
    requestId: 'req_missing_check_1', actor: RM, reason: 'ทบทวนสถานะข้อมูลอีกครั้ง',
  });
  assert.throws(() => engine.transitionAction(action.actionId, 'ELIGIBLE', {
    requestId: 'req_missing_bypass_1', actor: RM, reason: 'พยายามใช้คะแนนธุรกิจข้าม suitability',
  }), /only CONFIRM_DATA/);
});

test('contact-fatigue controls produce a valid no-action result and keep the case out of the top five', () => {
  const engine = createCockpitEngine();
  const today = engine.getToday();
  const fatigued = engine.getActionCard(DEMO_IDS.actions.fatigued);
  assert.equal(fatigued.channel, 'NO_ACTION');
  assert.ok(fatigued.reasonCodes.includes('NO_ACTION_VALID'));
  assert.ok(!today.topCases.some((item) => item.actionId === fatigued.actionId));
  assert.ok(today.deferredForContact.some((item) => item.actionId === fatigued.actionId));
  assert.equal(today.counters.noAction, 1);
});

test('mandatory Care may override frequency caps but never quiet hours', () => {
  const action = { lane: 'CARE', mandatoryCare: true, channel: 'CALL' };
  const contact = {
    contacts7Days: 5, contacts30Days: 9, declinedContacts30Days: 2, campaignOverlap: true,
    quietHours: '20:00-08:00', preferredChannel: 'CALL',
  };
  const daytime = evaluateContactPolicy(contact, action, '2026-07-15T09:00:00+07:00');
  assert.equal(daytime.allowedNow, true);
  assert.equal(daytime.mandatoryOverrideUsed, true);
  assert.ok(daytime.warnings.length > 0);
  const quiet = evaluateContactPolicy(contact, action, '2026-07-15T22:00:00+07:00');
  assert.equal(quiet.allowedNow, false);
  assert.equal(quiet.recommendation, 'DEFER');
});

test('Goal Ledger rejects any capital lot assigned to two goals', () => {
  const base = {
    clientId: 'clt_test', snapshotId: 'snp_test', asOf: '2026-07-15', totalWealth: 1_000_000,
    monthlyExpense: 50_000, currentlyLiquid: 300_000,
    capitalLots: [{ lotId: 'lot_shared', amount: 1_000_000 }],
    resultRef: buildResultRef('double-count-test', { value: 1_000_000 }),
  };
  assert.throws(() => buildGoalLedger({
    ...base,
    goals: [
      { goalId: 'gol_a', type: 'HOME', name: 'บ้าน', target: 1_000_000, targetDate: '2030-01-01', capitalLotIds: ['lot_shared'] },
      { goalId: 'gol_b', type: 'RETIREMENT', name: 'เกษียณ', target: 2_000_000, targetDate: '2040-01-01', capitalLotIds: ['lot_shared'] },
    ],
  }), /double-counted/);
});

test('education Goal Ledger preserves liquidity first and funding plans cannot consume the reserve', () => {
  const engine = createCockpitEngine();
  const ledger = engine.getClient360(DEMO_IDS.clients.education).goalLedger;
  assert.equal(ledger.invariants.noDoubleCounting, true);
  assert.equal(ledger.invariants.liquidityReserveProtected, true);
  assert.equal(ledger.totals.assignedAcrossGoals.value, 12_400_000);
  assert.equal(ledger.totals.totalWealth.value, 12_400_000);
  assert.equal(ledger.liquidityReserve.required.value, 870_000);
  assert.equal(ledger.liquidityReserve.currentlyLiquid.value, 620_000);
  assert.equal(ledger.liquidityReserve.additionalNeeded.value, 250_000);
  assert.equal(ledger.liquidityReserve.canUseProtectedAmountForInvestment, false);

  assert.throws(() => validateFundingPlan(ledger, {
    postActionLiquidValue: 800_000,
    goalAllocations: [{ goalId: DEMO_IDS.goals.education, amount: 4_800_000 }],
  }), /liquidity reserve/);
  const valid = validateFundingPlan(ledger, {
    postActionLiquidValue: 870_000,
    goalAllocations: [
      { goalId: DEMO_IDS.goals.education, amount: 4_800_000, capitalLotIds: ['plan_lot_edu'] },
      { goalId: DEMO_IDS.goals.educationRetirement, amount: 6_730_000, capitalLotIds: ['plan_lot_ret'] },
    ],
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.reservePreserved, true);
  assert.equal(valid.allocated, 11_530_000);
});

test('funding plan rejects double-counting even when the total amount is below the limit', () => {
  const ledger = createCockpitEngine().getClient360(DEMO_IDS.clients.education).goalLedger;
  assert.throws(() => validateFundingPlan(ledger, {
    postActionLiquidValue: 870_000,
    goalAllocations: [
      { goalId: 'one', amount: 1_000_000, capitalLotIds: ['same_lot'] },
      { goalId: 'two', amount: 1_000_000, capitalLotIds: ['same_lot'] },
    ],
  }), /double-counted/);
});

test('every Action Card has the complete governed shape and no automatic execution capability', () => {
  const engine = createCockpitEngine();
  for (const actionId of Object.values(DEMO_IDS.actions)) {
    const action = engine.getActionCard(actionId);
    assert.equal(validateActionCard(action), true);
    assert.ok(ACTION_STATES.includes(action.state));
    assert.ok(DECISIONS.every((decision) => action.decisionSafety.allowedDecisions.includes(decision)));
    assert.equal(action.decisionSafety.canAutoSend, false);
    assert.equal(action.decisionSafety.canAutoTrade, false);
    assert.equal(action.decisionSafety.canExecuteProduct, false);
    assert.equal(action.decisionSafety.approveAndSendAvailable, false);
  }
});

test('governed numbers require numeric lineage metadata', () => {
  const ref = buildResultRef('metric', { input: 1 });
  const metric = governedNumber(1.9, {
    unit: '%/day', asOf: '2026-07-15', sourceRefs: ['fixture:test'], formulaId: 'EMPIRICAL_CVAR',
    calculationId: ref.calculationId, modelVersion: ref.modelVersion, assumptionVersion: ref.assumptionVersion,
    inputHash: ref.inputHash, reasonCodes: ['TAIL_RISK'],
  });
  assert.equal(assertGovernedNumber(metric), true);
  assert.throws(() => governedNumber(1.9, {
    unit: '%/day', asOf: '2026-07-15', sourceRefs: ['fixture:test'], formulaId: 'EMPIRICAL_CVAR',
    calculationId: ref.calculationId, modelVersion: ref.modelVersion, assumptionVersion: ref.assumptionVersion,
    reasonCodes: ['TAIL_RISK'],
  }), /inputHash/);

  const action = createCockpitEngine().getActionCard(DEMO_IDS.actions.education);
  for (const evidence of action.evidence) assert.equal(assertGovernedNumber(evidence.numeric), true);
});

test('summary, evidence detail, and model audit use the exact same governed result reference', () => {
  const engine = createCockpitEngine();
  const views = engine.getGovernedViews(DEMO_IDS.actions.education, { role: RISK });
  assert.strictEqual(views.summary.resultRef, views.detail.resultRef);
  assert.strictEqual(views.detail.resultRef, views.audit.resultRef);
  assert.equal(views.summary.resultRef.calculationId, engine.getActionCard(DEMO_IDS.actions.education).resultRef.calculationId);
  assert.throws(() => engine.getCalculationAudit(DEMO_IDS.actions.education, { role: 'RM' }), /authorised role/);
  assert.equal(engine.getCalculationAudit(DEMO_IDS.actions.education, { role: 'COMPLIANCE' }).level, 3);
});

test('Client 360 is goal-first, read-only for governed inputs, and exposes stable Thai-fund fixture IDs', () => {
  const client360 = createCockpitEngine().getClient360(DEMO_IDS.clients.education);
  assert.equal(client360.goalLedger.goals.find((goal) => goal.goalId === DEMO_IDS.goals.education).name, 'ค่าเรียนบุตร');
  assert.equal(client360.permissions.rmCanEditSuitability, false);
  assert.equal(client360.permissions.rmCanEditKyc, false);
  assert.equal(client360.permissions.rmCanEditModelAssumptions, false);
  assert.equal(client360.permissions.rmCanAutoSend, false);
  assert.deepEqual(client360.snapshot.holdings.map((holding) => holding.fundId), [
    'TH-MMF-A', 'TH-MMF-D', 'TH-BOND-PLUS-A', 'TH-BOND-PLUS-D', 'TH-EQ-CORE-A', 'TH-GLOBAL-A',
  ]);
  assert.equal(new Set(client360.snapshot.holdings.map((holding) => holding.masterFundId)).size, 4);
});

test('human lifecycle records approval without sending, then scheduling and completion with outcome and next review', () => {
  const engine = createCockpitEngine();
  const actionId = DEMO_IDS.actions.education;
  const review = engine.startReview(actionId, { requestId: 'req_lifecycle_review', actor: RM, reason: 'RM เปิดตรวจหลักฐาน' });
  assert.equal(review.action.state, 'HUMAN_REVIEW');
  assert.equal(review.sent, false);
  assert.equal(review.traded, false);

  const approved = engine.recordDecision(actionId, {
    requestId: 'req_lifecycle_approve', actor: RM, decision: 'APPROVE_DRAFT', reason: 'ตรวจข้อมูลและถ้อยคำแล้ว',
    owner: 'RM คุณพลอย', nextReview: '2026-10-15', outcome: 'รอนัดหมาย',
  });
  assert.equal(approved.action.state, 'APPROVED_OR_EDITED');
  assert.equal(approved.sent, false);
  assert.equal(approved.traded, false);
  assert.equal(approved.nextManualStep, 'SCHEDULE_OR_HANDOFF');

  const scheduled = engine.transitionAction(actionId, 'SCHEDULED_OR_HANDOFF', {
    requestId: 'req_lifecycle_schedule', actor: RM, reason: 'RM บันทึกนัดหมายหลังลูกค้ายืนยันช่องทาง',
  });
  assert.equal(scheduled.action.state, 'SCHEDULED_OR_HANDOFF');
  const completed = engine.completeAction(actionId, {
    requestId: 'req_lifecycle_complete', actor: RM, reason: 'คุยกับลูกค้าแล้ว', outcome: 'CLIENT_CONFIRMED_GOAL',
    note: 'ลูกค้ายืนยันยอดและวันใช้เงิน', nextReview: '2026-10-15',
  });
  assert.equal(completed.action.state, 'COMPLETED');
  assert.equal(completed.outcome.nextReview, '2026-10-15');
  assert.equal(completed.sent, false);
  assert.equal(completed.traded, false);

  const events = engine.getAuditTrail(actionId, { role: RISK });
  assert.deepEqual(events.slice(-4).map((event) => event.nextState), [
    'HUMAN_REVIEW', 'APPROVED_OR_EDITED', 'SCHEDULED_OR_HANDOFF', 'COMPLETED',
  ]);
  assert.ok(events.every((event) => Object.prototype.hasOwnProperty.call(event, 'previousState')));
});

test('there is no approve-and-send, auto-send, auto-trade, or LLM approval path', () => {
  const engine = createCockpitEngine();
  const actionId = DEMO_IDS.actions.education;
  engine.startReview(actionId, { requestId: 'req_no_auto_review', actor: RM, reason: 'เปิดทบทวน' });
  for (const operation of PROHIBITED_OPERATIONS) {
    assert.throws(() => engine.recordDecision(actionId, {
      requestId: `req_no_auto_${operation}`, actor: RM, decision: operation, reason: 'ต้องถูกปฏิเสธ',
    }), /prohibited/);
  }
  assert.throws(() => engine.recordDecision(actionId, {
    requestId: 'req_ai_approval', actor: { actorId: 'llm_01', role: 'LLM', isHuman: false },
    decision: 'APPROVE_DRAFT', reason: 'โมเดลพยายามอนุมัติ',
  }), /human decisions/);
  assert.equal(typeof engine.send, 'undefined');
  assert.equal(typeof engine.trade, 'undefined');
  assert.equal(typeof engine.autoSend, 'undefined');
  assert.equal(typeof engine.autoTrade, 'undefined');
});

test('decision requests are idempotent and a reused key with changed content is rejected', () => {
  const engine = createCockpitEngine();
  const actionId = DEMO_IDS.actions.education;
  engine.startReview(actionId, { requestId: 'req_idem_review', actor: RM, reason: 'เปิดทบทวน' });
  const input = {
    requestId: 'req_idem_decision', actor: RM, decision: 'EDIT_DRAFT', reason: 'ปรับภาษาให้ง่ายขึ้น',
    edits: 'ขอทบทวนเงินค่าเรียนและเงินสำรองก่อนพิจารณาทางเลือกนะคะ', nextReview: '2026-10-15',
  };
  const first = engine.recordDecision(actionId, input);
  const eventCount = engine.getAuditTrail(actionId).length;
  const repeated = engine.recordDecision(actionId, input);
  assert.deepEqual(repeated, first);
  assert.equal(engine.getAuditTrail(actionId).length, eventCount);
  assert.throws(() => engine.recordDecision(actionId, { ...input, edits: 'ข้อความคนละชุด' }), /idempotency conflict/);
});

test('audit history is append-only from the caller perspective', () => {
  const engine = createCockpitEngine();
  const actionId = DEMO_IDS.actions.education;
  const copy = engine.getAuditTrail(actionId);
  const initialLength = copy.length;
  copy[0].reason = 'ผู้เรียกพยายามแก้';
  copy.push({ eventId: 'fake' });
  const fresh = engine.getAuditTrail(actionId);
  assert.equal(fresh.length, initialLength);
  assert.notEqual(fresh[0].reason, 'ผู้เรียกพยายามแก้');
  assert.ok(fresh.every((event) => event.eventId !== 'fake'));
});

test('specialist handoff packet carries context, requires RM review, and never dispatches itself', () => {
  const engine = createCockpitEngine();
  const actionId = DEMO_IDS.actions.education;
  const packet = engine.createSpecialistHandoffPacket(actionId, {
    requestId: 'req_handoff_packet', actor: RM, reason: 'ต้องการทบทวนการแบ่งเงินตามเป้าหมาย',
    specialistType: 'ผู้เชี่ยวชาญการลงทุนและวางแผนเป้าหมาย', dueAt: '2026-07-16T15:00:00+07:00',
  });
  assert.equal(packet.status, 'DRAFT_REVIEW_REQUIRED');
  assert.equal(packet.canDispatch, false);
  assert.equal(packet.dispatched, false);
  assert.equal(packet.clientSnapshot.clientId, DEMO_IDS.clients.education);
  assert.ok(packet.affectedGoals.some((goal) => goal.goalId === DEMO_IDS.goals.education));
  assert.deepEqual(packet.currentHoldings.map((holding) => holding.fundId), [
    'TH-MMF-A', 'TH-MMF-D', 'TH-BOND-PLUS-A', 'TH-BOND-PLUS-D', 'TH-EQ-CORE-A', 'TH-GLOBAL-A',
  ]);
  assert.ok(packet.questionsAlreadyAsked.length > 0);
  assert.ok(packet.sourceReferences.every((source) => source.date));

  engine.startReview(actionId, { requestId: 'req_handoff_review', actor: RM, reason: 'RM เปิดทบทวน' });
  assert.throws(() => engine.recordDecision(actionId, {
    requestId: 'req_handoff_unreviewed', actor: RM, decision: 'HANDOFF', reason: 'ส่งต่อ',
    handoffPacketId: packet.packetId, handoffReviewed: false,
  }), /must review/);
  const result = engine.recordDecision(actionId, {
    requestId: 'req_handoff_reviewed', actor: RM, decision: 'HANDOFF', reason: 'RM ตรวจ packet แล้ว',
    handoffPacketId: packet.packetId, handoffReviewed: true,
  });
  assert.equal(result.action.state, 'SCHEDULED_OR_HANDOFF');
  assert.equal(result.handoffPacket.status, 'QUEUED_AFTER_RM_REVIEW');
  assert.equal(result.handoffPacket.canDispatch, false);
  assert.equal(result.handoffPacket.dispatched, false);
});

test('decision-quality feedback is a future training label, not immediate production truth', () => {
  const engine = createCockpitEngine();
  const actionId = DEMO_IDS.actions.completed;
  const input = {
    requestId: 'req_quality_1', actor: RM, recommendationUseful: true, explanationUnderstandable: true,
    missingImportantInformation: 'ควรมีวันที่ค่าธรรมเนียมมีผล', priorityAssessment: 'RIGHT', specialistResponseCompleted: null,
  };
  const label = engine.recordDecisionQuality(actionId, input);
  assert.equal(label.labelSource, 'RM_FEEDBACK');
  assert.equal(label.use, 'FUTURE_TRAINING_LABEL_ONLY');
  assert.equal(label.productionTruth, false);
  assert.deepEqual(engine.recordDecisionQuality(actionId, input), label);
  assert.equal(engine.getDecisionQualityLabels(actionId).length, 1);
});

test('state machine publishes explicit allowed transitions and blocks invalid shortcuts', () => {
  assert.equal(canTransition('ELIGIBLE', 'HUMAN_REVIEW'), true);
  assert.equal(canTransition('ELIGIBLE', 'COMPLETED'), false);
  assert.equal(canTransition('COMPLETED', 'ELIGIBLE'), false);
  assert.deepEqual(ALLOWED_TRANSITIONS.COMPLETED, []);
  assert.equal(new Set(ACTION_STATES).size, ACTION_STATES.length);

  const engine = createCockpitEngine();
  assert.throws(() => engine.transitionAction(DEMO_IDS.actions.education, 'COMPLETED', {
    requestId: 'req_invalid_complete', actor: RM, reason: 'พยายามข้ามขั้น',
  }), /use completeAction/);
  assert.throws(() => engine.transitionAction(DEMO_IDS.actions.education, 'APPROVED_OR_EDITED', {
    requestId: 'req_invalid_approve', actor: RM, reason: 'พยายามข้าม human decision',
  }), /use recordDecision/);
});
