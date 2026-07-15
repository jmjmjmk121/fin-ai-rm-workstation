const { clamp, pct, normalize, mulberry32, seededRandom, average, sum } = require("./util");
const { RISK_PROFILES, PROFILE_BASE_SRL, SRL_LEVELS, PERSONAS, PERSONA_RISK_AVERSION, srlLabel } = require("./config");
const { INVESTABLE, scenarioAdjustment, FACTOR_NAMES } = require("./universe");
const { computeRisk, assetClassWeights, portfolioExpectedReturn, effectiveBets, effectiveBetsPCA, requiredReturn, fundedRatio, probSuccess, buildGoal, klDrift, panicGame, behavioralPressure, targetVolFromUtility, mlPriority, perfMetrics, portfolioReturnSeries } = require("./quant");

function sampleAssets(pool, k, rng) {
  const arr = pool.slice();
  const out = [];
  for (let i = 0; i < k && arr.length; i += 1) out.push(arr.splice(Math.floor(rng() * arr.length), 1)[0]);
  return out;
}

// Build a diversified client portfolio by sampling assets from the 100+ universe per asset class,
// with a Thai home bias. Each client ends up holding ~10-30 funds. Deterministic given the seeded rng.

function buildWeightsForClient(profile, rng, index) {
  const policy = RISK_PROFILES[profile];
  const cls = normalize({
    Equity: Math.max(0, policy.target.Equity + (rng() - 0.42) * 0.22),
    "Fixed Income": Math.max(0, policy.target["Fixed Income"] + (rng() - 0.5) * 0.16),
    Alternatives: Math.max(0, policy.target.Alternatives + (rng() - 0.5) * 0.06),
    Cash: Math.max(0.01, policy.target.Cash + (rng() - 0.55) * 0.06),
  });
  const byClass = { Equity: [], "Fixed Income": [], Alternatives: [] };
  for (const a of INVESTABLE) if (byClass[a.assetClass]) byClass[a.assetClass].push(a);
  const weights = {};
  for (const k of Object.keys(byClass)) {
    const pool = byClass[k];
    if (!pool.length || cls[k] <= 0) continue;
    const nPick = clamp(Math.round(3 + rng() * 6), 2, Math.min(10, pool.length));
    const picks = sampleAssets(pool, nPick, rng);
    const thai = pool.filter((a) => a.region === "Thailand");
    if (thai.length && rng() > 0.3 && !picks.some((a) => a.region === "Thailand")) {
      picks[0] = thai[Math.floor(rng() * thai.length)]; // Thai home bias
    }
    let s = 0;
    const raw = picks.map(() => { const v = -Math.log(rng() + 1e-9); s += v; return v; });
    picks.forEach((a, i) => { weights[a.symbol] = (weights[a.symbol] || 0) + cls[k] * (raw[i] / s); });
  }
  weights.CASH = (weights.CASH || 0) + cls.Cash;
  return normalize(weights);
}

function buildSuitabilityBaseline(profile, objective, liquidityMonths, rng) {
  let srl = PROFILE_BASE_SRL[profile] || 4;

  if (objective === "capital preservation" || objective === "cash reserve") srl -= 1;
  if (objective === "retirement income" && liquidityMonths <= 18) srl -= 1;
  if ((objective === "growth" || objective === "wealth accumulation") && liquidityMonths >= 36) {
    srl += rng() > 0.45 ? 1 : 0;
  }
  if (liquidityMonths <= 6) srl -= 1;
  if (liquidityMonths <= 12) srl = Math.min(srl, 4);
  if (profile === "Aggressive" && liquidityMonths >= 36 && rng() > 0.72) srl += 1;

  srl = clamp(Math.round(srl), 1, 7);
  const level = SRL_LEVELS[srl];
  return {
    srl,
    label: srlLabel(srl),
    targetVol: level.targetVol,
    maxVol: level.maxVol,
    band: level.band,
    riskCapacity: liquidityMonths <= 12 ? "Lower capacity" : liquidityMonths >= 36 ? "Higher capacity" : "Medium capacity",
    emotionalCapacity: profile === "Aggressive" || profile === "Growth" ? "Accepts drawdown" : "Drawdown sensitive",
    knowledgeExperience: profile === "Aggressive" ? "Experienced" : profile === "Conservative" ? "Basic" : "Moderate",
    source: "Onboarding static SRL baseline",
  };
}

