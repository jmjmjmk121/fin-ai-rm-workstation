const { clamp, sum, dot, matrixVector, average } = require("./util");
const { CLASS_EXPECTED_RETURN, RISK_FREE } = require("./config");
const { INVESTABLE, FACTOR_NAMES, CORE_ASSETS } = require("./universe");

function covarianceMatrix(returnsBySymbol, symbols) {
  const n = symbols.length;
  const means = symbols.map((symbol) => average(returnsBySymbol[symbol] || []));
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const row = [];
    for (let j = 0; j < n; j += 1) {
      const a = returnsBySymbol[symbols[i]] || [];
      const b = returnsBySymbol[symbols[j]] || [];
      const len = Math.min(a.length, b.length);
      if (len < 2) {
        row.push(0);
        continue;
      }
      let total = 0;
      for (let k = 0; k < len; k += 1) total += (a[k] - means[i]) * (b[k] - means[j]);
      row.push((total / (len - 1)) * 252);
    }
    rows.push(row);
  }
  return shrinkCovariance(rows, n);
}

// Ledoit-Wolf style shrinkage toward a constant-correlation target (stabilizes Sigma so that
// sigma_req, RC and the frontier are reliable). F_ii = S_ii; F_ij = rbar*sqrt(S_ii*S_jj),
// rbar = average sample correlation. Intensity delta grows with assets/observations ratio
// (transparent heuristic; full Ledoit-Wolf optimal-delta is on the roadmap).

function shrinkCovariance(S, n, obs = 180) {
  let rsum = 0, rc = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const denom = Math.sqrt(Math.max(S[i][i] * S[j][j], 1e-12));
      rsum += S[i][j] / denom; rc += 1;
    }
  }
  const rbar = rc ? rsum / rc : 0;
  const delta = clamp(0.10 + n / (2 * obs), 0, 0.6);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const row = [];
    for (let j = 0; j < n; j += 1) {
      const f = i === j ? S[i][i] : rbar * Math.sqrt(Math.max(S[i][i] * S[j][j], 0));
      row.push(delta * f + (1 - delta) * S[i][j]);
    }
    out.push(row);
  }
  return out;
}

function correlationMatrix(cov, symbols) {
  return symbols.map((_, i) =>
    symbols.map((__, j) => {
      const denom = Math.sqrt(Math.max(cov[i][i], 0)) * Math.sqrt(Math.max(cov[j][j], 0));
      return denom ? cov[i][j] / denom : 0;
    })
  );
}

function computeRisk(weightsBySymbol, symbols, cov) {
  const w = symbols.map((symbol) => weightsBySymbol[symbol] || 0);
  const sigmaW = matrixVector(cov, w);
  const variance = Math.max(dot(w, sigmaW), 0);
  const vol = Math.sqrt(variance);
  const contributions = symbols.map((symbol, index) => {
    const contribution = vol > 0 ? (w[index] * sigmaW[index]) / vol : 0;
    return {
      symbol,
      weight: w[index],
      contribution,
      contributionPct: vol > 0 ? contribution / vol : 0,
    };
  });
  return { vol, contributions };
}

// --- Goal-based engine helpers (added) ---

// Effective Number of Bets (Meucci 2009): entropy of the risk-contribution distribution.
// p_i = RC_i / sigma_p (each holding's share of portfolio risk).
// N_ent = exp(-sum_i p_i ln p_i).  N_ent = 1 => all risk in one bet; N_ent = K => evenly spread.

function effectiveBets(contributions) {
  const parts = contributions.map((c) => Math.max(0, c.contributionPct)).filter((x) => x > 1e-9);
  const total = parts.reduce((a, b) => a + b, 0);
  if (total <= 0) return 1;
  const entropy = parts.reduce((acc, x) => {
    const p = x / total;
    return acc - p * Math.log(p);
  }, 0);
  return Math.exp(entropy);
}

// Symmetric eigendecomposition via cyclic Jacobi rotations. Returns {values, vectors} with
// vectors[i][k] = i-th component of the k-th eigenvector (columns are eigenvectors).
// Used for the principal-component (PCA) version of the effective number of bets.

