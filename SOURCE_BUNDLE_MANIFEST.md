# FIN AI RM Workstation — Source Bundle

GitHub-ready source bundle generated on 2026-07-16.

## Included

- `server.js`, `package.json`, `LICENSE`
- `public/` — current RM workstation UI
- `lib/` — calculators, SETSMART providers, replay, governed AI and workflow logic
- `test/` — 174 automated tests
- `docs/`, `README.md`, `SETSMART_SETUP.md`
- `.gitignore`, `.env.example`, `.env.local.example`
- `tools/` and demo screenshots

## Deliberately excluded

- `.env.local` and every real credential
- caches, logs, temporary files and `node_modules`
- duplicate legacy presentation sources and generated office/PDF artifacts

## Run

```bash
npm test
npm start
```

Open `http://127.0.0.1:4187`. Fixture mode needs no API key. For SETSMART Live, create a local `.env.local` from `.env.example` and never commit it.