function buildBehaviorMemory(profile, staticSrl, rng, index) {
  const persona = PERSONAS[Math.floor(rng() * PERSONAS.length)];
  const actionRoll = rng();
  let lastDrawdownAction = "held allocation";
  let behaviorBias = 0;

  if (persona.name === "Protector") {
    if (actionRoll < 0.52) {
      lastDrawdownAction = "de-risked after drawdown";
      behaviorBias = -1;
    } else if (actionRoll < 0.68 || index % 17 === 0) {
      lastDrawdownAction = "panic sold during drawdown";
      behaviorBias = -1;
    }
  } else if (persona.name === "Return Chaser") {
    if (actionRoll < 0.58) {
      lastDrawdownAction = "added risk after rally";
      behaviorBias = 1;
    } else if (actionRoll > 0.76 || index % 19 === 0) {
      lastDrawdownAction = "bought concentrated theme";
      behaviorBias = 1;
    }
  } else if (actionRoll < 0.12 || index % 17 === 0) {
    lastDrawdownAction = "panic sold during drawdown";
    behaviorBias = -1;
  } else if (actionRoll > 0.88 || index % 19 === 0) {
    lastDrawdownAction = "bought concentrated theme";
    behaviorBias = 1;
  }

  const activityScore = clamp(0.25 + rng() * 0.55 + Math.abs(behaviorBias) * 0.22, 0, 1);
  const responseSensitivity = clamp(
    0.18 +
      rng() * 0.52 +
      (persona.name === "Protector" ? 0.18 : 0) +
      (lastDrawdownAction.includes("panic") ? 0.28 : 0),
    0,
    1
  );

  return {
    persona: persona.name,
    trait: persona.trait,
    communicationStyle: persona.style,
    lastDrawdownAction,
    behaviorBias,
    activityScore,
    responseSensitivity,
    statedRiskScore: staticSrl,
    staticSrl,
  };
}

function generateClientBook() {
  const names = [
    "Anan S.", "Benjamas K.", "Chaiwat P.", "Darika V.", "Ekachai T.", "Farida L.",
    "Garin M.", "Hansa R.", "Itthipol C.", "Jariya N.", "Kanin W.", "Lalita S.",
    "Manas P.", "Nicha T.", "Ornicha B.", "Pattarapon K.", "Rinrada C.", "Saran J.",
    "Tawan L.", "Vasin R.", "Warisa P.", "Yanin M.", "Arisa T.", "Burin S.",
  ];
  const objectives = ["retirement income", "capital preservation", "education funding", "growth", "cash reserve", "wealth accumulation"];
  const rng = mulberry32(91731);
  const clients = [];
  const profiles = ["Conservative", "Balanced", "Growth", "Aggressive"];
  for (let i = 0; i < 124; i += 1) {
    const profile = profiles[Math.floor(rng() * profiles.length)];
    const weights = buildWeightsForClient(profile, rng, i);
    const aum = Math.round((0.7 + Math.pow(rng(), 1.7) * 28) * 10) / 10;
    const liquidityMonths = [3, 6, 12, 18, 24, 36, 60][Math.floor(rng() * 7)];
    const objective = objectives[Math.floor(rng() * objectives.length)];
    const suitability = buildSuitabilityBaseline(profile, objective, liquidityMonths, rng);
    const behavior = buildBehaviorMemory(profile, suitability.srl, rng, i);
    const goal = buildGoal(objective, aum, liquidityMonths, rng);
    clients.push({
      id: `C-${String(i + 1).padStart(3, "0")}`,
      name: names[i % names.length],
      segment: aum > 12 ? "HNW" : "Mass Affluent",
      riskProfile: profile,
      suitability,
      behavior,
      goal,
      aum,
      objective,
      liquidityMonths,
      thbLiability: rng() > 0.34,
      lastContactDays: Math.floor(2 + rng() * 88),
      weights,
    });
  }
  return clients;
}

function portfolioEventImpact(weights, moves, scenario) {
  let impact = 0;
  for (const [symbol, weight] of Object.entries(weights)) {
    const move = (moves[symbol] && moves[symbol].day) || 0;
    impact += weight * (move + scenarioAdjustment(scenario, symbol));
  }
  return impact;
}

function dynamicSrlFromVol(vol) {
  if (vol < 0.045) return 1;
  if (vol < 0.065) return 2;
  if (vol < 0.085) return 3;
  if (vol < 0.11) return 4;
  if (vol < 0.14) return 5;
  if (vol < 0.18) return 6;
  return 7;
}

