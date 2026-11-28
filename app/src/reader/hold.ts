/** The page as it was, faded into the new one at the moment the text is set again
 *  (another size, face or spacing, the notes' rail, the window resized): a copy of the
 *  columns in view, taken in the frame the new page comes (the old one is whole until
 *  then: the new is worked out apart from it, reader.svelte.ts `commit`), over it, fading.
 *  The page underneath is the new one from the first frame, and takes every press.
 *
 *  As it fades the copy is carried so that the line being read (the head of the page,
 *  which the new page keeps in view) lands where that line is now, at its new size: the
 *  eye follows it there. The fade is the compositor's (opacity and a transform): it runs
 *  on however busy the page is. Where less motion is asked for there is none.
 *
 *  (It was first a hold over the page for the whole wait, the page's style changing under
 *  it: that froze a page half changed, and hid the page, and any press on it, for the
 *  wait. The page itself keeps its style until the new text comes now: nothing to hide.) */
import { setVars, type Vars } from './paint';
import { reduceMotion } from './settings.svelte';

const FADE_MS = 180;
/** However the fade goes, the copy is never left over the page. */
const AT_MOST_MS = 1000;
/** The most the copy grows or shrinks toward the new size as it fades: enough to say the
 *  text grows into place, never a zoom (its first line lands exactly; the rest, faded,
 *  need not). */
const SCALE = 0.1;

export interface Point {
  x: number;
  y: number;
}

/** Where a line of the page begins, in `stage`'s coordinates: among `cols`, the last line
 *  of block `b` (its place in its section) that starts at or before `off`. */
export function lineStart(stage: HTMLElement, cols: HTMLElement[], b: number, off: number): Point | null {
  let best: HTMLElement | null = null;
  for (const c of cols)
    for (const l of c.querySelectorAll<HTMLElement>(`.ln[data-b="${b}"]`))
      if (+l.dataset.s! <= off && (!best || +l.dataset.s! > +best.dataset.s!)) best = l;
  if (!best) return null;
  const r = best.getBoundingClientRect(),
    st = stage.getBoundingClientRect();
  return { x: r.left - st.left, y: r.top - st.top };
}

export class Hold {
  private el: HTMLElement | null = null;
  /** The copy's box, which is carried (the copy, which fades, has the paper). */
  private box: HTMLElement | null = null;
  private fading: Animation | null = null;
  private lost = 0;
  /** Where the line being read began in the copy (the stage's coordinates). */
  private from: Point | null = null;

  /** Lays a copy of `cols` (the columns in view) over `stage`, where `track` shows them
   *  now, drawn with `vars` (those they were set with: the page's change in the same
   *  frame), the line being read beginning at `from` (in the stage's coordinates). */
  take(stage: HTMLElement, track: HTMLElement, cols: (HTMLElement | undefined)[], vars: Vars, from: Point | null) {
    this.drop();
    const el = document.createElement('div');
    el.className = 'hold';
    el.setAttribute('aria-hidden', 'true');
    setVars(el, vars);
    const box = document.createElement('div');
    box.className = 'held';
    const t = document.createElement('div');
    t.className = 'track';
    // (where the sheet is drawn this moment, a move's own frame included)
    t.style.transform = getComputedStyle(track).transform;
    // (a picture of the page, no more: nothing in it answers for a column, a note or a mark
    // that code looks for by its data, while the real ones are set under it)
    for (const c of cols) {
      if (!c) continue;
      const k = c.cloneNode(true) as HTMLElement;
      for (const e of [k, ...k.querySelectorAll<HTMLElement>('*')])
        for (const a of [...e.attributes]) if (a.name.startsWith('data-')) e.removeAttribute(a.name);
      t.append(k);
    }
    box.append(t);
    el.append(box);
    stage.append(el);
    this.el = el;
    this.box = box;
    this.from = from;
    this.lost = window.setTimeout(() => this.drop(), AT_MOST_MS);
  }

  /** The new page is in: the copy fades into it, carried so that the line being read
   *  lands at `to` (in the stage's coordinates, where that line now begins), grown or
   *  shrunk toward the new size by `scale` (capped). */
  release(to: Point | null = null, scale = 1) {
    const el = this.el,
      box = this.box,
      from = this.from;
    if (!el || !box || this.fading) return;
    if (reduceMotion()) {
      this.drop();
      return;
    }
    const timing: KeyframeAnimationOptions = {
      duration: FADE_MS,
      easing: 'cubic-bezier(.3, 0, .2, 1)',
      fill: 'forwards',
    };
    if (from && to) {
      const s = Math.min(1 + SCALE, Math.max(1 - SCALE, scale));
      box.style.transformOrigin = `${from.x}px ${from.y}px`;
      box.animate(
        [{ transform: 'none' }, { transform: `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(${s})` }],
        timing,
      );
    }
    const a = (this.fading = el.animate([{ opacity: 1 }, { opacity: 0 }], timing));
    a.onfinish = () => {
      if (this.fading === a) this.drop();
    };
  }

  /** The copy gone, at once (a book closing; another change; a copy outstaying its time). */
  drop() {
    clearTimeout(this.lost);
    this.fading?.cancel();
    this.fading = null;
    this.el?.remove();
    this.el = this.box = null;
    this.from = null;
  }
}
