'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PIPELINE_STAGES,
  ALLOWED_CAPABILITIES,
  PROHIBITED_CAPABILITIES,
  REQUIRED_IMPORTANT_NUMBER_FIELDS,
  RM_DECISIONS,
  isCapabilityProhibited,
  assertCapabilityAllowed,
  validateImportantNumber,
  createApprovedToolRegistry,
  planApprovedTool,
  executeApprovedTool,
  renderValidatedExplanation,
  runControlledAiWorkflow,
  recordHumanRmDecision,
} = require('../lib/v3/controlled-ai');

function governedCvar(overrides = {}) {
  return {
    id: 'portfolio-cvar-95',
    value: 1.9,
    unit: '% ต่อวัน',
    asOf: '2026-07-14',
    sourceRefs: ['fixture://thai-funds/nav/portfolio'],
    formulaId: 'EMPIRICAL_CVAR_LOSS_95',
    calculationId: 'calc_portfolio_cvar_20260714',
    modelVersion: 'quant-v3.0.0',
    assumptionVersion: 'risk-policy-demo-v1',
    inputHash: '5f89eb9d1c94a4f6b6124ddf0e990a0d',
    reasonCodes: ['TAIL_LOSS_EXPLANATION'],
    ...overrides,
  };
}

function riskTool(overrides = {}) {
  return {
    id: 'portfolio-risk-calculator',
    kind: 'CALCULATOR',
    approved: true,
    intents: ['EXPLAIN_PORTFOLIO_RISK'],
    keywords: ['ความเสี่ยง', 'ขาดทุน', 'cvar'],
    capabilities: ['READ_GOVERNED_DATA', 'CALCULATE_GOVERNED_METRIC'],
    validateInput: (input) => typeof input.clientId === 'string',
    execute: async () => ({
      importantNumbers: [governedCvar()],
      approvedFacts: [{
        id: 'cvar-limitation',
        text: 'ค่านี้ใช้เปรียบเทียบความเสียหายช่วงรุนแรง ไม่ใช่การคาดการณ์วันพรุ่งนี้',
        approved: true,
        asOf: '2026-07-14',
        sourceRefs: ['policy://risk-explanation/cvar'],
      }],
      payload: { riskBand: 'REVIEW' },
    }),
    ...overrides,
  };
}

test('controlled pipeline and prohibited capabilities are explicit and immutable', () => {
  assert.deepEqual(PIPELINE_STAGES, [
    'TRIGGER_OR_QUESTION', 'TOOL_PLANNER', 'APPROVED_TOOL', 'VALIDATOR', 'AI_EXPLANATION', 'RM_DECISION',
  ]);
  for (const capability of [
    'AUTO_SEND', 'AUTO_TRADE', 'EDIT_KYC_CDD', 'EDIT_SUITABILITY',
    'INVENT_PRODUCT_FACT', 'FREE_FORM_IMPORTANT_CALCULATION',
  ]) {
    assert.equal(isCapabilityProhibited(capability), true);
    assert.throws(() => assertCapabilityAllowed(capability), { code: 'PROHIBITED_CAPABILITY' });
  }
  assert.equal(Object.isFrozen(PROHIBITED_CAPABILITIES), true);
  assert.equal(Object.isFrozen(PROHIBITED_CAPABILITIES.AUTO_SEND), true);
});

test('registry accepts only approved data/calculator tools and rejects unsafe capabilities', () => {
  assert.throws(() => createApprovedToolRegistry([{ ...riskTool(), approved: false }]), { code: 'TOOL_NOT_APPROVED' });
  assert.throws(() => createApprovedToolRegistry([{ ...riskTool(), kind: 'LLM' }]), { code: 'TOOL_KIND_INVALID' });
  assert.throws(() => createApprovedToolRegistry([{ ...riskTool(), capabilities: ['AUTO_SEND'] }]), { code: 'PROHIBITED_CAPABILITY' });
  assert.throws(() => createApprovedToolRegistry([{ ...riskTool(), capabilities: ['SEND_MESSAGE'] }]), { code: 'CAPABILITY_NOT_ALLOWLISTED' });
  assert.throws(() => createApprovedToolRegistry([riskTool(), riskTool()]), { code: 'TOOL_ID_DUPLICATE' });
  const registry = createApprovedToolRegistry([riskTool()]);
  assert.deepEqual(registry.list().map((tool) => tool.id), ['portfolio-risk-calculator']);
  assert.deepEqual(ALLOWED_CAPABILITIES, [
    'READ_GOVERNED_DATA', 'READ_APPROVED_EVIDENCE', 'CALCULATE_GOVERNED_METRIC', 'DRAFT_RM_EXPLANATION',
  ]);
});

