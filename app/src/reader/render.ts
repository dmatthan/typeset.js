/** A column as HTML: its lines as the press set them, with their marks, links, pictures and
 *  notes' dots. */
import { embedOpts } from '../core/embed';
import { BlockKind, Style, type BlockData, type BookData } from '../core/types';
import type { Metrics } from './geometry';
import type { Annotation } from './annotations';
import { F, FIELDS, Flag, type Item, type Strip } from './strip';
import { RICH } from './rich';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Stretches of a block other readers marked, with their colours (feedback.ts). */
export type FbSeg = { s: number; e: number; colours: number[]; ids: string[] };

/** Underlines for a stretch other readers marked: one stripe per reader, stacked from
 *  the baseline down, drawn as backgrounds so the text's width is untouched. */
function fbOpen(f: FbSeg) {
  const bg = f.colours.slice(0, 3).map((c, i) => `linear-gradient(var(--r${c}),var(--r${c})) 0 calc(100% - ${i * 3}px)/100% 2px no-repeat`).join(',');
  return `<span class="fb" data-f="${esc(f.ids.join(' '))}" style="background:${bg}">`;
}

/** Inline HTML for text[s, e) of a block: its styled runs, links and marks
 *  (highlights, find hits). Nesting is mark ⟩ link ⟩ style; each mark is one element over
 *  its whole run on the line, so it draws as one shape. Nothing here changes the text's
 *  width: links are colour and underline only. */
function inline(b: BlockData, s: number, e: number, hls?: Annotation[], fbs?: FbSeg[]): string {
  const t = b.t, r = b.r, ls = b.l;
  const hs = hls?.filter(a => a.s < e && a.e > s);
  const fs = fbs?.filter(f => f.s < e && f.e > s);
  if (!hs?.length && !fs?.length && !ls?.length && !r.length) return esc(t.slice(s, e));
  // where anything starts or ends within [s, e): the runs between are each one thing
  const cuts = new Set([s, e]);
  const cut = (x: number, y: number) => { for (const c of [x, y]) if (c > s && c < e) cuts.add(c); };
  for (let j = 0; j < r.length; j += 3) cut(r[j], r[j + 1]);
  ls?.forEach(l => cut(l[0], l[1])); hs?.forEach(a => cut(a.s, a.e)); fs?.forEach(f => cut(f.s, f.e));
  const pts = [...cuts].sort((x, y) => x - y);
  let out = '';
  let openH: Annotation | undefined, openF: FbSeg | undefined, openL: [number, number, string] | undefined;
  // nesting: mark ⟩ other readers' underline ⟩ link ⟩ style
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], z = pts[i + 1];
    const h = hs?.find(x => x.s <= a && x.e > a);
    const f = fs?.find(x => x.s <= a && x.e > a);
    const L = ls?.find(x => x[0] <= a && x[1] > a);
    const inner = h !== openH || f !== openF;
    if (inner || (L !== openL && openL)) { if (openL) { out += '</a>'; openL = undefined; } }
    if (inner && openF) { out += '</span>'; openF = undefined; }
    if (h !== openH) {
      if (openH) out += '</mark>';
      if (h) out += markOpen(h, s, e);
      openH = h;
    }
    if (f && f !== openF) { out += fbOpen(f); openF = f; }
    if (L !== openL) {
      if (L) out += linkOpen(L[2]);
      openL = L;
    }
    out += styled(styleAt(b, a), esc(t.slice(a, z)));
  }
  if (openL) out += '</a>';
  if (openF) out += '</span>';
  if (openH) out += '</mark>';
  return out;
}

/** A highlight's mark, opened on a line that holds [s, e) of its block: whether its note
 *  ends here (`nt`, the dot), and whether it starts (`hs`) or ends (`he`) on this line. */
const markOpen = (h: Annotation, s: number, e: number) =>
  `<mark class="hl h${hue(h.color)}${h.note && h.e <= e ? ' nt' : ''}${h.s >= s ? ' hs' : ''}${h.e <= e ? ' he' : ''}" data-a="${esc(h.id)}">`;
/** A mark's colour as its class has it: the four, and find's two (5, 6); anything else
 *  (a notes file's say, not to be trusted into the page's HTML) the first. */
const hue = (c: unknown) => (Number.isInteger(c) && (c as number) >= 1 && (c as number) <= 6 ? c : 1);

