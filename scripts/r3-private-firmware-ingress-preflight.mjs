// Read-only preflight for private ESP8266 sketches. NO network, uploads,
// firmware execution, debug logs, Firebase writes, or device access.
// Findings are static indicators, not proof of the currently flashed firmware.
import { lstatSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 512 * 1024;
const THIS_FILE = fileURLToPath(import.meta.url);

export function assessPrivateFirmwareSource(source) {
  if (typeof source !== 'string') throw new TypeError('Expected local source text');
  // Conservative static indicators: comments and dead code can cause false
  // positives. No credential contents, URLs, source or file paths are returned.
  const insecureTLS = /\.\s*setInsecure\s*\(/.test(source);
  const hasTLSValidationIndicator =
    /\.\s*(?:setTrustAnchors|setCACert|setFingerprint)\s*\(/.test(source);
  const directRestWriteIndicator =
    /\.\s*(?:PATCH|PUT|POST)\s*\(|\bHTTP_(?:PATCH|PUT|POST)\b/.test(source);
  const livePathIndicator = /floodguard\s*\/\s*live/i.test(source);
  const restAuthIndicator =
    /(?:\bauth=|\baccess_token=|Authorization\s*[:\]]|Bearer\s)/i.test(source);

  return Object.freeze({
    insecureTLS,
    hasTLSValidationIndicator,
    directRestWriteIndicator,
    livePathIndicator,
    restAuthIndicator,
    firmwareFlashedVerified: false,
    authenticatedWriteVerified: false,
    physicalSensorVerified: false,
    releaseDecision: 'NO_GO',
  });
}

function readPrivateSketch(filePath) {
  if (extname(filePath).toLowerCase() !== '.ino') {
    throw new Error('audit_refused');
  }
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() ||
      stat.size < 1 || stat.size > MAX_BYTES) {
    throw new Error('audit_refused');
  }
  // No file contents, paths, credentials, or firmware identifiers are logged.
  return readFileSync(filePath, 'utf8');
}

export function privateFirmwareAudit(filePath) {
  return assessPrivateFirmwareSource(readPrivateSketch(filePath));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(THIS_FILE)) {
  try {
    if (process.argv.length !== 3) throw new Error('audit_refused');
    const report = privateFirmwareAudit(process.argv[2]);
    for (const key of [
      'insecureTLS', 'hasTLSValidationIndicator', 'directRestWriteIndicator',
      'livePathIndicator', 'restAuthIndicator',
      'firmwareFlashedVerified', 'authenticatedWriteVerified',
      'physicalSensorVerified',
    ]) {
      console.log(key + '=' + (report[key] ? 'YES' : 'NO'));
    }
    console.log('releaseDecision=NO_GO');
    // Exit 2 deliberately: a static sketch inspection is never operational
    // acceptance, irrespective of apparent security indicators.
    process.exitCode = 2;
  } catch {
    console.error('audit_refused: invalid or inaccessible private .ino file');
    process.exitCode = 2;
  }
}
