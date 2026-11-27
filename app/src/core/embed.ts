/** Volumen inside another site's page: `<folder>/embed.html#src=<address of a book>&…`
 *  (volumen.page/embed, or the package's own), in a frame that typeset.js makes. One book,
 *  read in place: no library, no sharing, nothing added to the host page's history. The
 *  book comes from its own site, which must let other sites read it (CORS:
 *  `Access-Control-Allow-Origin`), and is imported again only when it changes. What the
 *  reader keeps (place, highlights) is in this frame's storage, which browsers keep apart
 *  for each site that embeds it, and only when the page asks (`remember`).
 *
 *  The page and the frame talk in messages `{ typeset: 1, type, … }` (PROTOCOL), each
 *  side to the other's origin only:
 *    frame → page   ready { title, chapters }   progress { at: 0…1 }   end   error { message }
 *                   back (the reader's Back, where the page asked for one with no address)
 *                   full { on } (full screen where the browser has none for a frame, as on
 *                   an iPhone: the page fills its window with the book, and gives it back)
 *    page → frame   goto { chapter } | goto { at }   theme { theme: id or typeset-theme/1 }
 *  The page names its origin in the address (`host`); without it the frame says nothing
 *  and takes no commands. */
import type { Core } from './types';
import { kv } from './kv';

export const embedded = typeof location !== 'undefined' && /(^|\/)embed(\.html)?$/.test(location.pathname);

/** The messages' version: raised when their meaning changes, so the two sides can tell. */
export const PROTOCOL = 1;

/** How much of the reader's own interface shows around the text: all of it, the running
 *  head alone, or nothing (the page around it does the rest). */
export type Chrome = 'full' | 'minimal' | 'none';
/** What the reader offers. An embedding page may turn any of the first five off (`off`);
 *  with less than the full interface (`ui`) all but links are off, Help and full screen
 *  too: what the page does not show, its reader does not open, by a key or any other way. */
export interface Features {
  /** the book's contents and the reader's highlights (M) */
  contents: boolean;
  /** themes and type (S, Aa) */
  settings: boolean;
  /** find in the book (/) */
  find: boolean;
  /** highlights and notes */
  highlights: boolean;
  /** following the book's links out of it */
  links: boolean;
  /** the keys and gestures (?) */
  help: boolean;
  /** full screen (F) */
  fullscreen: boolean;
}
/** What `off` may name. */
const OFF: readonly (keyof Features)[] = ['contents', 'settings', 'find', 'highlights', 'links'];
const ALL: Features = { contents: true, settings: true, find: true, highlights: true, links: true, help: true, fullscreen: true };

/** What the page asked for (typeset.js writes these into the address's fragment):
 *  the book (an absolute http(s) address), only some chapters, a theme, the paper (a colour,
 *  the page's own as typeset.js measured it), a way back (an address, or `history`: the page
 *  goes back its own way), a way on at the end, whether to remember the reader's place in
 *  this browser, how much interface, what is turned off, and the page's own origin. */
export interface EmbedOptions {
  src: string | null;
  chapters?: [number, number];
  theme?: string;
  paper?: string;
  back?: string | 'history';
  endHref?: string;
  endLabel?: string;
  remember: boolean;
  ui: Chrome;
  features: Features;
  host: string | null;
}