/** The styles a run can have, outermost first, and their elements. */
const STYLES: [number, string, string][] = [[Style.Italic, '<i>', '</i>'], [Style.Bold, '<b>', '</b>'], [Style.SmallCaps, '<span class="sc">', '</span>'], [Style.Sup, '<sup>', '</sup>'], [Style.Sub, '<sub>', '</sub>']];
function styled(st: number, html: string) {
  let o = '', c = '';
  for (const [bit, open, close] of STYLES) if (st & bit) { o += open; c = close + c; }
  return o + html + c;
}

function linkOpen(to: string): string {
  const k = to[0], v = esc(to.slice(2));
  if (k === 'n') return `<a class="nr" data-n="${v}">`;
  if (k === 'b') return `<a class="xr" data-b="${v}">`;
  return `<a class="ur" data-u="${v}">`;
}

function styleAt(b: BlockData, i: number) {
  for (let j = 0; j < b.r.length; j += 3) if (i >= b.r[j] && i < b.r[j + 1]) return b.r[j + 2];
  return 0;
}

/** HTML for a note's text (its own runs; lines become paragraphs). */
export function noteHTML(t: string, r: number[]): string {
  const b: BlockData = { k: BlockKind.P, key: '', t, r };
  let out = '', at = 0;
  for (const line of t.split('\n')) {
    out += `<p>${inline(b, at, at + line.length)}</p>`;
    at += line.length + 1;
  }
  return out;
}

/** Dots in the gutter beside the line where each noted highlight starts: the note itself
 *  shows beside them on demand (SideNotes). */
function noteDots(anns: Annotation[] | undefined, s: number, e: number, top: number, M: Metrics, others?: { id: string; s: number; colour: number }[]): string {
  let out = '', n = 0;
  // inside the focus zone's half of the gutter, so a press on it is the reader's
  const at = () => `top:${top + M.lh / 2}px;left:${M.colW + Math.min(M.G * 0.36, 14) + n++ * 11}px`;
  for (const a of anns ?? []) if (a.note && a.s >= s && a.s < e) out += `<span class="nd" data-a="${esc(a.id)}" style="${at()}" aria-hidden="true"></span>`;
  // other readers' notes: a dot in their colour
  for (const o of others ?? []) if (o.s >= s && o.s < e) out += `<span class="nd fd" data-a="${esc(o.id)}" style="${at()};--dc:var(--r${o.colour})" aria-hidden="true"></span>`;
  return out;
}

/** Scripts written right to left. */
const RTL = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}\p{Script=Samaritan}\p{Script=Mandaic}]/u;
const rtlOf = new WeakMap<object, boolean>();
/** A paragraph written right to left (Hebrew, Arabic): told by its first letter, as
 *  HTML's dir="auto" tells it. Its lines are set from the column's right edge, the
 *  indent there too; the press's lines are the same either way. */
function rtl(b: { t: string }): boolean {
  let v = rtlOf.get(b);
  if (v === undefined) {
    const first = /\p{L}/u.exec(b.t);
    v = !!first && RTL.test(first[0]);
    rtlOf.set(b, v);
  }
  return v;
}

/** The optical size the press measures a size at (shape.rs `opsz`). */
const opsz = (px: number) => Math.min(144, Math.max(6, px));

/** Other readers' notes, for drawing (feedback.ts `Feedback`). */
export interface FbView {
  segments(key: string): FbSeg[];
  written(key: string): { r: string; n: { id: string; s: number; e: number } }[];
  marked(key: string): { r: string }[];
  colourOf(r: string): number;
}

/** The text lines of one column. */
/** What a column's lines are drawn with: the strip, the geometry, the marked paragraphs,
 *  a block's highlights and hits, the pictures' addresses, other readers' notes. */
interface Draw { strip: Strip; M: Metrics; marks: Set<string>; marksOf?: (key: string) => Annotation[] | undefined; imgSrc?: (i: number) => string; fb?: FbView }
/** A line as the press set it (its encoded fields read out): its block, where it sits, and
 *  the stretch [s, e) of the block's text it holds. */
interface Line { flags: number; spaces: number; top: number; bi: number; b: BlockData; x: number; avail: number; nat: number; s: number; e: number }

