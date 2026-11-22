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

A book in the box the page gives it (by default its column's width and 70% of the
window's height), gently rounded with a hairline in the page's own ink; style the
element (`border-radius`, `box-shadow`) to change them.

| Attribute | |
| --- | --- |
| `src` | the book: EPUB, Word (`.docx`) or Markdown |
| `chapters` | only these: `3`, `1-3` |
| `theme` | `book` (the default), `slate`, `linen`, `clear`, `warm` or `open` |
| `paper` | the paper the book is set on: a colour, or `page` (whatever is behind the element); a dark one reads dark. Without it, the theme's own |
| `back` | a way back, shown as Back: an address (opened in the page's window), or with no value the page's own history. Without it, none (the page is the way back) |
| `end-href`, `end-label` | a way on, on a card at the end |
| `remember` | keep the reader's place, highlights and bookmarks in the browser (off by default) |
| `ui` | the reader's own interface: `full` (the default: Back where asked for, a bookmark, full screen, and a menu with the contents, find, and type and theme; for a mouse, quiet arrows at its sides), `minimal` (the book's title and the page's number alone) or `none` |
| `off` | what it does not offer, any of `contents settings find highlights links` (`highlights` takes bookmarks with it) |

| Event | `detail` |
| --- | --- |
| `typeset-ready` | `title`, `chapters` |
| `typeset-progress` | `at`, 0 to 1 |
| `typeset-end` | |
| `typeset-error` | `message` |
| `typeset-back` | the reader's Back, with `back` and no address: cancel it to go your own way |
| `typeset-full` | `on`: the book filling the window, where a frame has no full screen |

Once ready: `book.goTo({ chapter: 3 })`, `book.goTo({ at: 0.5 })`, and
`book.setTheme(theme)`, a theme's name or a theme as Volumen exports one
(`{ "format": "typeset-theme/1", … }`).

Full screen is the browser's where it allows it; where a frame has none (an iPhone), the
element fills the window instead, the page held still behind it (an ancestor with a
`transform` would hold it in its box).

### `<typeset-open>` and `open()`

What it holds (the page's own button, a picture, any element) opens the book over the
whole window. Holding nothing, it shows the book's cover: an EPUB's own, read from the
file, or `cover="/cover.jpg"`; `title` names it. It takes `<typeset-book>`'s attributes.
The reader has Back, which, as the browser's back does, gives the page back as it was.
It sends `typeset-open` and `typeset-close`; the reader's own events come from the
`<typeset-book>` it opens (`element.book`).

```js
const reading = open({ src: '/books/book.epub', chapters: '3' });   // reading.close()
```

### `<typeset-library>`

A shelf from `[{ "title", "author", "src", "cover" }]`, each book opened in place. Without
`cover`, an EPUB's own is read from the file by range requests.

## Samples

To put a sample online without the rest of the book, write one with only those chapters:
[Volumen](https://volumen.page)'s Save as EPUB, or
`cargo run -p typeset-ingest --example sample -- book.epub 1-3 sample.epub` in
[the repository](https://github.com/dmatthan/typeset.js).

## Security

The reader runs in a frame under a content security policy of its own: it loads nothing
from elsewhere but the book. The page and the frame speak only to each other's origin, in
messages `{ typeset: 1, type, … }`, so another page cannot listen in or steer it.

## License

MIT
