/** What a reader marks on the book: highlights with their notes and reactions, marked
 *  paragraphs, and the notebook they make (in reading order, and the library's copy of
 *  it). The reader holds the book and its annotations; this changes them and redraws
 *  what shows them. */
import { kv } from '../core/kv';
import { ui } from '../state.svelte';
import type { Reaction } from './annotations';
import { notebookOf, saveDigest } from './notebook';
import type { Reader } from './reader.svelte';
import { spans, selText, type Sel } from './selection';

export class Marking {
  constructor(private r: Reader) {}

  /* ---------- marks ---------- */
  toggleMark(key: string) {
    if (this.r.marks.has(key)) this.r.marks.delete(key);
    else this.r.marks.add(key);
    this.paintMark(key);
    kv.set('marks.' + this.r.book!.id, [...this.r.marks]);
    this.digestSoon();
  }

  /* ---------- the notebook ---------- */
  /** Everything added to this book, in reading order. */
  notebook() {
    return notebookOf(this.r.book!, this.r.strip!.keyIndex, this.r.ann?.list ?? [], this.r.marks);
  }
  private digestT = 0;
  /** The library's copy of this book's notebook, written a moment after a change. */
  digestSoon() {
    clearTimeout(this.digestT);
    this.digestT = window.setTimeout(() => { this.digestT = 0; this.saveDigest(); }, 400);
  }
  private saveDigest() { if (this.r.book && this.r.strip) saveDigest(this.r.book, this.notebook()); }
  /** The library's copy written now, if one is waiting (the book closing). */
  flushDigest() {
    if (!this.digestT) return;
    clearTimeout(this.digestT); this.digestT = 0; this.saveDigest();
  }

  paintMark(key: string) {
    const hit = this.r.strip?.keyIndex.get(key);
    if (!hit) return;
    const on = this.r.marks.has(key);
    for (const [k, el] of this.r.surface.rendered()) {
      const it = this.r.strip!.itemAt(k);
      if (!it || it.sec !== hit[0] || it.type !== 'sect') continue;
      for (const ln of el.querySelectorAll(`.ln[data-b="${hit[1]}"]`)) ln.classList.toggle('mk', on);
    }
  }

  /* ---------- highlights and notes ---------- */
  /** Re-renders every visible column of a section after its annotations changed. */
  refreshSection(sec: number) {
    for (const [k] of this.r.surface.rendered()) if (this.r.strip!.itemAt(k)?.sec === sec) this.r.surface.refresh(k);
    ui.annVersion++;
    this.digestSoon();
  }

  /** Highlights a selection (one annotation per block it covers). Returns the first. */
  highlight(sel: Sel, color = 1, note = ''): string | null {
    const book = this.r.book!, ann = this.r.ann!;
    let first: string | null = null;
    const touched = new Set<number>();
    for (const { s, b, from, to } of spans(book, sel)) {
      const blk = book.sections[s].blocks[b];
      if (!blk.t) continue;
      const a = ann.add(blk.key, from, to, color, first ? '' : note);
      if (a && !first) first = a.id;
      touched.add(s);
    }
    for (const s of touched) this.refreshSection(s);
    return first;
  }

  recolor(id: string, color: number) { this.r.ann!.update(id, { color }); this.refreshAnn(id); }
  /** A reaction on a highlight, or on a selection (highlighted for it); the same one
   *  again takes it off. */
  react(on: { ann?: string | null; sel?: Sel | null }, r: Reaction): string | null {
    const id = on.ann ?? (on.sel ? this.highlight(on.sel, 1) : null);
    if (!id) return null;
    const a = this.r.ann!.list.find(x => x.id === id);
    this.r.ann!.update(id, { react: a?.react === r ? undefined : r });
    this.refreshAnn(id);
    return id;
  }
  setNote(id: string, note: string) {
    this.r.ann!.update(id, { note }); this.refreshAnn(id);
  }
  unhighlight(id: string) {
    const a = this.r.ann!.list.find(x => x.id === id);
    this.r.ann!.remove(id);
    if (a) this.refreshSection(this.r.strip!.keyIndex.get(a.key)?.[0] ?? -1);
  }
  private refreshAnn(id: string) {
    const a = this.r.ann!.list.find(x => x.id === id);
    if (a) this.refreshSection(this.r.strip!.keyIndex.get(a.key)?.[0] ?? -1);
  }

  /** The quote of a selection, for copying. */
  selText(sel: Sel): string { return selText(this.r.book!, sel); }
}
