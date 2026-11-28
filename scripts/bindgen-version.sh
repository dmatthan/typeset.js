#!/usr/bin/env bash
# The wasm-bindgen CLI's version: the wasm-bindgen crate's in Cargo.lock, which the CLI
# must match exactly (scripts/build-wasm.sh, the workflows' setup).
set -euo pipefail
cd "$(dirname "$0")/.."
sed -n '/^name = "wasm-bindgen"$/{n;s/^version = "\(.*\)"$/\1/p;}' Cargo.lock
