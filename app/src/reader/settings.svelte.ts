/** The reader's settings (size, columns, theme, appearance, motion), kept as what differs
 *  from the defaults. */
import { kv } from '../core/kv';

export type Appearance = 'auto' | 'light' | 'dark';
/** Columns in focus: a number, or 'auto' for as many as fit. */
export type Layout = 'auto' | 1 | 2 | 3;
export interface Settings {
  /** Steps of the size control from the theme's own size (`sizeOf`): carried from theme
   *  to theme, each keeping its own size. */
  step: number;
  layout: Layout;
  /** The theme's id (themes.svelte.ts); its own options live with it. */
  theme: string;
  appearance: Appearance;
  motion: 'system' | 'reduce';
}
/** The sizes the size control steps through. */
export const SIZES = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28];
/** The size the text is set at: the theme's own (a phone's: `Theme.size`), three steps up
 *  on a larger screen, then the reader's steps, within the scale. The screen is the
 *  device's (how far away it is read), not the window's: a book in a narrow box on a
 *  desktop's page is read from a desktop's distance. Only the layout asks (`metrics`,
 *  which keeps it as `M.fs`). */
export function sizeOf(themeSize: number, step = settings.step): number {
  const larger = typeof screen !== 'undefined' && Math.min(screen.width, screen.height) >= 600 ? 3 : 0;
  const i = SIZES.findIndex(s => s >= themeSize);
  return SIZES[Math.max(0, Math.min(SIZES.length - 1, (i < 0 ? SIZES.length - 1 : i) + larger + step))];
}
/** (less motion unless asked for: a key or a tap turns the page at once, as a book's page
 *  is simply there; a hand's drag still carries, and "Less motion" off follows the system) */
export const DEFAULTS: Settings = { step: 0, layout: 'auto', theme: 'book', appearance: 'auto', motion: 'reduce' };

/** Settings are stored as the changes from DEFAULTS, so "reset" is deleting them; a
 *  setting that no longer exists is left behind as they load. */
const stored = Object.entries(kv.get<Partial<Settings>>('settings', {})).filter(([k]) => k in DEFAULTS);
export const settings: Settings = $state({ ...DEFAULTS, ...Object.fromEntries(stored) });

export function save() {
  const diff: Partial<Settings> = {};
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[])
    if (settings[k] !== DEFAULTS[k]) (diff as any)[k] = settings[k];
  kv.set('settings', diff);
}
export const reduceMotion = () =>
  settings.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
