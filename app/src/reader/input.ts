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
import { hint } from './hints';
import { pointAt } from './selection';
import type { Reader } from './reader.svelte';

/** Interaction constants: these are the point of the reader. */
const CRUISE_AFTER = 260;       // ms a key or press is held before the tap flows into a cruise
const WHEEL_QUIET = 90;         // ms without wheel input that end a trackpad gesture
const WHEEL_LOCK = 200;         // ms of quiet before input is read again after a takeover
const HOLD = 450;               // ms a finger rests before it is no longer a tap (the system's selecting)
const SETTLED = 300;            // ms a finger's selection is still before the menu comes (handles move it)

export class ReaderInput {
  private keyHeld: string | null = null; private keyHoldT = 0;
  private wheel: { kind: 'notch' | 'direct' | 'locked'; last: number; mags: number[]; t0: number; endT: number; acc: number; log: [number, number][]; from: number } | null = null;
  /** Turns by a press beside the page (for the hint that keys do it too). */
  taps = 0;

  constructor(private r: Reader) { this.bind(); }

  /** The pointer last pressed on the page ('mouse', 'touch', 'pen'). */
  private pointer = '';

  /** What the browser's selection covers in the book, and the box its menu keeps clear of
   *  (in the stage's coordinates); null when nothing of the book is selected. `native`: a
   *  finger's selection, beside which the system shows a menu of its own. */
  private selected(native: boolean) {
    const s = getSelection(), strip = this.r.strip;
    if (!s || s.isCollapsed || !s.rangeCount || !strip) return null;
    const r0 = s.getRangeAt(0);
    const a = pointAt(strip, r0.startContainer, r0.startOffset), z = pointAt(strip, r0.endContainer, r0.endOffset);
    if (!a || !z || (a[0] === z[0] && a[1] === z[1] && a[2] === z[2])) return null;
    const box = r0.getBoundingClientRect(), st = this.r.stage.getBoundingClientRect();
    return { x: box.left + box.width / 2 - st.left, y: box.top - st.top, b: box.bottom - st.top, native, sel: { a, z }, ann: null };
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
    if (this.r.cursor.active) {
      if (k === 'j' || k === 'ArrowDown') { this.r.cursor.move(1); return true; }
      if (k === 'k' || k === 'ArrowUp') { this.r.cursor.move(-1); return true; }
      if (k === 'x' || k === 'h' || k === 'Enter' || k === ' ') { this.r.cursor.highlight(false); return true; }
      if (k === 'n') { this.r.cursor.highlight(true); return true; }
      if (k === 'o') { this.r.cursor.open(); return true; }
      if (k === 'Escape' || k === 'v') { this.r.cursor.end(); return true; }
      if (k === 'l' || k === 'ArrowRight' || k === 'h' || k === 'ArrowLeft') this.r.cursor.end();
      else return true;
    }
    // Space and the page keys turn the whole set in view; arrows (and vim keys) move one
    // column, and held they glide so the reader chooses how far
    const page = k === ' ' || k === 'PageDown' || k === 'PageUp';
    const next = k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === 'l' || k === 'j' || (k === ' ' && !e.shiftKey);
    const prev = k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'h' || k === 'k' || (k === ' ' && e.shiftKey);
    if (next || prev) {
      if (e.repeat) return true;                 // key repeat never turns; holding cruises
      const d = next ? 1 : -1;
      this.keyHeld = k;
      this.r.step(d, page ? undefined : 1);
      clearTimeout(this.keyHoldT);
      this.keyHoldT = window.setTimeout(() => { if (this.keyHeld === k && !ui.sheet && !ui.contents) this.r.motion.cruise(d); }, CRUISE_AFTER);
      return true;
    }
    // ; the notes beside the text (their rail, or those in view over it), and away again
    if (k === ';') { this.r.toggleNotes(); return true; }
    if (k === 'Escape' && ui.sideNotes) { ui.sideNotes = null; return true; }
    // a search goes on with its field put away: N steps through it, Esc ends it
    if (this.r.finder.open) {
      if ((k === 'n' || k === 'N') && this.r.finder.hits.length) { k === 'n' ? this.r.finder.next() : this.r.finder.prev(); return true; }
      if (k === 'Escape') { this.r.finder.hide(); return true; }
    }
    return false;
  }

