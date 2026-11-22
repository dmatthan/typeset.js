<script lang="ts">
  /** One book in another site's page (core/embed.ts): the reader and what the page allows
   *  of it, told to the page as it goes and moved by it on request. Nothing of the app's
   *  own: no library, no sharing, no history. */
  import type { Core } from '../core/types';
  import { embedOpts, embeddedBook, onCommand, tellPage } from '../core/embed';
  import { settings } from '../reader/settings.svelte';
  import { onPaper, themeById, themes, parseTheme } from '../reader/themes.svelte';
  import { ui } from '../state.svelte';
  import { reading } from './reading.svelte';
  import { readerKey, type Keyed } from './keys';
  import ReaderView from './ReaderView.svelte';
  import Shell from './Shell.svelte';

  let { core }: { core: Core } = $props();
  // svelte-ignore state_referenced_locally
  const { reader, contents } = reading(core);
  let findBar: any = $state();
  let chip: any = $state();
  const keyed: Keyed = { reader, contents, get chip() { return chip; }, get findBar() { return findBar; } };

  /** A theme by its name, or one the page made (`typeset-theme/1`, checked as any theme
   *  file is); for this visit only. False if it is neither. */
  function useTheme(t: unknown): boolean {
    if (typeof t === 'string') {
      if (themeById(t).id !== t) return false;
      settings.theme = t;
      return true;
    }
    const parsed = t && typeof t === 'object' ? parseTheme(JSON.stringify(t)) : null;
    if (!parsed || 'error' in parsed) return false;
    themes.user = [...themes.user.filter(u => u.id !== 'page'), { ...parsed.theme, id: 'page' }];
    settings.theme = 'page';
    return true;
  }

  let error = $state('');
  if (embedOpts.theme) useTheme(embedOpts.theme);
  // the page's own paper: its theme on that paper, read light or dark as the paper is (for
  // this visit; the reader may choose another in Aa)
  if (embedOpts.paper) {
    const on = onPaper(themeById(settings.theme), embedOpts.paper);
    if (on) {
      themes.user = [...themes.user.filter(u => u.id !== 'page'), on.theme];
      settings.theme = 'page'; settings.appearance = on.dark ? 'dark' : 'light';
    }
  }
  // svelte-ignore state_referenced_locally
  embeddedBook(core)
    .then(async r => {
      if ('error' in r) { error = r.error; return; }
      await reader.open(r.id);
      tellPage('ready', { title: reader.book?.title ?? '', chapters: reader.book?.sections.filter(s => s.k === 1).length ?? 0 });
    })
    .catch(e => { error = `The book could not be opened (${(e as Error).message}).`; })
    .finally(() => { if (error) tellPage('error', { message: error }); });

  onCommand(async c => {
    if (!reader.book || !reader.strip) return;
    // (a place named before the whole book is set would be travelled to by estimate)
    await reader.whole;
    if (!reader.strip) return;
    // (a theme is a face and its spacing as much as colours: the text is set again for it)
    if (c.type === 'theme') { if (useTheme(c.theme)) await reader.settingsChanged('layout'); return; }
    // a chapter (counted from 1, as the page counts them), or a fraction of the book
    const chapters = reader.book.sections.flatMap((s, i) => (s.k === 1 ? [i] : []));
    const sec = c.chapter !== undefined ? chapters[c.chapter - 1] : undefined;
    if (sec !== undefined) reader.travelTo(reader.strip.secStart[sec]);
    else if (c.at !== undefined) reader.travelTo(Math.round(c.at * (reader.strip.N - 1)));
  });

  function onKey(e: KeyboardEvent) {
    if (readerKey(e, keyed)) e.preventDefault();
  }
</script>

<svelte:window onkeydown={onKey} onkeyup={e => reader.input.keyUp(e)} onblur={() => reader.input.blur()} />

<Shell>
  {#if ui.view !== 'reader'}<p class="failed embed-wait" role="status">{error || 'Opening the book…'}</p>{/if}
  <ReaderView {reader} {contents} hidden={ui.view !== 'reader'} bind:chip bind:findBar />
</Shell>
