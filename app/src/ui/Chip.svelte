<script module lang="ts">
  /** The menu for a selection or a highlight: its colours, a note, and (a highlight's)
   *  copy with the reference and remove; placed clear of what it is for. */
  /** Where the menu goes, in the stage's coordinates, kept inside it. A mouse's: above what
   *  it is for (below, under the bar's band), its middle over the selection's. A finger's
   *  selection has the system's menu beside it (Copy, Look Up), above it or below it as the
   *  system decides (iOS and Android both choose by their own measure, and say nothing of it):
   *  ours goes in whichever band of the reader's own (`bands`: above the text, where the bar
   *  is; below it, where the page's number is) is farther from the selection, in the middle
   *  across, over no text. The system's hugs the selection, so it is never there. A
   *  highlight a finger taps has its menu there too, the one place a phone's menu is. */
  const GAP = 12, M = 10;
  type Band = [number, number];
  function place(c: { x: number; y: number; b?: number; finger?: boolean }, w: number, h: number, W: number, H: number, bands: { top: Band; foot: Band }) {
    const b = c.b ?? c.y, clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    if (c.finger) {
      const [s, e] = c.y - bands.top[1] >= bands.foot[0] - b ? bands.top : bands.foot;
      return { left: clamp((W - w) / 2, M, W - M - w), top: clamp((s + e - h) / 2, 0, H - h) };
    }
    let top = c.y - GAP - h;
    if (top < M + 44) top = b + GAP;
    return { left: clamp(c.x - w / 2, M, W - M - w), top: clamp(top, M, H - M - h) };
  }
</script>

<script lang="ts">
  import { copyText } from '../core/clipboard';
  import { type Reader } from '../reader/reader.svelte';
  import { ui, toast } from '../state.svelte';
  import { chapName } from '../reader/render';
  import { insets } from '../reader/geometry';
  import { unselect } from '../reader/selection';
  import { REACTIONS, REACTION_LABEL, type Reaction } from '../reader/annotations';
  import { kv } from '../core/kv';

  let { reader }: { reader: Reader } = $props();
  /** The menu put away, and the selection it was for (the selection changing puts only the
   *  menu away: input.ts). */
  const done = () => { ui.chip = null; unselect(reader.stage); };
  const ann = $derived(ui.chip?.ann ? reader.ann?.list.find(a => a.id === ui.chip!.ann) ?? null : null);

  function color(c: number) {
    const chip = ui.chip; if (!chip) return;
    if (chip.ann) reader.marking.recolor(chip.ann, c);
    else if (chip.sel) reader.marking.highlight(chip.sel, c);
    done();
  }
  function note() {
    const chip = ui.chip; if (!chip) return;
    const id = chip.ann ?? (chip.sel ? reader.marking.highlight(chip.sel, 1) : null);
    done();
    // written beside the text where the rail shows, else in a sheet (a phone's, from below)
    if (id && ui.railed) ui.composing = id;
    else if (id) { ui.noteFor = id; ui.sheet = 'note'; }
  }
  /** A highlight copied with the book's reference (a selection is copied as anywhere, by the
   *  system or the keys). */
  async function copy() {
    if (!ann) return;
    const book = reader.book!, sec = reader.strip!.keyIndex.get(ann.key)?.[0] ?? 0;
    toast((await copyText(`“${ann.quote}”\n— ${book.author ? book.author + ', ' : ''}${book.title}, ${chapName(book, sec)}`)) ? 'Copied with reference' : 'This browser would not copy.');
    done();
  }
  function remove() { if (ui.chip?.ann) reader.marking.unhighlight(ui.chip.ann); done(); }
  // a manuscript sent by link: the reader's quick reactions for its writer (looked up
  // each time the chip opens: the link's record is not reactive)
  const asked = $derived(!!ui.chip && !!reader.book && !!kv.get('joined.' + reader.book.id, null));
  function react(r: Reaction) {
    const chip = ui.chip; if (!chip) return;
    const id = reader.marking.react(chip, r);
    done();
    const a = id ? reader.ann?.list.find(x => x.id === id) : null;
    if (a) toast(a.react ? `${REACTION_LABEL[r]}: noted for the writer.` : 'Reaction taken off.', 2400);
  }


  /** Keys while the chip is up. */
  export function key(e: KeyboardEvent): boolean {
    const k = e.key;
    if (k >= '1' && k <= '4') { color(+k); return true; }
    if (asked && k >= '5' && k <= '8') { react(REACTIONS[+k - 5]); return true; }
    if (k === 'n' || k === 'N') { note(); return true; }
    if ((k === 'c' || k === 'C') && ui.chip?.ann) { copy(); return true; }
    if ((k === 'x' || k === 'Delete' || k === 'Backspace') && ui.chip?.ann) { remove(); return true; }
    if (k === 'Escape') { done(); return true; }
    return false;
  }
  // where it goes, once its size is known (hidden until then)
  let pop: HTMLElement | undefined = $state();
  let at: { left: number; top: number } | null = $state(null);
  $effect(() => {
    const c = ui.chip; at = null;
    if (!c || !pop) return;
    requestAnimationFrame(() => {
      const st = pop?.offsetParent as HTMLElement | null;
      const r = pop?.getBoundingClientRect(), M = reader.M, ins = insets();
      // (the bands the text never uses: above it, where the bar is; below it, the page's number)
      if (r && st && M) at = place(c, r.width, r.height, st.clientWidth, st.clientHeight, { top: [ins.t, M.y0], foot: [M.y0 + M.colH, st.clientHeight - ins.b] });
    });
  });
