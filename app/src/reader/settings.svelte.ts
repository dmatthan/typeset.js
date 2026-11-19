import { kv } from '../core/kv';

export type Appearance = 'auto' | 'light' | 'dark';
/** Columns in focus: a number, or 'auto' for as many as fit. */
export type Layout = 'auto' | 1 | 2 | 3;
export interface Settings {
  /** Body size in px before the theme's size adjustment; null picks one for the screen. */
  size: number | null;
  layout: Layout;
  /** The theme's id (themes.svelte.ts); its own options live with it. */
  theme: string;
  appearance: Appearance;
  motion: 'system' | 'reduce';
}
/** The sizes the size control steps through. */
export const SIZES = [15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28];
export const DEFAULTS: Settings = { size: null, layout: 'auto', theme: 'book', appearance: 'auto', motion: 'system' };

/** Settings are stored as the changes from DEFAULTS, so "reset" is deleting them; a
 *  setting that no longer exists is left behind as they load. */
const stored = Object.entries(kv.get<Partial<Settings>>('settings', {})).filter(([k]) => k in DEFAULTS);
export const settings: Settings = $state({ ...DEFAULTS, ...Object.fromEntries(stored) });

export function save() {
  const diff: Partial<Settings> = {};
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) if (settings[k] !== DEFAULTS[k]) (diff as any)[k] = settings[k];
  kv.set('settings', diff);
}
export const reduceMotion = () => settings.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
