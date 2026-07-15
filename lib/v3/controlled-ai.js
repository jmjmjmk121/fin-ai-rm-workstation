'use strict';

/**
 * Deterministic governance boundary for controlled AI assistance.
 *
 * The module does not call an LLM, send a message, edit client records, or
 * execute a transaction. It constrains orchestration to this sequence:
 *
 * Trigger / question -> approved tool planner -> approved tool -> validator
 * -> validated explanation -> pending human RM decision.
 */

const crypto = require('node:crypto');

const PIPELINE_STAGES = Object.freeze([
  'TRIGGER_OR_QUESTION',
  'TOOL_PLANNER',
  'APPROVED_TOOL',
  'VALIDATOR',
  'AI_EXPLANATION',
  'RM_DECISION',
]);

const TOOL_KINDS = Object.freeze(['DATA', 'CALCULATOR']);

const ALLOWED_CAPABILITIES = Object.freeze([
  'READ_GOVERNED_DATA',
  'READ_APPROVED_EVIDENCE',
  'CALCULATE_GOVERNED_METRIC',
  'DRAFT_RM_EXPLANATION',
]);

const PROHIBITED_CAPABILITIES = deepFreeze({
  AUTO_SEND: { reasonCode: 'HUMAN_SEND_REQUIRED', explanationTh: 'AI ส่งข้อความหาลูกค้าเองไม่ได้' },
  APPROVE_AND_SEND: { reasonCode: 'HUMAN_SEND_REQUIRED', explanationTh: 'การอนุมัติร่างและการส่งต้องเป็นคนละขั้น' },
  AUTO_TRADE: { reasonCode: 'HUMAN_TRANSACTION_REQUIRED', explanationTh: 'AI ซื้อขายเองไม่ได้' },
  EXECUTE_TRADE: { reasonCode: 'HUMAN_TRANSACTION_REQUIRED', explanationTh: 'AI ส่งคำสั่งซื้อขายไม่ได้' },
  EDIT_KYC_CDD: { reasonCode: 'SYSTEM_OF_RECORD_CONTROLLED', explanationTh: 'AI แก้ KYC/CDD ไม่ได้' },
  EDIT_SUITABILITY: { reasonCode: 'SYSTEM_OF_RECORD_CONTROLLED', explanationTh: 'AI แก้แบบประเมินความเหมาะสมไม่ได้' },
  EDIT_RISK_PROFILE: { reasonCode: 'SYSTEM_OF_RECORD_CONTROLLED', explanationTh: 'AI แก้กรอบความเสี่ยงไม่ได้' },
  INVENT_PRODUCT_FACT: { reasonCode: 'APPROVED_EVIDENCE_REQUIRED', explanationTh: 'AI แต่งข้อมูลผลิตภัณฑ์ไม่ได้' },
  FREE_FORM_IMPORTANT_CALCULATION: { reasonCode: 'APPROVED_CALCULATOR_REQUIRED', explanationTh: 'ตัวเลขสำคัญต้องมาจากเครื่องมือคำนวณที่อนุมัติ' },
  BYPASS_ELIGIBILITY: { reasonCode: 'ELIGIBILITY_GATE_REQUIRED', explanationTh: 'AI ข้ามเงื่อนไขสิทธิและความเหมาะสมไม่ได้' },
  BIND_PRODUCT: { reasonCode: 'HUMAN_TRANSACTION_REQUIRED', explanationTh: 'AI ผูกพันผลิตภัณฑ์แทนลูกค้าไม่ได้' },
});

const REQUIRED_IMPORTANT_NUMBER_FIELDS = Object.freeze([
  'id',
  'value',
  'unit',
  'asOf',
  'sourceRefs',
  'formulaId',
  'calculationId',
  'modelVersion',
  'assumptionVersion',
  'inputHash',
  'reasonCodes',
]);

const RM_DECISIONS = Object.freeze([
  'APPROVE_DRAFT',
  'EDIT_DRAFT',
  'REQUEST_INFORMATION',
  'HANDOFF',
  'NO_ACTION',
]);

