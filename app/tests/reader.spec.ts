import { type Page } from '@playwright/test';
import { test, expect, SAMPLE } from './fixtures';
import { inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

// The interaction rules that are the point of the reader (reader/input.ts), against the app.
const cur = (p: Page) => p.evaluate(() => (window as any).__vol.reader.cur as number);
const runhead = (p: Page) => p.locator('.runhead').textContent();
const anchor = (p: Page) => p.evaluate(() => { const r = (window as any).__vol.reader; return JSON.stringify(r.strip.anchorAt(r.cur)); });
const settled = (p: Page) => p.waitForFunction(() => !(window as any).__vol.reader.motion.moving);

async function openSample(p: Page) {
  await p.goto('/');
  await p.evaluate(() => localStorage.clear());
  await p.goto('/');
  await p.locator('.book[data-id]').first().click();
  // reading begins before the whole book is laid out; tests want all of it
  await p.waitForFunction(() => { const r = (window as any).__vol.reader; return r.strip && r.strip.layouts.size === r.book.sections.length; });
}

/** Moves to the first text column of chapter I through the map, as a reader would. */
async function toChapterOne(p: Page) {
  await p.keyboard.press('m');
  await expect(p.locator('.map.ui-in')).toBeVisible();
  for (let i = 0; i < 4; i++) {
    if ((await p.locator('.mi-t').textContent())?.startsWith('Chapter I ·')) break;
    await p.keyboard.press(']');
    await p.waitForTimeout(150);
  }
  await expect(p.locator('.mi-t')).toHaveText(/^Chapter I ·/);
  await p.keyboard.press('Enter');
  await expect(p.locator('.map')).toBeHidden({ timeout: 5000 });
  await settled(p);
}

test('library, open: reading begins at once, and again where it was left', async ({ page: p }) => {
  await openSample(p);
  await expect(p.locator('.col')).not.toHaveCount(0);
  await expect(p.locator('.sheet')).toHaveCount(0);
  expect(await runhead(p)).toContain('Thursday');
  await toChapterOne(p);
  const k = await cur(p);
  await p.keyboard.press('q');
  await expect(p.locator('.shelf')).toBeVisible();
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => (window as any).__vol.reader.reading);
  await expect(p.locator('.sheet')).toHaveCount(0);
  expect(await cur(p)).toBe(k);
  expect(await runhead(p)).toMatch(/^I · /);
});

test('Enter travels from a chapter row clicked in the map', async ({ page: p }) => {
  await openSample(p);
  await p.keyboard.press('m'); await expect(p.locator('.map.ui-in')).toBeVisible();
  await p.locator('.ch-row').nth(4).click();
  await p.keyboard.press('Enter');
  await expect(p.locator('.map')).toBeHidden({ timeout: 6000 });
  expect(await runhead(p)).toMatch(/^III · /);
});

test('map travel is animated and lands on the chosen chapter', async ({ page: p }) => {
  await openSample(p);
  const t0 = Date.now();
  await toChapterOne(p);
  expect(Date.now() - t0).toBeGreaterThan(700);
  expect(await runhead(p)).toMatch(/^I · /);
});

test('a trackpad moves the sheet directly; its momentum tail is taken over and lands on a column', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  const k0 = await cur(p);
  await p.mouse.move(640, 400);
  for (const d of [12.5, 20.5, 30.5, 26.5]) { await p.mouse.wheel(0, d); await p.waitForTimeout(16); }
  // mid-gesture the sheet sits between columns, following the fingers
  const mid = await p.evaluate(() => (window as any).__vol.reader.motion.p);
  expect(mid - k0).toBeGreaterThan(0.05);
  expect(mid - k0).toBeLessThan(0.5);
  for (const d of [40.5, 30.5, 22.5, 15.5, 10.5, 6.5, 4.5, 2.5, 1.5]) { await p.mouse.wheel(0, d); await p.waitForTimeout(16); }
  await p.waitForTimeout(1200);
  await settled(p);
  expect(await cur(p)).toBe(k0 + 1);
});

test('a mouse wheel notch is one turn', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  const k0 = await cur(p);
  await p.mouse.move(640, 400);
  await p.mouse.wheel(0, 100);
  await p.waitForTimeout(1200);
  expect(await cur(p)).toBe(k0 + 1);
});

test('a drag moves the sheet one to one and settles on the column nearest where it let go', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  const k0 = await cur(p);
  const P = await p.evaluate(() => (window as any).__vol.reader.M.P);
  const drag = async (cols: number) => {
    await p.mouse.move(900, 500); await p.mouse.down();
    for (let i = 1; i <= 10; i++) { await p.mouse.move(900 - (i * P * cols) / 10, 500); await p.waitForTimeout(16); }
    const mid = await p.evaluate(() => (window as any).__vol.reader.motion.p);
    await p.waitForTimeout(120);                       // the hand pauses, then lets go
    await p.mouse.up();
    await p.waitForTimeout(1000); await settled(p);
    return mid;
  };
  expect((await drag(0.3)) - k0).toBeCloseTo(0.3, 1);
  expect(await cur(p)).toBe(k0);                       // 0.3 of the way: stays
  expect((await drag(0.7)) - k0).toBeCloseTo(0.7, 1);
  expect(await cur(p)).toBe(k0 + 1);                   // 0.7 of the way: the next column
});

test('with less motion, a tap moves at once and a drag let go finishes briefly rather than snapping', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  await p.evaluate(() => { (window as any).__vol.settings.motion = 'reduce'; });
  const k0 = await cur(p);
  // a key: at once, no frames between
  await p.keyboard.press('ArrowRight');
  expect(await p.evaluate(() => (window as any).__vol.reader.motion.p)).toBe(k0 + 1);
  // a drag of 0.7 let go: carried to the next column over a few frames, not in one
  const P = await p.evaluate(() => (window as any).__vol.reader.M.P);
  await p.mouse.move(900, 500); await p.mouse.down();
  for (let i = 1; i <= 10; i++) { await p.mouse.move(900 - (i * P * 0.7) / 10, 500); await p.waitForTimeout(16); }
  // every frame's position from just before the hand lets go
  await p.evaluate(() => { const m = (window as any).__vol.reader.motion, out: number[] = []; (window as any).trail = out; const f = () => { out.push(m.p); if (out.length < 40) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await p.mouse.up();
  await settled(p);
  const trail: number[] = await p.evaluate(() => (window as any).trail);
  expect(await cur(p)).toBe(k0 + 2);
  // in between: positions short of the end (not a single jump)
  const between = trail.filter(x => x > k0 + 1.72 && x < k0 + 1.99);
  expect(between.length).toBeGreaterThan(1);
  // (and quickly: the settle is a few frames, not a turn's length)
  expect(trail.length).toBeLessThan(15);
});

test('a gesture during a turn waits; key repeat is ignored', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  const k0 = await cur(p);
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(1600);
  expect(await cur(p)).toBe(k0 + 2);    // one turn, then at most one waiting gesture
  await p.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true })));
  await p.waitForTimeout(700);
  expect(await cur(p)).toBe(k0 + 2);
});

test('holding a key glides and settles on a whole column', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  const k0 = await cur(p);
  await p.keyboard.down('ArrowRight'); await p.waitForTimeout(1800); await p.keyboard.up('ArrowRight');
  await p.waitForTimeout(1200);
  await settled(p);
  const k1 = await cur(p);
  expect(k1 - k0).toBeGreaterThanOrEqual(2);
  const pos = await p.evaluate(() => (window as any).__vol.reader.motion.p);
  expect(pos).toBe(k1);
});

test('a long press selects the word under it; V then H highlights a paragraph', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  const k = await cur(p);
  const box = await p.locator(`.col[data-k="${k}"] .ln[data-b]`).nth(8).boundingBox();
  await p.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await p.mouse.down(); await p.waitForTimeout(500); await p.mouse.up();
  await expect(p.locator('.chip-pop')).toBeVisible();
  const word = await p.evaluate(() => { const r = (window as any).__vol.reader, c = (window as any).__vol.ui.chip; return r.selText(c.sel); });
  expect(word).toMatch(/^[\p{L}’'-]+[.,;:!?”’)]*$/u);         // one whole word (with its closing punctuation)
  await p.keyboard.press('Escape');
  await p.keyboard.press('v'); await p.keyboard.press('h'); await p.keyboard.press('Escape');
  await expect.poll(() => p.evaluate(() => (window as any).__vol.reader.ann.list.length)).toBe(1);
  await expect(p.locator(`.col[data-k="${k}"] mark.hl`).first()).toBeVisible();
});

test('resize and type size keep the sentence', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(700);
  const a = JSON.parse(await anchor(p));
  await p.setViewportSize({ width: 900, height: 700 }); await p.waitForTimeout(900);
  const b = JSON.parse(await anchor(p));
  expect(b.key).toBe(a.key);
  await p.keyboard.press('s'); await p.keyboard.press('='); await p.keyboard.press('='); await p.keyboard.press('Escape');
  await p.waitForTimeout(900);
  const c = JSON.parse(await anchor(p));
  expect(c.key).toBe(a.key);
});

test('dark paper, help, reset', async ({ page: p }) => {
  await openSample(p);
  await p.keyboard.press('s'); await p.keyboard.press('p'); await p.keyboard.press('p');
  await expect(p.locator('html')).toHaveAttribute('data-theme', 'dark');
  await p.keyboard.press('p');
  await expect(p.locator('html')).not.toHaveAttribute('data-theme', 'dark');
  await p.keyboard.press('Escape');
  await p.keyboard.press('?');
  await expect(p.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
});

test('plain-text import', async ({ page: p }) => {
  await p.goto('/');
  const txt = 'Title: A Small Test\nAuthor: Nobody\n\nCHAPTER I\n\nThe First\n\n' + Array(30).fill('It was a "quiet" day -- the kind that _rarely_ comes. '.repeat(6)).join('\n\n') +
    '\n\nCHAPTER II\n\nThe Second\n\n' + Array(25).fill('Another paragraph of plain words for testing. '.repeat(5)).join('\n\n');
  await p.setInputFiles('input[type=file]', { name: 'small-test.txt', mimeType: 'text/plain', buffer: Buffer.from(txt) });
  await expect(p.locator('.book .t', { hasText: 'A Small Test' })).toBeVisible();
  await p.locator('.book', { hasText: 'A Small Test' }).focus();
  await p.keyboard.press('x'); await p.keyboard.press('y');
  await expect(p.locator('.book .t', { hasText: 'A Small Test' })).toHaveCount(0);
});

test('a paragraph written right to left is set from the right edge', async ({ page: p }) => {
  await p.goto('/');
  const he = 'בראשית ברא אלהים את השמים ואת הארץ. והארץ היתה תהו ובהו וחשך על פני תהום ורוח אלהים מרחפת על פני המים. ';
  const txt = 'Title: Bereshit\nAuthor: Nobody\n\nCHAPTER I\n\n' + Array(12).fill(he.repeat(4)).join('\n\n') + '\n\n' + 'A paragraph in English among them, set as before. '.repeat(6);
  await p.setInputFiles('input[type=file]', { name: 'bereshit.txt', mimeType: 'text/plain', buffer: Buffer.from(txt) });
  await p.locator('.book', { hasText: 'Bereshit' }).click();
  await p.waitForFunction(() => { const r = (window as any).__vol.reader; return r.strip && r.strip.layouts.size === r.book.sections.length; });
  const r = await p.evaluate(() => {
    const rd = (window as any).__vol.reader; const out = { rtl: 0, ltr: 0, over: 0, misplaced: [] as string[] };
    for (let k = 0; k < rd.strip.N; k++) {
      rd.jump(k);
      for (const ln of document.querySelectorAll<HTMLElement>(`.col[data-k="${k}"] .ln:not(.brk)`)) {
        if ((window as any).__vol.residual(ln) > 0.5) out.over++;
        const rtl = ln.classList.contains('rtl');
        if (rtl) out.rtl++; else out.ltr++;
        if (rtl !== /[\u0590-\u05FF]/.test(ln.textContent!)) out.misplaced.push(ln.textContent!.slice(0, 20));
        // its words end at the box's right edge (the indent, if any, on that side)
        if (rtl) { const box = ln.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(ln); if (Math.abs(range.getBoundingClientRect().right - box.right) > 1) out.misplaced.push('not at the right: ' + ln.textContent!.slice(0, 20)); }
      }
    }
    return out;
  });
  expect(r.rtl).toBeGreaterThan(30);
  expect(r.ltr).toBeGreaterThan(0);
  expect(r.misplaced).toEqual([]);
  expect(r.over).toBe(0);
});

test('a screen reader hears the page in view as a document, not as lines', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(600);
  const r = await p.evaluate(() => {
    const rd = (window as any).__vol.reader, said = document.querySelector('.spoken')!;
    const words = (t: string) => t.replace(/-$/, '').replace(/\s+/g, ' ').trim();
    // the lines in view, each found in what is said (a hyphenated word whole)
    const inView: string[] = [], beside: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.col')) {
      const k = +el.dataset.k!, lines = [...el.querySelectorAll<HTMLElement>('.ln:not(.brk)')].map(l => words(l.textContent!)).filter(t => t.length > 30);
      (k >= rd.cur && k < rd.cur + rd.M.N ? inView : beside).push(...lines);
    }
    const text = said.textContent!.replace(/\s+/g, ' ');
    return {
      paragraphs: said.querySelectorAll('p').length,
      missing: inView.filter(l => !text.includes(l.split(' ').slice(1, -1).join(' '))),
      besideSaid: beside.filter(l => text.includes(l)).length,
      textHidden: [...document.querySelectorAll('.col:not(.leafcol)')].every(c => c.getAttribute('aria-hidden') === 'true'),
      inView: inView.length,
    };
  });
  expect(r.inView).toBeGreaterThan(20);
  expect(r.paragraphs).toBeGreaterThan(0);
  expect(r.missing).toEqual([]);
  expect(r.besideSaid).toBe(0);
  expect(r.textHidden).toBe(true);
  await expect(p.locator('.stage')).toMatchAriaSnapshot(`- region:\n  - paragraph`);
});

