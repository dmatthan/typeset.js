# typeset.js

[![npm](https://img.shields.io/npm/v/typeset.js)](https://www.npmjs.com/package/typeset.js)
[![license](https://img.shields.io/npm/l/typeset.js)](LICENSE)

A malleable e-reader for any web page: EPUB, Word (`.docx`) and Markdown files are typeset into a reflowable reader view, accessible from your domain. Set custom flags and embed it any way you want. Enable what features you need. Supports highlights, bookmarks, Ctrl-F find and beautiful themes out of the box.

```sh
npm install typeset.js && npx typeset.js public/typeset
```

```html
<script type="module" src="/typeset/typeset.js"></script>
<typeset-book src="/books/book.epub"></typeset-book>
```

The package's [README](packages/typeset.js) is the reference: the elements, their
attributes, events and methods, and serving it from your own site.

This repository is also [Volumen](https://volumen.page), the reading app built on it: a
library in the browser and on the desktop, and manuscripts shared with readers whose
highlights and notes go back to the writer.

## Layout

| Path | |
| --- | --- |
| `crates/model` | Document model: sections, blocks, style runs, stable block keys |
| `crates/ingest` | Importers: EPUB 2 and 3 (with publisher CSS), Word, Markdown, plain text |
| `crates/press` | Typesetting: shaping (HarfRust), paragraph breaking, hyphenation, columns |
| `crates/engine` | One API over the above: layout cache, find, library search, note anchoring |
| `crates/wasm` | The engine for the web (wasm-bindgen) |
| `app` | The reader (Svelte), and Volumen around it; the engine runs in a worker. `app/site` is volumen.page |
| `src-tauri` | Volumen's desktop app (Tauri): SQLite storage and full-text search, system fonts |
| `service` | Volumen's sharing: a Cloudflare Worker with D1, holding ciphertext only |
| `assets` | Fonts, hyphenation patterns, the sample book, icons |
| `packages/typeset.js` | The npm package: the elements (`src/typeset.js`), their types, and `npx typeset.js`, which puts the reader in a site |
| `examples` | A chapter on a blog, a library from a list |
| `scripts` | Build, deploy, and the checks every change passes |
| `bench` | Measurements (speed, memory, fidelity) and the test books |

## Build

Rust (stable) with the `wasm32-unknown-unknown` target, `wasm-bindgen-cli` 0.2.129,
Node 20.19 or later.

```sh
scripts/build-wasm.sh                 # engine → app/src/core/pkg
npm --prefix app install
npm --prefix app run dev              # http://localhost:5193
cargo test                            # crates
cargo run -p typeset-ingest --example dump -- book.epub   # what a file imports as
scripts/run.sh                        # desktop app
npx --prefix app tauri build          # desktop installers (target/release/bundle)
```

`TYPESET_PACKAGE=1` builds the package's reader (`packages/typeset.js/reader`).

`TYPESET_WEB=1 npm --prefix app run build` builds the site as deployed: the reader at
`/read`, the page at `/`. Without it the reader is at `/`, as the desktop app loads it.

## Releases

One version covers the npm package, the desktop app and `typeset.js.zip`. It is kept in
`packages/typeset.js/package.json`; the desktop app reads it from there, and
`node scripts/version.mjs` checks that every manifest agrees.

1. A pull request `chore(repo): release X.Y.Z` raises the version and writes the changelog
   (`npx git-cliff@2 --tag vX.Y.Z -o CHANGELOG.md`).
2. Once it is merged and CI has passed on `main`, tag that commit:

```sh
git tag -a vX.Y.Z -m vX.Y.Z && git push origin vX.Y.Z
npm stage list typeset.js && npm stage approve <id>   # the staged package made public, with a second factor
```

The tag builds the desktop app for Linux, macOS and Windows and the zip, attached to a
release with notes from the commits (`.github/workflows/release.yml`), and builds, tests and
stages the package on npm (`.github/workflows/npm.yml`, npm's trusted publisher: no token is
kept). Both first check that the tag names the version and that CI passed on its commit
(`.github/actions/release-gate`).

## Sharing service

A book is encrypted in the browser (AES-256-GCM); its key is in the link's fragment and
never reaches the service. Readers need no account. Writers are invited and sign in with
passkeys.

```sh
(cd service && npm install && cp .dev.vars.example .dev.vars)
(cd service && npx wrangler dev --port 8788 --local-upstream localhost:8788 --upstream-protocol http)
scripts/deploy.sh                     # to your own Cloudflare account, after `npx wrangler login`
scripts/service.sh invite "Name"      # an invitation link for a writer
```

A deployment's own values (a custom domain, the database's id, the Turnstile site key) are
kept in `service/deploy.env`, never committed; `scripts/deploy.sh` explains them and writes
the rest itself.

## Examples

`examples/` has a chapter on a blog (with a button that opens the whole book) and a
library from a list, as a site would serve them.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md): setup, the issue and pull request flow, conventions and
checks. [ARCHITECTURE.md](ARCHITECTURE.md): how the parts fit. Security reports:
[SECURITY.md](SECURITY.md).

## License

MIT. Fonts: SIL Open Font License (`assets/fonts/*-OFL.txt`). The sample book is
*Meditations* (tr. George Long) from [Standard Ebooks](https://standardebooks.org), public
domain. The test books in `bench/fixtures` are public domain too, from Project Gutenberg
and Standard Ebooks; the rest there are written by the scripts beside them.