</script>

{#if ui.chip}
  {@const c = ui.chip}
  <div class="chip-pop lift r12" bind:this={pop} style:left="{at?.left ?? 0}px" style:top="{at?.top ?? 0}px" style:visibility={at ? 'visible' : 'hidden'} role="toolbar" aria-label="Highlight">
    {#each [1, 2, 3, 4] as n}
      <button class="dot h{n}" class:on={ann?.color === n} onclick={() => color(n)} aria-label="Highlight colour {n}"></button>
    {/each}
    <span class="sep"></span>
    <!-- (the actions as glyphs, named for a screen reader and a pointer's tooltip: the menu
         in one row on a phone) -->
    <button class="act" onclick={note} aria-label={ann?.note ? 'Edit note' : 'Note'} title="{ann?.note ? 'Edit note' : 'Note'} (N)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H10l-4 4v-4H5z" /></svg>
    </button>
    {#if c.ann}
      <button class="act" onclick={copy} aria-label="Copy with reference" title="Copy with reference (C)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="2" /><path d="M15 9V6a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3" /></svg>
      </button>
      <button class="act" onclick={remove} aria-label="Remove highlight" title="Remove highlight (X)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 11v5M13.5 11v5" /></svg>
      </button>
    {/if}
    {#if asked}
      <div class="reacts" role="group" aria-label="Tell the writer">
        <span class="rl" aria-hidden="true">For the writer</span>
        {#each REACTIONS as r}
          <button class="act word" aria-pressed={ann?.react === r} onclick={() => react(r)} title={REACTION_LABEL[r]}>{r[0].toUpperCase() + r.slice(1)}</button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* the selection's menu beside it (where: `place`), on the surface every menu of the
     reader's has (the theme's, softened: reader.svelte.ts) */
  .chip-pop {
    position: absolute; z-index: 27;
    display: flex; align-items: center; gap: 0; padding: 0 6px; min-height: 40px; border-radius: var(--r-m);
    background: var(--surface); color: var(--ink); border: 1px solid var(--rule);
    animation: pop .14s cubic-bezier(.2,.8,.2,1); flex-wrap: wrap;
  }
  /* the reactions for a manuscript's writer: a row of their own */
  .reacts { flex-basis: 100%; display: flex; justify-content: space-between; gap: 2px; border-top: 1px solid var(--rule); padding: 2px 0; }
  .reacts .act[aria-pressed="true"] { background: var(--hover); }
  .rl { align-self: center; padding: 0 8px; font: 500 13px/1 var(--f-ui); color: var(--ink-3); white-space: nowrap; }
  @keyframes pop { from { opacity: 0; } }
  button { appearance: none; cursor: pointer; border: 0; background: none; color: inherit; }
  .dot { width: 32px; height: 40px; display: grid; place-items: center; padding: 0; }
  .dot::before { content: ""; width: 18px; height: 18px; border-radius: 50%; background: var(--c); }
  .dot.on::before { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--ink); }
  .dot.h1 { --c: var(--hs1); } .dot.h2 { --c: var(--hs2); } .dot.h3 { --c: var(--hs3); } .dot.h4 { --c: var(--hs4); }
  .sep { width: 1px; height: 20px; background: var(--rule); margin: 0 6px; }
  .act { height: 40px; min-width: 40px; padding: 0; border-radius: 8px; font: 500 var(--t-s)/1 var(--f-ui); display: inline-flex; align-items: center; justify-content: center; white-space: nowrap; color: var(--ink-2); }
  .act.word { padding: 0 10px; }
  .act svg { width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: var(--stroke); stroke-linecap: round; stroke-linejoin: round; }
  :global(html:not(.touchui)) .act:hover, :global(html:not(.touchui)) .dot:hover { background: var(--hover); color: var(--ink); }
</style>
