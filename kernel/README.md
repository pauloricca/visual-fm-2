# @pauloricca/teia-kernel

This npm package contains the ordinary, SIMD, and parallel Teia Rust/WASM audio kernels. Its Rust source is in `rust/teia-kernel/`. Run `npm run build:wasm` from the repository root to build the binaries and copy them to `kernel/dist/` and `editor/public/audio/`.

The editor and runtime currently bundle the built WASM files with their own assets. This package also makes the kernel artifacts available separately under the `@pauloricca/teia-kernel` name.
