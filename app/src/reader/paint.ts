/** The variables the page is drawn with, worked out apart from setting them: a new look or
 *  size is measured on a probe of its own while the page keeps its own, and both change
 *  together, in the frame that shows the text set for them (reader.svelte.ts, `commit`).
 *  A style that reached the page before its text did drew the lines already shown in a
 *  face, size or spacing they were not set for. */
import type { Metrics } from './geometry';
import { uiPalette, type Palette, type Resolved } from './themes.svelte';

export type Vars = Record<string, string>;

export function setVars(el: HTMLElement, vars: Vars) {
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
}

/** The type the lines are set in, at a size: on the root (so calibration probes anywhere
 *  are set as the lines are), or on a probe measuring a look not yet the page's. */
export function typeVars(L: Resolved, fs: number): Vars {
  const o = L.options;
  return {
    '--f-text': L.css,
    '--wb': String(L.wght),
    '--wB': String(L.bold),
    '--w-sc': String(L.wght + 30),
    '--ls': ((o.charSpacing / 100) * fs).toFixed(3) + 'px',
    '--ws': ((o.wordSpacing / 100) * fs).toFixed(3) + 'px',
    '--opsz-sc': String(Math.min(144, Math.max(6, fs * 0.78))),
    '--fvs': L.axes.map(([k, v]) => `"${k}" ${v}, `).join('') + '"wght" 400,',
  };
}

/** Where the text lies: on the reader. `--fl` and `--fr` are the paper either side of the
 *  spread (the curtains, reader.css). */
export function geomVars(M: Metrics): Vars {
  return {
    '--fs': M.fs + 'px',
    '--lh': M.lh + 'px',
    '--colW': M.colW + 'px',
    '--colH': M.colH + 'px',
    '--G': M.G + 'px',
    '--y0': M.y0 + 'px',
    '--foot': M.foot + 'px',
    '--pad': M.pad + 'px',
    '--opsz': String(Math.min(144, Math.max(6, M.fs))),
    '--opsz-s': String(Math.min(144, Math.max(6, M.fs * 0.7))),
    '--fl': M.x0 - M.G / 2 + 'px',
    '--fr': M.x0 + M.focusW + M.G / 2 + 'px',
  };
}

/** The palette's tokens, set on the reader and all it shows (`.look`). */
export const PALETTE = [
  '--paper',
  '--ink',
  '--ink-2',
  '--ink-3',
  '--rule',
  '--accent',
  '--accent-ink',
  '--focus',
  '--wash',
  '--read',
  '--hover',
  '--surface',
  '--sheet',
  '--ground',
  '--hl1',
  '--hl2',
  '--hl3',
  '--hl4',
];

/** A theme's colours as those tokens (none: the app's own, `tokens.css`): what lies on the
 *  page (a menu, a card, a panel, a sheet) on the theme's paper, a step lighter, and the
 *  quieter inks reading on all of it (more contrast asked for: nearer the ink). */
export function paletteVars(pal: Palette | null, dark: boolean, more: boolean): Vars | null {
  if (!pal) return null;
  const { paper, ink, accent } = pal,
    u = uiPalette(pal, dark, more);
  return {
    '--paper': paper,
    '--ink': ink,
    '--accent': accent,
    '--focus': accent,
    '--accent-ink': paper,
    '--surface': u.surface,
    '--sheet': u.sheet,
    '--ground': u.ground,
    '--ink-2': u.ink2,
    '--ink-3': u.ink3,
    '--rule': `color-mix(in oklab, ${ink} 16%, ${paper})`,
    '--wash': `color-mix(in srgb, ${accent} 13%, transparent)`,
    '--read': `color-mix(in srgb, ${ink} 5%, transparent)`,
    '--hover': `color-mix(in srgb, ${ink} 7%, transparent)`,
    '--hl1': u.hl[0],
    '--hl2': u.hl[1],
    '--hl3': u.hl[2],
    '--hl4': u.hl[3],
  };
}
