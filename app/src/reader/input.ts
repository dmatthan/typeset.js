/** The reader's input: keys, the wheel and trackpad, and the pointer (a mouse, a pen, a
 *  finger). It decides what the hand meant and asks the reader and its motion for it.
 *  The rules it keeps (tests/reader.spec.ts holds it to them): Space turns the set in view,
 *  an arrow one column, a held arrow glides; a wheel notch is one column and every notch
 *  counts; a drag or trackpad moves the sheet 1:1 and lands on the nearest column (a push
 *  of less than one goes on to the next); key repeat is ignored; a mouse click on the text
 *  does nothing, a tap in a page's outer fifth turns it; the text is selected as anywhere
 *  (a mouse's drag, a finger's hold: the browser's and the system's own), and while
 *  something is selected a finger's press only puts it away. */
import { features } from '../core/embed';
import { ui } from '../state.svelte';
import { kv } from '../core/kv';
import { pointAt } from './selection';
import { Wheel } from './wheel';
import type { Reader } from './reader.svelte';
import type { Cursor } from './cursor';

/** The keys that turn: which way, and whether the whole set in view (else one column).
 *  (Space too: the whole set, Shift for back.) */
const TURNS: Partial<Record<string, readonly [1 | -1, boolean]>> = {
  ArrowRight: [1, false], ArrowDown: [1, false], l: [1, false], j: [1, false], PageDown: [1, true],
  ArrowLeft: [-1, false], ArrowUp: [-1, false], h: [-1, false], k: [-1, false], PageUp: [-1, true],
};
/** Choosing a paragraph from the keyboard (V, cursor.ts): its keys. */
const CURSOR: Partial<Record<string, (c: Cursor) => void>> = {
  j: c => c.move(1), ArrowDown: c => c.move(1), k: c => c.move(-1), ArrowUp: c => c.move(-1),
  x: c => c.highlight(false), h: c => c.highlight(false), Enter: c => c.highlight(false), ' ': c => c.highlight(false),
  n: c => c.highlight(true), o: c => c.open(), Escape: c => c.end(), v: c => c.end(),
};
/** The turns that end a choice and turn the page. */
const ENDS_CHOICE = new Set(['l', 'ArrowRight', 'ArrowLeft']);

/** Interaction constants: these are the point of the reader. */
const CRUISE_AFTER = 260;       // ms a key or press is held before the tap flows into a cruise
const HOLD = 450;               // ms a finger rests before it is no longer a tap (the system's selecting)
const SETTLED = 300;            // ms a finger's selection is still before the menu comes (handles move it)

export class ReaderInput {
  private keyHeld: string | null = null; private keyHoldT = 0;

  constructor(private r: Reader) { this.bind(); }

  /** The pointer last pressed on the page ('mouse', 'touch', 'pen'). */
  private pointer = '';

  /** What the browser's selection covers in the book, and the box its menu keeps clear of
   *  (in the stage's coordinates); null when nothing of the book is selected. `finger`: a
   *  finger's selection, beside which the system shows a menu of its own. */
  private selected(finger: boolean) {
    const s = getSelection(), strip = this.r.strip;
    // (spaces alone are no text: a press between two words of a justified line, its spaces
    // wide, can select one)
    if (!s || s.isCollapsed || !s.rangeCount || !strip || !s.toString().trim()) return null;
    const r0 = s.getRangeAt(0);
    const a = pointAt(strip, r0.startContainer, r0.startOffset), z = pointAt(strip, r0.endContainer, r0.endOffset);
    if (!a || !z || (a[0] === z[0] && a[1] === z[1] && a[2] === z[2])) return null;
    const box = r0.getBoundingClientRect(), st = this.r.stage.getBoundingClientRect();
    return { x: box.left + box.width / 2 - st.left, y: box.top - st.top, b: box.bottom - st.top, finger, sel: { a, z }, ann: null };
  }
  /** Something of the book is selected (by the hand or the system). */
  private selecting() { const s = getSelection(); return !!s && !s.isCollapsed && !!s.anchorNode && this.r.stage.contains(s.anchorNode); }

