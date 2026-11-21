/** The reading geometry: from a window's size and a theme, the columns, their measure, rows
 *  and margins. */
import { embedded, embedOpts } from '../core/embed';
import { settings, type Layout } from './settings.svelte';
import { ui } from '../state.svelte';

/** Height of the reader's bar, which floats over the sheet. */
export const BAR = 52;

/** Reading geometry for a stage size. */
export interface Metrics {
  W: number; H: number; phone: boolean;
  fs: number; lh: number; G: number; P: number;
  /** Columns in the focus window, and its width and left edge. */
  N: number; focusW: number; x0: number;
  /** Whether the requested layout had to give way to a narrower window. */
  reduced: boolean;
  colW: number; colH: number; rows: number; y0: number; cx: number; headRows: number;
  /** The band under the text, above the window's safe area, that holds where the reader is
   *  (Progress.svelte): nothing of the text is ever in it. */
  foot: number;
  /** What the bands above and below the text gain in a box with an edge of its own (a
   *  book on another site's page): the controls in its corners as far from either edge. */
  pad: number;
  /** Arrows at the sides to turn by (an embed's, for a mouse: `ARROWS`). */
  arrows: boolean;
}

interface Across { N: number; colW: number; G: number; arrows: boolean }

/** What a theme contributes to the geometry. */
export interface Look {
  /** Size multiplier of the theme's face. */
  scale: number;
  lineSpacing: number;
  /** Steps of margin: each takes 8% off the measure (negative steps add it). */
  margins: number;
}
export const PLAIN_LOOK: Look = { scale: 1, lineSpacing: 1.5, margins: 0 };

/** Width of the notes' rail beside the text, when it shows (ui/SideNotes.svelte). */
export const RAIL = 360;

/** Room at either side of the text for the arrows a book on another site's page shows a
 *  mouse (ReaderView: 10 from the edge, 40 across, the rest clear of the text), so that a
 *  reader there sees at once that it is a book to turn. Not on a touch screen (a tap in the
 *  page's outer fifth turns it), not in full screen (the reader as it is meant to be), not
 *  where the page asked for less of the reader, nor where their room would leave the text
 *  a measure narrower than the layout ever takes (`spread`). */
export const ARROWS = 56;
const arrowed = () => embedded && embedOpts.ui === 'full' && !document.fullscreenElement && !ui.full && matchMedia('(hover: hover) and (pointer: fine)').matches;

/** A spread of exactly the chosen columns filling the window, like an open book. Gutters
 *  and outer margins grow with the window; the measure is capped, so a wide window gets
 *  wider margins rather than overlong lines. Nothing beside the spread shows: during a
 *  turn columns pass under the paper at its sides. */
function spread(W: number, fs: number, phone: boolean, k: number, layout: Layout): Across {
  const G = phone ? 24 : Math.round(Math.min(84, Math.max(40, fs * 2.6, W * 0.035)));
  // (32 em: some 65 characters a line in the bundled faces, however wide the window)
  const maxMeasure = Math.round(fs * 32 * k), comfortable = Math.round(fs * 25 * Math.min(1, k)), minMeasure = Math.round(fs * 21 * Math.min(1, k));
  // a phone's margins: a thumb's breadth, a little more or less with the theme's margins;
  // with arrows, never less than their room and half a gutter (where the paper's edge is
  // at a turn), and arrows only where a column beside them keeps the narrowest measure
  const own = phone ? Math.round(18 * (2 - k)) : Math.round(Math.min(fs * 6, Math.max(fs * 1.6, W * 0.055)) * (2 - k));
  const room = Math.max(own, ARROWS + Math.ceil(G / 2));
  const arrows = arrowed() && W - 2 * room >= minMeasure;
  const margin = arrows ? room : own;
  const width = (n: number) => Math.floor((W - 2 * margin - (n - 1) * G) / n);
  // a column 200 wide at the least, but never wider than the box with 12 to spare each side
  // (a sidebar's box on someone's page)
  const floor = Math.min(200, W - 24);
  // auto: two columns when each still gets a comfortable measure, else one
  if (layout === 'auto') {
    const n = width(2) >= comfortable ? 2 : 1;
    return { N: n, colW: Math.max(floor, Math.min(maxMeasure, width(n))), G, arrows };
  }
  for (let n = layout; n >= 1; n--) if (width(n) >= minMeasure || n === 1) return { N: n, colW: Math.max(floor, Math.min(maxMeasure, width(n))), G, arrows };
  return { N: 1, colW: Math.max(floor, Math.min(maxMeasure, width(1))), G, arrows };
}

/** The device's safe-area insets (a phone's notch and home indicator, in the installed
 *  app), in px: read from CSS `env()` through a probe, once a size is known. */
export function insets(): { t: number; b: number; l: number; r: number } {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.append(p);
  const cs = getComputedStyle(p);
  const v = { t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0 };
  p.remove();
  return v;
}

export function metrics(W: number, H: number, look: Look = PLAIN_LOOK, ins = { t: 0, b: 0, l: 0, r: 0 }, size = settings.size, layout: Layout = settings.layout): Metrics {
  const phone = W < 640;
  // a phone's type and margins for a phone held sideways too (a short window): wide, but
  // with room for only a few lines of a desktop's size
  const small = phone || H < 480;
  // the theme's face may be set a little larger or smaller to look the size chosen
  const fs = Math.round((size || (small ? 17 : 20)) * look.scale);
  const lh = Math.round(fs * look.lineSpacing);
  const k = 1 - 0.08 * look.margins;
  // the columns keep clear of the insets at the sides (a phone held sideways)
  const side = Math.max(ins.l, ins.r);
  const across = spread(W - 2 * side, fs, phone, k, layout);
  const { N, colW, G, arrows } = across;
  const focusW = N * colW + (N - 1) * G;
  const cx = Math.round(W / 2);
  const x0 = Math.round(cx - focusW / 2);
  // the running head stays at the top, so its band is always reserved: the rest of the bar
  // fades in and out over it without moving the text; the foot holds where the reader is
  // (Progress.svelte) and its line. With no interface at all (a page that shows its own),
  // the text sits as far from the top as from the bottom
  const bare = embedOpts.ui === 'none';
  // (a box on a page shows its edges: the controls in its corners keep as far from the side
  // as from the top or the foot, which the window's own edges, or a phone's, give the app)
  const pad = embedded && !bare ? 8 : 0;
  const foot = (bare ? (small ? 26 : 44) : small ? 52 : 60) + pad;
  let topM = ins.t + (bare ? foot : pad + BAR + (small ? 10 : 20)), botM = ins.b + foot;
  // as many rows as fit between the head and the foot, never one under them; a box too short
  // for even one (a strip on someone's page) gives up some of its head and foot for it
  if (H - topM - botM < lh) { const k = Math.max(0, H - lh) / (topM + botM); topM = Math.floor(topM * k); botM = Math.floor(botM * k); }
  const rows = Math.max(1, Math.min(46, Math.floor((H - topM - botM) / lh)));
  const colH = rows * lh;
  const y0 = topM + Math.max(0, Math.floor((H - topM - botM - colH) / 2));
  return {
    W, H, phone, fs, lh, G, P: colW + G, N, focusW, x0, reduced: layout !== 'auto' && N < layout,
    colW, colH, rows, y0, cx, headRows: rows < 16 ? 4 : phone ? 6 : 7, foot: botM - ins.b, pad, arrows,
  };
}
