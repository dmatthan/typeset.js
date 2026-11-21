import { edges } from '../core/edges';
import type { BookData, Core, LayoutParams } from '../core/types';
import { kv, flushKV } from '../core/kv';
import { shareAt, shareOf } from '../core/book';
import { metrics, insets, RAIL, type Look, type Metrics } from './geometry';
import { Strip, parseLayout, F, FIELDS, type Anchor } from './strip';
import { columnHTML, leafHTML, chapName, esc } from './render';
import { Surface } from './surface';
import { Motion } from './motion';
import { calibrate } from './calibrate';
import { settings, reduceMotion, SIZES } from './settings.svelte';
import { themes, themeById, resolve, loadFamily, fontsReady, type Resolved } from './themes.svelte';
import { Annotations } from './annotations';
import { Finder } from './find.svelte';
import { Feedback, notesFile, type Progress } from './feedback';
import { bookmarkAt, bookmarksIn, loadBookmarks, saveBookmarks, type Bookmark } from './bookmarks';
import { Hold, lineStart } from './hold';
import { geomVars, paletteVars, PALETTE, setVars, typeVars } from './paint';
import { takeNotes } from './intake';
import { embedded, embedMoved, embedOpts, features } from '../core/embed';
import { shell } from '../core/shell';
import { hint } from './hints';
import { spokenPage } from './spoken';
import { ui, toast } from '../state.svelte';
import { Marking } from './marking';
import { unselect } from './selection';
import { ReaderInput } from './input';
import { Cursor } from './cursor';
import { BookImages } from './images';

/** The measure, in ems, below which lines are set ragged. */
const NARROW = 24;

export class Reader {
  core: Core;
  book: BookData | null = null;
  strip: Strip | null = null;
  M!: Metrics;
  /** First column of the focus window, at rest. */
  cur = 0;
  marks = new Set<string>();
  /** The pages marked to come back to (bookmarks.ts). */
  bookmarks: Bookmark[] = $state([]);
  ann: Annotations | null = null;
  seen = new Set<string>();
  /** Columns seen since the book was opened (for the hints). */
  visited = new Set<number>();
  /** The furthest this reader has read in the book, as a share of it (kept: `far.<id>`). */
  furthest = 0;
  reading = false;

  stage!: HTMLElement;
  surface!: Surface;
  motion!: Motion;

  private gen = 0;
  /** Bumps whenever the text is set with new parameters; a whole-book layout that
   *  arrives for older parameters is dropped, one for the current ones always applies. */
  private paramGen = 0;
  private shownK = -1;
  private dwellT = 0; private saveT = 0; private seenT = 0;
  /** The reader's notes on a book may have changed (`notes` makes them, when wanted). */
  onNotes: (id: string, notes: () => ReturnType<Reader['myNotes']>) => void = () => {};

  input!: ReaderInput;
  /** Highlights, notes, marks and the notebook they make (marking.ts). */
  marking = new Marking(this);
  /** Marking from the keyboard (V). */
  cursor = new Cursor(this);
  images: BookImages;

  constructor(core: Core) {
    this.core = core; this.images = new BookImages(core, () => this.book);
    ui.rail = kv.get<boolean>('rail', false);
  }

