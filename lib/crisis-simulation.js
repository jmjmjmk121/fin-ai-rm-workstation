'use strict';

// Deterministic synthetic-book simulation for demonstrating an RM surge day.
// It is intentionally not a bank KPI forecast.  The contact model below is a
// real fitted logistic regression, but it is trained and validated on synthetic
// observations so the UI must label it as a prototype ML component.

const MIN_AUM = 2_000_000;
const MAX_AUM = 50_000_000;
const RM_MINUTES_PER_DAY = 360;
const MANUAL_SCAN_MINUTES = 1.2;
const MANUAL_CALL_MINUTES = 12;
const AI_ASSISTED_CALL_MINUTES = 10;
const AI_MESSAGE_REVIEW_MINUTES = 1.2;
const AI_MONITOR_REVIEW_MINUTES = 0.08;
const MAX_SYNTHETIC_CLIENTS = 10_000;
const MAX_SYNTHETIC_RMS = 100;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function sigmoid(value) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function dot(a, b) {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function aucScore(rows, scores) {
  const ranked = rows.map((row, index) => ({ label: row.label, score: scores[index] }))
    .sort((a, b) => a.score - b.score);
  let rankSum = 0;
  let positives = 0;
  let negatives = 0;
  ranked.forEach((item, index) => {
    if (item.label) { positives += 1; rankSum += index + 1; } else negatives += 1;
  });
  if (!positives || !negatives) return null;
  return (rankSum - positives * (positives + 1) / 2) / (positives * negatives);
}

function syntheticTrainingRows(count = 5000, seed = 20260715) {
  const random = seededRandom(seed);
  const hidden = [-3.25, 4.4, 0.7, 1.0, 1.25, 0.7, 1.45, 0.95, 0.35];
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const features = [
      1,
      random(), // portfolio loss, scaled to 0..30%
      random(), // log AUM percentile
      random(), // days since last contact
      random(), // suitability / actual-risk mismatch
      random(), // digital engagement
      random(), // behavioural loss aversion
      random() < 0.08 ? 1 : 0, // complaint history
      random() < 0.20 ? 1 : 0, // high relationship value
    ];
    const probability = sigmoid(dot(hidden, features));
    rows.push({ features, label: random() < probability ? 1 : 0 });
  }
  return rows;
}

let fittedModel;

function trainContactModel() {
  if (fittedModel) return fittedModel;
  const rows = syntheticTrainingRows();
  const split = 4000;
  const training = rows.slice(0, split);
  const validation = rows.slice(split);
  const weights = Array(training[0].features.length).fill(0);
  const learningRate = 0.45;
  const l2 = 0.01;
  for (let epoch = 0; epoch < 260; epoch += 1) {
    const gradient = Array(weights.length).fill(0);
    for (const row of training) {
      const error = sigmoid(dot(weights, row.features)) - row.label;
      row.features.forEach((value, index) => { gradient[index] += error * value; });
    }
    weights.forEach((weight, index) => {
      const penalty = index === 0 ? 0 : l2 * weight;
      weights[index] -= learningRate * (gradient[index] / training.length + penalty);
    });
  }
  const validationScores = validation.map((row) => sigmoid(dot(weights, row.features)));
  fittedModel = {
    weights,
    validationAuc: aucScore(validation, validationScores),
    trainingRows: training.length,
    validationRows: validation.length,
    status: 'logistic regression fitted on deterministic synthetic observations; prototype only',
  };
  return fittedModel;
}

