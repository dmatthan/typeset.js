/** The look the text is set and painted in: the theme resolved for the appearance (light,
 *  dark, the desktop's colours), its faces made ready, this webview's way of measuring
 *  calibrated, the parameters the press sets lines with, and the page painted with all of
 *  it. The reader's (`reader.appearance`). */
import { edges } from '../core/edges';
import type { LayoutParams } from '../core/types';
import { metrics, type Look, type Metrics } from './geometry';
import { calibrate } from './calibrate';
import { settings, SIZES } from './settings.svelte';
import { themes, themeById, resolve, loadFamily, fontsReady, type Resolved } from './themes.svelte';
import { paletteVars, PALETTE, setVars, typeVars } from './paint';
import { ui } from '../state.svelte';
import type { Reader } from './reader.svelte';

export class Appearance {
  /** The current theme, resolved for the current appearance (the page's only once its
   *  text is set: `Reader.commit`). */
  look: Resolved = resolve(themeById(settings.theme), false);
  /** How this webview positions glyphs (calibrate.ts): advances rounded (to whole px, or
   *  to 1/60 px: `appUnits`), kerning across word spaces, inline elements shaped apart;
   *  and how far the best model still missed. */
  round = false;
  appUnits = false;
  spaceKern: 0 | 1 | 2 = 0;
  linkRuns = false;
  calibErr = 0;
  /** The faces, weights and book the fonts were last made ready for: a size changes none
   *  of them (asking again cost 23 ms of every change of size). */
  private fontsFor = '';

  constructor(private r: Reader) {}