function draftClientMessage(client, analysis) {
  const driver = analysis.topRiskDriver;
  const riskText = analysis.srlGap > 0
    ? `your onboarding suitability level is ${analysis.staticSrlLabel}, but the current portfolio risk reads closer to ${analysis.dynamicSrlLabel}`
    : `your portfolio remains within the ${analysis.staticSrlLabel} suitability band, but one exposure is driving a large share of risk`;
  const action = analysis.suggestedAction.toLowerCase();
  const srlText = analysis.srlBreach
    ? `This does not mean we must trade today, but it means the portfolio is running above the approved risk budget and should be reviewed.`
    : analysis.srlGap > 0
    ? `The gap is still within the watch zone, but it is worth monitoring because the portfolio is moving toward a higher risk band.`
    : `Your static and dynamic suitability levels are broadly aligned today.`;
  const styleNudge = {
    Protector: "I will keep the discussion focused on downside protection and liquidity.",
    Verifier: "I will bring the numbers so you can see the evidence clearly.",
    "Return Chaser": "I will frame the trade-off between extra return and extra risk.",
    Delegator: "I will prepare a concise set of choices so the review is quick.",
  }[client.behavior.persona] || "I will keep the review concise and evidence-based.";
  return [
    `Hi ${client.name.split(" ")[0]}, after the latest market move I ran a suitability risk scan on your portfolio.`,
    `The main point is that ${riskText}. ${driver.symbol} represents ${pct(driver.weight)} of the portfolio but contributes ${pct(driver.contributionPct)} of estimated portfolio risk.`,
    srlText,
    styleNudge,
    `I suggest we schedule a short review to discuss ${action}. No action will be taken without your confirmation.`,
  ].join(" ");
}