function generateClient(index, random, riskyAssetShock, model) {
  const aumPercentile = random();
  const aum = Math.exp(Math.log(MIN_AUM) + aumPercentile * Math.log(MAX_AUM / MIN_AUM));
  const riskLevel = 2 + Math.floor(random() * 7);
  const targetRiskShare = 0.12 + (riskLevel - 2) / 6 * 0.70;
  const riskyAssetShare = index === 0 ? 0.75 : clamp(targetRiskShare + (random() - 0.5) * 0.28, 0.08, 0.88);
  const lossRate = clamp(Math.abs(riskyAssetShock) * riskyAssetShare, 0, 0.40);
  const riskCapacity = clamp((riskLevel - 1) / 7, 0, 1);
  const riskMismatch = clamp(Math.max(0, riskyAssetShare - riskCapacity) * 2.1, 0, 1);
  const daysSinceContact = Math.floor(random() * 365);
  const digitalEngagement = random();
  const lossAversion = random();
  const complaintHistory = random() < 0.07 ? 1 : 0;
  const highRelationshipValue = aum >= 20_000_000 ? 1 : 0;
  const features = [
    1,
    clamp(lossRate / 0.30, 0, 1),
    aumPercentile,
    daysSinceContact / 365,
    riskMismatch,
    digitalEngagement,
    lossAversion,
    complaintHistory,
    highRelationshipValue,
  ];
  const contactProbability = sigmoid(dot(model.weights, features));
  const mandatory = complaintHistory === 1 && random() < 0.24;
  const harmBand = lossRate >= 0.18 || riskMismatch >= 0.72 ? 3
    : lossRate >= 0.10 || riskMismatch >= 0.45 ? 2
      : lossRate >= 0.06 ? 1 : 0;
  const channel = mandatory || harmBand === 3 || contactProbability >= 0.80 ? 'call'
    : harmBand >= 1 || contactProbability >= 0.43 ? 'message' : 'monitor';
  return {
    id: `SIM-${String(index + 1).padStart(4, '0')}`,
    name: index === 0 ? 'ลูกค้าตัวอย่าง − ถือสินทรัพย์เสี่ยง 75%' : `ลูกค้าสาธิต ${String(index + 1).padStart(4, '0')}`,
    aumBaht: Math.round(aum),
    riskLevel,
    riskyAssetShare,
    lossRate,
    lossBaht: Math.round(aum * lossRate),
    daysSinceContact,
    riskMismatch,
    contactProbability,
    predictedInboundContact: mandatory || contactProbability >= 0.50,
    mandatory,
    harmBand,
    channel,
  };
}

function summarizeChannels(clients) {
  return {
    calls: clients.filter((client) => client.channel === 'call').length,
    messages: clients.filter((client) => client.channel === 'message').length,
    monitoring: clients.filter((client) => client.channel === 'monitor').length,
  };
}