const NUMERIC_TOKEN_PATTERN = /[0-9๐-๙]+(?:[.,][0-9๐-๙]+)*/u;
const UNSAFE_REQUEST_PATTERNS = Object.freeze([
  /\bauto[-_ ]?send\b|send\s+.*automatically|ส่ง(?:ข้อความ)?[^\n]{0,30}อัตโนมัติ|ส่งข้อความ[^\n]{0,20}เอง/iu,
  /\bauto[-_ ]?trade\b|execute\s+.*trade|ซื้อขาย[^\n]{0,30}อัตโนมัติ|ส่งคำสั่งซื้อขาย/iu,
  /edit\s+(?:kyc|cdd|suitability)|แก้[^\n]{0,20}(?:kyc|cdd|suitability|แบบประเมิน)/iu,
  /approve[^\n]{0,20}send|อนุมัติ[^\n]{0,20}ส่ง/iu,
]);

class GovernanceError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'GovernanceError';
    this.code = code;
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return value;
}

function deepClone(value, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const output = Array.isArray(value) ? [] : {};
  seen.set(value, output);
  if (Array.isArray(value)) {
    for (const child of value) output.push(deepClone(child, seen));
  } else {
    for (const [key, child] of Object.entries(value)) output[key] = deepClone(child, seen);
  }
  return output;
}

function canonicalize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
    return output;
  }
  if (typeof value === 'function') return '[function]';
  return value;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeCapability(value) {
  return String(value || '').trim().toUpperCase();
}

function isCapabilityProhibited(capability) {
  return Object.prototype.hasOwnProperty.call(PROHIBITED_CAPABILITIES, normalizeCapability(capability));
}

function assertCapabilityAllowed(capability) {
  const normalized = normalizeCapability(capability);
  if (!normalized) throw new GovernanceError('CAPABILITY_REQUIRED');
  if (isCapabilityProhibited(normalized)) {
    const policy = PROHIBITED_CAPABILITIES[normalized];
    throw new GovernanceError('PROHIBITED_CAPABILITY', `${normalized}: ${policy.reasonCode}`);
  }
  if (!ALLOWED_CAPABILITIES.includes(normalized)) {
    throw new GovernanceError('CAPABILITY_NOT_ALLOWLISTED', `${normalized}: explicit approval required`);
  }
  return true;
}

function assertNoProhibitedCapabilities(capabilities) {
  const values = capabilities == null ? [] : Array.isArray(capabilities) ? capabilities : [capabilities];
  for (const capability of values) assertCapabilityAllowed(capability);
  return true;
}

function validateIsoAsOf(value) {
  if (!nonEmptyString(value) || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new GovernanceError('IMPORTANT_NUMBER_AS_OF_INVALID', 'asOf must be a valid ISO date or date-time');
  }
}

function validateStringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !nonEmptyString(item))) {
    throw new GovernanceError(`IMPORTANT_NUMBER_${field.toUpperCase()}_INVALID`, `${field} must contain at least one value`);
  }
}

function validateImportantNumber(number) {
  if (!number || typeof number !== 'object' || Array.isArray(number)) {
    throw new GovernanceError('IMPORTANT_NUMBER_INVALID');
  }
  for (const field of REQUIRED_IMPORTANT_NUMBER_FIELDS) {
    if (number[field] === undefined || number[field] === null) {
      throw new GovernanceError('IMPORTANT_NUMBER_METADATA_MISSING', `Important number is missing ${field}`);
    }
  }
  if (!nonEmptyString(number.id)) throw new GovernanceError('IMPORTANT_NUMBER_ID_INVALID');
  if (typeof number.value !== 'number' || !Number.isFinite(number.value)) {
    throw new GovernanceError('IMPORTANT_NUMBER_VALUE_INVALID');
  }
  for (const field of ['unit', 'formulaId', 'calculationId', 'modelVersion', 'assumptionVersion']) {
    if (!nonEmptyString(number[field])) {
      throw new GovernanceError('IMPORTANT_NUMBER_METADATA_INVALID', `${field} must be a non-empty string`);
    }
  }
  if (!nonEmptyString(number.inputHash) || number.inputHash.trim().length < 8) {
    throw new GovernanceError('IMPORTANT_NUMBER_INPUT_HASH_INVALID');
  }
  validateIsoAsOf(number.asOf);
  validateStringArray(number.sourceRefs, 'sourceRefs');
  validateStringArray(number.reasonCodes, 'reasonCodes');
  return deepFreeze({
    ...deepClone(number),
    sourceRefs: [...number.sourceRefs],
    reasonCodes: [...number.reasonCodes],
    validated: true,
  });
}