test('high contrast: what is chosen is ringed, the filled background gone', async ({ page: p, browserName }) => {
  test.skip(browserName !== 'chromium', 'forced colours are emulated in Chromium');
  await p.emulateMedia({ forcedColors: 'active' });
  await openSample(p);
  await p.keyboard.press('s');
  const ring = await p.locator('.seg [role=radio][aria-checked=true]').first().evaluate(e => getComputedStyle(e).outlineStyle);
  expect(ring).toBe('solid');
});

test('every line fits its box (Thursday)', async ({ page: p }) => {
  await openSample(p);
  const r = await p.evaluate(() => {
    const rd = (window as any).__vol.reader; let over = 0, lines = 0;
    for (let k = 0; k < rd.strip.N; k++) { rd.jump(k); for (const ln of document.querySelectorAll(`.col[data-k="${k}"] .ln:not(.brk)`)) { lines++; if ((window as any).__vol.residual(ln) > 0.5) over++; } }
    return { lines, over };
  });
  expect(r.lines).toBeGreaterThan(5000);
  expect(r.over).toBe(0);
});

test('Space turns the whole set in view; an arrow moves one column', async ({ page: p }) => {
  await p.setViewportSize({ width: 1600, height: 900 });
  await openSample(p);
  await toChapterOne(p);
  expect(await p.evaluate(() => (window as any).__vol.reader.M.N)).toBe(2);
  const k0 = await cur(p);
  await p.keyboard.press('Space'); await p.waitForTimeout(1300); await settled(p);
  expect(await cur(p)).toBe(k0 + 2);
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(1100); await settled(p);
  expect(await cur(p)).toBe(k0 + 3);
  await p.keyboard.press('Shift+Space'); await p.waitForTimeout(1300); await settled(p);
  expect(await cur(p)).toBe(k0 + 1);
});

test('C cycles the columns in view', async ({ page: p }) => {
  await p.setViewportSize({ width: 1600, height: 900 });
  await openSample(p);
  await p.keyboard.press('c');                                  // auto → one
  await expect.poll(() => p.evaluate(() => (window as any).__vol.reader.M.N)).toBe(1);
  await p.keyboard.press('c');                                  // one → two
  await expect.poll(() => p.evaluate(() => (window as any).__vol.reader.M.N)).toBe(2);
});

test('in a book sent by link, the chip offers reactions for its writer; 5 to 8 give one, again takes it off', async ({ page: p }) => {
  await openSample(p);
  // without a link: no reactions
  await toChapterOne(p);
  const k = await cur(p);
  const hold = async (n: number) => {
    const box = (await p.locator(`.col[data-k="${k}"] .ln[data-b]`).nth(n).boundingBox())!;
    const y = box.y + box.height / 2;
    await p.mouse.move(box.x + 20, y); await p.mouse.down(); await p.waitForTimeout(380);
    for (let i = 1; i <= 6; i++) { await p.mouse.move(box.x + 20 + i * 30, y); await p.waitForTimeout(16); }
    await p.mouse.up();
    await expect(p.locator('.chip-pop')).toBeVisible();
  };
  await hold(3);
  await expect(p.locator('.chip-pop .reacts')).toHaveCount(0);
  await p.keyboard.press('Escape');
  // as if it came by link
  await p.evaluate(() => { const v = (window as any).__vol; v.kv.set('joined.' + v.reader.book.id, { id: 'x', key: 'y' }); });
  await hold(5);
  await expect(p.locator('.chip-pop .reacts').getByRole('button')).toHaveCount(4);
  await p.keyboard.press('6');
  await expect(p.locator('.toast')).toContainText('Confused here');
  expect(await p.evaluate(() => (window as any).__vol.reader.ann.list.map((a: any) => a.react))).toEqual(['confused']);
  // its highlight's chip shows it chosen; the same key again takes it off
  await p.locator(`.col[data-k="${k}"] mark.hl`).first().click();
  await expect(p.locator('.chip-pop .reacts [aria-pressed="true"]')).toHaveText(/Confused/);
  await p.keyboard.press('6');
  expect(await p.evaluate(() => (window as any).__vol.reader.ann.list.map((a: any) => a.react ?? null))).toEqual([null]);
});

test('hold then drag selects; 2 highlights; N adds a note; the notebook lists and filters it', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  // a line in the focus column, held still, then dragged along
  const k = await cur(p);
  const box = await p.locator(`.col[data-k="${k}"] .ln[data-b]`).nth(3).boundingBox();
  const y = box!.y + box!.height / 2;
  await p.mouse.move(box!.x + 20, y); await p.mouse.down();
  await p.waitForTimeout(380);
  for (let i = 1; i <= 8; i++) { await p.mouse.move(box!.x + 20 + i * 30, y); await p.waitForTimeout(16); }
  await p.mouse.up();
  await expect(p.locator('.chip-pop')).toBeVisible();
  // the selection grew word by word: it starts and ends on word boundaries
  const sel = await p.evaluate(() => { const r = (window as any).__vol.reader, c = (window as any).__vol.ui.chip; return r.selText(c.sel); });
  expect(sel).toMatch(/^[\p{L}“‘]/u);
  expect(sel).toMatch(/[\p{L}’”.,;:!?]$/u);
  await p.keyboard.press('2');
  await expect(p.locator(`.col[data-k="${k}"] mark.hl.h2`).first()).toBeVisible();
  const quote = await p.evaluate(() => (window as any).__vol.reader.ann.list[0].quote);
  expect(quote.length).toBeGreaterThan(8);
  // tap the highlight: its chip; N: a note
  await p.locator(`.col[data-k="${k}"] mark.hl`).first().click();
  await expect(p.locator('.chip-pop')).toBeVisible();
  await p.keyboard.press('n');
  await p.keyboard.type('Gregory is all paradox.');
  await p.keyboard.press('Control+Enter');
  await expect(p.locator(`.col[data-k="${k}"] mark.hl.nt`)).toHaveCount(1);
  // the paragraph picker highlights from the keyboard; a whole-paragraph highlight absorbs
  // the one inside it and keeps its note
  await p.keyboard.press('v'); await p.keyboard.press('h'); await p.keyboard.press('Escape');
  const all = await p.evaluate(() => (window as any).__vol.reader.ann.list.map((a: any) => ({ len: a.e - a.s, note: a.note })));
  expect(all.length).toBe(1);
  expect(all[0].len).toBeGreaterThan(500);
  expect(all[0].note).toBe('Gregory is all paradox.');
  // the notebook
  await p.keyboard.press('m'); await expect(p.locator('.map.ui-in')).toBeVisible();
  await p.getByRole('button', { name: 'Notebook' }).click();
  await expect(p.locator('.mk-item.ann')).toHaveCount(1);
  await p.keyboard.press('/'); await p.keyboard.type('no such words');
  await expect(p.locator('.mk-item.ann')).toHaveCount(0);
  await p.keyboard.press('Control+a'); await p.keyboard.type('paradox');
  await expect(p.locator('.mk-item.ann')).toHaveCount(1);
  await expect(p.locator('.nb-note')).toHaveText('Gregory is all paradox.');
});

test('only the spread shows; the bar hides and returns without moving the text', async ({ page: p }) => {
  await p.setViewportSize({ width: 1600, height: 900 });
  await openSample(p);
  await toChapterOne(p);
  const g = await p.evaluate(() => { const M = (window as any).__vol.reader.M; return { N: M.N, x0: M.x0, right: M.W - M.x0 - M.focusW, G: M.G }; });
  expect(g.N).toBe(2);
  expect(Math.abs(g.x0 - g.right)).toBeLessThan(2);                         // balanced margins
  // the paper at the sides covers everything outside the spread
  const curtain = await p.locator('.curtain.l').boundingBox();
  expect(curtain!.width).toBeCloseTo(g.x0 - g.G / 2, 0);
  // the bar steps aside while reading, comes back at the top, and never moves the text
  await p.mouse.move(800, 500); await p.waitForTimeout(2600);
  await expect(p.locator('.bar')).toHaveClass(/away/);
  const before = await p.locator('.col .ln').first().boundingBox();
  await p.mouse.move(800, 20); await p.waitForTimeout(400);
  await expect(p.locator('.bar')).not.toHaveClass(/away/);
  const after = await p.locator('.col .ln').first().boundingBox();
  expect(after!.y).toBe(before!.y);
  expect(after!.x).toBe(before!.x);
});

/** Lays the book out again with the current settings and counts lines that overflow. */
async function fitAll(p: Page) {
  return p.evaluate(async () => {
    const v = (window as any).__vol, rd = v.reader;
    await rd.settingsChanged('layout');
    while (rd.strip.layouts.size !== rd.book.sections.length) await new Promise(r => setTimeout(r, 30));
    await new Promise(r => setTimeout(r, 60));
    v.resetFitStats();
    let over = 0, lines = 0, worst = 0;
    for (let k = 0; k < rd.strip.N; k++) {
      rd.jump(k);
      for (const ln of document.querySelectorAll(`.col[data-k="${k}"] .ln:not(.brk)`)) {
        lines++;
        const d = v.residual(ln);
        if (d > 0.5) { over++; worst = Math.max(worst, d); }
      }
    }
    // over: what a reader would see past the margin (must be none); corrected: lines the
    // press's model got wrong and the page brought back (its quality)
    return { lines, over, worst, corrected: v.fitStats.fixed, squeezed: v.fitStats.squeezed, font: getComputedStyle(document.querySelector('.ln')!).fontFamily };
  });
}

for (const id of ['original', 'quiet', 'paper', 'bold', 'calm', 'focus']) {
  test(`every line fits in the ${id} theme`, async ({ page: p }) => {
    await openSample(p);
    await p.evaluate(t => { (window as any).__vol.settings.theme = t; }, id);
    const r = await fitAll(p);
    expect(r.lines).toBeGreaterThan(4000);
    expect(r.over, JSON.stringify(r)).toBe(0);
    // the model itself is near perfect on its own fonts
    expect(r.corrected, JSON.stringify(r)).toBeLessThanOrEqual(r.lines / 1000);
  });
}

test('customised spacing, bold text and margins still fit, and reset', async ({ page: p }) => {
  await openSample(p);
  for (const id of ['calm', 'focus']) {
    await p.evaluate(t => {
      const v = (window as any).__vol, th = v.themeById(t);
      v.settings.theme = t;
      v.setOption(th, 'charSpacing', 3); v.setOption(th, 'wordSpacing', 8); v.setOption(th, 'boldText', !th.options.boldText);
      v.setOption(th, 'lineSpacing', 1.8); v.setOption(th, 'margins', 2); v.setOption(th, 'justify', true);
    }, id);
    const r = await fitAll(p);
    expect(r.over, `${id} ${JSON.stringify(r)}`).toBe(0);
    const ls = await p.evaluate(() => getComputedStyle(document.querySelector('.ln')!).letterSpacing);
    expect(parseFloat(ls)).toBeGreaterThan(0.3);
  }
  await p.keyboard.press('s');
  await p.keyboard.press('c');
  await p.keyboard.press('0');
  await expect.poll(() => p.evaluate(() => Object.keys((window as any).__vol.themes.opts.focus || {}).length)).toBe(0);
});

