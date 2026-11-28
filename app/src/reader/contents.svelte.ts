/** The book's contents, bookmarks and the reader's highlights, beside the text: the
 *  chapters by the page each starts on, where the reader is and what is read, the pages
 *  marked to come back to, and the notebook (one's own
 *  highlights and notes, and other readers'). Long trips start here or on the progress
 *  line, and the reader animates them across the distance (`Reader.travelTo`). */
import { copyText } from '../core/clipboard';
import { BlockKind } from '../core/types';
import { ui, toast } from '../state.svelte';
import { openingOf } from './bookmarks.svelte';
import { markdownOf, type NoteEntry } from './notebook';
import { notesMarkdown } from './notesmd';
import type { Reader } from './reader.svelte';
import { chapName, chapTitle } from './render';

/** A notebook entry with the column it is in now. */
export type NoteItem = NoteEntry & { k: number };
export interface Chapter {
  sec: number;
  title: string;
  page: number;
  read: boolean;
  current: boolean;
  feedback: number;
}
/** A bookmark as the contents list it: the page it marks now, its chapter, its words. */
export interface BookmarkItem {
  id: string;
  k: number;
  page: number;
  where: string;
  quote: string;
  at: number;
}

/** What the contents show, for the components. */
export const cs = $state({
  tab: 'contents' as 'contents' | 'bookmarks' | 'highlights',
  chapters: [] as Chapter[],
  notes: [] as NoteItem[],
});

export class Contents {
  constructor(private r: Reader) {}

  open(tab = cs.tab) {
    const r = this.r;
    if (ui.contents || !r.strip || ui.sheet) return;
    r.cursor.end();
    ui.chip = null;
    this.setTab(tab);
    this.build();
    ui.contents = true;
  }

  close() {
    if (!ui.contents) return;
    ui.contents = false;
    this.r.stage?.focus({ preventScroll: true });
  }

  toggle(tab?: typeof cs.tab) {
    if (ui.contents && (!tab || tab === cs.tab)) this.close();
    else if (ui.contents && tab) this.setTab(tab);
    else this.open(tab);
  }

  /** The bookmarks in the book's order, each where it is now (reading `reader.bookmarks.list`:
   *  a component deriving from this follows them). */
  bookmarks(): BookmarkItem[] {
    const r = this.r,
      strip = r.strip;
    if (!strip) return [];
    return r.bookmarks.list
      .map(b => {
        const k = strip.resolve({ key: b.key, off: b.off });
        return { id: b.id, k, page: k + 1, where: r.headFor(k), quote: openingOf(b), at: b.at };
      })
      .sort((a, z) => a.k - z.k);
  }

  setTab(t: typeof cs.tab) {
    cs.tab = t;
    if (t === 'highlights') this.buildNotebook();
  }

  /** The start of the next chapter, or of this one or the one before (`d` -1: as a book's
   *  back button does, to this chapter's start first). */
  chapter(d: 1 | -1) {
    const r = this.r,
      strip = r.strip;
    if (!strip) return;
    const here = strip.itemAt(r.cur)?.sec ?? 0,
      n = strip.secStart.length;
    const sec = d > 0 ? Math.min(n - 1, here + 1) : r.cur > strip.secStart[here] ? here : Math.max(0, here - 1);
    r.travelTo(strip.secStart[sec]);
  }

  /** Keys while the contents show: Esc or M puts them away (their own controls take the
   *  rest, Tab among them). */
  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' || e.key === 'm' || e.key === 'M') {
      this.close();
      return true;
    }
    return false;
  }

  /** To a column, and the contents put away. */
  go(k: number) {
    this.close();
    this.r.travelTo(k);
  }

  /** The chapters: each by the page it starts on, the one the reader is in, those read. */
  build() {
    const r = this.r,
      strip = r.strip!,
      book = r.book!;
    const here = strip.itemAt(r.cur)?.sec;
    // where readers' notes are (a writer's book with feedback): a count by the chapter
    const fbIn = r.fb?.size ? r.fb.perSection() : null;
    cs.chapters = book.sections.map((s, sec) => {
      let n = 0,
        seen = 0;
      for (const b of s.blocks) {
        if (b.k === BlockKind.Break) continue;
        n++;
        if (r.progress.seen.has(b.key)) seen++;
      }
      return {
        sec,
        title: chapTitle(book, sec),
        page: strip.secStart[sec] + 1,
        read: n > 0 && seen / n > 0.95,
        current: here === sec,
        feedback: fbIn?.get(sec) ?? 0,
      };
    });
  }

  /** Everything the reader has added to this book, in reading order. */
  buildNotebook() {
    const r = this.r,
      strip = r.strip;
    if (!strip) return;
    cs.notes = r.marking.notebook().map(e => ({ ...e, k: strip.resolve(e.at) }));
  }

  /** The notebook as Markdown, grouped by chapter, that can be put back on the book. */
  markdown(items: NoteItem[]): string {
    const book = this.r.book!;
    return notesMarkdown([markdownOf({ id: book.id, title: book.title, author: book.author }, items)]);
  }

  /** One highlight to paste anywhere: its words, where they are from, the note. */
  citeEntry(it: NoteItem): string {
    const book = this.r.book!;
    const words = it.file?.quote ?? it.quote.replace(/ \/ /g, '\n');
    return `“${words}”\n— ${book.author ? book.author + ', ' : ''}${book.title}, ${it.where.replace(/\s+·\s+/g, ': ')}${it.note ? '\n\n' + it.note : ''}`;
  }

  /** A marked paragraph to paste anywhere, with where it is from. */
  cite(key: string) {
    const r = this.r,
      book = r.book!;
    const hit = r.strip!.keyIndex.get(key);
    if (!hit) return '';
    const blk = book.sections[hit[0]].blocks[hit[1]];
    return `“${blk.t.replace(/\n/g, ' / ')}”\n— ${book.author ? book.author + ', ' : ''}${book.title}, ${chapName(book, hit[0])}`;
  }

  async copy(text: string) {
    toast((await copyText(text)) ? 'Copied' : 'This browser would not copy. Select the text instead.');
  }
}
