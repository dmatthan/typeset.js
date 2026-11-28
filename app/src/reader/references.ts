/** What a press on the text opens: a note beside its marker, a link out of the book (asked
 *  about first), another place in the book, a picture. The reader's (`reader.references`). */
import { features } from '../core/embed';
import { shell } from '../core/shell';
import { ui, toast } from '../state.svelte';
import type { Reader } from './reader.svelte';

export class References {
  constructor(private r: Reader) {}

  /** Shows note `i` beside its marker. */
  openNote(i: number, at: HTMLElement) {
    if (!this.r.book?.notes[i]) return;
    const rect = at.getBoundingClientRect(), st = this.r.stage.getBoundingClientRect();
    const below = rect.bottom - st.top < st.height * 0.6;
    ui.chip = null;
    ui.bookNote = { i, x: rect.left + rect.width / 2 - st.left, y: (below ? rect.bottom + 6 : rect.top - 6) - st.top, below };
  }

  /** Where a note is printed in the book, as a column to go to. */
  noteHome(i: number): number | null {
    const { book, strip } = this.r;
    const at = book?.notes[i]?.at;
    return at && strip ? strip.resolve({ key: at, off: 0 }) : null;
  }

  /** A link out of the book: asked about first, naming the address (a press on a word is
   *  easily made, and it leaves the book), as Apple Books asks; opened from there
   *  (LinkSheet). Not where the page around an embedded reader has said its links are not
   *  to be followed; an address that may not be opened is refused at once. */
  openLink(url: string) {
    if (!features.links) return;
    if (!shell.outward(url)) { toast('This link can’t be opened.'); return; }
    ui.chip = null;
    ui.leaving = url; ui.sheet = 'link';
  }

  /** Travels to the block a reference names. */
  follow(key: string) {
    if (!this.r.strip) return;
    ui.bookNote = null;
    this.r.travelTo(this.r.strip.resolve({ key, off: 0 }));
  }

  /** Shows picture `i` large, rising from where it is on the page. */
  openImage(i: number, fig: HTMLElement) {
    const rect = fig.getBoundingClientRect();
    ui.bookNote = null; ui.chip = null;
    ui.lightbox = { i, rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height } };
  }
}
