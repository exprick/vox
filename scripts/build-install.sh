#!/usr/bin/env bash
# Build the Vox iOS app and install it on a connected iPhone.
#
# Real-device run flow (per memory: project_self_test_infra):
#   1. xcodegen regenerates Vox.xcodeproj from project.yml
#   2. xcodebuild builds Debug for the connected device
#   3. devicectl installs + launches; PollClient resumes polling /cmd/next
#
# After install: run any of the E2E drivers (tests/voice-e2e-real-lifecycle.mjs,
# tests/voice-e2e-l2.mjs) which talk to the bridge on :3203.
#
# Required environment:
#   VOX_DEVICE_ECID   xcodebuild destination id for the device
#   VOX_DEVICE_UUID   devicectl UUID for install/launch
# Optional:
#   VOX_BUNDLE_ID     bundle id to launch after install
#   VOX_BRIDGE_BASE   bridge URL reachable by the device, e.g. http://192.168.1.10:3203
#   VOX_BRIDGE_PERSIST  defaults to 0 for localhost/LAN bridges and 1 otherwise
#   DEVELOPMENT_TEAM  Apple team id for local signing, if not already set in Xcode

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IOS_DIR="$ROOT/ios"
BUNDLE_ID="${VOX_BUNDLE_ID:-com.example.vox}"
DERIVED_DATA_PATH="${VOX_DERIVED_DATA_PATH:-$IOS_DIR/DerivedData}"

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
BUILD_ARGS=(
    -project Vox.xcodeproj \
    -scheme Vox \
    -destination "id=$DEVICE_ECID" \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    -configuration Debug \
    -allowProvisioningUpdates \
    build
)
if [[ -n "${DEVELOPMENT_TEAM:-}" ]]; then
  BUILD_ARGS+=(DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM")
fi
if [[ -n "${VOX_BUNDLE_ID:-}" ]]; then
  BUILD_ARGS+=(PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID")
fi
if ! xcodebuild "${BUILD_ARGS[@]}" > "$LOG" 2>&1; then
  echo "build failed — last 60 lines:" >&2
  tail -60 "$LOG" >&2
  exit 1
fi

APP_PATH=$(grep -oE '/[^ ]*Vox\.app' "$LOG" | head -1)
if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  # Fallback: derived data
  APP_PATH=$(find "$DERIVED_DATA_PATH" -name 'Vox.app' -path '*Debug-iphoneos*' -print -quit 2>/dev/null || true)
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
LAUNCH_ARGS=(device process launch --device "$DEVICE_UUID" --terminate-existing "$BUNDLE_ID")
if [[ -n "${VOX_BRIDGE_BASE:-}" ]]; then
  ENV_JSON=$(VOX_BRIDGE_BASE="$VOX_BRIDGE_BASE" node -e 'console.log(JSON.stringify({VOX_BRIDGE_BASE: process.env.VOX_BRIDGE_BASE}))')
  if [[ -z "${VOX_BRIDGE_PERSIST:-}" ]]; then
    case "$VOX_BRIDGE_BASE" in
      http://127.*|http://localhost*|http://10.*|http://172.1[6-9].*|http://172.2[0-9].*|http://172.3[0-1].*|http://192.168.*)
        VOX_BRIDGE_PERSIST=0
        ;;
      *)
        VOX_BRIDGE_PERSIST=1
        ;;
    esac
  fi
  PAYLOAD_URL=$(VOX_BRIDGE_BASE="$VOX_BRIDGE_BASE" VOX_BRIDGE_PERSIST="$VOX_BRIDGE_PERSIST" node -e 'const qs = new URLSearchParams({ bridge: process.env.VOX_BRIDGE_BASE, persist: process.env.VOX_BRIDGE_PERSIST }); console.log(`vox://config?${qs}`)')
  LAUNCH_ARGS+=(--environment-variables "$ENV_JSON" --payload-url "$PAYLOAD_URL")
fi
xcrun devicectl "${LAUNCH_ARGS[@]}" >/dev/null

echo "==> done — app launched. Wait ~3s then poll bridge /cmd/next."
