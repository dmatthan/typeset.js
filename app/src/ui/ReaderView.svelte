<script lang="ts">
  import { droppedFiles } from './files';
  import { embedded, embedOpts, features, fullscreenBy, wayBack } from '../core/embed';
  import { toggleFull } from './keys';
  import { isNotesMarkdown } from '../reader/notesmd';
  import { isWebAnno } from '../reader/webanno';
  import { onMount, untrack } from 'svelte';
  import { type Reader } from '../reader/reader.svelte';
  import { ui, toast } from '../state.svelte';
  import type { Contents as ContentsCtl } from '../reader/contents.svelte';
  import Contents from './Contents.svelte';
  import Progress from './Progress.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import FindBar from './FindBar.svelte';
  import BookNote from './BookNote.svelte';
  import SideNotes from './SideNotes.svelte';
  import Lightbox from './Lightbox.svelte';
  import ThemeEditor from './ThemeEditor.svelte';
  import { editor } from './editor.svelte';
  import Help from './Help.svelte';
  import Chip from './Chip.svelte';
  import ReaderMenu from './ReaderMenu.svelte';
  import NoteSheet from './NoteSheet.svelte';

  let { reader, contents, hidden, chip = $bindable(), findBar = $bindable() }: { reader: Reader; contents: ContentsCtl; hidden: boolean; chip?: Chip; findBar?: FindBar } = $props();
  let stage: HTMLElement, track: HTMLElement;
  // (none when the page around an embedded reader shows no bar)
  let bar: HTMLElement | undefined = $state();
  onMount(() => reader.mount(stage, track));
  // a book on another site's page: its way back (if any), and full screen at the foot's
  // start (the browser's, or where a frame has none, as on an iPhone, the page's window
  // filled with the book)
  const back = embedded ? wayBack() : null;
  const fullscreenable = fullscreenBy() !== null;
  onMount(() => {
    const was = () => (ui.full = !!document.fullscreenElement);
    document.addEventListener('fullscreenchange', was);
    return () => document.removeEventListener('fullscreenchange', was);
  });

  // The controls, few and the same at any size: at the top the way back (where there is
  // one), the book's title in the middle of the window, a bookmark; at the foot where the
  // reader is and the menu with the rest (ReaderMenu.svelte). They fade away while
  // reading, and come back when the pointer seeks either band (the top's, the foot's), a
  // finger taps the middle, or keyboard focus reaches them. Nothing here changes the
  // page's layout: all of it floats over bands the text never uses.
  const ZONE = 76;
  let away = $state(false);
  let hideT = 0;
  let foot: HTMLElement | undefined = $state(), more: HTMLElement | undefined = $state(), full: HTMLElement | undefined = $state();
  const held = () => [bar, foot, more, full].some(el => el?.matches(':hover, :focus-within'));
  // the bar put away (Type and appearance keeps it, and finding hides it)
  const stepped = $derived((away && ui.sheet !== 'settings') || reader.finder.open);
  // the page in view marked (a ribbon over each column that is, while reading)
  const marked = $derived.by(() => {
    ui.page; ui.cols; ui.layoutVersion;
    const M = reader.M, strip = reader.strip;
    if (!M || !strip) return [];
    const at = new Set(reader.bookmarksInView().map(b => strip.resolve({ key: b.key, off: b.off })));
    return Array.from({ length: M.N }, (_, i) => i).filter(i => at.has(reader.cur + i)).map(i => M.x0 + i * M.P + M.colW);
  });
  const show = () => { clearTimeout(hideT); away = false; };
  const hideSoon = (ms = 700) => { clearTimeout(hideT); hideT = window.setTimeout(() => { if (!held()) away = true; }, ms); };
  function onMove(e: PointerEvent) {
    if (hidden || e.buttons) return;
    const r = stage?.getBoundingClientRect();
    if (e.clientY - (bar?.getBoundingClientRect().top ?? 0) < ZONE || (r && r.bottom - e.clientY < ZONE)) show();
    else if (!away) hideSoon();
  }
  // a book opening shows the bar for a moment, then it steps aside
  $effect(() => { if (!hidden && !ui.sheet) { show(); hideSoon(1800); } });
  // a finger's tap in the middle of the page shows the bar (for a few seconds), or puts it
  // away (reader.svelte.ts)
  $effect(() => {
    if (!ui.barToggle) return;
    untrack(() => { if (away) { show(); hideSoon(4000); } else { clearTimeout(hideT); away = true; } });
  });
</script>

<svelte:window onpointermove={onMove} />

<!-- the reader and all it shows (its menus, panels and sheets), under the theme's colours
     (reader.svelte.ts, paint); no box of its own -->
