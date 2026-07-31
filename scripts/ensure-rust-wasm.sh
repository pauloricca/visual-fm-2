#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CRATE_DIR="$ROOT/rust/visual-fm-kernel"
WASM_OUTPUT="$ROOT/web/public/audio/visual-fm-kernel.wasm"
BUILD_SCRIPT="$ROOT/scripts/build-rust-wasm.sh"

rebuild_reason=""

if [ ! -f "$WASM_OUTPUT" ]; then
  rebuild_reason="the WASM kernel is missing"
else
  newer_input="$(
    find \
      "$CRATE_DIR/src" \
      "$CRATE_DIR/Cargo.toml" \
      "$CRATE_DIR/Cargo.lock" \
      "$CRATE_DIR/Dockerfile" \
      "$BUILD_SCRIPT" \
      -type f -newer "$WASM_OUTPUT" -print -quit
  )"
  if [ -n "$newer_input" ]; then
    rebuild_reason="$(printf '%s' "$newer_input" | sed "s|$ROOT/||") is newer than the WASM kernel"
  fi
fi

if [ -z "$rebuild_reason" ]; then
  printf 'WASM kernel is current.\n'
  exit 0
fi

printf 'Rebuilding Rust/WASM kernel: %s.\n' "$rebuild_reason"
cd "$ROOT"
npm run build:wasm

if [ ! -f "$WASM_OUTPUT" ]; then
  printf 'WASM build completed without creating %s.\n' "$WASM_OUTPUT" >&2
  exit 1
fi
