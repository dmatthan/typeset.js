<script lang="ts">
  /** The frame around every shell's views: work in progress, and messages. */
  import type { Snippet } from 'svelte';
  import { ui } from '../state.svelte';
  import Toast from './Toast.svelte';

  let { children }: { children: Snippet } = $props();
</script>

<div class="app">
  {@render children()}
  {#if ui.busy}<div class="busy" role="status">{ui.busy}</div>{/if}
  <Toast />
</div>

<style>
  /* clipped, never scrolled: shadows of things at the window's edge reach past it, and a
     frame that merely hides its overflow can still be scrolled (focus moving to a control
     did, and on a phone the whole page shifted by a shadow's width) */
  .app { position: relative; height: 100%; overflow: clip; }
  .busy { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); font: 600 var(--t-m)/1 var(--f-ui); color: var(--ink-3); }
</style>
