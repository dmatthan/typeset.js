# How Volumen is built

Three parts, each doing one thing, and the line between them is kept:

- **`crates/` (Rust)** reads books and sets their text.
  - `ingest`: EPUB, Word, Markdown and plain text, made into the model.
  - `model`: a book is sections of blocks; a block is plain text with style runs and a
    key from its place in the source, which marks and notes are anchored to.
  - `press`: measures words, breaks paragraphs (Knuth–Plass), and pours lines into
    columns of whole rows. Its output is a table of lines: where each sits, what part of
    which block it holds.
  - `engine`: the one interface both apps call: lay out, find, search, place a note again.
  - `wasm`: the engine for a browser, in a Web Worker.
- **`app/` (Svelte, TypeScript)** shows the book and reads it, in three layers, each
  importing only from those below it (`scripts/rules.mjs` holds it so):
  - `core/`: the platform: the engine behind one interface (`Core`), storage, the sharing
    service, the browser.
  - `reader/`: reading: laying a book out, putting it on the page, moving it, marking it.
  - `ui/`: the components: they show and ask; what they do lives in `reader/` and `core/`.
  - Two shells around the reader: `App.svelte` (the library, books by link, sharing) and
    `Embed.svelte` (one book on another site's page). The reader knows neither.
- **Around them**: `src-tauri/` (the desktop app: the native engine, SQLite, the system's
  fonts), `service/` (the sharing service: one Cloudflare Worker, sealed bytes only),
  `app/kit/volumen.js` (the elements other sites use).

## A book's way to the screen

    file ─ ingest ─▶ model ─ press ─▶ lines (per section)
                                        │
          strip: every column of the book in order (estimated until laid out),
          anchors that find a place again after any relayout
                                        │
          surface: the columns in view as HTML (render.ts), a few built ahead
                                        │
          motion: where the sheet is; a move known when it starts is handed to the
          compositor whole, so it runs however busy the page is

The press predicts each line's width, the page checks every line it draws (`verify.ts`)
and corrects what the prediction missed: no line ever crosses its margin.

## Input, and a setting changed

- `input.ts` takes keys and the pointer; `wheel.ts` tells a mouse wheel's notches from a
  trackpad's swipes; `cursor.ts` chooses a paragraph from the keyboard; `selection.ts`
  turns the browser's selection into places in the text.
- A setting that changes the text (a size, a face, the window) is worked out apart from
  the page and comes onto it, style and text together, in one frame (`commit` in
  `reader.svelte.ts`; the style's variables in `paint.ts`).

## Each module

Every file opens by saying what it is. The list, in their own words:

    node scripts/map.mjs

## Keeping it so

`scripts/lint.sh` refuses: an import against the layers, a file over 800 lines, copied
code, unused code, a type error, a function more tangled than 30 branches
(`scripts/complexity.mjs` lists the most), and a module that does not say what it is.
