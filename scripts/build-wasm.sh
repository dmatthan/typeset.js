#!/usr/bin/env bash
# Builds the engine for the web build and writes JS bindings to app/src/core/pkg.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build --profile wasm --target wasm32-unknown-unknown -p typeset-wasm
BINDGEN="$(command -v wasm-bindgen || echo "${CARGO_HOME:-$HOME/.cargo}/bin/wasm-bindgen")"
# (the CLI must be the crate's version exactly; Cargo.lock has it)
want="$(scripts/bindgen-version.sh)"
have="$("$BINDGEN" --version 2>/dev/null | awk '{print $2}' || true)"
if [[ "$have" != "$want" ]]; then
  echo "wasm-bindgen $want is needed (Cargo.lock); found ${have:-none}. Install it: cargo install wasm-bindgen-cli --version $want --locked" >&2
  exit 1
fi
"$BINDGEN" --target web --out-dir app/src/core/pkg "${CARGO_TARGET_DIR:-target}/wasm32-unknown-unknown/wasm/typeset_wasm.wasm"
# (the features Rust's wasm32 target enables, `rustc --print cfg --target
# wasm32-unknown-unknown`: an older wasm-opt allows only those it is told of)
if command -v wasm-opt >/dev/null; then
  wasm-opt -O3 --enable-bulk-memory --enable-multivalue --enable-mutable-globals --enable-nontrapping-float-to-int \
    --enable-reference-types --enable-sign-ext -o app/src/core/pkg/typeset_wasm_bg.wasm app/src/core/pkg/typeset_wasm_bg.wasm
fi
ls -la app/src/core/pkg/typeset_wasm_bg.wasm
