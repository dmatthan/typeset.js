<script lang="ts">
  /** Type and appearance, one small panel rising from the menu at the foot (a sheet on a
   *  phone): the size, the themes and the appearance first; everything else about the type
   *  one step in (Style), each a change from the theme's design that resets on its own.
   *  Nothing here blurs. */
  import { copyText } from '../core/clipboard';
  import { onMount, tick } from 'svelte';
  import { touchUI } from './touch';
  import type { Reader } from '../reader/reader.svelte';
  import { ui, toast } from '../state.svelte';
  import { settings, save, sizeOf, SIZES, type Settings, type Layout } from '../reader/settings.svelte';
  import { themes, allThemes, themeById, optionsOf, optionChanged, anyOptionChanged, setOption, resetOptions, resolve, loadFamily, deleteUserTheme, exportTheme, FACES, typeOf, chainOf, cssFamily, type Options, type Theme } from '../reader/themes.svelte';
  import { editor } from './editor.svelte';
  import { shell } from '../core/shell';

  let { reader, page: startPage = 'main' }: { reader: Reader; page?: Page } = $props();
  type Page = 'main' | 'style';
  // svelte-ignore state_referenced_locally
  let page = $state<Page>(startPage);
  let panel: HTMLElement;
  const prev = document.activeElement as HTMLElement | null;

  const theme = $derived(themeById(settings.theme));
  const o = $derived(optionsOf(theme));
  const dark = $derived(reader.isDark());
  const size = $derived.by(() => { ui.layoutVersion; return reader.M.fs; });

  $effect(() => { for (const t of themes.user) loadFamily(reader.core, t.type.family); });
  onMount(() => {
    focusFirst();
    const away = (e: PointerEvent) => {
      const t = e.target as Element;
      if (panel.contains(t) || t.closest?.('.wrap')) return;
      // a tap beside the panel only puts it away (on a phone it would turn the page too)
      if (e.pointerType !== 'mouse') e.stopPropagation();
      close();
    };
    window.addEventListener('pointerdown', away, true);
    // keys reach the panel wherever focus is while it is open
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true); prev?.focus?.({ preventScroll: true }); };
  });
  function focusFirst() { panel?.querySelector<HTMLElement>('[data-first]')?.focus({ preventScroll: true }); }
  async function go(p: Page) { page = p; await tick(); focusFirst(); }
  function close() { ui.sheet = null; }

  let relayT = 0;
  const relayout = () => { clearTimeout(relayT); relayT = window.setTimeout(() => reader.settingsChanged('layout'), 60); };
  // (a step from the theme's size, carried to every theme; none past either end of the scale)
  function setSize(d: number) {
    if (sizeOf(reader.look.size, settings.step + d) === sizeOf(reader.look.size)) return;
    settings.step += d; save(); relayout();
  }
  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    if (settings[k] === v) return;
    settings[k] = v; save();
    if (k === 'layout' || k === 'theme') relayout();
  }
  function opt<K extends keyof Options>(k: K, v: Options[K]) {
    if (o[k] === v) return;
    setOption(theme, k, v); relayout();
  }
  /** The sliders: each option's range and step. */
  // (the design at 0 in the middle of each change; line spacing the theme's own number)
  const R = { lineSpacing: [1, 2, 0.05], charSpacing: [-10, 10, 1], wordSpacing: [-50, 50, 5], margins: [-10, 10, 1] } as const;
  /** The faces this theme may be set in: the bundled ones, and its own if it is not one. */
  const faces = $derived(FACES.some(f => f.family === theme.type.family) ? FACES : [theme.type, ...FACES]);
  const pct = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '%';

  function cycleTheme(d: number) {
    const list = allThemes(), i = list.findIndex(t => t.id === theme.id);
    set('theme', list[(i + d + list.length) % list.length].id);
  }
  function newTheme() { editor.start(theme, true); ui.sheet = 'theme'; }
  function editTheme() { editor.start(theme, false); ui.sheet = 'theme'; }
  async function exportIt() {
    const text = exportTheme({ ...theme, type: typeOf(theme), options: o });
    if (await copyText(text)) toast('Theme copied as text');
    await shell.saveText(`${theme.name}.theme.json`, text, 'json').catch(() => {});
  }
  function deleteIt() {
    const name = theme.name;
    set('theme', 'book'); deleteUserTheme(theme.id); go('main');
    toast(`${name} deleted`);
  }

  const APPEAR: Settings['appearance'][] = ['auto', 'light', 'dark'];
  const LAYOUTS: Layout[] = ['auto', 1, 2, 3];

  /** The panel's keys, each what it does (every one listed in Help). Case matters: T and
   *  Shift+T go opposite ways. */
  const KEYS: Partial<Record<string, () => void>> = {
    Escape: () => (page !== 'main' ? go('main') : close()),
    s: close, S: close,
    '-': () => setSize(-1), _: () => setSize(-1), '=': () => setSize(1), '+': () => setSize(1),
    t: () => cycleTheme(1), T: () => cycleTheme(-1),
    p: () => set('appearance', APPEAR[(APPEAR.indexOf(settings.appearance) + 1) % 3]),
    '1': () => set('layout', 1), '2': () => set('layout', 2), '3': () => set('layout', 3), a: () => set('layout', 'auto'),
    c: () => go(page === 'style' ? 'main' : 'style'),
    b: () => opt('boldText', !o.boldText), j: () => opt('justify', !o.justify), y: () => opt('hyphenate', !o.hyphenate),
    n: newTheme,
  };
  /** Back to the panel's first page, from one further in. */
  const BACK = new Set(['Backspace', 'ArrowLeft', 'h']);

  function key(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || ui.sheet !== 'settings') return;
    const k = e.key;
    // (a field's keys are its own, and a slider's arrows move it)
    const typing = (e.target as Element).closest?.('input[type=text], input[type=range], input:not([type]), textarea, [contenteditable]');
    if (typing && k !== 'Escape') return;
    if (k === 'Tab') { trap(e); return; }
    const run = BACK.has(k) && page !== 'main' ? () => go('main') : k === '0' && page === 'style' ? () => { resetOptions(theme); relayout(); } : KEYS[k];
    if (!run) return;
    run();
    e.preventDefault(); e.stopImmediatePropagation();
  }
  function trap(e: KeyboardEvent) {
    const f = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), input')];
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }

  const card = (t: Theme) => {
    const p = resolve(t, dark).palette;
    return p ? `--pp:${p.paper};--pi:${p.ink};--pa:${p.accent}` : '';
  };
  const face = (t: Theme) => {
    const r = resolve(t, dark);
    const ax = r.axes.map(([k, v]) => `"${k}" ${v}, `).join('');
    return `font-family:${r.css};font-weight:${r.wght};font-variation-settings:${ax}"wght" ${r.wght}`;
  };
  // the cards' faces come in together once all have (or after a moment, for one slow to
  // come), not one by one as each arrives; at once where all are here already
  const cardFaces = () => allThemes().map(t => { const r = resolve(t, dark); return `${r.wght} 21px ${r.css}`; });
  let facesIn = $state(cardFaces().every(f => document.fonts.check(f, 'Aa')));
  $effect(() => {
    if (facesIn) return;
    const all = Promise.all(cardFaces().map(f => document.fonts.load(f, 'Aa').catch(() => [])));
    Promise.race([all, new Promise(r => setTimeout(r, 1000))]).then(() => (facesIn = true));
  });