function simulateCrisisBook(options = {}) {
  const requestedClients = Number(options.clientCount ?? 3000);
  const requestedRms = Number(options.rmCount ?? 20);
  const requestedShock = Number(options.riskyAssetShock ?? -0.25);
  const clientCount = Math.round(clamp(Number.isFinite(requestedClients) ? requestedClients : 3000, 100, MAX_SYNTHETIC_CLIENTS));
  const rmCount = Math.round(clamp(Number.isFinite(requestedRms) ? requestedRms : 20, 1, MAX_SYNTHETIC_RMS));
  const riskyAssetShock = clamp(Number.isFinite(requestedShock) ? requestedShock : -0.25, -0.35, -0.03);
  // Staffing and shock sliders must not silently generate a different client
  // book.  Holding the synthetic book fixed makes headcount/severity sensitivity
  // comparisons interpretable.
  const random = seededRandom(20260715 + clientCount * 17);
  const model = trainContactModel();
  const clients = Array.from({ length: clientCount }, (_, index) => generateClient(index, random, riskyAssetShock, model));
  clients.forEach((client, index) => {
    const rmNumber = index % rmCount + 1;
    client.rmId = `RM-${String(rmNumber).padStart(3, '0')}`;
    client.rmName = `RM สาธิต ${String(rmNumber).padStart(3, '0')}`;
  });
  const contacting = clients.filter((client) => client.predictedInboundContact);
  const affected = clients.filter((client) => client.lossRate >= 0.08);
  const channelMix = summarizeChannels(clients);
  const capacityMinutes = rmCount * RM_MINUTES_PER_DAY;

  const manualQueueMinutes = clientCount * MANUAL_SCAN_MINUTES + contacting.length * MANUAL_CALL_MINUTES;

  const assistedQueueMinutes = channelMix.calls * AI_ASSISTED_CALL_MINUTES
    + channelMix.messages * AI_MESSAGE_REVIEW_MINUTES
    + channelMix.monitoring * AI_MONITOR_REVIEW_MINUTES;
  const totalAum = clients.reduce((sum, client) => sum + client.aumBaht, 0);
  const affectedAum = affected.reduce((sum, client) => sum + client.aumBaht, 0);
  const rmRoster = Array.from({ length: rmCount }, (_, index) => ({
    rmId: `RM-${String(index + 1).padStart(3, '0')}`,
    rmName: `RM สาธิต ${String(index + 1).padStart(3, '0')}`,
    clientCount: 0, expectedContacts: 0, calls: 0, messages: 0, monitoring: 0,
    manualQueueMinutes: 0, assistedQueueMinutes: 0, aumBaht: 0,
  }));
  for (const client of clients) {
    const row = rmRoster[Number(client.rmId.slice(3)) - 1];
    row.clientCount += 1;
    row.expectedContacts += client.predictedInboundContact ? 1 : 0;
    row.calls += client.channel === 'call' ? 1 : 0;
    row.messages += client.channel === 'message' ? 1 : 0;
    row.monitoring += client.channel === 'monitor' ? 1 : 0;
    row.manualQueueMinutes += MANUAL_SCAN_MINUTES + (client.predictedInboundContact ? MANUAL_CALL_MINUTES : 0);
    row.assistedQueueMinutes += client.channel === 'call' ? AI_ASSISTED_CALL_MINUTES
      : client.channel === 'message' ? AI_MESSAGE_REVIEW_MINUTES : AI_MONITOR_REVIEW_MINUTES;
    row.aumBaht += client.aumBaht;
  }
  let manualOverCapacityMinutes = 0;
  let assistedOverCapacityMinutes = 0;
  let manualOverloadedRmCount = 0;
  let assistedOverloadedRmCount = 0;
  for (const row of rmRoster) {
    const rawManualMinutes = row.manualQueueMinutes;
    const rawAssistedMinutes = row.assistedQueueMinutes;
    const rawManualOverCapacity = Math.max(0, rawManualMinutes - RM_MINUTES_PER_DAY);
    const rawAssistedOverCapacity = Math.max(0, rawAssistedMinutes - RM_MINUTES_PER_DAY);
    manualOverCapacityMinutes += rawManualOverCapacity;
    assistedOverCapacityMinutes += rawAssistedOverCapacity;
    manualOverloadedRmCount += rawManualOverCapacity > 0 ? 1 : 0;
    assistedOverloadedRmCount += rawAssistedOverCapacity > 0 ? 1 : 0;
    row.manualQueueMinutes = Math.round(rawManualMinutes);
    row.assistedQueueMinutes = Math.round(rawAssistedMinutes);
    row.manualOverCapacityMinutes = Math.round(rawManualOverCapacity);
    row.assistedOverCapacityMinutes = Math.round(rawAssistedOverCapacity);
    row.assistedCapacityUtilization = rawAssistedMinutes / RM_MINUTES_PER_DAY;
    row.aumBaht = Math.round(row.aumBaht);
  }
  const topClients = [...clients].sort((a, b) => {
    if (a.mandatory !== b.mandatory) return a.mandatory ? -1 : 1;
    if (a.harmBand !== b.harmBand) return b.harmBand - a.harmBand;
    if (Math.abs(a.contactProbability - b.contactProbability) > 0.02) return b.contactProbability - a.contactProbability;
    return b.aumBaht - a.aumBaht;
  }).slice(0, 12);

  return {
    generatedAt: new Date().toISOString(),
    status: 'synthetic capacity-planning simulation; not actual bank customers, KPI, or promised impact',
    inputs: { clientCount, rmCount, riskyAssetShock },
    assumptions: {
      customerAumRangeBaht: [MIN_AUM, MAX_AUM],
      rmMinutesPerDay: RM_MINUTES_PER_DAY,
      manualScanMinutesPerClient: MANUAL_SCAN_MINUTES,
      contactMinutesPerCall: MANUAL_CALL_MINUTES,
      aiAssistedCallMinutes: AI_ASSISTED_CALL_MINUTES,
      aiMessageReviewMinutes: AI_MESSAGE_REVIEW_MINUTES,
      note: 'Capacity comparison holds client book and scenario constant. It is a planning calculation, not a causal estimate of real time saved.',
    },
    headline: {
      affectedCount: affected.length,
      contactingCount: contacting.length,
      totalAumBaht: Math.round(totalAum),
      aumRepresentedBaht: Math.round(affectedAum),
      rmCount,
      averageClientsPerRm: clientCount / rmCount,
      affectedLossThreshold: 0.08,
      exampleRiskyAssetShare: clients[0].riskyAssetShare,
      exampleLossRate: clients[0].lossRate,
      exampleLossBaht: clients[0].lossBaht,
      affectedDefinition: 'จำนวนพอร์ตที่ผลขาดทุนจากสถานการณ์จำลองตั้งแต่ 8% ขึ้นไป',
      contactingDefinition: 'จำนวนลูกค้าที่แบบจำลองคาดว่ามีแนวโน้มติดต่อ ไม่ใช่จำนวนสายที่เกิดขึ้นจริง',
    },
    withoutFinAi: {
      calls: contacting.length,
      messages: 0,
      monitoring: clientCount - contacting.length,
      queueMinutes: Math.round(manualQueueMinutes),
      queueOverCapacityMinutes: Math.round(manualOverCapacityMinutes),
      overloadedRmCount: manualOverloadedRmCount,
      missedSlaCount: null,
      capacityUtilization: manualQueueMinutes / capacityMinutes,
      description: 'สมมติ RM ต้องไล่ตรวจทุกพอร์ตและรับสายที่แบบจำลองคาดว่าจะติดต่อเข้ามา',
    },
    withFinAi: {
      ...channelMix,
      queueMinutes: Math.round(assistedQueueMinutes),
      queueOverCapacityMinutes: Math.round(assistedOverCapacityMinutes),
      overloadedRmCount: assistedOverloadedRmCount,
      missedSlaCount: null,
      capacityUtilization: assistedQueueMinutes / capacityMinutes,
      description: 'quant engine คำนวณทุกพอร์ต จากนั้น conduct rules + ML propensity ช่วยจัดคิวและช่องทาง ก่อน LLM ร่างข้อความให้ RM อนุมัติ',
    },
    comparison: {
      queueMinutesDifference: Math.round(manualQueueMinutes - assistedQueueMinutes),
      overCapacityMinutesDifference: Math.round(manualOverCapacityMinutes - assistedOverCapacityMinutes),
      backlogDifference: null,
      note: 'เวลาเกินกำลังคำนวณแยกราย RM แล้วจึงรวม เพื่อไม่ให้เวลาว่างของคนหนึ่งกลบคิวล้นของอีกคน; เป็นผลจากสมมติฐานเวลางานที่แสดง ไม่ใช่ผลลัพธ์จริงหรือรายได้ที่รับประกัน',
    },
    mlModel: {
      type: 'logistic regression',
      target: 'likelihood of client contact within the severe-market scenario',
      features: ['portfolio loss', 'AUM percentile', 'days since contact', 'risk mismatch', 'digital engagement', 'loss aversion', 'complaint history', 'relationship value'],
      trainingRows: model.trainingRows,
      validationRows: model.validationRows,
      syntheticValidationAuc: model.validationAuc,
      status: model.status,
      governance: 'ML ใช้คาดปริมาณการติดต่อเพื่อวางกำลังคน โดยมี AUM และ relationship value เป็นเพียงข้อมูลประกอบ หน้าที่ที่ต้องทำและระดับความเสียหายต่อลูกค้าจะ override คะแนนเสมอ; ภายในชั้นเดียวกันจึงค่อยใช้ propensity และ AUM จัดลำดับ.',
    },
    pipeline: [
      { id: 1, title: 'Quant คำนวณทุกพอร์ต', detail: `ประเมินผลกระทบ ${clientCount.toLocaleString('en-US')} พอร์ตจากน้ำหนักสินทรัพย์และสถานการณ์เดียวกัน` },
      { id: 2, title: 'ML คาดว่าใครมีแนวโน้มติดต่อ', detail: 'logistic regression ให้ propensity เพื่อช่วยจัดกำลังคน ไม่ได้ใช้แทน suitability หรือการตัดสินใจของ RM' },
      { id: 3, title: 'กติกาคุ้มครองลูกค้าจัดช่องทาง', detail: 'หน้าที่และความเสียหายต่อลูกค้ามาก่อน จากนั้นจึงเลือกระหว่างโทร ข้อความส่วนบุคคล หรือเฝ้าดู' },
      { id: 4, title: 'LLM ร่างคำอธิบายจากข้อเท็จจริง', detail: 'เรียกผลจาก quant/ML และแหล่งข้อมูลที่อนุญาต ไม่คำนวณเลขเองและไม่แต่งข้อมูล' },
      { id: 5, title: 'RM อนุมัติและระบบบันทึก', detail: 'ไม่มีการส่งข้อความ ซื้อขาย หรือส่งต่อผู้เชี่ยวชาญโดยไม่ผ่านคนและ audit log' },
    ],
    rmRoster: [...rmRoster].sort((a, b) => b.assistedQueueMinutes - a.assistedQueueMinutes || a.rmId.localeCompare(b.rmId)),
    topClients,
  };
}

module.exports = {
  simulateCrisisBook,
  trainContactModel,
  syntheticTrainingRows,
  MAX_SYNTHETIC_CLIENTS,
  MAX_SYNTHETIC_RMS,
};