function jacobiEigen(Ain, maxSweeps = 40) {
  const n = Ain.length;
  const a = Ain.map((r) => r.slice());
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n - 1; p += 1) for (let q = p + 1; q < n; q += 1) off += Math.abs(a[p][q]);
    if (off < 1e-10) break;
    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (Math.abs(a[p][q]) < 1e-14) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let i = 0; i < n; i += 1) { const aip = a[i][p], aiq = a[i][q]; a[i][p] = c * aip - s * aiq; a[i][q] = s * aip + c * aiq; }
        for (let i = 0; i < n; i += 1) { const api = a[p][i], aqi = a[q][i]; a[p][i] = c * api - s * aqi; a[q][i] = s * api + c * aqi; }
        for (let i = 0; i < n; i += 1) { const vip = v[i][p], viq = v[i][q]; v[i][p] = c * vip - s * viq; v[i][q] = s * vip + c * viq; }
      }
    }
  }
  return { values: a.map((r, i) => r[i]), vectors: v };
}

// INFORMATION THEORY (Meucci 2009, "Managing Diversification"): effective number of bets on the
// UNCORRELATED principal components. Variance of component k contributed by w is v_k = (e_k . w)^2 * lambda_k,
// and sum_k v_k = w' Sigma w. With p_k = v_k / sigma_p^2 (a distribution), N_pca = exp(-sum p_k ln p_k).
// More rigorous than the risk-contribution version because it accounts for correlation among holdings.

function effectiveBetsPCA(weights, symbols, eigen) {
  if (!eigen) return null;
  const w = symbols.map((s) => weights[s] || 0);
  const { values: lam, vectors: V } = eigen;
  const n = lam.length;
  const vc = []; let tot = 0;
  for (let k = 0; k < n; k += 1) {
    let f = 0;
    for (let i = 0; i < n; i += 1) f += V[i][k] * w[i];
    const vk = Math.max(0, f * f * Math.max(lam[k], 0));
    vc.push(vk); tot += vk;
  }
  if (tot <= 0) return 1;
  let H = 0;
  for (const vk of vc) { const p = vk / tot; if (p > 1e-12) H -= p * Math.log(p); }
  return Math.exp(H);
}

// Portfolio expected return from capital-market assumptions, weighted by asset class.

function portfolioExpectedReturn(classWeights) {
  let mu = 0;
  for (const [cls, w] of Object.entries(classWeights)) mu += (CLASS_EXPECTED_RETURN[cls] || 0) * w;
  return mu;
}

// GOAL layer. Required CAGR to grow current wealth W0 into target WT over T years:
// g* = (WT / W0)^(1/T) - 1.

function requiredReturn(currentWealth, targetWealth, years) {
  if (currentWealth <= 0 || years <= 0) return 0;
  return Math.pow(targetWealth / currentWealth, 1 / years) - 1;
}

// Funded ratio = projected terminal wealth at current expected return vs the goal:
// fr = (1+mu)^T / (1+g*)^T.  fr >= 1 => on track to the goal.

function fundedRatio(expReturn, requiredRet, years) {
  if (years <= 0) return 1;
  return Math.pow(1 + expReturn, years) / Math.pow(1 + requiredRet, years);
}

// Standard normal CDF (Abramowitz-Stegun 26.2.17 approximation).

function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
// P(reach goal) under lognormal terminal wealth (GBM): P(W_T >= W_goal) = Phi(d).
// d = [ln(W0/W_goal) + (muP - 0.5 sigmaP^2) T] / (sigmaP sqrt(T)). Real-world measure (uses muP, not r).

function probSuccess(W0, Wgoal, years, muP, sigmaP) {
  if (W0 <= 0 || Wgoal <= 0 || years <= 0 || sigmaP <= 0) return null;
  const d = (Math.log(W0 / Wgoal) + (muP - 0.5 * sigmaP * sigmaP) * years) / (sigmaP * Math.sqrt(years));
  return clamp(normalCdf(d), 0, 1);
}

