import { embedOpts } from '../core/embed';
import { settings, type Layout } from './settings.svelte';

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
}

interface Across { N: number; colW: number; G: number }

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

/** A spread of exactly the chosen columns filling the window, like an open book. Gutters
 *  and outer margins grow with the window; the measure is capped, so a wide window gets
 *  wider margins rather than overlong lines. Nothing beside the spread shows: during a
 *  turn columns pass under the paper at its sides. */
function spread(W: number, fs: number, phone: boolean, k: number, layout: Layout): Across {
  const G = phone ? 24 : Math.round(Math.min(84, Math.max(40, fs * 2.6, W * 0.035)));
  // a phone's margins: a thumb's breadth, a little more or less with the theme's margins
  const margin = phone ? Math.round(18 * (2 - k)) : Math.round(Math.min(fs * 6, Math.max(fs * 1.6, W * 0.055)) * (2 - k));
  // (32 em: some 65 characters a line in the bundled faces, however wide the window)
  const maxMeasure = Math.round(fs * 32 * k), comfortable = Math.round(fs * 25 * Math.min(1, k)), minMeasure = Math.round(fs * 21 * Math.min(1, k));
  const width = (n: number) => Math.floor((W - 2 * margin - (n - 1) * G) / n);
  // auto: two columns when each still gets a comfortable measure, else one
  if (layout === 'auto') {
    const n = width(2) >= comfortable ? 2 : 1;
    return { N: n, colW: Math.max(200, Math.min(maxMeasure, width(n))), G };
  }
  for (let n = layout; n >= 1; n--) if (width(n) >= minMeasure || n === 1) return { N: n, colW: Math.max(200, Math.min(maxMeasure, width(n))), G };
  return { N: 1, colW: Math.min(maxMeasure, width(1)), G };
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
  const { N, colW, G } = across;
  const focusW = N * colW + (N - 1) * G;
  const cx = Math.round(W / 2);
  const x0 = Math.round(cx - focusW / 2);
  // the running head stays at the top, so its band is always reserved: the rest of the bar
  // fades in and out over it without moving the text; the foot holds where the reader is
  // (Progress.svelte) and its line. With no interface at all (a page that shows its own),
  // the text sits as far from the top as from the bottom
  const bare = embedOpts.ui === 'none';
  const foot = bare ? (small ? 26 : 44) : small ? 52 : 60;
  const topM = ins.t + (bare ? foot : BAR + (small ? 10 : 20)), botM = ins.b + foot;
  // as many rows as fit between the head and the foot: never one under them, however short
  // the window (a few, at the least, when even those do not fit)
  const rows = Math.max(3, Math.min(46, Math.floor((H - topM - botM) / lh)));
  const colH = rows * lh;
  const y0 = topM + Math.max(0, Math.floor((H - topM - botM - colH) / 2));
  return {
    W, H, phone, fs, lh, G, P: colW + G, N, focusW, x0, reduced: layout !== 'auto' && N < layout,
    colW, colH, rows, y0, cx, headRows: rows < 16 ? 4 : phone ? 6 : 7, foot,
  };
}
