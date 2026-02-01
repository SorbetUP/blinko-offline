#!/usr/bin/env bash
set -euo pipefail

APP_BIN="${1:-/Applications/Blinko.app/Contents/MacOS/Blinko}"
BUILD_BIN="/Users/sorbet/Desktop/Dev/blinko/blinko-offline/app/src-tauri/target/release/bundle/macos/Blinko.app/Contents/MacOS/Blinko"

if [[ ! -x "$APP_BIN" ]]; then
  if [[ -x "$BUILD_BIN" ]]; then
    APP_BIN="$BUILD_BIN"
  else
    echo "Blinko binary not found. Provide path as arg1." >&2
    exit 1
  fi
fi

LOG_DIR="$HOME/Library/Application Support/com.blinko.app"
DB="$LOG_DIR/blinko_local.db"

"$APP_BIN" >/tmp/blinko-smoke.log 2>&1 &
pid=$!

sleep 20
kill "$pid" >/dev/null 2>&1 || true

if [[ ! -f "$DB" ]]; then
  echo "DB not found at $DB" >&2
  exit 1
fi

echo "== tail runtime log =="
tail -n 80 /tmp/blinko-smoke.log || true

echo "== sqlite tables =="
sqlite3 "$DB" "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"

echo "== cached notes count =="
sqlite3 "$DB" "SELECT count(*) FROM cached_notes;"

echo "== pending ops count =="
sqlite3 "$DB" "SELECT count(*) FROM pending_ops;"