// PSYCHOLOGY layer -> target risk. From the mean-variance utility U = E(Rp) - 0.5*A*sigma^2,
// the utility-optimal volatility decreases in A. We place sigma* inside the SUITABLE band
// [sigMin, sigMax] (suitability is a hard constraint): high A => near sigMin, low A => near sigMax.

function targetVolFromUtility(A, sigMin, sigMax) {
  const t = clamp((A - 2) / (9 - 2), 0, 1); // 0 (low aversion) .. 1 (high aversion)
  return sigMax - t * (sigMax - sigMin);
}

// Behavioral Pressure (heuristic, illustrative). How likely TODAY's news/market move pushes
// this client to act emotionally = size-of-shock x emotional-sensitivity x loss-aversion.
// Production: replace eventImpact with real news-sentiment overlapped with the client's holdings.

function behavioralPressure(eventImpact, responseSensitivity, A) {
  const shock = clamp(Math.abs(eventImpact) / 0.04, 0, 1);
  const sensitivity = clamp(responseSensitivity, 0, 1);
  const aversion = clamp(A / 9, 0, 1);
  return clamp(shock * (0.45 + 0.55 * sensitivity) * (0.6 + 0.4 * aversion), 0, 1);
}

// Build a financial GOAL for a client (target wealth + horizon) from objective and AUM.

function buildGoal(objective, aum, liquidityMonths, rng) {
  const horizonYears = clamp(Math.round(liquidityMonths / 12 + 4 + rng() * 8), 3, 25);
  const baseMultiple = {
    "retirement income": 2.2,
    "capital preservation": 1.4,
    "education funding": 1.8,
    growth: 2.6,
    "cash reserve": 1.25,
    "wealth accumulation": 3.0,
  }[objective] || 2.0;
  const targetMultiple = Math.round((baseMultiple + (rng() - 0.5) * 0.5) * 100) / 100;
  const targetWealth = Math.round(aum * targetMultiple * 10) / 10;
  return { objective, horizonYears, targetMultiple, targetWealth, label: `${targetMultiple}x in ${horizonYears}y` };
}

// INFORMATION THEORY (Gray, Entropy and Information Theory; Meucci 2009).
// Suitability / Allocation Drift as relative entropy (Kullback-Leibler) between the current
// class allocation p and the policy target q:  D(p||q) = sum_i p_i ln(p_i / q_i)  >= 0.
// 0 => on policy; larger => portfolio has drifted further from the suitable target mix.

function klDrift(classWeightsNow, policyTarget) {
  let d = 0;
  for (const [cls, q0] of Object.entries(policyTarget)) {
    const p = classWeightsNow[cls] || 0;
    const q = Math.max(q0, 1e-4);
    if (p > 1e-9) d += p * Math.log(p / q);
  }
  return Math.max(0, d);
}

// GAME THEORY (Yildiz, MIT 14.126: Stag Hunt, Example 2.4; risk dominance, Sec 6.1).
// "Stay-the-course" is a coordination game: Stay (payoff-dominant, needs confidence) vs
// Sell-to-cash (safe, risk-dominant under fear). The client stays iff confidence p that holding
// recovers exceeds the risk-dominance threshold p* = (d - c)/(a + d), where loss aversion A
// inflates the felt downside d. Behavioral pressure lowers p. p < p* => likely to select the
// risk-dominant (panic) equilibrium -> FIN AI flags the client and prioritizes the RM nudge.
// Payoffs are now DATA-BACKED (derived from the client's real metrics over a market-episode horizon h),
// not hardcoded. a = upside if Stay & recover (drift over h + recovering today's drop); c = loss locked in
// if Sell now (today's drop + missed drift); d = felt tail loss if Stay & it worsens (one-sided VaR over h,
// amplified by loss aversion lambda(A) ~ Kahneman-Tversky). Threshold p* = (d-c)/(a+d) is the risk-dominance
// boundary; stayConfidence falls with behavioral pressure and rises with the portfolio's Sharpe.

