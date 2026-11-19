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
| `app/kit` | `volumen.js`: the elements that put the reader on other sites' pages |
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
cargo run -p vol-ingest --example dump -- book.epub   # what a file imports as
scripts/run.sh                        # desktop app
npx --prefix app tauri build          # desktop installers (target/release/bundle)
```

`VOLUMEN_KIT=1` builds the kit (`app/dist-kit`). Releases (the desktop app for Linux, macOS
and Windows, and the kit) are built by `.github/workflows/release.yml` when a `v*` tag is
pushed.

`VOLUMEN_WEB=1 npm --prefix app run build` builds the site as deployed: the reader at
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

The kit is the reader alone, for any site: `Volumen-kit.zip` from a release, unpacked into
a folder (here `/volumen/`), or built with `VOLUMEN_KIT=1 npx vite build` in `app/`
(`app/dist-kit`). Two elements place it on a page:

```html
<script type="module" src="/volumen/volumen.js"></script>

<volumen-book src="/books/book.epub" chapters="3" theme="linen"
  end-href="/shop" end-label="Buy the book"></volumen-book>

<volumen-library src="/books.json"></volumen-library>
```

`<volumen-book>` fills the box the page gives it. Its attributes:

| Attribute | |
| --- | --- |
| `src` | the book: EPUB, Word (`.docx`) or Markdown |
| `chapters` | only these: `3`, `1-3` |
| `theme` | `original`, `quiet`, `paper`, `bold`, `calm` or `focus` |
| `end-href`, `end-label` | a way on, on a card at the end |
| `remember` | keep the reader's place and highlights in the browser (off by default) |
| `ui` | the reader's own interface: `full` (the default), `minimal` (the chapter's name alone) or `none` |
| `off` | what it does not offer, any of `contents settings find highlights links` |

It sends `volumen-ready` (`detail.title`, `detail.chapters`), `volumen-progress`
(`detail.at`, 0 to 1), `volumen-end` and `volumen-error` (`detail.message`). Once ready it
takes `book.goTo({ chapter: 3 })` or `book.goTo({ at: 0.5 })`, and `book.setTheme(theme)`: a
theme's name, or a theme as Volumen exports one (`{ "format": "volumen-theme/1", … }`).

`<volumen-library>` makes a shelf from `[{ "title", "author", "src", "cover" }]`; without
`cover`, an EPUB's own cover is read from the file by range requests. See `examples/`.

The reader runs in a frame, under a content security policy of its own (in `embed.html`:
it loads nothing from elsewhere but the book). The page and the frame speak only to each
other's origin, in messages `{ volumen: 1, type, … }` (`app/src/core/embed.ts`), so another
page cannot listen in or steer it.

To put a sample online without the rest of the book, write one with only those chapters
(the app's Save as EPUB, or
`cargo run -p vol-ingest --example sample -- book.epub 1-3 sample.epub`).

The same elements work from `https://volumen.page/volumen.js`, with no kit; the book's
server must then send `Access-Control-Allow-Origin`.

## Working on it

```sh
git config core.hooksPath scripts/hooks   # once: the checks below before every commit
scripts/lint.sh                           # the fast checks: layers, file sizes, copied
                                          # code, unused code, types, clippy
scripts/check.sh                          # everything: lint, crates, Playwright, the press
npm --prefix app test                     # the browser tests (Chromium; the app, its
                                          # production build, the service, the kit)
node scripts/sizes.mjs                    # what a page with the kit downloads, against a budget
```

The same run on every push (`.github/workflows/ci.yml`). A bug fixed comes with a test that
failed before the fix.

## License

MIT. Fonts: SIL Open Font License (`assets/fonts/*-OFL.txt`). The sample book is
*Meditations* (tr. George Long) from [Standard Ebooks](https://standardebooks.org), public
domain. The test books in `bench/fixtures` are public domain too, from Project Gutenberg
and Standard Ebooks; the rest there are written by the scripts beside them.