export function embedOptions(hash: string): EmbedOptions {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const url = (v: string | null) => { try { const u = new URL(v ?? '', location.href); return v && (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null; } catch { return null; } };
  const ch = /^(\d+)(?:-(\d+))?$/.exec(q.get('ch') ?? '');
  const chapters: [number, number] | undefined = ch ? [+ch[1], +(ch[2] ?? ch[1])] : undefined;
  const ui = q.get('ui') === 'minimal' || q.get('ui') === 'none' ? q.get('ui') as Chrome : 'full';
  const off = new Set((q.get('off') ?? '').split(/[\s,]+/));
  const shown = (f: keyof Features) => (ui === 'full' || f === 'links') && !(OFF.includes(f) && off.has(f));
  const host = url(q.get('host'));
  return {
    src: url(q.get('src')),
    chapters: chapters && chapters[0] >= 1 && chapters[1] >= chapters[0] ? chapters : undefined,
    theme: q.get('theme') ?? undefined,
    paper: /^#[0-9a-f]{6}$/i.test(q.get('paper') ?? '') ? q.get('paper')! : undefined,
    back: q.get('back') === 'history' ? 'history' : url(q.get('back')) ?? undefined,
    endHref: url(q.get('end')) ?? undefined,
    endLabel: q.get('endl')?.slice(0, 60) || undefined,
    remember: q.get('rem') === '1',
    ui,
    features: Object.fromEntries(Object.keys(ALL).map(f => [f, shown(f as keyof Features)])) as unknown as Features,
    host: host && new URL(host).origin,
  };
}

/** The app is not embedded: everything on, no page to answer to. */
const APP: EmbedOptions = { src: null, remember: false, ui: 'full', features: ALL, host: null };
export const embedOpts = embedded ? embedOptions(location.hash) : APP;
/** What the reader offers here: everything in the app, what the page allows in a frame. */
export const features = embedOpts.features;

/** Tells the page around the frame (only it: its origin, as it named it). */
export function tellPage(type: 'ready' | 'progress' | 'end' | 'error' | 'back' | 'expand' | 'close' | 'paper', detail: Record<string, unknown> = {}) {
  if (!embedded || window.parent === window || !embedOpts.host) return;
  window.parent.postMessage({ typeset: PROTOCOL, type, ...detail }, embedOpts.host);
}

/** The reader's way back. In a frame: what the page asked for (an address, opened in the
 *  page's own window; or its history, which the page goes back in its own way: `back`).
 *  Opened as a page of its own: where the reader came from. Otherwise none: inline, the
 *  page around the book is the way back. */
export function wayBack(): { href: string } | { go: () => void } | null {
  if (!embedded) return null;
  if (embedOpts.back && embedOpts.back !== 'history') return { href: embedOpts.back };
  // (with no page around it to ask, its own history)
  if (embedOpts.back === 'history') return { go: () => (window.parent === window ? history.back() : tellPage('back')) };
  if (window.parent === window && history.length > 1) return { go: () => history.back() };
  return null;
}

/** What the page may ask of the reader. */
export type Command = { type: 'goto'; chapter?: number; at?: number } | { type: 'theme'; theme: unknown } | { type: 'place'; place: 'box' | 'window' };

/** Listens for the page's commands: from the frame's own parent and its named origin only,
 *  in this version of the messages. */
export function onCommand(run: (c: Command) => void) {
  if (!embedded || !embedOpts.host) return;
  addEventListener('message', e => {
    if (e.source !== window.parent || e.origin !== embedOpts.host) return;
    const d = e.data;
    if (!d || typeof d !== 'object' || d.typeset !== PROTOCOL) return;
    if (d.type === 'goto' && (Number.isInteger(d.chapter) || (typeof d.at === 'number' && d.at >= 0 && d.at <= 1))) run({ type: 'goto', chapter: d.chapter, at: d.at });
    else if (d.type === 'theme') run({ type: 'theme', theme: d.theme });
    else if (d.type === 'place' && (d.place === 'box' || d.place === 'window')) run({ type: 'place', place: d.place });
  });
}

/** Where the reader is, and the end, told to the page a moment after they change: a
 *  fraction of the book. */
let told = -1, ended = false, tellT = 0;
export function embedMoved(at: number, end: boolean) {
  if (!embedded) return;
  clearTimeout(tellT);
  tellT = window.setTimeout(() => {
    if (Math.abs(at - told) >= 0.001) tellPage('progress', { at: Math.round(at * 1000) / 1000 });
    told = at;
    if (end && !ended) { ended = true; tellPage('end'); }
  }, 250);
}

/** Fetches the book (or finds it, unchanged since last time) and gives its id; or why it
 *  cannot. */
export async function embeddedBook(core: Core): Promise<{ id: string } | { error: string }> {
  const src = embedOpts.src;
  const chapters = embedOpts.chapters;
  if (!src) return { error: 'No book is named: the address should end with #src= and the address of an EPUB, Word or Markdown file.' };
  const host = new URL(src).host;
  let r: Response;
  try { r = await fetch(src, { mode: 'cors' }); }
  catch { return { error: `The book at ${host} cannot be read from here: its site has to allow other sites to read it (Access-Control-Allow-Origin).` }; }
  if (!r.ok) return { error: `The book is not at the address given (${host} answered ${r.status}).` };
  // the same file as last time: no need to read it again
  const tag = r.headers.get('etag') ?? (r.headers.get('last-modified') ? `${r.headers.get('last-modified')}/${r.headers.get('content-length')}` : '');
  const memo = 'embed.' + src + (chapters ? `#${chapters.join('-')}` : '');
  const known = kv.get<{ id: string; tag: string } | null>(memo, null);
  if (tag && known?.tag === tag && (await core.library()).some(e => e.id === known.id)) {
    r.body?.cancel().catch(() => {});
    return { id: known.id };
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  const name = decodeURIComponent(new URL(src).pathname.split('/').pop() || 'book.epub');
  try {
    const e = await core.importFile(bytes, name, chapters);
    kv.set(memo, { id: e.id, tag });
    return { id: e.id };
  } catch (e) {
    return { error: `The file at ${host} could not be read as a book (${(e as Error).message}).` };
  }
}
