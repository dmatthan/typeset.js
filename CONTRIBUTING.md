# Contributing

Bug reports, proposals and pull requests are welcome. Every change, including the
maintainer's, goes through an issue and a pull request.

## Setup

With rustup and Node installed (versions in the [README](README.md#build)):

```sh
scripts/setup.sh
```

It installs the pinned Rust toolchain and wasm-bindgen CLI, cargo-machete, the npm packages,
the engine built for the browser, Playwright's browsers and the pre-commit hook, and says what else is
wanted: Python 3 for the package's browser tests, and on Linux the WebKitGTK development
packages for the desktop app (listed in `.github/workflows/ci.yml`).

## Flow

1. Find or open an issue. Bugs and features use their forms; maintenance work uses the
   task form. Agree on the approach in the issue before a large change.
2. Branch from `main`: `type/short-name` (`fix/epub-nested-notes`).
3. Make the change with its test. A bug fix comes with a test that fails without it.
4. Run the checks (below) and open a pull request that fills in the template and links
   the issue (`Closes #12`).
5. CI must pass. Pull requests are squash-merged; the title becomes the commit.

## Commits and titles

Pull request titles, and commits on a branch, follow
[Conventional Commits](https://www.conventionalcommits.org):

```
type(scope): summary
```

- **type:** `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`
- **scope:** `model`, `ingest`, `press`, `engine`, `wasm`, `reader`, `ui`, `package`,
  `desktop`, `service`, `site`, `deps`, `repo`
- **summary:** imperative, lower case, no full stop, the whole title at most 72 characters

A body, where one is needed, says what changed and why, wrapped at 72 characters. No
trailers.

Examples: `fix(press): break web addresses after slashes`,
`refactor(reader): move bookmarks into their own module`.

## Formatting

Rust is formatted by rustfmt and the TypeScript, JavaScript, Svelte and CSS by Prettier,
configured in `rustfmt.toml` and `.prettierrc.json`; an editor that formats on save with
either gives the same result. The checks fail on unformatted code.

```sh
cargo fmt --all
npm --prefix app run format
```

Commits that only reformat are listed in `.git-blame-ignore-revs`, which GitHub's blame
skips; locally, `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

## Checks

```sh
scripts/lint.sh            # the fast checks, as the commit hook runs them
scripts/check.sh           # everything CI runs: lint, crates, browser tests, the press
npm --prefix app test      # the browser tests alone
cargo test                 # the crates alone
```

What the checks enforce: formatting, layers that import one way, files under 800 lines, functions
under 30 branches, every module opening with what it is, no copied or unused code, no
type error, no clippy warning, the package's download size. A failing check is fixed,
not skipped: never commit with `--no-verify`.

## Finding your way

- [ARCHITECTURE.md](ARCHITECTURE.md): how the parts fit.
- `node scripts/map.mjs`: every module of the app, in its own first line.
- `cargo tree -e normal --workspace`: the crates and what they depend on.

## Security

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md), not in an
issue.
