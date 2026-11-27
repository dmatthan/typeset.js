<script lang="ts">
  /** The keys (on a touch screen, the gestures), each row its keys drawn as keys and what
   *  they do in a few words. Only what is here: a book on another site's page lists only
   *  what the page offers, and none of the app's (the library, quitting). */
  import { embedded, features, type Features } from '../core/embed';
  import Sheet from './Sheet.svelte';
  import { touchUI } from './touch';
  let { onclose }: { onclose: () => void } = $props();
  const touch = $derived(touchUI());
  /** What a row needs to mean anything: a feature the page may turn off, or the app. */
  type Need = keyof Features | 'app';
  /** A row: its keys (alternatives parted by " | ", keys pressed together by a space, a
   *  range as "1–4"), or on a touch screen a gesture; what it does; what it needs. */
  type Row = [string, string, Need?];
  type Group = [string, Row[], Need?];
  const gestures: Group[] = [
    ['Reading', [
      ['Tap an edge', 'Next or previous page'],
      ['Swipe', 'Turn the page'],
      ['Tap the middle', 'Controls'],
      ['Hold a word', 'Select', 'highlights'],
      ['Tap a note marker', 'The note'],
      ['Tap a picture', 'Larger'],
    ]],
    ['Library', [
      ['Tap a book', 'Open'],
      ['⋯ on a cover', 'More'],
      ['+', 'Add a book'],
    ], 'app'],
  ];
  const keyGroups: Group[] = [
    ['Reading', [
      ['Space | ⇧ Space', 'Next or previous page'],
      ['→ | ←', 'Next or previous column'],
      ['] | [', 'Next or previous chapter'],
      ['⌫', 'Back to where you were'],
      ['M', 'Contents', 'contents'],
      ['B', 'Bookmark', 'highlights'],
      ['/ | Ctrl F', 'Find in the book', 'find'],
      [';', 'Notes beside the text', 'highlights'],
      ['S', 'Type and appearance', 'settings'],
      ['C', 'Columns', 'settings'],
      ['F', embedded ? 'Expand, or full screen' : 'Full screen', 'fullscreen'],
      ['Q', 'Close the book', 'app'],
    ]],
    ['Highlights', [
      ['1–4', 'Highlight in a colour'],
      ['N', 'Add a note'],
      ['C', 'Copy with reference'],
      ['X', 'Remove'],
      ['V', 'Select a paragraph'],
      ['5–8', 'React, for the writer', 'app'],
    ], 'highlights'],
    ['Find', [
      ['Enter | ⇧ Enter', 'Next or previous match'],
      ['Esc', 'End the search'],
    ], 'find'],
    ['Type and appearance', [
      ['− | +', 'Smaller or larger type'],
      ['T | ⇧ T', 'Next or previous theme'],
      ['P', 'Light or dark'],
      ['C', 'Style'],
      ['B | J | Y', 'Bold, justify, hyphenate'],
      ['1 | 2 | 3 | A', 'Columns'],
      ['0', 'Reset the style'],
      ['N', 'New theme'],
    ], 'settings'],
    ['Library', [
      ['↑ | ↓ | ← | →', 'Move between books'],
      ['/', 'Search'],
      ['] | [', 'Next or previous shelf'],
      ['A', 'Collections'],
      ['N', 'Notebook'],
      ['Enter', 'Open'],
      ['O', 'Add a book'],
      ['X', 'Remove'],
    ], 'app'],
    ['Anywhere', [
      ['?', 'Keyboard shortcuts'],
      ['Esc', 'Close'],
      ['Ctrl Q', 'Quit', 'app'],
    ]],
  ];
  const here = (n?: Need) => !n || (n === 'app' ? !embedded : features[n]);
  const shown = $derived((touch ? gestures : keyGroups).filter(([, , n]) => here(n)).map(([name, rows]) => [name, rows.filter(([, , n]) => here(n))] as const));
  /** A row's keys as drawn: each alternative its keys, a range its two ends. */
  const alternatives = (keys: string) => keys.split(' | ').map(a => a.split(' ').map(k => (k.length > 1 && k.includes('–') ? k.split('–') : [k])));
</script>

<Sheet label={touch ? 'Gestures' : 'Keyboard shortcuts'} {onclose} wide>
  <h2>{touch ? 'Gestures' : 'Keyboard shortcuts'}</h2>
  <div class="cols">
    {#each shown as [name, rows]}
      <section>
        <h3>{name}</h3>
        <dl>
          {#each rows as [keys, what]}
            <div class="row">
              <dt class="keys">
                {#if touch}<span class="g">{keys}</span>
                {:else}
                  {#each alternatives(keys) as alt, i}
                    {#if i}<span class="or" aria-label="or">/</span>{/if}
                    {#each alt as k}{#if k.length === 2}<kbd>{k[0]}</kbd><span class="to" aria-label="to">–</span><kbd>{k[1]}</kbd>{:else}<kbd>{k[0]}</kbd>{/if}{/each}
                  {/each}
                {/if}
              </dt>
              <dd class="what">{what}</dd>
            </div>
          {/each}
        </dl>
      </section>
    {/each}
  </div>
  <div class="acts"><button class="btn" data-autofocus onclick={onclose} title="Done (Esc)">Done</button></div>
</Sheet>

<style>
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 22px 36px; }
  h3 { margin: 0 0 6px; font: 600 var(--t-s)/1.3 var(--f-ui); color: var(--ink-3); }
  /* (the keys' column as wide as the widest keys of its group: no keys broken over lines) */
  dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; column-gap: 16px; }
  .row { display: contents; }
  .keys { display: flex; align-items: center; gap: 3px; margin: 0; min-height: 30px; }
  dd { align-self: center; }
  dd { margin: 0; font: 400 var(--t-s)/1.35 var(--f-ui); color: var(--ink); }
  /* a key: a small cap, as a keyboard has it */
  kbd {
    box-sizing: border-box; min-width: 24px; height: 24px; padding: 0 6px; display: inline-grid; place-items: center;
    border-radius: var(--r-xs); border: 1px solid var(--rule); box-shadow: 0 1px 0 var(--rule); background: var(--surface);
    font: 500 13px/1 var(--f-ui); color: var(--ink); opacity: 1;
  }
  .or, .to { font: 400 13px/1 var(--f-ui); color: var(--ink-3); padding: 0 1px; }
  .g { font: 500 var(--t-s)/1.35 var(--f-ui); color: var(--ink); }
</style>
