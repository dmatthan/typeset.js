# Volumen

A reader for EPUB, Word and Markdown. Books are typeset in columns that move sideways;
highlights and notes can be sent back to the writer of a shared manuscript. It runs in the
browser ([volumen.page](https://volumen.page)) and as a desktop app.

## Layout

| Path | |
| --- | --- |
| `crates/model` | Document model: sections, blocks, style runs, stable block keys |
| `crates/ingest` | Importers: EPUB 2 and 3 (with publisher CSS), Word, Markdown, plain text |
| `crates/press` | Typesetting: shaping (HarfRust), paragraph breaking, hyphenation, columns |
| `crates/engine` | One API over the above: layout cache, find, library search, note anchoring |
| `crates/wasm` | The engine for the web (wasm-bindgen) |
| `app` | The reader (Svelte); the engine runs in a worker. `app/site` is volumen.page |
| `src-tauri` | The desktop app (Tauri): SQLite storage and full-text search, system fonts |
| `service` | Sharing: a Cloudflare Worker with D1, holding ciphertext only |
| `assets` | Fonts, hyphenation patterns, the sample book, icons |
| `packages/typeset.js` | The npm package: the elements, their types, and `npx typeset.js`, which puts the reader in a site |
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

`TYPESET_PACKAGE=1` builds the package's reader (`packages/typeset.js/reader`). Releases (the desktop app for Linux, macOS
and Windows, and typeset.js as a zip) are built by `.github/workflows/release.yml` when a `v*` tag is
pushed.

`TYPESET_WEB=1 npm --prefix app run build` builds the site as deployed: the reader at
`/read`, the page at `/`. Without it the reader is at `/`, as the desktop app loads it.

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

## On other sites

The reader alone, for any site, served from the site itself: the npm package
[typeset.js](packages/typeset.js) (its README is the reference: the elements, their attributes,
events and methods).

```sh
npm install typeset.js && npx typeset.js public/typeset
```

```html
<script type="module" src="/typeset/typeset.js"></script>
<typeset-book src="/books/book.epub"></typeset-book>
```

See `examples/` for a chapter on a blog and a library from a list.

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
npm --prefix app run test:engines         # the reader in Firefox and Safari's engine
node scripts/sizes.mjs                    # what a page with typeset.js downloads, against a budget
```

The same run on every push (`.github/workflows/ci.yml`). A bug fixed comes with a test that
failed before the fix.

## License

MIT. Fonts: SIL Open Font License (`assets/fonts/*-OFL.txt`). The sample book is
*Meditations* (tr. George Long) from [Standard Ebooks](https://standardebooks.org), public
domain. The test books in `bench/fixtures` are public domain too, from Project Gutenberg
and Standard Ebooks; the rest there are written by the scripts beside them.
