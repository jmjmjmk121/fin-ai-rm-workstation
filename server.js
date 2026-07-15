'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

function loadEnvLocal() {
  const file = path.join(__dirname, '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || line.trim().startsWith('#') || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

loadEnvLocal();

const {
  getWorkbench, getClient, prepareClientCase, stressClient, rebalanceClient, buildFrontierPayload,
  buildBusinessAnalyticsPayload, buildClientAnalyticsPayload,
} = require('./lib/workbench');
const { getThaiMarketContext } = require('./lib/setsmart');
const { simulateCrisisBook } = require('./lib/crisis-simulation');
const { createFinAiV3Application } = require('./lib/v3/application');
const { SECURITY_TYPES, createSetSmartListedProvider } = require('./lib/v3/setsmart-listed');
const { SetSmartListedProductDataProvider, createProductDataProviderRegistry } = require('./lib/v3/product-registry');
const { analyzePortfolioBuilder, buildClientHoldingBook, createPortfolioDraftStore } = require('./lib/v3/portfolio-builder');

// v3 defaults to offline mutual-fund fixtures. Live SETSMART mutual-fund calls
// remain contract-gated and cannot be reached without an injected authorised
// contract; the browser never receives the configured credential.
const v3Application = createFinAiV3Application();
const setsmartListedProvider = createSetSmartListedProvider();
const setsmartProductDataProvider = new SetSmartListedProductDataProvider({ listedProvider: setsmartListedProvider });
const productRegistry = createProductDataProviderRegistry({ setSmartProductProvider: setsmartProductDataProvider });
const portfolioDraftStore = createPortfolioDraftStore();

const PORT = Number(process.env.PORT || 4187);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function redirect(res, location, status = 302) {
  res.writeHead(status, { location, 'cache-control': 'no-store' });
  res.end();
}

function boundedInteger(value, fallback, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function paginateSetSmartAssets(result, options = {}) {
  const allRows = Array.isArray(result && result.observations) ? result.observations : [];
  const query = String(options.query || '').trim().toUpperCase().slice(0, 40);
  const requestedTypeRaw = String(options.securityType || 'All').toUpperCase();
  const requestedType = requestedTypeRaw === 'ALL' ? 'All' : requestedTypeRaw;
  if (!SECURITY_TYPES.has(requestedType)) {
    throw Object.assign(new Error('SETSMART_LISTED_SECURITY_TYPE_INVALID'), { statusCode: 400 });
  }
  const countsByType = allRows.reduce((counts, row) => {
    counts[row.securityType] = (counts[row.securityType] || 0) + 1;
    return counts;
  }, {});
  const filtered = allRows
    .filter((row) => requestedType === 'All' || row.securityType === requestedType)
    .filter((row) => !query || row.symbol.includes(query))
    .sort((left, right) => left.symbol.localeCompare(right.symbol) || left.securityType.localeCompare(right.securityType));
  const limit = boundedInteger(options.limit, 100, { minimum: 10, maximum: 200 });
  const offset = boundedInteger(options.offset, 0, { minimum: 0, maximum: Math.max(0, filtered.length) });
  const items = filtered.slice(offset, offset + limit).map((row) => ({
    date: row.date,
    symbol: row.symbol,
    productId: `SETSMART:${row.symbol}`,
    securityType: row.securityType,
    adjustedPriceFlag: row.adjustedPriceFlag,
    prior: row.prior,
    close: row.close,
    nav: row.nav,
    navField: row.navField,
    totalVolume: row.totalVolume,
    totalValue: row.totalValue,
    marketCap: row.marketCap,
    dividendYield: row.dividendYield,
    returnType: row.returnType,
    totalReturnAvailable: row.totalReturnAvailable,
    source: row.source,
  }));
  return {
    provider: 'SETSMART',
    mode: 'live',
    marketAsOf: result.marketAsOf,
    adjustedPriceFlag: result.adjustedPriceFlag,
    totalUniverse: allRows.length,
    filteredTotal: filtered.length,
    countsByType,
    query,
    securityType: requestedType,
    limit,
    offset,
    nextOffset: offset + limit < filtered.length ? offset + limit : null,
    previousOffset: offset > 0 ? Math.max(0, offset - limit) : null,
    items,
    cache: result.cache,
    source: result.source,
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 50_000) reject(Object.assign(new Error('REQUEST_TOO_LARGE'), { statusCode: 413 }));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(Object.assign(new Error('INVALID_JSON'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, requested);
  if (file !== PUBLIC_DIR && !file.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'",
    });
    res.end(data);
  });
}

async function routeApi(req, res, url) {
  if (url.pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      service: 'FIN-AI RM Workspace',
      credentialStatus: process.env.SETSMART_API_KEY ? 'CONFIGURED_SERVER_SIDE' : 'NOT_CONFIGURED',
      provider: v3Application.providerStatus(),
      listedMarketProvider: setsmartListedProvider.providerStatus(),
      productRegistry: productRegistry.providerStatus(),
      time: new Date().toISOString(),
    });
    return true;
  }
  if (url.pathname === '/api/workbench' && req.method === 'GET') {
    sendJson(res, 200, await getWorkbench());
    return true;
  }
  if (url.pathname === '/api/v3/bootstrap' && req.method === 'GET') {
    sendJson(res, 200, await v3Application.bootstrap());
    return true;
  }
  if (url.pathname === '/api/v3/performance' && req.method === 'GET') {
    sendJson(res, 200, await v3Application.buildPerformance());
    return true;
  }
  if (url.pathname === '/api/v3/market/setsmart-listed' && req.method === 'GET') {
    sendJson(res, 200, await setsmartListedProvider.getLatestBySecurityType({
      securityType: url.searchParams.get('securityType') || 'UT',
      adjustedPriceFlag: url.searchParams.get('adjustedPriceFlag') || 'Y',
      asOfDate: url.searchParams.get('asOf') || undefined,
      lookbackDays: url.searchParams.get('lookbackDays') || 7,
    }));
    return true;
  }
  if (url.pathname === '/api/v3/market/setsmart-assets' && req.method === 'GET') {
    const universe = await setsmartListedProvider.getLatestBySecurityType({
      securityType: 'All',
      adjustedPriceFlag: url.searchParams.get('adjustedPriceFlag') || 'Y',
      asOfDate: url.searchParams.get('asOf') || undefined,
      lookbackDays: url.searchParams.get('lookbackDays') || 7,
    });
    sendJson(res, 200, paginateSetSmartAssets(universe, {
      query: url.searchParams.get('query') || '',
      securityType: url.searchParams.get('securityType') || 'All',
      limit: url.searchParams.get('limit') || 100,
      offset: url.searchParams.get('offset') || 0,
    }));
    return true;
  }
  const setsmartHistoryMatch = url.pathname.match(/^\/api\/v3\/market\/setsmart-history\/([^/]+)$/);
  if (setsmartHistoryMatch && req.method === 'GET') {
    sendJson(res, 200, await setsmartListedProvider.getBySymbol({
      symbol: decodeURIComponent(setsmartHistoryMatch[1]),
      startDate: url.searchParams.get('startDate'),
      endDate: url.searchParams.get('endDate') || undefined,
      adjustedPriceFlag: url.searchParams.get('adjustedPriceFlag') || 'Y',
    }));
    return true;
  }
  if (url.pathname === '/api/v3/products' && req.method === 'GET') {
    sendJson(res, 200, await productRegistry.searchProducts({
      source: url.searchParams.get('source') || 'SETSMART',
      q: url.searchParams.get('query') || '',
      securityType: url.searchParams.get('securityType') || 'All',
      limit: url.searchParams.get('limit') || 100,
      offset: url.searchParams.get('offset') || 0,
      sortBy: url.searchParams.get('sortBy') || 'symbol',
      sortDirection: url.searchParams.get('sortDirection') || 'asc',
      minClose: url.searchParams.get('minClose') || undefined,
      maxClose: url.searchParams.get('maxClose') || undefined,
      minMarketCap: url.searchParams.get('minMarketCap') || undefined,
      minTotalValue: url.searchParams.get('minTotalValue') || undefined,
      asOfDate: url.searchParams.get('asOf') || undefined,
    }));
    return true;
  }
  const productHistoryMatch = url.pathname.match(/^\/api\/v3\/products\/([^/]+)\/history$/);
  if (productHistoryMatch && req.method === 'GET') {
    sendJson(res, 200, await productRegistry.getHistory(
      decodeURIComponent(productHistoryMatch[1]),
      url.searchParams.get('startDate'),
      url.searchParams.get('endDate') || undefined,
    ));
    return true;
  }
  const productMatch = url.pathname.match(/^\/api\/v3\/products\/([^/]+)$/);
  if (productMatch && req.method === 'GET') {
    sendJson(res, 200, await productRegistry.getProduct(decodeURIComponent(productMatch[1])));
    return true;
  }
  if (url.pathname === '/api/v3/portfolio-builder/book' && req.method === 'GET') {
    const [bootstrap, universe] = await Promise.all([
      v3Application.bootstrap(),
      setsmartListedProvider.getLatestBySecurityType({ securityType: 'All', adjustedPriceFlag: 'Y', lookbackDays: 7 }),
    ]);
    const book = buildClientHoldingBook(bootstrap.clients, universe);
    sendJson(res, 200, {
      ...book,
      totalUniverse: universe.observationCount,
      cache: universe.cache,
      source: universe.source,
    });
    return true;
  }
  if (url.pathname === '/api/v3/portfolio-builder/analyze' && req.method === 'POST') {
    const body = await readJson(req);
    const [bootstrap, universe] = await Promise.all([
      v3Application.bootstrap(),
      setsmartListedProvider.getLatestBySecurityType({ securityType: 'All', adjustedPriceFlag: 'Y', lookbackDays: 7 }),
    ]);
    const client = bootstrap.clients.find((item) => item.clientId === body.clientId);
    if (!client) throw Object.assign(new Error('BUILDER_CLIENT_NOT_FOUND'), { statusCode: 404 });
    sendJson(res, 200, await analyzePortfolioBuilder(body, { client, universeResult: universe, productRegistry }));
    return true;
  }
  if (url.pathname === '/api/v3/portfolio-builder/drafts' && req.method === 'GET') {
    const clientId = String(url.searchParams.get('clientId') || '');
    if (!clientId) throw Object.assign(new Error('PORTFOLIO_DRAFT_CLIENT_REQUIRED'), { statusCode: 400 });
    sendJson(res, 200, { clientId, drafts: portfolioDraftStore.list(clientId) });
    return true;
  }
  if (url.pathname === '/api/v3/portfolio-builder/drafts' && req.method === 'POST') {
    const body = await readJson(req);
    const bootstrap = await v3Application.bootstrap();
    if (!bootstrap.clients.some((client) => client.clientId === body.clientId)) {
      throw Object.assign(new Error('PORTFOLIO_DRAFT_CLIENT_NOT_FOUND'), { statusCode: 404 });
    }
    sendJson(res, 201, portfolioDraftStore.save({ ...body, createdBy: 'RM คุณพลอย' }));
    return true;
  }
  if (url.pathname === '/api/v3/replay' && req.method === 'GET') {
    sendJson(res, 200, url.searchParams.get('detail') === 'full'
      ? v3Application.historicalReplay()
      : v3Application.replaySummary());
    return true;
  }
  const v3ActionDecisionMatch = url.pathname.match(/^\/api\/v3\/actions\/([^/]+)\/decisions$/);
  if (v3ActionDecisionMatch && req.method === 'POST') {
    const body = await readJson(req);
    sendJson(res, 200, await v3Application.recordDecision(decodeURIComponent(v3ActionDecisionMatch[1]), body));
    return true;
  }
  const v3ActionMatch = url.pathname.match(/^\/api\/v3\/actions\/([^/]+)$/);
  if (v3ActionMatch && req.method === 'GET') {
    sendJson(res, 200, await v3Application.actionDetail(decodeURIComponent(v3ActionMatch[1])));
    return true;
  }
  const v3FundMatch = url.pathname.match(/^\/api\/v3\/funds\/([^/]+)$/);
  if (v3FundMatch && req.method === 'GET') {
    sendJson(res, 200, await v3Application.fundDetail(decodeURIComponent(v3FundMatch[1])));
    return true;
  }
  if (url.pathname === '/api/market/thai' && req.method === 'GET') {
    sendJson(res, 200, await getThaiMarketContext());
    return true;
  }
  if (url.pathname === '/api/frontier' && req.method === 'GET') {
    sendJson(res, 200, buildFrontierPayload(url.searchParams.get('clientId') || undefined));
    return true;
  }
  if (url.pathname === '/api/analytics/business' && req.method === 'GET') {
    sendJson(res, 200, buildBusinessAnalyticsPayload());
    return true;
  }
  if (url.pathname === '/api/simulation/crisis' && req.method === 'GET') {
    const shockParam = url.searchParams.get('shock');
    const clientParam = url.searchParams.get('clients');
    const rmParam = url.searchParams.get('rmCount');
    const rawShock = Number(shockParam == null ? -25 : shockParam);
    const riskyAssetShock = -Math.abs(Math.abs(rawShock) > 1 ? rawShock / 100 : rawShock);
    sendJson(res, 200, simulateCrisisBook({
      clientCount: Number(clientParam == null ? 3000 : clientParam),
      rmCount: Number(rmParam == null ? 20 : rmParam),
      riskyAssetShock,
    }));
    return true;
  }
  const analyticsClientMatch = url.pathname.match(/^\/api\/analytics\/client\/([^/]+)$/);
  if (analyticsClientMatch && req.method === 'GET') {
    sendJson(res, 200, buildClientAnalyticsPayload(decodeURIComponent(analyticsClientMatch[1])));
    return true;
  }

  const clientMatch = url.pathname.match(/^\/api\/clients\/([^/]+)(?:\/(prepare|stress|rebalance))?$/);
  if (!clientMatch) return false;
  const clientId = decodeURIComponent(clientMatch[1]);
  const action = clientMatch[2];
  if (!action && req.method === 'GET') {
    sendJson(res, 200, getClient(clientId));
    return true;
  }
  if (action === 'prepare' && req.method === 'GET') {
    sendJson(res, 200, prepareClientCase(clientId));
    return true;
  }
  if (action === 'stress' && req.method === 'POST') {
    const body = await readJson(req);
    sendJson(res, 200, stressClient(clientId, body.scenarioId));
    return true;
  }
  if (action === 'rebalance' && req.method === 'GET') {
    sendJson(res, 200, rebalanceClient(clientId));
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      if (await routeApi(req, res, url)) return;
      sendJson(res, 404, { error: 'API_NOT_FOUND' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }); res.end('Method not allowed'); return;
    }
    const decodedPath = decodeURIComponent(url.pathname);
    const legacyPortfolioPaths = new Set(['/portfolio-builder', '/portfolio-risk', '/builder', '/portfolio', '/สร้างพอร์ต', '/พอร์ตและความเสี่ยง']);
    if (legacyPortfolioPaths.has(decodedPath)) {
      redirect(res, `/portfolios${url.search || ''}`);
      return;
    }
    if (decodedPath === '/portfolios') {
      serveStatic(res, '/index.html');
      return;
    }
    serveStatic(res, decodeURIComponent(url.pathname));
  } catch (error) {
    const status = error.statusCode || 500;
    sendJson(res, status, {
      error: error.message || 'INTERNAL_ERROR',
      detail: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`FIN-AI RM Workspace: http://${HOST}:${PORT}`);
    console.log(process.env.SETSMART_API_KEY ? 'SETSMART: server-side key configured' : 'SETSMART: demo mode (no server-side key)');
  });
}

module.exports = { server, routeApi, readJson, loadEnvLocal, paginateSetSmartAssets, setsmartListedProvider, productRegistry, portfolioDraftStore };