test('plain-language attempts to auto-send, auto-trade, or edit suitability are blocked before tool selection', () => {
  const registry = createApprovedToolRegistry([riskTool()]);
  for (const question of [
    'ช่วย auto-send ข้อความนี้ทันที',
    'ส่งคำสั่งซื้อขายให้ลูกค้าเลย',
    'แก้ suitability ให้ผ่านก่อน',
    'อนุมัติและส่งข้อความอัตโนมัติ',
  ]) {
    assert.throws(() => planApprovedTool({ question, toolInput: { clientId: 'clt_demo' } }, registry), {
      code: 'PROHIBITED_REQUEST_INTENT',
    });
  }
});

test('plain Thai question deterministically selects an approved tool', () => {
  const registry = createApprovedToolRegistry([
    riskTool(),
    {
      id: 'client-data-reader', kind: 'DATA', approved: true,
      intents: ['READ_CLIENT'], keywords: ['ข้อมูลลูกค้า'], capabilities: ['READ_GOVERNED_DATA'],
      execute: async () => ({ approvedFacts: [] }),
    },
  ]);
  const first = planApprovedTool({
    question: 'ช่วยอธิบายความเสี่ยงและช่วงขาดทุนของพอร์ตนี้',
    toolInput: { clientId: 'clt_demo' },
  }, registry);
  const second = planApprovedTool({
    question: 'ช่วยอธิบายความเสี่ยงและช่วงขาดทุนของพอร์ตนี้',
    toolInput: { clientId: 'clt_demo' },
  }, registry);
  assert.equal(first.toolId, 'portfolio-risk-calculator');
  assert.equal(first.selectionReason, 'APPROVED_KEYWORD_MATCH');
  assert.deepEqual(first, second);
});

test('explicit unapproved tools and prohibited requested actions are rejected before execution', () => {
  const registry = createApprovedToolRegistry([riskTool()]);
  assert.throws(() => planApprovedTool({ question: 'ช่วยดูพอร์ต', toolId: 'free-form-python' }, registry), {
    code: 'REQUESTED_TOOL_NOT_APPROVED',
  });
  assert.throws(() => planApprovedTool({
    question: 'คำนวณแล้วส่งให้ลูกค้าเลย',
    toolId: 'portfolio-risk-calculator',
    requestedCapabilities: ['AUTO_SEND'],
  }, registry), { code: 'PROHIBITED_CAPABILITY' });
});

test('every important number requires complete governed lineage metadata', () => {
  const valid = validateImportantNumber(governedCvar());
  assert.equal(valid.validated, true);
  assert.equal(Object.isFrozen(valid), true);
  for (const field of REQUIRED_IMPORTANT_NUMBER_FIELDS) {
    const incomplete = governedCvar();
    delete incomplete[field];
    assert.throws(() => validateImportantNumber(incomplete), undefined, `missing ${field} must fail`);
  }
  assert.throws(() => validateImportantNumber(governedCvar({ reasonCodes: [] })), {
    code: 'IMPORTANT_NUMBER_REASONCODES_INVALID',
  });
  assert.throws(() => validateImportantNumber(governedCvar({ sourceRefs: [] })), {
    code: 'IMPORTANT_NUMBER_SOURCEREFS_INVALID',
  });
});

test('approved calculator output is validated before an explanation can use it', async () => {
  const registry = createApprovedToolRegistry([riskTool()]);
  const plan = planApprovedTool({
    trigger: 'พอร์ตมี tail-risk alert',
    intent: 'EXPLAIN_PORTFOLIO_RISK',
    toolInput: { clientId: 'clt_demo' },
  }, registry);
  const result = await executeApprovedTool(plan, registry);
  assert.equal(result.validation.status, 'PASSED');
  assert.equal(result.importantNumbers[0].validated, true);
  assert.equal(result.approvedFacts[0].validated, true);
  assert.match(result.validation.validationId, /^val_[a-f0-9]{24}$/);
});

