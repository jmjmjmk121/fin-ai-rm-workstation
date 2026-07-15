'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'public/cockpit-v3.js'), 'utf8');

test('main navigation exposes one unified portfolio allocation workspace', () => {
  assert.match(html, /data-view="portfolios"[^>]*>พอร์ตและการจัดสรร</);
  assert.doesNotMatch(html, /data-view="builder"/);
  assert.doesNotMatch(html, /data-view="portfolio"/);
  assert.match(script, /function renderPortfolioAllocation\(\)/);
  assert.match(script, /const next = `\/portfolios\$\{params\.size/);
  assert.match(script, /RM กำหนด asset และน้ำหนัก/);
});

test('builder exposes all-client holding book, SETSMART search, manual weights, and four governed comparisons', () => {
  assert.match(script, /Client Holding Book · \$\{esc\(rmPortfolios\.length\)\} clients/);
  assert.match(script, /ลูกค้าคนไหนถือ asset อะไร/);
  assert.match(script, /data-builder-weight/);
  assert.match(script, /data-builder-search/);
  assert.match(script, /Current vs RM Draft vs Model Diagnostic vs No-action/);
  assert.match(script, /P&L ย้อนหลัง \(บาท\)/);
  assert.match(script, /ไม่ใช่ realized\/unrealized P&L/);
  assert.match(script, /clientHoldingSource:'RM_DRAFT'/);
  assert.match(script, /ดูและจัดพอร์ต/);
  assert.match(script, /portfolioWorkspace/);
  assert.match(script, /ภาพรวม.*ผลตอบแทน.*ความเสี่ยง.*จัดพอร์ต.*เปรียบเทียบ.*ผลต่อเป้าหมาย.*ประวัติร่าง/);
  assert.match(script, /มี RM Draft ที่ยังไม่ได้บันทึก/);
  assert.match(script, /บันทึก Draft Proposal/);
  assert.match(script, /event\.target\.matches\('\[data-builder-weight\]'\)\)updateBuilderWeight/);
  assert.match(script, /data-builder-save \$\{overWeight\|\|!holdings\.length\?'disabled':''\}/);
  assert.match(script, /\['performance','builder','compare'\]\.includes\(state\.portfolioWorkspace\)/);
});

test('builder UI labels source separation and contains no execution path', () => {
  assert.match(script, /Asset และราคา: SETSMART จริง/);
  assert.match(script, /ลูกค้า\/จำนวนหน่วย\/สถานะถือครอง: Demo Client Data/);
  assert.match(script, /ไม่มี auto-trade/);
  assert.doesNotMatch(script, /data-builder-(?:trade|send|execute)/i);
});

test('unified route preserves selected client and old portfolio routes redirect', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /decodedPath === '\/portfolios'/);
  assert.match(server, /portfolio-builder.*portfolio-risk.*\/builder.*\/portfolio/);
  assert.match(server, /redirect\(res, `\/portfolios\$\{url\.search \|\| ''\}`\)/);
  assert.match(script, /params\.set\('clientId', clientId\)/);
  assert.match(script, /params\.set\('workspace'/);
  assert.match(script, /openPortfolioClient/);
  assert.match(script, /resetBuilderDraft/);
});

test('important portfolio numbers remain calculator-backed and current stays separate from draft', () => {
  assert.match(script, /deterministic calculator/);
  assert.match(script, /Current และ Draft เป็นคนละ object/);
  assert.match(script, /Current Portfolio ไม่ถูกแก้/);
  assert.match(script, /scheduleBuilderAnalysis/);
  assert.doesNotMatch(script, /SETSMART_API_KEY/);
});
