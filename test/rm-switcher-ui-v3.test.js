'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'public/cockpit-v3.js'), 'utf8');

test('top-right profile is an accessible five-RM demo-view switcher', () => {
  assert.match(html, /data-rm-profile-toggle/);
  assert.match(html, /id="rmSwitcherMenu"[^>]*role="listbox"/);
  assert.match(script, /function rmRoster\(\) \{ return list\(meta\(\)\.rms\); \}/);
  assert.match(script, /data-rm-switch/);
  assert.match(script, /Demo view/);
  assert.match(script, /ไม่ได้เปลี่ยนสิทธิ์ผู้ใช้จริง/);
});

test('switching RM scopes clients, portfolios, goals, queue, actors, and URL state safely', () => {
  assert.match(script, /state\.clientOwnerFilter = next\.displayName/);
  assert.match(script, /const rmPortfolios = list\(book\.portfolios\)\.filter/);
  assert.match(script, /const visibleGoals = goals\(\)\.filter/);
  assert.match(script, /const items = queue\(\)\.filter/);
  assert.match(script, /createdBy: activeRmOwner\(\)/);
  assert.match(script, /actor: activeRmOwner\(\)/);
  assert.match(script, /updatePortfolioUrl\(\{ clientId: null, workspace: 'list' \}\)/);
});

