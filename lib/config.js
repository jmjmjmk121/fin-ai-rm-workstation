const RISK_PROFILES = {
  Conservative: {
    targetVol: 0.065,
    target: { Equity: 0.3, "Fixed Income": 0.5, Cash: 0.15, Alternatives: 0.05 },
    band: { Equity: 0.08, "Fixed Income": 0.1, Cash: 0.1, Alternatives: 0.05 },
  },
  Balanced: {
    targetVol: 0.105,
    target: { Equity: 0.5, "Fixed Income": 0.35, Cash: 0.08, Alternatives: 0.07 },
    band: { Equity: 0.1, "Fixed Income": 0.1, Cash: 0.08, Alternatives: 0.05 },
  },
  Growth: {
    targetVol: 0.145,
    target: { Equity: 0.7, "Fixed Income": 0.2, Cash: 0.03, Alternatives: 0.07 },
    band: { Equity: 0.12, "Fixed Income": 0.1, Cash: 0.06, Alternatives: 0.05 },
  },
  Aggressive: {
    targetVol: 0.19,
    target: { Equity: 0.85, "Fixed Income": 0.1, Cash: 0, Alternatives: 0.05 },
    band: { Equity: 0.12, "Fixed Income": 0.08, Cash: 0.05, Alternatives: 0.05 },
  },
};

const PROFILE_BASE_SRL = {
  Conservative: 3,
  Balanced: 4,
  Growth: 5,
  Aggressive: 6,
};

const SRL_LEVELS = {
  1: { name: "Defensive", targetVol: 0.035, maxVol: 0.045, band: "0-4.5%" },
  2: { name: "Cautious", targetVol: 0.052, maxVol: 0.065, band: "4.5-6.5%" },
  3: { name: "Conservative", targetVol: 0.07, maxVol: 0.085, band: "6.5-8.5%" },
  4: { name: "Balanced", targetVol: 0.095, maxVol: 0.11, band: "8.5-11.0%" },
  5: { name: "Growth", targetVol: 0.125, maxVol: 0.14, band: "11.0-14.0%" },
  6: { name: "High Growth", targetVol: 0.16, maxVol: 0.18, band: "14.0-18.0%" },
  7: { name: "Aggressive", targetVol: 0.205, maxVol: 0.24, band: "18.0%+" },
};

const PERSONAS = [
  {
    name: "Protector",
    trait: "loss-sensitive",
    style: "focus on downside, liquidity, and what will not be changed without consent",
  },
  {
    name: "Verifier",
    trait: "data-driven",
    style: "lead with numbers and concise evidence",
  },
  {
    name: "Return Chaser",
    trait: "performance-sensitive",
    style: "anchor the conversation on risk paid per unit of return",
  },
  {
    name: "Delegator",
    trait: "time-constrained",
    style: "give a short recommendation menu and clear next step",
  },
];

// --- Goal-based engine (psychology layer): relative risk aversion by persona ---
// A = coefficient of RELATIVE risk aversion used in the mean-variance utility
// U = E(Rp) - 0.5 * A * sigma^2  (CFA Level III utility-adjusted return; CRRA => A = gamma).
// Higher A = more risk-averse => lower optimal volatility. Typical range 1-10.

const PERSONA_RISK_AVERSION = { Protector: 8, Verifier: 5, Delegator: 6, "Return Chaser": 2.5 };

// Long-run expected nominal return per asset class (illustrative capital-market assumptions).
// Used to estimate portfolio expected return for the GOAL layer (funded ratio / goal drift).

const CLASS_EXPECTED_RETURN = { Equity: 0.085, "Fixed Income": 0.035, Cash: 0.025, Alternatives: 0.055, FX: 0.0 };

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const CACHE_MS = 1000 * 60 * 10;

function srlLabel(level) {
  const srl = SRL_LEVELS[level] || SRL_LEVELS[4];
  return `SRL ${level} - ${srl.name}`;
}

const RISK_FREE = 0.04;

// Portfolio daily return series rp_t = sum_i w_i r_{i,t}, aligned to the shortest available history.

module.exports = { RISK_PROFILES, PROFILE_BASE_SRL, SRL_LEVELS, PERSONAS, PERSONA_RISK_AVERSION, CLASS_EXPECTED_RETURN, MIME, CACHE_MS, srlLabel, RISK_FREE };
