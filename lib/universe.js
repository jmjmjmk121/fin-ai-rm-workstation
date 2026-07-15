const { seededRandom } = require("./util");

const CORE_ASSETS = [
  { symbol: "SPY", name: "US Equity", assetClass: "Equity", region: "Global", theme: "US broad market", profile: { start: 480, drift: 0.00035, vol: 0.009 } },
  { symbol: "QQQ", name: "US Tech", assetClass: "Equity", region: "Global", theme: "US technology", profile: { start: 410, drift: 0.00055, vol: 0.014 } },
  { symbol: "IWM", name: "US Small Cap", assetClass: "Equity", region: "Global", theme: "cyclical equities", profile: { start: 210, drift: 0.00025, vol: 0.013 } },
  { symbol: "EEM", name: "Emerging Markets", assetClass: "Equity", region: "Global", theme: "EM equities", profile: { start: 40, drift: 0.00012, vol: 0.011 } },
  { symbol: "FXI", name: "China Equity", assetClass: "Equity", region: "Global", theme: "China equities", profile: { start: 27, drift: 0.0001, vol: 0.018 } },
  { symbol: "THD", name: "Thai Equity (ETF)", assetClass: "Equity", region: "Thailand", theme: "Thai equities", profile: { start: 60, drift: 0.00006, vol: 0.012 } },
  { symbol: "TLT", name: "Long Duration Bond", assetClass: "Fixed Income", region: "Global", theme: "duration", profile: { start: 92, drift: -0.00005, vol: 0.01 } },
  { symbol: "BND", name: "Core Bond", assetClass: "Fixed Income", region: "Global", theme: "core bonds", profile: { start: 72, drift: 0.00005, vol: 0.003 } },
  { symbol: "SHY", name: "Short Treasury", assetClass: "Fixed Income", region: "Global", theme: "cash-like bonds", profile: { start: 82, drift: 0.00002, vol: 0.001 } },
  { symbol: "GLD", name: "Gold", assetClass: "Alternatives", region: "Global", theme: "gold", profile: { start: 210, drift: 0.00038, vol: 0.01 } },
];

const FX_ASSET = { symbol: "USDTHB=X", name: "USD/THB", assetClass: "FX", region: "Thailand", theme: "USDTHB", profile: { start: 36.7, drift: 0.00004, vol: 0.0038 } };

