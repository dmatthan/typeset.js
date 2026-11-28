<script lang="ts">
  /** Before a link leaves the book: where it goes, and Open or Cancel (References.openLink). */
  import { shell } from '../core/shell';
  import { toast, ui } from '../state.svelte';
  import Sheet from './Sheet.svelte';

  const url = ui.leaving, u = shell.outward(url);
  // (mail: the address alone; the web: the whole of it)
  const where = u?.protocol === 'mailto:' ? u.pathname : url;
  const close = () => { ui.sheet = null; ui.leaving = ''; };
  function open() {
    close();
    shell.openLink(url).then(ok => { if (!ok) toast('This link can’t be opened.'); });
  }
</script>

<!-- (Open has the focus: Enter opens, as a press would; Cancel, tabbed to, cancels) -->
<Sheet label="Open this link" onclose={close}>
  <div><p class="eyebrow">{u?.protocol === 'mailto:' ? 'Write to' : 'Leave the book for'}</p><h2>Open this link?</h2>
    <p class="where addr">{where}</p></div>
  <div class="acts two">
    <button class="btn" onclick={close}>Cancel</button>
    <button class="btn primary" data-autofocus onclick={open}>Open</button>
  </div>
</Sheet>

<style>
  /* (an address breaks anywhere, never past the sheet) */
  .addr { overflow-wrap: anywhere; }
</style>
