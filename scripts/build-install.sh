#!/usr/bin/env bash
# Build the Vox iOS app and install it on a connected iPhone.
#
# Real-device run flow (per memory: project_self_test_infra):
#   1. xcodegen regenerates Vox.xcodeproj from project.yml
#   2. xcodebuild builds Debug for the connected device
#   3. devicectl installs + launches; PollClient resumes polling /cmd/next
#
# After install: run any of the E2E drivers (tests/voice-e2e-real-lifecycle.mjs,
# tests/voice-e2e-l2.mjs) which talk to the bridge on :3205.
#
# Required environment:
#   VOX_DEVICE_ECID   xcodebuild destination id for the device
#   VOX_DEVICE_UUID   devicectl UUID for install/launch
# Optional:
#   VOX_BUNDLE_ID     bundle id to launch after install

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IOS_DIR="$ROOT/ios"
BUNDLE_ID="${VOX_BUNDLE_ID:-com.example.vox}"

if [[ -z "${VOX_DEVICE_ECID:-}" || -z "${VOX_DEVICE_UUID:-}" ]]; then
  echo "Set VOX_DEVICE_ECID and VOX_DEVICE_UUID before installing to a physical device." >&2
  exit 2
fi
DEVICE_ECID="$VOX_DEVICE_ECID"
DEVICE_UUID="$VOX_DEVICE_UUID"

cd "$IOS_DIR"

echo "==> xcodegen"
xcodegen generate >/dev/null

echo "==> xcodebuild (device: $DEVICE_ECID)"
LOG=$(mktemp)
if ! xcodebuild \
    -project Vox.xcodeproj \
    -scheme Vox \
    -destination "id=$DEVICE_ECID" \
    -configuration Debug \
    build > "$LOG" 2>&1; then
  echo "build failed — last 60 lines:" >&2
  tail -60 "$LOG" >&2
  exit 1
fi

APP_PATH=$(grep -oE '/[^ ]*Vox\.app' "$LOG" | head -1)
if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  # Fallback: derived data
  APP_PATH=$(find "$HOME/Library/Developer/Xcode/DerivedData" -name 'Vox.app' -path '*Debug-iphoneos*' -print -quit 2>/dev/null || true)
fi
if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  echo "could not locate Vox.app after build" >&2
  exit 1
fi
echo "    .app: $APP_PATH"

echo "==> devicectl install"
xcrun devicectl device install app --device "$DEVICE_UUID" "$APP_PATH" >/dev/null

echo "==> devicectl launch (foreground)"
# --terminate-existing replaces any running instance so PollClient picks up the new bundle.
xcrun devicectl device process launch --device "$DEVICE_UUID" --terminate-existing "$BUNDLE_ID" >/dev/null

echo "==> done — app launched. Wait ~3s then poll bridge /cmd/next."
