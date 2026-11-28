/** Selections in the book: the browser's selection (a mouse's drag, a finger's hold: the
 *  system's own; input.ts) as places in the text, a selection's stretch of each paragraph
 *  it covers and its words, and putting it away. */
import type { BookData } from '../core/types';
import type { Strip } from './strip';

/** A place in the text: section, block, UTF-16 offset. */
export type Point = [number, number, number];

/** A text selection in the book: from one point to another (either may come first). */
export interface Sel {
  a: Point;
  z: Point;
}

/** The selection's ends in reading order. */
function ordered(sel: Sel): [Point, Point] {
  const [as, ab, ao] = sel.a,
    [zs, zb, zo] = sel.z;
  return as > zs || (as === zs && (ab > zb || (ab === zb && ao > zo))) ? [sel.z, sel.a] : [sel.a, sel.z];
}

/** Each block a selection covers, with the stretch of its text, in reading order. */
export function* spans(book: BookData, sel: Sel): Generator<{ s: number; b: number; from: number; to: number }> {
  const [[as, ab, ao], [zs, zb, zo]] = ordered(sel);
  for (let s = as; s <= zs; s++) {
    const blocks = book.sections[s].blocks;
    for (let b = s === as ? ab : 0; b <= (s === zs ? zb : blocks.length - 1); b++) {
      yield { s, b, from: s === as && b === ab ? ao : 0, to: s === zs && b === zb ? zo : blocks[b].t.length };
    }
  }
}

/** The quote of a selection, for copying. */
export function selText(book: BookData, sel: Sel): string {
  const parts: string[] = [];
  for (const { s, b, from, to } of spans(book, sel))
    parts.push(book.sections[s].blocks[b].t.slice(from, to).replace(/\n/g, ' / '));
  return parts.join('\n\n').trim();
}

/** A DOM point inside a line, as a place in the text. */
export function pointAt(strip: Strip, node: Node | null, off: number): Point | null {
  const el = node?.nodeType === 3 ? node.parentElement : (node as Element | null);
  const ln = el?.closest?.('.ln[data-b]') as HTMLElement | null;
  const col = ln?.closest('.col') as HTMLElement | null;
  if (!ln || !col) return null;
  const it = strip.itemAt(+col.dataset.k!);
  if (!it || it.type !== 'sect') return null;
  let n = 0;
  const tw = document.createTreeWalker(ln, NodeFilter.SHOW_TEXT);
  for (let t = tw.nextNode(); t; t = tw.nextNode()) {
    if ((t.parentElement as Element).closest('.bul')) continue;
    if (t === node) {
      n += off;
      break;
    }
    n += (t as Text).length;
  }
  if (node?.nodeType !== 3) n = 0;
  return [it.sec, +ln.dataset.b!, +ln.dataset.s! + n];
}

/** The browser's selection put away, if it lies in `within` (the book's stage): what a
 *  highlight made, a note begun, Escape or the page moving end. */
export function unselect(within: Element | undefined) {
  const s = getSelection();
  if (s && !s.isCollapsed && s.anchorNode && within?.contains(s.anchorNode)) s.removeAllRanges();
}
