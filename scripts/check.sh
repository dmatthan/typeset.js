#!/usr/bin/env bash
# Every gate in one run. Exits non-zero on the first failure.
#   scripts/check.sh          crates, frontend types, Playwright, press numbers
#   scripts/check.sh --app    also the desktop self-test (opens a window briefly)
#   scripts/check.sh --slow   also the browser tests with the CPU slowed 4× (as CI's runners
#                             are): what depends on timing fails here, not after a push
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n== %s\n' "$*"; }

step "cargo test";              cargo test -q
step "wasm";                    scripts/build-wasm.sh >/dev/null
step "lint (scripts/lint.sh)";   scripts/lint.sh
# (the projects CI runs: the dev build, the production build, the service, the package)
step "playwright";              (cd app && npm test -- --reporter=line)
# the press's numbers on a long novel where there is one (the maintainer's corpus/), else
# on the fixture
book=corpus/middlemarch.epub; [[ -f "$book" ]] || book=bench/fixtures/thursday.epub
step "press: $(basename "$book")"; cargo run -q --release -p typeset-press --example setbook -- "$book" 20 610 23 | tail -2
if [[ " $* " == *" --slow "* ]]; then
  step "playwright, the CPU slowed 4×";   (cd app && npm run -s test:slow -- --reporter=line)
fi
if [[ " $* " == *" --app "* ]]; then
  step "desktop self-test (WebKitGTK)"
  cargo build -q -p volumen
  (cd app && npx vite --port 5193 >/dev/null 2>&1 &) ; sleep 2
  TYPESET_SELFTEST=1 timeout 300 ./target/debug/volumen | grep SELFTEST
fi
step "all gates passed"
