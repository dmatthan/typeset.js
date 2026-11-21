/** The keys of a book being read, the same wherever the reader is shown (the app, another
 *  site's page), less what that page has turned off (`features`). Each shell handles the
 *  keys only it has (the library, quitting) around these. Every key is listed in Help. */
import { features, fullscreenBy, tellPage, type Features } from '../core/embed';
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

/** The reader's own keys (beyond those of turning and choosing, the page's: input.ts),
 *  what each does and the feature it needs. A letter in either case. */
const KEYS: Partial<Record<string, { need?: keyof Features; run: (k: Keyed) => void }>> = {
  m: { need: 'contents', run: k => k.contents.open() },
  b: { need: 'highlights', run: k => k.reader.toggleBookmark() },
  ']': { run: k => k.contents.chapter(1) },
  '[': { run: k => k.contents.chapter(-1) },
  s: { need: 'settings', run: () => (ui.sheet = 'settings') },
  '?': { run: () => (ui.sheet = 'help') },
  '/': { need: 'find', run: openFind },
  v: { need: 'highlights', run: k => k.reader.cursor.start() },
  c: { need: 'settings', run: k => cycleLayout(k.reader) },
};

/** A key while a book is read: true if it was the reader's (its default is then
 *  prevented). In order: a field's keys are its own (Escape leaves it); full screen; an
 *  open sheet, the contents and the selection's menu take their own; then the page's
 *  (turning, choosing a paragraph); then the reader's (`KEYS`). */
export function readerKey(e: KeyboardEvent, k: Keyed): boolean {
  if (e.metaKey || e.altKey) return false;
  if (e.ctrlKey) {
    const find = (e.key === 'f' || e.key === 'F') && ui.view === 'reader';
    if (find) openFind(k);
    return find;
  }
  if (typing(e.target)) {
    if (e.key !== 'Escape') return false;
    (e.target as HTMLElement).blur(); k.reader.stage?.focus({ preventScroll: true });
    return true;
  }
  if (e.key === 'F11' || (e.key === 'f' && !ui.sheet)) { toggleFull(); return true; }
  if (ui.sheet || ui.view !== 'reader') return false;
  if (ui.contents) return k.contents.key(e);
  if (ui.chip) return !!k.chip?.key(e);
  if (k.reader.input.key(e)) return true;
  const key = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!key || (key.need && !features[key.need])) return false;
  key.run(k);
  return true;
}
