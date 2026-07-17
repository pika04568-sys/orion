#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="Orion"
BUNDLE_ID="com.kenokayasu.Orion"
MIN_SYSTEM_VERSION="14.0"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_BINARY="$APP_MACOS/$APP_NAME"
INFO_PLIST="$APP_CONTENTS/Info.plist"

pkill -x "$APP_NAME" >/dev/null 2>&1 || true
pkill -x "SwiftUIApp" >/dev/null 2>&1 || true

cd "$ROOT_DIR"
BUILD_BACKEND=()
BUILD_LOG="$(mktemp "${TMPDIR:-/tmp}/orion-swift-build.XXXXXX")"
cleanup_build_log() {
  rm -f "$BUILD_LOG"
}
trap cleanup_build_log EXIT

if ! swift build -debug-info-format none >"$BUILD_LOG" 2>&1; then
  if grep -Fq "Unknown error parsing property list" "$BUILD_LOG"; then
    echo "SwiftPM default backend hit the known property-list initialization error; retrying with native backend." >&2
    BUILD_BACKEND=(--build-system native)
    swift build "${BUILD_BACKEND[@]}" -debug-info-format none
  else
    cat "$BUILD_LOG" >&2
    exit 1
  fi
fi
BUILD_BINARY="$(swift build "${BUILD_BACKEND[@]}" -debug-info-format none --show-bin-path)/$APP_NAME"

rm -rf "$APP_BUNDLE" "$DIST_DIR/SwiftUIApp.app"
mkdir -p "$APP_MACOS"
cp "$BUILD_BINARY" "$APP_BINARY"
chmod +x "$APP_BINARY"

cat >"$INFO_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>$MIN_SYSTEM_VERSION</string>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST

open_app() {
  /usr/bin/open -n "$APP_BUNDLE"
}

case "$MODE" in
  run)
    open_app
    ;;
  --debug|debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    open_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  --telemetry|telemetry)
    open_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    open_app
    sleep 1
    pgrep -x "$APP_NAME" >/dev/null
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