test('plain Thai qualitative explanation is allowed without a numeric claim', async () => {
  const workflow = await runControlledAiWorkflow({
    request: {
      question: 'ค่านี้ควรตีความอย่างไร',
      intent: 'EXPLAIN_PORTFOLIO_RISK',
      toolInput: { clientId: 'clt_demo' },
    },
    tools: [riskTool()],
    explanationDraft: {
      segments: [
        { type: 'text', text: 'ใช้ค่านี้เปรียบเทียบความเสียหายช่วงตลาดรุนแรง ' },
        { type: 'fact', factId: 'cvar-limitation' },
      ],
    },
  });
  assert.equal(workflow.explanation.qualitativeOnly, true);
  assert.equal(workflow.explanation.numericClaims.length, 0);
  assert.equal(workflow.rmDecision.status, 'PENDING_HUMAN_REVIEW');
  assert.deepEqual(workflow.pipeline, PIPELINE_STAGES);
});

test('validated number segment carries the exact value and all lineage into the explanation', async () => {
  const workflow = await runControlledAiWorkflow({
    request: {
      trigger: 'tail-risk alert',
      toolId: 'portfolio-risk-calculator',
      toolInput: { clientId: 'clt_demo' },
    },
    tools: [riskTool()],
    explanationBuilder: ({ validatedToolResult }) => ({
      segments: [
        { type: 'text', text: 'ในช่วงผลลัพธ์ที่แย่ ระบบคำนวณความเสียหายเฉลี่ยประมาณ ' },
        { type: 'number', numberId: validatedToolResult.importantNumbers[0].id },
        { type: 'text', text: ' จากข้อมูลย้อนหลัง' },
      ],
    }),
  });
  const claim = workflow.explanation.numericClaims[0];
  assert.match(workflow.explanation.text, /1\.9 % ต่อวัน/);
  for (const field of REQUIRED_IMPORTANT_NUMBER_FIELDS) assert.notEqual(claim[field], undefined);
  assert.equal(claim.calculationId, 'calc_portfolio_cvar_20260714');
  assert.equal(workflow.explanation.validationId, workflow.validatedToolResult.validation.validationId);
});

test('unvalidated numeric claims in Arabic or Thai digits are rejected', async () => {
  const registry = createApprovedToolRegistry([riskTool()]);
  const plan = planApprovedTool({ question: 'ดูความเสี่ยง', toolInput: { clientId: 'clt_demo' } }, registry);
  const result = await executeApprovedTool(plan, registry);
  assert.throws(() => renderValidatedExplanation({
    segments: [{ type: 'text', text: 'CVaR เท่ากับ 1.9%' }],
  }, result), { code: 'UNVALIDATED_NUMERIC_CLAIM' });
  assert.throws(() => renderValidatedExplanation({
    segments: [{ type: 'text', text: 'ควรถืออย่างน้อย ๓ ปี' }],
  }, result), { code: 'UNVALIDATED_NUMERIC_CLAIM' });
  assert.throws(() => renderValidatedExplanation({
    segments: [{ type: 'number', numberId: 'invented-number' }],
  }, result), { code: 'UNVALIDATED_NUMERIC_CLAIM' });
});

test('invalid calculator metadata blocks the pipeline before explanation generation', async () => {
  let explanationCalled = false;
  const unsafeTool = riskTool({
    execute: async () => ({ importantNumbers: [governedCvar({ inputHash: undefined })] }),
  });
  await assert.rejects(() => runControlledAiWorkflow({
    request: { question: 'ดูความเสี่ยง', toolInput: { clientId: 'clt_demo' } },
    tools: [unsafeTool],
    explanationBuilder: () => {
      explanationCalled = true;
      return { segments: [{ type: 'text', text: 'ไม่ควรถูกเรียก' }] };
    },
  }), { code: 'IMPORTANT_NUMBER_METADATA_MISSING' });
  assert.equal(explanationCalled, false);
});

