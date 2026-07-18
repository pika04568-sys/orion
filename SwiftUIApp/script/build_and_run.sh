#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="Orion"
BUNDLE_ID="com.orion.browser"
APP_VERSION="1.1.0"
MIN_SYSTEM_VERSION="15.4"
BUILD_CONFIGURATION="release"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"
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

if [[ "$MODE" == "--debug" || "$MODE" == "debug" ]]; then
  BUILD_CONFIGURATION="debug"
fi

if ! swift build -c "$BUILD_CONFIGURATION" -debug-info-format none >"$BUILD_LOG" 2>&1; then
  if grep -Fq "Unknown error parsing property list" "$BUILD_LOG"; then
    echo "SwiftPM default backend hit the known property-list initialization error; retrying with native backend." >&2
    BUILD_BACKEND=(--build-system native)
    swift build -c "$BUILD_CONFIGURATION" "${BUILD_BACKEND[@]}" -debug-info-format none
  else
    cat "$BUILD_LOG" >&2
    exit 1
  fi
fi
if [[ "$MODE" == "--test" || "$MODE" == "test" ]]; then
  swift test "${BUILD_BACKEND[@]}" --disable-xctest --enable-swift-testing
  if ! xcrun --find xctest >/dev/null 2>&1; then
    bash "$ROOT_DIR/script/run_swift_testing_runner.sh"
  fi
fi
BUILD_BIN_DIR="$(swift build -c "$BUILD_CONFIGURATION" "${BUILD_BACKEND[@]}" -debug-info-format none --show-bin-path)"
BUILD_BINARY="$BUILD_BIN_DIR/$APP_NAME"
RESOURCE_BUNDLE="$BUILD_BIN_DIR/Orion_Orion.bundle"

rm -rf "$APP_BUNDLE" "$DIST_DIR/SwiftUIApp.app"
mkdir -p "$APP_MACOS" "$APP_RESOURCES"
cp "$BUILD_BINARY" "$APP_BINARY"
chmod +x "$APP_BINARY"
if [[ -d "$RESOURCE_BUNDLE" ]]; then
  cp -R "$RESOURCE_BUNDLE" "$APP_RESOURCES/"
fi
if [[ -f "$ROOT_DIR/../assets/orion.icns" ]]; then
  cp "$ROOT_DIR/../assets/orion.icns" "$APP_RESOURCES/Orion.icns"
fi

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
  <key>CFBundleDisplayName</key>
  <string>$APP_NAME</string>
  <key>CFBundleShortVersionString</key>
  <string>$APP_VERSION</string>
  <key>CFBundleVersion</key>
  <string>$APP_VERSION</string>
  <key>CFBundleIconFile</key>
  <string>Orion</string>
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
    for _ in {1..30}; do
      sleep 0.5
      pgrep -x "$APP_NAME" >/dev/null
    done
    pkill -x "$APP_NAME" >/dev/null 2>&1 || true
    ;;
  --test|test)
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify|--test]" >&2
    exit 2
    ;;
esac
