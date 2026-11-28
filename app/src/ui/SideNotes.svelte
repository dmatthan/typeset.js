<script lang="ts">
  /** Notes beside their lines. With the rail (ui.railed: a wide window, asked for), every
   *  note in the columns in view, each level with its line in the rail beside the text,
   *  one's own edited in place; a note being written (ui.composing) has a card of its own
   *  there. Without it, the notes asked for (a dot pointed at, `;`) over the column, below
   *  their highlight. Cards never overlap, and keep within the stage and off the bar (and,
   *  with the rail, its foot). The rail begins under the bar, which stays over it, whole:
   *  its controls are the window's. Its foot says how many notes the book has, goes to
   *  the one before or after the page, and puts the rail away. */
  import { onMount, tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import { embedOpts } from '../core/embed';
  import { me } from '../core/identity';
  import { count, when } from '../core/say';
  import { BAR, insets } from '../reader/geometry';
  import { type Reader } from '../reader/reader.svelte';
  import { ui, toast } from '../state.svelte';

  let { reader }: { reader: Reader } = $props();
  const GAP = 10,
    EDGE = 12;

  /** A card: one's own note, or another reader's (theirs to read and settle, not to edit),
   *  with when it was written. */
  interface Card {
    id: string;
    note: string;
    color: number;
    who: string;
    at: number;
    reader?: string;
    rc?: number;
    top: number;
    left: number;
    width: number;
    x: number;
  }
  function noteOf(id: string): Omit<Card, 'id' | 'top' | 'left' | 'width' | 'x'> | null {
    if (id.includes('|')) {
      const f = reader.fb?.find(id);
      return f?.n.note
        ? { note: f.n.note, color: 0, who: f.reader, at: f.n.updated, reader: f.reader, rc: f.colour }
        : null;
    }
    const a = reader.ann?.list.find(x => x.id === id);
    return a && (a.note || id === ui.composing) ? { note: a.note, color: a.color, who: 'You', at: a.updated } : null;
  }
  let cards: Card[] = $state([]);
  let box: HTMLElement;
  /** Where the bar's band ends (cards and the rail begin below it). */
  let band = $state(0);
  /** The columns with notes, and the nearest before and after those in view. */
  const cols = $derived.by(() => {
    ui.annVersion;
    ui.layoutVersion;
    return ui.railed ? reader.noteCols() : [];
  });
  const prev = $derived(cols.findLast(k => k < ui.page - 1) ?? null);
  const next = $derived(cols.find(k => k > ui.page - 1 + ui.cols - 1) ?? null);
  /** The card being written in, and what it says so far. */
  let editing = $state(''),
    text = $state('');

  /** The notes the cards are for: with the rail, every one in view; else those asked for. */
  function ids(): string[] {
    if (!ui.railed) return ui.sideNotes?.ids ?? [];
    const out: string[] = [];
    for (const k of reader.focusCols())
      for (const d of reader.surface.columnEl(k)?.querySelectorAll<HTMLElement>('.nd') ?? []) out.push(d.dataset.a!);
    if (ui.composing && !out.includes(ui.composing)) out.push(ui.composing);
    return out;
  }

  function place() {
    const stage = reader.stage,
      M = reader.M;
    if (!stage || !M || !reader.strip) {
      cards = [];
      return;
    }
    const st = stage.getBoundingClientRect();
    band = insets().t + (embedOpts.ui === 'none' ? 0 : BAR);
    const out: Card[] = [];
    for (const id of ids()) {
      const a = noteOf(id);
      // where its passage is: the dot beside its line, or (a note not yet written) its highlight
      const at =
        stage.querySelector<HTMLElement>(`.nd[data-a="${CSS.escape(id)}"]`) ??
        stage.querySelector<HTMLElement>(`mark[data-a="${CSS.escape(id)}"]`);
      if (!a || !at) continue;
      const r = at.getBoundingClientRect();
      const y = r.top + r.height / 2 - st.top;
      let left: number, width: number, top: number;
      if (ui.railed) {
        // in the rail, level with its line
        left = M.W + 20;
        width = st.width - M.W - 40;
        top = y - M.lh / 2;
      } else {
        // over the column, just below the end of its highlight
        const col = at.closest('.col')!.getBoundingClientRect();
        width = Math.min(360, col.width);
        left = Math.max(EDGE, Math.min(col.left - st.left, st.width - width - EDGE));
        let end = y + M.lh / 2;
        for (const m of stage.querySelectorAll<HTMLElement>(`mark[data-a="${CSS.escape(id)}"]`)) {
          const mr = m.getBoundingClientRect();
          if (mr.left >= col.left - 1 && mr.right <= col.right + 1) end = Math.max(end, mr.bottom - st.top);
        }
        top = end + 4;
      }
      // (where its passage begins along the line: two on one line keep their reading order)
      const start = stage.querySelector(`mark[data-a="${CSS.escape(id)}"]`)?.getBoundingClientRect().left ?? r.left;
      out.push({ id, ...a, top, left, width, x: start });
    }
    cards = out.sort((p, q) => Math.round((p.top - q.top) / M.lh) || p.x - q.x);
    if (ui.composing && editing !== ui.composing) {
      editing = ui.composing;
      text = '';
    }
  }

  /** Once drawn: stacked so none overlaps another, and all within the stage. The card in
   *  use (being written) keeps its line and the others make room around it, those above
   *  rising, those below falling; otherwise each goes as near its line as the one above
   *  allows, and a stack past the bottom rises. */
  async function settle() {
    await tick();
    const els = [...box.querySelectorAll<HTMLElement>('.sn')];
    // (with the rail, its foot below: the band the page's number has beside the text)
    const H = (reader.stage?.clientHeight ?? 0) - (ui.railed ? (reader.M?.foot ?? 0) + insets().b : 0),
      h = (i: number) => els[i]?.offsetHeight ?? 0;
    const tops = cards.map(c => c.top);
    const at = Math.max(
      0,
      cards.findIndex(c => c.id === editing),
    );
    for (let i = at + 1; i < tops.length; i++) tops[i] = Math.max(tops[i], tops[i - 1] + h(i - 1) + GAP);
    for (let i = at - 1; i >= 0; i--) tops[i] = Math.min(tops[i], tops[i + 1] - h(i) - GAP);
    // within the stage: a stack past the bottom rises, one past the top falls (the top wins)
    const over = tops.length ? tops[tops.length - 1] + h(tops.length - 1) - (H - EDGE) : 0;
    if (over > 0) for (let i = 0; i < tops.length; i++) tops[i] -= over;
    const under = tops.length ? band + EDGE - tops[0] : 0;
    if (under > 0) for (let i = 0; i < tops.length; i++) tops[i] += under;
    els.forEach((el, i) => (el.style.top = tops[i] + 'px'));
    box.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
  }

  $effect(() => {
    ui.sideNotes;
    ui.railed;
    ui.page;
    ui.layoutVersion;
    ui.annVersion;
    ui.composing;
    editing;
    place();
    settle();
  });

  function open(c: Card) {
    if (c.reader) return;
    if (!ui.railed) {
      ui.sideNotes = null;
      ui.noteFor = c.id;
      ui.sheet = 'note';
      return;
    }
    editing = c.id;
    text = c.note;
  }
  /** Writing done: the keys back to the page at once (the card fades out with its field,
   *  which would otherwise keep them while it goes). */
  function done() {
    editing = '';
    ui.composing = '';
    reader.stage?.focus({ preventScroll: true });
  }
  function save() {
    const id = editing;
    done();
    // a note left empty on a new highlight keeps the highlight
    if (id) reader.marking.setNote(id, text.trim());
  }
  function cancel() {
    done();
    ui.annVersion++;
  }
  function keys(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }
  /** Another reader's note settled: off the page, kept (and reopened) among the readers' notes. */
  function resolve(id: string) {
    reader.fb?.resolve(id);
    reader.redraw();
    toast('Resolved.');
  }
  const initial = (c: Card) => (c.reader ? c.reader : me().name || 'You').trim().charAt(0).toUpperCase();

  onMount(() => {
    // a pinned note goes away at a press anywhere else
    const away = (e: PointerEvent) => {
      if (ui.sideNotes?.pinned && !(e.target as Element).closest?.('.sn, .nd')) ui.sideNotes = null;
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  });
</script>

{#if ui.railed && reader.M}
  {@const M = reader.M}
  <div class="rail" style:left="{M.W}px" style:top="{band}px" aria-hidden="true"></div>
  {#if !cards.length}
    <p class="rail-empty" style:left="{M.W + 20}px" style:top="{M.y0}px">
      {cols.length ? 'No notes on this page.' : 'No notes yet.'}
    </p>
  {/if}
  <div class="rail-foot" style:left="{M.W + 1}px" role="group" aria-label="The book's notes">
    <button
      onclick={() => prev !== null && reader.travelTo(prev)}
      disabled={prev === null}
      aria-label="Previous note"
      title="Previous note"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <span>{cols.length ? count(cols.length, 'note', 'notes') : 'No notes yet'}</span>
    <button
      onclick={() => next !== null && reader.travelTo(next)}
      disabled={next === null}
      aria-label="Next note"
      title="Next note"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
    </button>
    <!-- (the rail put away where it is; also ; and Notes in the menu) -->
    <button class="close" onclick={() => reader.toggleNotes()} aria-label="Close the notes" title="Close the notes (;)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
    </button>
  </div>
{/if}
{#snippet who(c: Card)}
  <span class="who">
    <span class="av" style={c.reader ? `--t: var(--r${c.rc})` : `--t: var(--hs${c.color})`} aria-hidden="true"
      >{initial(c)}</span
    >
    <span class="nm">{c.who}</span>
    <span class="dt">{when(c.at)}</span>
  </span>
{/snippet}
<div class="sns" bind:this={box}>
  {#each cards as c (c.id)}
    {@const at = `left:${c.left}px;top:${c.top}px;width:${c.width}px`}
    <!-- being written: its field; another reader's: to read; one's own: a press edits it -->
    {#if editing === c.id}
      <div class="sn open" data-a={c.id} style={at} transition:fade|global={{ duration: 120 }}>
        {@render who(c)}
        <label class="sr" for="note-{c.id}">Your note</label>
        <textarea id="note-{c.id}" bind:value={text} onkeydown={keys} rows="3" placeholder="Add a note"></textarea>
        <span class="acts">
          <button onclick={cancel}>Cancel</button>
          <button class="save" onclick={save}>Save</button>
        </span>
      </div>
    {:else if c.reader}
      <div class="sn theirs" data-a={c.id} style={at} transition:fade|global={{ duration: 120 }}>
        {@render who(c)}
        <p class="txt">{c.note}</p>
        <!-- settled, the passage leaves the page; it stays among the readers' notes -->
        <span class="theirs-acts"><button onclick={() => resolve(c.id)}>Resolve</button></span>
      </div>
    {:else}
      <button
        class="sn"
        data-a={c.id}
        style={at}
        transition:fade|global={{ duration: 120 }}
        onclick={() => open(c)}
        aria-label="Your note: {c.note}. Press to edit it."
      >
        {@render who(c)}<span class="txt">{c.note}</span>
      </button>
    {/if}
  {/each}
</div>

<style>
  .rail {
    position: absolute;
    bottom: 0;
    right: 0;
    z-index: 24;
    background: var(--paper);
    border-left: 1px solid var(--rule);
    pointer-events: none;
  }
  .rail-empty {
    position: absolute;
    z-index: 25;
    right: 20px;
    margin: 0;
    font: 400 var(--t-s) / 1.45 var(--f-ui);
    color: var(--ink-3);
  }
  /* the rail's foot, level with the page's number beside it */
  .rail-foot {
    position: absolute;
    z-index: 25;
    right: 0;
    bottom: env(safe-area-inset-bottom);
    height: var(--foot, 52px);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font: 500 13px/1 var(--f-ui);
    color: var(--ink-3);
    font-variant-numeric: tabular-nums;
  }
  .rail-foot button {
    appearance: none;
    border: 0;
    background: none;
    width: 36px;
    height: 36px;
    padding: 0;
    border-radius: var(--r-s);
    display: grid;
    place-items: center;
    color: var(--ink-3);
    cursor: pointer;
    transition:
      color var(--quick),
      background-color var(--quick);
  }
  .rail-foot button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  :global(html:not(.touchui)) .rail-foot button:hover:not(:disabled) {
    color: var(--ink);
    background: var(--hover);
  }
  .rail-foot .close {
    position: absolute;
    right: 10px;
  }
  .rail-foot svg {
    width: 18px;
    height: 18px;
    stroke: currentColor;
    fill: none;
    stroke-width: var(--stroke);
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .sns {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 25;
  }
  /* a card: clean, a hairline; colour only in the writer's initial */
  .sn {
    pointer-events: auto;
    position: absolute;
    box-sizing: border-box;
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 11px 14px 12px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--rule);
    color: var(--ink);
    font: inherit;
    text-align: left;
    appearance: none;
  }
  button.sn {
    cursor: text;
  }
  button.sn:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .sn.open {
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent);
    border-color: color-mix(in oklab, var(--accent) 45%, var(--rule));
  }
  .who {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .av {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font: 600 13px/1 var(--f-ui);
    background: color-mix(in oklab, var(--t) 38%, var(--surface));
    color: color-mix(in oklab, var(--t) 55%, var(--ink));
  }
  .nm {
    flex: 1;
    font: 500 var(--t-s) / 1.2 var(--f-ui);
    color: var(--ink-2);
  }
  .dt {
    font: 500 13px/1.2 var(--f-ui);
    color: var(--ink-3);
  }
  .theirs-acts button {
    appearance: none;
    border: 0;
    background: none;
    padding: 0;
    font: 500 13px/1.6 var(--f-ui);
    color: var(--ink-3);
    cursor: pointer;
  }
  :global(html:not(.touchui)) .theirs-acts button:hover {
    color: var(--ink);
  }
  .txt {
    display: -webkit-box;
    -webkit-line-clamp: 12;
    line-clamp: 12;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin: 0;
    font: 400 var(--t-s) / 1.45 var(--f-ui);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  textarea {
    box-sizing: border-box;
    width: 100%;
    resize: none;
    border: 0;
    outline: none;
    padding: 0;
    background: none;
    color: var(--ink);
    font: 400 var(--t-s) / 1.45 var(--f-ui);
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  .acts button {
    height: 30px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--r-s);
    background: none;
    font: 500 13px/1 var(--f-ui);
    color: var(--ink-2);
    cursor: pointer;
  }
  .acts .save {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
