/** The keys of a book being read, the same wherever the reader is shown (the app, another
 *  site's page), less what that page has turned off (`features`). Each shell handles the
 *  keys only it has (the library, quitting) around these. Every key is listed in Help. */
import { features, fullscreenBy, tellPage } from '../core/embed';
import { shell } from '../core/shell';
import type { Contents } from '../reader/contents.svelte';
import type { Reader } from '../reader/reader.svelte';
import { settings, save, type Layout } from '../reader/settings.svelte';
import { ui, toast } from '../state.svelte';

/** What the keys act on: the reader, its contents, and the parts of the page that take
 *  keys of their own while they show. */
export interface Keyed {
  reader: Reader;
  contents: Contents;
  chip?: { key(e: KeyboardEvent): boolean };
  findBar?: { refocus(): void };
}

/** Focus is in a field: its keys are its own. */
export const typing = (t: EventTarget | null) => !!(t as Element)?.closest?.('textarea, input:not([type=checkbox]):not([type=radio]), select, [contenteditable]');

/** Full screen and back: the browser's own (the window, or a book's frame on another
 *  site's page), or the page asked to fill its window with the book where a frame has no
 *  full screen of its own (core/embed.ts, `fullscreenBy`). */
export function toggleFull() {
  if (fullscreenBy() === 'page') { ui.full = !ui.full; tellPage('full', { on: ui.full }); }
  else shell.toggleFullscreen();
}

export function openFind(k: Keyed) {
  if (!features.find) return;
  k.contents.close();
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
  const { reader, contents } = k;
  if (e.metaKey || e.altKey) return false;
  if (e.ctrlKey) {
    if ((e.key === 'f' || e.key === 'F') && ui.view === 'reader') { openFind(k); return true; }
    return false;
  }
  if (typing(e.target)) {
    if (e.key === 'Escape') { (e.target as HTMLElement).blur(); reader.stage?.focus({ preventScroll: true }); return true; }
    return false;
  }
  if (e.key === 'F11' || (e.key === 'f' && !ui.sheet)) { toggleFull(); return true; }
  // the open sheet, the contents and the chip handle their own keys
  if (ui.sheet || ui.view !== 'reader') return false;
  if (ui.contents) return contents.key(e);
  if (ui.chip) return !!k.chip?.key(e);
  if (reader.input.key(e)) return true;
  switch (e.key) {
    case 'm': case 'M': if (!features.contents) return false; contents.open(); return true;
    case 'b': case 'B': if (!features.highlights) return false; reader.toggleBookmark(); return true;
    case ']': contents.chapter(1); return true;
    case '[': contents.chapter(-1); return true;
    case 's': case 'S': if (!features.settings) return false; ui.sheet = 'settings'; return true;
    case '?': ui.sheet = 'help'; return true;
    case '/': if (!features.find) return false; openFind(k); return true;
    case 'v': case 'V': if (!features.highlights) return false; reader.cursor.start(); return true;
    case 'c': case 'C': if (!features.settings) return false; cycleLayout(reader); return true;
  }
  return false;
}
