#!/usr/bin/env bash
# H25: only invoked inside firebase-tools emulators:exec, not against cloud.
set -euo pipefail

test "${FG_H25_BROWSER_LAB:-}" = "1"
test "${GCLOUD_PROJECT:-}" = "demo-floodguard-r3"
test "${FIREBASE_DATABASE_EMULATOR_HOST:-}" = "127.0.0.1:19001"
test "${NEXT_PUBLIC_FG_R3_EMULATOR_LAB:-}" = "1"
test "${NEXT_PUBLIC_FIREBASE_DATABASE_URL:-}" = "https://demo-floodguard-r3-default-rtdb.firebasedatabase.app"
test "${NEXT_PUBLIC_FIREBASE_LIVE_PATH:-}" = "floodguard/live"
test -z "${FIREBASE_TOKEN:-}"
test -z "${GOOGLE_APPLICATION_CREDENTIALS:-}"
test ! -e .floodguard-private-evidence
test -d out

# First prove that the actual local Rules engine (not a mock or imported
# production rules) denies private paths and unauthenticated writes.
node --test tests/r3-firebase-emulator.test.mjs

python3 -m http.server 4173 --bind 127.0.0.1 --directory out > /tmp/fg-h25-browser-http.log 2>&1 &
server_pid=$!
cleanup() {
  kill "$server_pid" 2>/dev/null || true
}
trap cleanup EXIT
for i in {1..35}; do
  if curl --silent --fail http://127.0.0.1:4173/ > /dev/null; then
    FG_H25_BROWSER_LAB=1 node --test tests/browser/h25-sdk-emulator-chromium.test.mjs
    exit $?
  fi
  sleep 1
done
cat /tmp/fg-h25-browser-http.log
exit 1