function analyzeClient(client, symbols, cov, moves, scenario, returnsBySymbol, eigen, factorBetas) {
  const policy = RISK_PROFILES[client.riskProfile];
  const suitability = client.suitability;
  const risk = computeRisk(client.weights, symbols, cov);
  const classWeights = assetClassWeights(client.weights);
  const performance = returnsBySymbol ? perfMetrics(portfolioReturnSeries(client.weights, returnsBySymbol)) : null;
  const driftRows = Object.keys(policy.target).map((assetClass) => {
    const actual = classWeights[assetClass] || 0;
    const target = policy.target[assetClass] || 0;
    const band = policy.band[assetClass] || 0;
    const diff = actual - target;
    return { assetClass, actual, target, band, diff, breach: Math.abs(diff) > band };
  });
  const driftScore = driftRows.reduce((acc, row) => acc + Math.max(0, Math.abs(row.diff) - row.band), 0);
  const riskOvershoot = Math.max(0, risk.vol - suitability.maxVol) / suitability.maxVol;
  const contributions = risk.contributions
    .filter((item) => item.weight > 0.001)
    .sort((a, b) => b.contributionPct - a.contributionPct);
  const topRiskDriver = contributions[0] || { symbol: "CASH", weight: 1, contributionPct: 0 };
  const largestWeight = Object.entries(client.weights).sort((a, b) => b[1] - a[1])[0] || ["CASH", 0];
  const holdings = Object.entries(client.weights)
    .filter(([, w]) => w > 0.001)
    .sort((a, b) => b[1] - a[1])
    .map(([s, w]) => ({ symbol: s, name: (INVESTABLE.find((it) => it.symbol === s) || {}).name || s, weight: w }));
  // correlation matrix among this client's top holdings (from the covariance), for the Client Risk tab
  const hTop = holdings.filter((h) => h.symbol !== "CASH").slice(0, 8);
  const hIdx = hTop.map((h) => symbols.indexOf(h.symbol)).filter((i) => i >= 0);
  const holdingsCorr = {
    labels: hIdx.map((i) => symbols[i]),
    matrix: hIdx.map((i) => hIdx.map((j) => +(cov[i][j] / Math.sqrt(Math.max(cov[i][i] * cov[j][j], 1e-12))).toFixed(2))),
  };
  const hiddenConcentration = Math.max(0, topRiskDriver.contributionPct - topRiskDriver.weight);
  const eventImpact = portfolioEventImpact(client.weights, moves, scenario);

  // --- Goal-based + psychology layer (added) ---
  const goal = client.goal || buildGoal(client.objective, client.aum, client.liquidityMonths, () => 0.5);
  const riskAversion = PERSONA_RISK_AVERSION[client.behavior.persona] || 5;
  const expReturn = portfolioExpectedReturn(classWeights);              // mu_p from CMAs
  const goalRequiredReturn = requiredReturn(client.aum, goal.targetWealth, goal.horizonYears); // g*
  const funded = fundedRatio(expReturn, goalRequiredReturn, goal.horizonYears);
  const pSuccess = probSuccess(client.aum, goal.targetWealth, goal.horizonYears, expReturn, risk.vol);
  const goalDrift = goalRequiredReturn - expReturn;                     // >0 => behind goal
  const effBets = effectiveBets(risk.contributions);                    // RC-share entropy
  const effBetsPCA = effectiveBetsPCA(client.weights, symbols, eigen);  // Meucci PCA (uncorrelated factors)
  const factorExposures = {};
  if (factorBetas) {
    for (const f of FACTOR_NAMES) {
      let e = 0;
      for (const [s, w] of Object.entries(client.weights)) e += w * ((factorBetas[s] || {})[f] || 0);
      factorExposures[f] = e; // portfolio loading = sum_i w_i * beta_{i,f}
    }
  }
  // Factor-tilt advice: flag style exposures that deviate materially from a style-neutral policy.
  const tiltAlerts = [];
  if (factorBetas) {
    if (Math.abs(factorExposures.HML) > 0.30) tiltAlerts.push(factorExposures.HML > 0 ? "เอียง value มากกว่านโยบาย" : "เอียง growth มากกว่านโยบาย");
    if (Math.abs(factorExposures.SMB) > 0.30) tiltAlerts.push(factorExposures.SMB > 0 ? "เอียงหุ้นเล็กมาก" : "เอียงหุ้นใหญ่มาก");
    if (factorExposures.WML > 0.30) tiltAlerts.push("พึ่งโมเมนตัมสูง (เสี่ยงกลับตัว)");
    if (factorExposures.MKT > 1.15) tiltAlerts.push("market beta สูง (>1.15)");
  }
  const sigMin = Math.max(0.02, suitability.targetVol * 0.75);
  const utilityTargetVol = clamp(targetVolFromUtility(riskAversion, sigMin, suitability.maxVol), sigMin, suitability.maxVol);
  const deriskAlpha = risk.vol > 0 ? clamp(1 - utilityTargetVol / risk.vol, 0, 1) : 0; // cash blend to hit target
  const pressure = behavioralPressure(eventImpact, client.behavior.responseSensitivity, riskAversion);
  const atRiskCap = risk.vol >= suitability.maxVol * 0.98;
  const goalSuitabilityGap = funded < 0.9 && atRiskCap; // behind goal but cannot suitably add risk
  const suitabilityKlDrift = klDrift(classWeights, policy.target); // information-theoretic drift
  const game = panicGame({ sigma: risk.vol, expReturn, eventImpact, sharpe: performance ? performance.sharpe : 0, A: riskAversion, pressure }); // data-backed Stag Hunt

  const statedRiskScore = suitability.srl;
  const baseRevealedRiskScore = dynamicSrlFromVol(risk.vol);
  const revealedRiskScore = clamp(Math.round(baseRevealedRiskScore + client.behavior.behaviorBias), 1, 7);
  const revealedRiskGap = revealedRiskScore - statedRiskScore;
  const positiveSrlGap = Math.max(0, revealedRiskGap);
  const srlBreach = positiveSrlGap >= 2 || riskOvershoot > 0.2;
  const behaviorRisk = clamp(
    client.behavior.responseSensitivity * 0.34 +
      client.behavior.activityScore * 0.18 +
      clamp(positiveSrlGap / 4, 0, 1) * 0.18 +
      riskOvershoot * 0.18 +
      clamp(Math.abs(eventImpact) / 0.035, 0, 1) * 0.16 +
      (client.liquidityMonths <= 12 ? 0.12 : 0),
    0,
    1
  );
  const staleContact = clamp(client.lastContactDays / 90, 0, 1);
  const aumFactor = clamp(Math.log10(client.aum + 1) / 1.45, 0, 1);
  const score =
    riskOvershoot * 46 +
    clamp(positiveSrlGap / 3, 0, 1) * 36 +
    clamp(driftScore / 0.28, 0, 1) * 24 +
    clamp(hiddenConcentration / 0.26, 0, 1) * 20 +
    clamp(Math.abs(eventImpact) / 0.05, 0, 1) * 14 +
    behaviorRisk * 22 +
    aumFactor * 8 +
    staleContact * 5;

  // ML priority: assemble the feature vector and score with the fitted logistic model.
  const mlFeatures = {
    riskOvershoot: clamp(riskOvershoot / 0.5, 0, 1),
    srlGap: clamp(positiveSrlGap / 3, 0, 1),
    drift: clamp(driftScore / 0.28, 0, 1),
    hiddenConc: clamp(hiddenConcentration / 0.26, 0, 1),
    eventImpact: clamp(Math.abs(eventImpact) / 0.05, 0, 1),
    behaviorRisk,
    behindGoal: clamp((0.9 - funded) / 0.4, 0, 1),
    pressure,
    lowDiversification: clamp((2.5 - effBets) / 1.5, 0, 1),
    downsideRisk: clamp((performance ? performance.cvar95 : 0) / 0.04, 0, 1), // downside tail (CVaR)
    tilt: clamp((Math.abs(factorExposures.SMB || 0) + Math.abs(factorExposures.HML || 0) + Math.abs(factorExposures.WML || 0)) / 1.0, 0, 1), // style deviation
    staleContact,
    aum: aumFactor,
  };
  const ml = mlPriority(mlFeatures);

  const reasonParts = [];
  if (srlBreach) reasonParts.push("dynamic SRL above static suitability baseline");
  if (riskOvershoot > 0.15) reasonParts.push("actual volatility above SRL band");
  if (driftRows.some((row) => row.breach)) reasonParts.push("allocation drift outside band");
  if (hiddenConcentration > 0.12) reasonParts.push("hidden risk concentration");
  if (Math.abs(eventImpact) > 0.018) reasonParts.push("large event impact");
  if (revealedRiskGap < -1) reasonParts.push("portfolio risk below approved SRL");
  if (behaviorRisk > 0.7) reasonParts.push("behavioral response risk");
  if (goalSuitabilityGap) reasonParts.push("goal-suitability gap (behind goal at risk cap)");
  else if (funded < 0.9) reasonParts.push("behind goal (funded < 90%)");
  if (game.panicRisk) reasonParts.push("panic-sell risk (game-theoretic, high pressure)");
  if (effBets < 2.2) reasonParts.push("low diversification (few effective bets)");
  if (!reasonParts.length) reasonParts.push("monitor only");

  const suggestedAction =
    topRiskDriver.symbol === "QQQ" || topRiskDriver.symbol === "FXI"
      ? "trimming concentrated equity risk or rebalancing into diversified core holdings"
      : topRiskDriver.symbol === "TLT"
      ? "reviewing duration exposure and considering shorter-duration income"
      : srlBreach
      ? "bringing the portfolio back inside the approved SRL risk band"
      : "sending a reassurance note with the current risk summary";

  const analysis = {
    vol: risk.vol,
    targetVol: suitability.maxVol,
    srlTargetVol: suitability.targetVol,
    srlMaxVol: suitability.maxVol,
    riskOvershoot,
    srlBreach,
    classWeights,
    driftRows,
    driftScore,
    contributions,
    topRiskDriver,
    largestWeight: { symbol: largestWeight[0], weight: largestWeight[1] },
    holdings,
    holdingsCorr,
    hiddenConcentration,
    eventImpact,
    staticSrl: statedRiskScore,
    staticSrlLabel: srlLabel(statedRiskScore),
    dynamicSrl: revealedRiskScore,
    dynamicSrlLabel: srlLabel(revealedRiskScore),
    srlGap: revealedRiskGap,
    statedRiskScore,
    statedRiskLabel: srlLabel(statedRiskScore),
    revealedRiskScore,
    revealedRiskLabel: srlLabel(revealedRiskScore),
    revealedRiskGap,
    behaviorRisk,
    priorityScore: ml.score,
    priorityProbability: ml.probability,
    heuristicScore: Math.min(99, Math.round(score)),
    mlFeatures,
    // --- goal-based + psychology layer ---
    goal,
    riskAversion,
    expReturn,
    requiredReturn: goalRequiredReturn,
    fundedRatio: funded,
    probSuccess: pSuccess,
    goalDrift,
    utilityTargetVol,
    deriskAlpha,
    behavioralPressure: pressure,
    goalSuitabilityGap,
    // --- information theory ---
    effectiveBets: effBets,
    effectiveBetsPCA: effBetsPCA,
    factorExposures,
    tiltAlerts,
    suitabilityKlDrift,
    // --- game theory (stay-the-course) ---
    stayConfidence: game.stayConfidence,
    panicThreshold: game.threshold,
    panicRisk: game.panicRisk,
    // --- performance analytics (PortfolioVisualizer-style) ---
    performance,
    reason: reasonParts.join(", "),
    suggestedAction,
  };

  return {
    ...client,
    analysis,
    draft: draftClientMessage(client, analysis),
  };
}

module.exports = { sampleAssets, buildWeightsForClient, buildSuitabilityBaseline, buildBehaviorMemory, generateClientBook, portfolioEventImpact, dynamicSrlFromVol, draftClientMessage, analyzeClient };
