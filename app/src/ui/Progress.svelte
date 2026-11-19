<script lang="ts">
  /** Where the reader is, under the text: "Page X of Y, chapter", pages counted over the
   *  whole book (a page is a column), and above it a faint line that shows with the bar. A
   *  drag along it (or its arrow keys) moves through the book, the words following; let go,
   *  and the reader travels there. */
  import type { Reader } from '../reader/reader.svelte';
  import { ui } from '../state.svelte';

  let { reader, shown }: { reader: Reader; shown: boolean } = $props();
  let dragging = $state(false), at = $state(0);
  const page = $derived(dragging ? at + 1 : ui.page);
  const where = $derived(dragging ? reader.headFor(at) : ui.runhead);
  const fill = $derived(ui.pages > 1 ? ((page - 1) / (ui.pages - 1)) * 100 : 0);
</script>

<div class="progress" class:shown={shown || dragging}>
  <input type="range" min="0" max={Math.max(0, ui.pages - 1)} value={ui.page - 1} style:--fill="{fill}%"
    aria-label="Place in the book" aria-valuetext="Page {page} of {ui.pages}, {where}"
    oninput={e => { dragging = true; at = +e.currentTarget.value; }}
    onchange={e => { dragging = false; reader.travelTo(+e.currentTarget.value); }} />
  {#if ui.pages}<p class="where">Page {page} of {ui.pages}{where ? `, ${where}` : ''}</p>{/if}
</div>

<style>
  .progress { position: absolute; left: 0; right: 0; bottom: calc(env(safe-area-inset-bottom) + 12px); z-index: 4; display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; }
  .where { margin: 0; max-width: calc(100% - 32px); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font: 500 12px/1.3 var(--f-ui); color: var(--ink-3); font-variant-numeric: tabular-nums; }
  input { width: min(280px, 60%); height: 16px; margin: 0; background: none; appearance: none; -webkit-appearance: none; cursor: pointer; pointer-events: auto; opacity: 0; transition: opacity .3s ease; }
  .shown input, input:focus-visible { opacity: 1; }
  /* the line: faint, read up to where the reader is; the handle only while it is held, hovered or focused */
  input::-webkit-slider-runnable-track { height: 2px; border-radius: 1px; background: linear-gradient(to right, color-mix(in oklab, var(--ink) 35%, transparent) var(--fill), color-mix(in oklab, var(--ink) 9%, transparent) var(--fill)); }
  input::-moz-range-track { height: 2px; border-radius: 1px; background: linear-gradient(to right, color-mix(in oklab, var(--ink) 35%, transparent) var(--fill), color-mix(in oklab, var(--ink) 9%, transparent) var(--fill)); }
  input::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; margin-top: -5px; border-radius: 6px; background: var(--surface); box-shadow: 0 0 0 1px color-mix(in oklab, var(--ink) 25%, transparent); opacity: 0; transition: opacity .15s; }
  input::-moz-range-thumb { width: 12px; height: 12px; border: 0; border-radius: 6px; background: var(--surface); box-shadow: 0 0 0 1px color-mix(in oklab, var(--ink) 25%, transparent); opacity: 0; transition: opacity .15s; }
  input:hover::-webkit-slider-thumb, input:active::-webkit-slider-thumb, input:focus-visible::-webkit-slider-thumb { opacity: 1; }
  input:hover::-moz-range-thumb, input:active::-moz-range-thumb, input:focus-visible::-moz-range-thumb { opacity: 1; }
</style>
