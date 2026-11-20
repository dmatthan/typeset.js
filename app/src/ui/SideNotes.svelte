<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import { me } from '../core/identity';
  import { type Reader } from '../reader/reader.svelte';
  import { ui } from '../state.svelte';

  /** Notes beside their lines. With the rail (ui.railed: a wide window, asked for), every
   *  note in the columns in view, each level with its line in the rail beside the text,
   *  one's own edited in place; a note being written (ui.composing) has a card of its own
   *  there. Without it, the notes asked for (a dot pointed at, `;`) over the column, below
   *  their highlight. Cards never overlap and keep within the stage. */
  let { reader }: { reader: Reader } = $props();
  const GAP = 10, EDGE = 12;

  /** A card: one's own note, or another reader's (theirs to read, not to edit). */
  interface Card { id: string; note: string; color: number; who: string; reader?: string; rc?: number; top: number; left: number; width: number; x: number }
  function noteOf(id: string): Omit<Card, 'id' | 'top' | 'left' | 'width' | 'x'> | null {
    if (id.includes('|')) {
      const f = reader.fb?.find(id);
      return f?.n.note ? { note: f.n.note, color: 0, who: f.reader, reader: f.reader, rc: f.colour } : null;
    }
    const a = reader.ann?.list.find(x => x.id === id);
    return a && (a.note || id === ui.composing) ? { note: a.note, color: a.color, who: 'You' } : null;
  }
  let cards: Card[] = $state([]);
  let box: HTMLElement;
  /** The card being written in, and what it says so far. */
  let editing = $state(''), text = $state('');

  /** The notes the cards are for: with the rail, every one in view; else those asked for. */
  function ids(): string[] {
    if (!ui.railed) return ui.sideNotes?.ids ?? [];
    const out: string[] = [];
    for (const k of reader.focusCols()) for (const d of reader.surface.columnEl(k)?.querySelectorAll<HTMLElement>('.nd') ?? []) out.push(d.dataset.a!);
    if (ui.composing && !out.includes(ui.composing)) out.push(ui.composing);
    return out;
  }

  function place() {
    const stage = reader.stage, M = reader.M;
    if (!stage || !M || !reader.strip) { cards = []; return; }
    const st = stage.getBoundingClientRect();
    const out: Card[] = [];
    for (const id of ids()) {
      const a = noteOf(id);
      // where its passage is: the dot beside its line, or (a note not yet written) its highlight
      const at = stage.querySelector<HTMLElement>(`.nd[data-a="${CSS.escape(id)}"]`) ?? stage.querySelector<HTMLElement>(`mark[data-a="${CSS.escape(id)}"]`);
      if (!a || !at) continue;
      const r = at.getBoundingClientRect();
      const y = r.top + r.height / 2 - st.top;
      let left: number, width: number, top: number;
      if (ui.railed) {
        // in the rail, level with its line
        left = M.W + 20; width = st.width - M.W - 40; top = y - M.lh / 2;
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
    if (ui.composing && editing !== ui.composing) { editing = ui.composing; text = ''; }
  }

  /** Once drawn: stacked so none overlaps another, and all within the stage. The card in
   *  use (being written) keeps its line and the others make room around it, those above
   *  rising, those below falling; otherwise each goes as near its line as the one above
   *  allows, and a stack past the bottom rises. */
  async function settle() {
    await tick();
    const els = [...box.querySelectorAll<HTMLElement>('.sn')];
    const H = reader.stage?.clientHeight ?? 0, h = (i: number) => els[i]?.offsetHeight ?? 0;
    const tops = cards.map(c => c.top);
    const at = Math.max(0, cards.findIndex(c => c.id === editing));
    for (let i = at + 1; i < tops.length; i++) tops[i] = Math.max(tops[i], tops[i - 1] + h(i - 1) + GAP);
    for (let i = at - 1; i >= 0; i--) tops[i] = Math.min(tops[i], tops[i + 1] - h(i) - GAP);
    // within the stage: a stack past the bottom rises, one past the top falls (the top wins)
    const over = tops.length ? tops[tops.length - 1] + h(tops.length - 1) - (H - EDGE) : 0;
    if (over > 0) for (let i = 0; i < tops.length; i++) tops[i] -= over;
    const under = tops.length ? EDGE - tops[0] : 0;
    if (under > 0) for (let i = 0; i < tops.length; i++) tops[i] += under;
    els.forEach((el, i) => (el.style.top = tops[i] + 'px'));
    box.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
  }

  $effect(() => { ui.sideNotes; ui.railed; ui.page; ui.layoutVersion; ui.annVersion; ui.composing; editing; place(); settle(); });

  function open(c: Card) {
    if (c.reader) return;
    if (!ui.railed) { ui.sideNotes = null; ui.noteFor = c.id; ui.sheet = 'note'; return; }
    editing = c.id; text = c.note;
  }
  /** Writing done: the keys back to the page at once (the card fades out with its field,
   *  which would otherwise keep them while it goes). */
  function done() { editing = ''; ui.composing = ''; reader.stage?.focus({ preventScroll: true }); }
  function save() {
    const id = editing;
    done();
    // a note left empty on a new highlight keeps the highlight
    if (id) reader.marking.setNote(id, text.trim());
  }
  function cancel() { done(); ui.annVersion++; }
  function keys(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
  }
  const initial = (c: Card) => (c.reader ? c.reader : me().name || 'You').trim().charAt(0).toUpperCase();

  onMount(() => {
    // a pinned note goes away at a press anywhere else
    const away = (e: PointerEvent) => { if (ui.sideNotes?.pinned && !(e.target as Element).closest?.('.sn, .nd')) ui.sideNotes = null; };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  });
</script>

{#if ui.railed}<div class="rail" style:left="{reader.M?.W ?? 0}px" aria-hidden="true"></div>{/if}
{#snippet who(c: Card)}
  <span class="who">
    <span class="av" style={c.reader ? `--t: var(--r${c.rc})` : `--t: var(--hs${c.color})`} aria-hidden="true">{initial(c)}</span>
    <span class="nm">{c.who}</span>
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
        {@render who(c)}<p class="txt">{c.note}</p>
      </div>
    {:else}
      <button class="sn" data-a={c.id} style={at} transition:fade|global={{ duration: 120 }} onclick={() => open(c)} aria-label="Your note: {c.note}. Press to edit it.">
        {@render who(c)}<span class="txt">{c.note}</span>
      </button>
    {/if}
  {/each}
</div>

<style>
  .rail { position: absolute; top: 0; bottom: 0; right: 0; z-index: 24; background: var(--paper); border-left: 1px solid var(--rule); pointer-events: none; }
  .sns { position: absolute; inset: 0; pointer-events: none; z-index: 25; }
  /* a card: clean, a hairline; colour only in the writer's initial */
  .sn {
    pointer-events: auto; position: absolute; box-sizing: border-box; display: grid; gap: 6px; margin: 0;
    padding: 11px 14px 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--rule); color: var(--ink);
    font: inherit; text-align: left; appearance: none;
  }
  button.sn { cursor: text; }
  button.sn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .sn.open { box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent); border-color: color-mix(in oklab, var(--accent) 45%, var(--rule)); }
  .who { display: flex; align-items: center; gap: 8px; }
  .av { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font: 600 13px/1 var(--f-ui); background: color-mix(in oklab, var(--t) 38%, var(--surface)); color: color-mix(in oklab, var(--t) 55%, var(--ink)); }
  .nm { font: 500 var(--t-s)/1.2 var(--f-ui); color: var(--ink-2); }
  .txt { display: -webkit-box; -webkit-line-clamp: 12; line-clamp: 12; -webkit-box-orient: vertical; overflow: hidden; margin: 0; font: 400 var(--t-s)/1.45 var(--f-ui); white-space: pre-wrap; overflow-wrap: anywhere; }
  textarea { box-sizing: border-box; width: 100%; resize: none; border: 0; outline: none; padding: 0; background: none; color: var(--ink); font: 400 var(--t-s)/1.45 var(--f-ui); }
  .acts { display: flex; justify-content: flex-end; gap: 6px; }
  .acts button { height: 30px; padding: 0 12px; border: 0; border-radius: var(--r-s); background: none; font: 500 13px/1 var(--f-ui); color: var(--ink-2); cursor: pointer; }
  .acts .save { background: var(--accent); color: var(--accent-ink); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