test('a pasted theme imports, saves and is chosen', async ({ page: p }) => {
  await openSample(p);
  await p.keyboard.press('s');
  await p.keyboard.press('n');
  await p.getByRole('button', { name: 'Import' }).click();
  const theme = { format: 'volumen-theme/1', name: 'Harbour', font: { family: 'Charis', fallback: 'serif', weight: 400, boldWeight: 700 },
    layout: { lineSpacing: 1.6, justify: true }, light: { paper: '#eef2f4', ink: '#8a8f93', accent: '#2f6f8f' }, dark: { paper: '#1b2328', ink: '#d3dde3', accent: '#7fb6d1' } };
  await p.getByLabel('Theme to import').fill('```json\n' + JSON.stringify(theme) + '\n```');
  await p.getByRole('button', { name: 'Use this theme' }).click();
  // the light ink was too faint: it is repaired and the repair is said
  await expect(p.locator('.notes')).toContainText('too faint');
  await p.getByRole('button', { name: 'Save theme' }).click();
  await expect(p.locator('.th[aria-checked="true"] .nm')).toHaveText('Harbour');
  await expect.poll(() => p.evaluate(() => getComputedStyle(document.querySelector('.ln')!).fontFamily)).toContain('Charis');
});

test('the settings panel: themes, customise page, reading page, all by key', async ({ page: p }) => {
  await openSample(p);
  await p.keyboard.press('s');
  const panel = p.getByRole('dialog', { name: 'Themes and settings' });
  await expect(panel).toBeVisible();
  // fits in the window without scrolling
  expect(await panel.evaluate(el => el.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  await p.keyboard.press('t');
  await expect(panel.locator('.th[aria-checked="true"] .nm')).toHaveText('Quiet');
  await p.keyboard.press('c');
  await expect(panel.getByText('Customise Quiet')).toBeVisible();
  await p.keyboard.press('y');
  await expect(panel.getByRole('switch', { name: /Hyphenation/ })).toHaveAttribute('aria-checked', 'false');
  await p.keyboard.press('Escape');
  await expect(panel.getByText('Themes & Settings')).toBeVisible();
  await p.keyboard.press('o');
  await expect(panel.getByText('Motion')).toBeVisible();
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  // a click on the page closes it too
  await p.keyboard.press('s');
  await p.mouse.click(400, 500);
  await expect(panel).toHaveCount(0);
});

test('the wheel: every notch counts, partial notches add up, a short push does not fall back', async ({ page: p }) => {
  await openSample(p);
  await p.evaluate(() => (window as any).__vol.reader.jump(20));
  const rest = async () => { await p.waitForTimeout(80); await settled(p); await p.waitForTimeout(250); return cur(p); };
  // wheel events as a webview delivers them, spaced in time
  const wheel = (deltas: number[], gap: number) => p.evaluate(async ([deltas, gap]) => {
    const st = (window as any).__vol.reader.stage as HTMLElement;
    for (const d of deltas) { st.dispatchEvent(new WheelEvent('wheel', { deltaY: d, deltaMode: 0, bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, gap)); }
  }, [deltas, gap] as [number[], number]);
  const k0 = await cur(p);
  await wheel([100], 0);                                          // a classic notch
  expect(await rest()).toBe(k0 + 1);
  await wheel(Array(12).fill(100), 30);                           // a spin: every notch counts
  expect(await rest()).toBe(k0 + 13);
  await p.waitForTimeout(500);
  await wheel(Array(8).fill(12.5), 40);                           // eighth-notch steps, turned slowly
  expect(await rest()).toBe(k0 + 14);
  await p.waitForTimeout(500);
  await wheel([3.1, 7.4, 14.9, 22.3, 25.8, 21.6, 15.2, 9.3, 4.1], 16);   // a trackpad push of a fifth of a column
  expect(await rest()).toBe(k0 + 15);
  await p.waitForTimeout(500);
  await wheel([1.2, 2.1, 1.4], 16);                               // a brush does nothing
  expect(await rest()).toBe(k0 + 15);
  await p.waitForTimeout(500);
  await wheel([-153], 0);                                         // WebKitGTK's notch, backwards
  expect(await rest()).toBe(k0 + 14);
});

test('find in book: count, marks, Enter travels, the list, Esc clears', async ({ page: p }) => {
  await openSample(p);
  await p.keyboard.press('Control+f');
  const field = p.locator('.find input');
  await expect(field).toBeFocused();
  await field.fill('gregory');
  await expect(p.locator('.find .count')).toHaveText(/^1 of \d{2,}$/);
  // the list is grouped by chapter, the match in bold
  await expect(p.locator('.find .hit b').first()).toHaveText(/Gregory/);
  const k0 = await cur(p);
  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter');
  await settled(p); await p.waitForTimeout(300);
  await expect(p.locator('.find .count')).toHaveText(/^3 of/);
  await expect(p.locator('.ln mark.h6')).toHaveCount(1);
  expect(await cur(p)).toBeGreaterThan(k0);
  // folding: curly quotes and case
  await field.fill("syme's");
  await expect(p.locator('.find .count')).toHaveText(/of \d+/);
  await p.keyboard.press('Escape');
  await expect(p.locator('.find')).toHaveCount(0);
  await expect(p.locator('.ln mark.h5, .ln mark.h6')).toHaveCount(0);
});

test('find from the map: matches light up, arrows choose, Enter travels, the search goes on', async ({ page: p }) => {
  await openSample(p);
  await p.keyboard.press('m'); await expect(p.locator('.map.ui-in')).toBeVisible();
  await p.keyboard.press('/');
  const field = p.locator('.m-find input');
  await expect(field).toBeFocused();
  await field.fill('gregory');
  await expect(p.locator('.m-count')).toHaveText(/^1\/\d{2,}$/);
  await expect(p.locator('.g-hit').first()).toBeAttached();
  await expect(p.locator('.mi-s')).toHaveText(/Match 1 of \d+/);
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown');
  await expect(p.locator('.m-count')).toHaveText(/^3\//);
  await expect(p.locator('.mi-s')).toHaveText(/Match 3 of/);
  const want = await p.evaluate(() => { const f = (window as any).__vol.reader.finder; return f.colOf(f.hits[f.cur]); });
  // n and N step too, once out of the field
  await p.keyboard.press('Escape');
  await expect(field).not.toBeFocused();
  await expect(p.locator('.map')).toBeVisible();
  await p.keyboard.press('n'); await expect(p.locator('.m-count')).toHaveText(/^4\//);
  await p.keyboard.press('N'); await expect(p.locator('.m-count')).toHaveText(/^3\//);
  await p.keyboard.press('/'); await expect(field).toBeFocused();
  await p.keyboard.press('Enter');
  await expect(p.locator('.map')).toBeHidden({ timeout: 6000 });
  await settled(p);
  // the page holds the match; the reader's find bar carries on with the same search
  const k = await cur(p), N = await p.evaluate(() => (window as any).__vol.reader.M.N);
  expect(want).toBeGreaterThanOrEqual(k); expect(want).toBeLessThan(k + N);
  await expect(p.locator('.ln mark.h6')).toHaveCount(1);
  await expect(p.locator('.find .count')).toHaveText(/^3 of/);
  await p.keyboard.press('Escape');
  await expect(p.locator('.ln mark.h5, .ln mark.h6')).toHaveCount(0);
});

test('the library notebook lists every book\'s entries, filters, and opens a book at one', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  // forward a few columns and highlight a paragraph there
  for (let i = 0; i < 4; i++) { await p.keyboard.press('ArrowRight'); await settled(p); }
  await p.keyboard.press('v'); await p.keyboard.press('h'); await p.keyboard.press('Escape');
  await expect.poll(() => p.evaluate(() => (window as any).__vol.reader.ann.list.length)).toBe(1);
  const want = await p.evaluate(() => { const r = (window as any).__vol.reader, a = r.ann.list[0]; return { key: a.key, quote: a.quote as string, col: r.strip.resolve({ key: a.key, off: a.s }) }; });
  // read on, so the place the book keeps is not the entry's
  for (let i = 0; i < 5; i++) { await p.keyboard.press('ArrowRight'); await settled(p); }
  expect(await cur(p)).not.toBe(want.col);
  await p.keyboard.press('q');
  await expect(p.locator('.shelf')).toBeVisible();
  await p.keyboard.press('n');
  const item = p.locator('.nb-item');
  await expect(item).toHaveCount(1);
  await expect(p.locator('.nb-book h2')).toContainText('Thursday');
  // the filter folds case and quotes, and every word must match
  const word = want.quote.split(/\s+/).find(w => w.length > 5)!.replace(/[^\p{L}]/gu, '');
  await p.locator('.nb-filter').fill(word.toUpperCase());
  await expect(item).toHaveCount(1);
  await p.locator('.nb-filter').fill(word + ' zzzqqq');
  await expect(item).toHaveCount(0);
  await p.locator('.nb-filter').fill(word);
  await p.keyboard.press('Enter');
  // straight into the book at the entry
  await expect(p.locator('.reader')).toBeVisible();
  await p.waitForFunction(() => { const r = (window as any).__vol.reader; return r.strip && !r.opening; });
  await expect(p.locator('.sheet')).toHaveCount(0);
  expect(await cur(p)).toBe(want.col);
  await expect(p.locator(`.col[data-k="${want.col}"] mark.hl`).first()).toBeVisible();
});

test('notes beside their lines: a dot in the gutter, ; shows them all, hover shows one, a move puts them away', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  await p.keyboard.press('ArrowRight'); await settled(p);
  // two noted highlights in the column in view
  await p.evaluate(() => {
    const r = (window as any).__vol.reader;
    const lines = [...document.querySelectorAll<HTMLElement>(`.col[data-k="${r.cur}"] .ln[data-b]`)];
    const sec = r.strip.itemAt(r.cur).sec, blocks = r.book.sections[sec].blocks;
    for (const [i, note] of [[2, 'First thought.'], [10, 'A second, longer thought about the passage.']] as const) {
      const ln = lines[i], b = blocks[+ln.dataset.b!], s0 = +ln.dataset.s!;
      r.ann.add(b.key, s0, Math.min(b.t.length, s0 + 30), 1, note);
    }
    r.refreshSection(sec);
  });
  const k = await cur(p);
  const dots = p.locator(`.col[data-k="${k}"] .nd`);
  await expect(dots).toHaveCount(2);
  // in the gutter: past the column's edge, never over its text
  const geo = await p.evaluate(k => {
    const col = document.querySelector(`.col[data-k="${k}"]`)!.getBoundingClientRect();
    return { right: col.right, dots: [...document.querySelectorAll(`.col[data-k="${k}"] .nd`)].map(d => d.getBoundingClientRect().left) };
  }, k);
  expect(geo.dots.every(x => x > geo.right)).toBe(true);
  // ; pins both; a spread leaves no room beside it, so each lies over its column below its
  // highlight, inside the window; a move puts them away
  await p.keyboard.press(';');
  const cards = p.locator('.sn');
  await expect(cards).toHaveCount(2);
  const W = await p.evaluate(() => innerWidth);
  for (const b of await cards.evaluateAll(els => els.map(e => e.getBoundingClientRect()).map(r => ({ left: r.left, right: r.right })))) expect(b.left >= 0 && b.right <= W).toBe(true);
  const [a, z] = await cards.evaluateAll(els => els.map(e => e.getBoundingClientRect()).map(r => ({ top: r.top, bottom: r.bottom })));
  expect(z.top).toBeGreaterThanOrEqual(a.bottom);
  await p.keyboard.press('ArrowRight');
  await expect(cards).toHaveCount(0);
  await p.keyboard.press('ArrowLeft'); await settled(p);
  // hovering a dot shows its note alone; a press on the card edits it
  await dots.first().hover();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('First thought.');
  const before = await cur(p);
  await cards.first().click();
  await expect(p.locator('.sheet')).toBeVisible();
  expect(await cur(p)).toBe(before);
});

test('collections: shelves that fill themselves, a named collection, A to file a book, [ ] to switch', async ({ page: p }) => {
  await p.goto('/');
  await p.evaluate(() => localStorage.clear());
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  const tabs = p.locator('.shelves [role=tab]');
  await expect(tabs).toHaveText(['All', 'Reading', 'Finished', 'Not started']);
  // the sample has never been opened
  await tabs.filter({ hasText: 'Not started' }).click();
  await expect(p.locator('.slot .book')).toHaveCount(1);
  await tabs.filter({ hasText: 'Reading' }).click();
  await expect(p.locator('.slot .book')).toHaveCount(0);
  await expect(p.locator('.none')).toBeVisible();
  // file it in a new collection from its sheet
  await tabs.filter({ hasText: 'All' }).click();
  await p.locator('.slot .book').first().focus();
  await p.keyboard.press('a');
  const sheet = p.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('New collection').fill('Essays');
  await p.keyboard.press('Enter');
  await expect(sheet.locator('.col-row')).toHaveCount(1);
  await expect(sheet.locator('.col-row input')).toBeChecked();
  // 1 takes it out again, and puts it back
  await sheet.getByRole('button', { name: /Done/ }).focus();
  await p.keyboard.press('1');
  await expect(sheet.locator('.col-row input')).not.toBeChecked();
  await p.keyboard.press('1');
  await expect(sheet.locator('.col-row input')).toBeChecked();
  await p.keyboard.press('Escape');
  await expect(tabs).toHaveText(['All', 'Reading', 'Finished', 'Not started', 'Essays']);
  // ] steps through the shelves to it; it holds the book; it is remembered
  await p.locator('.slot .book').first().focus();
  for (let i = 0; i < 4; i++) await p.keyboard.press(']');
  await expect(tabs.filter({ hasText: 'Essays' })).toHaveAttribute('aria-selected', 'true');
  await expect(p.locator('.slot .book')).toHaveCount(1);
  await p.reload();
  await expect(p.locator('.shelves [aria-selected=true]')).toHaveText('Essays');
  // renamed, then deleted: the book stays in the library
  await p.getByRole('button', { name: 'Rename or delete…' }).click();
  await p.getByRole('dialog').getByLabel('Name').fill('Long essays');
  await p.keyboard.press('Enter');
  await expect(tabs.last()).toHaveText('Long essays');
  await p.getByRole('button', { name: 'Rename or delete…' }).click();
  await p.getByRole('button', { name: 'Delete the collection' }).click();
  await expect(tabs).toHaveCount(4);
  await expect(p.locator('.shelves [aria-selected=true]')).toHaveText('All');
  await expect(p.locator('.slot .book')).toHaveCount(1);
});

test('library search: titles and authors at once, the text of every book beneath, a match opens there', async ({ page: p }) => {
  test.setTimeout(120000);
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  if (!(await p.locator('.book[data-id]', { hasText: 'Art of War' }).count())) await p.setInputFiles('input[type=file]', '../bench/fixtures/artofwar.epub');
  await p.locator('.book[data-id]', { hasText: 'Art of War' }).waitFor({ timeout: 60000 });
  await p.keyboard.press('/');
  const field = p.getByLabel('Search the library');
  await expect(field).toBeFocused();
  // an author: the grid narrows to that book
  await field.fill('sun tzu');
  await expect(p.locator('.slot .book')).toHaveCount(1);
  await expect(p.locator('.slot .book')).toContainText('Art of War');
  // words in the text only: no title matches, the matches below, Thursday's first
  await field.fill('saffron park');
  await expect(p.locator('.slot .book')).toHaveCount(0);
  const bk = p.locator('.res .bk');
  await expect(bk.first().locator('h3')).toContainText('Thursday', { timeout: 15000 });
  await expect(p.locator('.res .sum')).toHaveText(/\d+ match(es)? in \d+ book/);
  await expect(bk.first().locator('.hit b').first()).toHaveText(/saffron park/i);
  // down to the first match, Enter: the book opens there with the search going on
  await p.keyboard.press('ArrowDown');
  await expect(bk.first().locator('.hit').first()).toBeFocused();
  await p.keyboard.press('Enter');
  await expect(p.locator('.reader')).toBeVisible();
  await expect(p.locator('.find .count')).toHaveText(/^1 of \d+$/, { timeout: 10000 });
  await expect(p.locator('.ln mark.h6')).toHaveCount(1);
  await expect(p.locator('.sheet')).toHaveCount(0);
});

test('hints teach a faster way once, at the moment it helps', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  await p.evaluate(() => (window as any).__vol.setHints(true));
  // turning by clicking beside the text, four times: the keys are offered, once
  const box = (await p.locator('.stage').boundingBox())!;
  for (let i = 0; i < 4; i++) { await p.mouse.click(box.x + box.width - 40, box.y + box.height / 2); await settled(p); }
  await expect(p.locator('.toast')).toContainText('Space turns the page');
  expect(await p.evaluate(() => JSON.parse(localStorage.getItem('volumen.hints') || '[]'))).toEqual(['keys-turn']);
  // not again, even after the pause between hints
  await p.evaluate(() => (window as any).__vol.setHints(true));
  for (let i = 0; i < 4; i++) { await p.mouse.click(box.x + 40, box.y + box.height / 2); await settled(p); }
  expect(await p.evaluate(() => JSON.parse(localStorage.getItem('volumen.hints') || '[]'))).toEqual(['keys-turn']);
});

test('notes find their words again when the text has moved; notes whose words are gone are kept out of sight', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  await p.keyboard.press('ArrowRight'); await settled(p);
  await p.keyboard.press('v'); await p.keyboard.press('h'); await p.keyboard.press('Escape');
  await expect.poll(() => p.evaluate(() => (window as any).__vol.reader.ann.list.length)).toBe(1);
  const before = await p.evaluate(() => { const a = (window as any).__vol.reader.ann.list[0]; return { key: a.key, s: a.s, e: a.e, id: (window as any).__vol.reader.book.id }; });
  // as a later draft would have it: the note's key is another paragraph's, its offsets
  // are off; and a second note whose words are nowhere in this book
  await p.evaluate(b => {
    const r = (window as any).__vol.reader, blocks = r.book.sections.flatMap((s: any) => s.blocks);
    const other = blocks.find((x: any) => x.key !== b.key && x.t.length > 200).key;
    const list = r.ann.list.map((a: any) => ({ ...a, key: other, s: a.s + 7, e: a.e + 7 }));
    list.push({ ...list[0], id: 'gone', quote: 'words that were never in this book at all', prefix: 'nothing ', suffix: ' nowhere', s: 0, e: 10, note: 'lost' });
    r.ann.list = list;
    r.ann.save();
    r.close();
  }, before);
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => { const r = (window as any).__vol.reader; return r.strip && r.strip.layouts.size === r.book.sections.length; });
  const after = await p.evaluate(() => (window as any).__vol.reader.ann.list.map((a: any) => ({ id: a.id, key: a.key, s: a.s, e: a.e, lost: !!a.lost })));
  expect(after.find((a: any) => a.id !== 'gone')).toMatchObject({ key: before.key, s: before.s, e: before.e, lost: false });
  expect(after.find((a: any) => a.id === 'gone')).toMatchObject({ lost: true });
  // the lost one is neither in the notebook nor drawn
  const nb = await p.evaluate(() => (window as any).__vol.reader.notebook().map((e: any) => e.id));
  expect(nb).not.toContain('gone');
  await expect(p.locator('mark.hl[data-a="gone"]')).toHaveCount(0);
});

test('a reader sends notes, the writer sees them in place: underlined, dotted, gathered by passage', async ({ page: p }) => {
  // the reader: a note on a passage, a marked paragraph, sent as a file
  await openSample(p);
  await toChapterOne(p);
  await p.keyboard.press('ArrowRight'); await settled(p);
  await p.evaluate(() => {
    const r = (window as any).__vol.reader, lines = [...document.querySelectorAll<HTMLElement>(`.col[data-k="${r.cur}"] .ln[data-b]`)];
    const sec = r.strip.itemAt(r.cur).sec, blocks = r.book.sections[sec].blocks;
    const ln = lines[3], b = blocks[+ln.dataset.b!], s0 = +ln.dataset.s!;
    const a = r.ann.add(b.key, s0, s0 + 30, 2, 'This slowed me down — too much at once.');
    r.ann.update(a.id, { react: 'slow' });
    r.toggleMark(blocks[+lines[12].dataset.b!].key);
    r.refreshSection(sec);
  });
  await p.keyboard.press('m'); await expect(p.locator('.map.ui-in')).toBeVisible();
  await p.getByRole('button', { name: 'Notebook' }).click();
  await p.getByRole('button', { name: 'Send my notes…' }).click();
  const sheet = p.getByRole('dialog', { name: 'Send my notes' });
  await expect(sheet).toContainText('1 highlight, 1 with a note, 1 marked paragraph, how far you have read');
  await sheet.getByPlaceholder('Your name').fill('Anna');
  const [dl] = await Promise.all([p.waitForEvent('download'), sheet.getByRole('button', { name: /Save the file/ }).click()]);
  expect(dl.suggestedFilename()).toMatch(/notes from Anna\.vnotes$/);
  const text = await (await dl.createReadStream()).toArray().then(c => Buffer.concat(c).toString());
  expect(JSON.parse(text)).toMatchObject({ format: 'volumen-notes/1', from: { name: 'Anna' }, progress: { done: false, where: expect.stringMatching(/^Chapter I/) } });
  // (early in the book: by its text, under a hundredth of the way)
  expect(JSON.parse(text).progress.furthest).toBeGreaterThanOrEqual(0);
  expect(JSON.parse(text).notes.find((n: any) => n.note).react).toBe('slow');
  // the writer: another browser, the same book, no notes of their own (and another person:
  // everything stored is cleared, the store's memory too)
  await p.evaluate(() => { const kv = (window as any).__vol.kv; for (const k of kv.keys('')) kv.del(k); localStorage.clear(); indexedDB.deleteDatabase('volumen'); });
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  await p.setInputFiles('input[type=file]', { name: 'Thursday — notes from Anna.vnotes', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(p.locator('.toast')).toContainText('Notes from Anna');
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => { const r = (window as any).__vol.reader; return r.strip && r.strip.layouts.size === r.book.sections.length && r.fb?.size === 1; });
  // in place: her underline and her note's dot, where she put them
  const where = JSON.parse(text).notes.find((n: any) => n.note);
  const col = await p.evaluate(w => (window as any).__vol.reader.strip.resolve({ key: w.key, off: w.s }), where);
  await p.evaluate(k => (window as any).__vol.reader.jump(k), col); await p.waitForTimeout(400);
  await expect(p.locator(`.col[data-k="${col}"] .fb`).first()).toBeVisible();
  await expect(p.locator(`.col[data-k="${col}"] .nd.fd`)).toHaveCount(1);
  await expect(p.locator('.fmb').first()).toBeAttached();
  await p.locator(`.col[data-k="${col}"] .nd.fd`).hover();
  await expect(p.locator('.sn.theirs')).toContainText('Anna');
  await expect(p.locator('.sn.theirs')).toContainText('This slowed me down');
  // gathered in the notebook's Feedback side; hiding her takes her notes off the page
  await p.mouse.move(5, 5);
  await p.keyboard.press('m'); await expect(p.locator('.map.ui-in')).toBeVisible();
  // the map says where the feedback is: her two notes, in one chapter
  await expect(p.locator('.ch-fb')).toHaveText(['2']);
  await p.getByRole('button', { name: 'Notebook' }).click();
  await p.getByRole('button', { name: /^Feedback/ }).click();
  await expect(p.locator('.fbl .grp')).toHaveCount(2);
  await expect(p.locator('.fbl .grp').first()).toContainText('Anna');
  await p.locator('.fbl .chip').click();
  await expect(p.locator('.fbl .grp')).toHaveCount(0);
  await p.locator('.fbl .chip').click();
  // how far she read, beside her name
  await expect(p.locator('.fbl .far').first()).toContainText(/Anna has read \d+%, and is at Chapter I/);
  // her reaction, on her passage and counted
  await expect(p.locator('.fbl .t.re').first()).toHaveText('Slow here');
  await expect(p.locator('.fbl .far').nth(1)).toHaveText('Slow here 1');
  // a second reader on one of her passages: most readers first puts it first
  const second = JSON.parse(text);
  second.from = { id: 'tomas', name: 'Tomas' };
  second.progress = { at: 1, furthest: 1, where: 'Colophon', done: true };
  second.notes = [second.notes.find((n: any) => n.note)];
  expect(await p.evaluate(t => (window as any).__vol.reader.receiveNotes(t), JSON.stringify(second))).toMatch(/^Notes from Tomas: 1 placed/);
  await p.getByRole('button', { name: 'Most readers first' }).click();
  await expect(p.locator('.fbl .pas').first()).toContainText('2 readers');
  await expect(p.locator('.fbl .far').first()).toContainText('Tomas finished it');
  // one dealt with: Done, and Open only leaves the other
  await p.locator('.fbl .pas').first().getByRole('button', { name: 'Done' }).click();
  await p.getByRole('button', { name: 'Open only' }).click();
  await expect(p.locator('.fbl .grp')).toHaveCount(1);
  await p.getByRole('button', { name: 'Open only' }).click();
  await expect(p.locator('.fbl .pas.settled')).toHaveCount(1);
  await p.locator('.fbl .grp').first().click();
  await expect(p.locator('.map')).toBeHidden({ timeout: 6000 });
  await expect(p.locator('.ln .fb').first()).toBeVisible();
});

test('a Word manuscript opens as a book: its title, chapters and footnotes', async ({ page: p }) => {
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  await p.setInputFiles('input[type=file]', '../bench/fixtures/manuscript.docx');
  const book = p.locator('.book[data-id]', { hasText: 'The Lantern Keeper' });
  await book.waitFor({ timeout: 30000 });
  await book.click();
  await p.waitForFunction(() => { const r = (window as any).__vol.reader; return r.strip && r.strip.layouts.size === r.book.sections.length; });
  const s = await p.evaluate(() => { const b = (window as any).__vol.reader.book; return { title: b.title, author: b.author, chapters: b.sections.map((x: any) => x.label), notes: b.notes.length }; });
  expect(s).toEqual({ title: 'The Lantern Keeper', author: 'Ada Morrow', chapters: ['Chapter One', 'Chapter Two'], notes: 2 });
  await p.evaluate(() => (window as any).__vol.reader.jump((window as any).__vol.reader.strip.secStart[0]));
  await expect(p.locator('.col .ln a.nr').first()).toBeVisible();
});

async function openFile(p: Page, file: string, title: string) {
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  const book = p.locator('.book[data-id]', { hasText: title }).first();
  if (!(await book.count())) await p.setInputFiles('input[type=file]', file);
  await book.waitFor({ timeout: 90000 });
  await book.click();
  await p.waitForFunction(() => { const r = (window as any).__vol.reader; return r.strip && r.strip.layouts.size === r.book.sections.length; });
}
const firstCol = (p: Page, sel: string) => p.evaluate(sel => {
  const r = (window as any).__vol.reader, s = r.strip;
  for (let k = 3; k < s.N; k++) { r.jump(k); if (document.querySelector(`.col[data-k="${k}"] ${sel}`)) return k; }
  return -1;
}, sel);

test('a note marker opens its note; G goes to where it is printed', async ({ page: p }) => {
  test.setTimeout(120000);
  await openFile(p, '../bench/fixtures/artofwar.epub', 'Art of War');
  const k = await firstCol(p, 'a.nr');
  expect(k).toBeGreaterThan(0);
  await p.waitForTimeout(300);
  await p.locator(`.col[data-k="${k}"] a.nr`).first().click();
  const card = p.getByRole('dialog', { name: /^Note / });
  await expect(card).toContainText('Published at Paris in 1782.');
  const before = await cur(p);
  // a press on the card's text is the card's: the page beneath does not turn
  await card.locator('.body').click();
  await p.waitForTimeout(300);
  expect(await cur(p)).toBe(before);
  await expect(card).toHaveCount(1);
  await p.keyboard.press('g');
  await expect(card).toHaveCount(0);
  await settled(p); await p.waitForTimeout(300);
  expect(await cur(p)).toBeGreaterThan(before + 20);   // the endnotes are at the back
});

test('an image opens large and goes back; the keyboard can open it too', async ({ page: p }) => {
  test.setTimeout(120000);
  await openFile(p, '../bench/fixtures/beagle.epub', 'Beagle');
  const k = await firstCol(p, 'figure.img');
  expect(k).toBeGreaterThan(0);
  await p.waitForTimeout(500);
  const img = p.locator(`.col[data-k="${k}"] figure.img img`).first();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  await p.locator(`.col[data-k="${k}"] figure.img`).first().click();
  const lb = p.locator('.lb');
  await expect(lb).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(lb).toHaveCount(0);
  // V picks paragraphs; O opens the picked image
  await p.keyboard.press('v');
  for (let i = 0; i < 30 && !(await p.locator('.col .img.pick').count()); i++) await p.keyboard.press('j');
  await p.keyboard.press('o');
  await expect(lb).toBeVisible();
  await p.keyboard.press('Escape');
});

test('a fault in the engine: a plain message, and the engine starts again', async ({ page: p }) => {
  await openSample(p);
  const out = await p.evaluate(async () => {
    const R = (window as any).__vol.reader, core = R.core, id = R.book.id;
    // a layout already asked for when the fault comes is answered by the new engine
    const late = core.layout(id, [0], R.params(R.M)).then(() => 'ok', (e: Error) => e.message);
    const fault = await core.faultForTest().then(() => 'no fault', (e: Error) => e.message);
    const after = await core.layout(id, [1], R.params(R.M)).then(() => 'ok', (e: Error) => e.message);
    return { fault, late: await late, after, title: (await core.open(id)).title };
  });
  expect(out.fault).toMatch(/^Volumen hit a bug of its own \(a fault made on purpose, lib\.rs:\d+\)\.$/);
  expect(out).toMatchObject({ late: 'ok', after: 'ok', title: 'The Man Who Was Thursday' });
  // and the reader still turns
  const k = await cur(p);
  await p.keyboard.press('ArrowRight'); await settled(p);
  expect(await cur(p)).toBe(k + 1);
});

test('a file that is not a book: the library says what it is, and still opens books', async ({ page: p }) => {
  await p.goto('/');
  await p.locator('.book[data-id]').first().waitFor();
  await p.setInputFiles('input[type=file]', { name: 'IMG_0412.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]) });
  await expect(p.locator('.toast')).toHaveText('Couldn’t open IMG_0412.jpg: it is an image, not a book.');
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => { const r = (window as any).__vol.reader; return r.strip && r.strip.layouts.size === r.book.sections.length; });
});

test('notes exported as Markdown read cleanly and go back on the book exactly; a reader’s become feedback', async ({ page: p }) => {
  await openSample(p);
  const made = await p.evaluate(() => {
    const r = (window as any).__vol.reader;
    const bl = r.book.sections[3].blocks.filter((b: any) => b.t.length > 200);
    r.ann.add(bl[0].key, 10, 120, 2, 'A note here');
    r.ann.add(bl[2].key, 0, 200, 1, '');
    r.ann.add(bl[4].key, 30, 90, 4, '# not a heading\n\n> nor a quote');
    r.toggleMark(r.book.sections[4].blocks[3].key);
    const m = (window as any).__vol.map;
    const md = m.markdown(r.notebook().map((e: any) => ({ ...e, k: r.strip.resolve(e.at) })));
    const ann = r.ann.list.map((a: any) => ({ key: a.key, s: a.s, e: a.e, color: a.color, note: a.note })).sort((a: any, b: any) => a.key.localeCompare(b.key) || a.s - b.s);
    return { md, ann, marks: [...r.marks], id: r.book.id, me: (window as any).__vol.kv.get('me', null).id as string };
  });
  // read as Markdown: chapter headings without separators, the notes as written
  expect(made.md).toContain('\n## Chapter II: The Secret of Gabriel Syme\n');
  expect(made.md).not.toMatch(/^##.*·/m);
  expect(made.md).toContain('\nA note here\n');
  expect(made.md).toContain('\n\\# not a heading\n\n\\> nor a quote\n');
  expect(made.md.match(/<!-- at \{/g)).toHaveLength(4);
  // the book with no notes: the file puts them back where they were
  await p.keyboard.press('q');
  await p.evaluate(id => { for (const k of ['ann.', 'marks.', 'nb.']) (window as any).__vol.kv.del(k + id); }, made.id);
  await p.reload();
  await p.setInputFiles('input[type=file]', { name: 'Thursday — notes.md', mimeType: 'text/markdown', buffer: Buffer.from(made.md) });
  await expect(p.locator('.toast')).toHaveText('4 of your notes put back on “The Man Who Was Thursday”.');
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => (window as any).__vol.reader.reading);
  const back = await p.evaluate(() => {
    const r = (window as any).__vol.reader;
    return { ann: r.ann.list.map((a: any) => ({ key: a.key, s: a.s, e: a.e, color: a.color, note: a.note })).sort((a: any, b: any) => a.key.localeCompare(b.key) || a.s - b.s), marks: [...r.marks] };
  });
  expect(back).toEqual({ ann: made.ann, marks: made.marks });
  // the same file from someone else: their feedback, not one's own notes
  await p.keyboard.press('q');
  await p.setInputFiles('input[type=file]', { name: 'Anna — notes.md', mimeType: 'text/markdown', buffer: Buffer.from(made.md.replace(made.me, 'someone-else').replace(/"name":"[^"]*"/, '"name":"Anna"')) });
  await expect(p.locator('.toast')).toContainText('Notes from Anna on “The Man Who Was Thursday”: 4 notes.');
  // a dozen readers at once (a writer's folder of their files): one import, said once
  const theirs = (i: number, sent: number) => ({ name: `Reader ${i}.md`, mimeType: 'text/markdown', buffer: Buffer.from(made.md.replace(made.me, `reader-${i}`).replace(/"name":"[^"]*"/, `"name":"Reader ${i}"`).replace(/"sent":\d+/, `"sent":${sent}`)) });
  await p.setInputFiles('input[type=file]', [...Array.from({ length: 12 }, (_, i) => theirs(i, 2e12)), { name: 'shopping.json', mimeType: 'application/json', buffer: Buffer.from('{"eggs":12}') }]);
  await expect(p.locator('.toast')).toHaveText(/^Notes from 12 readers on “The Man Who Was Thursday”: 48 notes\. Open the book to see them beside the text\. 1 file was not notes \(shopping\.json\)\.$/);
  // a reader's older file, after their newer: nothing changes
  await p.setInputFiles('input[type=file]', [theirs(3, 1e12)]);
  await expect(p.locator('.toast')).toHaveText('These notes are here already.');
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => (window as any).__vol.reader.fb?.size === 13);
});

test('copying works where the page has no clipboard access (a phone over plain http)', async ({ page: p, browserName }) => {
  await p.addInitScript(() => Object.defineProperty(window, 'isSecureContext', { value: false }));
  await openSample(p);
  await p.evaluate(() => { const r = (window as any).__vol.reader; const b = r.book.sections[3].blocks.find((x: any) => x.t.length > 200); r.ann.add(b.key, 0, 60, 1, 'Kept'); });
  await p.keyboard.press('m'); await expect(p.locator('.map.ui-in')).toBeVisible();
  await p.getByRole('button', { name: 'Notebook' }).click();
  await p.getByRole('button', { name: 'Copy as Markdown' }).click();
  await expect(p.locator('.toast')).toHaveText('Copied');
  if (browserName === 'chromium') {
    await p.context().grantPermissions(['clipboard-read']);
    expect(await p.evaluate(() => navigator.clipboard.readText())).toContain('\nKept\n');
  }
});

test('a large cover is kept as a thumbnail the shelf can show; covers share one frame', async ({ page: p }) => {
  await p.goto('/');
  await p.locator('.book[data-id]').first().waitFor();
  const id = await p.locator('.book[data-id]').first().getAttribute('data-id');
  // (the library's own work on the sample's cover done first: it writes it back smaller)
  await expect(p.locator('.cover.img img').first()).toBeVisible();
  await p.waitForTimeout(800);
  // a 1600 × 2400 cover, as some publishers ship them
  await p.evaluate(async id => {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 2400;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${i * 7} 60% 50%)`; g.fillRect((i * 97) % 1600, (i * 131) % 2400, 120, 90); }
    const b = await new Promise<Blob>(r => c.toBlob(x => r(x!), 'image/jpeg', 0.95));
    await (window as any).__vol.reader.core.setCover(id, await b.arrayBuffer());
  }, id);
  await p.reload();
  await expect(p.locator('.cover.img img').first()).toBeVisible();
  await expect.poll(async () => p.evaluate(async id => {
    const buf = await (window as any).__vol.reader.core.cover(id);
    const bmp = await createImageBitmap(new Blob([buf]));
    return [bmp.width, bmp.height];
  }, id)).toEqual([480, 720]);
  // every cover the same frame, a generated one with a long title among them
  await p.setInputFiles('input[type=file]', { name: 'long.txt', mimeType: 'text/plain', buffer: Buffer.from('Title: The Extraordinarily Long and Winding Title of a Book Nobody Could Ever Fit on One Cover Whatever Its Size\nAuthor: Someone With a Rather Long Name Indeed\n\n' + 'Words of a book. '.repeat(400)) });
  await expect(p.locator('.book[data-id]')).toHaveCount(2);
  const sizes = await p.locator('.book .cover').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  expect(new Set(sizes.map(s => s.join('x'))).size).toBe(1);
});

test('the engine starts when needed and ends when no book is open; the library needs it not', async ({ page: p }) => {
  await openSample(p);
  expect(await p.evaluate(() => (window as any).__vol.reader.core.running())).toBe(true);
  await p.keyboard.press('q');
  await expect(p.locator('.shelf')).toBeVisible();
  // (the real wait is minutes) and what is asked meanwhile does not keep it: a search,
  // the offline cache's question every 30 s
  await p.evaluate(async () => { const c = (window as any).__vol.reader.core; c.idle(600); await c.fetched(); await c.searchLibrary('syme'); });
  expect(await p.evaluate(() => (window as any).__vol.reader.core.running())).toBe(true);
  await expect.poll(() => p.evaluate(() => (window as any).__vol.reader.core.running()), { timeout: 4000 }).toBe(false);
  // the library, its covers, a book added: all without the engine of reading
  await p.reload();
  await p.locator('.book[data-id]').first().waitFor();
  // (after the reader's first measurements, which start it)
  await expect.poll(() => p.evaluate(() => { const c = (window as any).__vol.reader.core; c.idle(0); return new Promise(r => setTimeout(() => r(c.running()), 100)); })).toBe(false);
  await expect(p.locator('.book[data-id]')).toHaveCount(1);
  await p.setInputFiles('input[type=file]', { name: 'small.txt', mimeType: 'text/plain', buffer: Buffer.from('Title: Small\n\n' + 'Words of a book. '.repeat(300)) });
  await expect(p.locator('.book[data-id]')).toHaveCount(2);
  // and a book opens as before, the engine started again
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => { const r = (window as any).__vol.reader; return r.reading && r.strip && r.strip.layouts.size === r.book.sections.length; });
  await expect(p.locator('.col .ln').first()).toBeVisible();
});

test('rich blocks: a genealogy, a figure and a formula drawn as the publisher made them, measured once', async ({ page: p }) => {
  await p.goto('/');
  await p.locator('.book[data-id]').first().waitFor();
  await p.setInputFiles('input[type=file]', '../bench/fixtures/rich.epub');
  const book = p.locator('.book[data-id]', { hasText: 'Houses and Figures' });
  await book.click();
  await p.waitForFunction(() => { const r = (window as any).__vol.reader; return r.reading && r.strip && r.strip.layouts.size === r.book.sections.length; });
  const sizes = await p.evaluate(() => (window as any).__vol.reader.book.images.map((i: any) => [i[0], i[1]]));
  expect(sizes.length).toBe(3);
  for (const [w, h] of sizes) { expect(w).toBeGreaterThan(20); expect(h).toBeGreaterThan(20); }
  // the genealogy, drawn in its column
  await p.evaluate(() => { const r = (window as any).__vol.reader; r.jump(r.strip.secStart[0]); });
  const img = p.locator('figure.img.rich img').first();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(300);
  // kept with the book: opened again, nothing to measure
  await p.keyboard.press('q');
  const id = await book.getAttribute('data-id');
  expect(await p.evaluate(async id => (await (window as any).__vol.reader.core.open(id)).images.map((i: any) => [i[0], i[1]]), id)).toEqual(sizes);
  // on dark paper, the ink turns light
  await book.click();
  await p.waitForFunction(() => (window as any).__vol.reader.reading);
  await p.evaluate(() => { const v = (window as any).__vol; v.settings.appearance = 'dark'; v.reader.themeChanged(); const r = v.reader; r.jump(r.strip.secStart[0]); });
  await expect.poll(() => p.locator('figure.img.rich img').first().evaluate(i => getComputedStyle(i).filter)).toContain('invert');
});

test('a link out of the book opens in a new tab, from a tap or the keyboard; only to the web and mail', async ({ page: p }) => {
  await p.goto('/');
  await p.locator('.book[data-id]').first().waitFor();
  const md = '---\ntitle: Linked\n---\n\n# One\n\nSee [the archive](https://example.org/archive) for the rest of the story, which goes on for some time.\n';
  await p.setInputFiles('input[type=file]', { name: 'linked.md', mimeType: 'text/markdown', buffer: Buffer.from(md) });
  await p.locator('.book[data-id]', { hasText: 'Linked' }).click();
  await p.waitForFunction(() => { const r = (window as any).__vol.reader; return r.reading && r.strip && r.strip.layouts.size === r.book.sections.length; });
  await p.evaluate(() => { const r = (window as any).__vol.reader; r.jump(r.strip.secStart[0]); });
  const link = p.locator('.col a.ur').first();
  await expect(link).toHaveText('the archive');
  const [tab] = await Promise.all([p.waitForEvent('popup'), link.click()]);
  expect(tab.url()).toBe('https://example.org/archive');
  // nothing of this page goes with it
  expect(await tab.evaluate(() => window.opener)).toBeNull();
  await tab.close();
  // the keyboard: V picks the paragraph, O opens what it holds
  await p.locator('.stage').focus();
  await p.keyboard.press('v');
  const [again] = await Promise.all([p.waitForEvent('popup'), p.keyboard.press('o')]);
  expect(again.url()).toBe('https://example.org/archive');
  await again.close();
  // and an address that is neither is refused, said plainly
  expect(await p.evaluate(() => (window as any).__vol.reader.openLink('javascript:alert(1)'))).toBeUndefined();
  await expect(p.locator('.toast')).toContainText('nowhere a book may send you');
});

test('rich blocks are measured where nothing runs or fetches, never in the page', async ({ page: p }) => {
  await p.goto('/');
  let fetched = 0;
  await p.route('**/beacon*', r => { fetched++; return r.fulfill({ status: 404, body: '' }); });
  // markup as a book saved by an earlier importer may hold it: a handler, a picture to fetch
  const r = await p.evaluate(async () => {
    // (the dev server's module, as the app loads it)
    const path = '/src/reader/rich.ts';
    const { measureRich }: typeof import('../src/reader/rich') = await import(/* @vite-ignore */ path);
    const w = window as any;
    w.ran = 0;
    // what reached the page itself (the app's own work adds and removes its probes meanwhile)
    const added: string[] = [];
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeName === 'IFRAME' || n.textContent?.includes('Edward III')) added.push(n.nodeName);
    }))).observe(document.body, { childList: true, subtree: true });
    const [size] = await measureRich(['<div style="background: url(/beacon1)">Edward III<img src="/beacon2" onerror="parent.ran = 1; window.ran = 1"/></div>']);
    await new Promise(r => setTimeout(r, 300));
    return { size, ran: w.ran, added, left: document.querySelectorAll('iframe').length };
  });
  expect(r.ran).toBe(0);
  expect(fetched).toBe(0);
  expect(r.size.w).toBeGreaterThan(40);
  // only its frame touched the page, and it is gone
  expect(r.added).toEqual(['IFRAME']);
  expect(r.left).toBe(0);
});

test('a notes file that is damaged or hostile is refused with a reason, or shown as text, never run', async ({ page: p }) => {
  await openSample(p);
  const said = (text: string) => p.evaluate(t => (window as any).__vol.reader.receiveNotes(t), text);
  // damaged: cut short, not a notes file, from a newer version, incomplete
  expect(await said('{"format":"volumen-notes/1","book":{"id":')).toBe('This is not a notes file.');
  expect(await said('{"hello":"world"}')).toBe('This is not a notes file.');
  expect(await said('{"format":"volumen-notes/9","book":{"id":"x"}}')).toBe('These notes come from a newer version of the app.');
  expect(await said('{"format":"volumen-notes/1","book":{"id":"x"}}')).toBe('This notes file is incomplete.');
  // hostile: markup in a reader's name and note, notes with impossible values among good ones
  const f = await p.evaluate(() => {
    const r = (window as any).__vol.reader, b = r.book.sections[3].blocks.find((x: any) => x.t.length > 120);
    return { format: 'volumen-notes/1', book: { id: r.book.id, title: r.book.title, author: '' }, from: { id: 'other', name: '<img src=x onerror="window.__pwned=1">Eve' }, sent: 1,
      notes: [
        { id: 'a', kind: 'highlight', key: b.key, s: 0, e: 30, quote: b.t.slice(0, 30), prefix: '', suffix: b.t.slice(30, 62), note: '<script>window.__pwned=2</script><b onmouseover="window.__pwned=3">bold?</b>', created: 1, updated: 1 },
        { id: 'b', kind: 'highlight', key: b.key, s: 'zero', e: 30, quote: 'x', created: 1, updated: 1 },
        { id: 'c', kind: 'nonsense', key: b.key, s: 0, e: 3, quote: 'abc', created: 1, updated: 1 },
        null,
      ] };
  });
  expect(await said(JSON.stringify(f))).toMatch(/^Notes from <img src=x onerror="window.__pwned=1">Eve: 1 placed/);
  // shown: her note beside its line, as text
  await p.evaluate(() => { const r = (window as any).__vol.reader; r.jump(r.strip.resolve({ key: r.book.sections[3].blocks.find((x: any) => x.t.length > 120).key, off: 0 })); });
  await p.waitForTimeout(500);
  await p.keyboard.press(';');
  await expect(p.locator('.sn.theirs').first()).toContainText('<script>window.__pwned=2</script>');
  expect(await p.evaluate(() => (window as any).__pwned)).toBeUndefined();
  expect(await p.locator('.sn img, .sn script, .sn b').count()).toBe(0);
});

test('one’s own notes edited on another device: the newer edit is kept', async ({ page: p }) => {
  await openSample(p);
  const md = await p.evaluate(() => {
    const r = (window as any).__vol.reader, b = r.book.sections[3].blocks.find((x: any) => x.t.length > 120);
    r.ann.add(b.key, 0, 40, 1, 'First thought.');
    return (window as any).__vol.map.markdown(r.notebook().map((e: any) => ({ ...e, k: r.strip.resolve(e.at) })));
  });
  // elsewhere, later: the note rewritten, its colour changed
  const later = md.replace('First thought.', 'Second thought, better.').replace(/"color":1/, '"color":3').replace(/"updated":\d+/, `"updated":${Date.now() + 60000}`);
  expect(await p.evaluate(t => (window as any).__vol.reader.receiveNotes(t), later)).toMatch(/^1 of your notes put back/);
  expect(await p.evaluate(() => (window as any).__vol.reader.ann.list.map((a: any) => [a.note, a.color]))).toEqual([['Second thought, better.', 3]]);
  // and an older copy changes nothing
  expect(await p.evaluate(t => (window as any).__vol.reader.receiveNotes(t), md)).toMatch(/are all here already/);
  expect(await p.evaluate(() => (window as any).__vol.reader.ann.list[0].note)).toBe('Second thought, better.');
});

test('notes Markdown damaged any which way gives a message, never an error', async ({ page: p }) => {
  await openSample(p);
  const out = await p.evaluate(async () => {
    const r = (window as any).__vol.reader, b = r.book.sections[3].blocks.filter((x: any) => x.t.length > 120);
    r.ann.add(b[0].key, 0, 40, 1, 'A note\n\n# with a heading-like line');
    r.ann.add(b[1].key, 10, 60, 2, '');
    r.toggleMark(b[2].key);
    const md: string = (window as any).__vol.map.markdown(r.notebook().map((e: any) => ({ ...e, k: r.strip.resolve(e.at) })));
    let seed = 7; const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) >>> 0) % n;
    const results: string[] = [];
    for (let i = 0; i < 150; i++) {
      let lines = md.split('\n');
      const how = i % 5;
      if (how === 0) lines = lines.slice(0, rnd(lines.length));
      else if (how === 1) lines.splice(rnd(lines.length), 1 + rnd(3));
      else if (how === 2) { const a = rnd(lines.length), z = rnd(lines.length); [lines[a], lines[z]] = [lines[z], lines[a]]; }
      else if (how === 3) { const k = rnd(lines.length); lines[k] = lines[k].slice(0, rnd(lines[k].length + 1)); }
      else { const k = rnd(lines.length); lines[k] = lines[k].replace(/[{}":,]/g, () => '#@!'[rnd(3)]); }
      try { const said = await r.receiveNotes(lines.join('\n')); results.push(typeof said === 'string' ? 'ok' : 'not a message'); }
      catch (e) { results.push('threw: ' + (e as Error).message); }
    }
    return results;
  });
  expect(out.filter(x => x !== 'ok')).toEqual([]);
});

test('a book read by an earlier importer is read again from its kept file; place, marks and notes stay', async ({ page: p }) => {
  const { IMPORTER_VERSION } = await import('../src/core/types');
  await openSample(p);
  await toChapterOne(p);
  const before = await p.evaluate(() => {
    const r = (window as any).__vol.reader, b = r.book.sections[3].blocks.filter((x: any) => x.t.length > 120);
    r.ann.add(b[0].key, 0, 40, 2, 'Kept across readings.');
    r.toggleMark(b[1].key);
    r.flush();
    return { id: r.book.id, pos: (window as any).__vol.kv.get('pos.' + r.book.id, null), marks: [...r.marks] };
  });
  await p.keyboard.press('q');
  // the engine's own version is the app's
  const entry = await p.evaluate(async () => (await (window as any).__vol.reader.core.library())[0]);
  expect(entry).toMatchObject({ importer: IMPORTER_VERSION, source: true });
  // made to look read by an earlier importer
  await p.evaluate(async () => {
    const req = indexedDB.open('volumen');
    const d: IDBDatabase = await new Promise(r => { req.onsuccess = () => r(req.result); });
    const t = d.transaction('meta', 'readwrite'), s = t.objectStore('meta');
    const g = s.get('library');
    await new Promise(r => { g.onsuccess = r; });
    s.put(g.result.map((e: any) => ({ ...e, importer: 1 })), 'library');
    await new Promise(r => { t.oncomplete = r; });
  });
  await p.reload();
  await expect(p.locator('.toast')).toContainText('read again', { timeout: 15000 });
  const after = await p.evaluate(async id => {
    const v = (window as any).__vol;
    return { importer: (await v.reader.core.library())[0].importer, pos: v.kv.get('pos.' + id, null), marks: v.kv.get('marks.' + id, []), digest: v.kv.get('nb.' + id, null)?.items?.length };
  }, before.id);
  expect(after).toEqual({ importer: IMPORTER_VERSION, pos: before.pos, marks: before.marks, digest: 2 });
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => (window as any).__vol.reader.reading);
  expect(await p.evaluate(() => (window as any).__vol.reader.ann.list.map((a: any) => a.note))).toEqual(['Kept across readings.']);
});

test('notes as W3C Web Annotations: exported, read back exactly; another tool’s placed by their words', async ({ page: p }) => {
  await openSample(p);
  const made = await p.evaluate(() => {
    const r = (window as any).__vol.reader, b = r.book.sections[3].blocks.filter((x: any) => x.t.length > 120);
    r.ann.add(b[0].key, 0, 40, 2, 'Worth keeping.');
    r.ann.add(b[1].key, 10, 70, 4, '');
    return { ann: r.ann.list.map((a: any) => [a.key, a.s, a.e, a.color, a.note]), quote: b[2].t.slice(20, 80), prefix: b[2].t.slice(0, 20), suffix: b[2].t.slice(80, 112) };
  });
  await p.keyboard.press('m'); await expect(p.locator('.map.ui-in')).toBeVisible();
  await p.getByRole('button', { name: 'Notebook' }).click();
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'As annotations…' }).click()]);
  const text = await (await dl.createReadStream()).toArray().then(c => Buffer.concat(c).toString());
  const json = JSON.parse(text);
  expect(json).toMatchObject({ '@context': 'http://www.w3.org/ns/anno.jsonld', type: 'AnnotationCollection', total: 2 });
  expect(json.first.items[0].target.selector[0].type).toBe('TextQuoteSelector');
  await p.keyboard.press('Escape');
  // the notes gone, then taken back from the file: every one where it was
  await p.evaluate(() => { const r = (window as any).__vol.reader; for (const a of [...r.ann.list]) r.unhighlight(a.id); });
  expect(await p.evaluate(t => (window as any).__vol.reader.receiveNotes(t), text)).toMatch(/^2 of your notes put back/);
  expect(await p.evaluate(() => (window as any).__vol.reader.ann.list.map((a: any) => [a.key, a.s, a.e, a.color, a.note]))).toEqual(made.ann);
  // another tool's annotation: only the words and what is around them
  const theirs = JSON.stringify([{ '@context': 'http://www.w3.org/ns/anno.jsonld', type: 'Annotation', creator: { name: 'Hypothesis user' }, body: [{ type: 'TextualBody', value: 'Interesting.' }],
    target: { source: 'https://example.org/book', selector: [{ type: 'TextQuoteSelector', exact: made.quote, prefix: made.prefix, suffix: made.suffix }] } }]);
  expect(await p.evaluate(t => (window as any).__vol.reader.receiveNotes(t), theirs)).toMatch(/^Notes from Hypothesis user: 1 placed/);
});

test('a book shared as a link: sealed by the writer, opened by a reader who has nothing, refused with a wrong key', async ({ page: p, browser }) => {
  await p.goto('/');
  await p.locator('.book[data-id]').first().waitFor();
  // the writer: a book of theirs, its sheet, Share as a link, the sealed file saved
  await p.setInputFiles('input[type=file]', '../bench/fixtures/tables.epub');
  const book = p.locator('.book[data-id]', { hasText: 'Tables and Figures' });
  await book.click({ button: 'right' });
  await p.getByRole('button', { name: 'Share as a link…' }).click();
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Save the sealed book…' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.vbook$/);
  const sealed = await (await dl.createReadStream()).toArray().then(c => Buffer.concat(c));
  expect(sealed.subarray(0, 5).toString()).toBe('VOLS2');
  expect(sealed.includes(Buffer.from('Wide tables'))).toBe(false);
  await p.getByLabel(/Put it where your readers can fetch it/).fill('https://books.example.org/thursday.vbook');
  const link = await p.getByLabel('The link').inputValue();
  expect(link).toMatch(/#open=https%3A%2F%2Fbooks\.example\.org%2Fthursday\.vbook&k=[\w-]{43}$/);
  // the reader: another browser, nothing in it
  const ctx = await browser.newContext();
  await ctx.route('https://books.example.org/**', r => r.fulfill({ body: sealed, headers: { 'Access-Control-Allow-Origin': '*' } }));
  const q = await ctx.newPage();
  await q.goto(link.replace(/^https?:\/\/[^/]+/, 'http://localhost:5193'));
  await q.waitForFunction(() => { const r = (window as any).__vol?.reader; return r?.reading && r.book?.title === 'Tables and Figures'; }, null, { timeout: 20000 });
  expect(await q.evaluate(() => location.hash)).toBe('');
  // welcomed once: no name was given, so no sender named
  await expect(q.getByRole('dialog', { name: 'A book sent to you' })).toContainText('Sent to you');
  await q.keyboard.press('Enter');
  await expect(q.getByRole('dialog')).toHaveCount(0);
  // a key not its own
  await q.goto(link.replace(/^https?:\/\/[^/]+/, 'http://localhost:5193').replace(/k=.$/, m => 'k=' + (m.endsWith('A') ? 'B' : 'A')).replace(/k=[\w-]+$/, k => k.slice(0, -2) + (k.endsWith('AA') ? 'BB' : 'AA')));
  await expect(q.locator('.toast')).toContainText('does not open the book', { timeout: 10000 });
  await ctx.close();
});

test('the whole library backed up and restored into a browser with nothing in it', async ({ page: p, browser }) => {
  await openSample(p);
  await p.evaluate(() => {
    const v = (window as any).__vol, r = v.reader, b = r.book.sections[3].blocks.find((x: any) => x.t.length > 120);
    r.ann.add(b.key, 0, 40, 3, 'Backed up with the book.');
    v.settings.size = 22;
    v.kv.set('settings', { size: 22 });
    v.kv.set('me', { id: 'reader-one', name: 'Ann' });
  });
  await p.keyboard.press('q');
  await p.setInputFiles('input[type=file]', '../bench/fixtures/tables.epub');
  await expect(p.locator('.book[data-id]')).toHaveCount(2);
  const me = await p.evaluate(() => (window as any).__vol.kv.get('me', null).id);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Back up the library…' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^Volumen library .*\.vbackup$/);
  const file = await (await dl.createReadStream()).toArray().then(c => Buffer.concat(c));
  // another browser, nothing in it but the sample
  const ctx = await browser.newContext();
  await ctx.route('**/sample.epub', r => r.fulfill({ path: SAMPLE, contentType: 'application/epub+zip' }));
  const q = await ctx.newPage();
  await q.goto('/');
  await q.locator('.book[data-id]').first().waitFor();
  await q.setInputFiles('input[type=file]', { name: 'Volumen library.vbackup', mimeType: 'application/octet-stream', buffer: file });
  await expect(q.locator('.toast')).toContainText('Restored: 1 book added');
  await q.waitForLoadState('load'); await q.waitForTimeout(2500);
  await expect(q.locator('.book[data-id]')).toHaveCount(2);
  const back = await q.evaluate(() => { const kv = (window as any).__vol.kv; const k = kv.keys('ann.')[0]; return { me: kv.get('me', null)?.id, size: kv.get('settings', {}).size, note: k && kv.get(k, [])[0]?.note }; });
  expect(back).toEqual({ me, size: 22, note: 'Backed up with the book.' });
  await ctx.close();
});

/** A file out of a zip (a Word document's parts), without a zip library. */
function unzipPart(zip: Buffer, name: string): string | null {
  for (let i = 0; i + 30 < zip.length; ) {
    if (zip.readUInt32LE(i) !== 0x04034b50) break;
    const method = zip.readUInt16LE(i + 8), size = zip.readUInt32LE(i + 18), nlen = zip.readUInt16LE(i + 26), xlen = zip.readUInt16LE(i + 28);
    const n = zip.subarray(i + 30, i + 30 + nlen).toString();
    const data = zip.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + size);
    if (n === name) return (method === 8 ? inflateRawSync(data) : data).toString();
    i += 30 + nlen + xlen + size;
  }
  return null;
}

test('readers\' feedback goes out to the writer\'s own files: Word comments, CriticMarkup, a report, a spreadsheet', async ({ page: p }) => {
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  const out: Record<string, { name: string; text: string; bytes: Buffer }> = {};
  for (const kind of ['docx', 'md']) {
    // the writer's book (the Word one, then the Markdown one: each newest, so first), and
    // two readers' notes on it
    await p.setInputFiles('input[type=file]', `../bench/fixtures/manuscript.${kind}`);
    await expect(p.locator('.toast')).toContainText('Added');
    // (the same title with feedback already: offered as a new draft; these are two books)
    if (kind === 'md') await p.getByRole('dialog', { name: 'A new draft' }).getByRole('button', { name: 'Keep them apart' }).click();
    await p.locator('.book[data-id]', { hasText: 'The Lantern Keeper' }).first().click();
    await p.waitForFunction(() => (window as any).__vol.reader.reading);
    const files = await p.evaluate(() => {
      const r = (window as any).__vol.reader, b = r.book.sections[0].blocks.filter((x: any) => x.k === 0);
      const note = (who: string, blk: any, from: number, len: number, said: string) => ({ format: 'volumen-notes/1', book: { id: r.book.id, title: r.book.title, author: '' }, from: { id: who.toLowerCase(), name: who }, sent: Date.now(),
        notes: [{ id: who + '1', kind: 'highlight', key: blk.key, s: from, e: from + len, quote: blk.t.slice(from, from + len), prefix: blk.t.slice(Math.max(0, from - 32), from), suffix: blk.t.slice(from + len, from + len + 32), note: said, created: 1, updated: 1 }] });
      return [note('Ann', b[0], 4, 30, 'The number matters here'), note('Tomas', b[1], 0, 20, 'A strong start')].map(f => JSON.stringify(f));
    });
    expect(await p.evaluate(t => (window as any).__vol.reader.receiveNotes(t), files)).toMatch(/^Notes from 2 readers: 2 placed/);
    await p.keyboard.press('m'); await expect(p.locator('.map.ui-in')).toBeVisible();
    await p.getByRole('button', { name: 'Notebook' }).click();
    await p.getByRole('button', { name: /^Feedback/ }).click();
    await p.getByRole('button', { name: 'Export…' }).click();
    const sheet = p.getByRole('dialog', { name: 'Export feedback' });
    await expect(sheet).toContainText('2 readers, 2 notes');
    const take = async (label: RegExp, key: string) => {
      const [dl] = await Promise.all([p.waitForEvent('download'), sheet.getByRole('button', { name: label }).click()]);
      const bytes = await (await dl.createReadStream()).toArray().then(c => Buffer.concat(c));
      out[key] = { name: dl.suggestedFilename(), text: bytes.toString(), bytes };
      if (await sheet.isVisible().catch(() => false)) return;
      await p.getByRole('button', { name: 'Export…' }).click();
    };
    await take(new RegExp(`^Into manuscript\\.${kind}`), kind);
    if (kind === 'docx') { await take(/^A report/, 'report'); await take(/^A spreadsheet/, 'csv'); }
    await p.evaluate(() => { const v = (window as any).__vol; v.ui.sheet = null; v.map.close(); v.reader.close(); });
    await expect(p.locator('.book[data-id]').first()).toBeVisible();
  }
  // Word: the readers' comments in the writer's file, on their words
  expect(out.docx.name).toBe('manuscript — with feedback.docx');
  const comments = unzipPart(out.docx.bytes, 'word/comments.xml')!;
  expect(comments).toContain('w:author="Ann"');
  expect(comments).toContain('A strong start');
  expect(unzipPart(out.docx.bytes, 'word/document.xml')!.match(/<w:commentRangeStart /g)).toHaveLength(2);
  // Markdown: CriticMarkup on the words
  expect(out.md.name).toBe('manuscript — with feedback.md');
  expect(out.md.text).toMatch(/\{==[^=]+==\}\{>>Ann: The number matters here<<\}/);
  expect(out.md.text).toMatch(/\{>>Tomas: A strong start<<\}/);
  // the report and the spreadsheet
  expect(out.report.text).toMatch(/^# Feedback on The Lantern Keeper\n/);
  expect(out.report.text).toContain('- **Tomas:** A strong start');
  expect(out.csv.text.split('\r\n')[0]).toBe('﻿Chapter,Passage,Reader,Note,Status,Place');
  expect(out.csv.text).toContain(',Ann,The number matters here,Open,');
});

test('a new draft of a book takes its notes, readers\' feedback and decisions with it', async ({ page: p }) => {
  const v1 = readFileSync('../bench/fixtures/manuscript.md', 'utf8');
  // the writer revises: a sentence rewritten, a paragraph added
  const v2 = v1.replace('She wrote that down in the back of her schoolbook, under the sums.', 'She kept the line in her head instead, where no one would mark it.')
    .replace('By morning the harbour board', 'The gulls were quiet that night.\n\nBy morning the harbour board');
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  await p.setInputFiles('input[type=file]', { name: 'manuscript.md', mimeType: 'text/markdown', buffer: Buffer.from(v1) });
  await expect(p.locator('.toast')).toContainText('Added');
  await p.locator('.book[data-id]', { hasText: 'The Lantern Keeper' }).first().click();
  await p.waitForFunction(() => (window as any).__vol.reader.reading);
  // a note of the writer's own, and a reader's two: on words that stay, and on words that go
  await p.evaluate(async () => {
    const r = (window as any).__vol.reader, bs = r.book.sections[0].blocks;
    const lantern = bs.find((b: any) => b.t.startsWith('The lantern')), sums = bs.find((b: any) => b.t.startsWith('She wrote'));
    r.ann.add(lantern.key, 4, 11, 1, 'Mine');
    const n = (b: any, s: number, e: number, said: string, id: string) => ({ id, kind: 'highlight', key: b.key, s, e, quote: b.t.slice(s, e), prefix: b.t.slice(Math.max(0, s - 32), s), suffix: b.t.slice(e, e + 32), note: said, created: 1, updated: 1 });
    await r.receiveNotes(JSON.stringify({ format: 'volumen-notes/1', book: { id: r.book.id, title: r.book.title, author: '' }, from: { id: 'ann', name: 'Ann' }, sent: 5,
      notes: [n(lantern, 4, 30, 'Keep this', 'a1'), n(sums, 33, 66, 'Lovely', 'a2')] }));
  });
  await p.keyboard.press('q');
  // the revised file: offered as the new draft
  await p.setInputFiles('input[type=file]', { name: 'manuscript v2.md', mimeType: 'text/markdown', buffer: Buffer.from(v2) });
  const sheet = p.getByRole('dialog', { name: 'A new draft' });
  await expect(sheet).toContainText('notes from 1 reader, 1 note of yours');
  await sheet.getByRole('button', { name: 'Carry over, and remove the earlier draft' }).click();
  await expect(p.locator('.toast')).toHaveText('Carried over to the new draft: 1 reader’s note from 1 reader (1 not found in this draft, kept), 1 note of yours.');
  await expect(p.locator('.book[data-id]', { hasText: 'The Lantern Keeper' })).toHaveCount(1);
  // in the new draft: the reader's note on its words, the writer's own too
  await p.locator('.book[data-id]', { hasText: 'The Lantern Keeper' }).click();
  await p.waitForFunction(() => { const r = (window as any).__vol.reader; return r.reading && r.fb?.size === 1; });
  const got = await p.evaluate(() => { const r = (window as any).__vol.reader; return { fb: r.fb.list()[0], mine: r.ann.list.map((a: any) => [a.quote, a.note]) }; });
  expect(got.fb).toMatchObject({ name: 'Ann', count: 1, lost: 1 });
  expect(got.mine).toEqual([['lantern', 'Mine']]);
});

test('notes for another book of the library, taken while reading, are kept for that book', async ({ page: p }) => {
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  await p.setInputFiles('input[type=file]', { name: 'manuscript.md', mimeType: 'text/markdown', buffer: readFileSync('../bench/fixtures/manuscript.md') });
  await expect(p.locator('.toast')).toContainText('Added');
  const other = (await p.locator('.book[data-id]', { hasText: 'The Lantern Keeper' }).first().getAttribute('data-id'))!;
  await p.locator(`.book[data-id]:not([data-id="${other}"])`).first().click();
  await p.waitForFunction(() => (window as any).__vol.reader.reading);
  const said = await p.evaluate(async id => {
    const r = (window as any).__vol.reader;
    return r.receiveNotes(JSON.stringify({ format: 'volumen-notes/1', book: { id, title: 'The Lantern Keeper', author: '' }, from: { id: 'ann', name: 'Ann' }, sent: 5,
      notes: [{ id: 'a1', kind: 'highlight', key: 'x', s: 0, e: 4, quote: 'abcd', prefix: '', suffix: '', note: 'Hm', created: 1, updated: 1 }] }));
  }, other);
  expect(said).toBe('Notes from Ann on “The Lantern Keeper”: 1 note. Open the book to see them beside the text.');
  expect(await p.evaluate(id => Object.keys((window as any).__vol.kv.get('fb.' + id, {})), other)).toEqual(['ann']);
  // the open book has none of them
  expect(await p.evaluate(() => (window as any).__vol.reader.fb.size)).toBe(0);
});

test('a book removed takes everything kept about it: place, highlights, notes, readers\' feedback, collections', async ({ page: p }) => {
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  await p.setInputFiles('input[type=file]', { name: 'manuscript.md', mimeType: 'text/markdown', buffer: readFileSync('../bench/fixtures/manuscript.md') });
  await expect(p.locator('.toast')).toContainText('Added');
  const book = p.locator('.book[data-id]', { hasText: 'The Lantern Keeper' }).first();
  const id = (await book.getAttribute('data-id'))!;
  // in a collection of the reader's (read as the app starts)
  await p.evaluate(i => localStorage.setItem('volumen.collections', JSON.stringify([{ id: 'c1', name: 'Drafts', books: [i] }])), id);
  await p.reload();
  await book.click();
  await p.waitForFunction(() => (window as any).__vol.reader.reading);
  await p.evaluate(async () => {
    const r = (window as any).__vol.reader, b = r.book.sections[0].blocks.find((x: any) => x.t.length > 40);
    r.ann.add(b.key, 0, 12, 1, 'Mine');
    r.toggleMark(b.key);
    await r.receiveNotes(JSON.stringify({ format: 'volumen-notes/1', book: { id: r.book.id, title: r.book.title, author: '' }, from: { id: 'ann', name: 'Ann' }, sent: 5,
      notes: [{ id: 'a1', kind: 'highlight', key: b.key, s: 0, e: 12, quote: b.t.slice(0, 12), prefix: '', suffix: b.t.slice(12, 44), note: 'Hm', created: 1, updated: 1 }] }));
  });
  await p.keyboard.press('q');
  const kept = () => p.evaluate(i => { const kv = (window as any).__vol.kv; return [...kv.keys('').filter((k: string) => k.endsWith('.' + i)), ...(JSON.stringify(kv.get('collections', [])).includes(i) ? ['collections'] : [])].sort(); }, id);
  expect(await kept()).toEqual(expect.arrayContaining(['ann.' + id, 'fb.' + id, 'marks.' + id, 'collections']));
  await p.locator(`.book[data-id="${id}"]`).focus();
  await p.keyboard.press('x');
  await p.getByRole('dialog', { name: 'Remove a book' }).getByRole('button', { name: /^Remove/ }).click();
  await expect(p.locator('.toast')).toHaveText('Removed from the library.');
  expect(await kept()).toEqual([]);
});

test('a sample of some chapters saved as an EPUB holds only those, and reads back', async ({ page: p }) => {
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  await p.setInputFiles('input[type=file]', '../bench/fixtures/manuscript.docx');
  await expect(p.locator('.toast')).toContainText('Added');
  await p.locator('.book[data-id]', { hasText: 'The Lantern Keeper' }).click({ button: 'right' });
  await p.getByRole('button', { name: 'Save as EPUB…' }).click();
  const sheet = p.getByRole('dialog', { name: 'Save as EPUB' });
  await expect(sheet.getByRole('button', { name: 'Save the book' })).toBeVisible();
  await sheet.getByLabel('to').fill('1');
  const [dl] = await Promise.all([p.waitForEvent('download'), sheet.getByRole('button', { name: 'Save the sample' }).click()]);
  expect(dl.suggestedFilename()).toBe('The Lantern Keeper — chapter 1.epub');
  const epub = await (await dl.createReadStream()).toArray().then(c => Buffer.concat(c));
  expect(epub.subarray(30, 38).toString()).toBe('mimetype');
  // read back: one chapter, the first
  await p.evaluate(() => { for (const k of (window as any).__vol.kv.keys('ann.')) (window as any).__vol.kv.del(k); });
  await p.setInputFiles('input[type=file]', { name: 'sample.epub', mimeType: 'application/epub+zip', buffer: epub });
  await expect(p.locator('.toast')).toContainText('Added');
  const book = p.locator('.book[data-id]', { hasText: 'The Lantern Keeper' }).first();
  await book.click();
  await p.waitForFunction(() => (window as any).__vol.reader.reading);
  expect(await p.evaluate(() => (window as any).__vol.reader.book.sections.map((s: any) => s.label))).toEqual(['Chapter One']);
});

test('adding a book asks the browser to keep the library for good', async ({ page: p }) => {
  await p.addInitScript(() => {
    (window as any).asked = 0;
    Object.defineProperty(navigator, 'storage', { value: { persisted: async () => false, persist: async () => { (window as any).asked++; return true; }, estimate: async () => ({}) } });
  });
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  expect(await p.evaluate(() => (window as any).asked)).toBe(0);   // not on opening: only once there is something of one's own
  await p.setInputFiles('input[type=file]', '../bench/fixtures/tables.epub');
  await expect(p.locator('.toast')).toContainText('Added');
  await expect.poll(() => p.evaluate(() => (window as any).asked)).toBe(1);
});
