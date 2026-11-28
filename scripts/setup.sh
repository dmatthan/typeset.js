#!/usr/bin/env bash
# What a clone needs before the checks and tests run: the Rust toolchain (rust-toolchain.toml),
# the wasm-bindgen CLI at Cargo.lock's version, the npm packages, the engine built for the
# browser, Playwright's browsers and the pre-commit hook. Says what else is wanted, and for what.
#   scripts/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '== %s\n' "$*"; }
note() { printf 'note: %s\n' "$*" >&2; }

step "Rust, as rust-toolchain.toml pins it";       rustup toolchain install
want="$(scripts/bindgen-version.sh)"
if [[ "$(wasm-bindgen --version 2>/dev/null | awk '{print $2}')" != "$want" ]]; then
  step "wasm-bindgen $want (Cargo.lock)";          cargo install -q wasm-bindgen-cli --version "$want" --locked
fi
step "npm packages";                                npm --prefix app ci && npm --prefix service ci
step "the engine for the browser";                  scripts/build-wasm.sh >/dev/null
step "Playwright's browsers";                       npx --prefix app playwright install chromium firefox
step "the pre-commit hook";                         git config core.hooksPath scripts/hooks
command -v python3 >/dev/null || note "python3 is needed by the package's browser tests (they serve files with it)"
command -v wasm-opt >/dev/null || note "wasm-opt (binaryen) is wanted for the engine's release size; without it the engine builds unoptimised"
if [[ "$(uname)" == Linux ]] && ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  note "the desktop app (and clippy over the whole workspace) needs the WebKitGTK development packages: the list is in .github/workflows/ci.yml"
fi
step "ready: scripts/lint.sh, scripts/check.sh"