  /* ---------- mounting ---------- */
  mount(stage: HTMLElement, track: HTMLElement) {
    this.stage = stage;
    this.surface = new Surface(track, () => ({
      strip: this.strip!, M: this.M,
      column: k => this.columnHTML(k),
      isLeaf: k => this.strip!.itemAt(k)?.type !== 'sect',
    }));
    this.motion = new Motion({
      min: () => 0,
      max: () => Math.max(0, (this.strip?.N ?? 1) - (this.M?.N ?? 1)),
      spread: () => this.M?.N ?? 1,
      reduced: reduceMotion,
      frame: (p, v, glided) => this.frame(p, v, glided),
      glide: (at, times, t0) => { if (this.strip) this.surface.glide(at, times, t0); },
      rest: k => this.rest(k),
    });
    this.input = new ReaderInput(this);
    window.addEventListener('pagehide', () => { this.flush(); flushKV(); });
    // (a phone switching apps hides the page without leaving it)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flush(); });
    new ResizeObserver(() => {
      if (!this.book) return;
      if (this.opening) { this.resizedWhileOpening = true; return; }
      // (the page as it is, kept in the middle of the window until it rests, then set again)
      this.recentre();
      clearTimeout(this.resizeT);
      this.resizeT = window.setTimeout(() => this.relayout(), 140);
    }).observe(stage);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.themeChanged());
    matchMedia('(prefers-contrast: more)').addEventListener('change', () => this.themeChanged());
    this.prewarm();
  }
  private resizeT = 0;
  private opening = false;
  private resizedWhileOpening = false;

  /** The current theme, resolved for the current appearance. */
  look: Resolved = resolve(themeById(settings.theme), false);

  isDark() {
    if (settings.appearance !== 'auto') return settings.appearance === 'dark';
    return themes.desktop ? themes.desktop.dark : matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /** The look the settings ask for now (the page's only once its text is set: `commit`). */
  private wanted() { return resolve(themeById(settings.theme), this.isDark()); }

  /** Paints `look` on the page: the appearance on the root, the theme's colours on the
   *  reader and all it shows (its menus, panels and sheets: the theme's paper, softened, as
   *  their surface, so that all of it is of one piece with the page; the library's sheets
   *  keep the app's own), the type the lines are set in (on the root, so calibration probes
   *  anywhere are set as the lines are). Only with the text set for it (`commit`), or a
   *  look that sets nothing differently (another appearance: `themeChanged`). */
  private paint(look: Resolved) {
    const root = document.documentElement;
    const want = settings.appearance === 'auto' ? (themes.desktop ? (themes.desktop.dark ? 'dark' : 'light') : null) : settings.appearance;
    if (want) root.setAttribute('data-theme', want); else root.removeAttribute('data-theme');
    this.look = look;
    const el = this.stage?.closest<HTMLElement>('.look');
    if (el) {
      const pal = paletteVars(look.palette, this.isDark(), matchMedia('(prefers-contrast: more)').matches);
      if (pal) setVars(el, pal); else for (const k of PALETTE) el.style.removeProperty(k);
    }
    // (dark paper: rich blocks, drawn in ink, are inverted: reader.css)
    this.stage?.parentElement?.classList.toggle('dark-paper', this.isDark());
    root.classList.toggle('synth-sc', look.synthSc);
    setVars(root, typeVars(look, this.M?.fs ?? 20));
    this.paintEdges(1400);
  }

  /** The colour around the page follows the surface in view (`core/edges.ts`); `ms` as the
   *  surface changes: the reader fades between themes over 1.4 s. */
  paintEdges(ms: number) {
    const c = ui.lightbox ? '#0c0d11' : ui.view !== 'reader' ? 'var(--ground)' : this.look.palette?.paper ?? 'var(--paper)';
    edges(c, ms);
  }

  lookGeom(look = this.look): Look {
    const o = look.options;
    return { scale: look.scale, lineSpacing: o.lineSpacing, margins: o.margins };
  }

  /** The faces, weights and book the fonts were last made ready for: a size changes none
   *  of them (asking again cost 23 ms of every change of size). */
  private fontsFor = '';
  /** Loads `look`'s face (system families are handed to the webview first), nothing on
   *  the page changing; returns the look as it is known with its face (small capitals). */
  private async ensureFonts(look: Resolved): Promise<Resolved> {
    const book = this.book;
    const key = JSON.stringify([look.chain, look.wght, look.bold, book?.id ?? '', book?.ext ?? '']);
    if (key === this.fontsFor) return look;
    // the page's faces first: the engine's copy of them then comes from the browser's
    // cache (asked for at once, each face was downloaded twice)
    await fontsReady(look, this.M?.fs ?? 20, '', undefined).catch(() => {});
    await loadFamily(this.core, look.chain[0]);
    // the family's small capitals are known only once it is loaded
    look = this.wanted();
    const needs = book ? await this.core.fontNeeds(book.id, look.chain[0]).catch(() => undefined) : undefined;
    await fontsReady(look, this.M?.fs ?? 20, book?.ext ?? '', needs);
    this.fontsFor = key;
    return look;
  }

  /** Another appearance (light, dark, the desktop's colours): the theme's other palette,
   *  nothing set differently. A theme, a face or an option changes through
   *  `settingsChanged`, with the text set for it. */
  themeChanged() { this.paint(this.wanted()); }

  /** Highlights and find hits for a block, as the renderer draws them (hits first). */
  private marksOf = (key: string) => {
    const f = this.finder.open ? this.finder.of(key) : undefined, a = this.ann?.of(key);
    return f && a ? [...f, ...a] : f || a;
  };
  finder = new Finder(this);
  /** Other readers' notes on the open book. */
  fb: Feedback | null = null;

  /** Takes notes files while a book is open (intake.ts): those for it are placed on it at
   *  once, others kept for their books. */
  async receiveNotes(input: string | string[]): Promise<string> {
    const texts = Array.isArray(input) ? input : [input];
    if (!this.book || !this.fb || !this.strip || !this.ann) return 'Open the book the notes are for first.';
    const { said, changed } = await takeNotes(this.core, texts, await this.core.library(), { book: this.book, ann: this.ann, marks: this.marks, fb: this.fb });
    if (changed) { this.bookmarks = loadBookmarks(this.book.id); this.redraw(); this.marking.digestSoon(); }
    return said;
  }

  /** The bookmarks on the columns in view. */
  bookmarksInView(): Bookmark[] {
    return this.strip && this.M ? bookmarksIn(this.bookmarks, this.strip, this.cur, this.cur + this.M.N - 1) : [];
  }
  /** The page in view marked to come back to; or, marked already, unmarked. */
  toggleBookmark() {
    const book = this.book, strip = this.strip;
    if (!book || !strip) return;
    const here = this.bookmarksInView();
    if (here.length) this.bookmarks = this.bookmarks.filter(b => !here.includes(b));
    else { const b = bookmarkAt(book, strip, this.cur); if (b) this.bookmarks = [...this.bookmarks, b]; }
    saveBookmarks(book.id, this.bookmarks);
  }
  removeBookmark(id: string) {
    this.bookmarks = this.bookmarks.filter(b => b.id !== id);
    if (this.book) saveBookmarks(this.book.id, this.bookmarks);
  }

  /** Every column in view built again from what is on the book, and what lists it told:
   *  after notes arrive, or readers' notes are shown, hidden, removed or settled. */
  redraw() {
    for (const [k] of this.surface.rendered()) this.surface.refresh(k);
    ui.annVersion++;
  }

  /** This reader's notes on the open book, as a notes file. */
  myNotes() {
    const f = notesFile(this.book!, this.ann?.list ?? [], this.marks, this.strip!.keyIndex, this.bookmarks);
    // how far they got goes with their notes, unless they said not
    if (kv.get('progress.' + this.book!.id, true)) f.progress = this.progress();
    return f;
  }

  /** Where the reader is, and the furthest they have read (to the hundredth: a page or
   *  two read changes nothing to send). */
  progress(): Progress {
    const strip = this.strip!, at = this.viewEnd();
    const r = (x: number) => Math.round(x * 100) / 100;
    const it = strip.itemAt(this.cur);
    return { at: r(at), furthest: r(Math.max(this.furthest, at)), where: it?.type === 'sect' ? chapName(this.book!, it.sec) : this.headFor(this.cur), done: Math.max(this.furthest, at) >= 0.995 || strip.itemAt(this.cur)?.type === 'colophon' };
  }
  /** The share of the book read by the end of the page in view. */
  private viewEnd() { const strip = this.strip!; return this.textShare(Math.min(strip.N - 1, this.cur + this.M.N - 1)); }
  /** How far through the book's text column k is: its first paragraph's place among all
   *  of them (0 to 1). By the text, not by columns, which are estimates until the whole
   *  book is laid out: the same in any layout, size or device. */
  private textShare(k: number): number {
    const strip = this.strip!, book = this.book!, a = strip.anchorAt(k);
    if (!a) return 0;
    if ('key' in a) return shareOf(book, strip.keyIndex, a.key) ?? 0;
    return a.leaf === 'colophon' ? 1 : a.leaf === 'title' ? 0 : shareAt(book, a.sec, 0);
  }

  /** Redraws the columns in view (marks, hits) without moving anything. */
  repaint() { if (this.strip) this.surface.reset(this.cur); }

  /** Brings column k into view: a short way on a calm curve; a long way with a quick
   *  fade, as the surface cannot build a hundred columns in passing. */
  async travelTo(k: number) {
    if (!this.strip) return;
    k = Math.max(0, Math.min(Math.max(0, this.strip.N - this.M.N), k));
    const d = Math.abs(k - this.cur);
    if (!d) return;
    if (d <= 6) { this.go(k); return; }
    const t = this.surface.track;
    if (reduceMotion()) { this.jump(k); return; }
    t.style.transition = 'opacity .11s ease-in'; t.style.opacity = '0';
    await new Promise(r => setTimeout(r, 115));
    this.jump(k);
    requestAnimationFrame(() => { t.style.transition = 'opacity .2s ease-out'; t.style.opacity = '1'; });
  }

  private columnHTML(k: number): string {
    const strip = this.strip!;
    const it = strip.itemAt(k);
    if (!it) return '';
    if (it.type === 'sect') return columnHTML(strip, k, this.M, this.marks, this.marksOf, this.images.src, this.fb?.size ? this.fb : undefined);
    return leafHTML(strip, it, { totalLines: this.totalLines(), N: strip.N });
  }

  private totalLines() {
    let n = 0;
    for (const sl of this.strip!.layouts.values()) n += sl.n;
    return n;
  }

  /** Whether this webview rounds glyph advances, to whole px or 1/60 px (calibrate.ts). */
  private round = false;
  private appUnits = false;
  /** Whether this webview kerns across word spaces (see calibrate.ts). */
  private spaceKern: 0 | 1 | 2 = 0;
  /** Whether this webview shapes inline elements apart (see calibrate.ts). */
  private linkRuns = false;
  calibErr = 0;
  private params(M = this.M, L = this.look): LayoutParams {
    const o = L.options;
    // a short measure (a phone's) is set ragged, whatever the theme says: justified lines of
    // under ~45 characters open rivers between their words
    const justify = o.justify && M.colW >= M.fs * NARROW;
    return {
      size: M.fs, measure: M.colW, rows: M.rows, headRows: M.headRows, lh: M.lh, justify, hyphenate: o.hyphenate, round: this.round, appUnits: this.appUnits,
      font: L.chain, wght: L.wght, bold: L.bold, ls: +((o.charSpacing / 100) * M.fs).toFixed(3), ws: +((o.wordSpacing / 100) * M.fs).toFixed(3), axes: L.axes, spaceKern: this.spaceKern, linkRuns: this.linkRuns,
    };
  }
  /** The page's style made `look`'s at `M`, in the frame the text set for them comes in
   *  (`recompose` follows at once): never before it. */
  private commit(look: Resolved, M: Metrics) {
    this.M = M;
    this.paint(look);
    const reader = this.stage.parentElement!;
    setVars(reader, geomVars(M));
    ui.cols = M.N; ui.colsReduced = M.reduced; ui.phone = M.phone; ui.arrows = M.arrows; ui.railed = this.railed();
    // the notes' rail beside the text: what is about the text (its head, its page) centres on the text
    reader.style.setProperty('--rail', (ui.railed ? this.stage.clientWidth - M.W : 0) + 'px');
  }

  /** The window resizing: the page as it is, kept in the middle of it (set again once it
   *  rests: `relayout`), moved, not rebuilt. */
  private recentre() {
    const M = this.M;
    if (!M || !this.strip) return;
    const W = this.stage.clientWidth - (ui.railed ? RAIL : 0), cx = Math.round(W / 2), x0 = Math.round(cx - M.focusW / 2);
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
    ui.busy = 'Opening…';
    performance.mark('open');
    this.opening = true;
    this.resizedWhileOpening = false;
    try {
      const book = await this.core.open(id);
      performance.mark('open:book');
      if (gen !== this.gen) return;
      this.book = book;
      this.images.reset();
      await this.images.measure(book).catch(() => {});
      if (gen !== this.gen) return;
      this.marks = new Set(kv.get<string[]>('marks.' + id, []));
      this.bookmarks = loadBookmarks(id);
      this.seen = new Set(kv.get<string[]>('seen.' + id, []));
      this.visited = new Set();
      this.furthest = kv.get<number>('far.' + id, 0);
      this.reading = false;
      this.input.taps = 0; this.walked = 0; this.lastK = -1;
      this.strip = new Strip(book);
      this.ann = new Annotations(book, this.strip.keyIndex);
      this.fb = new Feedback(book, this.strip.keyIndex);
      // notes made on another version of the text find their words again (one's own, and
      // other readers' that arrived since)
      await Promise.all([this.ann.place(this.core), this.fb.place(this.core)]).catch(() => {});
      if (gen !== this.gen) return;
      ui.title = book.title;
      ui.view = 'reader';
      await new Promise(r => requestAnimationFrame(r));
      const look = this.wanted();
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

  /** Lays the book out around an anchor: its section first, then (not awaited) the rest. */
  /** Settles once the whole book is laid out for the parameters in use (until then the
   *  columns of the sections not yet set are estimates): what travels to a place named
   *  from outside waits for it. */
  whole: Promise<void> = Promise.resolve();
  private wholeLaid = () => {};

  /** The notes' rail is beside the text: asked for, and room for it (never on a phone). */
  railed(): boolean {
    return ui.rail && !!this.stage && this.stage.clientWidth - RAIL >= 640;
  }

  /** The geometry for the stage as it is (less the rail, which takes one column's place). */
  private measure(size = settings.size, look = this.look) {
    const rail = this.railed();
    return metrics(this.stage.clientWidth - (rail ? RAIL : 0), this.stage.clientHeight, this.lookGeom(look), insets(), size, rail ? 1 : settings.layout);
  }

  /** Calibrates `look` at `M` on a probe host of its own (the page keeps its style), in
   *  the document's body: always drawn (the reader is hidden until a book opens, and a
   *  probe in it measured nothing). */
  private async calibrateFor(look: Resolved, M: Metrics) {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none';
    setVars(host, typeVars(look, M.fs));
    document.body.append(host);
    try { return await calibrate(this.core, host, { ...this.params(M, look), round: false, appUnits: false }); } finally { host.remove(); }
  }

  /** Lays the book out at `M` in `look`, apart from the page, and puts both on the page in
   *  one frame: around `anchor` (none: where the reader is then), its section first, then
   *  (not awaited) the rest. `fade`: the page as it was fades into the new (hold.ts). */
  private async layoutFrom(anchor: Anchor | null, gen: number, look: Resolved, M: Metrics, fade = false) {
    const strip = this.strip!, book = this.book!;
    this.whole = new Promise(r => (this.wholeLaid = r));
    // (the numbers wait for the whole book's count: Progress.svelte)
    ui.settling = true;
    look = await this.ensureFonts(look);
    performance.mark('open:fonts');
    if (gen !== this.gen) return;
    const cal = await this.calibrateFor(look, M);
    performance.mark('open:calibrated');
    this.round = cal.round; this.appUnits = cal.appUnits; this.spaceKern = cal.spaceKern; this.linkRuns = cal.linkRuns; this.calibErr = cal.err;
    if (gen !== this.gen) return;
    const p = this.params(M, look);
    const pg = ++this.paramGen;
    const near = anchor ?? strip.anchorAt(this.cur);
    let sec = 0;
    if (near && 'key' in near) sec = strip.keyIndex.get(near.key)?.[0] ?? 0;
    else if (near && 'sec' in near) sec = Math.max(0, Math.min(book.sections.length - 1, near.sec));
    const first = parseLayout(await this.core.layout(book.id, [sec], p));
    performance.mark('open:first-layout');
    if (gen !== this.gen) return;
    // the page as it is, then (in the same frame) the new: its style and its text together
    const at = anchor ?? strip.anchorAt(this.cur), old = this.M;
    if (fade && old) this.hold.take(this.stage, this.surface.track, this.inView(), { ...typeVars(this.look, old.fs), ...geomVars(old) }, this.lineOf(at));
    this.commit(look, M);
    strip.setEstimate(M.rows, M.colW, M.fs);
    strip.layouts = first;
    this.recompose(at);
    if (fade && old) this.hold.release(this.lineOf(at), M.fs / old.fs);
    performance.mark('open:shown');
    this.calibrateNeighbours();
    this.core.layout(book.id, [], p).then(buf => {
      performance.mark('open:all-layout');
      if (pg !== this.paramGen || this.strip !== strip) return;
      const all = parseLayout(buf);
      const keep = this.motion.moving ? null : strip.anchorAt(this.cur);
      strip.layouts = all;
      this.recompose(keep ?? strip.anchorAt(this.cur), true);
      this.wholeLaid();
      ui.settling = false;
    }, e => { ui.settling = false; toast(`Couldn’t lay out the book: ${(e as Error).message}`, 5000); });
  }

  /** The sizes either side of this one, measured while nothing else is happening: the
   *  next step of the size control finds them known (a size not yet measured took 11–30
   *  ms of its change). */
  private calibrateNeighbours() {
    // (the book, not the layout's generation: a relayout that changes nothing still
    // counts one, and the neighbours were never measured)
    const book = this.book;
    const now = settings.size ?? (this.M.phone ? 17 : 20);
    const i = SIZES.indexOf(now);
    const next = [SIZES[i - 1], SIZES[i + 1]].filter((s): s is number => s !== undefined && i >= 0);
    const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 400));
    idle(async () => {
      for (const size of next) {
        if (!book || this.book !== book) return;
        await this.calibrateFor(this.look, this.measure(size)).catch(() => {});
      }
    });
  }

  /** Measures this webview's glyph positioning once, before any book is opened. */
  async prewarm() {
    this.paint(this.wanted());
    const look = await this.ensureFonts(this.look);
    await document.fonts.ready;
    if (this.book) return;
    this.paint(look);
    await this.calibrateFor(look, metrics(Math.max(640, window.innerWidth), Math.max(480, window.innerHeight), this.lookGeom(look))).catch(() => {});
    if (!this.book) this.core.idle?.();
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

  /** The page as it was, faded into the new one as the text is set again (hold.ts). */
  hold = new Hold();
  private inView() { return Array.from({ length: this.M.N }, (_, i) => this.surface.columnEl(this.cur + i)); }
  /** Where the line at `a` begins on the page in view. */
  private lineOf(a: Anchor | null | undefined) {
    const h = a && 'key' in a ? this.strip!.keyIndex.get(a.key) : null;
    if (!a || !h || !('key' in a)) return null;
    const cols = this.inView().filter((c, i): c is HTMLElement => !!c && this.strip!.itemAt(this.cur + i)?.sec === h[0]);
    return lineStart(this.stage, cols, h[1], a.off);
  }

  async relayout() {
    if (!this.book || !this.strip) return;
    const gen = ++this.gen;
    const old = this.M, look = this.wanted(), M = this.measure(undefined, look);
    const force = this.forceRelayout;
    this.forceRelayout = false;
    if (!force && old && M.W === old.W && M.H === old.H && M.fs === old.fs && M.colW === old.colW && M.rows === old.rows && M.N === old.N) return;
    // same measure and rows: the text need not be set again, only the window moves
    if (!force && old && M.fs === old.fs && M.colW === old.colW && M.rows === old.rows && M.headRows === old.headRows) {
      const at = this.strip.anchorAt(this.cur);
      this.commit(look, M);
      this.recompose(at, true);
      return;
    }
    await this.layoutFrom(null, gen, look, M, true);
  }
  forceRelayout = false;
  async settingsChanged(kind: 'layout' | 'style') {
    if (!this.strip) return;
    if (kind === 'layout') { this.forceRelayout = true; await this.relayout(); }
    else this.surface.reset(this.cur);
  }

  close() {
    // (an embedded book is all there is: there is no library to go back to)
    if (!this.book || embedded) return;
    this.flush();
    this.gen++;
    this.motion.jump(0);
    if (this.finder.open) this.finder.hide();
    ui.bookNote = null; ui.lightbox = null;
    this.book = null; this.strip = null; this.ann = null; this.fb = null; this.reading = false; this.bookmarks = [];
    ui.chip = null;
    this.cursor.end();
    ui.contents = false; ui.sheet = null;
    this.surface.clear();
    this.hold.drop(); ui.settling = false;
    this.core.idle?.();
    ui.view = 'library';
    ui.libVersion++;
  }

  flush() {
    if (!this.book || !this.strip) return;
    clearTimeout(this.saveT); clearTimeout(this.seenT); clearTimeout(this.dwellT);
    const id = this.book.id;
    kv.set('pos.' + id, this.strip.anchorAt(this.cur));
    kv.set('far.' + id, this.furthest);
    kv.set('seen.' + id, [...this.seen]);
    kv.set('marks.' + id, [...this.marks]);
    this.marking.flushDigest();
    const it = this.strip.itemAt(this.cur);
    // the reader's notes, for whoever keeps them elsewhere (the app: a book sent by link
    // sends them back); not while it is still opening: it has not found its place yet,
    // and how far the reader got would read as changed
    if (this.ann && !this.opening) this.onNotes(id, () => this.myNotes());
    kv.set('state.' + id, { where: it && it.sec >= 0 && it.type !== 'colophon' ? chapName(this.book, Math.min(it.sec, this.book.sections.length - 1)) : it?.type === 'colophon' ? 'At the end' : 'At the beginning', done: it?.type === 'colophon' });
  }

  /** Reading begins: the keys go to the page, and the hints for a new reader come. */
  private begin() {
    this.visited = new Set([this.cur]);
    this.reading = true;
    this.stage.focus({ preventScroll: true });
    const opens = kv.get<number>('opens', 0) + 1;
    kv.set('opens', opens);
    if (opens >= 2) setTimeout(() => hint('settings', 'S opens themes, size and spacing; C changes how many columns you see.'), 2500);
    this.touchHint();
  }

  /* ---------- position and movement ---------- */
  headFor(k: number) {
    const strip = this.strip!, it = strip.itemAt(k), b = strip.book;
    if (!it) return '';
    if (it.type === 'title') return b.title;
    if (it.type === 'colophon') return embedOpts.endHref ? 'The end' : 'Colophon';
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
      ui.runhead = this.headFor(k); ui.page = k + 1;
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

  private arrive(k: number, quiet = false) {
    const strip = this.strip!;
    this.shownK = k;
    ui.runhead = this.headFor(k); ui.page = k + 1; ui.pages = strip.N;
    const focus = this.focusCols();
    for (const c of focus) this.visited.add(c);
    this.teach(k);
    clearTimeout(this.dwellT); this.dwellT = window.setTimeout(() => focus.forEach(c => this.markSeen(c)), 1600);
    this.furthest = Math.max(this.furthest, this.viewEnd());
    clearTimeout(this.saveT); this.saveT = window.setTimeout(() => { if (!this.book) return; kv.set('pos.' + this.book.id, strip.anchorAt(this.cur)); kv.set('far.' + this.book.id, this.furthest); }, 400);
    // (by the view's last column: a spread ends with the book's last on its right)
    const last = focus[focus.length - 1] ?? k;
    if (embedded) embedMoved(strip.frac(last), last >= strip.N - 1);
    // controls in leaves are reachable only while their leaf is in focus, and a screen
    // reader hears a leaf only then; the text in view it hears as a document (spoken.ts)
    for (const [c, el] of this.surface.rendered()) {
      for (const x of el.querySelectorAll<HTMLElement>('textarea, button, a[href]')) x.tabIndex = focus.includes(c) ? 0 : -1;
      if (el.classList.contains('leafcol')) el.setAttribute('aria-hidden', String(!focus.includes(c)));
    }
    const said = this.stage.querySelector('.spoken');
    if (said) said.innerHTML = spokenPage(strip, focus);
    if (!quiet && document.activeElement?.closest?.('.leaf') && !focus.some(c => this.surface.columnEl(c)?.contains(document.activeElement))) this.stage.focus({ preventScroll: true });
    if (this.cursor.active) this.cursor.move(0);
  }

  private markSeen(k: number) {
    const L = this.strip?.linesAt(k);
    if (!L || !this.book) return;
    let changed = false;
    const sec = this.book.sections[L.sec];
    for (let j = L.from; j < L.to; j++) {
      const key = sec.blocks[L.sl.u[j * FIELDS + F.block]].key;
      if (!this.seen.has(key)) { this.seen.add(key); changed = true; }
    }
    if (changed) { clearTimeout(this.seenT); this.seenT = window.setTimeout(() => this.book && kv.set('seen.' + this.book.id, [...this.seen]), 800); }
  }

  colSeen(k: number) {
    const L = this.strip?.linesAt(k);
    if (!L || L.to <= L.from) return false;
    const sec = this.book!.sections[L.sec];
    let s = 0;
    for (let j = L.from; j < L.to; j++) if (this.seen.has(sec.blocks[L.sl.u[j * FIELDS + F.block]].key)) s++;
    return s / (L.to - L.from) > 0.6;
  }

  /** Moves to column k on a calm curve. */
  go(k: number) { if (this.strip) this.motion.toward(k); }

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

  /* ---------- notes, references, images ---------- */
  /** Shows note `i` beside its marker. */
  openNote(i: number, at: HTMLElement) {
    if (!this.book?.notes[i]) return;
    const r = at.getBoundingClientRect(), st = this.stage.getBoundingClientRect();
    const below = r.bottom - st.top < st.height * 0.6;
    ui.chip = null;
    ui.bookNote = { i, x: r.left + r.width / 2 - st.left, y: (below ? r.bottom + 6 : r.top - 6) - st.top, below };
  }
  /** Opens an address outside the book it links to, unless the page around an embedded
   *  reader has said its links are not to be followed. */
  openLink(url: string) {
    if (!features.links) return;
    shell.openLink(url).then(ok => { if (!ok) toast('That link goes nowhere a book may send you.'); });
  }
  /** Travels to the block a reference names. */
  followRef(key: string) {
    if (!this.strip) return;
    ui.bookNote = null;
    this.travelTo(this.strip.resolve({ key, off: 0 }));
  }
  /** The column of every note with a card beside its line (one's own written notes, and
   *  readers' on the page), in order (two on one page, twice): the notes' rail counts them
   *  and goes from one page with notes to the next. */
  noteCols(): number[] {
    const strip = this.strip;
    if (!strip) return [];
    const at = [...(this.ann?.list ?? []).filter(a => a.note).map(a => ({ key: a.key, off: a.s })), ...(this.fb?.writtenAt() ?? [])];
    return at.map(a => strip.resolve(a)).sort((a, b) => a - b);
  }
  /** Where a note is printed in the book, as a column to go to. */
  noteHome(i: number): number | null {
    const at = this.book?.notes[i]?.at;
    return at && this.strip ? this.strip.resolve({ key: at, off: 0 }) : null;
  }
  openImage(i: number, fig: HTMLElement) {
    const r = fig.getBoundingClientRect();
    ui.bookNote = null; ui.chip = null;
    ui.lightbox = { i, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
  }

  /** The notes beside the text: in their rail where there is room for it (the text then
   *  in one column beside it; kept for the next time), else those in view over their
   *  columns. */
  toggleNotes() {
    if (this.stage && this.stage.clientWidth - RAIL >= 640) {
      ui.rail = !ui.rail; kv.set('rail', ui.rail);
      ui.sideNotes = null; ui.chip = null;
      this.settingsChanged('layout');
      return;
    }
    if (ui.sideNotes?.pinned) { ui.sideNotes = null; return; }
    const ids: string[] = [];
    for (const k of this.focusCols()) for (const d of this.surface.columnEl(k)?.querySelectorAll<HTMLElement>('.nd') ?? []) ids.push(d.dataset.a!);
    if (!ids.length) { toast('No notes in view. Notes you add show a dot beside their line.'); return; }
    ui.chip = null;
    ui.sideNotes = { ids, pinned: true };
  }

  /* ---------- hints ---------- */
  /** On a touch screen, the gestures, once, as reading begins. */
  private touchHint() {
    setTimeout(() => hint('touch-start', 'Tap near the edges to turn the page, the middle for the menu.', 7000), 900);
  }
  private walked = 0;
  private lastK = -1;
  /** Hints that come with reading: the contents after a long walk column by column, selection
   *  once a reader has read a while and marked nothing. */
  private teach(k: number) {
    const d = this.lastK < 0 ? 0 : Math.abs(k - this.lastK);
    this.lastK = k;
    if (d > 0 && d <= this.M.N * 2) this.walked += d;
    if (this.walked >= 30) hint('contents', 'M shows the contents: every chapter, and your highlights. [ and ] go a chapter on or back.');
    if (this.visited.size >= 14 && !this.ann?.list.length && !this.marks.size) {
      // (each said only where it holds: hints.ts tells touch screens from the rest)
      hint('select', 'Select a passage to highlight it (1–4) or add a note (N); V picks a paragraph from the keyboard.', 7000);
      hint('touch-select', 'Hold on a word to select it; then a colour highlights it, or Note adds a note.', 7000);
    }
  }


}

export { esc };
