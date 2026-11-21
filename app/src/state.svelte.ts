/** The app's shared state: what is on the screen (the view, the sheet, the contents, the
 *  chip and cards over the page), and the toast. The reader, the library and the interface's
 *  parts all read and set it. */
import type { Sel } from './reader/selection';

export type Sheet = null | 'settings' | 'theme' | 'help' | 'remove' | 'note' | 'book' | 'shelf' | 'send' | 'share' | 'invite' | 'welcome' | 'fbexport' | 'draft' | 'newdraft' | 'epub';

/** Reactive state the chrome reads. */
export const ui = $state({
  view: 'library' as 'library' | 'reader',
  title: '',
  /** Where the reader is: the chapter (the book's title in one without chapters), and the
   *  page (the first column in view) of how many. */
  runhead: '',
  page: 0,
  pages: 0,
  sheet: null as Sheet,
  /** The contents and highlights are showing beside the text. */
  contents: false,
  /** The notes' rail beside the text: asked for (kept), and showing (room for it). */
  rail: false,
  railed: false,
  /** A highlight whose note is being written in the rail (its id). */
  composing: '' as string,
  toast: '',
  toastOn: false,
  busy: '',
  /** Columns in focus right now, and whether the chosen layout had to give way. */
  cols: 1,
  /** A phone-sized window: one column as a spread, the touch conventions. */
  phone: false,
  /** The text being set again (a size, the window): the page's number is not shown until
   *  the whole book's is known (a first pass counts the chapters before by estimate). */
  settling: false,
  /** Arrows at the text's sides to turn by (geometry.ts says when). */
  arrows: false,
  /** Full screen: the browser's, or (a book on another site's page with none) the page's
   *  window filled with the book (ui/keys.ts, `toggleFull`). */
  full: false,
  /** Bumps when a tap asks the reader's bar to show or hide (touch). */
  barToggle: 0,
  colsReduced: false,
  /** Bumps when the library should be re-read. */
  libVersion: 0,
  /** An invitation to share books, from its link, until it is used (InviteSheet). */
  invite: '',
  /** A book just arrived by link: who sent it (WelcomeSheet, once per book). */
  welcome: null as null | { by: string },
  /** A newer draft at the link the open book came by (its version): NewDraftSheet. */
  newDraft: null as null | number,
  /** Bumps whenever the columns are composed again: a new measure, a setting, the whole
   *  book's layout arriving (column counts become exact). */
  layoutVersion: 0,
  /** The menu offered on a selection or a highlight: what it is for, and the box it keeps
   *  clear of (`x` its middle, `y` its top, `b` its bottom, in the stage's coordinates);
   *  `finger`: a finger's (a selection, beside which the system shows a menu of its own, or
   *  a highlight tapped), which goes in a band of the reader's own (Chip.svelte). */
  chip: null as null | { x: number; y: number; b?: number; finger?: boolean; sel: Sel | null; ann: string | null },
  /** The annotation whose note is being edited. */
  noteFor: '' as string,
  /** A book note shown beside its marker: its index, and where (stage px). */
  bookNote: null as null | { i: number; x: number; y: number; below: boolean },
  /** An image shown large: its index and where it sits on the page (viewport px). */
  lightbox: null as null | { i: number; rect: { x: number; y: number; w: number; h: number } },
  /** Bumps when annotations change (notebook, gauge). */
  annVersion: 0,
  /** Notes shown beside their lines: on hover (one, until the pointer leaves) or pinned
   *  (by a press on a dot, or ; for every note in view). Any movement puts them away. */
  sideNotes: null as null | { ids: string[]; pinned: boolean },
});

let toastT = 0;
export function toast(msg: string, ms = 2600) {
  ui.toast = msg; ui.toastOn = true;
  clearTimeout(toastT); toastT = window.setTimeout(() => (ui.toastOn = false), ms);
}
