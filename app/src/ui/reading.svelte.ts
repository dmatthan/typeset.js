/** What every shell sets up around the reader (the app, a book in another site's page):
 *  the reader and its contents, the colour around the page, and the look following the
 *  appearance chosen and the desktop's colours. Called while a shell starts. */
import type { Core } from '../core/types';
import { untrack } from 'svelte';
import { Reader } from '../reader/reader.svelte';
import { Contents } from '../reader/contents.svelte';
import { settings } from '../reader/settings.svelte';
import { themes } from '../reader/themes.svelte';
import { ui } from '../state.svelte';

export function reading(core: Core): { reader: Reader; contents: Contents } {
  const reader = new Reader(core);
  const contents = new Contents(reader);
  // the colour around the page: at once between views, faded for the large picture
  let edgeView = '';
  $effect(() => {
    const v = `${ui.view}/${!!ui.lightbox}`;
    const viewChanged = edgeView.split('/')[0] !== ui.view;
    edgeView = v;
    untrack(() => reader.paintEdges(viewChanged ? 0 : 250));
  });
  // appearance and the desktop's colours repaint, and only they: a theme, a face or an option
  // waits for its text to be set (`settingsChanged`), which the repaint must not read ahead of
  $effect(() => { settings.appearance; themes.desktop; untrack(() => reader.themeChanged()); });
  return { reader, contents };
}