function containsNumericToken(text) {
  return NUMERIC_TOKEN_PATTERN.test(String(text || ''));
}

function validateApprovedFact(fact) {
  if (!fact || typeof fact !== 'object' || Array.isArray(fact)) throw new GovernanceError('APPROVED_FACT_INVALID');
  if (fact.approved !== true) throw new GovernanceError('PRODUCT_FACT_NOT_APPROVED');
  if (!nonEmptyString(fact.id) || !nonEmptyString(fact.text)) throw new GovernanceError('APPROVED_FACT_INVALID');
  validateStringArray(fact.sourceRefs, 'sourceRefs');
  validateIsoAsOf(fact.asOf);
  if (containsNumericToken(fact.text)) {
    throw new GovernanceError(
      'APPROVED_FACT_CONTAINS_UNGOVERNED_NUMBER',
      'Numbers in an approved fact must be supplied as governed important numbers'
    );
  }
  return deepFreeze({ ...deepClone(fact), sourceRefs: [...fact.sourceRefs], validated: true });
}

function validateApprovedToolResult(tool, rawResult) {
  if (!tool || tool.approved !== true) throw new GovernanceError('TOOL_NOT_APPROVED');
  if (!rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
    throw new GovernanceError('APPROVED_TOOL_RESULT_INVALID');
  }
  const importantNumbers = (rawResult.importantNumbers || []).map(validateImportantNumber);
  const approvedFacts = (rawResult.approvedFacts || []).map(validateApprovedFact);
  const ids = [...importantNumbers.map((item) => item.id), ...approvedFacts.map((item) => item.id)];
  if (new Set(ids).size !== ids.length) throw new GovernanceError('VALIDATED_EVIDENCE_ID_DUPLICATE');
  const payload = rawResult.payload === undefined ? null : deepClone(rawResult.payload);
  const validationId = `val_${stableHash({
    toolId: tool.id,
    importantNumbers,
    approvedFacts,
    payload,
  }).slice(0, 24)}`;
  return deepFreeze({
    toolId: tool.id,
    toolKind: tool.kind,
    importantNumbers,
    approvedFacts,
    payload,
    validation: {
      status: 'PASSED',
      validationId,
      numericClaimCount: importantNumbers.length,
      approvedFactCount: approvedFacts.length,
      reasonCodes: ['APPROVED_TOOL_RESULT_VALIDATED'],
    },
  });
}

function normalizeToolDefinition(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new GovernanceError('TOOL_DEFINITION_INVALID');
  }
  if (!nonEmptyString(definition.id)) throw new GovernanceError('TOOL_ID_REQUIRED');
  const kind = String(definition.kind || '').toUpperCase();
  if (!TOOL_KINDS.includes(kind)) throw new GovernanceError('TOOL_KIND_INVALID');
  if (definition.approved !== true) throw new GovernanceError('TOOL_NOT_APPROVED');
  if (typeof definition.execute !== 'function') throw new GovernanceError('TOOL_EXECUTOR_REQUIRED');
  assertNoProhibitedCapabilities(definition.capabilities || []);
  return Object.freeze({
    id: definition.id.trim(),
    kind,
    approved: true,
    intents: Object.freeze((definition.intents || []).map((item) => String(item).trim().toUpperCase()).filter(Boolean)),
    keywords: Object.freeze((definition.keywords || []).map((item) => String(item).trim().toLocaleLowerCase('th-TH')).filter(Boolean)),
    capabilities: Object.freeze((definition.capabilities || []).map(normalizeCapability)),
    validateInput: typeof definition.validateInput === 'function' ? definition.validateInput : null,
    execute: definition.execute,
  });
}

