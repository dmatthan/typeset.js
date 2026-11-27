<script lang="ts">
  /** The reader's other controls, behind one button at the end of the foot (⋯): all that is
   *  not the way back, a bookmark or full screen (at the foot's start), in a short menu that is the same at any size, on any
   *  device and on another site's page (only what the page offers). It shows with the bar
   *  and goes with it; open, it holds them. The keys: the arrows go through it, Escape puts
   *  it away (back to its button), any other key does what it does in the reader. */
  import { features } from '../core/embed';
  import type { Contents } from '../reader/contents.svelte';
  import type { Reader } from '../reader/reader.svelte';
  import { ui } from '../state.svelte';
  import type FindBar from './FindBar.svelte';
  import { openFind } from './keys';

  let { reader, contents, findBar, shown, el = $bindable() }: { reader: Reader; contents: Contents; findBar?: FindBar; shown: boolean; el?: HTMLElement } = $props();
  let open = $state(false), btn: HTMLButtonElement | undefined = $state(), menu: HTMLElement | undefined = $state();

  interface Item { label: string; icon: string; run: () => void; checked?: boolean }
  const items = $derived.by((): Item[] => [
    ...(features.contents ? [{ label: 'Contents', icon: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01', run: () => contents.open('contents') }] : []),
    ...(features.contents && features.highlights ? [{ label: 'Bookmarks', icon: 'M7 4h10v16l-5-4-5 4z', run: () => contents.open('bookmarks') }] : []),
    ...(features.find ? [{ label: 'Find in the book', icon: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13M16 16l4 4', run: () => openFind({ reader, contents, findBar }) }] : []),
    // (the rail needs room beside the text: not on a phone)
    ...(features.highlights && !ui.phone ? [{ label: 'Notes beside the text', icon: 'M5 5h14v10H10l-4 4v-4H5z', run: () => reader.toggleNotes(), checked: ui.rail }] : []),
    ...(features.settings ? [{ label: 'Type and appearance', icon: 'M4 19 9 5l5 14M6 14h6M15 19l3-8 3 8M16 17h4', run: () => (ui.sheet = 'settings') }] : []),
    { label: 'Keys and gestures', icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 17h.01', run: () => (ui.sheet = 'help') },
  ]);

  const entries = () => [...(menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
  // (focus moved without scrolling: on another site's page, the page itself would scroll)
  const focus = (el?: HTMLElement) => el?.focus({ preventScroll: true });
  function show() { open = true; requestAnimationFrame(() => focus(entries()[0])); }
  function hide(back = false) { open = false; if (back) focus(btn); }
  function pick(it: Item) { hide(); it.run(); }
  function keys(e: KeyboardEvent) {
    const all = entries(), i = all.indexOf(document.activeElement as HTMLElement);
    const to = e.key === 'ArrowDown' ? (i + 1) % all.length : e.key === 'ArrowUp' ? (i - 1 + all.length) % all.length : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : -1;
    if (to >= 0) { e.preventDefault(); e.stopPropagation(); focus(all[to]); return; }
    // (Enter and Space press the item; any other key is the reader's, the menu put away)
    if (e.key !== 'Enter' && e.key !== ' ') hide();
  }
  // a press anywhere else puts it away; Escape does from the moment it opens (its first
  // item takes focus a frame later, and a key before then was the reader's)
  $effect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!el?.contains(e.target as Node)) hide(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(true); } };
    addEventListener('pointerdown', away, true);
    addEventListener('keydown', esc, true);
    return () => { removeEventListener('pointerdown', away, true); removeEventListener('keydown', esc, true); };
  });
</script>

<div class="more" class:shown={shown || open} bind:this={el}>
  {#if open}
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <!-- (the shadow on the outer box, the scrolling, in a window too short for it, inside) -->
    <div class="menu lift r12" role="menu" aria-label="More" tabindex="-1" bind:this={menu} onkeydown={keys}><div class="items">
      {#each items as it (it.label)}
        <button role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={it.checked} tabindex="-1" onclick={() => pick(it)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={it.icon} /></svg>
          <span>{it.label}</span>
          {#if it.checked}<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7" /></svg>{/if}
        </button>
      {/each}
    </div></div>
  {/if}
  <button class="ibtn round" bind:this={btn} onclick={() => (open ? hide() : show())} aria-label="More" aria-haspopup="menu" aria-expanded={open} title="More">
    <svg class="dots" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="18" cy="12" r="1.3" /></svg>
  </button>
</div>

<style>
  /* at the end of the foot, level with the page's number (and, with the notes' rail, at
     the end of the text's own foot); in a box on a page (`--pad`) as far from its foot as
     from its side, as the bar's buttons are from its top (ReaderView: the same sums) */
  .more { position: absolute; z-index: 26; right: calc(var(--rail, 0px) + 10px + var(--pad, 0px) / 2); bottom: calc(env(safe-area-inset-bottom) + max((var(--foot, 52px) - var(--pad, 0px) - 40px) / 2, var(--pad, 0px) + 6px)); opacity: 0; visibility: hidden; transition: opacity var(--calm) ease, visibility var(--calm); }
  .more.shown { opacity: 1; visibility: visible; }
  :global(.touchui) .more { right: calc(var(--rail, 0px) + 10px + var(--pad, 0px) / 4); bottom: calc(env(safe-area-inset-bottom) + max((var(--foot, 52px) - var(--pad, 0px) - 44px) / 2, var(--pad, 0px) + 4px)); }
  .ibtn {
    appearance: none; cursor: pointer; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 50%;
    display: grid; place-items: center; background: var(--surface); box-shadow: 0 0 0 1px var(--rule); color: var(--ink-2);
    transition: color var(--quick), background-color var(--quick);
  }
  :global(html:not(.touchui)) .ibtn:hover, .ibtn[aria-expanded="true"] { color: var(--ink); background: color-mix(in srgb, var(--ink) 6%, var(--surface)); }
  .ibtn:focus-visible, .menu button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  svg { width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: var(--stroke); stroke-linecap: round; stroke-linejoin: round; }
  /* (points, not lines: filled) */
  .dots { fill: currentColor; stroke: none; }
  /* the menu rises from the button, on the surface every menu of the reader's has */
  .menu {
    position: absolute; right: 0; bottom: calc(100% + 8px); min-width: 228px;
    box-sizing: border-box; border-radius: var(--r-l); background: var(--surface); border: 1px solid var(--rule);
    animation: rise .16s cubic-bezier(.2, .8, .2, 1); transform-origin: bottom right;
  }
  .items { display: grid; padding: 6px; max-height: calc(100vh - 120px); overflow-y: auto; border-radius: inherit; }
  @keyframes rise { from { opacity: 0; transform: translateY(6px) scale(.98); } }
  .menu button {
    appearance: none; border: 0; background: none; cursor: pointer; min-height: 40px; padding: 0 12px; border-radius: calc(var(--r-l) - 6px);
    display: flex; align-items: center; gap: 12px; text-align: left; white-space: nowrap; font: 400 var(--t-m)/1.2 var(--f-ui); color: var(--ink);
  }
  .menu button svg { flex: none; color: var(--ink-2); }
  .menu button span { flex: 1; }
  .menu .tick { color: var(--accent); }
  :global(html:not(.touchui)) .menu button:hover, .menu button:focus-visible { background: var(--hover); }
</style>
