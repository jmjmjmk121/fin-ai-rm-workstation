'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function filesBelow(target) {
  const absolute = path.join(ROOT, target);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [absolute];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(target, entry.name);
    return entry.isDirectory() ? filesBelow(relative) : [path.join(ROOT, relative)];
  });
}

test('committable application sources contain no UUID-shaped credential or hard-coded SETSMART key', () => {
  const files = [
    ...filesBelow('lib'),
    ...filesBelow('public'),
    ...filesBelow('docs'),
    ...filesBelow('server.js'),
    ...filesBelow('README.md'),
    ...filesBelow('SETSMART_SETUP.md'),
    ...filesBelow('.env.example'),
    ...filesBelow('.env.local.example'),
  ];
  const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(source, /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
  assert.doesNotMatch(source, /SETSMART_API_KEY\s*=\s*(?!replace_with_)[^\s#]+/i);

  const browserSource = filesBelow('public').map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(browserSource, /SETSMART_API_KEY|authorization\s*[:=]|api[-_]?key/i);
});

test('local secret files are ignored and the package cannot be accidentally published', () => {
  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(gitignore, /^\.env\.\*$/m);
  assert.equal(packageJson.private, true);
});
