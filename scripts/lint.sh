#!/usr/bin/env bash
# The fast gate (seconds, not minutes): what keeps the code from drifting. Run by the
# pre-commit hook (scripts/hooks/pre-commit) and by scripts/check.sh.
#   scripts/lint.sh          everything
#   scripts/lint.sh --staged only what the staged files touch (the hook)
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '== %s\n' "$*"; }
touched() { [[ "${1:-}" != --staged ]] || git diff --cached --name-only | grep -qE "$2"; }

step "shape: layers, file sizes";                       node scripts/rules.mjs
# a maintainer's private details (names, paths) kept out of the repository: the patterns
# are their own, one extended regex a line, in .private/guard (never committed)
if [[ -s .private/guard ]]; then
  step "nothing private"
  if [[ "${1:-}" == --staged ]]; then list() { git diff --cached --name-only --diff-filter=ACMR; }; else list() { git ls-files; }; fi
  if list | grep -v '^\.gitignore$' | xargs -r grep -IliE -f .private/guard --; then echo "private details in the files above" >&2; exit 1; fi
fi
step "no copied code (jscpd)";                          npx --prefix app jscpd --config .jscpd.json >/dev/null 2>&1 || { npx --prefix app jscpd --config .jscpd.json | grep -A3 "Clone found"; exit 1; }
if touched "${1:-}" '^app/'; then
  step "app: types";                                    npm --prefix app run -s check >/dev/null
  step "app: nothing unused (knip)";                    (cd app && npx knip --no-progress)
fi
if touched "${1:-}" '^service/'; then
  step "service: types";                                npm --prefix service run -s check
fi
if touched "${1:-}" '(\.rs|Cargo\.toml)$'; then
  step "rust: clippy, warnings as errors";              cargo clippy -q --workspace --all-targets -- -D warnings
fi
