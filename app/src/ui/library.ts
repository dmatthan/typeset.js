/** What the library does with its books, apart from showing them (Library.svelte). */
import type { Core, LibEntry } from '../core/types';
import { kv } from '../core/kv';
import { backup, restore, isBackup } from '../core/backup';
import { isTauri, shell } from '../core/shell';
import { isSafari, isInstalled } from '../core/env';
import { embedded } from '../core/embed';
import { syncShares, hasVault, sharedOf, service, withdraw, fetchNotes } from '../core/service';
import { ui, toast } from '../state.svelte';
import { forgetBookState } from '../reader/bookstate';
import { earlierDraft } from '../reader/draft';
import { parseNotes, receive } from '../reader/feedback';
import { hint } from '../reader/hints';
import { takeNotes as takeNotesIn } from '../reader/intake';
import { isNotesMarkdown } from '../reader/notesmd';
import { isWebAnno } from '../reader/webanno';
import { stale, reread } from '../reader/reread';
import { addToShelf, forgetBook } from './shelves.svelte';

/** What a book's tile says under its cover: where the reader is in it (not started,
 *  finished), and, on a writer's book, how many readers have sent notes on it. */
export function progressOf(b: LibEntry): string {
  const s = kv.get<{ where: string; done: boolean } | null>('state.' + b.id, null);
  const fb = Object.keys(kv.get<Record<string, unknown>>('fb.' + b.id, {})).length;
  const notes = fb ? ` · notes from ${fb} reader${fb === 1 ? '' : 's'}` : '';
  if (!s) return 'Not started' + notes;
  return (s.done ? 'Finished' : s.where) + notes;
}

/** The books, the one opened last first (one never opened: as when it was added). */
export const byLastOpened = (list: LibEntry[]) => list.sort((a, z) => kv.get<number>('opened.' + z.id, z.added) - kv.get<number>('opened.' + a.id, a.added));
/** A book opened from the library: first in the order, and the one to come back to. */
export function opened(id: string) { kv.set('lastOpened', id); kv.set('opened.' + id, Date.now()); }

/** Notes files taken in (one's own put back on their books, another reader's kept as
 *  feedback on theirs: reader/intake.ts), and what came of them said. */
export async function takeNotes(core: Core, texts: string[], names: string[] = [], readerOpen = false) {
  const { said } = await takeNotesIn(core, texts, await core.library(), undefined, names);
  // (one's own notes put back read their books in the engine; none is open here)
  if (!readerOpen) core.idle?.();
  toast(said, Math.max(5200, said.length * 60));
  ui.libVersion++;
}

/** The whole library in one file (core/backup.ts), saved where the person says. */
export async function backUp(core: Core) {
  toast('Gathering the library…', 8000);
  const b = await backup(core);
  const bytes = new Uint8Array(await b.blob.arrayBuffer());
  const day = new Date().toISOString().slice(0, 10);
  if (await shell.saveBytes(`Volumen library ${day}.vbackup`, bytes)) {
    toast(`Backed up: ${b.books} book${b.books === 1 ? '' : 's'} and everything about them.${b.missing.length ? ` Not their files: ${b.missing.join(', ')} (added before files were kept: add them again).` : ''}`, 6000);
  }
}
/** A library put back from its file, then the app started again (settings, themes and
 *  collections are read as it starts). */
export async function restoreFrom(core: Core, f: File) {
  toast('Restoring the library…', 15000);
  const r = await restore(core, f);
  if (typeof r === 'string') { toast(r, 5200); return; }
  toast(`Restored: ${r.books} book${r.books === 1 ? '' : 's'} added${r.failed.length ? `; could not read ${r.failed.join(', ')}` : ''}. Reloading…`, 4000);
  setTimeout(() => location.reload(), 1600);
}

/** Files given to the library (picked, dropped, a folder's): a backup restores the
 *  library; every other file is a book, put on the collection shown (`shelf`); notes files
 *  are taken in after the books, so a folder holding a manuscript and its readers' notes
 *  is taken whole. The book added last (to focus), and a new draft of a book already here
 *  (to be offered its notes, feedback and share). */
export async function addFiles(core: Core, files: FileList | File[], shelf: string | null, readerOpen: boolean): Promise<{ last?: LibEntry; draft?: { from: LibEntry; to: LibEntry } }> {
  const notes: string[] = [], names: string[] = [];
  let last: LibEntry | undefined, draft: { from: LibEntry; to: LibEntry } | undefined;
  for (const f of files) {
    if (/\.vbackup$/i.test(f.name) || (f.size > 10 && await isBackup(f))) { await restoreFrom(core, f); return {}; }
    if (/\.vnotes$/i.test(f.name)) { notes.push(await f.text()); names.push(f.name); continue; }
    // notes exported as Markdown (rather than a manuscript), or as Web Annotations
    if (/\.(md|markdown|txt|json|jsonld)$/i.test(f.name) && f.size < 8e6) {
      const text = await f.text();
      if (isNotesMarkdown(text) || isWebAnno(text) || /\.(json|jsonld)$/i.test(f.name)) { notes.push(text); names.push(f.name); continue; }
    }
    toast(`Opening ${f.name}…`, 8000);
    try {
      const e = await core.importFile(new Uint8Array(await f.arrayBuffer()), f.name);
      last = e;
      const before = draft ? null : earlierDraft(e, await core.library());
      if (before) draft = { from: before, to: e };
      if (shelf) addToShelf(shelf, e.id);
      toast(`Added “${e.title}”.`, 3600);
      keepLibrary();
    } catch (err) {
      const m = `Couldn’t open ${f.name}: ${(err as Error).message}`;
      toast(m, Math.max(5200, m.length * 70));
    }
  }
  if (notes.length) await takeNotes(core, notes, names, readerOpen);
  return { last, draft };
}

