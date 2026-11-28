<script lang="ts">
  /** The library: the shelves of books, searching them, and each book's sheet. */
  import { touchUI } from './touch';
  import { coverThumb } from './thumb';
  import { fitImage, fitTitle } from './covers';
  import ShareSheet from './ShareSheet.svelte';
  import InviteSheet from './InviteSheet.svelte';
  import DraftSheet from './DraftSheet.svelte';
  import EpubSheet from './EpubSheet.svelte';
  import { droppedFiles } from './files';
  import { stale } from '../reader/reread';
  import {
    removeBook,
    collectSoon,
    rereadStale,
    progressOf,
    byLastOpened,
    opened,
    takeNotes,
    backUp,
    restoreFrom,
    addFiles,
  } from './library';
  import { sharedOf } from '../core/service';
  import type { Core, LibEntry } from '../core/types';
  import { kv } from '../core/kv';
  import { type Reader } from '../reader/reader.svelte';
  import { ui, toast } from '../state.svelte';
  import Sheet from './Sheet.svelte';
  import Help from './Help.svelte';
  import LibraryNotebook from './LibraryNotebook.svelte';
  import LibraryResults from './LibraryResults.svelte';
  import { fold } from '../reader/notebook';
  import {
    SMART,
    shelves,
    loadShelves,
    onShelf,
    createShelf,
    renameShelf,
    deleteShelf,
    toggleShelf,
    addToShelf,
  } from './shelves.svelte';

  let { core, reader, hidden }: { core: Core; reader: Reader; hidden: boolean } = $props();
  let books: LibEntry[] = $state([]);
  let grid: HTMLElement;
  let file: HTMLInputElement;
  let removing: LibEntry | null = $state(null);
  let sharing: LibEntry | null = $state(null);
  let draftOf: { from: LibEntry; to: LibEntry } | null = $state(null);
  let epubOf: LibEntry | null = $state(null);
  /** The shelf shown: one that fills itself, or a collection. */
  loadShelves();
  let shelf = $state(kv.get<string>('shelf', 'all'));
  if (!SMART.some(x => x.id === shelf) && !shelves.list.some(c => c.id === shelf)) shelf = 'all';
  const allShelves = $derived([...SMART, ...shelves.list]);
  /** A search: the books whose title or author has every word, across the library, and
   *  the matches in their text beneath (LibraryResults). */
  let query = $state('');
  let searchEl: HTMLInputElement | undefined = $state();
  let results: LibraryResults | undefined = $state();
  const words = $derived(fold(query).split(/\s+/).filter(Boolean));
  const shown = $derived(
    words.length
      ? books.filter(b => {
          const h = fold(`${b.title} ${b.author}`);
          return words.every(w => h.includes(w));
        })
      : books.filter(b => onShelf(shelf, b)),
  );
  function searchKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // the first Esc clears the search, the next leaves the field
      e.preventDefault();
      e.stopPropagation();
      if (query) query = '';
      else {
        searchEl?.blur();
        restoreFocus();
      }
    } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const first = grid.querySelector<HTMLElement>('.slot .book');
      if (first && shown.length) first.focus();
      else results?.focusFirst();
    }
  }
  const mine = $derived(shelves.list.find(c => c.id === shelf) ?? null);
  function setShelf(id: string) {
    shelf = id;
    kv.set('shelf', id);
    requestAnimationFrame(restoreFocus);
  }
  function stepShelf(d: number) {
    const i = allShelves.findIndex(x => x.id === shelf);
    setShelf(allShelves[(i + d + allShelves.length) % allShelves.length].id);
  }
  /** The book whose sheet is open (its collections, removing it). */
  let sheetBook: LibEntry | null = $state(null);
  let newName = $state('');
  function bookSheet(b: LibEntry) {
    sheetBook = b;
    newName = '';
    ui.sheet = 'book';
  }
  function addNew(b: LibEntry) {
    const c = createShelf(newName);
    if (c) {
      addToShelf(c.id, b.id);
      newName = '';
      toast(`In “${c.name}”.`);
    }
  }
  let renaming = $state('');
  /** Books, or every book's notebook. */
  let view: 'books' | 'notebook' = $state('books');
  let notebook: LibraryNotebook | undefined = $state();
  function setView(v: typeof view) {
    view = v;
    if (v === 'books') requestAnimationFrame(restoreFocus);
  }
  let dropping = $state(false);
  let focusId: string | null = kv.get('lastOpened', null);
  /** Cover images as object URLs, loaded once per book. */
  let covers: Record<string, string> = $state({});
  const loading = new Set<string>();
  function loadCovers(list: LibEntry[]) {
    for (const b of list) {
      if (!b.cover || covers[b.id] || loading.has(b.id)) continue;
      loading.add(b.id);
      core.cover(b.id).then(async buf => {
        if (!buf.byteLength) return;
        // a large cover is drawn down once and kept small (ui/thumb.ts)
        const small = await coverThumb(buf);
        if (small) core.setCover(b.id, await small.arrayBuffer()).catch(() => {});
        covers[b.id] = URL.createObjectURL(small ?? new Blob([buf]));
      });
    }
  }

  async function load() {
    const list = await core.library();
    loadCovers(list);
    books = byLastOpened(list);
    rereadStale(core, list, () => reader.book?.id);
    collectSoon(core, id => books.find(b => b.id === id)?.title ?? 'a book');
  }

  $effect(() => {
    ui.libVersion;
    load().then(() => {
      if (!hidden) restoreFocus();
    });
  });
  $effect(() => {
    if (!hidden) requestAnimationFrame(restoreFocus);
  });

  function restoreFocus() {
    // (not from under an open sheet: it keeps the focus)
    if (ui.sheet) return;
    const el =
      (focusId && grid?.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusId)}"]`)) ||
      grid?.querySelector<HTMLElement>('.book');
    el?.focus({ preventScroll: false });
  }

  function hue(b: LibEntry) {
    let h = 0;
    for (const ch of b.title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 360;
  }

  function open(b: LibEntry) {
    focusId = b.id;
    opened(b.id);
    reader.open(b.id);
  }

  /** Files given to the library (library.ts's `addFiles`): the last book added focused, a
   *  new draft offered its notes (one offer at a time). */
  async function take(files: FileList | File[]) {
    const r = await addFiles(core, files, mine?.id ?? null, !!reader.book);
    if (r.last) focusId = r.last.id;
    if (r.draft && !draftOf) draftOf = r.draft;
    if (draftOf) ui.sheet = 'draft';
    await load();
    restoreFocus();
  }

  function add() {
    if (core.pick) {
      core
        .pick()
        .then(async p => {
          if (p?.kind === 'notes') {
            takeNotes(core, [p.text], [], !!reader.book);
            return;
          }
          if (p?.kind === 'backup') {
            restoreFrom(core, p.file as File);
            return;
          }
          const e = p?.entry;
          if (e) {
            focusId = e.id;
            if (mine) addToShelf(mine.id, e.id);
            toast(`Added “${e.title}”.`, 3600);
            await load();
            restoreFocus();
          }
        })
        .catch(err => toast(`Couldn’t open it: ${(err as Error).message}`, 5200));
    } else file.click();
  }

  async function remove(b: LibEntry) {
    removing = null;
    try {
      await removeBook(core, b.id);
    } catch (e) {
      toast(`Couldn’t withdraw the link (${(e as Error).message}). The book was kept.`, 6000);
      return;
    }
    toast('Removed from the library.');
    await load();
    restoreFocus();
  }

  /** Moving through the grid: arrows and hjkl, by one book or by a row. */
  const MOVES: Partial<Record<string, (i: number, row: number) => number>> = {
    ArrowRight: i => i + 1,
    l: i => i + 1,
    ArrowLeft: i => i - 1,
    h: i => i - 1,
    ArrowDown: (i, r) => i + r,
    j: (i, r) => i + r,
    ArrowUp: (i, r) => i - r,
    k: (i, r) => i - r,
  };

  /** The library's keys (a letter in either case): N the notebook and back; in the
   *  notebook, its own; else ? Help, O add a book, / search, [ ] the shelves, then the
   *  grid's (`gridKey`). Every one is listed in Help. */
  export function key(e: KeyboardEvent): boolean {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'n') {
      setView(view === 'books' ? 'notebook' : 'books');
      return true;
    }
    if (view === 'notebook') {
      if (k === 'Escape' || k === 'b') {
        setView('books');
        return true;
      }
      if (k === '?') {
        ui.sheet = 'help';
        return true;
      }
      return notebook?.key(e) ?? false;
    }
    if (k === '?') ui.sheet = 'help';
    else if (k === 'o') add();
    else if (k === '/') {
      searchEl?.focus();
      searchEl?.select();
    } else if ((document.activeElement as Element)?.closest?.('.res')) return results?.key(e) ?? false;
    else if (k === ']' || k === '[') stepShelf(k === ']' ? 1 : -1);
    else return gridKey(k);
    return true;
  }

  /** In the grid: the moves (from nowhere, to the first book), and the focused book's A
   *  (its collections) and X (remove it). */
  function gridKey(k: string): boolean {
    const items = [...grid.querySelectorAll<HTMLElement>('.book')],
      i = items.indexOf(document.activeElement as HTMLElement);
    const move = MOVES[k];
    if (i < 0) {
      if (move) items[0]?.focus();
      return !!move;
    }
    const b = books.find(x => x.id === items[i].dataset.id);
    if (k === 'a' && b) bookSheet(b);
    else if ((k === 'x' || k === 'Delete') && b) {
      removing = b;
      ui.sheet = 'remove';
    } else if (move) {
      const top0 = items[0].getBoundingClientRect().top;
      const row = Math.max(1, items.filter(x => Math.abs(x.getBoundingClientRect().top - top0) < 2).length);
      items[Math.max(0, Math.min(items.length - 1, move(i, row)))].focus();
    } else return false;
    return true;
  }
