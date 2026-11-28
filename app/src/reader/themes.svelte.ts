/** Themes: the bundled ones and the reader's own, resolved for an appearance into type and
 *  palette, and saved, exported and read back. */
import { kv } from '../core/kv';
import type { Core, FamilyLoad } from '../core/types';
import { BUNDLED, BUNDLED_SMCP } from '../core/fonts';
import { contrast, fitContrast, fromOklch, hexToRgb, luminance, mix, tame, toOklch } from './color';

/** A theme: a typeface with its own settings, the layout options it is designed for, and
 *  a light and a dark palette. The reader may change any option; the change is kept per
 *  theme as a difference from its design, so resetting is deleting it. */
export interface Palette {
  paper: string;
  ink: string;
  accent: string;
}
export interface Options {
  boldText: boolean;
  /** Line height as a multiple of the size. */
  lineSpacing: number;
  /** Letter spacing and extra word spacing, in hundredths of the size (%). */
  charSpacing: number;
  wordSpacing: number;
  /** The reader's margin steps, −10 to +10 (geometry.ts `spread`): each 8% of a page's
   *  tenth, positive wider margins and a shorter line. */
  margins: number;
  justify: boolean;
  hyphenate: boolean;
  /** The face the text is set in, when the reader has chosen another than the theme's
   *  own: a family a built-in theme is designed around (`typeOf`). */
  face?: string;
}
export interface TypeSpec {
  family: string;
  /** Which bundled faces set the characters the family lacks. */
  fallback: 'serif' | 'sans';
  weight: number;
  /** `<b>` and headings. */
  bold: number;
  /** Body weight with Bold Text on. */
  boldText: number;
  axes: Record<string, number>;
}
export interface Theme {
  id: string;
  name: string;
  builtin?: boolean;
  /** Takes its colours from the desktop where the desktop publishes them (Omarchy). */
  desktop?: boolean;
  /** The type's size on a phone, the theme's own design (as each of Apple's themes has its
   *  own): the face chosen in it does not change it; a larger screen and the reader's steps
   *  are counted from it (`sizeOf`). */
  size: number;
  type: TypeSpec;
  options: Options;
  /** null: the app's own paper (Original). */
  light: Palette | null;
  dark: Palette | null;
}

/** A theme's setting, of two kinds as Apple's themes are: compact as a book (close leading,
 *  justified) or open (more leading, ragged); each matched to its Apple counterpart by the
 *  space between lines a reader sees, in our faces. Always hyphenated. */
const opts = (lineSpacing: number, justify: boolean, boldText = false): Options => ({
  boldText,
  lineSpacing,
  charSpacing: 0,
  wordSpacing: 0,
  margins: 0,
  justify,
  hyphenate: true,
});

export const BUILTIN: Theme[] = [
  {
    id: 'book',
    name: 'Book',
    size: 13,
    builtin: true,
    desktop: true,
    type: { family: 'Literata', fallback: 'serif', weight: 400, bold: 650, boldText: 520, axes: {} },
    options: opts(1.3, true),
    light: null,
    dark: null,
  },
  {
    id: 'slate',
    name: 'Slate',
    size: 17,
    builtin: true,
    type: { family: 'Newsreader', fallback: 'serif', weight: 400, bold: 600, boldText: 500, axes: {} },
    options: opts(1.2, true),
    light: { paper: '#e3e2df', ink: '#46443f', accent: '#5b6675' },
    dark: { paper: '#3c3c3f', ink: '#bebcb7', accent: '#a7b2c0' },
  },
  {
    id: 'linen',
    name: 'Linen',
    size: 17,
    builtin: true,
    type: { family: 'Charis', fallback: 'serif', weight: 400, bold: 700, boldText: 500, axes: {} },
    options: opts(1.55, false),
    light: { paper: '#f5f1e8', ink: '#1f1d1a', accent: '#86572c' },
    dark: { paper: '#232220', ink: '#d8d3c8', accent: '#d3a46e' },
  },
  {
    id: 'clear',
    name: 'Clear',
    size: 17,
    builtin: true,
    type: { family: 'Inter', fallback: 'sans', weight: 440, bold: 720, boldText: 560, axes: {} },
    options: opts(1.5, false, true),
    light: { paper: '#ffffff', ink: '#000000', accent: '#0a5fd0' },
    dark: { paper: '#0e0e0f', ink: '#f4f4f4', accent: '#5aa2ff' },
  },
  {
    id: 'warm',
    name: 'Warm',
    size: 16,
    builtin: true,
    type: { family: 'Fraunces', fallback: 'serif', weight: 370, bold: 600, boldText: 470, axes: { SOFT: 50, WONK: 0 } },
    options: opts(1.5, false),
    light: { paper: '#f0e4cd', ink: '#3d3024', accent: '#985a2c' },
    dark: { paper: '#3a2f25', ink: '#e6d5bb', accent: '#e0a86a' },
  },
  {
    id: 'open',
    name: 'Open',
    size: 15,
    builtin: true,
    type: { family: 'Nunito Sans', fallback: 'sans', weight: 430, bold: 720, boldText: 530, axes: { wdth: 102 } },
    options: opts(1.4, true),
    light: { paper: '#fbf6ea', ink: '#1e1a15', accent: '#b0502a' },
    dark: { paper: '#1a1713', ink: '#e8dfcf', accent: '#e89a5b' },
  },
];

