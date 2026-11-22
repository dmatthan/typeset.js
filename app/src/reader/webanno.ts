/* Notes as W3C Web Annotations (https://www.w3.org/TR/annotation-model/), for other tools:
 * an AnnotationCollection whose items each target the book by a TextQuoteSelector (the
 * words, and the words either side), which any tool can place, and a selector of our own
 * with the block and offsets, which this app places exactly. Read back, a collection from
 * here or from another tool becomes a notes file: what it does not say (the block) is
 * found by the words (engine/src/anchor.rs). */
import { FORMAT, type FileNote, type NotesFile } from './feedback';


const BOOK = 'urn:typeset:book:';
const OURS = 'urn:typeset:block';

export function toWebAnno(f: NotesFile): object {
  const iso = (t: number) => new Date(t || f.sent).toISOString();
  return {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    type: 'AnnotationCollection',
    label: f.book.title,
    creator: { type: 'Person', name: f.from.name || undefined, id: `urn:typeset:reader:${f.from.id}` },
    generated: new Date(f.sent).toISOString(),
    total: f.notes.length,
    first: {
      type: 'AnnotationPage',
      items: f.notes.map(n => ({
        type: 'Annotation',
        id: `urn:typeset:note:${n.id}`,
        created: iso(n.created),
        modified: iso(n.updated),
        motivation: n.note ? 'commenting' : n.kind === 'mark' ? 'bookmarking' : 'highlighting',
        ...(n.note ? { body: { type: 'TextualBody', value: n.note, format: 'text/plain', purpose: 'commenting' } } : {}),
        target: {
          source: BOOK + f.book.id,
          selector: [
            { type: 'TextQuoteSelector', exact: n.quote, prefix: n.prefix || undefined, suffix: n.suffix || undefined },
            { type: OURS, block: n.key, start: n.s, end: n.e, kind: n.kind, colour: n.color, position: n.pos },
          ],
        },
      })),
    },
  };
}

/** Whether a text is a Web Annotation collection (or a single annotation, or a list). */
export function isWebAnno(text: string) {
  return /"@context"\s*:\s*"http:\/\/www\.w3\.org\/ns\/anno\.jsonld"/.test(text.slice(0, 2000));
}

/* (what another tool's JSON holds is not to be trusted: a field is taken only as what it
   should be, else left out) */
const str = (x: unknown, d = '') => (typeof x === 'string' ? x : d);
const num = (x: unknown) => (Number.isFinite(x) ? (x as number) : undefined);
const list = (x: unknown): any[] => (Array.isArray(x) ? x : x == null ? [] : [x]);
const time = (x: unknown) => Date.parse(str(x)) || 0;

/** One annotation as a note, with the book it says it is on; or null, if it has no
 *  passage (a quote) to place. Ours carry their block and offsets too; another tool's, the
 *  words alone, which find it. */
function noteOf(a: any, n: number): { note: FileNote; source: string } | null {
  const target = list(a?.target)[0], sels = list(target?.selector);
  const quote = sels.find(x => x?.type === 'TextQuoteSelector'), exact = str(quote?.exact);
  if (!exact) return null;
  const ours = sels.find(x => x?.type === OURS) ?? {};
  const body = Array.isArray(a.body) ? a.body.find((b: any) => b?.type === 'TextualBody') : a.body;
  return {
    source: str(target?.source),
    note: {
      id: String(a.id ?? '').replace(/^urn:typeset:note:/, '') || `w:${n}:${exact.slice(0, 24)}`, kind: ours.kind === 'mark' ? 'mark' : 'highlight',
      key: str(ours.block), s: num(ours.start) ?? 0, e: num(ours.end) ?? exact.length,
      quote: exact, prefix: str(quote.prefix), suffix: str(quote.suffix), pos: num(ours.position),
      color: num(ours.colour), note: str(body?.value) || undefined, created: time(a.created), updated: time(a.modified) || time(a.created),
    },
  };
}

/** Annotations read as a notes file; `book` names the book they go on when they do not
 *  say (another tool's). Or why they cannot be. */
export function fromWebAnno(text: string, book?: { id: string; title: string; author: string }): NotesFile | string {
  let v: any;
  try { v = JSON.parse(text); } catch { return 'These annotations are damaged.'; }
  const items: any[] = Array.isArray(v) ? v : v?.type === 'Annotation' ? [v] : v?.first?.items ?? v?.items ?? [];
  const read = items.map(noteOf).filter(x => !!x);
  if (!read.length) return 'These annotations have no passages this app can place.';
  const source = read.find(x => x.source)?.source ?? '';
  const id = source.startsWith(BOOK) ? source.slice(BOOK.length) : book?.id;
  if (!id) return 'These annotations do not say which book they are for: open the book and drop them on it.';
  const creator = list(v?.creator)[0] ?? items[0]?.creator;
  const from = { id: String(creator?.id ?? 'web-annotations').replace(/^urn:typeset:reader:/, ''), name: String(creator?.name ?? creator?.nickname ?? 'Annotations').slice(0, 60) };
  return { format: FORMAT, book: { id, title: String(v?.label ?? book?.title ?? ''), author: book?.author ?? '' }, from, sent: time(v?.generated) || Date.now(), notes: read.map(x => x.note) };
}