function panicGame(m) {
  const h = 0.5;
  const lossAversion = 1 + clamp(m.A, 1, 10) / 9;            // ~1.1..2.1
  const sigmaH = Math.max(1e-4, m.sigma) * Math.sqrt(h);
  const todayLoss = Math.max(0, -(m.eventImpact || 0));
  const a = Math.max(0.01, (m.expReturn || 0) * h + todayLoss);
  const c = Math.max(0.005, todayLoss + 0.5 * Math.max(0, m.expReturn || 0) * h);
  const d = lossAversion * 1.65 * sigmaH;                    // 5% one-sided VaR over h, loss-aversion scaled
  const threshold = clamp((d - c) / (a + d), 0, 1);
  const stayConfidence = clamp(0.85 - 0.55 * clamp(m.pressure, 0, 1) + 0.08 * clamp(m.sharpe || 0, -2, 2), 0, 1);
  return { stayConfidence, threshold, panicRisk: stayConfidence < threshold, payoffs: { a, c, d } };
}

// ===== Inbound overflow + AI chatbot routing =====
// When many clients call at once (e.g. during a shock), one RM cannot answer all. FIN AI routes
// each call to the owner RM if free, else any free RM (backup), else an AI assistant handles it
// with a grounded draft reply queued for RM approval (no unreviewed advice goes out).

const ML_PRIORITY = {
  bias: -3.1,
  weights: {
    riskOvershoot: 2.4, srlGap: 2.0, drift: 1.3, hiddenConc: 1.1, eventImpact: 0.8,
    behaviorRisk: 1.4, behindGoal: 1.6, pressure: 1.5, lowDiversification: 0.7,
    downsideRisk: 1.2, tilt: 0.6, staleContact: 0.5, aum: 0.4,
  },
};

function mlPriority(features) {
  let z = ML_PRIORITY.bias;
  for (const [k, w] of Object.entries(ML_PRIORITY.weights)) z += w * (features[k] || 0);
  const probability = 1 / (1 + Math.exp(-z));
  return { probability, score: Math.min(99, Math.round(probability * 99)) };
}

// ===== Performance analytics (PortfolioVisualizer-style) =====

function portfolioReturnSeries(weights, returnsBySymbol) {
  const syms = Object.keys(weights).filter((s) => (weights[s] || 0) > 1e-6 && returnsBySymbol[s]);
  if (!syms.length) return [];
  const n = Math.min(...syms.map((s) => returnsBySymbol[s].length));
  if (!Number.isFinite(n) || n < 2) return [];
  const wsum = syms.reduce((a, s) => a + weights[s], 0) || 1;
  const rp = new Array(n).fill(0);
  for (const s of syms) {
    const r = returnsBySymbol[s];
    const off = r.length - n;
    const w = weights[s] / wsum;
    for (let t = 0; t < n; t += 1) rp[t] += w * r[off + t];
  }
  return rp;
}

function annualizedVol(returns) {
  if (returns.length < 2) return 0;
  const m = returns.reduce((a, b) => a + b, 0) / returns.length;
  const v = returns.reduce((a, b) => a + (b - m) * (b - m), 0) / (returns.length - 1);
  return Math.sqrt(v) * Math.sqrt(252);
}

// Equity curve + maximum drawdown from a daily return series.

function drawdownStats(returns) {
  let g = 1, peak = 1, maxdd = 0;
  const curve = [];
  for (const r of returns) {
    g *= 1 + r;
    curve.push(g);
    if (g > peak) peak = g;
    const dd = g / peak - 1;
    if (dd < maxdd) maxdd = dd;
  }
  return { maxDrawdown: maxdd, growth: g, curve };
}

function downsample(curve, points) {
  const n = curve.length;
  if (n <= points) return curve.map((v) => Math.round(v * 1e4) / 1e4);
  const step = Math.ceil(n / points);
  return curve.filter((_, i) => i % step === 0 || i === n - 1).map((v) => Math.round(v * 1e4) / 1e4);
}

// PortfolioVisualizer-style performance summary for a daily return series.

