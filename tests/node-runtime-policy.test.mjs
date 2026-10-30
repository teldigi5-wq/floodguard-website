import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('supported production Node release lines start at Brotli-KEV patched builds', () => {
  const expected = '^22.23.4 || ^24.22.1 || ^26.12.1';
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const npmOptions = readFileSync('.npmrc', 'utf8').split(/\r?\n/);

  assert.equal(manifest.engines.node, expected);
  assert.equal(lock.packages[''].engines.node, expected);
  assert.equal(readFileSync('.nvmrc', 'utf8').trim(), '22.23.4');
  assert.ok(npmOptions.includes('engine-strict=true'));
  assert.match(ci, /node-version: '22[.]23[.]4'/);
});