export function columnHTML(strip: Strip, k: number, M: Metrics, marks: Set<string>, marksOf?: (key: string) => Annotation[] | undefined, imgSrc?: (i: number) => string, fb?: FbView): string {
  const L = strip.linesAt(k);
  let html = '';
  const it = strip.itemAt(k)!;
  const sec = strip.book.sections[it.sec];
  if (it.type === 'sect' && k === it.start && sec.k === 1) html += headHTML(strip.book, it.sec, M);
  if (!L) return html;
  const { u, f } = L.sl, d: Draw = { strip, M, marks, marksOf, imgSrc, fb };
  for (let j = L.from; j < L.to; j++) {
    const o = j * FIELDS, bi = u[o + F.block];
    html += lineHTML({
      flags: u[o + F.flags] & 0xffff, spaces: u[o + F.flags] >>> 16, top: u[o + F.row] * M.lh, bi, b: sec.blocks[bi],
      x: f[o + F.x], avail: f[o + F.avail], nat: f[o + F.natural], s: u[o + F.s], e: u[o + F.e],
    }, d);
  }
  return html;
}

/** One line, by its kind: a break between sections (its mark on the first line only), a
 *  picture's rows (drawn once, by its first: `Image`), a table's rule, an empty cell, a
 *  picture, preformatted text, or a line of text. */
function lineHTML(ln: Line, d: Draw): string {
  const { flags, top, x, avail } = ln;
  if (flags & Flag.Break) return flags & Flag.First ? `<div class="ln brk" style="top:${top}px">⁂</div>` : '';
  if (flags & Flag.ImageRow) return '';
  if (flags & Flag.Rule) return `<div class="trule" style="top:${top}px;left:${Math.round(x)}px;width:${Math.round(avail)}px"></div>`;
  if (flags & Flag.Cell && ln.s === ln.e) return '';
  if (flags & Flag.Image) return imageHTML(ln, d);
  if (ln.b.k === BlockKind.Pre) return preHTML(ln, d);
  return textHTML(ln, d);
}

/** A picture, centred in the rows it spans, on whole pixels so its edges stay crisp. */
function imageHTML({ spaces, top, bi, b, x, avail, nat }: Line, { strip, M, imgSrc }: Draw): string {
  const h = spaces * M.lh, i = b.img ?? -1, src = imgSrc?.(i) ?? '';
  const rich = strip.book.images[i]?.[3] === RICH;
  return `<figure class="img${rich ? ' rich' : ''}" data-i="${i}" data-b="${bi}" style="top:${Math.round(top + (h - nat) / 2)}px;left:${Math.round(x)}px;width:${Math.round(avail)}px;height:${Math.round(nat)}px">`
    + `<img data-i="${i}" alt="${esc(b.t)}" decoding="async"${src ? ` src="${esc(src)}"` : ''}></figure>`;
}

/** Preformatted text: its spaces are its own (white-space: pre), sized by the press. */
function preHTML({ spaces, top, bi, b, x, avail, s, e }: Line, { M, marks, marksOf, fb }: Draw): string {
  const anns = marksOf?.(b.key);
  return `<div class="ln pre${marks.has(b.key) ? ' mk' : ''}" style="top:${top}px;left:${x.toFixed(2)}px;width:${avail.toFixed(2)}px;font-size:${spaces / 16}px" data-b="${bi}" data-s="${s}">${inline(b, s, e, anns, fb?.segments(b.key))}</div>`
    + noteDots(anns, s, e, top, M);
}

/** The classes a text line's flags give it. */
const LINE_CLASSES: [number, string][] = [[Flag.Justify, ' j'], [Flag.Hyph, ' hy'], [Flag.Right, ' r'], [Flag.Center, ' c'], [Flag.Head, ' hd'], [Flag.Cell, ' cell']];

/** A line of text: its classes (its flags'; a signature in small caps, fill.rs; a marked
 *  paragraph's), where it sits, the size a smaller table is set at, the spacing a line the
 *  press shrank needs, and around it a reader's mark beside the paragraph and the dots of
 *  its notes. */
