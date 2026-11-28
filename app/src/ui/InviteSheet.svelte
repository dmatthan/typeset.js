<script lang="ts">
  /** An invitation to share books (from its link): the writer's name, a check that a
   *  person is here (Turnstile), and a passkey made on this device, which signs them in
   *  from then on. The invitation is used up by it. */
  import Sheet from './Sheet.svelte';
  import { ui, toast } from '../state.svelte';
  import { service, register, personToken, canPasskey, syncShares } from '../core/service';
  import type { Core } from '../core/types';

  let { core }: { core: Core } = $props();
  let name = $state(''),
    busy = $state(false),
    why = $state('');
  let check: HTMLElement | undefined = $state();

  function close() {
    ui.sheet = null;
    ui.invite = '';
  }

  async function accept() {
    if (busy || !name.trim()) return;
    busy = true;
    why = '';
    try {
      const c = await service();
      if (!c) {
        why = 'Sharing works on the app as served from the web, not here.';
        return;
      }
      if (!c.turnstile) {
        why = 'The service is not set up yet: try again later.';
        return;
      }
      const token = await personToken(check!, c.turnstile, 'register');
      const r = await register(ui.invite, name, token);
      if (!r) {
        why = 'No passkey was made. Try again when you are ready.';
        return;
      }
      // (a passkey added for a new device: the shares from the others come here)
      const added = await syncShares(core).catch(() => 0);
      if (added) ui.libVersion++;
      toast(
        added
          ? `Welcome back, ${r.name}. ${added} shared book${added === 1 ? '' : 's'} from your other devices added.`
          : `Welcome, ${r.name}. Share a book from its card in the library: “Share as a link…”.`,
        6400,
      );
      close();
    } catch (e) {
      why = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<Sheet label="Accept the invitation to share books" onclose={close}>
  <div>
    <p class="eyebrow">An invitation</p>
    <h2>Share your books with readers</h2>
    <p class="where">Share books as links. Readers’ notes come back to you, and only you and they can read them.</p>
  </div>
  {#if !canPasskey()}
    <p class="hint">This browser can’t make a passkey. Try another browser, on a device with a screen lock.</p>
  {:else}
    <label class="svc-name">
      <span>Your name, as your readers will know you</span>
      <input
        type="text"
        bind:value={name}
        placeholder="Your name"
        maxlength="60"
        data-autofocus
        onkeydown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            accept();
          }
        }}
      />
    </label>
    <p class="where">You’ll sign in with a passkey: Face ID, a fingerprint or your PIN.</p>
    <div class="svc-check" bind:this={check}></div>
    {#if why}<p class="svc-why" role="alert">{why}</p>{/if}
  {/if}
  <div class="acts two">
    <button class="btn" onclick={close}>Not now</button>
    <button class="btn primary" disabled={busy || !name.trim() || !canPasskey()} onclick={accept}
      >{busy ? 'Making the passkey…' : 'Make my passkey'}</button
    >
  </div>
</Sheet>