</script>

{#snippet slider(label: string, k: keyof typeof R, value: string)}
  <label class="row sl">
    <span class="lbl">{label}{#if optionChanged(theme, k)}<span class="dot" title="Changed from {theme.name}’s design"></span>{/if}</span>
    <input type="range" min={R[k][0]} max={R[k][1]} step={R[k][2]} value={o[k]} aria-valuetext={value} oninput={e => opt(k, +e.currentTarget.value)} />
    <span class="val" aria-hidden="true">{value}</span>
  </label>
{/snippet}
{#snippet toggle(label: string, on: boolean, flip: () => void, keyName: string, changed = false)}
  <button class="row tg" role="switch" aria-checked={on} onclick={flip} title={keyName ? `${label} (${keyName})` : label}>
    <span class="lbl">{label}{#if changed}<span class="dot"></span>{/if}</span>
    <span class="sw" aria-hidden="true"></span>
  </button>
{/snippet}
{#snippet seg<T>(label: string, items: { v: T; t: string; k?: string }[], cur: T, pick: (v: T) => void)}
  <div class="seg" role="radiogroup" aria-label={label}>
    {#each items as it}
      <button role="radio" aria-checked={cur === it.v} onclick={() => pick(it.v)} title={it.k ? `${it.t} (${it.k})` : it.t}>{it.t}</button>
    {/each}
  </div>
{/snippet}

<div class="panel lift" bind:this={panel} role="dialog" aria-label="Type and appearance" tabindex="-1">
  {#key page}
    <div class="page">
      {#if page === 'main'}
        <div class="pill size" role="group" aria-label="Size">
          <button data-first onclick={() => setSize(-1)} aria-label="Smaller type" title="Smaller type (−)" disabled={size <= SIZES[0]}><span class="a1">A</span></button>
          <button onclick={() => setSize(1)} aria-label="Larger type" title="Larger type (+)" disabled={size >= SIZES[SIZES.length - 1]}><span class="a2">A</span></button>
        </div>
        <div class="themes" class:in={facesIn} role="radiogroup" aria-label="Theme">
          {#each allThemes() as t (t.id)}
            <button class="th" role="radio" aria-checked={t.id === theme.id} onclick={() => set('theme', t.id)}
              title={t.desktop && themes.desktop ? `${t.name}: colours from ${themes.desktop.name}` : `${t.name} (T)`}>
              <span class="aa" style="{card(t)};{face(t)}">Aa</span>
              <span class="nm">{t.name}</span>
            </button>
          {/each}
        </div>
        <div class="list">
          {@render toggle('Match device', settings.appearance === 'auto', () => set('appearance', settings.appearance === 'auto' ? (dark ? 'dark' : 'light') : 'auto'), 'P')}
          {#if settings.appearance !== 'auto'}
            <div class="row">
              <span class="lbl">Appearance</span>
              {@render seg('Appearance', [{ v: 'light', t: 'Light' }, { v: 'dark', t: 'Dark' }], settings.appearance, v => set('appearance', v as Settings['appearance']))}
            </div>
          {/if}
          <button class="row nav" onclick={() => go('style')} title="Style (C)">
            <span class="lbl">Style{#if anyOptionChanged(theme)}<span class="dot" title="Changed from {theme.name}’s design"></span>{/if}</span>
            <span class="sum">Font, spacing, margins <svg class="chev" viewBox="0 0 24 24"><path d="m10 7 5 5-5 5" /></svg></span>
          </button>
          {#if touchUI()}
            <button class="row nav" onclick={() => (ui.sheet = 'help')}>
              <span class="lbl">Gestures</span>
              <svg class="chev" viewBox="0 0 24 24"><path d="m10 7 5 5-5 5" /></svg>
            </button>
          {/if}
        </div>
      {:else}
        <header class="ph sub">
          <button class="back" data-first onclick={() => go('main')} aria-label="Back" title="Back (Esc)"><svg viewBox="0 0 24 24"><path d="m14 7-5 5 5 5" /></svg></button>
          <h2>Style</h2>
          <button class="txt" disabled={!anyOptionChanged(theme)} onclick={() => { resetOptions(theme); relayout(); }} title="Back to {theme.name}’s design (0)">Reset</button>
        </header>
        <div class="faces" role="radiogroup" aria-label="Font">
          {#each faces as f (f.family)}
            <button role="radio" aria-checked={o.face === f.family} onclick={() => opt('face', f.family)}>
              <span style="font-family: {cssFamily(chainOf(f), f.fallback)}">{f.family}</span>
              {#if f.family === theme.type.family}<span class="own">{theme.name}’s</span>{/if}
            </button>
          {/each}
        </div>
        <div class="list">
          {@render slider('Line spacing', 'lineSpacing', o.lineSpacing.toFixed(2))}
          {@render slider('Letters', 'charSpacing', pct(o.charSpacing))}
          {@render slider('Words', 'wordSpacing', pct(o.wordSpacing))}
          {@render slider('Margins', 'margins', pct(o.margins))}
        </div>
        <div class="list">
          {@render toggle('Justify', o.justify, () => opt('justify', !o.justify), 'J', optionChanged(theme, 'justify'))}
          {@render toggle('Hyphenate', o.hyphenate, () => opt('hyphenate', !o.hyphenate), 'Y', optionChanged(theme, 'hyphenate'))}
          {@render toggle('Bold text', o.boldText, () => opt('boldText', !o.boldText), 'B', optionChanged(theme, 'boldText'))}
          <!-- (a phone shows one page, whatever the columns) -->
          {#if !ui.phone}
            <div class="row">
              <span class="lbl">Columns</span>
              {@render seg('Columns', LAYOUTS.map(v => ({ v, t: v === 'auto' ? 'Auto' : String(v), k: v === 'auto' ? 'A' : String(v) })), settings.layout, v => set('layout', v as Layout))}
            </div>
            {#if settings.layout !== 'auto' && ui.colsReduced}<p class="note">Too narrow for {settings.layout} here; showing {ui.cols}.</p>{/if}
          {/if}
          {@render toggle('Less motion', settings.motion === 'reduce', () => set('motion', settings.motion === 'reduce' ? 'system' : 'reduce'), '')}
        </div>
        <div class="foot">
          <button class="txt" onclick={newTheme} title="New theme (N)">New theme from this</button>
          {#if !theme.builtin}
            <span class="sp"></span>
            <button class="txt" onclick={editTheme}>Edit</button>
            <button class="txt" onclick={exportIt}>Export</button>
            <button class="txt danger" onclick={deleteIt}>Delete</button>
          {/if}
        </div>
      {/if}
    </div>
  {/key}
</div>

<style>
  .panel {
    /* rising from the menu's button at the end of the foot, where it was asked for */
    position: absolute; z-index: 45; bottom: calc(env(safe-area-inset-bottom) + 64px); right: 10px; width: 344px; max-width: calc(100% - 20px); box-sizing: border-box;
    /* never past the window: the page scrolls inside the still frame (whose shadow is an
       image, so scrolling repaints nothing costly) */
    max-height: calc(100% - 76px); display: flex; flex-direction: column;
    background: var(--sheet); color: var(--ink); border-radius: var(--r-l); border: 1px solid var(--rule);
    outline: none; animation: open .2s cubic-bezier(.2, .8, .2, 1);
  }
  @keyframes open { from { opacity: 0; transform: translateY(6px) scale(.98); transform-origin: bottom right; } }
  .page { padding: 14px 14px 12px; display: grid; gap: 10px; animation: page .18s cubic-bezier(.2, .8, .2, 1); min-height: 0; overflow-y: auto; overflow-x: hidden; touch-action: pan-y; overscroll-behavior: contain; border-radius: inherit; }
  @keyframes page { from { opacity: 0; transform: translateX(10px); } }
  .ph { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 30px; padding: 0 2px; }
  .ph h2 { margin: 0; font: 650 var(--t-m)/1.2 var(--f-ui); color: var(--ink); flex: 1; }
  .ph.sub h2 { text-align: center; }
  .ph.sub > :last-child { min-width: 52px; text-align: right; }
  button { appearance: none; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; padding: 0; }
  button:disabled { opacity: .35; cursor: default; }
  svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: var(--stroke); stroke-linecap: round; stroke-linejoin: round; }
  .back { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; color: var(--ink-2); background: var(--read); }
  :global(html:not(.touchui)) .back:hover { background: var(--hover); }
  :global(.touchui) .back { width: 40px; height: 40px; }
  .txt { font: 500 var(--t-s)/1 var(--f-ui); color: var(--accent); padding: 6px 4px; border-radius: var(--r-s); }
  .txt.danger { color: var(--danger); }

  .pill { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; background: var(--read); border-radius: var(--r-m); padding: 3px; gap: 3px; }
  .pill button { height: 38px; border-radius: calc(var(--r-m) - 3px); display: grid; place-items: center; color: var(--ink-2); }
  :global(html:not(.touchui)) .pill button:hover:not(:disabled) { background: var(--hover); }
  .a1 { font: 600 14px/1 var(--f-book); }
  .a2 { font: 600 22px/1 var(--f-book); }

  .themes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 6px; padding: 2px 0; }
  .th { display: grid; justify-items: center; gap: 6px; padding: 4px 0; border-radius: var(--r-m); color: var(--ink-2); }
  .th .aa {
    --pp: oklch(0.982 0.006 80); --pi: var(--ink);
    width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; background: var(--pp);
    font-size: 21px; line-height: 1; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pi) 16%, transparent);
    color: transparent; transition: color var(--calm);
  }
  .themes.in .th .aa { color: var(--pi); }
  :global([data-theme="dark"]) .th .aa { --pp: oklch(0.205 0.006 80); }
  @media (prefers-color-scheme: dark) { :global(:root:not([data-theme="light"])) .th .aa { --pp: oklch(0.205 0.006 80); } }
  /* (a line as tall as its face: the ellipsis clips, and 1.2 lost the foot of a p) */
  .th .nm { font: 500 13px/1.4 var(--f-ui); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .th[aria-checked="true"] { color: var(--ink); }
  .th[aria-checked="true"] .aa { box-shadow: 0 0 0 2px var(--sheet), 0 0 0 4px var(--accent); }
  .th:focus-visible { outline-offset: 3px; }

  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 42px; padding: 0 4px; width: 100%; box-sizing: border-box; text-align: left; border-radius: var(--r-s); }
  .row.nav, .row.tg { cursor: pointer; }
  .sum { display: inline-flex; align-items: center; gap: 2px; font: 400 var(--t-s)/1 var(--f-ui); color: var(--ink-3); }
  /* the faces, each named in itself */
  .faces { display: grid; padding: 3px; border-radius: var(--r-m); background: var(--read); }
  .faces button { height: 34px; padding: 0 10px; border-radius: calc(var(--r-m) - 3px); display: flex; align-items: center; justify-content: space-between; font-size: 16px; color: var(--ink); }
  .faces button[aria-checked="true"] { background: var(--sheet); box-shadow: 0 0 0 1px var(--rule); }
  :global(html:not(.touchui)) .faces button:not([aria-checked="true"]):hover { background: var(--hover); }
  .faces .own { font: 400 13px/1 var(--f-ui); color: var(--ink-3); }
  .row.sl { display: grid; grid-template-columns: 96px minmax(0, 1fr) 44px; gap: 10px; }
  /* its value at a glance, as Apple's: a number, or the change from the design */
  .val { font: 500 var(--t-s)/1 var(--f-ui); color: var(--ink-2); font-variant-numeric: tabular-nums; text-align: right; }
  .sl input { width: 100%; margin: 0; accent-color: var(--accent); }
  :global(html:not(.touchui)) .row.nav:hover, :global(html:not(.touchui)) .row.tg:hover { background: var(--hover); }
  .lbl { display: inline-flex; align-items: center; gap: 8px; font: 500 var(--t-s)/1.25 var(--f-ui); color: var(--ink); }
  .chev { width: 18px; height: 18px; color: var(--ink-3); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
  .seg { display: inline-grid; grid-auto-flow: column; background: var(--read); border-radius: var(--r-m); padding: 3px; gap: 2px; }
  .seg button { height: 30px; min-width: 40px; padding: 0 10px; border-radius: calc(var(--r-m) - 3px); font: 600 13px/1 var(--f-ui); color: var(--ink-2); }
  :global(html:not(.touchui)) .seg button:not([aria-checked="true"]):hover { background: var(--hover); }
  .seg button[aria-checked="true"] { background: var(--sheet); color: var(--ink); box-shadow: 0 0 0 1px var(--rule); }
  .note { margin: -4px 4px 0; font: 500 13px/1.4 var(--f-ui); color: var(--ink-3); }

  .list { display: grid; }
  .list > :global(*) + :global(*) { border-top: 1px solid var(--rule); border-radius: 0; }
  .sw { flex: none; width: 40px; height: 24px; border-radius: 12px; background: var(--rule); position: relative; transition: background-color var(--quick); }
  .sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: var(--surface); box-shadow: 0 1px 2px oklch(0 0 0 / .25); transition: transform var(--quick); }
  [aria-checked="true"] > .sw { background: var(--accent); }
  [aria-checked="true"] > .sw::after { transform: translateX(16px); }
  .foot { display: flex; align-items: center; gap: 4px; padding: 2px 0 0; border-top: 1px solid var(--rule); padding-top: 8px; }
  .foot .sp { flex: 1; }
  /* short windows (a laptop at 200%): denser, so it still fits without scrolling */
  @media (max-height: 700px) {
    .page { gap: 6px; padding: 10px 12px 10px; }
    .th { height: 58px; }
    .th .aa { font-size: 22px; }
    .row { min-height: 36px; }
    .pill button { height: 32px; }
  }
  /* a phone: a sheet from the bottom edge, the width of the screen, above the home
     indicator; controls a finger can hit (44 px) */
  @media (max-width: 640px) {
    .panel {
      top: auto; left: 0; right: 0; bottom: var(--kb, 0px); width: auto; max-width: none;
      max-height: calc(100% - 52px - env(safe-area-inset-top));
      border-radius: var(--r-l) var(--r-l) 0 0; border-width: 1px 0 0;
      animation: rise .28s cubic-bezier(.2, .8, .2, 1);
    }
    .page { padding: 14px 16px calc(12px + env(safe-area-inset-bottom)); gap: 10px; }
    .th { height: 60px; }
    .th .aa { font-size: 22px; }
  }
  @keyframes rise { from { transform: translateY(24px); opacity: 0; } }
  :global(.touchui) .pill button { height: 42px; }
  :global(.touchui) .row { min-height: 44px; }
  :global(.touchui) .seg button { height: 38px; min-width: 46px; }
  :global(.touchui) .txt { padding: 12px 6px; }
</style>