/** The app's own palette (the default theme's: `tokens.css`, which CSS keeps), as colours
 *  for what needs one written down: a theme exported or begun from the default, a book on a
 *  page's own paper. The two are held to agree (tests/reader.spec.ts). */
export const STOCK = {
  light: { paper: fromOklch(0.982, 0.006, 80), ink: fromOklch(0.23, 0.008, 70), accent: fromOklch(0.5, 0.11, 255) },
  dark: { paper: fromOklch(0.205, 0.006, 80), ink: fromOklch(0.88, 0.012, 84), accent: fromOklch(0.76, 0.1, 262) },
};

/** A book on another site's page, on that page's own paper (ui/Embed.svelte): the palette
 *  of the theme the page chose, read light or dark as the paper is, the paper exactly the
 *  page's, the theme's ink and accent kept where they read on it (`onto`). */
export function onPaper(t: Theme, paper: string): { palette: Palette; dark: boolean } | null {
  const rgb = hexToRgb(paper);
  if (!rgb) return null;
  const dark = luminance(rgb) < 0.18;
  return { palette: onto(paper, (dark ? t.dark : t.light) ?? STOCK[dark ? 'dark' : 'light']), dark };
}

/** A palette on `paper`: `from`'s ink and accent kept where they read on it, else moved,
 *  hue kept, until they do (7:1 for the text, 3.2:1 for the accent). */
export function onto(paper: string, from: Palette): Palette {
  return { paper, ink: fitContrast(paper, from.ink, 7, 21), accent: fitContrast(paper, from.accent, 3.2, 21) };
}

/** The same palette by night (a theme made from a paper alone): a dim paper of the day's
 *  hue, barely coloured, as the stock night's; a soft light ink of the day ink's hue; the
 *  accent lifted; fitted as `onto` fits. */
export function nightOf(day: Palette): Palette {
  const lch = (c: string) => toOklch(hexToRgb(c)!);
  const [, pc, ph] = lch(day.paper),
    [, ic, ih] = lch(day.ink),
    [al, ac, ah] = lch(day.accent);
  const paper = fromOklch(0.205, Math.min(pc, 0.012), ph);
  return onto(paper, {
    paper,
    ink: fromOklch(0.88, Math.min(ic, 0.015), ih),
    accent: fromOklch(Math.max(al, 0.74), ac, ah),
  });
}

/** The type a face is set in: a bundled face as its theme tunes it (weights, axes), or an
 *  installed one with a book's usual weights, serif or sans by its name. */
export function typeFor(family: string): TypeSpec {
  const f = FACES.find(x => x.family === family);
  return f
    ? { ...f, axes: { ...f.axes } }
    : { family, fallback: SANS.test(family) ? 'sans' : 'serif', weight: 400, bold: 700, boldText: 500, axes: {} };
}

