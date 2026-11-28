// typeset.js: the elements and functions a site's script uses (the elements' attributes, events
// and methods are the package's README).

/** A bundled theme's name, or a theme as Volumen exports one. */
export type Theme =
  | 'book'
  | 'slate'
  | 'linen'
  | 'clear'
  | 'warm'
  | 'open'
  | { format: 'typeset-theme/1'; [k: string]: unknown };

/** What a book is opened with: <typeset-book>'s attributes, in camelCase or as written. */
export interface BookOptions {
  /** The book: EPUB, Word (.docx) or Markdown, by its address. */
  src: string;
  /** Only these chapters: "3", "1-3". */
  chapters?: string | number;
  theme?: Exclude<Theme, object>;
  /** A colour, or "page" (whatever is behind the element). */
  paper?: string;
  endHref?: string;
  endLabel?: string;
  /** Keep the reader's place, highlights and bookmarks in the browser. */
  remember?: boolean;
  /** The reader's own interface; what it does not show, no key opens (`minimal`, `none`: turning
   *  pages and following links alone). */
  ui?: 'full' | 'minimal' | 'none';
  /** Any of "contents settings find highlights links", space separated. */
  off?: string;
  title?: string;
}

export interface TypesetBookEvents {
  'typeset-ready': CustomEvent<{ title: string; chapters: number }>;
  'typeset-progress': CustomEvent<{ at: number }>;
  'typeset-end': CustomEvent<undefined>;
  'typeset-error': CustomEvent<{ message: string }>;
  /** The reader's Back, with `back` and no address: cancel it to go the page's own way. */
  'typeset-back': CustomEvent<undefined>;
  /** Where the book is: in its box on the page, or filling the page's window. */
  'typeset-place': CustomEvent<{ place: 'box' | 'window' }>;
}

/** <typeset-book>: a book in the box the page gives it. */
export interface TypesetBook extends HTMLElement {
  /** Once ready: to a chapter (counted from 1) or a place (0 to 1). */
  goTo(where: { chapter: number } | { at: number }): void;
  setTheme(theme: Theme): void;
  addEventListener<K extends keyof TypesetBookEvents>(
    type: K,
    listener: (this: TypesetBook, e: TypesetBookEvents[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

/** <typeset-open>: what it holds (or the book's cover) opens the book over the window. */
export interface TypesetOpen extends HTMLElement {
  /** The <typeset-book> it opened, while open. */
  readonly book: TypesetBook | null;
  open(): void;
}

/** <typeset-library>: a shelf from a list of books, each opened in place. */
export type TypesetLibrary = HTMLElement;

/** A book over the whole window; closing it (×, Escape or the browser's Back) removes it
 *  and restores the page. */
export function open(options: BookOptions, onclose?: () => void): { book: TypesetBook; close(): void };

/** Where the reader's folder is served (`npx typeset.js` put it there), when not at /typeset/;
 *  before any book is shown. */
export function serveFrom(path: string): void;

declare global {
  interface HTMLElementTagNameMap {
    'typeset-book': TypesetBook;
    'typeset-open': TypesetOpen;
    'typeset-library': TypesetLibrary;
  }
}
