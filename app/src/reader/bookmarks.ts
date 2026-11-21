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

export interface Bookmark { id: string; key: string; off: number; quote: string; prefix: string; suffix: string; at: number }

/** How much of the page's opening a bookmark keeps (characters). */
const WORDS = 80;

export const loadBookmarks = (bookId: string) => kv.get<Bookmark[]>('bm.' + bookId, []);
export const saveBookmarks = (bookId: string, list: Bookmark[]) => kv.set('bm.' + bookId, list);

/** A bookmark for the page that begins at column `k` (a page with no text of its own, a
 *  picture or a title page, by its chapter's first words). */
export function bookmarkAt(book: BookData, strip: Strip, k: number): Bookmark | null {
  const a = strip.anchorAt(k);
  if (!a) return null;
  const at = 'key' in a ? a : { key: book.sections[a.sec]?.blocks[0]?.key, off: 0 };
  const h = at.key ? strip.keyIndex.get(at.key) : null;
  if (!h) return null;
  const t = book.sections[h[0]].blocks[h[1]].t;
  const e = Math.min(t.length, at.off + WORDS);
  return { id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), key: at.key!, off: at.off, quote: t.slice(at.off, e), prefix: t.slice(Math.max(0, at.off - CTX), at.off), suffix: t.slice(e, e + CTX), at: Date.now() };
}

/** The page's opening as a list shows it: to its last whole word, and said to go on. */
export const openingOf = (b: Bookmark) => (b.quote.length < WORDS ? b.quote : b.quote.replace(/\s+\S*$/, '') + '…');

/** The bookmarks on columns `from` to `to`. */
export const bookmarksIn = (list: Bookmark[], strip: Strip, from: number, to: number) =>
  list.filter(b => { const k = strip.resolve({ key: b.key, off: b.off }); return k >= from && k <= to; });

/** A bookmark as an anchor to place on the book's text again (`Core.place`). */
export const anchorOfBookmark = (b: Bookmark): NoteAnchor => ({ key: b.key, s: b.off, e: b.off + b.quote.length, quote: b.quote, prefix: b.prefix, suffix: b.suffix });
