<script lang="ts">
  /** Where the reader is, in the band under the text (geometry.ts keeps it free). While
   *  reading: each column's page number under it, nothing else (a page is a column, counted
   *  over the whole book). With the bar (a tap, the pointer near the top or the foot): a
   *  hairline through the book where the numbers were, and "N of Total" just below it; page
   *  turns bring neither. Dragged (or its arrow keys), the line moves through the book, the
   *  pages and the chapter following; let go, and the reader travels there. */
  import type { Reader } from '../reader/reader.svelte';
  import { ui } from '../state.svelte';

  let { reader, shown, el = $bindable() }: { reader: Reader; shown: boolean; el?: HTMLElement } = $props();
  let dragging = $state(false), at = $state(0);
  const first = $derived(dragging ? at + 1 : ui.page);
  const last = $derived(Math.min(ui.pages, first + ui.cols - 1));
  const where = $derived(dragging ? reader.headFor(at) : ui.runhead);
  const fill = $derived(ui.pages > 1 ? ((first - 1) / (ui.pages - 1)) * 100 : 0);
  // under the middle of each column in view (as the layout puts them)
  const mids = $derived.by(() => {
    ui.layoutVersion; ui.cols;
    const M = reader.M;
    return M ? Array.from({ length: M.N }, (_, i) => M.x0 + i * M.P + M.colW / 2) : [];
  });
</script>

<div class="progress" class:shown={shown || dragging} bind:this={el}>
  <!-- (nothing until the book has pages: a place in nothing means nothing) -->
  {#if ui.pages}
    {#each mids as x, i}{#if ui.page + i <= ui.pages}<span class="pn" style:left="{x}px" aria-hidden="true">{ui.page + i}</span>{/if}{/each}
    <input type="range" min="0" max={ui.pages - 1} value={ui.page - 1} style:--fill="{fill}%"
      aria-label="Place in the book" aria-valuetext="Page {first} of {ui.pages}{where ? `, ${where}` : ''}"
      oninput={e => { dragging = true; at = +e.currentTarget.value; }}
      onchange={e => { dragging = false; reader.travelTo(+e.currentTarget.value); }} />
    <p class="where">{first === last ? first : `${first}–${last}`} of {ui.pages}{dragging && where ? ` · ${where}` : ''}</p>
  {/if}
</div>

<style>
  /* the band under the text; its middle is where the numbers sit */
  .progress { position: absolute; left: 0; right: var(--rail, 0px); bottom: env(safe-area-inset-bottom); height: var(--foot, 52px); z-index: 4; pointer-events: none; font: 500 13px/1 var(--f-ui); color: var(--ink-3); font-variant-numeric: tabular-nums; }
  /* (faded, then out of the way: visibility follows the fade at its end) */
  .pn, .where, input { position: absolute; top: 50%; transition: opacity .3s ease, visibility .3s, translate .3s ease; }
  .pn { translate: -50% -50%; }
  /* with the bar: the line takes the numbers' place, and the number steps down below it,
     becoming "N of Total" on the way (both move down together, the one fading into the other) */
  .shown .pn { translate: -50% calc(-50% + 10px); }
  .where { left: 50%; translate: -50% -50%; margin: 0; max-width: calc(100% - 32px); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; opacity: 0; visibility: hidden; }
  input { left: 50%; translate: -50% calc(-50% - 6px); width: min(280px, 60%); height: 16px; margin: 0; background: none; appearance: none; -webkit-appearance: none; cursor: pointer; opacity: 0; }
  .shown .pn { opacity: 0; visibility: hidden; }
  .shown .where, .shown input, input:focus-visible { opacity: 1; visibility: visible; }
  .shown .where { translate: -50% calc(-50% + 10px); }
  .shown input, input:focus-visible { pointer-events: auto; }
  /* the line: a hairline, read up to where the reader is; the handle only while held, hovered or focused */
  input::-webkit-slider-runnable-track { height: 2px; border-radius: 1px; background: linear-gradient(to right, color-mix(in oklab, var(--ink) 35%, transparent) var(--fill), color-mix(in oklab, var(--ink) 9%, transparent) var(--fill)); }
  input::-moz-range-track { height: 2px; border-radius: 1px; background: linear-gradient(to right, color-mix(in oklab, var(--ink) 35%, transparent) var(--fill), color-mix(in oklab, var(--ink) 9%, transparent) var(--fill)); }
  input::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; margin-top: -5px; border-radius: 6px; background: var(--surface); box-shadow: 0 0 0 1px color-mix(in oklab, var(--ink) 25%, transparent); opacity: 0; transition: opacity .15s; }
  input::-moz-range-thumb { width: 12px; height: 12px; border: 0; border-radius: 6px; background: var(--surface); box-shadow: 0 0 0 1px color-mix(in oklab, var(--ink) 25%, transparent); opacity: 0; transition: opacity .15s; }
  input:hover::-webkit-slider-thumb, input:active::-webkit-slider-thumb, input:focus-visible::-webkit-slider-thumb { opacity: 1; }
  input:hover::-moz-range-thumb, input:active::-moz-range-thumb, input:focus-visible::-moz-range-thumb { opacity: 1; }
</style>
