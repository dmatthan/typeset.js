/** How far this reader has read the open book: the paragraphs they have seen (a page read
 *  once it has stayed in view a moment), the furthest share of the book they have reached,
 *  and where they are, as their notes carry it (`Progress`, feedback.ts). Kept per book
 *  (`seen.<id>`, `far.<id>`). The reader's (`reader.progress`). */
import { kv } from '../core/kv';
import { shareAt, shareOf } from '../core/book';
import { F, FIELDS } from './strip';
import { chapName } from './render';
import type { Progress } from './feedback';
import type { Reader } from './reader.svelte';

/** How long a page stays in view before its paragraphs count as read (ms). */
const DWELL = 1600;

export class ReadingProgress {
  /** The paragraphs read, by key. */
  seen = new Set<string>();
  /** The furthest this reader has read in the book, as a share of it. */
  furthest = 0;
  private dwellT = 0;
  private seenT = 0;

  constructor(private r: Reader) {}

  load(bookId: string) {
    this.seen = new Set(kv.get<string[]>('seen.' + bookId, []));
    this.furthest = kv.get<number>('far.' + bookId, 0);
  }

  save(bookId: string) {
    clearTimeout(this.seenT);
    clearTimeout(this.dwellT);
    kv.set('far.' + bookId, this.furthest);
    kv.set('seen.' + bookId, [...this.seen]);
  }

  /** The reader came to rest on columns `focus`: they count as read once they have stayed
   *  in view a moment, and the furthest point moves on to the end of the page. */
  arrive(focus: number[]) {
    clearTimeout(this.dwellT);
    this.dwellT = window.setTimeout(() => focus.forEach(k => this.see(k)), DWELL);
    this.furthest = Math.max(this.furthest, this.viewEnd());
  }

  /** Where the reader is, and the furthest they have read (to the hundredth: a page or
   *  two read changes nothing to send). */
  now(): Progress {
    const { strip, book, cur } = this.r,
      at = this.viewEnd();
    const r = (x: number) => Math.round(x * 100) / 100;
    const it = strip!.itemAt(cur);
    const far = Math.max(this.furthest, at);
    return {
      at: r(at),
      furthest: r(far),
      where: it?.type === 'sect' ? chapName(book!, it.sec) : this.r.headFor(cur),
      done: far >= 0.995 || it?.type === 'colophon',
    };
  }

  /** The paragraphs on column k, read. */
  private see(k: number) {
    const { strip, book } = this.r;
    const L = strip?.linesAt(k);
    if (!L || !book) return;
    let changed = false;
    const sec = book.sections[L.sec];
    for (let j = L.from; j < L.to; j++) {
      const key = sec.blocks[L.sl.u[j * FIELDS + F.block]].key;
      if (!this.seen.has(key)) {
        this.seen.add(key);
        changed = true;
      }
    }
    if (changed) {
      clearTimeout(this.seenT);
      this.seenT = window.setTimeout(() => this.r.book && kv.set('seen.' + this.r.book.id, [...this.seen]), 800);
    }
  }

  /** The share of the book read by the end of the page in view. */
  private viewEnd() {
    const { strip, cur, M } = this.r;
    return this.share(Math.min(strip!.N - 1, cur + M.N - 1));
  }

  /** How far through the book's text column k is: its first paragraph's place among all
   *  of them (0 to 1). By the text, not by columns, which are estimates until the whole
   *  book is laid out: the same in any layout, size or device. */
  private share(k: number): number {
    const strip = this.r.strip!,
      book = this.r.book!,
      a = strip.anchorAt(k);
    if (!a) return 0;
    if ('key' in a) return shareOf(book, strip.keyIndex, a.key) ?? 0;
    return a.leaf === 'colophon' ? 1 : a.leaf === 'title' ? 0 : shareAt(book, a.sec, 0);
  }
}
