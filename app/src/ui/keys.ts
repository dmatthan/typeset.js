/** The keys of a book being read, the same wherever the reader is shown (the app, another
 *  site's page), less what that page has turned off (`features`). Each shell handles the
 *  keys only it has (the library, quitting) around these. Every key is listed in Help. */
import { embedded, embedOpts, features, tellPage, type Features } from '../core/embed';
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
export const typing = (t: EventTarget | null) =>
  !!(t as Element)?.closest?.('textarea, input:not([type=checkbox]):not([type=radio]), select, [contenteditable]');

/** A book on another site's page, one step bigger (its corner's control, F): from its box,
 *  the page's window (the page fills it with the book); from there, the screen (the
 *  browser's full screen, the frame's own, where it has one: an iPhone's frames have none);
 *  from the screen, back to the window. The app: the system's full screen. */
export function bigger() {
  if (!embedded) {
    shell.toggleFullscreen();
    return;
  }
  if (ui.place === 'box') tellPage('expand');
  else if (ui.place === 'screen' || document.fullscreenEnabled) shell.toggleFullscreen();
}
/** What the corner's control would do, named; none where it can do nothing. */
export function biggerName(): string | null {
  if (!embedded || embedOpts.ui !== 'full') return null;
  return ui.place === 'box'
    ? 'Expand'
    : ui.place === 'screen'
      ? 'Leave full screen'
      : document.fullscreenEnabled
        ? 'Full screen'
        : null;
}
/** Out to the page, from any height in one step (× Close): the screen left, the book back
 *  in its box (or, opened over the page, gone). */
export function closeOut() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  tellPage('close');
}

export function openFind(k: Keyed) {
  if (!features.find) return;
  k.contents.close();
  ui.sheet = null;
  ui.chip = null;
  if (k.reader.finder.open) k.findBar?.refocus();
  else k.reader.finder.show();
}

const ORDER: Layout[] = ['auto', 1, 2, 3];
const NAMES = ['one column', 'two columns', 'three columns'];
async function cycleLayout(reader: Reader) {
  settings.layout = ORDER[(ORDER.indexOf(settings.layout) + 1) % ORDER.length];
  save();
  await reader.settingsChanged('layout');
  const name = NAMES[ui.cols - 1];
  toast(
    settings.layout === 'auto'
      ? `Auto: ${name}`
      : ui.colsReduced
        ? `${NAMES[(settings.layout as number) - 1]} need a wider window: ${name}`
        : name[0].toUpperCase() + name.slice(1),
  );
}

/** The reader's own keys (beyond those of turning and choosing, the page's: input.ts),
 *  what each does and the feature it needs. A letter in either case. */
const KEYS: Partial<Record<string, { need?: keyof Features; run: (k: Keyed) => void }>> = {
  m: { need: 'contents', run: k => k.contents.open() },
  b: { need: 'highlights', run: k => k.reader.bookmarks.toggle() },
  Backspace: { run: k => k.reader.goBack() },
  ']': { run: k => k.contents.chapter(1) },
  '[': { run: k => k.contents.chapter(-1) },
  s: { need: 'settings', run: () => (ui.sheet = 'settings') },
  '?': { need: 'help', run: () => (ui.sheet = 'help') },
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
    (e.target as HTMLElement).blur();
    k.reader.stage?.focus({ preventScroll: true });
    return true;
  }
  if (features.fullscreen && (e.key === 'F11' || (e.key === 'f' && !ui.sheet))) {
    bigger();
    return true;
  }
  if (ui.sheet || ui.view !== 'reader') return false;
  if (ui.contents) return k.contents.key(e);
  if (ui.chip) return !!k.chip?.key(e);
  if (k.reader.input.key(e)) return true;
  // (with nothing else to put away, Escape a step down: the window back to its box)
  if (e.key === 'Escape' && embedded && ui.place === 'window') {
    closeOut();
    return true;
  }
  const key = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!key || (key.need && !features[key.need])) return false;
  key.run(k);
  return true;
}