function textHTML({ flags, spaces, top, bi, b, x, avail, nat, s, e }: Line, { M, marks, marksOf, fb }: Draw): string {
  let cls = 'ln';
  for (const [bit, c] of LINE_CLASSES) if (flags & bit) cls += c;
  if (b.k === BlockKind.Sign) cls += ' sc2';
  if (marks.has(b.key)) cls += ' mk';
  const left = rtl(b) ? (cls += ' rtl', M.colW - x - avail) : x;
  // an indented line knows its indent, so a mark's bar and wash start at the column's edge
  let style = `top:${top}px;left:${left.toFixed(2)}px;width:${avail.toFixed(2)}px${x > 0 ? `;--x:${x.toFixed(2)}px` : ''}`;
  // a table set smaller: its size, and optical sizes to match (as the press measures)
  const sized = flags & Flag.Sized ? spaces / 16 : 0;
  if (sized) style += `;font-size:${sized}px;--opsz:${opsz(sized)};--opsz-s:${opsz(sized * 0.7)};--opsz-sc:${opsz(sized * 0.78)}`;
  // a line the press shrank: tighten the spaces so the browser's natural width fits; the
  // browser applies word spacing to every word separator on the line, the non-breaking
  // ones inside words included: spread the tightening over all of them
  if (nat > avail && (spaces > 0 || sized)) {
    const seps = (b.t.slice(s, e).match(/[ \u00a0]/g) || []).length || (sized ? 0 : spaces);
    if (seps) style += `;--fit:${((avail - nat) / seps - 0.02).toFixed(3)}px`;
  }
  const bullet = flags & Flag.Bullet ? '<span class="bul" aria-hidden="true">•</span>' : '';
  const anns = marksOf?.(b.key);
  // a paragraph another reader marked: a bar in their colour beside it (its own element:
  // a line's ::after is its hyphen, its ::before one's own mark's bar)
  const fm = fb?.marked(b.key)[0];
  return (fm ? `<div class="fmb" style="top:${top}px;left:-18px;--fmc:var(--r${fb!.colourOf(fm.r)})" aria-hidden="true"></div>` : '')
    + `<div class="${cls}" style="${style}" data-b="${bi}" data-s="${s}">${bullet}${inline(b, s, e, anns, fb?.segments(b.key))}</div>`
    + noteDots(anns, s, e, top, M, fb ? fb.written(b.key).map(w => ({ id: w.r + '|' + w.n.id, s: w.n.s, colour: fb.colourOf(w.r) })) : undefined);
}

function headHTML(book: BookData, si: number, M: Metrics): string {
  const s = book.sections[si];
  const label = s.label || (s.title ? '' : `Chapter ${s.num}`);
  return `<header class="chead" style="height:${M.headRows * M.lh}px">
    ${s.part ? `<div class="part">${esc(s.part)}</div>` : ''}
    ${label ? `<div class="label">${esc(label)}</div>` : ''}
    ${s.title ? `<h2 class="title">${esc(s.title)}</h2>` : ''}
  </header>`;
}

export function chapName(book: BookData, si: number) {
  const s = book.sections[si];
  if (!s) return '';
  return s.label || s.title || `Chapter ${s.num}`;
}

export function chapTitle(book: BookData, si: number) {
  const s = book.sections[si];
  if (!s) return '';
  if (s.label && s.title) return `${s.label} · ${s.title}`;
  return s.label || s.title || `Chapter ${s.num}`;
}

export interface LeafCtx {
  totalLines: number;
  N: number;
}

/** Whole columns that are not running text. */
export function leafHTML(strip: Strip, it: Item, ctx: LeafCtx): string {
  const b = strip.book;
  switch (it.type) {
    case 'title':
      return `<section class="leaf title-leaf">
        <div class="tl">
          ${b.author ? `<p class="tl-author">${esc(b.author)}</p>` : ''}
          <h1 class="tl-title">${esc(b.title)}</h1>
          ${b.subtitle ? `<p class="tl-sub">${esc(b.subtitle)}</p>` : ''}
        </div>
      </section>`;
    case 'colophon':
      // an extract on someone else's page, with a way on (kit/volumen.js: end-href)
      if (embedOpts.endHref) return `<section class="leaf colophon">
        <p class="eyebrow">The end of this extract</p>
        <p class="co-title">${esc(b.title)}</p>
        <p class="co-way"><a class="btn primary" href="${esc(embedOpts.endHref)}" target="_top" rel="noopener">${esc(embedOpts.endLabel ?? 'Continue reading')}</a></p>
      </section>`;
      return `<section class="leaf colophon">
        <p class="eyebrow">Colophon</p>
        <p class="co-finis">Finis</p>
        <p class="co-title">${esc(b.title)}</p>
        <p class="co-stich">${b.words.toLocaleString('en-GB')} words<br>${ctx.totalLines.toLocaleString('en-GB')} lines in ${ctx.N.toLocaleString('en-GB')} columns at this setting</p>
        <p class="note">Scribes often ended a manuscript with its count of lines, so a buyer could check that nothing was missing.</p>
      </section>`;
    default:
      return '';
  }
}
