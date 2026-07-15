const { pct, clamp } = require("./util");
const { srlLabel, RISK_FREE, CACHE_MS } = require("./config");
const { TICKERS, INVESTABLE, loadMarketData, returnsFromSeries, fallbackSeries, symbolMoves, scenarioAdjustment, scenarioLabel, HISTORY_DAYS, buildFactorReturns } = require("./universe");
const { covarianceMatrix, correlationMatrix, jacobiEigen, buildFrontier, buildOptimization, annualizedVol, drawdownStats, downsample, estimateFactorBetas } = require("./quant");
const { generateClientBook, analyzeClient } = require("./clients");
const { buildInbound } = require("./routing");

let dashboardCache = null;

let cacheTime = 0;

function buildMarketTable(market, moves, scenario) {
  return TICKERS.map((t) => {
    const mv = moves[t.symbol] || { last: 0, day: 0, fiveDay: 0, twentyDay: 0 };
    const adj = scenarioAdjustment(scenario, t.symbol);
    const rets = returnsFromSeries(market[t.symbol] || fallbackSeries(t.symbol));
    const dd = drawdownStats(rets);
    return {
      symbol: t.symbol, name: t.name, assetClass: t.assetClass, theme: t.theme,
      price: mv.last, day: mv.day + adj, fiveDay: mv.fiveDay + adj * 0.75, twentyDay: mv.twentyDay,
      annVol: annualizedVol(rets), periodReturn: dd.growth - 1, maxDrawdown: dd.maxDrawdown,
      spark: downsample(dd.curve, 30),
    };
  });
}

// Per-symbol expected return from capital-market assumptions (by asset class).

function buildMarketSignals(moves, scenario) {
  const items = TICKERS.map((ticker) => {
    const move = moves[ticker.symbol] || { day: 0, fiveDay: 0, twentyDay: 0 };
    return {
      ...ticker,
      last: move.last,
      day: move.day + scenarioAdjustment(scenario, ticker.symbol),
      fiveDay: move.fiveDay + scenarioAdjustment(scenario, ticker.symbol) * 0.75,
      twentyDay: move.twentyDay,
    };
  });

  const sorted = [...items].sort((a, b) => Math.abs(b.day) - Math.abs(a.day));
  const top = sorted[0];
  const second = sorted[1];
  const third = sorted[2];
  const tape = [
    {
      level: top.day < 0 ? "risk-off" : "risk-on",
      text: `${top.name} ${top.day >= 0 ? "up" : "down"} ${pct(Math.abs(top.day))} today. Sensitive portfolios moved to the top of the RM call list.`,
    },
    {
      level: "monitor",
      text: `${second.name} ${second.day >= 0 ? "up" : "down"} ${pct(Math.abs(second.day))}. Drift checks recalculated against each client's SRL band.`,
    },
    {
      level: "client",
      text: `${third.name} move is being translated into client-specific talking points, not generic market commentary.`,
    },
  ];
  return { watchlist: items, tape };
}

function buildSummary(clients, marketSignals, errors) {
  const urgent = clients.filter((client) => client.analysis.priorityScore >= 70).length;
  const srlBreaches = clients.filter((client) => client.analysis.srlBreach).length;
  const dynamicGaps = clients.filter((client) => Math.abs(client.analysis.srlGap) >= 2).length;
  const behaviorHigh = clients.filter((client) => client.analysis.behaviorRisk > 0.7).length;
  const topSignal = [...marketSignals.watchlist].sort((a, b) => Math.abs(b.day) - Math.abs(a.day))[0];
  return [
    { label: "Clients scanned", value: clients.length.toString(), tone: "neutral", sub: "synthetic RM book" },
    { label: "Urgent calls", value: urgent.toString(), tone: urgent > 15 ? "bad" : "warn", sub: "response score >= 70" },
    { label: "SRL breaches", value: srlBreaches.toString(), tone: "warn", sub: "dynamic risk above baseline" },
    { label: "Dynamic gaps", value: dynamicGaps.toString(), tone: "warn", sub: "2+ SRL gap vs baseline" },
    { label: "Behavior risk", value: behaviorHigh.toString(), tone: behaviorHigh > 20 ? "bad" : "warn", sub: "high response sensitivity" },
    { label: "Data mode", value: errors.length ? "Hybrid" : "Live", tone: errors.length ? "warn" : "good", sub: topSignal ? `${topSignal.symbol} is top signal` : "market loaded" },
  ];
}

