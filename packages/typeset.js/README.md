# typeset.js

A malleable e-reader for any web page: EPUB, Word (`.docx`) and Markdown files are typeset into a reflowable reader view, accessible from your domain. Set custom flags and embed it any way you want. Enable what features you need. Supports highlights, bookmarks, Ctrl-F find and beautiful themes out of the box.

This is the engine of [Volumen](https://volumen.page), for developers.

## Install

```sh
npm install typeset.js
npx typeset.js public/typeset
```

`npx typeset.js` puts the reader in a folder of your site, to be served with it (`public/` in
Vite, Next.js and Astro, `static/` in SvelteKit). With no folder named, `public/typeset`.
Run it again after an update; it writes over nothing but a reader's folder. It needs Node 18
or later; the reader itself is static files, from any web server, with no backend.

## A book on a page

```html
<script type="module" src="/typeset/typeset.js"></script>

<typeset-book src="/books/book.epub"></typeset-book>
```

From a site's own script (a bundler's, or a module), import the package instead; the
reader is expected at `/typeset/`:

```js
import { open, serveFrom } from 'typeset.js';

serveFrom('/static/reader/');   // only if it is served elsewhere, before any book is shown
```

Without npm, unpack `typeset.js.zip` from a
[release](https://github.com/dmatthan/typeset.js/releases) into a folder of your site instead.

The package has its types: the elements' (`document.querySelector('typeset-book')` is a
`TypesetBook`), their events' details, and what `open()` takes.

```ts
import { open } from 'typeset.js';

const { book } = open({ src: '/books/book.epub', endHref: '/shop' });
book.addEventListener('typeset-progress', e => console.log(e.detail.at));
```

## The elements

```html
<typeset-book src="/books/book.epub" chapters="3" theme="linen"
  end-href="/shop" end-label="Buy the book"></typeset-book>

<typeset-open src="/books/book.epub"><button>Read the book</button></typeset-open>

<typeset-library src="/books.json"></typeset-library>
```

### `<typeset-book>`

A book in the box the page gives it: by default the column's width and 70% of the
window's height, with rounded corners and a 1 px border in the page's text colour. Style
the element (`border-radius`, `box-shadow`) to change them.

| Attribute | |
| --- | --- |
| `src` | the book: EPUB, Word (`.docx`) or Markdown |
| `chapters` | only these: `3`, `1-3` |
| `theme` | `book` (the default), `slate`, `linen`, `clear`, `warm` or `open` |
| `paper` | the paper the book is set on: a colour, or `page` (whatever is behind the element); a dark one reads dark. Without it, the theme's own |
| `back` | a way back, shown as Back: an address (opened in the page's window), or with no value the page's own history. Without it, none (the page is the way back) |
| `end-href`, `end-label` | a way on, on a card at the end |
| `remember` | keep the reader's place, highlights and bookmarks in the browser (off by default) |
| `ui` | the reader's own interface: `full` (the default: Back where asked for, a bookmark, Expand, and a menu with the contents, find, and type and theme; with a mouse, arrows at the sides), `minimal` (the title and page number only) or `none`. Keys follow what is shown: with `minimal` or `none` the book turns pages and follows links, nothing more |
| `off` | features to turn off, any of `contents settings find highlights links` (`highlights` includes bookmarks); their buttons, keys and Help entries are removed |

| Event | `detail` |
| --- | --- |
| `typeset-ready` | `title`, `chapters` |
| `typeset-progress` | `at`, 0 to 1 |
| `typeset-end` | |
| `typeset-error` | `message` |
| `typeset-back` | the reader's Back, with `back` and no address: cancel it to go your own way |
| `typeset-place` | `place`: where the book is now, `box` (in its place on the page) or `window` (filling the page's window) |

Once ready: `book.goTo({ chapter: 3 })`, `book.goTo({ at: 0.5 })`, and
`book.setTheme(theme)`, a theme's name or a theme as Volumen exports one
(`{ "format": "typeset-theme/1", … }`).

**Expand**, at the bottom left, fills the page's window with the book; the page behind it
keeps its scroll position (an ancestor with a `transform` confines the element to its box).
From there the same control is **Full screen**, the browser's, where the frame allows it
(not on an iPhone). **×** at the top left returns the book to its box from either; Escape
goes back one step, and the browser's Back returns to the page.

### `<typeset-open>` and `open()`

Its content (a button, an image, any element) opens the book over the whole window. With
no content it shows the book's cover: an EPUB's own, read from the file, or
`cover="/cover.jpg"`; `title` labels it. It takes `<typeset-book>`'s attributes. × or the
browser's Back closes the book and restores the page. It sends `typeset-open` and
`typeset-close`; the reader's events come from the `<typeset-book>` it opens
(`element.book`).

```js
const reading = open({ src: '/books/book.epub', chapters: '3' });   // reading.close()
```

### `<typeset-library>`

A shelf from a JSON list, `[{ "title", "author", "src", "cover" }]`; each book opens in
place. Without `cover`, an EPUB's own cover is read from the file with range requests.

## Samples

To publish a sample without the rest of the book, make an EPUB of those chapters only:
[Volumen](https://volumen.page)'s Save as EPUB, or
`cargo run -p typeset-ingest --example sample -- book.epub 1-3 sample.epub` in
[the repository](https://github.com/dmatthan/typeset.js).

## Security

The reader runs in a frame with its own content security policy: it loads nothing from
other origins except the book. The page and the frame post messages (`{ typeset: 1, type,
… }`) only to each other's origin, so other pages cannot read or control it.

## License

MIT