function createApprovedToolRegistry(definitions = []) {
  if (!Array.isArray(definitions) || definitions.length === 0) throw new GovernanceError('APPROVED_TOOLS_REQUIRED');
  const byId = new Map();
  for (const source of definitions) {
    const tool = normalizeToolDefinition(source);
    if (byId.has(tool.id)) throw new GovernanceError('TOOL_ID_DUPLICATE');
    byId.set(tool.id, tool);
  }
  const sortedIds = [...byId.keys()].sort((left, right) => left.localeCompare(right));
  return Object.freeze({
    get(toolId) {
      return byId.get(toolId) || null;
    },
    list() {
      return sortedIds.map((id) => {
        const tool = byId.get(id);
        return {
          id: tool.id,
          kind: tool.kind,
          approved: tool.approved,
          intents: [...tool.intents],
          keywords: [...tool.keywords],
          capabilities: [...tool.capabilities],
        };
      });
    },
  });
}

function ensureRegistry(registryOrDefinitions) {
  if (registryOrDefinitions && typeof registryOrDefinitions.get === 'function' && typeof registryOrDefinitions.list === 'function') {
    return registryOrDefinitions;
  }
  return createApprovedToolRegistry(registryOrDefinitions);
}

function collectRequestedCapabilities(request) {
  return [
    ...(Array.isArray(request.requestedCapabilities) ? request.requestedCapabilities : []),
    ...(request.requestedCapability ? [request.requestedCapability] : []),
  ];
}

function assertRequestTextSafe(request) {
  const text = `${request.trigger || ''}\n${request.question || ''}`;
  if (UNSAFE_REQUEST_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new GovernanceError('PROHIBITED_REQUEST_INTENT');
  }
}

function planApprovedTool(request, registryOrDefinitions) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new GovernanceError('REQUEST_INVALID');
  if (!nonEmptyString(request.trigger) && !nonEmptyString(request.question)) {
    throw new GovernanceError('TRIGGER_OR_QUESTION_REQUIRED');
  }
  assertRequestTextSafe(request);
  assertNoProhibitedCapabilities(collectRequestedCapabilities(request));
  const registry = ensureRegistry(registryOrDefinitions);
  const available = registry.list();
  let selected = null;
  let selectionReason = null;
  if (request.toolId) {
    selected = registry.get(String(request.toolId));
    if (!selected) throw new GovernanceError('REQUESTED_TOOL_NOT_APPROVED');
    selectionReason = 'EXPLICIT_APPROVED_TOOL';
  } else {
    const intent = String(request.intent || '').trim().toUpperCase();
    if (intent) {
      const matches = available.filter((tool) => tool.intents.includes(intent));
      if (matches.length) {
        selected = registry.get(matches[0].id);
        selectionReason = 'APPROVED_INTENT_MATCH';
      }
    }
    if (!selected) {
      const text = `${request.trigger || ''} ${request.question || ''}`.toLocaleLowerCase('th-TH');
      const ranked = available.map((tool) => ({
        tool,
        score: tool.keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0),
      })).filter((item) => item.score > 0).sort((left, right) => (
        right.score - left.score || left.tool.id.localeCompare(right.tool.id)
      ));
      if (ranked.length) {
        selected = registry.get(ranked[0].tool.id);
        selectionReason = 'APPROVED_KEYWORD_MATCH';
      }
    }
    if (!selected && available.length === 1) {
      selected = registry.get(available[0].id);
      selectionReason = 'ONLY_APPROVED_TOOL';
    }
  }
  if (!selected) throw new GovernanceError('APPROVED_TOOL_NOT_FOUND');
  return deepFreeze({
    stage: 'TOOL_PLANNER',
    toolId: selected.id,
    toolKind: selected.kind,
    selectionReason,
    requestedIntent: request.intent || null,
    input: deepClone(request.toolInput || {}),
    reasonCodes: ['APPROVED_TOOL_SELECTED', selectionReason],
  });
}

