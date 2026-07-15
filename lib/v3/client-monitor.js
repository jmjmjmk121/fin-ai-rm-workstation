'use strict';

const CLIENT_MONITOR_COLUMNS = Object.freeze([
  'client',
  'rmOwner',
  'aum',
  'availableLiquidity',
  'mainGoal',
  'whyNow',
  'priorityTier',
  'channel',
  'dueAt',
  'readinessBlocker',
  'openCase',
]);

const SAVED_CLIENT_VIEWS = Object.freeze([
  'ต้องติดต่อวันนี้',
  'AUM สูงและมีสภาพคล่อง',
  'เป้าหมายใกล้ถึงกำหนด',
  'พอร์ตเกินกรอบ',
  'KYC/บัญชียังไม่พร้อม',
  'รอผู้เชี่ยวชาญ',
  'ยังไม่ควรติดต่อ',
]);

const SAVED_VIEW_IDS = Object.freeze({
  'ต้องติดต่อวันนี้': 'contact-today',
  'AUM สูงและมีสภาพคล่อง': 'high-aum-liquidity',
  'เป้าหมายใกล้ถึงกำหนด': 'goal-due',
  'พอร์ตเกินกรอบ': 'risk-breach',
  'KYC/บัญชียังไม่พร้อม': 'not-ready',
  'รอผู้เชี่ยวชาญ': 'handoff',
  'ยังไม่ควรติดต่อ': 'no-contact',
});

