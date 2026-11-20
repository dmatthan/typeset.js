<script lang="ts">
  import { copyText } from '../core/clipboard';
  import { type Reader } from '../reader/reader.svelte';
  import { ui, toast } from '../state.svelte';
  import { chapName } from '../reader/render';
  import { REACTIONS, REACTION_LABEL, type Reaction } from '../reader/annotations';
  import { kv } from '../core/kv';

  let { reader }: { reader: Reader } = $props();
  const ann = $derived(ui.chip?.ann ? reader.ann?.list.find(a => a.id === ui.chip!.ann) ?? null : null);

  function color(c: number) {
    const chip = ui.chip; if (!chip) return;
    if (chip.ann) reader.marking.recolor(chip.ann, c);
    else if (chip.sel) reader.marking.highlight(chip.sel, c);
    ui.chip = null;
  }
  function note() {
    const chip = ui.chip; if (!chip) return;
    const id = chip.ann ?? (chip.sel ? reader.marking.highlight(chip.sel, 1) : null);
    ui.chip = null;
    // written beside the text where the rail shows, else in a sheet (a phone's, from below)
    if (id && ui.railed) ui.composing = id;
    else if (id) { ui.noteFor = id; ui.sheet = 'note'; }
  }
  async function copy() {
    const chip = ui.chip; if (!chip) return;
    const book = reader.book!;
    const text = chip.ann ? ann?.quote ?? '' : chip.sel ? reader.marking.selText(chip.sel) : '';
    const sec = chip.sel ? chip.sel.a[0] : ann ? reader.strip!.keyIndex.get(ann.key)?.[0] ?? 0 : 0;
    toast((await copyText(`“${text}”\n— ${book.author ? book.author + ', ' : ''}${book.title}, ${chapName(book, sec)}`)) ? 'Copied with reference' : 'This browser would not copy.');
    ui.chip = null;
  }
  function remove() { if (ui.chip?.ann) reader.marking.unhighlight(ui.chip.ann); ui.chip = null; }
  // a manuscript sent by link: the reader's quick reactions for its writer (looked up
  // each time the chip opens: the link's record is not reactive)
  const asked = $derived(!!ui.chip && !!reader.book && !!kv.get('joined.' + reader.book.id, null));
  function react(r: Reaction) {
    const chip = ui.chip; if (!chip) return;
    const id = reader.marking.react(chip, r);
    ui.chip = null;
    const a = id ? reader.ann?.list.find(x => x.id === id) : null;
    if (a) toast(a.react ? `${REACTION_LABEL[r]}: noted for the writer.` : 'Reaction taken off.', 2400);
  }

  // put away, it takes the browser's selection of the page with it (a mouse's: input.ts)
  $effect(() => {
    if (ui.chip) return;
    const s = getSelection();
    if (s && !s.isCollapsed && s.anchorNode && reader.stage?.contains(s.anchorNode)) s.removeAllRanges();
  });

  /** Keys while the chip is up. */
  export function key(e: KeyboardEvent): boolean {
    const k = e.key;
    if (k >= '1' && k <= '4') { color(+k); return true; }
    if (asked && k >= '5' && k <= '8') { react(REACTIONS[+k - 5]); return true; }
    if (k === 'n' || k === 'N') { note(); return true; }
    if (k === 'c' || k === 'C') { copy(); return true; }
    if ((k === 'x' || k === 'Delete' || k === 'Backspace') && ui.chip?.ann) { remove(); return true; }
    if (k === 'Escape') { ui.chip = null; return true; }
    return false;
  }
  // kept inside the window: moved sideways by what it would overhang, and below the
  // point pressed when there is no room above it
  let pop: HTMLElement | undefined = $state();
  let dx = $state(0), below = $state(false);
  $effect(() => {
    const c = ui.chip; if (!c || !pop) return;
    dx = 0; below = false;
    requestAnimationFrame(() => {
      if (!pop || matchMedia('(max-width: 640px)').matches) return;
      const host = (pop.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? { left: 0, top: 0, width: innerWidth };
      const w = pop.offsetWidth, h = pop.offsetHeight, m = 10;
      const left = host.left + c.x - w / 2;
      dx = Math.max(m - left, Math.min(0, innerWidth - m - (left + w)));
      below = host.top + c.y - h - 18 < m + 44;
    });
  });
</script>

{#if ui.chip}
  {@const c = ui.chip}
  <div class="chip-pop lift r12" bind:this={pop} style:left="{c.x}px" style:top="{c.y}px" style:--dx="{dx}px" class:below role="toolbar" aria-label="Highlight">
    {#each [1, 2, 3, 4] as n}
      <button class="dot h{n}" class:on={ann?.color === n} onclick={() => color(n)} aria-label="Highlight colour {n}"></button>
    {/each}
    <span class="sep"></span>
    <button class="act" onclick={note}>{ann?.note ? 'Edit note' : 'Note'}</button>
    <button class="act" onclick={copy}>Copy</button>
    {#if c.ann}<button class="act" onclick={remove}>Remove</button>{/if}
    {#if asked}
      <div class="reacts" role="group" aria-label="Tell the writer">
        {#each REACTIONS as r}
          <button class="act" aria-pressed={ann?.react === r} onclick={() => react(r)} title={REACTION_LABEL[r]}>{r[0].toUpperCase() + r.slice(1)}</button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* the selection's menu: a dark pill above it (below when there is no room), as the
     system's would be, kept inside the window */
  .chip-pop {
    position: absolute; z-index: 20; transform: translate(calc(-50% + var(--dx, 0px)), calc(-100% - 12px));
    display: flex; align-items: center; gap: 0; padding: 0 6px; min-height: 40px; border-radius: 10px;
    background: var(--pill); color: oklch(0.96 0.008 80); border: 1px solid oklch(1 0 0 / 0.08);
    animation: pop .14s cubic-bezier(.2,.8,.2,1); flex-wrap: wrap;
  }
  /* the reactions for a manuscript's writer: a row of their own */
  .reacts { flex-basis: 100%; display: flex; justify-content: space-between; gap: 2px; border-top: 1px solid oklch(1 0 0 / 0.14); padding: 2px 0; }
  .reacts .act[aria-pressed="true"] { background: oklch(1 0 0 / 0.14); }
  .chip-pop.below { transform: translate(calc(-50% + var(--dx, 0px)), 26px); }
  @keyframes pop { from { opacity: 0; } }
  button { appearance: none; cursor: pointer; border: 0; background: none; color: inherit; }
  .dot { width: 32px; height: 40px; display: grid; place-items: center; padding: 0; }
  .dot::before { content: ""; width: 18px; height: 18px; border-radius: 50%; background: var(--c); }
  .dot.on::before { box-shadow: 0 0 0 2px var(--pill), 0 0 0 4px oklch(0.96 0.008 80); }
  .dot.h1 { --c: var(--hs1); } .dot.h2 { --c: var(--hs2); } .dot.h3 { --c: var(--hs3); } .dot.h4 { --c: var(--hs4); }
  .sep { width: 1px; height: 20px; background: oklch(1 0 0 / 0.2); margin: 0 6px; }
  .act { height: 40px; padding: 0 10px; border-radius: 8px; font: 500 var(--t-s)/1 var(--f-ui); display: inline-flex; align-items: center; white-space: nowrap; }
  :global(html:not(.touchui)) .act:hover, :global(html:not(.touchui)) .dot:hover { background: oklch(1 0 0 / 0.1); }
  /* a phone: a bar along the bottom, clear of the finger and of the screen's edges (after
     the rules it changes, so that it wins) */
  @media (max-width: 640px) {
    .chip-pop, .chip-pop.below {
      position: fixed; left: 10px !important; right: 10px; top: auto !important; bottom: calc(10px + env(safe-area-inset-bottom));
      transform: none; justify-content: space-between; padding: 2px 4px; border-radius: 14px;
    }
    /* (one row on the narrowest phone: four colours, Note and Copy, each a finger's width) */
    .dot { width: 44px; height: 44px; }
    .act { height: 44px; padding: 0 8px; }
    .sep { margin: 0 2px; }
  }
</style>
