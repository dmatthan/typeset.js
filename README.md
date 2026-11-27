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

```sh
git tag -a v0.3.0 -m … && git push origin v0.3.0   # the desktop app and typeset.js.zip
git tag typeset.js-v0.3.0 && git push origin typeset.js-v0.3.0   # typeset.js, staged on npm
npm stage list typeset.js && npm stage approve <id>   # … and made public, with a second factor
```

A `v*` tag builds the desktop app for Linux, macOS and Windows and the package as a zip
(`.github/workflows/release.yml`). A `typeset.js-v*` tag, naming the version in
`packages/typeset.js/package.json`, builds and tests the package and stages it on npm
(`.github/workflows/npm.yml`, npm's trusted publisher: no token is kept); it is public once
a maintainer approves it.

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

## Working on it

How the parts fit, at a glance: [ARCHITECTURE.md](ARCHITECTURE.md).

```sh
git config core.hooksPath scripts/hooks   # once: the checks below before every commit
scripts/lint.sh                           # the fast checks: layers, file sizes, copied
                                          # code, unused code, types, tangled functions,
                                          # modules that say what they are, clippy
node scripts/map.mjs                      # every module, in its own words
scripts/check.sh                          # everything: lint, crates, Playwright, the press
npm --prefix app test                     # the browser tests (Chromium; the app, its
                                          # production build, the service, the package)
npm --prefix app run test:engines         # the reader in Firefox and Safari's engine (WebKit
                                          # by hand before a release; CI runs Firefox)
node scripts/sizes.mjs                    # what a page with typeset.js downloads, against a budget
```

The same run on every push (`.github/workflows/ci.yml`), with Firefox after Chromium. A bug fixed comes with a test that
failed before the fix.

## License

MIT. Fonts: SIL Open Font License (`assets/fonts/*-OFL.txt`). The sample book is
*Meditations* (tr. George Long) from [Standard Ebooks](https://standardebooks.org), public
domain. The test books in `bench/fixtures` are public domain too, from Project Gutenberg
and Standard Ebooks; the rest there are written by the scripts beside them.
