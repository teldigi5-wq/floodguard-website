import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Vercel selects a Node major from engines.node; it rolls out patches itself.
 * Verify a patched Node 24 release at build time independently of semver.
 */
export function isPatchedNode24(value) {
  const match = /^24\\.(\\d+)\\.(\\d+)$/.exec(value);
  if (!match) return false;
  const minor = Number(match[1]);
  const patch = Number(match[2]);
  return Number.isSafeInteger(minor) && Number.isSafeInteger(patch) &&
    (minor > 22 || (minor === 22 && patch >= 1));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!isPatchedNode24(process.versions.node)) {
    console.error('Security gate: Node.js 24.22.1 or newer Node 24 is required for this build.');
    process.exitCode = 1;
  }
}
