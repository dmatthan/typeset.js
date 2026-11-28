/** Pages the reader marked to come back to. A bookmark is where its page begins (a block
 *  and an offset: an anchor that survives any relayout, another size or another device),
 *  the page's opening words and the words either side of them (to find it again, as a
 *  highlight is found, on another version of the book; and to say which page it is), and
 *  when. Kept per book (`bm.<id>`, bookstate.ts); they go with
 *  one's own notes (feedback.ts) and come back with them (restore.ts), never to a writer. */
import { kv } from '../core/kv';
import type { BookData, NoteAnchor } from '../core/types';
import { CTX } from './annotations';
import type { Strip } from './strip';
import type { Reader } from './reader.svelte';

export interface Bookmark {
  id: string;
  key: string;
  off: number;
  quote: string;
  prefix: string;
  suffix: string;
  at: number;
}

/** How much of the page's opening a bookmark keeps (characters). */
const WORDS = 80;

export const loadBookmarks = (bookId: string) => kv.get<Bookmark[]>('bm.' + bookId, []);
export const saveBookmarks = (bookId: string, list: Bookmark[]) => kv.set('bm.' + bookId, list);

/** Where the page at column `k` begins, if it has text of its own to come back to (not
 *  the title page, nor the colophon): a bookmark is that place and nothing else, so it is
 *  always found on its own page. */
export function markable(strip: Strip, k: number) {
  const a = strip.anchorAt(k);
  return a && 'key' in a && strip.keyIndex.has(a.key) ? a : null;
}

/** A bookmark for the page that begins at column `k`, if it can have one (`markable`). */
export function bookmarkAt(book: BookData, strip: Strip, k: number): Bookmark | null {
  const at = markable(strip, k);
  if (!at) return null;
  const h = strip.keyIndex.get(at.key)!;
  const t = book.sections[h[0]].blocks[h[1]].t;
  const e = Math.min(t.length, at.off + WORDS);
  return {
    id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    key: at.key,
    off: at.off,
    quote: t.slice(at.off, e),
    prefix: t.slice(Math.max(0, at.off - CTX), at.off),
    suffix: t.slice(e, e + CTX),
    at: Date.now(),
  };
}

/** The page's opening as a list shows it: to its last whole word, and said to go on. */
export const openingOf = (b: Bookmark) => (b.quote.length < WORDS ? b.quote : b.quote.replace(/\s+\S*$/, '') + '…');

/** The bookmarks on columns `from` to `to`. */
export const bookmarksIn = (list: Bookmark[], strip: Strip, from: number, to: number) =>
  list.filter(b => {
    const k = strip.resolve({ key: b.key, off: b.off });
    return k >= from && k <= to;
  });

/** A bookmark as an anchor to place on the book's text again (`Core.place`). */
export const anchorOfBookmark = (b: Bookmark): NoteAnchor => ({
  key: b.key,
  s: b.off,
  e: b.off + b.quote.length,
  quote: b.quote,
  prefix: b.prefix,
  suffix: b.suffix,
});

/** The open book's bookmarks, and the page in view's (`reader.bookmarks`). */
export class Bookmarks {
  /** The pages marked to come back to, in the order they were marked. */
  list: Bookmark[] = $state([]);

  constructor(private r: Reader) {}

  load(bookId: string) {
    this.list = loadBookmarks(bookId);
  }
  clear() {
    this.list = [];
  }

  /** The bookmarks on the columns in view. */
  inView(): Bookmark[] {
    const { strip, M, cur } = this.r;
    return strip && M ? bookmarksIn(this.list, strip, cur, cur + M.N - 1) : [];
  }

  /** Whether the page in view has a bookmark, or can have one (`markable`). */
  canMark(): boolean {
    const { strip, cur } = this.r;
    return !!strip && (this.inView().length > 0 || !!markable(strip, cur));
  }

  /** The page in view marked to come back to; or, marked already, unmarked. */
  toggle() {
    const { book, strip, cur } = this.r;
    if (!book || !strip) return;
    const here = this.inView();
    if (here.length) this.list = this.list.filter(b => !here.includes(b));
    else {
      const b = bookmarkAt(book, strip, cur);
      if (b) this.list = [...this.list, b];
    }
    saveBookmarks(book.id, this.list);
  }

  remove(id: string) {
    this.list = this.list.filter(b => b.id !== id);
    if (this.r.book) saveBookmarks(this.r.book.id, this.list);
  }
}