<div class="look">
<section class="reader" {hidden} aria-label="Reader"
  ondragover={e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); }}
  ondrop={async e => {
    // notes on this book dropped onto it (files, or a folder of them): notes files,
    // notebooks exported as Markdown, Web Annotations
    if (!e.dataTransfer?.items.length) return;
    e.preventDefault();
    const texts: string[] = [];
    for (const f of await droppedFiles(e.dataTransfer)) {
      if (!/\.(vnotes|md|markdown|json|jsonld)$/i.test(f.name) || f.size > 8e6) continue;
      const text = await f.text();
      if (/\.vnotes$/i.test(f.name) || isNotesMarkdown(text) || isWebAnno(text)) texts.push(text);
    }
    if (texts.length) { const m = await reader.receiveNotes(texts).catch(e => `These notes could not be taken: ${(e as Error).message}`); toast(m, Math.max(5200, m.length * 60)); }
  }}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- a tap in the bar’s band while it is away brings it back (a phone has no pointer to
       seek it with); its buttons take taps only once they show -->
  {#if embedOpts.ui !== 'none'}
  <header class="bar" class:away={stepped} bind:this={bar} onfocusin={show} onfocusout={() => hideSoon()}
    onpointerup={e => { if (away && e.pointerType !== 'mouse') { show(); hideSoon(4000); } }}>
    <!-- (the sides keep their width, empty or not: the title stays in the middle) -->
    <div class="side">
      {#if !embedded}
        <button class="ibtn" onclick={() => reader.close()} aria-label="Back to the library" title="Back to the library (Q)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5" /></svg>
        </button>
      {:else if back && embedOpts.ui === 'full'}
        {#if 'href' in back}
          <a class="ibtn" href={back.href} target="_top" aria-label="Back" title="Back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5" /></svg></a>
        {:else}
          <button class="ibtn" onclick={back.go} aria-label="Back" title="Back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5" /></svg></button>
        {/if}
      {/if}
    </div>
    <div class="runhead">{ui.title}</div>
    <div class="side right">
      {#if features.highlights && embedOpts.ui === 'full'}
        <button class="ibtn" onclick={() => reader.toggleBookmark()} aria-pressed={marked.length > 0} aria-label="Bookmark this page" title="Bookmark this page (B)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path class:on={marked.length > 0} d="M7 4h10v16l-5-4-5 4z" /></svg>
        </button>
      {/if}
    </div>
  </header>
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="stage" bind:this={stage} tabindex="0" role="region" aria-label="Book text. Space turns the page, arrow keys move one column. Press ? for all keys.">
    <div class="spoken" aria-live="polite"></div>
    <div class="track" bind:this={track}></div>
    <div class="curtain l"></div>
    <div class="curtain r"></div>
    <Chip {reader} bind:this={chip} />
    {#if ui.bookNote && reader.book}<BookNote {reader} />{/if}
    {#if (ui.sideNotes || ui.railed) && reader.book}<SideNotes {reader} />{/if}
  </div>
  {#if embedOpts.ui !== 'none'}<Progress {reader} shown={!away} bind:el={foot} />{/if}
  {#if embedOpts.ui === 'full'}<ReaderMenu {reader} {contents} {findBar} shown={!away} bind:el={more} />{/if}
  {#if fullscreenable}
    <div class="full" class:shown={!away} bind:this={full}>
      <button class="ibtn" onclick={toggleFull} aria-label={ui.full ? 'Leave full screen' : 'Read full screen'} title="{ui.full ? 'Leave full screen' : 'Read full screen'} (F)">
        {#if ui.full}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14h6v6M10 14l-7 7M20 10h-6V4M14 10l7-7" /></svg>
        {:else}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" /></svg>{/if}
      </button>
    </div>
  {/if}
  <!-- a marked page's ribbon, at its top corner, while reading (with the bar, its button says it) -->
  {#each marked as x (x)}<span class="ribbon" class:hid={!stepped} style:left="{x - 22}px" aria-hidden="true"></span>{/each}
  <!-- a book on another site's page, for a mouse: quiet arrows say it turns (geometry.ts
       says when, and keeps them their room); a page at a time, as an arrow key -->
  {#if ui.arrows}
    <button class="arrow prev" onclick={() => reader.step(-1, 1)} disabled={ui.page <= 1} aria-label="Previous page" title="Previous page (←)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <button class="arrow next" onclick={() => reader.step(1, 1)} disabled={ui.page + ui.cols - 1 >= ui.pages} aria-label="Next page" title="Next page (→)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
    </button>
  {/if}
  {#if ui.lightbox && reader.book}<Lightbox {reader} />{/if}
  {#if !hidden && reader.finder.open}<FindBar {reader} bind:this={findBar} />{/if}
</section>

{#if features.contents}<Contents {contents} {reader} />{/if}

<!-- the reader's own sheets; the app adds those about sharing (App.svelte) -->
{#if !hidden && features.settings && ui.sheet === 'settings'}<SettingsPanel {reader} />{/if}
{#if !hidden && features.settings && ui.sheet === 'theme' && editor.draft}<ThemeEditor {reader} />{/if}
{#if !hidden && ui.sheet === 'help'}<Help onclose={() => (ui.sheet = null)} />{/if}
{#if !hidden && features.highlights && ui.sheet === 'note'}<NoteSheet {reader} />{/if}
</div>

<style>
  .look { display: contents; }
  /* (over the notes' rail and its cards: its controls are the window's; under the contents,
     the selection's menu and the sheets) */
  .bar { position: absolute; top: calc(env(safe-area-inset-top) + var(--pad, 0px)); left: env(safe-area-inset-left); right: env(safe-area-inset-right); z-index: 26; height: 52px; will-change: transform; transform: translateZ(0); display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; align-items: center; padding-inline: calc(10px + var(--pad, 0px) / 2); gap: 8px; color: var(--ink-3); }
  /* (a finger's buttons are larger: the same distance from the side as from the top) */
  :global(.touchui) .bar { padding-inline: calc(10px + var(--pad, 0px) / 4); }
  /* full screen at the foot's start, mirroring the menu at its end (ReaderMenu: the same sums) */
  .full { position: absolute; z-index: 26; left: calc(10px + var(--pad, 0px) / 2); bottom: calc(env(safe-area-inset-bottom) + max((var(--foot, 52px) - var(--pad, 0px) - 40px) / 2, var(--pad, 0px) + 6px)); opacity: 0; visibility: hidden; transition: opacity .3s ease, visibility .3s; }
  .full.shown { opacity: 1; visibility: visible; }
  :global(.touchui) .full { left: calc(10px + var(--pad, 0px) / 4); bottom: calc(env(safe-area-inset-bottom) + max((var(--foot, 52px) - var(--pad, 0px) - 44px) / 2, var(--pad, 0px) + 4px)); }
  .side { display: flex; align-items: center; gap: 4px; transition: opacity .3s ease; }
  .away .side { opacity: 0; pointer-events: none; }
  /* (over the text, not the window, when the notes' rail is beside it: narrower by the
     rail and moved by half of it, so it keeps to its column and off the way back; text,
     it takes no presses) */
  .runhead { translate: calc(var(--rail, 0px) / -2); justify-self: center; max-width: calc(100% - var(--rail, 0px)); pointer-events: none; }
  .right { justify-content: flex-end; }
  /* a control at the top: a round button on the page's surface (as the menu's at the foot) */
  .ibtn {
    appearance: none; border: 0; cursor: pointer; width: 40px; height: 40px; padding: 0; border-radius: 50%;
    display: grid; place-items: center; background: var(--surface); box-shadow: 0 0 0 1px var(--rule);
    color: var(--ink-2); transition: color .15s, background-color .15s; text-decoration: none;
  }
  :global(html:not(.touchui)) .ibtn:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 6%, var(--surface)); }
  .ibtn svg { width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  /* a marked page's bookmark, filled */
  .ibtn path.on { fill: var(--accent); stroke: var(--accent); }
  .side, .runhead { position: relative; }
  /* (its line as tall as its face: the box clips, for the ellipsis, and a line set solid lost
     the foot of a g or a q) */
  .runhead { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: center; font: 500 var(--t-s)/1.4 var(--f-ui); color: var(--ink-3); }
  /* a marked page's ribbon, hanging from the top of its column's corner */
  .ribbon { position: absolute; z-index: 4; top: env(safe-area-inset-top); width: 12px; height: 20px; background: var(--accent); clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 72%, 0 100%); transition: opacity .3s ease; pointer-events: none; }
  .ribbon.hid { opacity: 0; }
  /* level with the middle of the text, 10 from the box's edge (and the notes' rail's) */
  .arrow {
    position: absolute; z-index: 4; top: calc(var(--y0) + var(--colH) / 2 - 20px); width: 40px; height: 40px; padding: 0;
    appearance: none; border: 0; border-radius: 20px; background: none; display: grid; place-items: center;
    color: var(--ink-3); cursor: pointer; transition: color .15s, background-color .15s, opacity .15s;
  }
  .arrow.prev { left: 10px; }
  .arrow.next { right: calc(var(--rail, 0px) + 10px); }
  .arrow:hover:not(:disabled) { color: var(--ink); background: var(--hover); }
  .arrow:disabled { opacity: .35; cursor: default; }
  .arrow:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .arrow svg { width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
</style>