/** A book gone from the library: its link withdrawn first if it is shared (or readers
 *  would go on sending notes to it, and the writer's other devices bring it back), then
 *  its files, what is kept about it, its collections. A link that cannot be withdrawn
 *  (offline, signed out) leaves the book as it was, and the error says why. */
export async function removeBook(core: Core, id: string) {
  if (sharedOf(id) && (await service())) await withdraw(id);
  await core.remove(id);
  forgetBookState(id);
  forgetBook(id);
}

/** The library kept for good: a browser may clear a site's storage when it is short of
 *  room, and Safari clears it after some days unvisited unless the site is installed.
 *  Asked once a book of one's own is added (Firefox asks the person; Chrome and Safari
 *  decide by themselves); where it is not granted in Safari, said once how to keep it. */
let keepAsked = false;
export async function keepLibrary() {
  if (keepAsked || isTauri || embedded || !navigator.storage?.persist) return;
  keepAsked = true;
  if (await navigator.storage.persisted().catch(() => false)) return;
  if (await navigator.storage.persist().catch(() => false)) return;
  if (!isSafari || isInstalled()) return;
  const touch = document.documentElement.classList.contains('touchui');
  setTimeout(() => hint(touch ? 'touch-keep' : 'keep', touch
    ? 'Safari may clear this library if Volumen is not opened for a week or so. To keep it: Share, then Add to Home Screen; or back it up, at the foot of the library.'
    : 'Safari may clear this library if Volumen is not opened for a week or so. To keep it: File, then Add to Dock; or back it up, at the foot of the library.', 9000), 4000);
}

/** Readers' notes on books shared through the service, fetched when the library shows
 *  (at most every few minutes; only for a writer with shared books). */
let collectedAt = 0;
export async function collectSoon(core: Core, titleOf: (id: string) => string) {
  if (Date.now() - collectedAt < 300_000 || (!kv.keys('share.').length && !hasVault())) return;
  collectedAt = Date.now();
  // shares made on the writer's other devices (their vault) first
  const added = await syncShares(core).catch(() => 0);
  if (added) { toast(`${added} shared book${added === 1 ? '' : 's'} from your other devices added to this library.`, 5200); ui.libVersion++; }
  const got = await collectNotes().catch(() => []);
  if (!got.length) return;
  const by = new Map<string, string[]>();
  for (const g of got) by.set(g.book, [...(by.get(g.book) ?? []), g.from]);
  const said = [...by].map(([id, from]) => `${from.join(', ')} on “${titleOf(id)}”`);
  toast(`New notes from your readers: ${said.join('; ')}. Open the book to see them.`, 6400);
  ui.libVersion++;
}

/** Books read by an earlier importer are read again from their kept files, one at a time,
 *  once a session, never the one open (reader/reread.ts). */
let rereading = false, rereadDone = false;
export async function rereadStale(core: Core, list: LibEntry[], openId: () => string | undefined) {
  if (rereading || rereadDone) return;
  const todo = list.filter(b => stale(b) && b.source);
  if (!todo.length) return;
  rereading = true;
  let n = 0;
  for (const b of todo) {
    if (openId() === b.id) continue;
    try { await reread(core, b); n++; } catch { /* left as it was: tried again next session */ }
    if (openId()) break;
  }
  if (!openId()) core.idle?.();
  rereading = false; rereadDone = true;
  if (n) { toast(n === 1 ? 'A book was read again with what Volumen now understands of it.' : `${n} books were read again with what Volumen now understands of them.`, 4200); ui.libVersion++; }
}

/** Readers' notes from the sharing service, kept as feedback on their books. What came,
 *  per book and reader. */
export async function collectNotes(): Promise<{ book: string; from: string; notes: number }[]> {
  const out: { book: string; from: string; notes: number }[] = [];
  for (const { book, text } of await fetchNotes()) {
    const files = parseNotes(text);
    if (typeof files === 'string') continue;
    for (const f of files) {
      receive({ ...f, book: { ...f.book, id: book } }, book);
      out.push({ book, from: f.from.name || 'A reader', notes: f.notes.length });
    }
  }
  return out;
}
