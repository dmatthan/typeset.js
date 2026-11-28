<script lang="ts">
  /** A theme made or edited: a name, a face and a paper; the rest is ours (the face's
   *  weights and axes, ink and accent fitted to the paper, its night, the size and settings
   *  of the theme it began from). Or one read from a file, or from an AI's answer to the
   *  brief. */
  import { copyText } from '../core/clipboard';
  import Sheet from './Sheet.svelte';
  import type { Reader } from '../reader/reader.svelte';
  import { ui, toast } from '../state.svelte';
  import { settings, save, sizeOf } from '../reader/settings.svelte';
  import {
    FACES,
    systemFamilies,
    loadFamily,
    chainOf,
    cssFamily,
    saveUserTheme,
    resetOptions,
    parseTheme,
    aiBrief,
    onto,
    nightOf,
    typeFor,
    STOCK,
  } from '../reader/themes.svelte';
  import { editor } from './editor.svelte';

  let { reader }: { reader: Reader } = $props();
  const d = $derived(editor.draft!);
  let importing = $state(false);
  let pasted = $state('');
  let importError = $state('');
  let missing = $state(false);
  let installed = $state<string[]>([]);
  let fileInput = $state<HTMLInputElement>();

  // svelte-ignore state_referenced_locally
  systemFamilies(reader.core).then(v => (installed = v));
  // the chosen face, loaded for the preview (installed ones come over as FontFaces)
  $effect(() => {
    const fam = d.type.family;
    loadFamily(reader.core, fam).then(info => {
      if (editor.draft?.type.family === fam) missing = !info;
    });
  });

  // (the reading faces, as Style lists them)
  const faces = FACES.map(f => f.family);
  const day = $derived(d.light ?? STOCK.light);
  // (the preview as the theme will look now: by night where the reader is)
  const pal = $derived(reader.appearance.isDark() ? (d.dark ?? STOCK.dark) : day);
  const previewStyle = $derived.by(() => {
    const t = d.type,
      o = d.options;
    const w = o.boldText ? t.boldText : t.weight;
    const ax = Object.entries(t.axes)
      .map(([k, v]) => `"${k}" ${v}, `)
      .join('');
    // (as the reader would set it: the theme's size, this screen's, the reader's steps)
    const fs = sizeOf(d.size);
    return [
      `background:${pal.paper}`,
      `color:${pal.ink}`,
      `--acc:${pal.accent}`,
      `font-family:${cssFamily(chainOf(t), t.fallback)}`,
      `font-size:${fs}px`,
      `line-height:${Math.round(fs * o.lineSpacing)}px`,
      `font-weight:${w}`,
      `font-variation-settings:${ax}"wght" ${w}`,
      `--wB:${Math.min(1000, t.bold + (w - t.weight))}`,
      `--ax:${ax}`,
      `text-align:${o.justify ? 'justify' : 'left'}`,
    ].join(';');
  });

  function pickFace(family: string) {
    if (family) d.type = typeFor(family);
  }
  // the paper chosen, the rest fitted to it: the day's ink and accent kept where they read
  function pickPaper(paper: string) {
    d.light = onto(paper, day);
    d.dark = nightOf(d.light);
  }

  function saveIt() {
    const t = $state.snapshot(d);
    t.name = t.name.trim() || 'My theme';
    saveUserTheme(t);
    // the design now carries any customisation it started from
    resetOptions(t);
    settings.theme = t.id;
    save();
    reader.settingsChanged('layout');
    toast(`${t.name} saved`);
    ui.sheet = 'settings';
  }

  function useImport(text: string) {
    const r = parseTheme(text);
    if ('error' in r) {
      importError = r.error;
      return;
    }
    const keep = editor.isNew ? r.theme.id : d.id;
    editor.draft = { ...r.theme, id: keep };
    editor.notes = r.notes;
    importError = '';
    importing = false;
    pasted = '';
  }
  async function pickFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) useImport(await f.text());
    (e.target as HTMLInputElement).value = '';
  }
  async function copyBrief() {
    const text = aiBrief(installed);
    if (await copyText(text)) toast('Brief copied.');
    else {
      pasted = text;
      toast('Copy the brief from the box');
    }
  }
