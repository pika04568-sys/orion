#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAMPLES="${ORION_PERF_SAMPLES:-20}"
TIMEOUT_SECONDS="${ORION_PERF_TIMEOUT_SECONDS:-15}"

if [[ "${1:-}" == "--samples" ]]; then
  SAMPLES="${2:?missing sample count}"
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--samples count]" >&2
  exit 2
fi

if ! [[ "$SAMPLES" =~ ^[1-9][0-9]*$ ]]; then
  echo "sample count must be a positive integer" >&2
  exit 2
fi

CACHE_ROOT="${ORION_SWIFT_CACHE_DIR:-${TMPDIR:-/tmp}/orion-swift-perf-$(uname -m)}"
SCRATCH_PATH="$CACHE_ROOT/build"
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/orion-perf.XXXXXX")"
PORT_FILE="$RUN_DIR/port"
SERVER_PID=""
APP_PID=""

cleanup() {
  if [[ -n "$APP_PID" ]]; then
    kill "$APP_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$RUN_DIR"
}
trap cleanup EXIT INT TERM

mkdir -p "$SCRATCH_PATH"
cd "$ROOT_DIR"

BUILD_BACKEND=()
BUILD_LOG="$RUN_DIR/swift-build.log"
if ! swift build -c release --scratch-path "$SCRATCH_PATH" >"$BUILD_LOG" 2>&1; then
  if grep -Fq "Unknown error parsing property list" "$BUILD_LOG"; then
    echo "SwiftPM default backend hit the known property-list initialization error; retrying with native backend." >&2
    BUILD_BACKEND=(--build-system native)
    swift build -c release --scratch-path "$SCRATCH_PATH" "${BUILD_BACKEND[@]}"
  else
    cat "$BUILD_LOG" >&2
    exit 1
  fi
fi

BIN_PATH="$(swift build -c release --scratch-path "$SCRATCH_PATH" "${BUILD_BACKEND[@]}" --show-bin-path)"
ORION_BINARY="$BIN_PATH/Orion"

/usr/bin/python3 "$ROOT_DIR/Tests/Fixtures/perf_server.py" "$ROOT_DIR/Tests/Fixtures" "$PORT_FILE" \
  >"$RUN_DIR/server.log" 2>&1 &
SERVER_PID=$!

for _ in {1..100}; do
  [[ -s "$PORT_FILE" ]] && break
  sleep 0.05
done
if [[ ! -s "$PORT_FILE" ]]; then
  echo "performance fixture server did not start" >&2
  exit 1
fi

PORT="$(<"$PORT_FILE")"
for ((sample = 1; sample <= SAMPLES; sample += 1)); do
  RESULT="$RUN_DIR/sample-$sample.json"
  PROCESS_STARTED_NS="$(/usr/bin/python3 -c 'import time; print(time.monotonic_ns())')"
  ORION_PERF_URL="http://127.0.0.1:$PORT/perf.html" \
    ORION_PERF_OUTPUT="$RESULT" \
    ORION_PERF_PROCESS_STARTED_NS="$PROCESS_STARTED_NS" \
    "$ORION_BINARY" >"$RUN_DIR/orion-$sample.log" 2>&1 &
  APP_PID=$!

  deadline=$((SECONDS + TIMEOUT_SECONDS))
  while [[ ! -s "$RESULT" ]] && kill -0 "$APP_PID" >/dev/null 2>&1; do
    if ((SECONDS >= deadline)); then
      echo "sample $sample timed out after ${TIMEOUT_SECONDS}s" >&2
      exit 1
    fi
    sleep 0.05
  done

  wait "$APP_PID" || true
  APP_PID=""
  if [[ ! -s "$RESULT" ]]; then
    echo "sample $sample exited without producing metrics" >&2
    exit 1
  fi
done

/usr/bin/python3 - "$RUN_DIR" "$SAMPLES" <<'PY'
import json
import math
import pathlib
import sys

directory = pathlib.Path(sys.argv[1])
sample_count = int(sys.argv[2])
samples = [json.loads((directory / f"sample-{index}.json").read_text()) for index in range(1, sample_count + 1)]
budgets = {
    "shellVisibleMs": 600.0,
    "webViewReadyMs": 150.0,
    "navigationDispatchMs": 20.0,
    "firstContentfulPaintMs": 400.0,
    "loadCompleteMs": 500.0,
    "newTabMs": 100.0,
    "tabSwitchMs": 50.0,
    "mainThreadStallMs": 50.0,
}

def percentile(values, quantile):
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * quantile) - 1)]

report = {"samples": sample_count, "metrics": {}}
failed = False
for key, budget in budgets.items():
    values = [float(sample[key]) for sample in samples if sample.get(key) is not None]
    if len(values) != sample_count:
        raise SystemExit(f"missing {key} values: expected {sample_count}, got {len(values)}")
    if any(value <= 0 for value in values):
        raise SystemExit(f"invalid non-positive {key} value")
    p50 = percentile(values, 0.50)
    p95 = percentile(values, 0.95)
    passed = p95 <= budget
    failed = failed or not passed
    report["metrics"][key] = {"p50": round(p50, 2), "p95": round(p95, 2), "budget": budget, "passed": passed}

print(json.dumps(report, indent=2, sort_keys=True))
raise SystemExit(1 if failed else 0)
PY