async function executeApprovedTool(plan, registryOrDefinitions) {
  if (!plan || plan.stage !== 'TOOL_PLANNER') throw new GovernanceError('TOOL_PLAN_INVALID');
  const registry = ensureRegistry(registryOrDefinitions);
  const tool = registry.get(plan.toolId);
  if (!tool || tool.approved !== true) throw new GovernanceError('TOOL_NOT_APPROVED');
  if (tool.validateInput) {
    let accepted;
    try {
      accepted = await tool.validateInput(deepClone(plan.input));
    } catch (_error) {
      throw new GovernanceError('TOOL_INPUT_INVALID');
    }
    if (accepted === false) throw new GovernanceError('TOOL_INPUT_INVALID');
  }
  let rawResult;
  try {
    rawResult = await tool.execute(deepClone(plan.input));
  } catch (_error) {
    throw new GovernanceError('APPROVED_TOOL_EXECUTION_FAILED');
  }
  return validateApprovedToolResult(tool, rawResult);
}

function renderValidatedExplanation(draft, validatedToolResult) {
  if (!validatedToolResult || validatedToolResult.validation?.status !== 'PASSED') {
    throw new GovernanceError('VALIDATED_TOOL_RESULT_REQUIRED');
  }
  const normalizedDraft = typeof draft === 'string' ? { segments: [{ type: 'text', text: draft }] } : draft;
  if (!normalizedDraft || typeof normalizedDraft !== 'object' || !Array.isArray(normalizedDraft.segments)) {
    throw new GovernanceError('EXPLANATION_DRAFT_INVALID');
  }
  const numbers = new Map(validatedToolResult.importantNumbers.map((item) => [item.id, item]));
  const facts = new Map(validatedToolResult.approvedFacts.map((item) => [item.id, item]));
  const rendered = [];
  const numericClaims = [];
  const usedFacts = [];
  for (const segment of normalizedDraft.segments) {
    if (!segment || typeof segment !== 'object') throw new GovernanceError('EXPLANATION_SEGMENT_INVALID');
    if (segment.type === 'text') {
      const text = String(segment.text || '');
      if (containsNumericToken(text)) {
        throw new GovernanceError(
          'UNVALIDATED_NUMERIC_CLAIM',
          'Numeric text must reference a validated important number'
        );
      }
      rendered.push(text);
    } else if (segment.type === 'number') {
      const number = numbers.get(segment.numberId);
      if (!number) throw new GovernanceError('UNVALIDATED_NUMERIC_CLAIM');
      const display = `${number.value} ${number.unit}`;
      rendered.push(display);
      numericClaims.push({ ...deepClone(number), display });
    } else if (segment.type === 'fact') {
      const fact = facts.get(segment.factId);
      if (!fact) throw new GovernanceError('UNAPPROVED_PRODUCT_FACT');
      rendered.push(fact.text);
      usedFacts.push(deepClone(fact));
    } else {
      throw new GovernanceError('EXPLANATION_SEGMENT_TYPE_INVALID');
    }
  }
  const text = rendered.join('');
  if (!text.trim()) throw new GovernanceError('EXPLANATION_EMPTY');
  const sourceRefs = [...new Set([
    ...numericClaims.flatMap((item) => item.sourceRefs),
    ...usedFacts.flatMap((item) => item.sourceRefs),
  ])].sort();
  return deepFreeze({
    text,
    language: normalizedDraft.language || 'th-TH',
    qualitativeOnly: numericClaims.length === 0,
    numericClaims,
    approvedFacts: usedFacts,
    sourceRefs,
    validationId: validatedToolResult.validation.validationId,
    status: 'VALIDATED_EXPLANATION',
  });
}

function buildRmDecisionGate() {
  return deepFreeze({
    required: true,
    status: 'PENDING_HUMAN_REVIEW',
    allowedDecisions: [...RM_DECISIONS],
    canAutoApprove: false,
    canAutoSend: false,
    canAutoTrade: false,
    canEditKyc: false,
    canEditSuitability: false,
    canInventProductFacts: false,
    nextActorRole: 'RM',
  });
}

