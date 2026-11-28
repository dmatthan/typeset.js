#!/usr/bin/env bash
# The fast gate: what keeps the code from drifting. Each check is quiet when it passes and
# prints its whole report when it fails. Run by the pre-commit hook (scripts/hooks/pre-commit)
# and by scripts/check.sh; scripts/setup.sh installs the hook and what the gate needs.
#   scripts/lint.sh          everything (clippy over the whole workspace, desktop app included)
#   scripts/lint.sh --staged only what the staged files touch (the hook: clippy over the
#                            default members, which need no system libraries)
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-}"
step() { printf '== %s\n' "$*"; }
touched() { [[ "$mode" != --staged ]] || git diff --cached --name-only | grep -qE "$1"; }
# a check, quiet when it passes; when it fails, what it said, and the gate stops
quiet() { local out; if ! out=$("$@" 2>&1); then printf '%s\n' "$out"; exit 1; fi; }
needs() { [[ -e "$1" ]] || { echo "$1 is missing: $2" >&2; exit 1; }; }

needs app/node_modules "run scripts/setup.sh"

step "shape: layers, file sizes";                       quiet node scripts/rules.mjs
if touched '^scripts/'; then
  step "scripts: their own tests";                      quiet node --test 'scripts/*.test.mjs'
fi
# a maintainer's private details (names, paths) kept out of the repository: the patterns
# are their own, one extended regex a line, in .private/guard (never committed)
if [[ -s .private/guard ]]; then
  step "nothing private"
  if [[ "$mode" == --staged ]]; then list() { git diff --cached --name-only --diff-filter=ACMR; }; else list() { git ls-files; }; fi
  if list | grep -v '^\.gitignore$' | xargs -r grep -IliE -f .private/guard --; then echo "private details in the files above" >&2; exit 1; fi
fi
step "no copied code (jscpd)";                          quiet npx --prefix app jscpd --config .jscpd.json
if touched '\.(ts|js|mjs|svelte|css)$'; then
  step "format: TypeScript, JavaScript, Svelte, CSS";   quiet npm --prefix app run -s format:check
fi
if touched '^app/'; then
  needs app/src/core/pkg/typeset_wasm.js "the engine for the browser: run scripts/build-wasm.sh"
  step "app: types";                                    quiet npm --prefix app run -s check
  step "app: nothing unused (knip)";                    quiet npx --prefix app knip --no-progress --directory app
  # no function more tangled than 30 branches (scripts/complexity.mjs lists the most)
  step "app: no tangled function";                      quiet node scripts/complexity.mjs 30
  # every module says what it is, first thing (scripts/map.mjs prints them all: the map)
  step "app: every module says what it is";             quiet node scripts/map.mjs --check
fi
if touched '^(packages|app)/'; then
  step "typeset.js: its types, as a site uses them";    quiet npx --prefix app tsc --noEmit --strict --skipLibCheck --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler packages/typeset.js/types.check.ts
fi
if touched '^service/'; then
  step "service: types";                                quiet npm --prefix service run -s check
fi
if touched '(\.rs|Cargo\.toml|Cargo\.lock)$'; then
  step "rust: formatted";                               quiet cargo fmt --all -- --check
  cargo machete --version >/dev/null 2>&1 || { echo "cargo-machete is missing: run scripts/setup.sh" >&2; exit 1; }
  step "rust: no unused dependency (cargo-machete)";    quiet cargo machete
  if [[ "$mode" == --staged ]]; then members=(); else members=(--workspace); fi
  step "rust: clippy, warnings as errors";              quiet cargo clippy -q "${members[@]}" --all-targets -- -D warnings
fi
