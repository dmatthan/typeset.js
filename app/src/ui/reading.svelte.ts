/** What every shell sets up around the reader (the app, a book in another site's page):
 *  the reader and its map, the colour around the page, and the look following the
 *  appearance chosen and the desktop's colours. Called while a shell starts. */
import type { Core } from '../core/types';
import { untrack } from 'svelte';
import { Reader } from '../reader/reader.svelte';
import { MapCtl } from '../reader/map.svelte';
import { settings } from '../reader/settings.svelte';
import { themes } from '../reader/themes.svelte';
import { ui } from '../state.svelte';

export function reading(core: Core): { reader: Reader; map: MapCtl } {
  const reader = new Reader(core);
  const map = new MapCtl(reader);
  reader.onMapOpen = () => map.open();
  // the colour around the page: at once between views, with the map's fade for the map
  let edgeView = '';
  $effect(() => {
    const v = `${ui.view}/${ui.mapOpen}/${!!ui.lightbox}`;
    const viewChanged = edgeView.split('/')[0] !== ui.view;
    edgeView = v;
    untrack(() => reader.paintEdges(viewChanged ? 0 : 250));
  });
  // appearance and the desktop's colours repaint; a theme change relays out (settings sheet)
  $effect(() => { settings.appearance; themes.desktop; reader.themeChanged(); });
  return { reader, map };
}
