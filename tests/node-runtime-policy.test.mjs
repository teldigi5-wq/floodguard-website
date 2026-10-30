import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPatchedNode24 } from '../scripts/check-node-runtime.mjs';

test('supported production Node release lines start at Brotli-KEV patched builds', () => {
  const expected = '^24.22.1';
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const npmOptions = readFileSync('.npmrc', 'utf8').split(/\r?\n/);

  assert.equal(manifest.engines.node, expected);
  assert.equal(lock.packages[''].engines.node, expected);
  assert.equal(readFileSync('.nvmrc', 'utf8').trim(), '24.22.1');
  assert.ok(npmOptions.includes('engine-strict=true'));
  assert.match(ci, /node-version: '24[.]22[.]1'/);
  assert.match(manifest.scripts.build, /node scripts\/check-node-runtime[.]mjs && next build/);
  assert.match(manifest.scripts['build:amplify'], /node scripts\/check-node-runtime[.]mjs && next build/);
});

test('runtime guard rejects vulnerable Node 24 patches and unexpected major upgrades', () => {
  for (const version of ['24.22.1', '24.22.2', '24.23.0', '24.100.0'])
    assert.equal(isPatchedNode24(version), true, version);
  for (const version of ['24.21.99','24.22.0','22.23.4','26.12.1',
    '24.23.0-rc1','24.23.','24..1','24.0.0','not-a-version',null])
    assert.equal(isPatchedNode24(version), false, String(version));
});