test('product facts must come from approved evidence and cannot hide numeric claims', async () => {
  const registry = createApprovedToolRegistry([riskTool()]);
  const plan = planApprovedTool({ question: 'ดูความเสี่ยง', toolInput: { clientId: 'clt_demo' } }, registry);
  const result = await executeApprovedTool(plan, registry);
  assert.throws(() => renderValidatedExplanation({
    segments: [{ type: 'fact', factId: 'invented-product-fact' }],
  }, result), { code: 'UNAPPROVED_PRODUCT_FACT' });
  const numericFactTool = riskTool({
    execute: async () => ({
      approvedFacts: [{
        id: 'unsafe-fact', text: 'กองทุนมีความเสี่ยงระดับ 6', approved: true,
        asOf: '2026-07-14', sourceRefs: ['fixture://fund/factsheet'],
      }],
    }),
  });
  const numericRegistry = createApprovedToolRegistry([numericFactTool]);
  const numericPlan = planApprovedTool({ question: 'ดูความเสี่ยง', toolInput: { clientId: 'clt_demo' } }, numericRegistry);
  await assert.rejects(() => executeApprovedTool(numericPlan, numericRegistry), {
    code: 'APPROVED_FACT_CONTAINS_UNGOVERNED_NUMBER',
  });
});

test('workflow identifiers and planner output are deterministic for identical governed inputs', async () => {
  const options = {
    request: {
      question: 'ช่วยอธิบายความเสี่ยง', intent: 'EXPLAIN_PORTFOLIO_RISK',
      toolInput: { clientId: 'clt_demo' },
    },
    tools: [riskTool()],
    explanationDraft: { segments: [{ type: 'text', text: 'ควรทบทวนเป้าหมายและเงินสำรองก่อนตัดสินใจ' }] },
  };
  const first = await runControlledAiWorkflow(options);
  const second = await runControlledAiWorkflow(options);
  assert.equal(first.workflowId, second.workflowId);
  assert.deepEqual(first.plan, second.plan);
});

test('the final stage requires a human RM and records no send, trade, KYC, or suitability mutation', async () => {
  const workflow = await runControlledAiWorkflow({
    request: { question: 'ช่วยอธิบายความเสี่ยง', toolInput: { clientId: 'clt_demo' } },
    tools: [riskTool()],
    explanationDraft: { segments: [{ type: 'text', text: 'RM ควรตรวจข้อมูลและคุยกับลูกค้าก่อน' }] },
  });
  assert.equal(workflow.rmDecision.required, true);
  assert.deepEqual(workflow.rmDecision.allowedDecisions, RM_DECISIONS);
  assert.equal(workflow.rmDecision.canAutoSend, false);
  assert.equal(workflow.rmDecision.canAutoTrade, false);
  assert.throws(() => recordHumanRmDecision(workflow, {
    actor: { actorId: 'ai', role: 'RM', isHuman: false },
    decision: 'APPROVE_DRAFT', reason: 'AI tried to approve', at: '2026-07-15T09:00:00+07:00',
  }), { code: 'HUMAN_RM_REQUIRED' });
  assert.throws(() => recordHumanRmDecision(workflow, {
    actor: { actorId: 'rm-1', role: 'RM', isHuman: true },
    decision: 'APPROVE_AND_SEND', reason: 'not allowed', at: '2026-07-15T09:00:00+07:00',
  }), { code: 'RM_DECISION_NOT_ALLOWED' });
  const recorded = recordHumanRmDecision(workflow, {
    actor: { actorId: 'rm-1', role: 'RM', displayName: 'RM คุณพลอย', isHuman: true },
    decision: 'APPROVE_DRAFT', reason: 'ตรวจหลักฐานและถ้อยคำแล้ว', at: '2026-07-15T09:00:00+07:00',
  });
  assert.equal(recorded.decision.status, 'RECORDED_BY_HUMAN_RM');
  assert.equal(recorded.sent, false);
  assert.equal(recorded.traded, false);
  assert.equal(recorded.kycEdited, false);
  assert.equal(recorded.suitabilityEdited, false);
});
