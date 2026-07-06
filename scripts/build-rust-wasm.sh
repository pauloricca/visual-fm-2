#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
IMAGE="${RUST_WASM_IMAGE:-visual-fm-rust-wasm:1.87}"
CRATE_DIR="/work/rust/visual-fm-kernel"
PUBLIC_OUTPUT="/work/web/public/audio/visual-fm-kernel.wasm"
DIST_OUTPUT="/work/web/dist/audio/visual-fm-kernel.wasm"

mkdir -p "$ROOT/web/public/audio" "$ROOT/web/dist/audio"

if [ "${RUST_WASM_SKIP_IMAGE_BUILD:-0}" != "1" ]; then
  docker build \
    -f "$ROOT/rust/visual-fm-kernel/Dockerfile" \
    -t "$IMAGE" \
    "$ROOT"
fi

docker run --rm \
  -v "$ROOT:/work" \
  -w "$CRATE_DIR" \
  "$IMAGE" \
  sh -c "cargo build --release --target wasm32-unknown-unknown && cp target/wasm32-unknown-unknown/release/visual_fm_kernel.wasm '$PUBLIC_OUTPUT' && cp target/wasm32-unknown-unknown/release/visual_fm_kernel.wasm '$DIST_OUTPUT'"

printf 'Wrote %s\n' "$ROOT/web/public/audio/visual-fm-kernel.wasm"