function buildExtendedUniverse() {
  let seed = 990017;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const out = [];
  const add = (prefix, region, cls, base, names) => names.forEach((nm, i) => {
    out.push({
      symbol: `${prefix}${String(i + 1).padStart(2, "0")}`, name: nm, assetClass: cls, region, theme: nm, synthetic: true,
      profile: { start: +(base.start * (0.6 + rnd())).toFixed(2), drift: base.drift * (0.4 + rnd() * 1.2), vol: base.vol * (0.6 + rnd()) },
    });
  });
  add("THEQ", "Thailand", "Equity", { start: 14, drift: 0.00010, vol: 0.012 }, [
    "Thai SET50 Index", "Thai SET100 Index", "Thai High Dividend", "Thai Mid-Small Cap", "Thai Banking Sector",
    "Thai Energy Sector", "Thai ICT Sector", "Thai Healthcare", "Thai Commerce", "Thai Tourism & Leisure",
    "Thai Property Developers", "Thai ESG Leaders", "Thai Value Equity", "Thai Growth Equity", "Thai Dividend Plus",
    "Thai Industrial", "Thai Food & Beverage", "Thai Construction", "Thai Big Cap", "Thai Equity Income",
    "Thai Small-Cap Dividend", "Thai New Economy"]);
  add("THFI", "Thailand", "Fixed Income", { start: 11, drift: 0.00004, vol: 0.0025 }, [
    "Thai Gov Bond Short", "Thai Gov Bond Mid", "Thai Gov Bond Long", "Thai Corporate Bond", "Thai Money Market",
    "Thai Inflation-Linked", "Thai Short-Term Note", "Thai Bond Plus", "Thai High-Grade Credit", "Thai Sustainable Bond",
    "Thai Term Fund 1Y", "Thai Enhanced Cash"]);
  add("THAL", "Thailand", "Alternatives", { start: 10, drift: 0.00006, vol: 0.009 }, [
    "Thai REIT", "Thai Property Fund", "Thai Infrastructure Fund", "Thai Gold Fund", "Thai Mixed Property",
    "Thai Logistics REIT", "Thai Office REIT", "Thai Retail REIT"]);
  add("GLEQ", "Global", "Equity", { start: 50, drift: 0.00030, vol: 0.012 }, [
    "US Large Cap", "US Technology", "US Small Cap", "Europe Equity", "Japan Equity", "China Equity", "India Equity",
    "EM Asia", "Global Dividend", "World ex-US", "Korea Equity", "Taiwan Equity", "Vietnam Equity", "ASEAN Equity",
    "Global Value", "Global Quality", "Global Min Volatility", "Frontier Markets", "Latin America Equity", "Global Infrastructure Eq"]);
  add("GLFI", "Global", "Fixed Income", { start: 80, drift: 0.00006, vol: 0.004 }, [
    "US Treasury Long", "US Aggregate Bond", "Global Corporate Bond", "EM Sovereign Bond", "Global High Yield",
    "TIPS Inflation", "Global Agg Hedged", "Asia Credit", "Green Bond", "Floating Rate"]);
  add("ALT", "Global", "Alternatives", { start: 100, drift: 0.00020, vol: 0.011 }, [
    "Gold Bullion", "Broad Commodity", "Oil & Gas", "Global REIT", "Global Infrastructure", "Silver", "Managed Futures", "Copper & Metals"]);
  add("THM", "Thematic", "Equity", { start: 30, drift: 0.00040, vol: 0.018 }, [
    "Global Technology", "AI & Robotics", "Clean Energy", "Semiconductors", "Healthcare Innovation", "Cybersecurity",
    "EV & Battery", "Cloud Computing", "Fintech", "Biotech", "Water Resources", "Global Consumer", "Space & Defense", "Agritech"]);
  return out;
}

const UNIVERSE = CORE_ASSETS.concat(buildExtendedUniverse());

const TICKERS = UNIVERSE.concat([FX_ASSET]);

const INVESTABLE = UNIVERSE.concat([
  { symbol: "CASH", name: "Cash (THB)", assetClass: "Cash", region: "Thailand", theme: "cash", profile: { start: 100, drift: 0.00008, vol: 0.0002 } },
]);

const ASSET_PROFILE = {};

const ASSET_BY_SYMBOL = {};
for (const a of INVESTABLE.concat([FX_ASSET])) { ASSET_PROFILE[a.symbol] = a.profile; ASSET_BY_SYMBOL[a.symbol] = a; }

// Variance decomposition by asset class: how each asset's variance splits across a common MARKET
// factor, its CLASS factor, its REGION factor, and idiosyncratic noise (fractions sum to 1).
// Shared factors create realistic cross-asset correlations (equities co-move, bonds less so), which
// gives a realistic covariance/eigenvalue structure for risk contribution and PCA effective bets.
// ===== FACTOR MODEL (Fama-French + Betting-Against-Beta) — from CQD/CQF factor risk premia =====
// Each asset return is driven by 5 priced factors + idiosyncratic noise. Shared factors create
// realistic correlations; small positive factor drifts represent the risk premia that drive returns.

const FACTOR_NAMES = ["MKT", "SMB", "HML", "WML", "BAB"]; // market, size, value, momentum, low-beta

const FACTOR_VOL = { MKT: 0.008, SMB: 0.0045, HML: 0.0045, WML: 0.005, BAB: 0.004 };

const FACTOR_DRIFT = { MKT: 0.00030, SMB: 0.00005, HML: 0.00006, WML: 0.00008, BAB: 0.00007 }; // daily premia

const FACTOR_CACHE = {};

const HISTORY_DAYS = 1260; // ~5 years of daily history, so yearly performance metrics are meaningful

const ASSET_BETAS = {};
for (const a of INVESTABLE.concat([FX_ASSET])) ASSET_BETAS[a.symbol] = assetBetas(a);