</script>

<section
  class="shelf"
  {hidden}
  aria-label="Library"
  ondragover={e => {
    e.preventDefault();
    dropping = true;
  }}
  ondragleave={() => (dropping = false)}
  ondrop={e => {
    e.preventDefault();
    dropping = false;
    if (e.dataTransfer?.items.length) droppedFiles(e.dataTransfer).then(take);
  }}
  class:dropping
>
  <header class="head">
    <div class="title">
      <h1>Library</h1>
      <div class="seg" role="group" aria-label="Show">
        <button aria-pressed={view === 'books'} onclick={() => setView('books')}>Books</button>
        <button aria-pressed={view === 'notebook'} onclick={() => setView('notebook')}>Notebook</button>
      </div>
    </div>
    <div class="head-acts">
      {#if view === 'books'}
        <label class="search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
          <input
            bind:this={searchEl}
            type="search"
            bind:value={query}
            onkeydown={searchKey}
            placeholder="Search books and their text"
            aria-label="Search the library"
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        <button class="btn add-btn" onclick={add} aria-label="Add a book (O)"
          ><span class="add-l">Add a book</span><span class="add-p" aria-hidden="true">+</span></button
        >
      {/if}
      <button class="btn quiet keys-only" onclick={() => (ui.sheet = 'help')} aria-label="Keyboard shortcuts"
        >Keys</button
      >
    </div>
  </header>
  {#if view === 'notebook'}
    <LibraryNotebook bind:this={notebook} {books} {reader} />
  {/if}
  {#if view === 'books'}
    <div class="shelves" class:off={words.length > 0} role="tablist" aria-label="Shelves ( [ and ] )">
      {#each allShelves as x (x.id)}
        <button
          role="tab"
          aria-selected={shelf === x.id}
          class:own={!SMART.some(m => m.id === x.id)}
          disabled={words.length > 0}
          onclick={() => setShelf(x.id)}>{x.name}</button
        >
      {/each}
      {#if mine}
        <span class="sh-acts">
          <button
            class="btn quiet"
            onclick={() => {
              renaming = mine.name;
              ui.sheet = 'shelf';
            }}>Rename or delete…</button
          >
        </span>
      {/if}
    </div>
  {/if}
  <div class="books" bind:this={grid} hidden={view !== 'books'}>
    {#if words.length && !shown.length}
      <p class="none">No title or author matches “{query.trim()}”.</p>
    {:else if !words.length && !shown.length && shelf !== 'all'}
      <p class="none">
        {mine
          ? `Nothing in “${mine.name}” yet. Press A on a book to put it here, or add a book while this shelf is open.`
          : shelf === 'reading'
            ? 'No book under way.'
            : shelf === 'finished'
              ? 'No book finished yet.'
              : 'Every book has been opened.'}
      </p>
    {/if}
    {#each shown as b (b.id)}
      <div class="slot">
        <button
          class="book"
          data-id={b.id}
          onclick={() => open(b)}
          oncontextmenu={e => {
            e.preventDefault();
            bookSheet(b);
          }}
          aria-label="{b.title}, {progressOf(b)}. A for collections."
        >
          {#if covers[b.id]}
            <div class="cover img lift small" aria-hidden="true">
              <img src={covers[b.id]} alt="" decoding="async" loading="lazy" use:fitImage />
            </div>
          {:else}
            <div class="cover lift small" style="--ch:{hue(b)}" aria-hidden="true" use:fitTitle>
              <span class="c-author">{b.author}</span>
              <span class="c-title">{b.title}</span>
              <span class="c-year">{b.year}</span>
            </div>
          {/if}
          <span class="meta"><span class="t">{b.title}</span><span class="s">{progressOf(b)}</span></span>
        </button>
        <button
          class="more hover-reveal"
          onclick={() => bookSheet(b)}
          aria-label="Collections and more for {b.title} (A)"
          tabindex="-1"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"
            ><circle cx="6" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18" cy="12" r="1.6" /></svg
          >
        </button>
      </div>
    {/each}
    {#if !words.length && (shelf === 'all' || mine)}
      <button class="book add" onclick={add} aria-label="Add a book from an EPUB, Word, Markdown or text file">
        <div class="cover" aria-hidden="true">
          <span class="plus">+</span><span class="c-t">Add a book</span><span class="c-s"
            >EPUB, Word, Markdown or text</span
          >
        </div>
        <span class="meta"><span class="t">&nbsp;</span></span>
      </button>
    {/if}
  </div>
  {#if view === 'books'}<LibraryResults bind:this={results} {core} {reader} {query} {books} />{/if}
  <p class="foot" hidden={view !== 'books'}>
    Books stay on this device. <button class="link-btn" onclick={() => backUp(core)}>Back up the library…</button> (Restore
    one by adding its file.)
  </p>
  <!-- (a phone's picker greys out what it cannot match to a type it knows, notes files
       among them; there every file may be chosen, and the importer says what it is) -->
  <input
    type="file"
    bind:this={file}
    accept={touchUI()
      ? undefined
      : '.epub,.docx,.md,.markdown,.txt,.vnotes,.json,.jsonld,.vbackup,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain'}
    multiple
    onchange={e => {
      const fs = (e.target as HTMLInputElement).files;
      if (fs?.length) take([...fs]);
      (e.target as HTMLInputElement).value = '';
    }}
    hidden
  />
</section>

{#if !hidden && ui.sheet === 'help'}
  <Help onclose={() => (ui.sheet = null)} />
{/if}
{#if !hidden && ui.sheet === 'book' && sheetBook}
  {@const b = sheetBook}
  <!-- a book's sheet: the book, its collections, then what can be done with it (one list,
       as a phone's action sheets have it), Done -->
  <Sheet
    label={b.title}
    onclose={() => {
      ui.sheet = null;
      sheetBook = null;
    }}
    onkey={e => {
      if ((e.target as Element).closest?.('input')) return false;
      const n = +e.key;
      if (n >= 1 && n <= 9 && shelves.list[n - 1]) {
        toggleShelf(shelves.list[n - 1].id, b.id);
        return true;
      }
      if (e.key === 'x' || e.key === 'Delete') {
        removing = b;
        sheetBook = null;
        ui.sheet = 'remove';
        return true;
      }
      return false;
    }}
  >
    <div>
      <h2>{b.title}</h2>
      {#if b.author}<p class="by">{b.author}</p>{/if}
      {#if stale(b) && !b.source}<p class="where">
          Opened by an earlier version. Add the file again to update it.
        </p>{/if}
    </div>
    <div class="cols" role="group" aria-label="Collections">
      <h3>Collections</h3>
      {#each shelves.list as c (c.id)}
        <label class="col-row"
          ><input type="checkbox" checked={c.books.includes(b.id)} onchange={() => toggleShelf(c.id, b.id)} /><span
            class="cn">{c.name}</span
          ></label
        >
      {/each}
      <form
        class="new"
        onsubmit={e => {
          e.preventDefault();
          addNew(b);
        }}
      >
        <input type="text" placeholder="New collection" bind:value={newName} aria-label="New collection" />
        <button class="btn" type="submit" disabled={!newName.trim()}>Add</button>
      </form>
    </div>
    <div class="actions" role="group" aria-label="Actions">
      <button
        onclick={() => {
          sharing = b;
          sheetBook = null;
          ui.sheet = 'share';
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M6 12v7h12v-7" /></svg>Share as a link…
      </button>
      {#if b.source}<button
          onclick={() => {
            epubOf = b;
            sheetBook = null;
            ui.sheet = 'epub';
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M8 11l4 4 4-4M5 19h14" /></svg>Save as EPUB…
        </button>{/if}
      <button
        class="danger"
        onclick={() => {
          removing = b;
          sheetBook = null;
          ui.sheet = 'remove';
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg>Remove from
        library…
      </button>
    </div>
    <div class="acts">
      <button
        class="btn primary"
        data-autofocus
        onclick={() => {
          ui.sheet = null;
          sheetBook = null;
        }}>Done</button
      >
    </div>
  </Sheet>
{/if}
{#if !hidden && ui.sheet === 'share' && sharing}
  <ShareSheet
    {core}
    book={sharing}
    onclose={() => {
      ui.sheet = null;
      sharing = null;
    }}
  />
{/if}
{#if !hidden && ui.sheet === 'epub' && epubOf}
  <EpubSheet
    {core}
    book={epubOf}
    onclose={() => {
      ui.sheet = null;
      epubOf = null;
    }}
  />
{/if}
{#if !hidden && ui.sheet === 'draft' && draftOf}
  <DraftSheet
    {core}
    from={draftOf.from}
    to={draftOf.to}
    {remove}
    onclose={() => {
      ui.sheet = null;
      draftOf = null;
    }}
  />
{/if}
{#if !hidden && ui.sheet === 'invite' && ui.invite}
  <InviteSheet {core} />
{/if}
{#if !hidden && ui.sheet === 'shelf' && mine}
  {@const c = mine}
  <Sheet label="Collection {c.name}" onclose={() => (ui.sheet = null)}>
    <div>
      <p class="eyebrow">Collection</p>
      <h2>{c.name}</h2>
      <p class="where">
        {c.books.length} book{c.books.length === 1 ? '' : 's'}. Deleting it leaves the books in the library.
      </p>
    </div>
    <form
      class="new"
      onsubmit={e => {
        e.preventDefault();
        renameShelf(c.id, renaming);
        ui.sheet = null;
      }}
    >
      <input type="text" bind:value={renaming} aria-label="Name" data-autofocus />
      <button class="btn" type="submit" disabled={!renaming.trim() || renaming.trim() === c.name}>Rename</button>
    </form>
    <div class="acts two">
      <button
        class="btn quiet"
        onclick={() => {
          deleteShelf(c.id);
          ui.sheet = null;
          setShelf('all');
          toast(`Deleted “${c.name}”.`);
        }}>Delete the collection</button
      >
      <button class="btn primary" onclick={() => (ui.sheet = null)}>Done</button>
    </div>
  </Sheet>
{/if}
{#if !hidden && ui.sheet === 'remove' && removing}
  {@const b = removing}
  <Sheet
    label="Remove a book"
    onclose={() => {
      ui.sheet = null;
      removing = null;
    }}
    onkey={e => {
      if (e.key === 'y' || e.key === 'Enter') {
        ui.sheet = null;
        remove(b);
        return true;
      }
      return false;
    }}
  >
    <div>
      <p class="eyebrow">Remove from the library</p>
      <h2>{b.title}</h2>
      <p class="where">
        Your place, highlights and notes for this book are removed too.{#if sharedOf(b.id)}
          Its link stops working, and readers’ notes waiting for you go with it.{/if}
      </p>
    </div>
    <div class="acts two">
      <button
        class="btn"
        data-autofocus
        onclick={() => {
          ui.sheet = null;
          removing = null;
        }}>Keep it</button
      >
      <button
        class="btn primary"
        onclick={() => {
          ui.sheet = null;
          remove(b);
        }}>Remove</button
      >
    </div>
  </Sheet>
{/if}

<style>
  /* the shelf scrolls down and only down: covers' shadows reach past its sides, and a
     sideways swipe moved it a few pixels to show nothing */
  .shelf {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    overflow-x: hidden;
    touch-action: pan-y;
    background: var(--ground);
    padding: 36px max(20px, 6vw) 56px;
    box-sizing: border-box;
  }
  .shelf.dropping {
    outline: 3px dashed var(--accent);
    outline-offset: -12px;
  }
  .head {
    max-width: 1040px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 32px;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
  }
  .seg {
    display: inline-flex;
    padding: 3px;
    border-radius: var(--r-m);
    background: var(--read);
  }
  .seg button {
    appearance: none;
    border: 0;
    background: none;
    cursor: pointer;
    padding: 8px 14px;
    border-radius: calc(var(--r-m) - 3px);
    font: 600 var(--t-s) / 1.2 var(--f-ui);
    color: var(--ink-2);
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .seg button[aria-pressed='true'] {
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 1px 2px oklch(0 0 0 / 0.12);
  }
  .books[hidden],
  .foot[hidden] {
    display: none;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    width: min(320px, 40vw);
    height: 44px;
    box-sizing: border-box;
    padding: 0 14px;
    border-radius: var(--r-m);
    border: 1.5px solid var(--rule);
    background: var(--surface);
    color: var(--ink-3);
    cursor: text;
  }
  .search:focus-within {
    border-color: var(--accent);
  }
  .search svg {
    width: 17px;
    height: 17px;
    flex: none;
    stroke: currentColor;
    fill: none;
    stroke-width: var(--stroke);
    stroke-linecap: round;
  }
  .search input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--ink);
    font: 500 var(--t-m) / 1 var(--f-ui);
    padding: 0;
  }
  .search input::placeholder {
    color: var(--ink-3);
  }
  /* (a search looks in every book: the shelves wait, out of use) */
  .shelves.off {
    opacity: 0.4;
  }
  .shelves {
    max-width: 1040px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: -10px 0 30px;
  }
  .shelves > button {
    appearance: none;
    border: 1.5px solid var(--rule);
    background: none;
    cursor: pointer;
    height: 36px;
    padding: 0 14px;
    border-radius: 999px;
    font: 600 var(--t-s) / 1 var(--f-ui);
    color: var(--ink-2);
  }
  :global(html:not(.touchui)) .shelves > button:not([aria-selected='true']):hover {
    background: var(--hover);
    color: var(--ink);
  }
  .shelves > button[aria-selected='true'] {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--ground);
  }
  .shelves > button.own {
    font-style: normal;
  }
  .shelves > button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .sh-acts {
    margin-left: auto;
  }
  .none {
    grid-column: 1 / -1;
    margin: 0;
    font: 500 var(--t-m) / 1.5 var(--f-ui);
    color: var(--ink-3);
    max-width: 60ch;
  }
  /* Nothing here is positioned at rest: WebKitGTK gives every positioned element a layer
     of its own, and 200 more of them slowed the shelf's scrolling. The book and its ⋯
     share one grid cell; the ⋯ exists only while the book is hovered or focused. */
  .slot {
    display: grid;
    min-width: 0;
  }
  .slot > .book,
  .slot > .more {
    grid-area: 1 / 1;
  }
  .slot > .book {
    width: 100%;
  }
  .more {
    display: none;
    justify-self: end;
    align-self: start;
    margin: 6px;
    width: 32px;
    height: 32px;
    border-radius: 16px;
    border: 0;
    padding: 0;
    cursor: pointer;
    place-items: center;
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    color: var(--ink);
  }
  .more svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
  }
  :global(html:not(.touchui)) .slot:hover .more,
  .slot:focus-within .more {
    display: grid;
    position: relative;
    z-index: 1;
    animation: more-in 0.15s ease-out;
  }
  @keyframes more-in {
    from {
      opacity: 0;
    }
  }
  /* a touch screen has no hover: the button always there, as Apple Books has it, at the end
     of the line under the cover that says how far the book is read */
  :global(.touchui) .slot > .more {
    align-self: end;
    margin: 0;
    place-items: end;
    padding: 0 2px 0 0;
    background: none;
    color: var(--ink-3);
  }
  :global(.touchui) .slot .s {
    padding-right: 36px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .by {
    margin: 4px 0 0;
    font: 500 var(--t-m) / 1.3 var(--f-ui);
    color: var(--ink-3);
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
  .cols h3 {
    margin: 0 0 4px;
    font: 600 var(--t-s) / 1.3 var(--f-ui);
    color: var(--ink-3);
  }
  /* what can be done with the book: rows of one group, a hairline between them */
  /* (the first and last rows rounded as the list is: a list that clipped them could be
     squeezed by a short sheet, its rows cut off) */
  .actions {
    display: grid;
    border-radius: var(--r-m);
    background: var(--surface);
    border: 1px solid var(--rule);
  }
  .actions button:first-child {
    border-radius: calc(var(--r-m) - 1px) calc(var(--r-m) - 1px) 0 0;
  }
  .actions button:last-child {
    border-radius: 0 0 calc(var(--r-m) - 1px) calc(var(--r-m) - 1px);
  }
  .actions button {
    appearance: none;
    border: 0;
    background: none;
    cursor: pointer;
    min-height: 48px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    text-align: left;
    font: 500 var(--t-m) / 1.2 var(--f-ui);
    color: var(--ink);
  }
  .actions button + button {
    border-top: 1px solid var(--rule);
  }
  .actions svg {
    flex: none;
    width: 20px;
    height: 20px;
    stroke: currentColor;
    fill: none;
    stroke-width: var(--stroke);
    stroke-linecap: round;
    stroke-linejoin: round;
    color: var(--ink-2);
  }
  .actions .danger,
  .actions .danger svg {
    color: var(--danger);
  }
  :global(html:not(.touchui)) .actions button:hover {
    background: var(--hover);
  }
  .col-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 0 10px;
    border-radius: var(--r-s);
    cursor: pointer;
    font: 600 var(--t-m) / 1.2 var(--f-ui);
    color: var(--ink);
  }
  :global(html:not(.touchui)) .col-row:hover {
    background: var(--hover);
  }
  .col-row input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
    margin: 0;
  }
  .col-row .cn {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .new {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .new input {
    flex: 1;
    min-width: 0;
    width: 0;
    height: 44px;
    box-sizing: border-box;
    border: 1.5px solid var(--rule);
    border-radius: var(--r-m);
    background: var(--surface);
    color: var(--ink);
    font: 500 var(--t-m) / 1 var(--f-ui);
    padding: 0 14px;
    outline: none;
  }
  .new input:focus {
    border-color: var(--accent);
  }
  h1 {
    margin: 0;
    font: 700 var(--t-xxl) / 1.1 var(--f-ui);
    letter-spacing: -0.02em;
    color: var(--ink);
  }
  .head-acts {
    display: flex;
    gap: 8px;
  }
  .add-p {
    display: none;
  }
  @media (max-width: 640px) {
    .add-p {
      display: inline;
    }
  }
  .books {
    max-width: 1040px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 34px 24px;
  }
  .book {
    all: unset;
    cursor: pointer;
    display: grid;
    gap: 12px;
    align-content: start;
    min-width: 0;
    border-radius: var(--r-xs);
  }
  .book:focus-visible {
    outline: none;
  }
  .book:focus-visible .cover {
    outline: 3px solid var(--focus);
    outline-offset: 4px;
  }
  .cover {
    /* every cover the same frame, whatever it holds: 2:3, and never taller (a box with an
       aspect ratio grows to fit its content unless its minimum height is zero) */
    width: 100%;
    aspect-ratio: 2 / 3;
    min-height: 0;
    box-sizing: border-box;
    border-radius: 4px 8px 8px 4px;
    padding: 14% 11% 11%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    text-align: center;
    background: oklch(0.38 0.06 var(--ch));
    color: oklch(0.95 0.025 var(--ch));
    box-shadow:
      inset 5px 0 0 oklch(0 0 0 / 0.14),
      inset 6px 0 0 oklch(1 0 0 / 0.08);
    transition: transform var(--calm) cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  :global(html:not(.touchui)) .book:hover .cover,
  .book:focus-visible .cover {
    transform: translateY(-3px);
  }
  .cover.img {
    padding: 0;
    background: var(--rule);
  }
  /* the image fills the cover and takes no part in sizing it */
  .cover.img img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border-radius: inherit;
    opacity: 0;
    transition: opacity var(--calm) ease;
  }
  .cover.img img:global(.in) {
    opacity: 1;
  }
  .cover.img img:global(.now) {
    transition: none;
  }
  :global(.cover.img.whole) img {
    object-fit: contain;
  }
  .c-author {
    font: 600 12px/1.25 var(--f-ui);
    letter-spacing: 0.04em;
    opacity: 0.85;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  .c-title {
    font: 600 clamp(18px, 2.1vw, 23px) / 1.12 var(--f-book);
    font-variation-settings:
      'opsz' 36,
      'wght' 600;
    text-wrap: balance;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
  }
  .c-year {
    font: 600 12px/1 var(--f-ui);
    opacity: 0.7;
  }
  .add .cover {
    background: transparent;
    color: var(--ink-3);
    border: 2px dashed var(--rule);
    box-shadow: none;
    justify-content: center;
    gap: 8px;
  }
  .plus {
    font: 300 40px/1 var(--f-ui);
  }
  .c-t {
    font: 650 var(--t-m) / 1.2 var(--f-ui);
    color: var(--ink-2);
  }
  .c-s {
    font: 500 var(--t-xs) / 1.3 var(--f-ui);
  }
  .meta {
    display: grid;
    gap: 3px;
    min-width: 0;
  }
  .t {
    font: 650 var(--t-m) / 1.3 var(--f-ui);
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .s {
    font: 500 var(--t-s) / 1.3 var(--f-ui);
    color: var(--ink-3);
  }
  /* a phone: the title and its switch, then the search across, the add button as a + */
  @media (max-width: 640px) {
    .shelf {
      padding: calc(20px + env(safe-area-inset-top)) 16px calc(40px + env(safe-area-inset-bottom));
    }
    .head {
      margin-bottom: 18px;
      gap: 12px;
    }
    .title {
      width: 100%;
      justify-content: space-between;
      gap: 12px;
    }
    h1 {
      font-size: var(--t-xl);
    }
    .head-acts {
      width: 100%;
    }
    /* (the field may be narrower than its input would be: the + keeps its place) */
    .search {
      flex: 1;
      width: auto;
      min-width: 0;
    }
    .add-btn .add-l {
      display: none;
    }
    .add-btn {
      flex: none;
      width: 44px;
      padding: 0;
      justify-content: center;
      font-size: 22px;
    }
    /* (the row fits a phone's width, and wraps rather than scrolls once there are
       collections too) */
    .shelves {
      margin: -4px 0 20px;
      gap: 6px;
    }
    .shelves > button {
      flex: none;
      padding: 0 12px;
    }
    .books {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 26px 18px;
    }
    .add .c-s {
      display: none;
    }
    .t {
      font-size: var(--t-s);
    }
    .s {
      font-size: var(--t-xs);
    }
  }
  .foot {
    max-width: 70ch;
    margin: 44px 0 0;
    font: 500 var(--t-s) / 1.5 var(--f-ui);
    color: var(--ink-3);
  }
  /* a finger's reach (44 px) where the drawing is smaller */
  :global(.touchui) .seg button {
    padding-block: 12px;
  }
  :global(.touchui) .shelves > button {
    height: 40px;
  }
  /* (on a touch screen it is always there: beside the title, below the cover, rather
     than over a generated cover's author) */
  :global(.touchui) .more {
    position: relative;
    z-index: 1;
    align-self: end;
    margin: 0 -4px 6px 0;
  }
  :global(.touchui) .meta {
    padding-right: 34px;
  }
  :global(.touchui) .more::before {
    content: '';
    position: absolute;
    inset: -6px;
  }
  .link-btn {
    appearance: none;
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }
</style>
