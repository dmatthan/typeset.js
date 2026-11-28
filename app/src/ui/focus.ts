/** The keyboard kept inside a dialog or a panel: Tab past its last control comes back to
 *  its first, Shift+Tab before its first goes to its last. */

/** What Tab stops at: enabled buttons, inputs (of a radio group, the one checked) and
 *  elements put in the order by hand. */
const STOPS = 'button:not([disabled]), input:not([type=radio]), input[type=radio]:checked, [tabindex="0"]';

/** Wraps a Tab at either end of `within` (from its keydown). */
export function wrapTab(e: KeyboardEvent, within: HTMLElement) {
  const f = [...within.querySelectorAll<HTMLElement>(STOPS)];
  if (!f.length) return;
  if (e.shiftKey && document.activeElement === f[0]) {
    e.preventDefault();
    f[f.length - 1].focus();
  } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
    e.preventDefault();
    f[0].focus();
  }
}