async function fetchYahooChart(symbol) {
  const encoded = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=1y&interval=1d`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 BookGuardAI/1.0",
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`Yahoo ${symbol} ${response.status}`);
  const json = await response.json();
  const result = json.chart && json.chart.result && json.chart.result[0];
  if (!result || !result.timestamp || !result.indicators.quote[0].close) {
    throw new Error(`Missing Yahoo data for ${symbol}`);
  }
  const closes = result.indicators.quote[0].close;
  return result.timestamp
    .map((timestamp, index) => ({ timestamp, close: closes[index] }))
    .filter((item) => Number.isFinite(item.close));
}

// Rule-based factor loadings (betas) from asset class + name/theme keywords (CQD-style characteristics):
// small-caps load on size (SMB); value/dividend/bank on value (HML); tech/AI/EV on momentum (WML) and
// negative value; low-vol/quality/bonds on low-beta (BAB); tech/biotech are high-beta (negative BAB).

function assetBetas(asset) {
  const cls = asset.assetClass;
  const txt = `${asset.name || ""} ${asset.theme || ""}`.toLowerCase();
  let MKT = cls === "Equity" ? 1.0 : cls === "Alternatives" ? 0.45 : cls === "Fixed Income" ? 0.15 : cls === "FX" ? 0.2 : 0.0;
  let SMB = 0, HML = 0, WML = 0, BAB = 0;
  if (cls === "Equity") {
    if (/small|mid|frontier|vietnam|asean|emerging|\bem\b/.test(txt)) SMB += 0.5;
    if (/large|big cap|set50|us large|world|global quality|min vol/.test(txt)) SMB -= 0.3;
    if (/value|dividend|bank|energy|property|reit|income/.test(txt)) HML += 0.5;
    if (/growth|tech|\bai\b|semiconductor|cloud|biotech|innovation|\bev\b|battery|new economy|fintech|space/.test(txt)) { HML -= 0.4; WML += 0.4; }
    if (/momentum/.test(txt)) WML += 0.5;
    if (/min vol|low vol|quality|dividend|healthcare|consumer/.test(txt)) BAB += 0.4;
    if (/tech|\bai\b|semiconductor|biotech|small|frontier/.test(txt)) BAB -= 0.3;
  } else if (cls === "Fixed Income") {
    BAB += 0.3; HML += 0.1;
  } else if (cls === "Alternatives") {
    if (/reit|property|infrastructure/.test(txt)) { HML += 0.3; MKT = 0.5; }
    if (/gold|silver|commodity|oil/.test(txt)) { MKT = 0.25; }
  }
  return { MKT, SMB, HML, WML, BAB };
}

// Deterministic factor RETURN series (drift = risk premium + standardized noise scaled by factor vol).

function buildFactorReturns(n) {
  if (FACTOR_CACHE.__ff && FACTOR_CACHE.__ff.MKT.length === n) return FACTOR_CACHE.__ff;
  const out = {};
  for (const f of FACTOR_NAMES) {
    const rng = seededRandom(f.split("").reduce((s, ch) => s + ch.charCodeAt(0), 0) + 13);
    const arr = [];
    for (let i = 0; i < n; i += 1) arr.push(FACTOR_DRIFT[f] + (rng() * 2 - 1) * Math.sqrt(3) * FACTOR_VOL[f]);
    out[f] = arr;
  }
  FACTOR_CACHE.__ff = out;
  return out;
}

// Factor-model synthetic price history: r = drift + sum_f beta_f * F_f + idiosyncratic, scaled so the
// total volatility matches the asset's target. Shared factors -> realistic correlations and a meaningful
// covariance / eigen / risk-contribution structure; factor premia drive long-run returns.

function fallbackSeries(symbol) {
  const asset = ASSET_BY_SYMBOL[symbol] || { assetClass: "Equity", region: "Global", profile: { start: 100, drift: 0.0001, vol: 0.01 } };
  const p = asset.profile;
  const n = HISTORY_DAYS + 1;
  const b = ASSET_BETAS[symbol] || assetBetas(asset);
  const F = buildFactorReturns(n);
  let sysVar = 0;
  for (const f of FACTOR_NAMES) sysVar += (b[f] * FACTOR_VOL[f]) ** 2;
  const idioVol = Math.sqrt(Math.max(p.vol * p.vol - sysVar, (0.3 * p.vol) ** 2));
  const idioR = seededRandom(symbol.split("").reduce((s, ch) => s + ch.charCodeAt(0), 0) + 991);
  const series = [];
  let close = p.start;
  const now = Math.floor(Date.now() / 1000);
  for (let i = n - 1; i >= 0; i -= 1) {
    const k = n - 1 - i;
    let sys = 0;
    for (const f of FACTOR_NAMES) sys += b[f] * F[f][k];
    const idio = (idioR() * 2 - 1) * Math.sqrt(3) * idioVol;
    const shock =
      i === 4 && asset.assetClass === "Equity" ? -0.018 :
      i === 3 && asset.assetClass === "Fixed Income" && asset.region === "Global" ? -0.010 : 0;
    const r = p.drift + sys + idio + shock;
    close = Math.max(0.1, close * (1 + r));
    series.push({ timestamp: now - i * 86400, close });
  }
  return series;
}

// OLS factor regression (CQD pipeline): estimate each asset's factor loadings from its realized returns.
// Factors are near-orthogonal, so a univariate beta_f = cov(r, F_f)/var(F_f) recovers the loadings.

async function loadMarketData() {
  const market = {};
  const errors = [];
  await Promise.all(
    TICKERS.map(async (ticker) => {
      if (ticker.synthetic) { market[ticker.symbol] = fallbackSeries(ticker.symbol); return; }
      try {
        market[ticker.symbol] = await fetchYahooChart(ticker.symbol);
      } catch (error) {
        errors.push(`${ticker.symbol}: ${error.message}`);
        market[ticker.symbol] = fallbackSeries(ticker.symbol);
      }
    })
  );
  return { market, errors };
}

function returnsFromSeries(series) {
  const returns = [];
  for (let i = 1; i < series.length; i += 1) {
    const prior = series[i - 1].close;
    const current = series[i].close;
    if (prior > 0 && current > 0) returns.push(current / prior - 1);
  }
  return returns.slice(-HISTORY_DAYS);
}

function symbolMoves(series) {
  const last = series[series.length - 1];
  const prior = series[series.length - 2] || last;
  const five = series[Math.max(0, series.length - 6)] || prior;
  const twenty = series[Math.max(0, series.length - 21)] || prior;
  return {
    last: last.close,
    day: prior.close ? last.close / prior.close - 1 : 0,
    fiveDay: five.close ? last.close / five.close - 1 : 0,
    twentyDay: twenty.close ? last.close / twenty.close - 1 : 0,
    timestamp: last.timestamp,
  };
}

function scenarioAdjustment(scenario, symbol) {
  const shocks = {
    live: {},
    tech: { QQQ: -0.075, SPY: -0.028, IWM: -0.03, EEM: -0.018, FXI: -0.025, TLT: 0.012, GLD: 0.007 },
    rates: { TLT: -0.055, BND: -0.016, SHY: -0.004, QQQ: -0.026, SPY: -0.014, "USDTHB=X": 0.011 },
    thb: { "USDTHB=X": 0.052, EEM: -0.017, THD: -0.026, GLD: 0.012 },
    china: { FXI: -0.085, EEM: -0.041, QQQ: -0.022, THD: -0.018, GLD: 0.008 },
  };
  return (shocks[scenario] && shocks[scenario][symbol]) || 0;
}

function scenarioLabel(scenario) {
  return {
    live: "Live market move",
    tech: "Scenario: US tech selloff",
    rates: "Scenario: rates shock",
    thb: "Scenario: THB weakness",
    china: "Scenario: China risk-off",
  }[scenario] || "Live market move";
}

module.exports = { CORE_ASSETS, FX_ASSET, buildExtendedUniverse, UNIVERSE, TICKERS, INVESTABLE, ASSET_PROFILE, ASSET_BY_SYMBOL, FACTOR_NAMES, FACTOR_VOL, FACTOR_DRIFT, FACTOR_CACHE, HISTORY_DAYS, ASSET_BETAS, fetchYahooChart, assetBetas, buildFactorReturns, fallbackSeries, loadMarketData, returnsFromSeries, symbolMoves, scenarioAdjustment, scenarioLabel };
