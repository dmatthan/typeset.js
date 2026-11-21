<script lang="ts">
  /** The book's contents, bookmarks and the reader's highlights, in a panel beside the text
   *  (reader/contents.svelte.ts has what they hold). A press outside puts it away. */
  import { embedded, features } from '../core/embed';
  import { me } from '../core/identity';
  import { when } from '../core/say';
  import { shell } from '../core/shell';
  import { cs, type Contents, type NoteItem } from '../reader/contents.svelte';
  import { FORMAT, type NotesFile } from '../reader/feedback';
  import { fold } from '../reader/notebook';
  import { type Reader } from '../reader/reader.svelte';
  import { toWebAnno } from '../reader/webanno';
  import { ui, toast } from '../state.svelte';
  import FeedbackList from './FeedbackList.svelte';

  let { contents, reader }: { contents: Contents; reader: Reader } = $props();
  let panel: HTMLElement | undefined = $state();

  // shown: the panel takes the keyboard; the chapters follow the layout as it settles
  $effect(() => { if (ui.contents) panel?.focus({ preventScroll: true }); });
  $effect(() => { ui.layoutVersion; if (ui.contents) contents.build(); });
  // a note edited from here refreshes the list when its sheet closes
  $effect(() => { ui.annVersion; if (ui.contents && !ui.sheet && cs.tab === 'highlights') contents.buildNotebook(); });

  /** One's own notes, or (when there are any) other readers'. */
  let whose: 'mine' | 'feedback' = $state('mine');
  let filter = $state('');
  const shown = $derived.by(() => {
    const words = fold(filter).split(/\s+/).filter(Boolean);
    return words.length ? cs.notes.filter(n => { const h = fold(n.quote + ' ' + n.note + ' ' + n.where); return words.every(w => h.includes(w)); }) : cs.notes;
  });
  const fileName = (what: string) => (reader.book?.title || 'Notes').replace(/[\\/:*?"<>|]+/g, ' ').trim() + ` — ${what}`;
  async function exportMd() {
    if (await shell.saveText(fileName('notes.md'), contents.markdown(shown))) toast('Highlights exported.');
  }
  /** The same notes as W3C Web Annotations, for other tools (reader/webanno.ts). */
  async function exportAnno() {
    const book = reader.book!, m = me();
    const f: NotesFile = { format: FORMAT, book: { id: book.id, title: book.title, author: book.author }, from: { id: m.id, name: m.name }, sent: Date.now(), notes: shown.flatMap(i => (i.file ? [i.file] : [])) };
    if (await shell.saveText(fileName('annotations.json'), JSON.stringify(toWebAnno(f), null, 1), 'json')) toast('Highlights exported as Web Annotations.');
  }
  const go = (it: NoteItem) => contents.go(Math.floor(it.k));
  const marked = $derived.by(() => { ui.layoutVersion; return contents.bookmarks(); });
  function editNote(id: string) { ui.noteFor = id; ui.sheet = 'note'; }
</script>

{#if ui.contents}
  <!-- a press anywhere else puts the panel away -->
  <div class="catch" aria-hidden="true" onpointerdown={() => contents.close()}></div>
  <aside class="contents" bind:this={panel} tabindex="-1" aria-label="Contents">
    <header>
      <div class="book">
        <h2>{reader.book?.title}</h2>
        {#if reader.book?.author}<p>{reader.book.author}</p>{/if}
      </div>
      <button class="close" onclick={() => contents.close()} aria-label="Close" title="Close (Esc)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>

    <div class="tabs" role="tablist" aria-label="Show">
      <button role="tab" aria-selected={cs.tab === 'contents'} onclick={() => contents.setTab('contents')}>Contents</button>
      {#if features.highlights}<button role="tab" aria-selected={cs.tab === 'bookmarks'} onclick={() => contents.setTab('bookmarks')}>Bookmarks</button>{/if}
      <button role="tab" aria-selected={cs.tab === 'highlights'} onclick={() => contents.setTab('highlights')}>Highlights</button>
    </div>

    {#if cs.tab === 'contents'}
      <nav class="list" aria-label="Chapters">
        {#each cs.chapters as c (c.sec)}
          <button class="row" class:read={c.read} aria-current={c.current ? 'true' : undefined} onclick={() => contents.go(reader.strip!.secStart[c.sec])}>
            <span class="t">{c.title}</span>
            {#if c.feedback}<span class="fb" title="Readers' notes in this chapter">{c.feedback}</span>{/if}
            <span class="p">{c.page}</span>
          </button>
        {/each}
      </nav>
    {:else if cs.tab === 'bookmarks'}
      <!-- the pages marked to come back to, in the book's order -->
      <div class="list bms">
        {#if !marked.length}<p class="empty">No bookmarks yet.</p>{/if}
        {#each marked as b (b.id)}
          <div class="bmk">
            <button class="go" onclick={() => contents.go(b.k)}>
              <span class="w"><span class="t">{b.where}</span><span class="p">{b.page}</span></span>
              <span class="q">{b.quote}</span>
              <span class="d">{when(b.at)}</span>
            </button>
            <button class="rm" onclick={() => reader.removeBookmark(b.id)} aria-label="Remove bookmark" title="Remove bookmark">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
        {/each}
      </div>
    {:else}
      <div class="notes">
        {#if reader.fb?.size}
          <div class="seg" role="group" aria-label="Whose notes">
            <button aria-pressed={whose === 'mine'} onclick={() => (whose = 'mine')}>Mine</button>
            <button aria-pressed={whose === 'feedback'} onclick={() => (whose = 'feedback')}>Readers’ · {reader.fb.size}</button>
          </div>
        {/if}
        <input class="filter" type="search" placeholder={whose === 'mine' ? 'Filter your highlights' : 'Filter readers’ notes'} bind:value={filter} aria-label="Filter the highlights" />
        {#if whose === 'feedback' && reader.fb?.size}
          <FeedbackList {reader} {filter} go={(key, s) => contents.go(reader.strip!.resolve({ key, off: s }))} />
        {:else}
          {#if !cs.notes.length}
            <p class="empty">No highlights yet.</p>
          {:else if !shown.length}
            <p class="empty">Nothing matches “{filter}”.</p>
          {/if}
          {#each shown as it, i (it.id)}
            {#if i === 0 || shown[i - 1].sec !== it.sec}<h3>{it.where}</h3>{/if}
            <article class="item {it.kind} h{it.color}">
              <button class="quote" onclick={() => go(it)}>{it.quote}</button>
              {#if it.note}<p class="note">{it.note}</p>{/if}
              <div class="acts">
                {#if it.kind === 'ann'}
                  <button onclick={() => editNote(it.id)}>{it.note ? 'Edit note' : 'Add note'}</button>
                  <button onclick={() => contents.copy(contents.citeEntry(it))}>Copy</button>
                  <button onclick={() => { reader.marking.unhighlight(it.id); contents.buildNotebook(); }}>Remove</button>
                {:else}
                  <button onclick={() => contents.copy(contents.cite(it.id))}>Copy</button>
                  <button onclick={() => { reader.marking.toggleMark(it.id); contents.buildNotebook(); }}>Unmark</button>
                {/if}
              </div>
            </article>
          {/each}
          {#if cs.notes.length}
            <footer>
              <button disabled={!shown.length} onclick={() => contents.copy(contents.markdown(shown))}>Copy as Markdown</button>
              <button disabled={!shown.length} onclick={exportMd}>Export…</button>
              <button disabled={!shown.length} onclick={exportAnno} title="W3C Web Annotations, for other annotation tools">As annotations…</button>
              <!-- (sending is the app's: a book on another site's page has no sheet for it) -->
              {#if !embedded}<button onclick={() => { contents.close(); ui.sheet = 'send'; }}>Send my notes…</button>{/if}
            </footer>
          {/if}
        {/if}
      </div>
    {/if}
  </aside>
{/if}

<style>
  .catch { position: absolute; inset: 0; z-index: 28; }
  .contents {
    position: absolute; top: 0; bottom: 0; left: 0; z-index: 29; width: min(340px, 100%); box-sizing: border-box;
    display: flex; flex-direction: column; background: var(--ground); border-right: 1px solid var(--rule); outline: none;
    padding-top: env(safe-area-inset-top); font: 400 var(--t-m)/1.4 var(--f-ui); color: var(--ink);
  }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 16px 12px 20px; }
  h2 { margin: 0; font: 600 var(--t-m)/1.3 var(--f-ui); }
  .book p { margin: 3px 0 0; font-size: var(--t-s); color: var(--ink-3); }
  .close { flex: none; width: 32px; height: 32px; border: 0; border-radius: var(--r-s); background: none; display: grid; place-items: center; color: var(--ink-3); cursor: pointer; }
  .close svg { width: 16px; height: 16px; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; fill: none; }
  .tabs, .seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; padding: 2px; border-radius: 9px; background: var(--read); }
  .tabs { margin: 0 20px 10px; }
  .tabs button, .seg button { height: 28px; border: 0; border-radius: 7px; background: none; font: 500 var(--t-s)/1 var(--f-ui); color: var(--ink-2); cursor: pointer; }
  .tabs [aria-selected="true"], .seg [aria-pressed="true"] { background: var(--surface); color: var(--ink); box-shadow: 0 0 0 0.5px var(--rule); }
  .list, .notes { flex: 1; overflow: auto; overscroll-behavior: contain; padding: 0 10px 16px; }
  .row { width: 100%; min-height: 40px; display: flex; align-items: center; gap: 10px; padding: 0 10px; border: 0; border-radius: var(--r-s); background: none; text-align: left; font: inherit; color: inherit; cursor: pointer; }
  .row .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--t-m); }
  .row .p, .row .fb { font-size: var(--t-xs); color: var(--ink-3); font-variant-numeric: tabular-nums; }
  .row .fb { padding: 1px 6px; border-radius: 8px; background: var(--wash); color: var(--accent); }
  .row.read .t { color: var(--ink-3); }
  .row[aria-current="true"] { background: var(--wash); }
  .row[aria-current="true"] .t { color: var(--accent); font-weight: 600; }
  .row[aria-current="true"] .p { color: var(--ink-2); }
  :global(html:not(.touchui)) .row:hover, :global(html:not(.touchui)) .close:hover { background: var(--hover); }
  .notes { display: flex; flex-direction: column; gap: 10px; padding-top: 2px; }
  .seg { margin: 0 10px; }
  .filter { margin: 0 10px; height: 34px; padding: 0 10px; border: 1px solid var(--rule); border-radius: var(--r-s); background: var(--surface); font: inherit; font-size: var(--t-s); color: var(--ink); }
  .empty { margin: 8px 10px; font-size: var(--t-s); color: var(--ink-3); }
  h3 { margin: 10px 10px 0; font: 600 var(--t-xs)/1.3 var(--f-ui); color: var(--ink-3); }
  .item { margin: 0 4px; padding: 10px 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--rule); display: flex; flex-direction: column; gap: 6px; }
  .quote { border: 0; background: none; padding: 0; text-align: left; cursor: pointer; font: italic 400 var(--t-s)/1.45 var(--f-book); color: var(--ink-2); }
  .note { margin: 0; font-size: var(--t-s); line-height: 1.45; }
  .acts, footer { display: flex; flex-wrap: wrap; gap: 4px 14px; }
  .acts button, footer button { border: 0; background: none; padding: 0; font: 500 var(--t-xs)/1.6 var(--f-ui); color: var(--accent); cursor: pointer; }
  .acts button:last-child { color: var(--ink-3); }
  footer { padding: 6px 10px 0; }
  button[disabled] { opacity: .4; cursor: default; }
  .bmk { display: flex; align-items: flex-start; gap: 4px; border-radius: var(--r-s); }
  .bmk .go { flex: 1; min-width: 0; display: grid; gap: 3px; padding: 8px 10px; border: 0; border-radius: var(--r-s); background: none; text-align: left; font: inherit; color: inherit; cursor: pointer; }
  .bmk .w { display: flex; gap: 10px; }
  .bmk .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--t-m); }
  .bmk .p, .bmk .d { font-size: var(--t-xs); color: var(--ink-3); font-variant-numeric: tabular-nums; }
  .bmk .q { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font: italic 400 var(--t-s)/1.45 var(--f-book); color: var(--ink-2); }
  .bmk .rm { flex: none; width: 32px; height: 32px; margin-top: 6px; border: 0; border-radius: var(--r-s); background: none; display: grid; place-items: center; color: var(--ink-3); cursor: pointer; }
  .bmk .rm svg { width: 14px; height: 14px; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; fill: none; }
  :global(html:not(.touchui)) .bmk .go:hover, :global(html:not(.touchui)) .bmk .rm:hover { background: var(--hover); }
  /* a phone: the whole width, from the top under the status bar */
  @media (max-width: 640px) { .contents { width: 100%; border-right: 0; } }
</style>
