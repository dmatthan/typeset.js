<script lang="ts">
  /** A note written in a sheet (a phone's, or where the notes' rail does not show). */
  import Sheet from './Sheet.svelte';
  import { type Reader } from '../reader/reader.svelte';
  import { ui } from '../state.svelte';
  import { chapTitle } from '../reader/render';

  let { reader }: { reader: Reader } = $props();
  // svelte-ignore state_referenced_locally
  const a = reader.ann?.list.find(x => x.id === ui.noteFor);
  let text = $state(a?.note ?? '');
  let ta: HTMLTextAreaElement | undefined = $state();
  $effect(() => { ta?.focus(); });
  // svelte-ignore state_referenced_locally
  const where = a ? chapTitle(reader.book!, reader.strip!.keyIndex.get(a.key)?.[0] ?? 0) : '';

  function done() { if (a) reader.marking.setNote(a.id, text.trim()); ui.sheet = null; ui.noteFor = ''; }
  function removeAll() { if (a) reader.marking.unhighlight(a.id); ui.sheet = null; ui.noteFor = ''; }
  function keys(e: KeyboardEvent) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); done(); } }
</script>

<Sheet label="Note" onclose={done} wide>
  <div><p class="eyebrow">{where}</p><h2>Note</h2></div>
  {#if a}<blockquote class="q">“{a.quote}”</blockquote>{/if}
  <textarea bind:this={ta} bind:value={text} onkeydown={keys} rows="5" placeholder="Add a note" aria-label="Your note"></textarea>
  <div class="acts two">
    <button class="btn quiet" onclick={removeAll}>Remove</button>
    <button class="btn primary" onclick={done}>Done</button>
  </div>
</Sheet>

<style>
  /* the passage, quoted: the book's face, quiet, no fill or rule */
  .q { margin: 0; font: italic 400 var(--t-m)/1.5 var(--f-book); color: var(--ink-2); max-height: 9em; overflow: auto; }
  textarea { box-sizing: border-box; width: 100%; resize: vertical; min-height: 7em; border: 0; border-radius: var(--r-m); background: var(--read); color: var(--ink); font: 400 var(--t-m)/1.5 var(--f-ui); padding: 12px 14px; outline: none; }
  textarea:focus { box-shadow: 0 0 0 2px color-mix(in oklab, var(--accent) 45%, transparent); }
</style>