  isDark() {
    if (settings.appearance !== 'auto') return settings.appearance === 'dark';
    return themes.desktop ? themes.desktop.dark : matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /** The look the settings ask for now (the page's only once its text is set). */
  wanted() {
    return resolve(themeById(settings.theme), this.isDark());
  }

  /** Paints `look` on the page: the appearance on the root, the theme's colours on the
   *  reader and all it shows (its menus, panels and sheets: the theme's paper, softened, as
   *  their surface, so that all of it is of one piece with the page; the library's sheets
   *  keep the app's own), the type the lines are set in (on the root, so calibration probes
   *  anywhere are set as the lines are). Only with the text set for it (`Reader.commit`), or
   *  a look that sets nothing differently (another appearance: `themeChanged`). */
  paint(look: Resolved) {
    const root = document.documentElement,
      stage = this.r.stage;
    const want =
      settings.appearance === 'auto'
        ? themes.desktop
          ? themes.desktop.dark
            ? 'dark'
            : 'light'
          : null
        : settings.appearance;
    if (want) root.setAttribute('data-theme', want);
    else root.removeAttribute('data-theme');
    this.look = look;
    const el = stage?.closest<HTMLElement>('.look');
    if (el) {
      const pal = paletteVars(look.palette, this.isDark(), matchMedia('(prefers-contrast: more)').matches);
      if (pal) setVars(el, pal);
      else for (const k of PALETTE) el.style.removeProperty(k);
    }
    // (dark paper: rich blocks, drawn in ink, are inverted: reader.css)
    stage?.parentElement?.classList.toggle('dark-paper', this.isDark());
    root.classList.toggle('synth-sc', look.synthSc);
    setVars(root, typeVars(look, this.r.M?.fs ?? 20));
    this.paintEdges(1400);
  }

  /** The colour around the page follows the surface in view (`core/edges.ts`); `ms` as the
   *  surface changes: the reader fades between themes over 1.4 s. */
  paintEdges(ms: number) {
    const c = ui.lightbox
      ? '#0c0d11'
      : ui.view !== 'reader'
        ? 'var(--ground)'
        : (this.look.palette?.paper ?? 'var(--paper)');
    edges(c, ms);
  }

  /** Another appearance (light, dark, the desktop's colours): the theme's other palette,
   *  nothing set differently. A theme, a face or an option changes through
   *  `Reader.settingsChanged`, with the text set for it. */
  themeChanged() {
    this.paint(this.wanted());
  }

  /** What of `look` the geometry needs (geometry.ts). */
  lookGeom(look = this.look): Look {
    const o = look.options;
    return { size: look.size, lineSpacing: o.lineSpacing, margins: o.margins };
  }

  /** Loads `look`'s face (system families are handed to the webview first), nothing on
   *  the page changing; returns the look as it is known with its face (small capitals). */
  async ensureFonts(look: Resolved): Promise<Resolved> {
    const { book, core } = this.r;
    const key = JSON.stringify([look.chain, look.wght, look.bold, book?.id ?? '', book?.ext ?? '']);
    if (key === this.fontsFor) return look;
    // the page's faces first: the engine's copy of them then comes from the browser's
    // cache (asked for at once, each face was downloaded twice)
    await fontsReady(look, this.r.M?.fs ?? 20, '', undefined).catch(() => {});
    await loadFamily(core, look.chain[0]);
    // the family's small capitals are known only once it is loaded
    look = this.wanted();
    const needs = book ? await core.fontNeeds(book.id, look.chain[0]).catch(() => undefined) : undefined;
    await fontsReady(look, this.r.M?.fs ?? 20, book?.ext ?? '', needs);
    this.fontsFor = key;
    return look;
  }

  /** What the press sets lines with: `look` at `M`, as this webview measures. */
  params(M: Metrics, L = this.look): LayoutParams {
    const o = L.options;
    // (justified as the theme or the reader says, at any measure: a phone's too, as Apple
    // Books sets them, hyphenation and the line breaker keeping a short line's spaces even)
    return {
      size: M.fs,
      measure: M.colW,
      rows: M.rows,
      headRows: M.headRows,
      lh: M.lh,
      justify: o.justify,
      hyphenate: o.hyphenate,
      round: this.round,
      appUnits: this.appUnits,
      font: L.chain,
      wght: L.wght,
      bold: L.bold,
      ls: +((o.charSpacing / 100) * M.fs).toFixed(3),
      ws: +((o.wordSpacing / 100) * M.fs).toFixed(3),
      axes: L.axes,
      spaceKern: this.spaceKern,
      linkRuns: this.linkRuns,
    };
  }

  /** Measures how this webview sets `look` at `M`, and keeps it for the layouts that follow. */
  async calibrate(look: Resolved, M: Metrics) {
    const cal = await this.calibrateFor(look, M);
    this.round = cal.round;
    this.appUnits = cal.appUnits;
    this.spaceKern = cal.spaceKern;
    this.linkRuns = cal.linkRuns;
    this.calibErr = cal.err;
  }

  /** Calibrates `look` at `M` on a probe host of its own (the page keeps its style), in
   *  the document's body: always drawn (the reader is hidden until a book opens, and a
   *  probe in it measured nothing). */
  private async calibrateFor(look: Resolved, M: Metrics) {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none';
    setVars(host, typeVars(look, M.fs));
    document.body.append(host);
    try {
      return await calibrate(this.r.core, host, { ...this.params(M, look), round: false, appUnits: false });
    } finally {
      host.remove();
    }
  }

  /** The sizes either side of this one, measured while nothing else is happening: the
   *  next step of the size control finds them known (a size not yet measured took 11–30
   *  ms of its change). */
  calibrateNeighbours() {
    // (the book, not the layout's generation: a relayout that changes nothing still
    // counts one, and the neighbours were never measured)
    const book = this.r.book;
    const i = SIZES.indexOf(this.r.M.fs);
    const next = [SIZES[i - 1], SIZES[i + 1]].filter((s): s is number => s !== undefined && i >= 0);
    const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 400));
    idle(async () => {
      for (const size of next) {
        if (!book || this.r.book !== book) return;
        await this.calibrateFor(this.look, this.r.measure(size)).catch(() => {});
      }
    });
  }

  /** Measures this webview's glyph positioning once, before any book is opened. */
  async prewarm() {
    this.paint(this.wanted());
    const look = await this.ensureFonts(this.look);
    await document.fonts.ready;
    if (this.r.book) return;
    this.paint(look);
    await this.calibrateFor(
      look,
      metrics(Math.max(640, window.innerWidth), Math.max(480, window.innerHeight), this.lookGeom(look)),
    ).catch(() => {});
    if (!this.r.book) this.r.core.idle?.();
  }
}