function perfMetrics(returns, rf = RISK_FREE) {
  if (returns.length < 2) return null;
  const n = returns.length;
  const { maxDrawdown, growth, curve } = drawdownStats(returns);
  const annReturn = Math.pow(Math.max(growth, 1e-6), 252 / n) - 1; // CAGR (geometric)
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const expectedReturn = mean * 252;                              // arithmetic, annualized
  const annVol = annualizedVol(returns);
  const sharpeExPost = annVol > 0 ? (annReturn - rf) / annVol : 0;      // realized (geometric)
  const sharpeExAnte = annVol > 0 ? (expectedReturn - rf) / annVol : 0; // forward (arithmetic)
  const downside = returns.filter((r) => r < 0);
  const dDev = downside.length ? Math.sqrt(downside.reduce((a, b) => a + b * b, 0) / downside.length) * Math.sqrt(252) : 0;
  const sortino = dDev > 0 ? (expectedReturn - rf) / dDev : 0;
  const years = [];
  for (let i = 0; i + 252 <= n; i += 252) {
    let g = 1;
    for (let t = i; t < i + 252; t += 1) g *= 1 + returns[t];
    years.push(g - 1);
  }
  const bestYear = years.length ? Math.max(...years) : annReturn;
  const worstYear = years.length ? Math.min(...years) : annReturn;
  const sorted = returns.slice().sort((a, b) => a - b);
  const vIdx = Math.max(0, Math.floor(0.05 * sorted.length) - 1);
  const var95 = -sorted[vIdx];                                          // 1-day 95% VaR (loss, positive)
  const tail = sorted.slice(0, vIdx + 1);
  const cvar95 = tail.length ? -(tail.reduce((a, b) => a + b, 0) / tail.length) : var95; // expected shortfall
  const calmar = maxDrawdown < 0 ? annReturn / Math.abs(maxDrawdown) : 0; // return per unit of drawdown
  return {
    startBalance: 10000, endBalance: 10000 * growth,
    annReturn, expectedReturn, annVol,
    bestYear, worstYear, maxDrawdown,
    sharpeExPost, sharpeExAnte, sharpe: sharpeExPost, sortino,
    var95, cvar95, calmar, downsideDev: dDev,
    bestDay: Math.max(...returns), worstDay: Math.min(...returns),
    cumulativeReturn: growth - 1, windowDays: n, years: years.length, spark: downsample(curve, 48),
  };
}

// Market table: latest price + day/5d/20d change + annualized vol + period return + sparkline, every asset.

function expectedReturnVector(symbols) {
  return symbols.map((s) => {
    const a = INVESTABLE.find((it) => it.symbol === s);
    return CLASS_EXPECTED_RETURN[a ? a.assetClass : "Cash"] || 0;
  });
}

// Efficient frontier (Markowitz): random long-only portfolios -> (risk, return) cloud,
// plus individual asset points, minimum-variance and maximum-Sharpe portfolios.
// Uses the annualized covariance (Sigma) and CMA expected returns (mu). PortfolioVisualizer-style.
// Gauss-Jordan matrix inverse (small n; throws on singular).

