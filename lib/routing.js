const RM_TEAM = [
  { id: "RM-01", name: "คุณพลอย" },
  { id: "RM-02", name: "คุณภูมิ" },
  { id: "RM-03", name: "คุณนิดา" },
];

const RM_CAPACITY = 3; // concurrent calls one RM can hold

function inboundIntent(a) {
  if (a.panicRisk) return "กังวลข่าว อยากขายหนี";
  if ((a.fundedRatio ?? 1) < 0.9) return "ถามว่ายังไปถึงเป้าไหม";
  if (a.vol > (a.srlMaxVol || 1)) return "พอร์ตเสี่ยงเกิน อยากปรับ";
  return "ขออัปเดตพอร์ต";
}
// Grounded auto-reply (info-only). Anything material still needs the RM to approve/act.

function aiAssistAnswer(client) {
  const a = client.analysis, first = client.name.split(" ")[0], drv = a.topRiskDriver || { symbol: "" };
  if (a.panicRisk)
    return `เรียนคุณ ${first} ค่ะ FIN AI ช่วยตอบเบื้องต้น: พอร์ตได้รับผลจากข่าววันนี้บางส่วน (${drv.symbol}) แต่เป้าหมายระยะยาวยังไม่เปลี่ยน RM จะโทรกลับเพื่อทบทวนทางเลือกอย่างละเอียด ระหว่างนี้ยังไม่แนะนำให้ตัดสินใจขายเร่งด่วนค่ะ`;
  if ((a.fundedRatio ?? 1) < 0.9)
    return `เรียนคุณ ${first} ค่ะ จากการตรวจล่าสุด แผนของคุณอยู่ที่ราว ${Math.round((a.fundedRatio || 0) * 100)}% ของเป้า ยังปรับให้เข้าเป้าได้ RM จะติดต่อกลับพร้อมตัวเลขทางเลือกค่ะ`;
  return `เรียนคุณ ${first} ค่ะ พอร์ตของคุณยังอยู่ในแผนและกรอบความเสี่ยงที่เหมาะสม หากต้องการรายละเอียดเพิ่มเติม RM จะติดต่อกลับโดยเร็วค่ะ`;
}

function buildInbound(rankedClients) {
  const callers = rankedClients
    .filter((c) => c.analysis.panicRisk || c.analysis.behavioralPressure >= 0.45 || (c.analysis.fundedRatio ?? 1) < 0.85)
    .slice(0, 12);
  const load = {}; RM_TEAM.forEach((r) => { load[r.id] = 0; });
  const calls = callers.map((c, idx) => {
    const owner = RM_TEAM[idx % RM_TEAM.length];
    let assigned;
    if (load[owner.id] < RM_CAPACITY) { load[owner.id] += 1; assigned = { type: "rm", name: owner.name, role: "owner" }; }
    else {
      const free = RM_TEAM.find((r) => load[r.id] < RM_CAPACITY);
      if (free) { load[free.id] += 1; assigned = { type: "rm", name: free.name, role: "backup" }; }
      else assigned = { type: "ai", name: "FIN AI assistant", role: "overflow" };
    }
    return {
      id: c.id, name: c.name, segment: c.segment, ownerRm: owner.name,
      intent: inboundIntent(c.analysis), priority: c.analysis.priorityScore,
      panicRisk: !!c.analysis.panicRisk, assignedTo: assigned, aiDraft: aiAssistAnswer(c),
    };
  });
  const toAi = calls.filter((x) => x.assignedTo.type === "ai").length;
  return {
    calls,
    rms: RM_TEAM.map((r) => ({ name: r.name, active: load[r.id], capacity: RM_CAPACITY })),
    summary: { total: calls.length, toRm: calls.length - toAi, toAi, capacity: RM_TEAM.length * RM_CAPACITY },
  };
}

// MACHINE LEARNING. Priority = logistic regression  P(client needs RM action today) = sigma(w·x + b).
// Coefficients here are ILLUSTRATIVE (hand-set to sensible values). In production they are fitted
// offline by maximum likelihood on labeled RM outcomes (did contact prevent a breach / panic-sell?).
// The logistic form gives a calibrated probability instead of a hand-tuned weighted sum.
// (Covariance shrinkage IS implemented above; FinBERT sentiment + supervised persona classifier are roadmap.)

module.exports = { RM_TEAM, RM_CAPACITY, inboundIntent, aiAssistAnswer, buildInbound };
