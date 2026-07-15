# FIN AI — modular backend (`lib/`)

`lib/` is the canonical backend. The root `server.js` is a thin HTTP layer that
requires `lib/dashboard` and serves `public/`. The previous single-file build is
kept as `server.legacy.js` for reference only.

## Modules (dependency order)

| Module         | Responsibility |
|----------------|----------------|
| `config.js`    | Risk policy, personas, expected returns, MIME, constants (`RISK_FREE`, `CACHE_MS`) |
| `util.js`      | Seeded RNG + small vector/stat helpers (`dot`, `matrixVector`, `clamp`, …) |
| `universe.js`  | 105-asset universe, Fama–French + BAB factor model, market data / fallbacks |
| `quant.js`     | Covariance + shrinkage, efficient frontier, **`buildOptimization`**, goal math, info + game theory, ML priority, performance metrics |
| `routing.js`   | Inbound overflow + AI-assist routing |
| `clients.js`   | Client book generation + per-client `analyzeClient` (incl. `holdingsCorr`) |
| `dashboard.js` | Assembles the `/api/dashboard` payload |

Each module declares its imports at the top and `module.exports` at the bottom —
no shared globals, no circular requires.

## Run

```bash
node server.js            # http://127.0.0.1:4187
```

## Regenerate `lib/` from the legacy monolith

`lib/` is produced from `server.legacy.js` by a deterministic splitter:

```bash
node tools/regen-lib.js   # rewrites lib/*.js from server.legacy.js
```

## Parity

`lib/` output is byte-identical to `server.legacy.js` for `buildDashboard("live", true)`,
ignoring the two non-deterministic timestamps (`generatedAt`, `marketAsOf`).

## Snapshot (offline standalone cockpit)

```bash
node -e 'require("./lib/dashboard").buildDashboard("live",true).then(d=>{ /* embed into fin_ai_rm_cockpit_full.html */ })'
```