/** What a theme's palette gives the interface on its page: a surface for what lies on it
 *  (a menu, a card, a panel; `sheet`, a sheet), the paper a step lighter (by day toward
 *  white, by night toward the ink, as the app's own are), and a ground a step darker for
 *  what sits beside it (the contents); and the quieter inks, `ink2` for
 *  what is secondary, `ink3` for what is quietest (the running head, the page's number),
 *  set toward the paper but never below 4.5:1 (WCAG AA) on the paper or any of these:
 *  a mix alone left Slate's and Warm's at 3.1 to 4.2. `more`: more contrast asked for. */
export function uiPalette(p: Palette, dark: boolean, more = false) {
  const surface = dark ? mix(p.paper, p.ink, 0.03) : mix(p.paper, '#ffffff', 0.4);
  const sheet = dark ? mix(p.paper, p.ink, 0.05) : mix(p.paper, '#ffffff', 0.25);
  const ground = dark ? mix(p.paper, '#000000', 0.2) : mix(p.paper, p.ink, 0.035);
  const worst = (c: string) => Math.min(...[p.paper, surface, sheet, ground].map(g => contrast(c, g)));
  // the most of the way to the paper (at most `t`) that still reads at 4.5:1 (4.6, for
  // rounding): the ink itself reads (7:1 and more), so the search has an answer
  const quiet = (t: number) => {
    if (worst(mix(p.ink, p.paper, t)) >= 4.6) return t;
    let lo = 0,
      hi = t;
    for (let i = 0; i < 20; i++) {
      const m = (lo + hi) / 2;
      if (worst(mix(p.ink, p.paper, m)) >= 4.6) lo = m;
      else hi = m;
    }
    return lo;
  };
  const t3 = quiet(more ? 0.16 : 0.38),
    t2 = Math.min(more ? 0.1 : 0.26, t3 * 0.68);
  return {
    surface,
    sheet,
    ground,
    ink2: mix(p.ink, p.paper, t2),
    ink3: mix(p.ink, p.paper, t3),
    hl: highlights(p, dark),
  };
}

/** The highlights' colours (yellow, green, blue, pink), by day a pastel and by night a
 *  jewel tone laid thinly on the paper, as much of each as leaves the ink over it reading
 *  at 4.5:1 (a dim ink on a grey paper, Slate's by night, read at 4.0 under the yellow
 *  before). The default theme's are its tokens' (tokens.css), the same. */
export const HIGHLIGHTS = {
  light: [
    [0.9, 0.12, 95, 0.55],
    [0.88, 0.1, 150, 0.5],
    [0.86, 0.08, 240, 0.5],
    [0.86, 0.1, 350, 0.45],
  ],
  dark: [
    [0.8, 0.16, 88, 0.42],
    [0.75, 0.15, 155, 0.38],
    [0.72, 0.13, 250, 0.44],
    [0.74, 0.15, 350, 0.4],
  ],
} as const;
function highlights(p: Palette, dark: boolean): string[] {
  return HIGHLIGHTS[dark ? 'dark' : 'light'].map(([L, C, H, a]) => {
    const c = fromOklch(L, C, H);
    let k = a;
    while (k > 0.12 && contrast(p.ink, mix(p.paper, c, k)) < 4.6) k -= 0.02;
    return (
      c +
      Math.round(k * 255)
        .toString(16)
        .padStart(2, '0')
    );
  });
}

export interface DesktopPalette {
  name: string;
  paper: string;
  ink: string;
  accent: string;
  dark: boolean;
}

export const themes = $state({
  user: kv.get<Theme[]>('themes', []),
  opts: kv.get<Record<string, Partial<Options>>>('themeOpts', {}),
  desktop: null as DesktopPalette | null,
  /** Families the press has loaded, by name. */
  families: {} as Record<string, FamilyLoad>,
  /** Installed families (desktop), once asked for. */
  system: null as string[] | null,
  /** What a page around an embedded reader chose, for the visit, never kept (ui/Embed.svelte):
   *  its paper over one theme (by night or by day, as the paper reads), and a theme it made,
   *  standing in the default's place. Layers on the themes, not themes of their own. */
  paper: null as { of: string; dark: boolean; palette: Palette } | null,
  mine: null as Theme | null,
  /** The open book's own leading, where it sets one (reader.svelte.ts): Book's, as Apple
   *  Books' Original keeps a book's. A layer for the book, never kept. */
  leading: null as number | null,
});