const PRIORITY_VALUE = Object.freeze({ P0: 4, P1: 3, P2: 2, P3: 1 });
const CHANNEL_CAPACITY_VALUE = Object.freeze({
  CONFIRM_DATA: 6,
  CALL: 5,
  MEETING: 4,
  HANDOFF: 3,
  REVIEWED_MESSAGE: 2,
  NO_ACTION: 0,
});
const FINAL_STATES = new Set(['COMPLETED', 'DISMISSED', 'EXPIRED_OR_CANCELLED']);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isoTimestamp(value, fallback = null) {
  if (!value) return fallback;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateOnly(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function availableLiquidity(client) {
  return (client.holdings || []).reduce((sum, holding) => {
    const label = `${holding.assetClass || ''} ${holding.name || holding.nameTh || ''}`.toUpperCase();
    const liquid = /MONEY_MARKET|CASH|เงินพร้อมใช้|ตลาดเงิน/.test(label);
    return sum + (liquid ? finite(holding.value) : 0);
  }, 0);
}

function selectGoal(client, action) {
  const goals = Array.isArray(client.goals) ? client.goals : [];
  const affected = new Set(Array.isArray(action && action.affectedGoalIds) ? action.affectedGoalIds : []);
  return goals.find((goal) => affected.has(goal.goalId))
    || goals.find((goal) => goal.type !== 'EMERGENCY_RESERVE')
    || goals[0]
    || null;
}

function goalIsDueSoon(goal, asOf) {
  const targetDate = goal && dateOnly(goal.targetDate);
  const asOfDate = dateOnly(asOf);
  if (!targetDate || !asOfDate) return false;
  const days = (new Date(`${targetDate}T00:00:00Z`) - new Date(`${asOfDate}T00:00:00Z`)) / 86_400_000;
  return days >= 0 && days <= 3 * 365.25;
}

function riskBreach(client, action) {
  const reasonText = [...(action && action.reasonCodes || []), action && action.whyNow || ''].join(' ').toUpperCase();
  if (/RISK_BREACH|SUITABILITY_BREACH|เสี่ยงเกินกรอบ|พอร์ตเกินกรอบ/.test(reasonText)) return true;
  const total = finite(client.portfolio && client.portfolio.endBalance)
    || (client.holdings || []).reduce((sum, holding) => sum + finite(holding.value), 0);
  if (total <= 0) return false;
  const risky = (client.holdings || []).reduce((sum, holding) => {
    const label = `${holding.assetClass || ''} ${holding.name || holding.nameTh || ''}`.toUpperCase();
    return sum + (/EQUITY|หุ้น|สินทรัพย์ต่างประเทศ/.test(label) ? finite(holding.value) : 0);
  }, 0);
  return risky / total > 0.65 && action && action.lane === 'CARE';
}

function readinessBlocker(action) {
  const missing = Array.isArray(action && action.dataGate && action.dataGate.missing)
    ? action.dataGate.missing
    : Array.isArray(action && action.missingData) ? action.missingData : [];
  const first = missing[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object') return first.whatIsMissing || first.label || first.key || 'ข้อมูลสำคัญยังไม่พร้อม';
  if (action && (action.channel === 'CONFIRM_DATA' || action.state === 'CONFIRM_DATA')) return 'ต้องยืนยัน KYC / ความเหมาะสม';
  return null;
}

function inferredPriority(action, flags) {
  if (PRIORITY_VALUE[action && action.priorityTier]) return action.priorityTier;
  if (flags.mandatoryCare) return 'P0';
  if (flags.lane === 'CARE' && (flags.blocker || flags.riskBreach || flags.goalDueSoon || flags.channel === 'HANDOFF')) return 'P1';
  if (flags.lane === 'CARE' || flags.channel !== 'NO_ACTION') return 'P2';
  return 'P3';
}

function inferredChannel(client, action, blocker) {
  if (blocker) return 'CONFIRM_DATA';
  if (action && action.channel) return action.channel;
  const contact = client.contact || {};
  if (finite(contact.contacts7Days) >= finite(contact.maxContacts7Days, 2)
    || finite(contact.contacts30Days) >= finite(contact.maxContacts30Days, 5)
    || finite(contact.declinedContacts30Days) >= 2
    || contact.campaignOverlap) return 'NO_ACTION';
  if (action && ['PROTECTION', 'LENDING'].includes(action.domain)) return 'HANDOFF';
  return contact.preferredChannel || (action && action.lane === 'GROWTH' ? 'REVIEWED_MESSAGE' : 'CALL');
}

function dueAtFor(client, action, goal, index, asOf) {
  if (action && action.dueAt) return action.dueAt;
  const reviewDate = dateOnly(goal && goal.nextReview);
  if (reviewDate) return `${reviewDate}T17:00:00+07:00`;
  const base = new Date(`${dateOnly(asOf) || '2026-07-15'}T10:00:00+07:00`);
  base.setUTCDate(base.getUTCDate() + 2 + (index % 12));
  return base.toISOString();
}

function createClientMonitorRows(demoBook, options = {}) {
  if (!demoBook || !Array.isArray(demoBook.clients) || !Array.isArray(demoBook.actions)) {
    throw new TypeError('demoBook clients and actions are required');
  }
  const clientIds = new Set();
  for (const client of demoBook.clients) {
    if (clientIds.has(client.clientId)) throw new Error(`duplicate clientId: ${client.clientId}`);
    clientIds.add(client.clientId);
  }
  const actionIds = new Set();
  for (const action of demoBook.actions) {
    if (actionIds.has(action.actionId)) throw new Error(`duplicate actionId: ${action.actionId}`);
    actionIds.add(action.actionId);
  }
  const asOf = options.asOf || demoBook.metadata && demoBook.metadata.asOf || '2026-07-15';
  const actionByClient = new Map();
  for (const action of demoBook.actions) {
    const current = actionByClient.get(action.clientId);
    if (!current || (FINAL_STATES.has(current.state) && !FINAL_STATES.has(action.state))) actionByClient.set(action.clientId, action);
  }
  const rows = demoBook.clients.map((client, index) => {
    const action = actionByClient.get(client.clientId) || {};
    const goal = selectGoal(client, action);
    const blocker = readinessBlocker(action);
    const goalDueSoon = goalIsDueSoon(goal, asOf);
    const breached = riskBreach(client, action);
    const channel = inferredChannel(client, action, blocker);
    const lane = action.lane || 'CARE';
    const mandatoryCare = Boolean(action.mandatoryCare || (lane === 'CARE' && (blocker || breached)));
    const priorityTier = inferredPriority(action, { mandatoryCare, lane, blocker, goalDueSoon, riskBreach: breached, channel });
    const dueAt = dueAtFor(client, action, goal, index, asOf);
    const aum = finite(client.portfolio && client.portfolio.endBalance)
      || (client.holdings || []).reduce((sum, holding) => sum + finite(holding.value), 0);
    const latestFlow = [...(client.cashFlows || [])].sort((left, right) => String(right.date).localeCompare(String(left.date)))[0];
    const whyNow = action.whyNow
      || (channel === 'NO_ACTION'
        ? 'ยังไม่ควรติดต่อ เพราะถึงเพดานการติดต่อแล้วหรือลูกค้าเพิ่งปฏิเสธ'
        : `${lane === 'CARE' ? 'ควรตรวจ' : 'ทบทวน'}${goal ? goal.name : 'เป้าหมายหลัก'}ตามรอบ โดยยังไม่มีเหตุให้เร่งขายผลิตภัณฑ์`);
    const contact = client.contact || {};
    const benefitUrgencyScore = (lane === 'CARE' ? 100 : 0)
      + (PRIORITY_VALUE[priorityTier] || 0) * 10
      + (breached ? 8 : 0)
      + (blocker ? 7 : 0)
      + (dueAt.slice(0, 10) <= dateOnly(asOf) ? 5 : 0)
      - (channel === 'NO_ACTION' ? 120 : 0);
    const goalImpactScore = (goalDueSoon ? 40 : 0)
      + Math.round((1 - finite(goal && goal.stressSuccessProbability, 1)) * 20)
      + Math.round((1 - Math.min(1, finite(goal && goal.fundedRatio, 1))) * 20);
    const contactFatigue = channel === 'NO_ACTION';
    const rankingEvidence = Object.freeze({
      mandatoryCare,
      benefitUrgency: benefitUrgencyScore,
      goalImpact: goalImpactScore,
      channelCapacity: CHANNEL_CAPACITY_VALUE[channel] || 0,
      businessValue: Object.freeze({ aum, availableLiquidity: availableLiquidity(client) }),
      supportingScoreUsedForOrder: false,
    });
    return Object.freeze({
      clientId: client.clientId,
      clientRef: client.displayRef,
      name: client.name,
      clientName: client.name,
      rmId: client.rmId,
      rmOwner: client.owner,
      aum,
      availableLiquidity: availableLiquidity(client),
      mainGoal: goal && goal.name || 'ยังไม่ยืนยันเป้าหมาย',
      mainGoalId: goal && goal.goalId || null,
      mainGoalTargetDate: goal && goal.targetDate || null,
      whyNow,
      priorityTier,
      channel,
      suggestedChannel: channel,
      dueAt,
      readinessBlocker: blocker,
      dataReady: !blocker,
      readinessStatus: blocker ? 'BLOCKED' : 'READY',
      actionId: action.actionId || null,
      openCase: Boolean(action.actionId),
      actionState: action.state || 'ELIGIBLE',
      recentTransactionActivity: isoTimestamp(latestFlow && latestFlow.date, 0),
      recentTransactionAt: latestFlow && latestFlow.date || null,
      goalDueSoon,
      riskBreach: breached,
      lastContactAt: contact.lastContactAt || null,
      contactCount7Days: finite(contact.contacts7Days),
      contactCount30Days: finite(contact.contacts30Days),
      declinedContacts30Days: finite(contact.declinedContacts30Days),
      contactFatigue,
      lane,
      mandatoryCare,
      benefitUrgencyScore,
      goalImpactScore,
      channelCapacityScore: CHANNEL_CAPACITY_VALUE[channel] || 0,
      businessValue: aum,
      supportingScore: Number.isFinite(Number(action.supportingScore)) ? Number(action.supportingScore) : null,
      supportingScoreUsedForOrder: false,
      rankingEvidence,
      dataMode: client.dataMode || 'FIXTURE',
      dataLabel: client.dataLabel || demoBook.metadata && demoBook.metadata.dataLabel || 'ข้อมูลสาธิต',
      asOf,
    });
  });
  return Object.freeze(rows);
}

function rankClientMonitorRows(rows) {
  return [...rows].sort((left, right) => {
    const leftEvidence = left.rankingEvidence || {};
    const rightEvidence = right.rankingEvidence || {};
    const businessValue = (row, evidence) => {
      if (evidence.businessValue && typeof evidence.businessValue === 'object') {
        return finite(evidence.businessValue.aum) + finite(evidence.businessValue.availableLiquidity);
      }
      return finite(evidence.businessValue, finite(row.businessValue));
    };
    const factors = [
      [Boolean(leftEvidence.mandatoryCare ?? left.mandatoryCare), Boolean(rightEvidence.mandatoryCare ?? right.mandatoryCare)],
      [finite(leftEvidence.benefitUrgency, finite(left.benefitUrgencyScore)), finite(rightEvidence.benefitUrgency, finite(right.benefitUrgencyScore))],
      [finite(leftEvidence.goalImpact, finite(left.goalImpactScore)), finite(rightEvidence.goalImpact, finite(right.goalImpactScore))],
      [finite(leftEvidence.channelCapacity, finite(left.channelCapacityScore)), finite(rightEvidence.channelCapacity, finite(right.channelCapacityScore))],
      [businessValue(left, leftEvidence), businessValue(right, rightEvidence)],
    ];
    for (const [leftValue, rightValue] of factors) {
      if (leftValue === rightValue) continue;
      return leftValue > rightValue ? -1 : 1;
    }
    return String(left.clientRef).localeCompare(String(right.clientRef), 'th');
  });
}

function sortClientMonitorRows(rows, options = {}) {
  const key = ({ lastContact: 'lastContactAt', contactCount: 'contactCount30Days', dataReadiness: 'dataReady' })[options.key] || options.key || 'ranking';
  const direction = options.direction === 'asc' ? 1 : -1;
  if (key === 'ranking') {
    const ranked = rankClientMonitorRows(rows);
    return direction === -1 ? ranked : ranked.reverse();
  }
  const dateKeys = new Set(['dueAt', 'lastContactAt']);
  const booleanKeys = new Set(['goalDueSoon', 'riskBreach', 'dataReady']);
  return rows.map((row, index) => ({ row, index })).sort((leftEntry, rightEntry) => {
    const left = leftEntry.row;
    const right = rightEntry.row;
    let leftValue = left[key];
    let rightValue = right[key];
    if (dateKeys.has(key)) {
      leftValue = isoTimestamp(leftValue, Number.MAX_SAFE_INTEGER);
      rightValue = isoTimestamp(rightValue, Number.MAX_SAFE_INTEGER);
    } else if (booleanKeys.has(key)) {
      leftValue = leftValue ? 1 : 0;
      rightValue = rightValue ? 1 : 0;
    } else if (key !== 'rmOwner') {
      leftValue = finite(leftValue);
      rightValue = finite(rightValue);
    }
    const compared = typeof leftValue === 'string'
      ? leftValue.localeCompare(String(rightValue), 'th')
      : leftValue - rightValue;
    return compared === 0 ? leftEntry.index - rightEntry.index : compared * direction;
  }).map((entry) => entry.row);
}

function filterClientMonitorRows(rows, filters = {}) {
  const query = String(filters.query || '').trim().toLocaleLowerCase('th-TH');
  return rows.filter((row) => {
    const searchable = [row.name, row.clientRef, row.rmOwner, row.mainGoal, row.whyNow].join(' ').toLocaleLowerCase('th-TH');
    const readinessMatch = !filters.readiness || filters.readiness === 'all'
      || (filters.readiness === 'ready' ? row.dataReady : !row.dataReady);
    return (!query || searchable.includes(query))
      && (!filters.rmOwner || filters.rmOwner === 'all' || row.rmOwner === filters.rmOwner)
      && readinessMatch
      && (!filters.priorityTier || row.priorityTier === filters.priorityTier)
      && (!filters.dataReadiness || row.readinessStatus === filters.dataReadiness)
      && (filters.openCase === undefined || row.openCase === Boolean(filters.openCase))
      && (filters.goalDueSoon === undefined || row.goalDueSoon === Boolean(filters.goalDueSoon))
      && (filters.riskBreach === undefined || row.riskBreach === Boolean(filters.riskBreach));
  });
}

function applySavedClientView(rows, viewName, options = {}) {
  const normalizedViewName = SAVED_VIEW_IDS[viewName] || viewName;
  const asOf = dateOnly(options.asOf) || rows[0] && dateOnly(rows[0].asOf) || '2026-07-15';
  const aumThreshold = finite(options.aumThreshold, median(rows.map((row) => finite(row.aum))));
  const liquidityThreshold = finite(options.liquidityThreshold, median(rows.map((row) => finite(row.availableLiquidity))));
  if (!normalizedViewName || normalizedViewName === 'all') return [...rows];
  if (normalizedViewName === 'contact-today') return rows.filter((row) => row.channel !== 'NO_ACTION' && (['P0', 'P1'].includes(row.priorityTier) || dateOnly(row.dueAt) <= asOf));
  if (normalizedViewName === 'high-aum-liquidity') return rows.filter((row) => row.aum >= aumThreshold && row.availableLiquidity >= liquidityThreshold);
  if (normalizedViewName === 'goal-due') return rows.filter((row) => row.goalDueSoon);
  if (normalizedViewName === 'risk-breach') return rows.filter((row) => row.riskBreach);
  if (normalizedViewName === 'not-ready') return rows.filter((row) => !row.dataReady || Boolean(row.readinessBlocker));
  if (normalizedViewName === 'handoff') return rows.filter((row) => row.channel === 'HANDOFF' || row.actionState === 'SCHEDULED_OR_HANDOFF');
  if (normalizedViewName === 'no-contact') return rows.filter((row) => row.channel === 'NO_ACTION' || row.contactFatigue);
  throw new RangeError(`unknown saved view: ${viewName}`);
}

function buildClientMonitor(demoBook, options = {}) {
  const rows = createClientMonitorRows(demoBook, options);
  return Object.freeze({
    asOf: options.asOf || demoBook.metadata && demoBook.metadata.asOf,
    dataMode: 'FIXTURE',
    dataLabel: demoBook.metadata && demoBook.metadata.dataLabel || 'ข้อมูลสาธิต (Fixture/Demo)',
    rankingPolicy: Object.freeze([
      'MANDATORY_CARE',
      'CLIENT_BENEFIT_URGENCY',
      'GOAL_IMPACT',
      'CHANNEL_CAPACITY',
      'BUSINESS_VALUE',
    ]),
    supportingScoreIsPrimary: false,
    columns: CLIENT_MONITOR_COLUMNS,
    savedViews: SAVED_CLIENT_VIEWS,
    rows: Object.freeze(rankClientMonitorRows(rows)),
  });
}

module.exports = {
  CLIENT_MONITOR_COLUMNS,
  SAVED_CLIENT_VIEWS,
  createClientMonitorRows,
  rankClientMonitorRows,
  sortClientMonitorRows,
  filterClientMonitorRows,
  applySavedClientView,
  buildClientMonitor,
};
