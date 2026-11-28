/** The reader: opens a book, lays it out, puts it on the page and moves it through it,
 *  and keeps what is open with it. Its other jobs are its collaborators: the look the text
 *  is set and painted in (appearance.ts), how far it has been read (progress.ts), bookmarks
 *  (bookmarks.svelte.ts), what a press on the text opens (references.ts), highlights and marks (marking.ts), find (find.svelte.ts),
 *  the keyboard's cursor (cursor.ts), pictures (images.ts). */
import type { BookData, Core } from '../core/types';
import { kv, flushKV } from '../core/kv';
import { nearest } from '../core/book';
import { embedded, embedMoved, embedOpts } from '../core/embed';
import { metrics, insets, RAIL, type Metrics } from './geometry';
import { Strip, parseLayout, type Anchor } from './strip';
import { columnHTML, leafHTML, chapName } from './render';
import { Surface } from './surface';
import { Motion } from './motion';
import { settings, reduceMotion } from './settings.svelte';
import { themes, type Resolved } from './themes.svelte';
import { Appearance } from './appearance';
import { Annotations } from './annotations';
import { Finder } from './find.svelte';
import { Feedback, notesFile } from './feedback';
import { ReadingProgress } from './progress';
import { Bookmarks } from './bookmarks.svelte';
import { References } from './references';
import { Hold, lineStart } from './hold';
import { geomVars, setVars, typeVars } from './paint';
import { takeNotes } from './intake';
import { spokenPage } from './spoken';
import { ui, toast } from '../state.svelte';
import { Marking } from './marking';
import { unselect } from './selection';
import { ReaderInput } from './input';
import { Cursor } from './cursor';
import { BookImages } from './images';

/** Chapters asked of the engine at a time for the rest of the book (after the reader's
 *  own): a call of a few is a few tens of ms on a phone. */
const REST = 6;

export class Reader {
  /* ---------- the open book ---------- */
  core: Core;
  book: BookData | null = null;
  strip: Strip | null = null;
  M!: Metrics;
  /** First column of the focus window, at rest (state: what shows of the page in view,
   *  its ribbon, its bookmark button, is worked out from it again when it lands). */
  cur = $state(0);
  /** The paragraphs marked (by key). */
  marks = new Set<string>();
  /** This reader's highlights and notes on the open book. */
  ann: Annotations | null = null;
  /** Other readers' notes on the open book. */
  fb: Feedback | null = null;
  reading = false;
  /** Settles once the whole book is laid out for the parameters in use (until then the
   *  columns of the sections not yet set are estimates): what travels to a place named
   *  from outside waits for it. One promise until then, however many changes come
   *  meanwhile: a superseded layout's is answered by the one that replaces it. */
  whole: Promise<void> = Promise.resolve();
  /** The column the way back returns to, while there is one. */
  returnTo: number | null = $state(null);

  /* ---------- the page ---------- */
  stage!: HTMLElement;
  surface!: Surface;
  motion!: Motion;
  input!: ReaderInput;
  /** The page as it was, faded into the new one as the text is set again (hold.ts). */
  hold = new Hold();

  /* ---------- what the reader does, by job ---------- */
  /** The theme, its faces and calibration, and the page painted with them. */
  appearance = new Appearance(this);
  /** Highlights, notes, marks and the notebook they make (marking.ts). */
  marking = new Marking(this);
  /** Marking from the keyboard (V). */
  cursor = new Cursor(this);
  finder = new Finder(this);
  bookmarks = new Bookmarks(this);
  /** How far this reader has read the open book. */
  progress = new ReadingProgress(this);
  references = new References(this);
  images: BookImages;
  /** The reader's notes on a book may have changed (`notes` makes them, when wanted). */
  onNotes: (id: string, notes: () => ReturnType<Reader['myNotes']>) => void = () => {};

