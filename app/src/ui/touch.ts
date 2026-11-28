/** A touch screen, and a phone's own ways: what is a touch screen, the page never zooming,
 *  what a phone's keyboard covers. */
import { ui } from '../state.svelte';

/** A touch screen: key hints mean nothing there. One answer, the device's (`ui.touch`):
 *  the pointer coarse, or the screen touched; a narrow window, or a box on another site's
 *  page, still has the keyboard and mouse it had. The page marks itself `touchui` with it
 *  (tokens.css hides `kbd` and `.keys-only` then); what names a key asks this, and follows
 *  it (a tablet with a keyboard is touched while Help shows its keys: Help turns to the
 *  gestures, never keys without their caps). */
export function touchUI(): boolean {
  return ui.touch;
}

/** Marks the page as touch-driven (main.ts calls this first thing). */
export function watchTouch() {
  const html = document.documentElement;
  const mark = () => {
    ui.touch = true;
    html.classList.add('touchui');
  };
  if (
    matchMedia('(pointer: coarse)').matches ||
    (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches)
  )
    mark();
  addEventListener('touchstart', mark, { once: true, passive: true });
}

/** Safari zooms the page on a pinch whatever `touch-action` says on some elements (its own
 *  gesture events come first): the page never zooms (tokens.css). */
export function noPageZoom() {
  for (const t of ['gesturestart', 'gesturechange'] as const)
    document.addEventListener(t, e => e.preventDefault(), { passive: false });
}

/** What a phone's keyboard covers: iOS leaves a fixed page its full height and lays the
 *  keyboard over its foot (and may scroll the view to the field being typed in). The
 *  part still visible is given as `--vv-top` and `--kb` (from the top and the bottom), so
 *  sheets sit above the keyboard rather than under it. */
export function followKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const html = document.documentElement;
  const set = () => {
    const top = Math.max(0, vv.offsetTop),
      kb = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
    html.style.setProperty('--vv-top', `${top}px`);
    html.style.setProperty('--kb', `${kb}px`);
  };
  vv.addEventListener('resize', set);
  vv.addEventListener('scroll', set);
  set();
}