/** Every theme, in the order they are offered: the built-in ones (the default's place a
 *  theme an embedding page made, if it made one), then the reader's own. */
export const allThemes = (): Theme[] => [...BUILTIN.map(t => (t.id === 'book' && themes.mine) || t), ...themes.user];
export const themeById = (id: string): Theme => allThemes().find(t => t.id === id) ?? BUILTIN[0];

/** The options a theme is designed with (themes saved before an option existed take its
 *  default). */
/** A theme's own options; Book's leading the open book's where it sets one, to the panel's
 *  step and within what the themes' own span (1.2 to 1.6: a book set double for a
 *  manuscript, or solid, reads as neither), so that the reader's own change is a change
 *  from it and a reset goes back to it. */
export const designOf = (t: Theme): Options => ({
  ...t.options,
  ...(t.id === 'book' && themes.leading
    ? { lineSpacing: Math.min(1.6, Math.max(1.2, Math.round(themes.leading * 20) / 20)) }
    : {}),
  hyphenate: t.options.hyphenate ?? true,
  face: t.type.family,
});
export function optionsOf(t: Theme): Options {
  return { ...designOf(t), ...themes.opts[t.id] };
}
export function optionChanged(t: Theme, k: keyof Options) {
  const o = themes.opts[t.id];
  return !!o && k in o && o[k] !== designOf(t)[k];
}
export const anyOptionChanged = (t: Theme) =>
  (Object.keys(designOf(t)) as (keyof Options)[]).some(k => optionChanged(t, k));
export function setOption<K extends keyof Options>(t: Theme, k: K, v: Options[K]) {
  const o = { ...themes.opts[t.id] };
  if (v === designOf(t)[k]) delete o[k];
  else o[k] = v;
  themes.opts = { ...themes.opts, [t.id]: o };
  kv.set('themeOpts', themes.opts);
}
export function resetOptions(t: Theme, k?: keyof Options) {
  const o = { ...themes.opts[t.id] };
  if (k) delete o[k];
  else for (const key of Object.keys(o)) delete (o as any)[key];
  themes.opts = { ...themes.opts, [t.id]: o };
  kv.set('themeOpts', themes.opts);
}

export function saveUserTheme(t: Theme) {
  const i = themes.user.findIndex(x => x.id === t.id);
  themes.user = i >= 0 ? themes.user.map(x => (x.id === t.id ? t : x)) : [...themes.user, t];
  kv.set('themes', themes.user);
}
export function deleteUserTheme(id: string) {
  themes.user = themes.user.filter(t => t.id !== id);
  const o = { ...themes.opts };
  delete o[id];
  themes.opts = o;
  kv.set('themes', themes.user);
  kv.set('themeOpts', themes.opts);
}

/** The faces a reader may set any theme in: those the built-in themes are designed around,
 *  each with its theme's sizing and weights (made for it, and measured). */
export const FACES = BUILTIN.map(t => t.type);
/** The type a theme is set in: its own, or the face the reader chose for it. */
export function typeOf(t: Theme): TypeSpec {
  const face = optionsOf(t).face;
  return face === t.type.family ? t.type : (FACES.find(f => f.family === face) ?? t.type);
}

/* ---------- resolving a theme for the reader ---------- */

/** The family chain the press and the CSS use: the theme's face, then bundled faces for
 *  whatever it lacks. */
export function chainOf(t: TypeSpec): string[] {
  const rest = t.fallback === 'sans' ? ['Inter', 'Literata'] : ['Literata', 'Inter'];
  return [t.family, ...rest.filter(f => f !== t.family)];
}
export const cssFamily = (chain: string[], fallback: 'serif' | 'sans') =>
  chain.map(f => `"${f.replace(/"/g, '')}"`).join(', ') + (fallback === 'sans' ? ', sans-serif' : ', serif');

