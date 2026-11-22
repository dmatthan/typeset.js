<script lang="ts">
  /** The app: the library and the reader, books by link, the sharing service. (A book in
   *  another site's page has a shell of its own: Embed.svelte.) */
  import { joinedOf, newerDraft, sendQuietly } from '../core/service';
  import { openFromLink } from './links';
  import type { Core } from '../core/types';
  import { ui, toast } from '../state.svelte';
  import { settings } from '../reader/settings.svelte';
  import { themes, readDesktop, setOption, resetOptions, themeById } from '../reader/themes.svelte';
  import { fitStats, resetFitStats, residual } from '../reader/verify';
  import { shell, isTauri } from '../core/shell';
  import { seedSample, type webCore } from '../core/web';
  import { flushKV, kv } from '../core/kv';
  import { reading } from './reading.svelte';
  import { readerKey, typing, type Keyed } from './keys';
  import Library from './Library.svelte';
  import ReaderView from './ReaderView.svelte';
  import Shell from './Shell.svelte';
  import SendSheet from './SendSheet.svelte';
  import WelcomeSheet from './WelcomeSheet.svelte';
  import FeedbackExportSheet from './FeedbackExportSheet.svelte';
  import NewDraftSheet from './NewDraftSheet.svelte';

  let { core }: { core: Core } = $props();
  // svelte-ignore state_referenced_locally
  const { reader, contents } = reading(core);
  // a book sent by link: the reader's notes go back by themselves, if they changed
  reader.onNotes = (id, notes) => { if (joinedOf(id)) sendQuietly(id, notes()); };
  shell.beforeQuit = async () => {
    reader.flush();
    await flushKV();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  };
  shell.watchClose();
  // tests drive the reader directly in development builds
  if (import.meta.env.DEV) {
    (window as any).__typeset = { reader, contents, ui, kv, settings, themes, setOption, resetOptions, themeById, fitStats, resetFitStats, residual };
    if (isTauri) (async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      if (!(await invoke<boolean>('selftest_mode'))) return;
      const t = await import('../selftest');
      const arg = await invoke<string>('selftest_arg');
      const log = (s: string) => invoke<void>('dev_log', { msg: s });
      // TYPESET_SELFTEST=<name>: one of these; anything else, the full test
      const probes: Record<string, () => Promise<unknown>> = {
        wheel: () => t.wheelProbe(reader, log), sheet: () => t.sheetProbe(reader, log), content: () => t.contentProbe(reader, log),
        library: () => t.libraryProbe(reader, log), search: () => t.searchProbe(reader, log), probe: () => t.probeStrings(reader, log), scale: () => t.scaleProbe(reader, log),
      };
      // a self-test must always end: on failure it says why, and a watchdog quits a stall
      const dog = setTimeout(async () => { await log('{"error":"watchdog: the self-test ran over its time"}'); shell.quit(); }, arg === 'wheel' ? 90000 : arg === 'scale' ? 480000 : 180000);
      try { await (probes[arg] ?? (() => t.selftest(reader, log)))(); }
      catch (e) { await log(JSON.stringify({ error: String((e as Error)?.message || e) })); }
      finally { clearTimeout(dog); await shell.quit(); }
    })();
  }
  let library: Library | undefined = $state();
  let findBar: any = $state();
  let chip: any = $state();
  const keyed: Keyed = { reader, contents, get chip() { return chip; }, get findBar() { return findBar; } };

  // a book that came by link: has the writer sent a newer draft? (asked each time it
  // opens, one small request; never while it is read)
  let draftAskedFor = '';
  $effect(() => {
    // (the view and title are what change as a book opens; the reader's book is not state)
    const id = ui.view === 'reader' && ui.title ? reader.book?.id : undefined;
    if (!id) { draftAskedFor = ''; return; }
    if (draftAskedFor === id || !joinedOf(id)) return;
    draftAskedFor = id;
    newerDraft(id).then(v => {
      if (v && reader.book?.id === id && !ui.sheet) { ui.newDraft = v; ui.sheet = 'newdraft'; }
    }).catch(() => {});
  });

  // The phone's back gesture (and the browser's back): closes what is on top, a sheet, a
  // large image, the contents, then the book. Each layer that opens adds a history entry; one
  // the app closes itself takes its entry back, so history holds only what is open.
  const layers = () => (ui.view === 'reader' ? 1 : 0) + (ui.contents ? 1 : 0) + (ui.sheet ? 1 : 0) + (ui.lightbox ? 1 : 0);
  let shown = 0, popped = 0, unwinding = 0;
  $effect(() => {
    const n = layers();
    if (n > shown) for (let i = shown; i < n; i++) history.pushState({ vol: i + 1 }, '');
    else if (n < shown) {
      // closed by back: its entry is gone already; closed by the app: take it back
      const own = shown - n - Math.min(popped, shown - n);
      popped = Math.max(0, popped - (shown - n));
      // (one popstate however many steps)
      if (own > 0) { unwinding++; history.go(-own); }
    }
    shown = n;
  });
  addEventListener('popstate', () => {
    if (unwinding > 0) { unwinding--; return; }
    if (!layers()) return;
    popped++;
    if (ui.lightbox) ui.lightbox = null;
    else if (ui.sheet) ui.sheet = null;
    else if (ui.contents) contents.close();
    else if (ui.view === 'reader') reader.close();
  });

  // svelte-ignore state_referenced_locally
  readDesktop(core);
  // a book or notes that came by link
  // svelte-ignore state_referenced_locally
  const fromLink = () => openFromLink(core, reader);
  fromLink();
  addEventListener('hashchange', fromLink);

  // the web build's first run: the sample book, added while the library already shows
  // svelte-ignore state_referenced_locally
  if ('importSample' in core) {
    // svelte-ignore state_referenced_locally
    seedSample(core as ReturnType<typeof webCore>)
      .then(() => ui.libVersion++)
      .catch(e => toast(`The sample book could not be added (${(e as Error).message}).`, 6000));
  }
  if (isTauri) import('@tauri-apps/api/event').then(({ listen }) => listen('typeset://desktop', () => readDesktop(core)));

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey && e.key === 'q' && !e.metaKey && !e.altKey) { e.preventDefault(); reader.flush(); shell.quit(); return; }
    if (readerKey(e, keyed)) { e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || ui.sheet || typing(e.target)) return;
    if (ui.view === 'library') { if (library?.key(e)) e.preventDefault(); return; }
    // the book closes, back to the library (the contents and the chip keep Q for themselves)
    if ((e.key === 'q' || e.key === 'Q') && !ui.contents && !ui.chip) { e.preventDefault(); reader.close(); }
  }
</script>

<svelte:window onkeydown={onKey} onkeyup={e => reader.input.keyUp(e)} onblur={() => reader.input.blur()} />

<Shell>
  <Library bind:this={library} {core} {reader} hidden={ui.view !== 'library'} />
  <ReaderView {reader} {contents} hidden={ui.view !== 'reader'} bind:chip bind:findBar />
  {#if ui.view === 'reader' && reader.book}
    {#if ui.sheet === 'send'}<SendSheet {reader} />{/if}
    {#if ui.sheet === 'welcome'}<WelcomeSheet {reader} />{/if}
    {#if ui.sheet === 'newdraft' && ui.newDraft}<NewDraftSheet {reader} />{/if}
  {/if}
  {#if ui.view === 'reader' && ui.sheet === 'fbexport' && reader.fb}<FeedbackExportSheet {reader} />{/if}
</Shell>