</script>

<Sheet label={editor.isNew ? 'New theme' : 'Edit theme'} onclose={() => (ui.sheet = 'settings')} wide>
  <input class="name" bind:value={d.name} maxlength="40" aria-label="Theme name" spellcheck="false" />
  {#if editor.notes.length}<div class="notes">
      {#each editor.notes as n}<p>{n}</p>{/each}
    </div>{/if}

  <div class="body">
    <div class="form">
      <div class="faces" role="radiogroup" aria-label="Face">
        {#each faces as f (f)}
          {@const t = typeFor(f)}
          <button
            role="radio"
            aria-checked={d.type.family === f}
            onclick={() => pickFace(f)}
            style="font-family: {cssFamily(chainOf(t), t.fallback)}">{f}</button
          >
        {/each}
      </div>
      <!-- (a face installed on this computer, where there are any) -->
      {#if installed.length}
        <input
          class="field"
          list="families"
          value={faces.includes(d.type.family) ? '' : d.type.family}
          onchange={e => pickFace(e.currentTarget.value.trim())}
          placeholder="Another font on this computer"
          aria-label="Another font"
          spellcheck="false"
        />
        <datalist id="families"
          >{#each installed as f}<option value={f}></option>{/each}</datalist
        >
      {/if}
      {#if missing}<p class="hint warn">
          {d.type.family} is not installed here; {d.type.fallback === 'sans' ? 'Inter' : 'Literata'} stands in.
        </p>{/if}
      <label class="paper">
        <span>Paper</span>
        <input type="color" value={day.paper} oninput={e => pickPaper(e.currentTarget.value)} aria-label="Paper" />
      </label>
    </div>

    <div class="preview" style={previewStyle} aria-label="Preview">
      <p class="pv-h">Chapter I</p>
      <p>
        Miss Brooke had that kind of beauty which seems to be thrown into relief by poor dress. Her hand and wrist were
        so finely formed that she could wear sleeves not less bare of style than those in which the Blessed Virgin
        appeared to <i>Italian painters</i>.
      </p>
      <p class="ind">
        She was usually spoken of as being <mark>remarkably clever</mark>, but with the addition that her sister Celia
        had more <b>common-sense</b>.
      </p>
    </div>
  </div>

  <!-- a theme from elsewhere: a file, or an AI's answer to the brief -->
  <button
    class="from"
    aria-expanded={importing}
    onclick={() => {
      importing = !importing;
      importError = '';
    }}>From a file or an AI’s answer…</button
  >
  {#if importing}
    <div class="import">
      <textarea
        bind:value={pasted}
        rows="6"
        spellcheck="false"
        placeholder="Paste a theme here: a file’s contents, or an AI’s answer to the brief."
        aria-label="Theme to import"
      ></textarea>
      {#if importError}<p class="err">{importError}</p>{/if}
      <div class="i-acts">
        <button
          class="btn quiet"
          onclick={copyBrief}
          title="A brief an AI can follow to design a theme you can paste back here">Copy brief</button
        >
        <button class="btn quiet" onclick={() => fileInput?.click()}>Open a file…</button>
        <button class="btn primary" disabled={!pasted.trim()} onclick={() => useImport(pasted)}>Use this theme</button>
      </div>
      <input type="file" accept=".json,application/json,text/plain" hidden bind:this={fileInput} onchange={pickFile} />
    </div>
  {/if}

  <div class="acts two">
    <button class="btn quiet" onclick={() => (ui.sheet = 'settings')}>Cancel</button>
    <button class="btn primary" onclick={saveIt}>{editor.isNew ? 'Save theme' : 'Save changes'}</button>
  </div>
</Sheet>

<style>
  .name {
    font: 650 var(--t-xl) / 1.2 var(--f-ui);
    color: var(--ink);
    background: transparent;
    border: 0;
    border-bottom: 1.5px solid var(--rule);
    padding: 2px 0 4px;
    outline: none;
    min-width: 0;
  }
  .name:focus {
    border-bottom-color: var(--accent);
  }
  .import {
    display: grid;
    gap: 8px;
  }
  .import textarea {
    box-sizing: border-box;
    width: 100%;
    resize: vertical;
    border-radius: var(--r-m);
    border: 1.5px solid var(--rule);
    background: var(--surface);
    color: var(--ink);
    font:
      500 13px/1.45 ui-monospace,
      'JetBrains Mono',
      monospace;
    padding: 10px 12px;
    outline: none;
  }
  .import textarea:focus {
    border-color: var(--accent);
  }
  .i-acts {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 6px;
  }
  .i-acts :global(.btn) {
    min-height: 38px;
    padding: 0 12px;
    font-size: var(--t-s);
  }
  .err {
    margin: 0;
    font: 600 var(--t-s) / 1.4 var(--f-ui);
    color: oklch(0.55 0.17 30);
  }
  .notes {
    border-radius: var(--r-m);
    background: var(--wash);
    padding: 8px 12px;
  }
  .notes p {
    margin: 2px 0;
    font: 500 var(--t-s) / 1.45 var(--f-ui);
    color: var(--ink-2);
  }
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
  }
  @media (min-width: 720px) {
    .body {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: start;
    }
  }
  .form {
    display: grid;
    gap: 12px;
  }
  /* the faces, each named in itself (as Style lists them) */
  .faces {
    display: grid;
    padding: 3px;
    border-radius: var(--r-m);
    background: var(--read);
  }
  .faces button {
    appearance: none;
    border: 0;
    background: none;
    cursor: pointer;
    height: 40px;
    padding: 0 12px;
    border-radius: calc(var(--r-m) - 3px);
    text-align: left;
    font-size: 17px;
    color: var(--ink);
  }
  .faces button[aria-checked='true'] {
    background: var(--sheet);
    box-shadow: 0 0 0 1px var(--rule);
  }
  .field {
    box-sizing: border-box;
    width: 100%;
    min-height: 42px;
    border-radius: var(--r-m);
    border: 1.5px solid var(--rule);
    background: transparent;
    color: var(--ink);
    font: 500 var(--t-m) / 1 var(--f-ui);
    padding: 0 12px;
    outline: none;
  }
  .field:focus {
    border-color: var(--accent);
  }
  .hint {
    margin: 0;
    font: 500 var(--t-s) / 1.4 var(--f-ui);
    color: var(--ink-2);
  }
  .warn {
    color: oklch(0.58 0.14 60);
  }
  /* the paper: its name and a round swatch to choose it */
  .paper {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 44px;
    font: 500 var(--t-m) / 1.2 var(--f-ui);
    color: var(--ink);
    cursor: pointer;
  }
  .paper input {
    appearance: none;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    cursor: pointer;
  }
  .paper input::-webkit-color-swatch-wrapper {
    padding: 0;
  }
  .paper input::-webkit-color-swatch {
    border: 1px solid color-mix(in srgb, var(--ink) 20%, transparent);
    border-radius: 50%;
  }
  .paper input::-moz-color-swatch {
    border: 1px solid color-mix(in srgb, var(--ink) 20%, transparent);
    border-radius: 50%;
  }
  .from {
    appearance: none;
    border: 0;
    background: none;
    padding: 0;
    justify-self: start;
    cursor: pointer;
    font: 500 var(--t-s) / 1.4 var(--f-ui);
    color: var(--ink-2);
    text-decoration: underline;
    text-decoration-color: var(--rule);
    text-underline-offset: 3px;
  }
  .preview {
    border-radius: var(--r-l);
    padding: 24px 26px 28px;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 10%, transparent);
    hyphens: auto;
    font-synthesis: none;
    transition:
      background-color var(--calm),
      color var(--calm);
  }
  .preview p {
    margin: 0;
  }
  .preview .ind {
    text-indent: 1.3em;
  }
  .preview .pv-h {
    font-size: 1.3em;
    line-height: 1.25;
    margin-bottom: 0.7em;
    text-align: left;
  }
  .preview b {
    font-weight: var(--wB);
    font-variation-settings: var(--ax) 'wght' var(--wB);
  }
  .preview mark {
    color: inherit;
    background: color-mix(in srgb, var(--acc) 26%, transparent);
    border-radius: 0.25em;
    padding: 0 0.08em;
  }
</style>
