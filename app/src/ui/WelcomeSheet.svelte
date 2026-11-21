<script lang="ts">
  /** A book that arrived by link, opened for the first time: who sent it, and that one's
   *  notes go back to them. Once per book. */
  import Sheet from './Sheet.svelte';
  import { type Reader } from '../reader/reader.svelte';
  import { ui } from '../state.svelte';

  let { reader }: { reader: Reader } = $props();
  // svelte-ignore state_referenced_locally
  const by = ui.welcome?.by ?? '';

  function close() { ui.sheet = null; ui.welcome = null; }
</script>

<Sheet label="A book sent to you" onclose={close} onkey={e => { if (e.key === 'Enter') { close(); return true; } return false; }}>
  <div>
    <p class="eyebrow">{by ? `Sent to you by ${by}` : 'Sent to you'}</p>
    <h2>{reader.book?.title}</h2>
  </div>
  <p class="how">Your highlights and notes go back to {by || 'the writer'} when you send them.</p>
  <div class="acts"><button class="btn primary" data-autofocus onclick={close}>Start reading</button></div>
</Sheet>

<style>
  .how { margin: 0; font: 500 var(--t-m)/1.45 var(--f-ui); color: var(--ink-2); }
</style>
