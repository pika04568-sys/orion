#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEVELOPER_DIRECTORY="${DEVELOPER_DIR:-/Library/Developer/CommandLineTools}"
FRAMEWORKS_DIRECTORY="$DEVELOPER_DIRECTORY/Library/Developer/Frameworks"
LIBRARY_DIRECTORY="$DEVELOPER_DIRECTORY/Library/Developer/usr/lib"
SDK_PATH="$(xcrun --sdk macosx --show-sdk-path)"
BIN_DIRECTORY="$(swift build --build-system native -c debug --show-bin-path)"
LINK_FILE="$BIN_DIRECTORY/OrionPackageTests.product/Objects.LinkFileList"
RUNNER="$BIN_DIRECTORY/OrionSwiftTestingRunner"
RUNNER_MAIN_OBJECT="$BIN_DIRECTORY/OrionSwiftTestingMain.swift.o"
FILTERED_LINK_FILE="$(mktemp "${TMPDIR:-/tmp}/orion-test-objects.XXXXXX")"

cleanup() {
  rm -f "$FILTERED_LINK_FILE"
}
trap cleanup EXIT

if [[ ! -f "$LINK_FILE" ]]; then
  echo "Swift Testing objects are missing. Run swift test first." >&2
  exit 1
fi

# The app target and SwiftPM's inert CLT runner both define entry points.
# Link the app as a library and supply a runner that imports Testing directly.
grep -Ev 'Orion.build/OrionApp.swift.o|OrionPackageTests.build/runner.swift.o' \
  "$LINK_FILE" >"$FILTERED_LINK_FILE"

swiftc \
  -module-name OrionSwiftTestingMain \
  -parse-as-library \
  -c "$ROOT_DIR/script/SwiftTestingMain.swift" \
  -o "$RUNNER_MAIN_OBJECT" \
  -F "$FRAMEWORKS_DIRECTORY" \
  -I "$FRAMEWORKS_DIRECTORY" \
  -sdk "$SDK_PATH"

swiftc \
  -L "$BIN_DIRECTORY" \
  -o "$RUNNER" \
  -module-name OrionPackageTests \
  -Xlinker -no_warn_duplicate_libraries \
  -Xlinker -rpath \
  -Xlinker "$FRAMEWORKS_DIRECTORY" \
  -Xlinker -rpath \
  -Xlinker "$LIBRARY_DIRECTORY" \
  @"$FILTERED_LINK_FILE" \
  "$RUNNER_MAIN_OBJECT" \
  -F "$FRAMEWORKS_DIRECTORY" \
  -I "$FRAMEWORKS_DIRECTORY" \
  -L "$FRAMEWORKS_DIRECTORY" \
  -sdk "$SDK_PATH"

"$RUNNER" --testing-library swift-testing