  /* ---------- bookkeeping ---------- */
  private gen = 0;
  /** Bumps whenever the text is set with new parameters; a whole-book layout that
   *  arrives for older parameters is dropped, one for the current ones always applies. */
  private paramGen = 0;
  private wholeLaid: (() => void) | null = null;
  /** The next relayout sets the text again even if the geometry is unchanged. */
  forceRelayout = false;
  private opening = false;
  private resizedWhileOpening = false;
  private resizeT = 0;
  private shownK = -1;
  private saveT = 0;
  /** A trip's way back: where the reader was and where the trip ended, as places in the
   *  text (a relayout keeps them). Offered until the reader moves from where it ended. */
  private trip: { from: Anchor; to: Anchor } | null = null;
  /** Highlights and find hits for a block, as the renderer draws them (hits first). */
  private marksOf = (key: string) => {
    const f = this.finder.open ? this.finder.of(key) : undefined,
      a = this.ann?.of(key);
    return f && a ? [...f, ...a] : f || a;
  };

  constructor(core: Core) {
    this.core = core;
    this.images = new BookImages(core, () => this.book);
    ui.rail = kv.get<boolean>('rail', false);
  }

  /* ---------- mounting ---------- */
  mount(stage: HTMLElement, track: HTMLElement) {
    this.stage = stage;
    this.surface = new Surface(track, () => ({
      strip: this.strip!,
      M: this.M,
      column: k => this.columnHTML(k),
      isLeaf: k => this.strip!.itemAt(k)?.type !== 'sect',
    }));
    this.motion = new Motion({
      min: () => 0,
      max: () => Math.max(0, (this.strip?.N ?? 1) - (this.M?.N ?? 1)),
      spread: () => this.M?.N ?? 1,
      reduced: reduceMotion,
      frame: (p, v, glided) => this.frame(p, v, glided),
      glide: (at, times, t0) => {
        if (this.strip) this.surface.glide(at, times, t0);
      },
      rest: k => this.rest(k),
    });
    this.input = new ReaderInput(this);
    window.addEventListener('pagehide', () => {
      this.flush();
      flushKV();
    });
    // (a phone switching apps hides the page without leaving it)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
    new ResizeObserver(() => {
      if (!this.book) return;
      if (this.opening) {
        this.resizedWhileOpening = true;
        return;
      }
      // (the page as it is, kept in the middle of the window until it rests, then set again)
      this.recentre();
      clearTimeout(this.resizeT);
      this.resizeT = window.setTimeout(() => this.relayout(), 140);
    }).observe(stage);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.appearance.themeChanged());
    matchMedia('(prefers-contrast: more)').addEventListener('change', () => this.appearance.themeChanged());
    this.appearance.prewarm();
  }

  /** Takes notes files while a book is open (intake.ts): those for it are placed on it at
   *  once, others kept for their books. */
  async receiveNotes(input: string | string[]): Promise<string> {
    const texts = Array.isArray(input) ? input : [input];
    if (!this.book || !this.fb || !this.strip || !this.ann) return 'Open the book the notes are for first.';
    const { said, changed } = await takeNotes(this.core, texts, await this.core.library(), {
      book: this.book,
      ann: this.ann,
      marks: this.marks,
      fb: this.fb,
    });
    if (changed) {
      this.bookmarks.load(this.book.id);
      this.redraw();
      this.marking.digestSoon();
    }
    return said;
  }

  /** Every column in view built again from what is on the book, and what lists it told:
   *  after notes arrive, or readers' notes are shown, hidden, removed or settled. */
  redraw() {
    for (const [k] of this.surface.rendered()) this.surface.refresh(k);
    ui.annVersion++;
  }

  /** This reader's notes on the open book, as a notes file. */
  myNotes() {
    const f = notesFile(this.book!, this.ann?.list ?? [], this.marks, this.strip!.keyIndex, this.bookmarks.list);
    // how far they got goes with their notes, unless they said not
    if (kv.get('progress.' + this.book!.id, true)) f.progress = this.progress.now();
    return f;
  }

  /** Redraws the columns in view (marks, hits) without moving anything. */
  repaint() {
    if (this.strip) this.surface.reset(this.cur);
  }

  /** Brings column k into view: a short way on a calm curve; a long way with a quick
   *  fade, as the surface cannot build a hundred columns in passing. A trip past the
   *  columns in view (the contents, the progress line, a link, a search) leaves a way back
   *  to where the reader was (`goBack`); a trip the page around the reader asked for
   *  (`trip` false) does not. */
  async travelTo(k: number, trip = true) {
    if (!this.strip) return;
    k = Math.max(0, Math.min(Math.max(0, this.strip.N - this.M.N), k));
    const d = Math.abs(k - this.cur);
    if (!d) return;
    this.trip = trip && d >= this.M.N ? { from: this.strip.anchorAt(this.cur)!, to: this.strip.anchorAt(k)! } : null;
    if (d <= 6) {
      this.go(k);
      return;
    }
    const t = this.surface.track;
    if (reduceMotion()) {
      this.jump(k);
      return;
    }
    t.style.transition = 'opacity .11s ease-in';
    t.style.opacity = '0';
    await new Promise(r => setTimeout(r, 115));
    this.jump(k);
    requestAnimationFrame(() => {
      t.style.transition = 'opacity .2s ease-out';
      t.style.opacity = '1';
    });
  }

  private columnHTML(k: number): string {
    const strip = this.strip!;
    const it = strip.itemAt(k);
    if (!it) return '';
    if (it.type === 'sect')
      return columnHTML(
        strip,
        k,
        this.M,
        this.marks,
        this.marksOf,
        this.images.src,
        this.fb?.size ? this.fb : undefined,
      );
    return leafHTML(strip, it);
  }

  /** The page's style made `look`'s at `M`, in the frame the text set for them comes in
   *  (`recompose` follows at once): never before it. */
  private commit(look: Resolved, M: Metrics) {
    this.M = M;
    this.appearance.paint(look);
    const reader = this.stage.parentElement!;
    setVars(reader, geomVars(M));
    ui.cols = M.N;
    ui.colsReduced = M.reduced;
    ui.phone = M.phone;
    ui.arrows = M.arrows;
    ui.railed = this.railed();
    // the notes' rail beside the text: what is about the text (its head, its page) centres on the text
    reader.style.setProperty('--rail', (ui.railed ? this.stage.clientWidth - M.W : 0) + 'px');
  }

  /** The window resizing: the page as it is, kept in the middle of it (set again once it
   *  rests: `relayout`), moved, not rebuilt. */
  private recentre() {
    const M = this.M;
    if (!M || !this.strip) return;
    const W = this.stage.clientWidth - (ui.railed ? RAIL : 0),
      cx = Math.round(W / 2),
      x0 = Math.round(cx - M.focusW / 2);
    if (x0 === M.x0 && W === M.W) return;
    this.M = { ...M, W, cx, x0 };
    setVars(this.stage.parentElement!, geomVars(this.M));
    if (!this.motion.moving) this.surface.place(this.cur);
  }

  /* ---------- open, layout, close ---------- */
  /** Opens a book where it was left, or at `at` (from the library's notebook or a
   *  search), and reading begins at once. */
  async open(id: string, at?: Anchor) {
    const gen = ++this.gen;
    // (a shell that says so already keeps its own words: the embed's)
    ui.busy ||= 'Opening…';
    performance.mark('open');
    this.opening = true;
    this.resizedWhileOpening = false;
    try {
      const book = await this.core.open(id);
      performance.mark('open:book');
      if (gen !== this.gen) return;
      this.book = book;
      themes.leading = book.leading;
      this.images.reset();
      await this.images.measure(book).catch(() => {});
      if (gen !== this.gen) return;
      this.marks = new Set(kv.get<string[]>('marks.' + id, []));
      this.bookmarks.load(id);
      this.progress.load(id);
      this.reading = false;
      this.strip = new Strip(book);
      this.ann = new Annotations(book, this.strip.keyIndex);
      this.fb = new Feedback(book, this.strip.keyIndex);
      // notes made on another version of the text find their words again (one's own, and
      // other readers' that arrived since); if the engine cannot, they keep the places they
      // had, and the book opens
      await Promise.all([this.ann.place(this.core), this.fb.place(this.core)]).catch(() => {});
      if (gen !== this.gen) return;
      ui.title = book.title;
      ui.view = 'reader';
      await new Promise(r => requestAnimationFrame(r));
      const look = this.appearance.wanted();
      await this.layoutFrom(at ?? kv.get<Anchor | null>('pos.' + id, null), gen, look, this.measure(undefined, look));
      if (gen !== this.gen) return;
      // a book whose notebook the library has not seen yet gets its digest now
      if (!kv.get('nb.' + id, null)) this.marking.digestSoon();
      this.begin();
    } catch (e) {
      ui.view = 'library';
      toast(`Couldn’t open the book: ${(e as Error).message}`, 5000);
    } finally {
      if (gen === this.gen) {
        ui.busy = '';
        this.opening = false;
        if (this.resizedWhileOpening && this.book) this.relayout();
      }
    }
  }

  /** Opens a book at a match of a library search, the search going on in the book. */
  async openAt(id: string, at: Anchor, query: string) {
    await this.open(id, at);
    if (this.book?.id !== id) return;
    this.finder.query = query;
    this.finder.show();
    await this.finder.run();
  }

  /** The notes' rail is beside the text: asked for, and room for it (never on a phone). */
  railed(): boolean {
    return ui.rail && !!this.stage && this.stage.clientWidth - RAIL >= 640;
  }

  /** The geometry for the stage as it is (less the rail, which takes one column's place). */
  measure(size?: number, look = this.appearance.look) {
    const rail = this.railed();
    return metrics(
      this.stage.clientWidth - (rail ? RAIL : 0),
      this.stage.clientHeight,
      this.appearance.lookGeom(look),
      insets(),
      size,
      rail ? 1 : settings.layout,
    );
  }

  /** Lays the book out at `M` in `look`, apart from the page, and puts both on the page in
   *  one frame: around `anchor` (none: where the reader is then), its section first, then
   *  (not awaited) the rest. `fade`: the page as it was fades into the new (hold.ts). */
  private async layoutFrom(anchor: Anchor | null, gen: number, look: Resolved, M: Metrics, fade = false) {
    const strip = this.strip!,
      book = this.book!;
    if (!this.wholeLaid) this.whole = new Promise(r => (this.wholeLaid = r));
    // (the numbers wait for the whole book's count: Progress.svelte)
    ui.settling = true;
    look = await this.appearance.ensureFonts(look);
    performance.mark('open:fonts');
    if (gen !== this.gen) return;
    await this.appearance.calibrate(look, M);
    performance.mark('open:calibrated');
    if (gen !== this.gen) return;
    const p = this.appearance.params(M, look);
    const pg = ++this.paramGen;
    const near = anchor ?? strip.anchorAt(this.cur);
    let sec = 0;
    if (near && 'key' in near) sec = strip.keyIndex.get(near.key)?.[0] ?? 0;
    else if (near && 'sec' in near) sec = Math.max(0, Math.min(book.sections.length - 1, near.sec));
    const first = parseLayout(await this.core.layout(book.id, [sec], p));
    performance.mark('open:first-layout');
    if (gen !== this.gen) return;
    // the page as it is, then (in the same frame) the new: its style and its text together
    const at = anchor ?? strip.anchorAt(this.cur),
      old = this.M;
    if (fade && old)
      this.hold.take(
        this.stage,
        this.surface.track,
        this.inView(),
        { ...typeVars(this.appearance.look, old.fs), ...geomVars(old) },
        this.lineOf(at),
      );
    this.commit(look, M);
    strip.setEstimate(M.rows, M.colW, M.fs);
    strip.layouts = first;
    this.recompose(at);
    if (fade && old) this.hold.release(this.lineOf(at), M.fs / old.fs);
    // a book's first page, opening, comes in softly over its paper (at the calm pace)
    else if (this.opening)
      this.surface.track.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: parseFloat(getComputedStyle(this.stage).getPropertyValue('--calm')) * 1000 || 300,
        easing: 'ease-out',
      });
    performance.mark('open:shown');
    this.appearance.calibrateNeighbours();
    // the rest, a few chapters a call, nearest first: the engine answers one call at a time,
    // and a whole book is one long call (half a second on a desktop, seconds on a phone), so
    // a change made meanwhile waited for all of it, and each change after it for another
    // whole book; now it goes between two calls, and a superseded layout asks for no more.
    // (One call asked ahead, so the engine is never idle while the page takes an answer.)
    const all = new Map(first);
    const calls = nearest(book.sections.length, sec, REST);
    const ask = (i: number) => (i < calls.length ? this.core.layout(book.id, calls[i], p) : null);
    try {
      let next = ask(0);
      for (let i = 0; next; i++) {
        const buf = await next;
        if (pg !== this.paramGen || this.strip !== strip) return;
        next = ask(i + 1);
        for (const [k, v] of parseLayout(buf)) all.set(k, v);
      }
    } catch (e) {
      ui.settling = false;
      toast(`Couldn’t lay out the book: ${(e as Error).message}`, 5000);
      return;
    }
    performance.mark('open:all-layout');
    const keep = this.motion.moving ? null : strip.anchorAt(this.cur);
    strip.layouts = all;
    this.recompose(keep ?? strip.anchorAt(this.cur), true);
    this.wholeLaid?.();
    this.wholeLaid = null;
    ui.settling = false;
  }

  private recompose(anchor: Anchor | null, quiet = false) {
    const strip = this.strip!;
    strip.compose();
    this.cur = Math.min(Math.max(0, strip.N - this.M.N), Math.max(0, strip.resolve(anchor)));
    this.motion.jump(this.cur);
    this.surface.reset(this.cur);
    this.arrive(this.cur, quiet);
    ui.layoutVersion++;
  }

  private inView() {
    return Array.from({ length: this.M.N }, (_, i) => this.surface.columnEl(this.cur + i));
  }
  /** Where the line at `a` begins on the page in view. */
  private lineOf(a: Anchor | null | undefined) {
    const h = a && 'key' in a ? this.strip!.keyIndex.get(a.key) : null;
    if (!a || !h || !('key' in a)) return null;
    const cols = this.inView().filter(
      (c, i): c is HTMLElement => !!c && this.strip!.itemAt(this.cur + i)?.sec === h[0],
    );
    return lineStart(this.stage, cols, h[1], a.off);
  }

  async relayout() {
    if (!this.book || !this.strip) return;
    const gen = ++this.gen;
    const old = this.M,
      look = this.appearance.wanted(),
      M = this.measure(undefined, look);
    const force = this.forceRelayout;
    this.forceRelayout = false;
    if (
      !force &&
      old &&
      M.W === old.W &&
      M.H === old.H &&
      M.fs === old.fs &&
      M.colW === old.colW &&
      M.rows === old.rows &&
      M.N === old.N
    )
      return;
    // same measure and rows: the text need not be set again, only the window moves
    if (!force && old && M.fs === old.fs && M.colW === old.colW && M.rows === old.rows && M.headRows === old.headRows) {
      const at = this.strip.anchorAt(this.cur);
      this.commit(look, M);
      this.recompose(at, true);
      return;
    }
    await this.layoutFrom(null, gen, look, M, true);
  }
  async settingsChanged(kind: 'layout' | 'style') {
    if (!this.strip) return;
    if (kind === 'layout') {
      this.forceRelayout = true;
      await this.relayout();
    } else this.surface.reset(this.cur);
  }

  close() {
    // (an embedded book is all there is: there is no library to go back to)
    if (!this.book || embedded) return;
    this.flush();
    this.gen++;
    this.motion.jump(0);
    if (this.finder.open) this.finder.hide();
    ui.bookNote = null;
    ui.lightbox = null;
    this.book = null;
    this.strip = null;
    this.ann = null;
    this.fb = null;
    this.reading = false;
    this.bookmarks.clear();
    themes.leading = null;
    ui.chip = null;
    this.cursor.end();
    ui.contents = false;
    ui.sheet = null;
    this.surface.clear();
    this.hold.drop();
    ui.settling = false;
    this.core.idle?.();
    ui.view = 'library';
    ui.libVersion++;
  }

  flush() {
    if (!this.book || !this.strip) return;
    clearTimeout(this.saveT);
    const id = this.book.id;
    kv.set('pos.' + id, this.strip.anchorAt(this.cur));
    this.progress.save(id);
    kv.set('marks.' + id, [...this.marks]);
    this.marking.flushDigest();
    const it = this.strip.itemAt(this.cur);
    // the reader's notes, for whoever keeps them elsewhere (the app: a book sent by link
    // sends them back); not while it is still opening: it has not found its place yet,
    // and how far the reader got would read as changed
    if (this.ann && !this.opening) this.onNotes(id, () => this.myNotes());
    kv.set('state.' + id, {
      where:
        it && it.sec >= 0 && it.type !== 'colophon'
          ? chapName(this.book, Math.min(it.sec, this.book.sections.length - 1))
          : it?.type === 'colophon'
            ? 'At the end'
            : 'At the beginning',
      done: it?.type === 'colophon',
    });
  }

  /** Reading begins: the keys go to the page. */
  private begin() {
    this.reading = true;
    this.stage.focus({ preventScroll: true });
  }

  /* ---------- position and movement ---------- */
  headFor(k: number) {
    const strip = this.strip!,
      it = strip.itemAt(k),
      b = strip.book;
    if (!it) return '';
    if (it.type === 'title') return b.title;
    if (it.type === 'colophon') return embedOpts.endHref ? 'The end' : 'Finis';
    const s = b.sections[it.sec];
    // a book without chapters is named by its title
    if (s.k === 0) return s.title || (b.sections.some(x => x.k === 1) ? 'Front matter' : b.title);
    return s.label && s.title ? `${s.num} · ${s.title}` : chapName(b, it.sec);
  }

  /** Columns in the focus window at rest. */
  focusCols(): number[] {
    const out: number[] = [];
    for (let k = this.cur; k < Math.min(this.strip!.N, this.cur + this.M.N); k++) out.push(k);
    return out;
  }

  /** Every frame the sheet moves. */
  private frame(p: number, v: number, glided = false) {
    if (!this.strip) return;
    // what stands by a line goes with it: pinned notes, a book's note at its marker, a
    // selection and its menu
    if (ui.sideNotes) ui.sideNotes = null;
    if (ui.bookNote) ui.bookNote = null;
    if (ui.chip) ui.chip = null;
    unselect(this.stage);
    this.surface.place(p, v, glided, this.motion.target);
    const k = Math.round(p);
    if (k !== this.shownK) {
      this.shownK = k;
      ui.runhead = this.headFor(k);
      ui.page = k + 1;
      // the paper's tint changes only at rest: changing it in motion repainted the whole
      // window (background, curtains) every few frames
    }
  }

  /** The sheet came to rest on a boundary. */
  private rest(k: number) {
    if (!this.strip) return;
    this.cur = k;
    this.surface.rebase(k);
    this.surface.place(k);
    this.arrive(k);
  }

  /** Back to where the reader was before the last trip. */
  goBack() {
    if (!this.strip || !this.trip) return;
    const k = this.strip.resolve(this.trip.from);
    this.trip = null;
    this.returnTo = null;
    this.travelTo(k, false);
  }

  private arrive(k: number, quiet = false) {
    const strip = this.strip!;
    this.shownK = k;
    // (the way back stays while the reader is where the trip ended)
    if (this.trip && strip.resolve(this.trip.to) !== k) this.trip = null;
    this.returnTo = this.trip ? strip.resolve(this.trip.from) : null;
    ui.runhead = this.headFor(k);
    ui.page = k + 1;
    ui.pages = strip.N;
    const focus = this.focusCols();
    this.progress.arrive(focus);
    clearTimeout(this.saveT);
    this.saveT = window.setTimeout(() => {
      if (!this.book) return;
      kv.set('pos.' + this.book.id, strip.anchorAt(this.cur));
      kv.set('far.' + this.book.id, this.progress.furthest);
    }, 400);
    // (by the view's last column: a spread ends with the book's last on its right)
    const last = focus[focus.length - 1] ?? k;
    if (embedded) embedMoved(strip.frac(last), last >= strip.N - 1);
    // controls in leaves are reachable only while their leaf is in focus, and a screen
    // reader hears a leaf only then; the text in view it hears as a document (spoken.ts)
    for (const [c, el] of this.surface.rendered()) {
      for (const x of el.querySelectorAll<HTMLElement>('textarea, button, a[href]'))
        x.tabIndex = focus.includes(c) ? 0 : -1;
      if (el.classList.contains('leafcol')) el.setAttribute('aria-hidden', String(!focus.includes(c)));
    }
    const said = this.stage.querySelector('.spoken');
    if (said) said.innerHTML = spokenPage(strip, focus);
    if (
      !quiet &&
      document.activeElement?.closest?.('.leaf') &&
      !focus.some(c => this.surface.columnEl(c)?.contains(document.activeElement))
    )
      this.stage.focus({ preventScroll: true });
    if (this.cursor.active) this.cursor.move(0);
  }

  /** Moves to column k on a calm curve. */
  go(k: number) {
    if (this.strip) this.motion.toward(k);
  }

  /** A turn: the whole set in view (or `n` columns) on or back. */
  step(d: number, n?: number) {
    if (!this.strip || ui.contents || ui.sheet) return;
    this.motion.tap(d, n);
  }

  /** Lands on a column at once, with no animation of its own (what calls it animates, or
   *  nothing should move: a book opening, a relayout). */
  jump(k: number) {
    this.cur = Math.max(0, Math.min(Math.max(0, this.strip!.N - this.M.N), k));
    this.motion.jump(this.cur);
    this.surface.reset(this.cur);
    this.arrive(this.cur);
  }

  /* ---------- notes beside the text ---------- */
  /** The column of every note with a card beside its line (one's own written notes, and
   *  readers' on the page), in order (two on one page, twice): the notes' rail counts them
   *  and goes from one page with notes to the next. */
  noteCols(): number[] {
    const strip = this.strip;
    if (!strip) return [];
    const at = [
      ...(this.ann?.list ?? []).filter(a => a.note).map(a => ({ key: a.key, off: a.s })),
      ...(this.fb?.writtenAt() ?? []),
    ];
    return at.map(a => strip.resolve(a)).sort((a, b) => a - b);
  }
  /** The notes beside the text: in their rail where there is room for it (the text then
   *  in one column beside it; kept for the next time), else those in view over their
   *  columns. */
  toggleNotes() {
    if (this.stage && this.stage.clientWidth - RAIL >= 640) {
      ui.rail = !ui.rail;
      kv.set('rail', ui.rail);
      ui.sideNotes = null;
      ui.chip = null;
      this.settingsChanged('layout');
      return;
    }
    if (ui.sideNotes?.pinned) {
      ui.sideNotes = null;
      return;
    }
    const ids: string[] = [];
    for (const k of this.focusCols())
      for (const d of this.surface.columnEl(k)?.querySelectorAll<HTMLElement>('.nd') ?? []) ids.push(d.dataset.a!);
    if (!ids.length) {
      toast('No notes on this page.');
      return;
    }
    ui.chip = null;
    ui.sideNotes = { ids, pinned: true };
  }
}