export interface Resolved {
  theme: Theme;
  options: Options;
  chain: string[];
  css: string;
  /** The theme's size (`Theme.size`). */
  size: number;
  wght: number;
  bold: number;
  axes: [string, number][];
  synthSc: boolean;
  /** Colours for the current appearance; null keeps the app's own paper. */
  palette: Palette | null;
}

export function resolve(t: Theme, dark: boolean): Resolved {
  const o = optionsOf(t);
  const ty = typeOf(t);
  const wght = o.boldText ? ty.boldText : ty.weight;
  const bold = Math.min(1000, ty.bold + (wght - ty.weight));
  const chain = chainOf(ty);
  const info = themes.families[ty.family];
  const smcp = info ? info.smcp : BUNDLED_SMCP.has(ty.family);
  let palette: Palette | null = dark ? t.dark : t.light;
  const d = themes.desktop;
  if (t.desktop && d && d.dark === dark) palette = { paper: d.paper, ink: d.ink, accent: d.accent };
  // (an embedding page's paper, over the theme it chose)
  const pp = themes.paper;
  if (pp && pp.of === t.id && pp.dark === dark) palette = pp.palette;
  return {
    theme: t,
    options: o,
    chain,
    css: cssFamily(chain, ty.fallback),
    size: t.size,
    wght,
    bold,
    axes: Object.entries(ty.axes).filter(([k]) => k.length === 4),
    synthSc: !smcp,
    palette,
  };
}

/* ---------- fonts ---------- */

const familyLoads = new Map<string, Promise<FamilyLoad | null>>();

/** Makes a family ready in the press and in the webview (system families' files are
 *  handed to the webview as FontFaces, so both read the very same bytes). Unknown
 *  families resolve to null: the chain then falls through to the next face. */
export function loadFamily(core: Core, name: string): Promise<FamilyLoad | null> {
  let p = familyLoads.get(name);
  if (!p) {
    p = (async () => {
      try {
        const info = await core.loadFamily(name);
        if (!info.bundled && core.fontFile) {
          await Promise.all(
            info.files.map(async (f, i) => {
              const bytes = await core.fontFile!(name, i);
              const face = new FontFace(name, bytes, {
                style: f.italic ? 'italic' : 'normal',
                weight: f.wmin === f.wmax ? String(f.wmin) : `${f.wmin} ${f.wmax}`,
              });
              await face.load();
              document.fonts.add(face);
            }),
          );
        }
        themes.families = { ...themes.families, [name]: info };
        return info;
      } catch {
        return null;
      }
    })();
    familyLoads.set(name, p);
  }
  return p;
}

/** Waits until the webview has every face a layout may draw with, so nothing is drawn in
 *  a system font while a face is still on its way (WebKit measured an italic ʽ at 6.67 px
 *  for Inter's 5.16 that way). The theme's face, upright and italic, body and bold; with a
 *  book, its extension faces for its characters beyond the core (`ext`), the fallback
 *  faces only for the characters the theme's face lacks (`needs.fallback`), and the
 *  monospaced face only for preformatted text. A face no book needs is never fetched. */
export async function fontsReady(r: Resolved, size: number, ext = '', needs?: { fallback: string; pre: boolean }) {
  const loads: Promise<unknown>[] = [];
  const each = (f: string, text?: string) => {
    const fam = `"${f.replace(/"/g, '')}"`;
    for (const w of [r.wght, r.bold])
      for (const it of ['', 'italic '])
        loads.push(
          text === undefined
            ? document.fonts.load(`${it}${w} ${size}px ${fam}`)
            : document.fonts.load(`${it}${w} ${size}px ${fam}`, text),
        );
  };
  each(r.chain[0]);
  if (ext) each(r.chain[0], ext);
  if (needs?.fallback) for (const f of r.chain.slice(1)) each(f, needs.fallback);
  if (needs?.pre) {
    loads.push(document.fonts.load(`400 ${size}px "JetBrains Mono"`));
    if (ext) loads.push(document.fonts.load(`400 ${size}px "JetBrains Mono"`, ext));
  }
  await Promise.all(loads).catch(() => {});
}

