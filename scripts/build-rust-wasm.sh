#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
IMAGE="${RUST_WASM_IMAGE:-teia-rust-wasm:1.87}"
CRATE_DIR="/work/rust/teia-kernel"
PUBLIC_OUTPUT="/work/editor/public/audio/teia-kernel.wasm"
DIST_OUTPUT="/work/editor/dist/audio/teia-kernel.wasm"

mkdir -p "$ROOT/editor/public/audio" "$ROOT/editor/dist/audio"

if [ "${RUST_WASM_SKIP_IMAGE_BUILD:-0}" != "1" ]; then
  docker build \
    -f "$ROOT/rust/teia-kernel/Dockerfile" \
    -t "$IMAGE" \
    "$ROOT"
fi

docker run --rm \
  -v "$ROOT:/work" \
  -w "$CRATE_DIR" \
  "$IMAGE" \
  sh -c "cargo build --release --target wasm32-unknown-unknown && cp target/wasm32-unknown-unknown/release/teia_kernel.wasm '$PUBLIC_OUTPUT' && cp target/wasm32-unknown-unknown/release/teia_kernel.wasm '$DIST_OUTPUT'"

# The optional single-thread SIMD module is selected only after WASM feature
# validation in the editor/player. Keep the ordinary module for older hosts.
docker run --rm \
  -v "$ROOT:/work" \
  -w "$CRATE_DIR" \
  -e CARGO_TARGET_DIR=target/simd \
  -e 'RUSTFLAGS=-C target-feature=+simd128' \
  "$IMAGE" \
  sh -c 'cargo build --release --target wasm32-unknown-unknown && cp target/simd/wasm32-unknown-unknown/release/teia_kernel.wasm /work/editor/public/audio/teia-kernel-simd.wasm && cp target/simd/wasm32-unknown-unknown/release/teia_kernel.wasm /work/editor/dist/audio/teia-kernel-simd.wasm'

# Rebuild std with atomics for the shared-memory variant. The ordinary kernel
# above keeps its original toolchain flags and remains the single-mode baseline.
docker run --rm \
  -v "$ROOT:/work" \
  -w "$CRATE_DIR" \
  -e RUSTC_BOOTSTRAP=1 \
  -e CARGO_TARGET_DIR=target/parallel \
  -e 'RUSTFLAGS=-C target-feature=+atomics,+bulk-memory,+mutable-globals -C link-arg=--shared-memory -C link-arg=--import-memory -C link-arg=--export-memory -C link-arg=--export=__stack_pointer -C link-arg=--initial-memory=33554432 -C link-arg=--max-memory=2147483648' \
  "$IMAGE" \
  sh -c 'cargo build -Z build-std=std,panic_abort --features parallel --release --target wasm32-unknown-unknown && cp target/parallel/wasm32-unknown-unknown/release/teia_kernel.wasm /work/editor/public/audio/teia-kernel-parallel.wasm && cp target/parallel/wasm32-unknown-unknown/release/teia_kernel.wasm /work/editor/dist/audio/teia-kernel-parallel.wasm'

printf 'Wrote %s\n' "$ROOT/editor/public/audio/teia-kernel.wasm"
printf 'Wrote %s\n' "$ROOT/editor/public/audio/teia-kernel-simd.wasm"
printf 'Wrote %s\n' "$ROOT/editor/public/audio/teia-kernel-parallel.wasm"
mkdir -p "$ROOT/kernel/dist"
cp "$ROOT/editor/public/audio/teia-kernel.wasm" "$ROOT/editor/public/audio/teia-kernel-simd.wasm" "$ROOT/editor/public/audio/teia-kernel-parallel.wasm" "$ROOT/kernel/dist/"
