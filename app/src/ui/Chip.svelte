<script module lang="ts">
  /** Where the menu goes, in the stage's coordinates, kept inside it. A mouse's: above what
   *  it is for, as a system's own menu would be (below, under the bar's band). A finger's
   *  selection has the system's menu beside it (Copy, Look Up), which goes above it where
   *  there is room and below it where not, the handles' knobs hanging at its ends: ours goes
   *  on the other side, or past the system's when that side has no room; never against the
   *  window's edges, where a browser's own toolbars may be. */
  const SYS = 64, KNOB = 26, GAP = 12, M = 10;
  function place(c: { x: number; y: number; b?: number; native?: boolean }, w: number, h: number, W: number, H: number) {
    const b = c.b ?? c.y, clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    let top: number;
    if (!c.native) {
      top = c.y - GAP - h;
      if (top < M + 44) top = b + GAP;
    } else if (c.y - SYS >= M) {
      // the system's above: ours below the end's knob, else above the system's
      top = b + KNOB + h <= H - M ? b + KNOB : c.y - SYS - GAP - h;
    } else {
      // the system's below: ours above, else below the system's
      top = c.y - GAP - h >= M ? c.y - GAP - h : b + KNOB + SYS + GAP;
    }
    return { left: clamp(c.x - w / 2, M, W - M - w), top: clamp(top, M, H - M - h) };
  }
</script>

<script lang="ts">
  import { copyText } from '../core/clipboard';
  import { type Reader } from '../reader/reader.svelte';
  import { ui, toast } from '../state.svelte';
  import { chapName } from '../reader/render';
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
      const r = pop?.getBoundingClientRect();
      if (r && st) at = place(c, r.width, r.height, st.clientWidth, st.clientHeight);
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
    <button class="act" onclick={note}>{ann?.note ? 'Edit note' : 'Note'}</button>
    {#if c.ann}<button class="act" onclick={copy}>Copy</button><button class="act" onclick={remove}>Remove</button>{/if}
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
  /* the selection's menu: a dark pill beside it (where: `place`) */
  .chip-pop {
    position: absolute; z-index: 20;
    display: flex; align-items: center; gap: 0; padding: 0 6px; min-height: 40px; border-radius: 10px;
    background: var(--pill); color: oklch(0.96 0.008 80); border: 1px solid oklch(1 0 0 / 0.08);
    animation: pop .14s cubic-bezier(.2,.8,.2,1); flex-wrap: wrap;
  }
  /* the reactions for a manuscript's writer: a row of their own */
  .reacts { flex-basis: 100%; display: flex; justify-content: space-between; gap: 2px; border-top: 1px solid oklch(1 0 0 / 0.14); padding: 2px 0; }
  .reacts .act[aria-pressed="true"] { background: oklch(1 0 0 / 0.14); }
  @keyframes pop { from { opacity: 0; } }
  button { appearance: none; cursor: pointer; border: 0; background: none; color: inherit; }
  .dot { width: 32px; height: 40px; display: grid; place-items: center; padding: 0; }
  .dot::before { content: ""; width: 18px; height: 18px; border-radius: 50%; background: var(--c); }
  .dot.on::before { box-shadow: 0 0 0 2px var(--pill), 0 0 0 4px oklch(0.96 0.008 80); }
  .dot.h1 { --c: var(--hs1); } .dot.h2 { --c: var(--hs2); } .dot.h3 { --c: var(--hs3); } .dot.h4 { --c: var(--hs4); }
  .sep { width: 1px; height: 20px; background: oklch(1 0 0 / 0.2); margin: 0 6px; }
  .act { height: 40px; padding: 0 10px; border-radius: 8px; font: 500 var(--t-s)/1 var(--f-ui); display: inline-flex; align-items: center; white-space: nowrap; }
  :global(html:not(.touchui)) .act:hover, :global(html:not(.touchui)) .dot:hover { background: oklch(1 0 0 / 0.1); }
</style>