export async function systemFamilies(core: Core): Promise<string[]> {
  if (themes.system) return themes.system;
  themes.system = core.systemFamilies ? await core.systemFamilies().catch(() => []) : [];
  return themes.system;
}
export const bundledFamilies = () => Object.keys(BUNDLED);

/* ---------- the desktop's colours ---------- */

export async function readDesktop(core: Core) {
  const raw = core.desktopPalette ? await core.desktopPalette().catch(() => null) : null;
  if (!raw || !raw.background || !raw.foreground) {
    themes.desktop = null;
    return;
  }
  const t = tame(raw.background, raw.foreground, raw.accent || raw.foreground);
  if (!t) {
    themes.desktop = null;
    return;
  }
  themes.desktop = {
    name: raw.name || 'Desktop',
    paper: t.paper,
    ink: t.ink,
    accent: t.accent,
    dark: raw.mode ? raw.mode === 'dark' : t.dark,
  };
}

/* ---------- import, export, and the brief for an AI ---------- */

export const FORMAT = 'typeset-theme/1';

export function exportTheme(t: Theme): string {
  const p = (x: Palette | null, mode: 'light' | 'dark') => x ?? STOCK[mode];
  return JSON.stringify(
    {
      format: FORMAT,
      name: t.name,
      font: {
        family: t.type.family,
        fallback: t.type.fallback,
        weight: t.type.weight,
        boldWeight: t.type.bold,
        boldTextWeight: t.type.boldText,
        axes: t.type.axes,
      },
      layout: {
        size: t.size,
        lineSpacing: t.options.lineSpacing,
        characterSpacing: t.options.charSpacing,
        wordSpacing: t.options.wordSpacing,
        margins: t.options.margins,
        justify: t.options.justify,
        hyphenate: t.options.hyphenate,
        boldText: t.options.boldText,
      },
      light: p(t.light, 'light'),
      dark: p(t.dark, 'dark'),
    },
    null,
    2,
  );
}

const clamp = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const SANS =
  /sans|grotesk|grotesque|gothic|inter|helvetica|arial|figtree|manrope|mulish|nunito|jakarta|montserrat|lato|roboto|ubuntu|cantarell|noto sans|dejavu sans|liberation sans/i;

/** Reads a theme file (or pasted text, a code fence around it is fine). Out-of-range
 *  numbers are clamped and colours too faint to read are darkened; each repair is noted. */
