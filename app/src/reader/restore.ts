/** One's own notes put back on a book from a notes file. */
import type { BookData, Core } from '../core/types';
import { kv } from '../core/kv';
import { keyIndexOf } from '../core/book';
import { count } from '../core/say';
import { Annotations, type Annotation } from './annotations';
import { me } from '../core/identity';
import type { FileNote, NotesFile } from './feedback';
import { notebookOf, saveDigest } from './notebook';
import { loadBookmarks, saveBookmarks } from './bookmarks.svelte';

/** Whether a notes file is this reader's own (an export, or a copy from another device of
 *  theirs): put back as their notes, not shown as someone's feedback. */
export const isMine = (f: NotesFile) => f.from.id === me().id;

const annotationOf = (n: FileNote): Annotation => ({
  id: n.id, key: n.key, s: n.s, e: n.e, quote: n.quote, prefix: n.prefix ?? '', suffix: n.suffix ?? '', pos: n.pos,
  color: n.color ?? 1, note: n.note ?? '', created: n.created || Date.now(), updated: n.updated || Date.now(),
});
const anchorOf = (n: FileNote) => ({ key: n.key, s: n.s, e: n.e, quote: n.quote, prefix: n.prefix ?? '', suffix: n.suffix ?? '', pos: n.pos });

/** One's own notes put back on a book: highlights merged (by id) and found in its text
 *  (exactly on the same book; by their words on another version of it), marked
 *  paragraphs and bookmarks found by their opening words. `ann` and `marks` are the
 *  book's own, saved as they change (bookmarks are read and saved here: `bm.<id>`).
 *  Returns how many came back and how many were not found. */
export async function restoreInto(f: NotesFile, book: BookData, core: Core, ann: Annotations, marks: Set<string>) {
  const fresh = ann.merge(f.notes.filter(n => n.kind === 'highlight').map(annotationOf));
  await ann.place(core);
  const ids = new Set(fresh.map(a => a.id));
  let lost = ann.list.filter(a => ids.has(a.id) && a.lost).length;
  let back = fresh.length - lost + (fresh.updated ?? 0);
  const mk = f.notes.filter(n => n.kind === 'mark');
  if (mk.length) {
    const placed = await core.place(book.id, mk.map(anchorOf));
    for (const p of placed) {
      if (p && p.how !== 'lost') { if (!marks.has(p.key)) { marks.add(p.key); back++; } }
      else lost++;
    }
    kv.set('marks.' + book.id, [...marks]);
  }
  const bk = f.notes.filter(n => n.kind === 'bookmark');
  if (bk.length) {
    const list = loadBookmarks(book.id), placed = await core.place(book.id, bk.map(anchorOf));
    placed.forEach((p, i) => {
      if (!p || p.how === 'lost') { lost++; return; }
      if (list.some(b => b.id === bk[i].id || (b.key === p.key && b.off === p.s))) return;
      list.push({ id: bk[i].id, key: p.key, off: p.s, quote: bk[i].quote, prefix: bk[i].prefix ?? '', suffix: bk[i].suffix ?? '', at: bk[i].created || Date.now() });
      back++;
    });
    saveBookmarks(book.id, list);
  }
  return { back, lost };
}

/** The same for a book that is not open: its notebook's digest is written again. */
export async function restoreOwn(f: NotesFile, bookId: string, core: Core) {
  const book = await core.open(bookId);
  const keyIndex = keyIndexOf(book);
  const ann = new Annotations(book, keyIndex);
  const marks = new Set(kv.get<string[]>('marks.' + bookId, []));
  const r = await restoreInto(f, book, core, ann, marks);
  saveDigest(book, notebookOf(book, keyIndex, ann.list, marks));
  return r;
}

/** What came back, said plainly. */
export function restored(title: string, r: { back: number; lost: number }) {
  if (!r.back && !r.lost) return `Your notes on “${title}” are all here already.`;
  return `${count(r.back, 'of your notes', 'of your notes')} put back on “${title}”${r.lost ? `; ${count(r.lost, 'was', 'were')} not found in this version` : ''}.`;
}
