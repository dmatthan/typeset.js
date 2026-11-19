/** The keys of a book being read, the same wherever the reader is shown (the app, another
 *  site's page), less what that page has turned off (`features`). Each shell handles the
 *  keys only it has (the library, quitting) around these. Every key is listed in Help. */
import { features } from '../core/embed';
import { shell } from '../core/shell';
import type { MapCtl } from '../reader/map.svelte';
import type { Reader } from '../reader/reader.svelte';
import { settings, save, type Layout } from '../reader/settings.svelte';
import { ui, toast } from '../state.svelte';

/** What the keys act on: the reader, its map, and the parts of the page that take keys
 *  of their own while they show. */
export interface Keyed {
  reader: Reader;
  map: MapCtl;
  chip?: { key(e: KeyboardEvent): boolean };
  findBar?: { refocus(): void };
}

/** Focus is in a field: its keys are its own. */
export const typing = (t: EventTarget | null) => !!(t as Element)?.closest?.('textarea, input:not([type=checkbox]):not([type=radio]), select, [contenteditable]');

export function openFind(k: Keyed) {
  if (!features.find) return;
  ui.sheet = null; ui.chip = null;
  if (k.reader.finder.open) k.findBar?.refocus(); else k.reader.finder.show();
}

const ORDER: Layout[] = ['auto', 1, 2, 3];
const NAMES = ['one column', 'two columns', 'three columns'];
async function cycleLayout(reader: Reader) {
  settings.layout = ORDER[(ORDER.indexOf(settings.layout) + 1) % ORDER.length];
  save();
  await reader.settingsChanged('layout');
  const name = NAMES[ui.cols - 1];
  toast(settings.layout === 'auto' ? `Auto: ${name}` : ui.colsReduced ? `${NAMES[(settings.layout as number) - 1]} need a wider window: ${name}` : name[0].toUpperCase() + name.slice(1));
}

/** A key while a book is read: true if it was the reader's (its default is then
 *  prevented). */
export function readerKey(e: KeyboardEvent, k: Keyed): boolean {
  const { reader, map } = k;
  if (e.metaKey || e.altKey) return false;
  if (e.ctrlKey) {
    if ((e.key === 'f' || e.key === 'F') && ui.view === 'reader') { if (ui.mapOpen) map.focusFind(); else openFind(k); return true; }
    return false;
  }
  if (typing(e.target)) {
    if (e.key === 'Escape') { (e.target as HTMLElement).blur(); reader.stage?.focus({ preventScroll: true }); return true; }
    return false;
  }
  if (e.key === 'F11' || (e.key === 'f' && !ui.sheet)) { shell.toggleFullscreen(); return true; }
  // the open sheet, the map and the chip handle their own keys
  if (ui.sheet || ui.view !== 'reader') return false;
  if (ui.mapOpen) return map.key(e);
  if (ui.chip) return !!k.chip?.key(e);
  if (reader.input.key(e)) return true;
  switch (e.key) {
    case 'm': case 'M': if (!features.map) return false; map.open(); return true;
    case 's': case 'S': if (!features.settings) return false; ui.sheet = 'settings'; return true;
    case '?': ui.sheet = 'help'; return true;
    case '/': if (!features.find) return false; openFind(k); return true;
    case 'v': case 'V': if (!features.highlights) return false; reader.cursor.start(); return true;
    case 'c': case 'C': cycleLayout(reader); return true;
  }
  return false;
}