async function runControlledAiWorkflow(options = {}) {
  const request = options.request;
  const registry = ensureRegistry(options.registry || options.tools);
  const plan = planApprovedTool(request, registry);
  const validatedToolResult = await executeApprovedTool(plan, registry);
  let draft;
  if (typeof options.explanationBuilder === 'function') {
    draft = await options.explanationBuilder(deepFreeze({
      request: deepClone(request),
      plan: deepClone(plan),
      validatedToolResult,
    }));
  } else {
    draft = options.explanationDraft;
  }
  const explanation = renderValidatedExplanation(draft, validatedToolResult);
  const rmDecision = buildRmDecisionGate();
  const workflowId = `aiwf_${stableHash({
    request,
    plan,
    validationId: validatedToolResult.validation.validationId,
    explanation,
  }).slice(0, 24)}`;
  return deepFreeze({
    workflowId,
    pipeline: [...PIPELINE_STAGES],
    stages: [
      { stage: 'TRIGGER_OR_QUESTION', status: 'ACCEPTED' },
      { stage: 'TOOL_PLANNER', status: 'APPROVED', toolId: plan.toolId },
      { stage: 'APPROVED_TOOL', status: 'COMPLETED', toolId: plan.toolId },
      { stage: 'VALIDATOR', status: 'PASSED', validationId: validatedToolResult.validation.validationId },
      { stage: 'AI_EXPLANATION', status: 'VALIDATED' },
      { stage: 'RM_DECISION', status: 'PENDING_HUMAN_REVIEW' },
    ],
    plan,
    validatedToolResult,
    explanation,
    rmDecision,
    prohibitedCapabilities: Object.keys(PROHIBITED_CAPABILITIES),
  });
}

function recordHumanRmDecision(workflow, input = {}) {
  if (!workflow || workflow.rmDecision?.status !== 'PENDING_HUMAN_REVIEW') {
    throw new GovernanceError('RM_DECISION_GATE_NOT_OPEN');
  }
  const actor = input.actor;
  if (!actor || actor.isHuman !== true || String(actor.role || '').toUpperCase() !== 'RM') {
    throw new GovernanceError('HUMAN_RM_REQUIRED');
  }
  const decision = String(input.decision || '').toUpperCase();
  if (!RM_DECISIONS.includes(decision)) throw new GovernanceError('RM_DECISION_NOT_ALLOWED');
  if (!nonEmptyString(input.reason)) throw new GovernanceError('RM_DECISION_REASON_REQUIRED');
  if (!nonEmptyString(input.at) || !Number.isFinite(Date.parse(input.at))) {
    throw new GovernanceError('RM_DECISION_TIMESTAMP_REQUIRED');
  }
  return deepFreeze({
    workflowId: workflow.workflowId,
    decision: {
      decision,
      actor: deepClone(actor),
      reason: input.reason.trim(),
      at: input.at,
      status: 'RECORDED_BY_HUMAN_RM',
    },
    sent: false,
    traded: false,
    kycEdited: false,
    suitabilityEdited: false,
    nextManualStep: decision === 'APPROVE_DRAFT' ? 'RM_MAY_USE_APPROVED_CHANNEL_OUTSIDE_AI' : 'FOLLOW_RECORDED_DECISION',
  });
}

module.exports = {
  PIPELINE_STAGES,
  TOOL_KINDS,
  ALLOWED_CAPABILITIES,
  PROHIBITED_CAPABILITIES,
  REQUIRED_IMPORTANT_NUMBER_FIELDS,
  RM_DECISIONS,
  GovernanceError,
  stableHash,
  isCapabilityProhibited,
  assertCapabilityAllowed,
  assertNoProhibitedCapabilities,
  validateImportantNumber,
  validateApprovedFact,
  validateApprovedToolResult,
  createApprovedToolRegistry,
  planApprovedTool,
  executeApprovedTool,
  renderValidatedExplanation,
  buildRmDecisionGate,
  runControlledAiWorkflow,
  recordHumanRmDecision,
};