  keyUp(e: KeyboardEvent) {
    if (this.keyHeld && (e.key === this.keyHeld || e.key.toLowerCase() === this.keyHeld.toLowerCase())) {
      this.keyHeld = null; clearTimeout(this.keyHoldT);
      this.r.motion.release();
    }
  }

  blur() { this.keyHeld = null; clearTimeout(this.keyHoldT); this.r.motion.release(); }

  /** Wheel input. A mouse wheel's notches each move one column; a trackpad moves the
   *  sheet directly until the fingers lift or the system's momentum begins, then the
   *  reader lands it. Which is which is read from the input's shape, not its size:
   *  webviews report a notch anywhere from 40 to 160 px (WebKitGTK: 153), high-resolution
   *  wheels send fractions of a notch, and trackpads send smoothly varying amounts. */
  /** Something over the page that scrolls itself (a long note, a note being written): the
   *  wheel there is its own, to its end and past it, never a turn of the page beneath. */
  private scrolls(t: EventTarget | null): boolean {
    for (let e = t as Element | null; e && e !== this.r.stage; e = e.parentElement) {
      const s = getComputedStyle(e);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight) return true;
    }
    return false;
  }

  private onWheel(e: WheelEvent) {
    if (this.scrolls(e.target)) return;
    e.preventDefault();
    if (!this.r.strip || ui.contents || ui.sheet) return;
    // (a trackpad's pinch: the page does not zoom, and nothing else answers it)
    if (e.ctrlKey) return;
    const now = performance.now();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const v = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit;
    if (!v) return;
    let g = this.wheel;
    if (g && now - g.last > (g.kind === 'locked' ? WHEEL_LOCK : WHEEL_QUIET * 2)) { this.endWheel(g); g = null; }
    if (!g) {
      const discrete = e.deltaMode !== 0 || (Math.abs(v) >= 20 && Number.isInteger(v)) || (this.wheelQ > 0 && Math.abs(Math.abs(v) - this.wheelQ) < 0.01);
      g = this.wheel = { kind: discrete ? 'notch' : 'direct', last: now, mags: [], t0: now, endT: 0, acc: 0, log: [], from: this.r.motion.p };
      if (discrete && Math.abs(v) >= 20) this.wheelQ = Math.abs(v);
    }
    g.last = now;
    if (g.log.length < 40) g.log.push([Math.round(now - g.t0), +v.toFixed(2)]);
    if (g.kind === 'locked') return;
    if (g.kind === 'direct') {
      g.mags.push(Math.abs(v));
      if (g.mags.length > 4) g.mags.shift();
      const m = g.mags;
      // a high-resolution wheel turned slowly: the same small step, again and again
      if (m.length >= 3 && m.slice(-3).every(x => Math.abs(x - m[m.length - 1]) < 0.01) && m[m.length - 1] >= 2) {
        // the first steps moved the sheet directly: they count towards the first notch
        // instead, and the sheet goes back to where the wheel found it
        g.kind = 'notch';
        clearTimeout(g.endT);
        if (!this.wheelQ) this.wheelQ = m[m.length - 1] * 8;
        g.acc = g.log.slice(0, -1).reduce((a, [, d]) => a + d, 0) / this.wheelQ;
        this.r.motion.toward(Math.round(g.from));
      }
    }
    if (g.kind === 'notch') {
      // partial notches add up; a notch's worth turns at the half, so the wheel answers at once
      const q = this.wheelQ || Math.abs(v);
      g.acc += v / q;
      // (the remainder after a turn may sit at exactly −½: only more than that turns back)
      if (Math.abs(g.acc) >= 0.5) do {
        const d = Math.sign(g.acc);
        this.r.motion.notch(d);
        g.acc -= d;
      } while (Math.abs(g.acc) > 0.5);
      return;
    }
    // momentum detection: magnitudes that keep falling after the hand has moved
    const m = g.mags;
    const decaying = m.length === 4 && m[1] < m[0] * 0.9 && m[2] < m[1] * 0.9 && m[3] < m[2] * 0.9 && now - g.t0 > 140;
    this.r.motion.directBy(v / this.r.M.P);
    clearTimeout(g.endT);
    if (decaying) { g.kind = 'locked'; this.r.motion.directEnd(true, true); return; }
    g.endT = window.setTimeout(() => { if (this.wheel === g && g.kind === 'direct') { g.kind = 'locked'; this.r.motion.directEnd(false, true); } }, WHEEL_QUIET);
  }
  /** The size of one notch of the wheel last seen, px. */
  private wheelQ = 0;
  /** Recent wheel gestures, kept for diagnosis (kv `diag.input`). */
  private wheelLog: unknown[] = [];
  private endWheel(g: NonNullable<ReaderInput['wheel']>) {
    this.wheelLog.push({ at: new Date().toISOString().slice(11, 19), kind: g.kind, q: this.wheelQ, from: +g.from.toFixed(2), to: this.r.motion.target, events: g.log });
    if (this.wheelLog.length > 30) this.wheelLog.shift();
    kv.set('diag.input', this.wheelLog);
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
      // controls handle themselves; links in the text (notes, references) are the reader's
      const ctl = (e.target as Element).closest?.('textarea, button, input, label, a:not(.nr):not(.xr):not(.ur)');
      if (ctl && this.zoneAt(e.clientX) === 'focus') return;
      if (ctl) e.preventDefault();
      const zone = this.zoneAt(e.clientX);
      // the text is selected as in any document, by the browser or the system: a mouse's drag
      // (the menu when the button is let go; it never moves the sheet there: the keys, the
      // wheel and the sides do), a finger held on a word (the system's handles and menu,
      // and ours once it rests). A finger's press is captured only once it drags the sheet,
      // so that a hold stays the system's
      const native = e.pointerType === 'mouse' && zone === 'focus';
      const touch = e.pointerType !== 'mouse';
      this.pointer = e.pointerType;
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
      // explicit targets in the focus column: a note marker, a reference, an image
      const tgt = g.down as Element | null;
      if (g.zone === 'focus' && tgt?.closest) {
        const nr = tgt.closest('a.nr') as HTMLElement | null;
        if (nr) { this.r.openNote(+nr.dataset.n!, nr); return; }
        const xr = tgt.closest('a.xr') as HTMLElement | null;
        if (xr) { this.r.followRef(xr.dataset.b!); return; }
        const ur = tgt.closest('a.ur') as HTMLElement | null;
        if (ur) { this.r.openLink(ur.dataset.u!); return; }
        const fig = tgt.closest('figure.img') as HTMLElement | null;
        if (fig) { this.r.openImage(+fig.dataset.i!, fig); return; }
        const nd = tgt.closest('.nd') as HTMLElement | null;
        // (with the rail, every note in view has its card already)
        if (nd) { ui.chip = null; if (!ui.railed) ui.sideNotes = { ids: [nd.dataset.a!], pinned: true }; return; }
      }
      // a highlight opens its chip; find hits (h5, h6) are not annotations
      const mark = (g.down as Element)?.closest?.('mark.hl:not(.h5):not(.h6)') as HTMLElement | null;
      if (g.zone === 'focus' && mark) {
        const r = stage.getBoundingClientRect(), m = mark.getBoundingClientRect();
        ui.chip = { x: e.clientX - r.left, y: m.top - r.top, b: m.bottom - r.top, sel: null, ann: mark.dataset.a! };
        return;
      }
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
      if (!g.touch && (g.zone === 'next' || g.zone === 'prev') && ++this.taps >= 4) hint('keys-turn', 'Space turns the page from the keyboard, → one column (held, it glides), ← back.');
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
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
