import { type Frame, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

/** What a view must hold to at any size, checked on the page as it is drawn:
 *  - the page itself never scrolls;
 *  - every control of the view (within `roots`) is on the screen, not under anything
 *    else, not overlapping another, and, on a touch screen, big enough for a finger;
 *  - its text is never below 13 px, never cut off (an ellipsis or a clamp is meant; nor
 *    the low or high strokes of a line, g and q, a box shorter than its face clips), never
 *    outside the screen or its panel, and never over other text.
 *  The book's own text (`.track`) is the press's, checked by fidelity, not here; `clear`
 *  names what the view's text must also keep off (the book's lines, under a bar with no
 *  paper of its own). `p`, a page or a frame in one (a book on another site's page).
 *  Returns what is wrong, each naming the element. */
export async function layout(p: Page | Frame, roots: string[], touch: boolean, clear = ''): Promise<string[]> {
  return p.evaluate(({ roots, touch, clear }) => {
    const out: string[] = [];
    const W = innerWidth, H = innerHeight, de = document.documentElement;
    const name = (el: Element) => {
      const c = [...el.classList].slice(0, 2).join('.'), l = el.getAttribute('aria-label') || el.getAttribute('title');
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
      return `${el.tagName.toLowerCase()}${c ? '.' + c : ''}${l ? `[${l.slice(0, 28)}]` : ''}${t ? ` “${t}”` : ''}`;
    };
    if (de.scrollWidth > W + 1) out.push(`the page scrolls sideways (${de.scrollWidth} > ${W})`);
    if (de.scrollHeight > H + 1) out.push(`the page scrolls (${de.scrollHeight} > ${H})`);

    /** On the screen (`drawn`), and there for everyone: not hidden from a screen reader. */
    const shown = (el: Element, drawn = false) => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05 || e.hasAttribute('hidden') || (e as HTMLElement).inert) return false;
        if (!drawn && e.getAttribute('aria-hidden') === 'true') return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    /** What of a box the clipping and scrolling boxes around it leave in sight (null:
     *  none); `own`: the element's own clipping too (for its text). */
    const inSight = (el: Element, r: { left: number; top: number; right: number; bottom: number } = el.getBoundingClientRect(), own = false) => {
      let [l, t, rt, b] = [r.left, r.top, r.right, r.bottom];
      for (let e = own ? el : el.parentElement; e && e !== document.body; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
        const c = e.getBoundingClientRect();
        l = Math.max(l, c.left); t = Math.max(t, c.top); rt = Math.min(rt, c.right); b = Math.min(b, c.bottom);
      }
      return rt - l > 0.5 && b - t > 0.5 ? { l, t, r: rt, b, w: rt - l, h: b - t } : null;
    };
    const els = roots.flatMap(s => [...document.querySelectorAll(s)]).filter(e => shown(e));
    const inside = (a: { l: number; t: number; r: number; b: number }, z: { l: number; t: number; r: number; b: number }) => a.l >= z.l - 1 && a.t >= z.t - 1 && a.r <= z.r + 1 && a.b <= z.b + 1;
    if (!els.length) out.push(`nothing shows for ${roots.join(', ')}`);
    const within = (e: Element) => !e.closest('.track');

    // controls
    const CTL = 'button, a[href], input:not([type=hidden]), textarea, select, [role=tab], [role=radio], [role=switch], [role=slider], [role=menuitem]';
    const ctls = [...new Set(els.flatMap(r => [...(r.matches(CTL) ? [r] : []), ...r.querySelectorAll(CTL)]))].filter(e => within(e) && shown(e));
    const boxes: { el: Element; b: NonNullable<ReturnType<typeof inSight>> }[] = [];
    for (const el of ctls) {
      const b = inSight(el);
      if (!b) continue;                       // scrolled away in its list
      boxes.push({ el, b });
      if (b.l < -1 || b.t < -1 || b.r > W + 1 || b.b > H + 1) out.push(`off the screen: ${name(el)} (${Math.round(b.l)},${Math.round(b.t)} ${Math.round(b.w)}×${Math.round(b.h)})`);
      const hit = document.elementFromPoint(Math.min(W - 1, Math.max(0, b.l + b.w / 2)), Math.min(H - 1, Math.max(0, b.t + b.h / 2)));
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el) && !(el as HTMLInputElement).labels?.[0]?.contains(hit) && !hit.closest('label')?.contains(el)) out.push(`covered: ${name(el)} under ${name(hit)}`);
      // a finger's: 44 points (Apple's), the smaller side, the whole control however much
      // of it a list shows; a link in a sentence is a word
      // (a switch or a swatch in a row that is its label: the row is what a finger presses)
      const lab = (el as HTMLInputElement).labels?.[0] ?? el.closest('label');
      const full = (lab && lab.contains(el) ? lab : el).getBoundingClientRect();
      if (touch && Math.min(full.width, full.height) < 43.5 && el.parentElement?.tagName !== 'P') out.push(`too small to touch: ${name(el)} (${Math.round(full.width)}×${Math.round(full.height)})`);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, z] = [boxes[i], boxes[j]];
      // (one within another: a control laid over a card, as a book's corner button)
      if (a.el.contains(z.el) || z.el.contains(a.el) || inside(a.b, z.b) || inside(z.b, a.b)) continue;
      const w = Math.min(a.b.r, z.b.r) - Math.max(a.b.l, z.b.l), h = Math.min(a.b.b, z.b.b) - Math.max(a.b.t, z.b.t);
      if (w > 1 && h > 1) out.push(`controls overlap: ${name(a.el)} and ${name(z.el)}`);
    }

    // text
    const texts: { el: Element; r: DOMRect }[] = [];
    for (const root of els) {
      const panel = root.getBoundingClientRect();
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const el = n.parentElement!;
        if (!n.textContent!.trim() || !within(el) || !shown(el) || el.closest('svg, .sr, .spoken, textarea, input, select')) continue;
        const s = getComputedStyle(el);
        if (parseFloat(s.fontSize) < 12.5 && !el.closest('sup')) out.push(`text below 13 px: ${name(el)} (${s.fontSize})`);
        const range = document.createRange(); range.selectNodeContents(n);
        // each line of it as far as it can be seen (an ellipsis, a list scrolled part way)
        for (const line of [...range.getClientRects()].filter(r => r.width > 0.5)) {
          const v = inSight(el, line, true);
          if (!v) continue;
          if (v.l < -1 || v.r > W + 1 || v.t < -1 || v.b > H + 1) { out.push(`text off the screen: ${name(el)}`); break; }
          if (v.l < panel.left - 1 || v.r > panel.right + 1 || v.t < panel.top - 1 || v.b > panel.bottom + 1) { out.push(`text outside ${name(root).split(' ')[0]}: ${name(el)}`); break; }
          texts.push({ el, r: new DOMRect(v.l, v.t, v.w, v.h) });
        }
      }
    }
    // cut off: a box that hides what it holds without saying so (an ellipsis or a clamp says
    // so; a list that scrolls one way is meant to), named once, with what overflows by how much
    const cut = new Set<Element>();
    for (const el of new Set(texts.map(t => t.el))) {
      for (let e: Element | null = el; e && els.some(r => r.contains(e!)); e = e.parentElement) {
        const s = getComputedStyle(e), h = e as HTMLElement;
        const clipsX = s.overflowX === 'hidden' || s.overflowX === 'clip', clipsY = s.overflowY === 'hidden' || s.overflowY === 'clip';
        const meant = s.textOverflow === 'ellipsis' || ((s as any).webkitLineClamp && (s as any).webkitLineClamp !== 'none');
        const dx = h.scrollWidth - h.clientWidth, dy = h.scrollHeight - h.clientHeight;
        if (!meant && ((clipsX && dx > 1) || (clipsY && dy > 1))) {
          if (!cut.has(e)) out.push(`cuts off what it holds: ${name(e).split(' ')[0]} (${clipsX && dx > 1 ? `${dx} px across` : `${dy} px down`})`);
          cut.add(e); break;
        }
        if (clipsX || clipsY) break;
      }
    }
    // a line in a box that clips it: its strokes, as the face draws them about the line's
    // baseline (half the leading above and below the face's own height), within the box
    const cx = document.createElement('canvas').getContext('2d')!;
    for (const el of new Set(texts.map(t => t.el))) {
      let clip: Element | null = null;
      for (let e: Element | null = el; e && els.some(r => r.contains(e!)); e = e.parentElement) {
        const o = getComputedStyle(e).overflowY;
        if (o === 'hidden' || o === 'clip') { clip = e; break; }
        if (o !== 'visible') break;
      }
      if (!clip) continue;
      const range = document.createRange(); range.selectNodeContents(el);
      const lines = [...range.getClientRects()].filter(r => r.width > 0.5);
      if (lines.length !== 1) continue;
      const s = getComputedStyle(el);
      cx.font = s.font || `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      const m = cx.measureText(el.textContent ?? ''), lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2;
      const box = el.getBoundingClientRect(), base = box.top + (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
      const c = clip.getBoundingClientRect();
      if (base + m.actualBoundingBoxDescent > c.bottom + 0.5 || base - m.actualBoundingBoxAscent < c.top - 0.5) out.push(`clips its letters' strokes: ${name(el)}`);
    }
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const [a, z] = [texts[i], texts[j]];
      if (a.el === z.el) continue;
      const w = Math.min(a.r.right, z.r.right) - Math.max(a.r.left, z.r.left), h = Math.min(a.r.bottom, z.r.bottom) - Math.max(a.r.top, z.r.top);
      if (w > 2 && h > 2) out.push(`text overlaps: ${name(a.el)} and ${name(z.el)}`);
    }
    if (clear) for (const c of document.querySelectorAll(clear)) {
      if (!shown(c, true)) continue;
      const v = inSight(c, c.getBoundingClientRect(), true);
      if (!v) continue;
      for (const t of texts) if (Math.min(t.r.right, v.r) - Math.max(t.r.left, v.l) > 2 && Math.min(t.r.bottom, v.b) - Math.max(t.r.top, v.t) > 2) out.push(`text over ${clear}: ${name(t.el)}`);
    }
    return [...new Set(out)];
  }, { roots, touch, clear });
}

/** Nothing moving, so that what the rules see is what stays: the reader at rest (where
 *  there is one: the app's own pages), and, two frames on (an animation about to start has
 *  started: a sheet's fade, from nothing), every finite animation and transition finished. */
export async function still(p: Page | Frame) {
  await p.waitForFunction(() => !(window as any).__typeset?.reader?.motion?.moving);
  await p.evaluate(async () => {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  });
}

/** Accessibility (axe-core: WCAG 2.1 A and AA, and best practice) of the page as it is. */
export async function access(p: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  return r.violations.map(v => `${v.id} (${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')})`);
}