async function buildDashboard(scenario = "live", force = false) {
  const now = Date.now();
  if (!force && dashboardCache && dashboardCache.scenario === scenario && now - cacheTime < CACHE_MS) {
    return dashboardCache;
  }

  const { market, errors } = await loadMarketData();
  const symbols = INVESTABLE.map((item) => item.symbol);
  const returnsBySymbol = {};
  for (const symbol of symbols) {
    returnsBySymbol[symbol] = symbol === "CASH" ? new Array(HISTORY_DAYS).fill(RISK_FREE / 252) : returnsFromSeries(market[symbol] || fallbackSeries(symbol));
  }
  const cov = covarianceMatrix(returnsBySymbol, symbols);
  const corr = correlationMatrix(cov, symbols);
  const eigen = jacobiEigen(cov); // computed once; reused for every client's PCA effective bets
  const factorReturns = buildFactorReturns(HISTORY_DAYS + 1);
  const factorBetas = estimateFactorBetas(returnsBySymbol, factorReturns, symbols); // OLS loadings (once)
  const moves = {};
  for (const ticker of TICKERS) moves[ticker.symbol] = symbolMoves(market[ticker.symbol]);

  const marketSignals = buildMarketSignals(moves, scenario);
  const marketTable = buildMarketTable(market, moves, scenario);
  const frontier = buildFrontier(cov, symbols);
  const optimization = buildOptimization(cov, symbols, returnsBySymbol);
  const clients = generateClientBook()
    .map((client) => analyzeClient(client, symbols, cov, moves, scenario, returnsBySymbol, eigen, factorBetas))
    .sort((a, b) => b.analysis.priorityScore - a.analysis.priorityScore);
  const inbound = buildInbound(clients);
  const summaryCards = buildSummary(clients, marketSignals, errors);
  const asOfTimestamp = Math.max(...Object.values(moves).map((move) => move.timestamp || 0)) * 1000;

  dashboardCache = {
    scenario,
    scenarioLabel: scenarioLabel(scenario),
    generatedAt: new Date().toISOString(),
    marketAsOf: new Date(asOfTimestamp || Date.now()).toISOString(),
    source: errors.length ? "Yahoo Finance with deterministic fallback" : "Yahoo Finance chart API",
    errors,
    symbols,
    universe: INVESTABLE,
    summaryCards,
    marketSignals,
    marketTable,
    frontier,
    optimization,
    inbound,
    clients,
    covariance: { symbols, corr },
    methodology: {
      staticSuitability: "static SRL 1-7 is generated at onboarding from risk profile, objective, liquidity horizon, and capacity constraints",
      dynamicSuitability: "dynamic SRL 1-7 is inferred daily from portfolio volatility, then nudged by behavioral memory",
      variance: "portfolio variance = wT Sigma w; Sigma = constant-correlation shrinkage (Ledoit-Wolf style) of the annualized sample covariance",
      riskContribution: "Euler risk contribution i = wi * (Sigma w)i / portfolio volatility; sum_i RC_i = sigma_p",
      effectiveBets: "information theory: effective number of bets = exp(Shannon entropy of risk-contribution shares) (Meucci 2009)",
      effectiveBetsPCA: "information theory (rigorous): effective bets on UNCORRELATED principal components via eigendecomposition of Sigma; N = exp(-sum p_k ln p_k), p_k = (e_k.w)^2 lambda_k / sigma_p^2 (Meucci minimum-torsion idea)",
      syntheticData: "synthetic prices use a Fama-French + Betting-Against-Beta factor model (market, size, value, momentum, low-beta) + idiosyncratic noise, so correlations and the covariance eigen-structure are realistic",
      factorExposures: "factor risk premia (CQD/CQF): each asset's loadings beta_f are estimated by OLS factor regression; a portfolio's factor exposure = sum_i w_i * beta_{i,f} for f in {market, size, value, momentum, low-beta}",
      suitabilityDriftKL: "information theory: suitability/allocation drift = relative entropy (Kullback-Leibler) D(current || policy) = sum_i p_i ln(p_i/q_i)",
      goalLayer: "goal-based: required return g* = (target/current)^(1/years) - 1; funded ratio = (1+mu_p)^T / (1+g*)^T (on track if >= 1)",
      utility: "psychology -> target risk via mean-variance utility U = E(Rp) - 0.5*A*sigma^2, A = relative risk aversion (CRRA); target vol clipped to suitable band",
      gameTheory: "stay-the-course coordination game (Stag Hunt, Yildiz 2024); payoffs a,c,d derived from the client's real metrics (expected return, today's loss, sigma x loss-aversion VaR); panic-sell risk when stay-confidence < risk-dominance threshold p* = (d-c)/(a+d)",
      mlPriority: "machine learning: priority = logistic regression sigma(w·x + b) = P(client needs RM action today); coefficients ILLUSTRATIVE here, fitted offline on labeled outcomes in production",
      performance: "PortfolioVisualizer-style: annualized return (CAGR), annualized volatility, Sharpe = (CAGR-rf)/vol, Sortino, max drawdown, best/worst day, equity curve — from the portfolio daily return series rp = sum_i w_i r_i",
      probSuccess: "goal probability: P(reach goal) = Phi([ln(W0/Wgoal) + (muP - 0.5 sigmaP^2)T] / (sigmaP sqrt(T))) under lognormal terminal wealth, real-world measure (uses muP not r)",
      inboundRouting: "inbound overflow: each concurrent call routes to the owner RM if free, else a backup RM, else an AI assistant gives a grounded info-only draft queued for RM approval",
      roadmap: "production roadmap (not in this demo): FinBERT news sentiment, supervised persona classifier, full Ledoit-Wolf optimal-delta, per-client sigma_req QP solver",
    },
  };
  cacheTime = now;
  return dashboardCache;
}

module.exports = { buildMarketTable, buildMarketSignals, buildSummary, buildDashboard };