export function parseTheme(text: string): { theme: Theme; notes: string[] } | { error: string } {
  let j: any;
  const body = text
    .trim()
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/, '');
  try {
    j = JSON.parse(body);
  } catch {
    return { error: 'This is not a theme: it is not valid JSON.' };
  }
  if (!j || typeof j !== 'object') return { error: 'This is not a theme.' };
  if (j.format && j.format !== FORMAT)
    return { error: `This theme is in a format this version does not read (${String(j.format)}).` };
  const notes: string[] = [];
  const f = j.font ?? {},
    l = j.layout ?? {};
  const family = typeof f.family === 'string' && f.family.trim() ? f.family.trim().slice(0, 80) : 'Literata';
  const fallback: 'serif' | 'sans' =
    f.fallback === 'sans' || f.fallback === 'serif' ? f.fallback : SANS.test(family) ? 'sans' : 'serif';
  const weight = clamp(f.weight, 200, 800, 400);
  const axes: Record<string, number> = {};
  if (f.axes && typeof f.axes === 'object')
    for (const [k, v] of Object.entries(f.axes))
      if (/^[A-Za-z0-9 ]{4}$/.test(k) && k !== 'wght' && k !== 'opsz' && typeof v === 'number') axes[k] = v;
  const type: TypeSpec = {
    family,
    fallback,
    weight,
    bold: clamp(f.boldWeight, weight + 100, 1000, Math.min(900, weight + 250)),
    boldText: clamp(f.boldTextWeight, weight, 900, Math.min(900, weight + 100)),
    axes,
  };
  const options: Options = {
    boldText: l.boldText === true,
    lineSpacing: clamp(l.lineSpacing, 1, 2, 1.2),
    charSpacing: Math.round(clamp(l.characterSpacing, -10, 10, 0)),
    wordSpacing: Math.round(clamp(l.wordSpacing, -50, 50, 0)),
    margins: Math.round(clamp(l.margins, -10, 10, 0)),
    justify: l.justify !== false,
    hyphenate: l.hyphenate !== false,
  };
  const pal = (x: any, mode: 'light' | 'dark'): Palette => {
    const s = STOCK[mode];
    const hex = (v: unknown, d: string) => (typeof v === 'string' && hexToRgb(v) ? v.toLowerCase() : d);
    const paper = hex(x?.paper, s.paper);
    let ink = hex(x?.ink, s.ink),
      accent = hex(x?.accent, s.accent);
    if (contrast(paper, ink) < 7) {
      ink = fitContrast(paper, ink, 7, 21);
      notes.push(`The ${mode} ink was too faint on its paper; it is now ${mode === 'dark' ? 'lighter' : 'darker'}.`);
    }
    if (contrast(paper, accent) < 3) {
      accent = fitContrast(paper, accent, 3.2, 21);
      notes.push(`The ${mode} accent was hard to see; it is now stronger.`);
    }
    return { paper, ink, accent };
  };
  const name = typeof j.name === 'string' && j.name.trim() ? j.name.trim().slice(0, 40) : 'Untitled';
  const size = Math.round(clamp(l.size, 12, 22, 13));
  const theme: Theme = {
    id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name,
    size,
    type,
    options,
    light: pal(j.light, 'light'),
    dark: pal(j.dark, 'dark'),
  };
  return { theme, notes };
}

/** A brief another AI can follow to design a theme this app imports as it is. */
export function aiBrief(installed: string[] = []): string {
  const fonts = bundledFamilies().join(', ');
  return `Design a reading theme for an e-book reader. Reply with one JSON object and nothing else, in exactly this format:

{
  "format": "${FORMAT}",
  "name": "Short name, at most 24 characters",
  "font": {
    "family": "a font family name (see below)",
    "fallback": "serif" or "sans" (which kind the family is),
    "weight": body weight 300–500,
    "boldWeight": weight of bold and headings, 550–800,
    "boldTextWeight": body weight when the reader turns on Bold Text, 450–600,
    "axes": {} or variable-font axes other than wght and opsz, e.g. { "SOFT": 50 }
  },
  "layout": {
    "size": the type size on a phone, 13–18 (13 for a face of usual proportions, more for one with small letters or a lighter mood),
    "lineSpacing": 1.15–1.6 (1.2 suits most book faces),
    "characterSpacing": integer percent of the size, -2 to 6 (usually 0),
    "wordSpacing": integer percent of the size, -4 to 20 (usually 0),
    "margins": integer -10 to 10 (0 is a tenth of the page each side; higher is wider margins, a shorter line),
    "justify": true (justified and hyphenated reads best; false only for a deliberately ragged look),
    "hyphenate": true (false only for a deliberately unbroken look),
    "boldText": false (true only for a deliberately heavy theme)
  },
  "light": { "paper": "#rrggbb", "ink": "#rrggbb", "accent": "#rrggbb" },
  "dark":  { "paper": "#rrggbb", "ink": "#rrggbb", "accent": "#rrggbb" }
}

Rules:
- The family must be one the reader has. Shipped with the app: ${fonts}.${installed.length ? `\n- Also installed on this computer: ${installed.slice(0, 400).join(', ')}.` : ''}
- Ink on paper needs a contrast ratio of at least 7:1 and should stay under about 15:1; pure black on pure white is harsh for long reading.
- Paper should be quiet: low saturation. The accent marks headings, highlights and controls and needs at least 3:1 on the paper.
- The dark palette is the same theme by night, not an inversion: a dim, slightly warm or cool paper with soft, light ink.
- Give the theme a mood and let every number serve it.`;
}
