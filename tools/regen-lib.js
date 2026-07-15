// Regenerate the modular backend into lib/ from the canonical monolith (server.legacy.js).
// Promotion of the former test-modular/ split, updated for buildOptimization + factor model.
const fs = require("fs");
const SRC = fs.existsSync("server.legacy.js") ? "server.legacy.js" : "server.js";
const src = fs.readFileSync(SRC, "utf8").split("\n");
const defRe = /^(?:async\s+)?function\s+(\w+)|^const\s+(\w+)\s*=|^let\s+(\w+)\s*=/;
const bounds = [];
src.forEach((ln, i) => { const m = ln.match(defRe); if (m) bounds.push({ line: i, name: m[1] || m[2] || m[3] }); });
bounds.push({ line: src.length, name: "__END__" });
const source = {};
for (let i = 0; i < bounds.length - 1; i++) { const { line, name } = bounds[i]; let end = bounds[i + 1].line; let block = src.slice(line, end); while (block.length && block[block.length - 1].trim() === "") block.pop(); source[name] = (source[name] ? source[name] + "\n" : "") + block.join("\n"); }
const M = {
  CORE_ASSETS: "universe", FX_ASSET: "universe", buildExtendedUniverse: "universe", UNIVERSE: "universe", TICKERS: "universe", INVESTABLE: "universe", ASSET_PROFILE: "universe", ASSET_BY_SYMBOL: "universe", FACTOR_NAMES: "universe", FACTOR_VOL: "universe", FACTOR_DRIFT: "universe", FACTOR_CACHE: "universe", HISTORY_DAYS: "universe", ASSET_BETAS: "universe", assetBetas: "universe", buildFactorReturns: "universe", factorSeries: "universe", fallbackSeries: "universe", fetchYahooChart: "universe", loadMarketData: "universe", returnsFromSeries: "universe", symbolMoves: "universe", scenarioAdjustment: "universe", scenarioLabel: "universe",
  RISK_PROFILES: "config", PROFILE_BASE_SRL: "config", SRL_LEVELS: "config", PERSONAS: "config", PERSONA_RISK_AVERSION: "config", CLASS_EXPECTED_RETURN: "config", MIME: "config", CACHE_MS: "config", RISK_FREE: "config", srlLabel: "config",
  seededRandom: "util", mulberry32: "util", clamp: "util", pct: "util", sum: "util", dot: "util", matrixVector: "util", normalize: "util", average: "util",
  covarianceMatrix: "quant", shrinkCovariance: "quant", correlationMatrix: "quant", computeRisk: "quant", effectiveBets: "quant", jacobiEigen: "quant", effectiveBetsPCA: "quant", estimateFactorBetas: "quant", portfolioExpectedReturn: "quant", requiredReturn: "quant", fundedRatio: "quant", normalCdf: "quant", probSuccess: "quant", targetVolFromUtility: "quant", behavioralPressure: "quant", buildGoal: "quant", klDrift: "quant", panicGame: "quant", ML_PRIORITY: "quant", mlPriority: "quant", portfolioReturnSeries: "quant", annualizedVol: "quant", drawdownStats: "quant", downsample: "quant", perfMetrics: "quant", expectedReturnVector: "quant", buildFrontier: "quant", buildOptimization: "quant", matInverse: "quant", frontierCurve: "quant", assetClassWeights: "quant",
  RM_TEAM: "routing", RM_CAPACITY: "routing", inboundIntent: "routing", aiAssistAnswer: "routing", buildInbound: "routing",
  sampleAssets: "clients", buildWeightsForClient: "clients", buildSuitabilityBaseline: "clients", buildBehaviorMemory: "clients", generateClientBook: "clients", dynamicSrlFromVol: "clients", draftClientMessage: "clients", portfolioEventImpact: "clients", analyzeClient: "clients",
  buildMarketTable: "dashboard", buildMarketSignals: "dashboard", buildSummary: "dashboard", buildDashboard: "dashboard", dashboardCache: "dashboard", cacheTime: "dashboard",
  sendJson: "server", serveStatic: "server", server: "server", PORT: "server", PUBLIC_DIR: "server", http: "SKIP", fs: "SKIP", path: "SKIP",
};
const headers = {
  config: "", util: "",
  universe: `const { seededRandom } = require("./util");`,
  quant: `const { clamp, sum, dot, matrixVector, average } = require("./util");\nconst { CLASS_EXPECTED_RETURN, RISK_FREE } = require("./config");\nconst { INVESTABLE, FACTOR_NAMES, CORE_ASSETS } = require("./universe");`,
  routing: "",
  clients: `const { clamp, pct, normalize, mulberry32, seededRandom, average, sum } = require("./util");\nconst { RISK_PROFILES, PROFILE_BASE_SRL, SRL_LEVELS, PERSONAS, PERSONA_RISK_AVERSION, srlLabel } = require("./config");\nconst { INVESTABLE, scenarioAdjustment, FACTOR_NAMES } = require("./universe");\nconst { computeRisk, assetClassWeights, portfolioExpectedReturn, effectiveBets, effectiveBetsPCA, requiredReturn, fundedRatio, probSuccess, buildGoal, klDrift, panicGame, behavioralPressure, targetVolFromUtility, mlPriority, perfMetrics, portfolioReturnSeries } = require("./quant");`,
  dashboard: `const { pct, clamp } = require("./util");\nconst { srlLabel, RISK_FREE, CACHE_MS } = require("./config");\nconst { TICKERS, INVESTABLE, loadMarketData, returnsFromSeries, fallbackSeries, symbolMoves, scenarioAdjustment, scenarioLabel, HISTORY_DAYS, buildFactorReturns } = require("./universe");\nconst { covarianceMatrix, correlationMatrix, jacobiEigen, buildFrontier, buildOptimization, annualizedVol, drawdownStats, downsample, estimateFactorBetas } = require("./quant");\nconst { generateClientBook, analyzeClient } = require("./clients");\nconst { buildInbound } = require("./routing");`,
};
const order = ["config", "util", "universe", "quant", "routing", "clients", "dashboard"];
const mods = {}, own = {}; order.forEach(m => { mods[m] = []; own[m] = []; });
const un = [];
for (const { name } of bounds) { if (name === "__END__") continue; const m = M[name]; if (!m) { un.push(name); continue; } if (m === "SKIP" || m === "server") continue; if (!mods[m]) continue; mods[m].push(source[name]); own[m].push(name); }
if (un.length) console.log("UNASSIGNED:", un.join(","));
if (!fs.existsSync("lib")) fs.mkdirSync("lib");
order.forEach(m => { const ex = own[m].filter(n => n !== "dashboardCache" && n !== "cacheTime"); const body = (headers[m] ? headers[m] + "\n\n" : "") + mods[m].join("\n\n") + `\n\nmodule.exports = { ${ex.join(", ")} };\n`; fs.writeFileSync("lib/" + m + ".js", body); });
console.log("lib modules written:", order.join(", "));