function matInverse(M) {
  const n = M.length;
  const A = M.map((row, i) => row.slice().concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
  for (let c = 0; c < n; c += 1) {
    let piv = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) throw new Error("singular");
    const tmp = A[c]; A[c] = A[piv]; A[piv] = tmp;
    const d = A[c][c];
    for (let j = 0; j < 2 * n; j += 1) A[c][j] /= d;
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = A[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j += 1) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((row) => row.slice(n));
}

// Closed-form Markowitz (two-fund) efficient frontier from covariance S and mean vector mr.
// sigma^2(m) = (A m^2 - 2B m + C)/D, A=1'S^-1 1, B=1'S^-1 mu, C=mu'S^-1 mu, D=AC-B^2.
// Returns the smooth bullet: efficient (upper) branch `line`, inefficient `lineLo`,
// plus exact min-variance vertex and tangency (max-Sharpe) point. null on failure.

function frontierCurve(S, mr, rf) {
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const k = S.length;
  try {
    const inv = matInverse(S);
    const ones = new Array(k).fill(1);
    const Si1 = matrixVector(inv, ones), Simu = matrixVector(inv, mr);
    const A = dot(ones, Si1), Bc = dot(ones, Simu), Cc = dot(mr, Simu), Dc = A * Cc - Bc * Bc;
    if (!(isFinite(A) && isFinite(Dc) && A > 1e-9 && Dc > 1e-12)) return null;
    const mMv = Bc / A, sMv = Math.sqrt(1 / A);
    const mMax = Math.max.apply(null, mr), span = Math.max(mMax - mMv, 0.01);
    const mHi = mMv + span * 1.05, mLo = mMv - span * 0.92, STEPS = 48;
    const line = [], lineLo = [];
    for (let t = 0; t <= STEPS; t += 1) {
      const m = mLo + (mHi - mLo) * (t / STEPS);
      const v2 = (A * m * m - 2 * Bc * m + Cc) / Dc;
      if (v2 <= 0) continue;
      const pt = { x: r4(Math.sqrt(v2)), y: r4(m) };
      if (m >= mMv) line.push(pt); else lineLo.push(pt);
    }
    if (!line.length) return null;
    line.unshift({ x: r4(sMv), y: r4(mMv) });
    lineLo.push({ x: r4(sMv), y: r4(mMv) });
    let ms = line[0], bestSh = -Infinity;
    for (const p of line) { const sh = p.x > 1e-9 ? (p.y - rf) / p.x : -Infinity; if (sh > bestSh) { bestSh = sh; ms = p; } }
    return { line, lineLo, minVar: { x: r4(sMv), y: r4(mMv) }, maxSharpe: { x: ms.x, y: ms.y } };
  } catch (e) { return null; }
}

function buildFrontier(cov, symbols) {
  const mu = expectedReturnVector(symbols);
  const n = symbols.length;
  let seed = 20260623;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const cloud = [];
  const N = 900;
  for (let p = 0; p < N; p += 1) {
    const w = new Array(n).fill(0);
    if (rnd() < 0.5) {
      let s = 0;
      for (let i = 0; i < n; i += 1) { w[i] = -Math.log(rnd() + 1e-9); s += w[i]; }
      for (let i = 0; i < n; i += 1) w[i] /= s;
    } else {
      const k = 2 + Math.floor(rnd() * 3);
      const idx = [];
      while (idx.length < k) { const j = Math.floor(rnd() * n); if (!idx.includes(j)) idx.push(j); }
      let s = 0; const tmp = idx.map(() => { const v = -Math.log(rnd() + 1e-9); s += v; return v; });
      idx.forEach((j, t) => { w[j] = tmp[t] / s; });
    }
    const sigmaW = matrixVector(cov, w);
    const sd = Math.sqrt(Math.max(dot(w, sigmaW), 0));
    let m = 0; for (let i = 0; i < n; i += 1) m += w[i] * mu[i];
    cloud.push({ x: sd, y: m });
  }
  let minVarRand = cloud[0], maxSharpeRand = cloud[0], bestSh = -Infinity;
  for (const pt of cloud) {
    if (pt.x < minVarRand.x) minVarRand = pt;
    const sh = pt.x > 0 ? (pt.y - RISK_FREE) / pt.x : -Infinity;
    if (sh > bestSh) { bestSh = sh; maxSharpeRand = pt; }
  }
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const assets = symbols.map((s, i) => {
    const a = INVESTABLE.find((it) => it.symbol === s);
    return { symbol: s, name: a ? a.name : s, x: r4(Math.sqrt(Math.max(cov[i][i], 0))), y: r4(mu[i]) };
  }).filter((a) => a.symbol !== "CASH");
  // Efficient-frontier line: closed-form Markowitz curve over the risky assets (exclude CASH).
  const R = symbols.map((s, i) => i).filter((i) => symbols[i] !== "CASH");
  const fc = frontierCurve(R.map((i) => R.map((j) => cov[i][j])), R.map((i) => mu[i]), RISK_FREE);
  let line, lineLo = [], minVar, maxSharpe;
  if (fc) {
    line = fc.line; lineLo = fc.lineLo; minVar = fc.minVar; maxSharpe = fc.maxSharpe;
  } else {
    // fallback: upper envelope of the random cloud (kept non-decreasing) + random markers
    const xmn = Math.min(...cloud.map((p) => p.x)), xmx = Math.max(...cloud.map((p) => p.x));
    const NB = 22, bins = new Array(NB).fill(null);
    for (const p of cloud) { const bi = Math.min(NB - 1, Math.max(0, Math.floor((p.x - xmn) / ((xmx - xmn) || 1) * NB))); if (!bins[bi] || p.y > bins[bi].y) bins[bi] = p; }
    line = []; let mY = -Infinity;
    for (const p of bins) { if (!p) continue; if (p.y >= mY - 0.0005) { line.push({ x: r4(p.x), y: r4(p.y) }); mY = Math.max(mY, p.y); } }
    minVar = { x: r4(minVarRand.x), y: r4(minVarRand.y) };
    maxSharpe = { x: r4(maxSharpeRand.x), y: r4(maxSharpeRand.y) };
  }
  return {
    cloud: cloud.filter((_, i) => i % 3 === 0).map((p) => ({ x: r4(p.x), y: r4(p.y) })),
    assets,
    line,
    lineLo,
    minVar,
    maxSharpe,
    rf: RISK_FREE,
  };
}

// ===== PORTFOLIO OPTIMIZATION (CQD/Markowitz) over the core liquid set =====
// Efficient frontier + CML, Max-Sharpe / Min-Variance / Equal-Weight strategies with in-sample optima
// and a fixed-weight walk-forward-style backtest (CAGR, vol, Sharpe, MaxDD, Calmar), plus correlation.

function buildOptimization(cov, symbols, returnsBySymbol) {
  const core = CORE_ASSETS.map((a) => a.symbol).filter((s) => symbols.includes(s));
  const idx = core.map((s) => symbols.indexOf(s));
  const n = core.length;
  const subCov = idx.map((i) => idx.map((j) => cov[i][j]));
  const mu = core.map((s) => { const r = returnsBySymbol[s] || []; const m = r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0; return m * 252; });
  const subVol = idx.map((i) => Math.sqrt(Math.max(cov[i][i], 0)));
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const stat = (w) => { const sw = matrixVector(subCov, w); const v = Math.sqrt(Math.max(dot(w, sw), 0)); let m = 0; for (let i = 0; i < n; i += 1) m += w[i] * mu[i]; return { v, m }; };
  let seed = 7777; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const cloud = []; let best = null, lowv = null;
  for (let p = 0; p < 1500; p += 1) {
    let w;
    if (rnd() < 0.6) { w = core.map(() => -Math.log(rnd() + 1e-9)); const s = w.reduce((a, b) => a + b, 0); w = w.map((x) => x / s); }
    else { w = new Array(n).fill(0); const k = 2 + Math.floor(rnd() * 3); const ix = []; while (ix.length < k) { const j = Math.floor(rnd() * n); if (!ix.includes(j)) ix.push(j); } let s = 0; const t = ix.map(() => { const v = -Math.log(rnd() + 1e-9); s += v; return v; }); ix.forEach((j, q) => { w[j] = t[q] / s; }); }
    const { v, m } = stat(w); cloud.push({ x: v, y: m });
    const sh = v > 0 ? (m - RISK_FREE) / v : -1e9;
    if (!best || sh > best.sh) best = { sh, v, m, w };
    if (!lowv || v < lowv.v) lowv = { v, m, w };
  }
  const eqw = new Array(n).fill(1 / n); const eqs = stat(eqw);
  const L = Math.min(...core.map((s) => (returnsBySymbol[s] || []).length));
  const stratRet = (w) => { const out = []; for (let t = 0; t < L; t += 1) { let r = 0; for (let i = 0; i < n; i += 1) { const rr = returnsBySymbol[core[i]]; r += w[i] * rr[rr.length - L + t]; } out.push(r); } return out; };
  // Efficient-frontier line: closed-form Markowitz curve over the 10 core assets.
  const fcO = frontierCurve(subCov, mu, RISK_FREE);
  let line, lineLo = [];
  if (fcO) { line = fcO.line; lineLo = fcO.lineLo; }
  else {
    const bins = new Array(20).fill(null);
    const xmn = Math.min(...cloud.map((p) => p.x)), xmx = Math.max(...cloud.map((p) => p.x));
    for (const p of cloud) { const bi = Math.min(19, Math.max(0, Math.floor((p.x - xmn) / ((xmx - xmn) || 1) * 20))); if (!bins[bi] || p.y > bins[bi].y) bins[bi] = p; }
    line = []; let mY = -1e9; for (const p of bins) { if (!p) continue; if (p.y >= mY - 0.0005) { line.push({ x: r4(p.x), y: r4(p.y) }); mY = Math.max(mY, p.y); } }
  }
  const strat = (name, w, st, color) => {
    const m = perfMetrics(stratRet(w));
    return { name, color, weights: core.map((s, i) => ({ symbol: s, w: r4(w[i]) })).sort((a, b) => b.w - a.w),
      inSample: { ret: r4(st.m), vol: r4(st.v), sharpe: st.v > 0 ? +((st.m - RISK_FREE) / st.v).toFixed(2) : 0 },
      backtest: m ? { cagr: r4(m.annReturn), vol: r4(m.annVol), sharpe: +m.sharpeExPost.toFixed(2), maxdd: r4(m.maxDrawdown), calmar: +m.calmar.toFixed(2) } : null,
      curve: m ? m.spark : [] };
  };
  return {
    assets: core.map((s, i) => ({ symbol: s, x: r4(subVol[i]), y: r4(mu[i]) })),
    cloud: cloud.filter((_, i) => i % 4 === 0).map((p) => ({ x: r4(p.x), y: r4(p.y) })),
    line, lineLo, rf: RISK_FREE,
    maxSharpe: strat("Max Sharpe", best.w, { m: best.m, v: best.v }, "#e3a13c"),
    minVar: strat("Min Variance", lowv.w, { m: lowv.m, v: lowv.v }, "#e3564d"),
    equalWeight: strat("Equal Weight", eqw, eqs, "#3fb24f"),
    corr: idx.map((i) => idx.map((j) => +(cov[i][j] / Math.sqrt(Math.max(cov[i][i] * cov[j][j], 1e-12))).toFixed(2))),
    corrLabels: core,
  };
}

function assetClassWeights(weightsBySymbol) {
  const classWeights = { Equity: 0, "Fixed Income": 0, Cash: 0, Alternatives: 0, FX: 0 };
  for (const [symbol, weight] of Object.entries(weightsBySymbol)) {
    const asset = INVESTABLE.find((item) => item.symbol === symbol);
    if (!asset) continue;
    classWeights[asset.assetClass] = (classWeights[asset.assetClass] || 0) + weight;
  }
  return classWeights;
}

function estimateFactorBetas(returnsBySymbol, factors, symbols) {
  const out = {};
  for (const s of symbols) {
    const r = returnsBySymbol[s] || [];
    const betas = {};
    for (const f of FACTOR_NAMES) {
      const ffAll = factors[f];
      const m = Math.min(r.length, ffAll.length);
      if (m < 2) { betas[f] = 0; continue; }
      const rOff = r.length - m, fOff = ffAll.length - m;
      let mr = 0, mf = 0;
      for (let t = 0; t < m; t += 1) { mr += r[rOff + t]; mf += ffAll[fOff + t]; }
      mr /= m; mf /= m;
      let cov = 0, varf = 0;
      for (let t = 0; t < m; t += 1) { const dr = r[rOff + t] - mr, df = ffAll[fOff + t] - mf; cov += dr * df; varf += df * df; }
      betas[f] = varf > 0 ? cov / varf : 0;
    }
    out[s] = betas;
  }
  return out;
}

module.exports = { covarianceMatrix, shrinkCovariance, correlationMatrix, computeRisk, effectiveBets, jacobiEigen, effectiveBetsPCA, portfolioExpectedReturn, requiredReturn, fundedRatio, normalCdf, probSuccess, targetVolFromUtility, behavioralPressure, buildGoal, klDrift, panicGame, ML_PRIORITY, mlPriority, portfolioReturnSeries, annualizedVol, drawdownStats, downsample, perfMetrics, expectedReturnVector, matInverse, frontierCurve, buildFrontier, buildOptimization, assetClassWeights, estimateFactorBetas };