  private zoneAt(clientX: number): 'prev' | 'next' | 'focus' {
    const M = this.r.M, x = clientX - this.r.stage.getBoundingClientRect().left;
    const l = M.x0 - M.G / 2, r = M.x0 + M.focusW + M.G / 2;
    return x < l ? 'prev' : x > r ? 'next' : 'focus';
  }

  /** Reader keys. Returns true if handled. */
  key(e: KeyboardEvent): boolean {
    if (!this.r.strip) return false;
    const k = e.key;
    // choosing a paragraph from the keyboard (V): its keys; a turn ends it and turns; any
    // other key is held back while it lasts
    if (this.r.cursor.active) {
      const act = CURSOR[k];
      if (act) { act(this.r.cursor); return true; }
      if (!ENDS_CHOICE.has(k)) return true;
      this.r.cursor.end();
    }
    const turn = k === ' ' ? ([e.shiftKey ? -1 : 1, true] as const) : TURNS[k];
    if (turn) { this.turnBy(e, turn[0], turn[1]); return true; }
    return this.other(k);
  }

  /** A key that turns: the whole set in view (`whole`) or a column; held, it glides so the
   *  reader chooses how far (key repeat never turns: holding cruises). */
  private turnBy(e: KeyboardEvent, d: 1 | -1, whole: boolean) {
    if (e.repeat) return;
    const k = e.key;
    this.keyHeld = k;
    this.r.step(d, whole ? undefined : 1);
    clearTimeout(this.keyHoldT);
    this.keyHoldT = window.setTimeout(() => { if (this.keyHeld === k && !ui.sheet && !ui.contents) this.r.motion.cruise(d); }, CRUISE_AFTER);
  }

  /** The rest: ; the notes beside the text (and away again); Escape puts away the notes in
   *  view, or ends a search whose field is put away, which N steps through meanwhile. */
  private other(k: string): boolean {
    const f = this.r.finder;
    if (k === ';' && features.highlights) this.r.toggleNotes();
    else if (k === 'Escape' && ui.sideNotes) ui.sideNotes = null;
    else if (f.open && (k === 'n' || k === 'N') && f.hits.length) k === 'n' ? f.next() : f.prev();
    else if (f.open && k === 'Escape') f.hide();
    else return false;
    return true;
  }

  keyUp(e: KeyboardEvent) {
    if (this.keyHeld && (e.key === this.keyHeld || e.key.toLowerCase() === this.keyHeld.toLowerCase())) {
      this.keyHeld = null; clearTimeout(this.keyHoldT);
      this.r.motion.release();
    }
  }

  blur() { this.keyHeld = null; clearTimeout(this.keyHoldT); this.r.motion.release(); }

  /** What a press in the text opens, by what it was on. */
  private targets: [string, (el: HTMLElement) => void][] = [
    ['a.nr', el => this.r.openNote(+el.dataset.n!, el)],
    ['a.xr', el => this.r.followRef(el.dataset.b!)],
    ['a.ur', el => this.r.openLink(el.dataset.u!)],
    ['figure.img', el => this.r.openImage(+el.dataset.i!, el)],
    // (with the rail, every note in view has its card already)
    ['.nd', el => { ui.chip = null; if (!ui.railed) ui.sideNotes = { ids: [el.dataset.a!], pinned: true }; }],
  ];
  private opens(t: EventTarget | null): boolean {
    for (const [sel, run] of this.targets) {
      const el = (t as Element | null)?.closest?.(sel) as HTMLElement | null;
      if (el) { run(el); return true; }
    }
    return false;
  }
  /** A highlight pressed: its menu, keeping clear of the whole highlight in that column (not
   *  only the line pressed); a finger's goes in a band, as a selection's does. Find's hits
   *  (h5, h6) are not highlights. */
  private highlightMenu(t: EventTarget | null, x: number, finger: boolean): boolean {
    const mark = (t as Element | null)?.closest?.('mark.hl:not(.h5):not(.h6)') as HTMLElement | null;
    if (!mark) return false;
    const stage = this.r.stage, r = stage.getBoundingClientRect(), col = mark.closest('.col') ?? stage;
    const ms = [...col.querySelectorAll(`mark[data-a="${CSS.escape(mark.dataset.a!)}"]`)].map(m => m.getBoundingClientRect());
    ui.chip = { x: x - r.left, y: Math.min(...ms.map(m => m.top)) - r.top, b: Math.max(...ms.map(m => m.bottom)) - r.top, finger, sel: null, ann: mark.dataset.a! };
    return true;
  }

  /** Something over the page that scrolls itself (a long note, a note being written): the
   *  wheel there is its own, to its end and past it, never a turn of the page beneath. */
  private scrolls(t: EventTarget | null): boolean {
    for (let e = t as Element | null; e && e !== this.r.stage; e = e.parentElement) {
      const s = getComputedStyle(e);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight) return true;
    }
    return false;
  }

  /** Wheel input: a mouse wheel's notches and a trackpad's swipes, told apart (wheel.ts). */
  private wheel = new Wheel(d => this.r.motion.notch(d), log => kv.set('diag.input', log));
  private onWheel(e: WheelEvent) {
    if (this.scrolls(e.target)) return;
    e.preventDefault();
    if (!this.r.strip || ui.contents || ui.sheet) return;
    // (a trackpad's pinch: the page does not zoom, and nothing else answers it)
    if (e.ctrlKey) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1, across = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const legacy = (across ? (e as WheelEvent & { wheelDeltaX?: number }).wheelDeltaX : (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY) ?? 0;
    this.wheel.feed({ delta: (across ? e.deltaX : e.deltaY) * unit, mode: e.deltaMode, legacy, t: performance.now() });
  }

  private bind() {
    const stage = this.r.stage;
    stage.addEventListener('wheel', e => this.onWheel(e), { passive: false });

    const PTR = new Map<number, { x: number; y: number }>();
    let GS: any = null;
    const cancelPress = () => { if (GS) clearTimeout(GS.holdT); };
    stage.addEventListener('pointerdown', e => {
      if (ui.contents || !this.r.strip || e.button > 0) return;
      // a card over the page (a book's note, your notes) takes its own presses: never a
      // turn or a selection of the page beneath it
      if ((e.target as Element).closest?.('.bn, .sn')) return;
      // controls handle themselves, wherever they are (a note's card, the rail's foot); links
      // in the text (notes, references) are the reader's; the notes' rail is its own, its
      // paper no side of the page to turn by
      const ctl = (e.target as Element).closest?.('textarea, button, input, label, a:not(.nr):not(.xr):not(.ur)');
      if (ctl || (ui.railed && e.clientX - stage.getBoundingClientRect().left >= this.r.M.W)) return;
      const zone = this.zoneAt(e.clientX);
      // the text is selected as in any document, by the browser or the system: a mouse's drag
      // (the menu when the button is let go; it never moves the sheet there: the keys, the
      // wheel and the sides do), a finger held on a word (the system's handles and menu,
      // and ours once it rests). A finger's press is captured only once it drags the sheet,
      // so that a hold stays the system's
      const native = e.pointerType === 'mouse' && zone === 'focus';
      const touch = e.pointerType !== 'mouse';
      this.pointer = e.pointerType;
      // a first finger (or a mouse) down means nothing else is: a press whose end was never
      // heard (iOS takes a held finger over to select, and may keep its lift) is over, not a
      // finger still down that would make every later one a second (and the page unturnable)
      if (e.isPrimary && PTR.size) { cancelPress(); if (GS?.dragging) this.r.motion.directEnd(); GS = null; PTR.clear(); }
      PTR.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!native && !(touch && zone === 'focus')) try { stage.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      // a second finger ends what the first began: two-finger gestures are the system's
      if (PTR.size === 2) {
        cancelPress();
        if (GS?.dragging) this.r.motion.directEnd();
        GS = null;
        return;
      }
      if (PTR.size > 2) return;
      // (the stage captures any pointer but a mouse in the text: remember what was under the press)
      // something selected: a finger's press only puts it away (the system's way), never a
      // turn or a drag of the sheet under the handles
      GS = { x0: e.clientX, y0: e.clientY, xl: e.clientX, t0: performance.now(), zone, moved: false, dragging: false, down: e.target, touch, native, clearing: touch && this.selecting() };
      ui.chip = null;
      if (native || GS.clearing) return;
      if (zone !== 'focus') {
        const d = zone === 'next' ? 1 : -1;
        GS.holdT = setTimeout(() => { if (GS && !GS.moved) { GS.holding = true; this.r.motion.tap(d); this.r.motion.cruise(d); } }, CRUISE_AFTER + 160);
      }
    });
    stage.addEventListener('pointermove', e => {
      if (!PTR.has(e.pointerId) || !GS) return;
      PTR.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (GS.native || GS.clearing) return;
      const dx = e.clientX - GS.x0, dy = e.clientY - GS.y0;
      // (a finger rests less still than a mouse: a tap may wander a little)
      if (!GS.moved && Math.hypot(dx, dy) > (GS.touch ? 12 : 8)) {
        GS.moved = true; cancelPress();
        if (GS.holding) return;
        if (Math.abs(dx) >= Math.abs(dy)) {
          GS.dragging = true; this.r.motion.directStart(); GS.xl = GS.x0;   // catch up with the hand
          try { stage.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        }
      }
      // the sheet follows the hand, one to one
      if (GS.dragging) { this.r.motion.directBy(-(e.clientX - GS.xl) / this.r.M.P); GS.xl = e.clientX; }
    });
    const end = (e: PointerEvent) => {
      if (!PTR.has(e.pointerId)) return;
      PTR.delete(e.pointerId);
      if (!GS) return;
      const g = GS; cancelPress(); GS = null;
      // the browser's selection, made with the mouse: the menu above it
      if (g.native) {
        const sel = this.selected(false);
        if (sel) { if (features.highlights) ui.chip = sel; return; }
      }
      // what a finger's press did while something was selected: put it away, and no more
      if (g.clearing) { if (!g.moved) getSelection()?.removeAllRanges(); return; }
      if (g.holding) { this.r.motion.release(); return; }
      if (g.dragging) { this.r.motion.directEnd(); return; }
      if (e.type === 'pointercancel') return;
      // a finger that rested was the system's (selecting, or its menu): not a tap
      if (g.touch && g.zone === 'focus' && (performance.now() - g.t0 > HOLD || this.selecting())) return;
      const dy = e.clientY - g.y0;
      if (g.moved) { if (Math.abs(dy) > 44) this.r.step(dy < 0 ? 1 : -1); return; }
      // in the text: what was pressed opens (a note's marker, a reference, a link, a
      // picture, a note's dot), or a highlight its menu
      if (g.zone === 'focus' && (this.opens(g.down) || this.highlightMenu(g.down, e.clientX, g.touch))) return;
      // a finger, as phone readers expect: the outer fifth of the page turns it, the middle
      // shows or hides the bar (a mouse keeps the rule that tapping the text does nothing)
      if (g.touch && g.zone === 'focus') {
        const r = stage.getBoundingClientRect(), at = (e.clientX - r.left) / r.width;
        if (at < 0.2) this.r.step(-1);
        else if (at > 0.8) this.r.step(1);
        else ui.barToggle++;
        return;
      }
      if (g.zone === 'next') this.r.step(1);
      else if (g.zone === 'prev') this.r.step(-1);
    };
    // (heard wherever it lands: a press begun on the page may end off it, over the bar or a
    // menu, or on lines rebuilt under the finger)
    addEventListener('pointerup', end, true);
    addEventListener('pointercancel', end, true);
    // a note's dot, or its highlight, shows the note beside the line while the pointer rests
    // on either (or on the card); a pinned note stays until put away
    let hoverT = 0;
    stage.addEventListener('pointerover', e => {
      if (e.pointerType !== 'mouse' || GS || ui.chip || ui.railed) return;
      const t = (e.target as Element).closest?.('.nd, mark.hl[data-a], .fb[data-f], .sn') as HTMLElement | null;
      if (!t) return;
      clearTimeout(hoverT);
      if (t.classList.contains('sn') || ui.sideNotes?.pinned) return;
      // a dot or a highlight names one note; another reader's underline, all on its words
      const ids = (t.dataset.f ?? t.dataset.a!).split(' ').filter(id => id.includes('|') ? !!this.r.fb?.find(id)?.n.note : this.r.ann?.list.some(a => a.id === id && a.note));
      if (!ids.length) return;
      if (ui.sideNotes?.ids.join() !== ids.join()) ui.sideNotes = { ids, pinned: false };
    });
    stage.addEventListener('pointerout', e => {
      if (!ui.sideNotes || ui.sideNotes.pinned) return;
      const t = (e.target as Element).closest?.('.nd, mark.hl[data-a], .fb[data-f], .sn');
      const to = (e.relatedTarget as Element | null)?.closest?.('.nd, mark.hl[data-a], .fb[data-f], .sn');
      if (!t || to) return;
      clearTimeout(hoverT);
      hoverT = window.setTimeout(() => { if (ui.sideNotes && !ui.sideNotes.pinned) ui.sideNotes = null; }, 280);
    });
    // a selection begins only in the book's text (beside it, a press moves the sheet)
    const inText = (t: EventTarget | null) => { const n = t as Node | null; return !!(n?.nodeType === 3 ? n.parentElement : (n as Element | null))?.closest?.('.track .ln'); };
    stage.addEventListener('selectstart', e => { if (!inText(e.target)) e.preventDefault(); });
    // a finger's selection, as the system makes it and its handles change it: the menu
    // comes once it rests, and goes when it does (a mouse's is read when the button is let go)
    let restT = 0;
    document.addEventListener('selectionchange', () => {
      clearTimeout(restT);
      if (GS?.native || this.pointer === 'mouse') return;
      if (ui.chip?.sel) ui.chip = null;
      if (!this.selecting()) return;
      restT = window.setTimeout(() => { const sel = this.selected(true); if (sel && features.highlights && !ui.sheet) ui.chip = sel; }, SETTLED);
    });
    stage.addEventListener('mousedown', e => {
      const t = e.target as Element;
      if (t.closest?.('textarea, input, button, a, label')) return;
      this.r.stage.focus({ preventScroll: true });
      if (!(t.closest?.('.ln') && this.zoneAt(e.clientX) === 'focus')) e.preventDefault();
    });
    // a finger's long press on the text is the system's (Android selects through it); a
    // mouse's right click keeps the page's own quiet (no browser menu over the book)
    stage.addEventListener('contextmenu', e => { if (!(e.target as Element).closest?.('textarea') && (this.pointer === 'mouse' || !(e.target as Element).closest?.('.ln'))) e.preventDefault(); });
    stage.addEventListener('scroll', () => { stage.scrollLeft = 0; stage.scrollTop = 0; });

    const track = this.r.surface.track;
    track.addEventListener('focusin', e => {
      stage.scrollLeft = 0;
      const col = (e.target as Element).closest('.col') as HTMLElement | null; if (!col) return;
      const k = +col.dataset.k!;
      if (!this.r.focusCols().includes(k)) this.r.go(k);
    });
  }
}
