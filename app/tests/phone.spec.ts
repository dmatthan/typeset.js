import { devices, type Page } from '@playwright/test';
import { test, expect, openFile, firstCol, settled } from './fixtures';

// A phone: one column as a spread, and the touch conventions (the outer fifth of the page
// turns it, the middle shows the bar); key hints hidden.
// (the project's engine: Chromium, or WebKit as on an iPhone; Firefox cannot be a phone)
const { defaultBrowserType: _, ...phone } = devices['iPhone 13'];
test.use(phone);

const cur = (p: Page) => p.evaluate(() => (window as any).__vol.reader.cur as number);

async function open(p: Page) {
  await p.goto('/');
  await p.evaluate(() => localStorage.clear());
  await p.goto('/');
  await p.locator('.book[data-id]').first().tap();
  await p.waitForFunction(() => { const r = (window as any).__vol.reader; return r.strip && r.strip.layouts.size === r.book.sections.length; });
  await p.evaluate(() => (window as any).__vol.reader.jump(10)); await settled(p);
}

/** A selection as the phone's own makes it (the system's handles and menu are its own;
 *  a test can only set what they would): words `from`–`to` of a line in the column in view. */
async function select(p: Page, line: number | 'last', from = 1, to = 4) {
  return p.evaluate(({ line, from, to }) => {
    const r = (window as any).__vol.reader;
    const lns = [...document.querySelectorAll<HTMLElement>(`.col[data-k="${r.cur}"] .ln[data-b]`)];
    const ln = lns[line === 'last' ? lns.length - 1 : line];
    const t = [...ln.childNodes].find(n => n.nodeType === 3 && /\S+\s+\S+\s+\S+\s+\S+/.test(n.textContent!)) as Text;
    const words = [...t.data.matchAll(/\S+/g)];
    getSelection()!.setBaseAndExtent(t, words[from].index!, t, words[to].index! + words[to][0].length);
    const b = getSelection()!.getRangeAt(0).getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, text: getSelection()!.toString() };
  }, { line, from, to });
}
const box = (p: Page) => p.locator('.chip-pop').evaluate(e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });

test('a phone: the selection is the system\'s, and stays; our menu is in the reader\'s own band farther from it', async ({ page: p }) => {
  await open(p);
  const k = await cur(p);
  const menu = p.locator('.chip-pop');
  // the bands the text never uses: the bar's at the top, the page number's at the foot
  const bands = await p.evaluate(() => { const r = (window as any).__vol.reader, st = r.stage.getBoundingClientRect(); return { top: st.top + r.M.y0, foot: st.top + r.M.y0 + r.M.colH }; });
  // (wherever the system puts its own, above or below the selection, it hugs it: ours is in
  // whichever band is farther, over no text, never beside the selection)
  for (const [line, band] of [[8, 'foot'], [0, 'foot'], ['last', 'top']] as const) {
    const sel = await select(p, line);
    await expect(menu).toBeVisible();
    await expect.poll(async () => { const m = await box(p); return band === 'foot' ? m.top >= bands.foot : m.bottom <= bands.top; }).toBe(true);
    const m = await box(p);
    expect(Math.min(Math.abs(m.top - sel.bottom), Math.abs(sel.top - m.bottom))).toBeGreaterThan(60);
    // no Copy (the system has its own); and it stays selected while the menu shows
    expect(await menu.getByRole('button', { name: 'Copy' }).count()).toBe(0);
    expect(await p.evaluate(() => getSelection()!.toString())).toBe(sel.text);
  }
  // a tap elsewhere only puts the selection away: no turn, no bar
  await expect(p.locator('.bar')).toHaveClass(/away/, { timeout: 10_000 });
  const away = await p.locator('.bar').getAttribute('class');
  const st = (await p.locator('.stage').boundingBox())!;
  await p.touchscreen.tap(st.x + st.width * 0.9, st.y + st.height * 0.5);
  await expect(menu).toHaveCount(0);
  expect(await p.evaluate(() => getSelection()!.isCollapsed)).toBe(true);
  expect(await cur(p)).toBe(k);
  expect(await p.locator('.bar').getAttribute('class')).toBe(away);
  // a colour highlights it; Note writes a note in a sheet with the passage quoted
  const sel = await select(p, 8);
  await menu.getByRole('button', { name: 'Highlight colour 2' }).tap();
  await expect(menu).toHaveCount(0);
  expect(await p.evaluate(() => (window as any).__vol.reader.ann.list.map((a: any) => a.quote))).toEqual([sel.text]);
  await select(p, 4);
  await menu.getByRole('button', { name: 'Note' }).tap();
  const sheet = p.locator('.sheet');
  await expect(sheet.locator('.q')).toBeVisible();
  await sheet.getByRole('textbox', { name: 'Your note' }).fill('From a phone.');
  await sheet.getByRole('button', { name: 'Done' }).tap();
  await expect(sheet).toHaveCount(0);
  expect(await p.evaluate(() => (window as any).__vol.reader.ann.list.filter((a: any) => a.note).map((a: any) => a.note))).toEqual(['From a phone.']);
});

test('a phone: a highlight tapped has its menu in one row, in a band, over none of its text', async ({ page: p }) => {
  await open(p);
  // a highlight over three lines in the middle of the page
  const id = await p.evaluate(() => {
    const r = (window as any).__vol.reader;
    const lns = [...document.querySelectorAll<HTMLElement>(`.col[data-k="${r.cur}"] .ln[data-b]`)];
    const ln = lns[Math.floor(lns.length / 2)], sec = r.strip.itemAt(r.cur).sec, b = r.book.sections[sec].blocks[+ln.dataset.b!], s0 = +ln.dataset.s!;
    const a = r.ann.add(b.key, s0, Math.min(b.t.length, s0 + 120), 3, 'A thought.');
    r.marking.refreshSection(sec);
    return a.id ?? a;
  });
  const marks = p.locator(`.col mark[data-a="${id}"]`);
  await expect(marks.nth(1)).toBeVisible();
  await marks.nth(1).tap();
  const pop = p.locator('.chip-pop');
  await expect(pop).toBeVisible();
  await expect(pop.getByRole('button', { name: 'Remove highlight' })).toBeVisible();
  const rows = await pop.locator(':scope > button').evaluateAll(els => new Set(els.map(e => Math.round(e.getBoundingClientRect().top))).size);
  expect(rows, 'the menu in one row').toBe(1);
  // over no line of the page (a band of the reader's own: no text there)
  const m = (await pop.boundingBox())!;
  const over = await p.locator('.col .ln').evaluateAll((els, m) => els.filter(e => { const r = e.getBoundingClientRect(); return r.width && r.left < m.x + m.width && r.right > m.x && r.top < m.y + m.height && r.bottom > m.y; }).length, m);
  expect(over).toBe(0);
});

test('a phone: a press whose end the page never hears (the system took it, to select) leaves the page turning', async ({ page: p }) => {
  await open(p);
  const box = (await p.locator('.stage').boundingBox())!;
  const y = box.y + box.height / 2;
  // a finger down on the text, as iOS sends it before its selection takes the press over;
  // its lift goes to the system, or lands outside the page (never here)
  await p.evaluate(([x, y]) => {
    const ln = document.elementFromPoint(x, y)!;
    ln.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 77, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true }));
    document.body.dispatchEvent(new PointerEvent('pointerup', { pointerId: 77, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true }));
  }, [box.x + box.width / 2, y]);
  // the next taps at the edge still turn, each one finger (not a second beside one gone)
  const k = await cur(p);
  await p.touchscreen.tap(box.x + box.width * 0.92, y); await settled(p);
  expect(await cur(p)).toBe(k + 1);
  // and one whose lift is never sent at all: the next finger down is a first one again
  await p.evaluate(([x, y]) => document.elementFromPoint(x, y)!.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 78, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true })), [box.x + box.width / 2, y]);
  await p.touchscreen.tap(box.x + box.width * 0.92, y); await settled(p);
  expect(await cur(p)).toBe(k + 2);
});

test('a phone: a finger held on the text and lifted is not a tap (the system selects there)', async ({ page: p }) => {
  await open(p);
  const k = await cur(p);
  // (reading: the bar gone since the book opened)
  await expect(p.locator('.bar')).toHaveClass(/away/, { timeout: 10_000 });
  const away = await p.locator('.bar').getAttribute('class');
  const st = (await p.locator('.stage').boundingBox())!;
  // held in the middle (a tap there shows the bar) and at the edge (a tap there turns)
  for (const at of [0.5, 0.9]) {
    await p.evaluate(async ({ x, y }) => {
      const s = document.querySelector('.stage')!;
      const ev = (type: string) => s.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, buttons: type === 'pointerup' ? 0 : 1 }));
      ev('pointerdown'); await new Promise(r => setTimeout(r, 700)); ev('pointerup');
    }, { x: st.x + st.width * at, y: st.y + st.height * 0.5 });
    await settled(p);
    expect(await cur(p)).toBe(k);
    expect(await p.locator('.bar').getAttribute('class')).toBe(away);
  }
});
test('a phone: a picture tapped opens large and stays (the tap\'s own click does not close it)', async ({ page: p }) => {
  test.setTimeout(120000);
  await openFile(p, '../bench/fixtures/beagle.epub', 'Beagle');
  const k = await firstCol(p, 'figure.img');
  await settled(p);
  // the click a touch screen sends after the tap, waited for
  const clicked = p.evaluate(() => new Promise<void>(r => addEventListener('click', () => r(), { capture: true, once: true })));
  await p.locator(`.col[data-k="${k}"] figure.img img`).first().tap();
  await clicked;
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(p.locator('.lb.shown')).toBeVisible();
  expect(await p.evaluate(() => !!(window as any).__vol.ui.lightbox)).toBe(true);
  // a tap on it puts it away
  await p.locator('.lb').tap();
  await expect(p.locator('.lb')).toHaveCount(0);
});

test('a phone: taps at the edges turn, the middle shows the bar, a swipe turns; no key hints', async ({ page: p }) => {
  await open(p);
  const M = await p.evaluate(() => { const m = (window as any).__vol.reader.M; return { N: m.N, x0: m.x0, colW: m.colW }; });
  expect(M.N).toBe(1);
  expect(M.x0).toBeGreaterThanOrEqual(16);
  const box = (await p.locator('.stage').boundingBox())!;
  const y = box.y + box.height / 2;
  const k = await cur(p);
  await p.touchscreen.tap(box.x + box.width * 0.92, y); await settled(p);
  expect(await cur(p)).toBe(k + 1);
  await p.touchscreen.tap(box.x + box.width * 0.08, y); await settled(p);
  expect(await cur(p)).toBe(k);
  // the middle: the bar's controls come, and go again; while reading only the page's number
  // shows under the text, with the bar the line and "N of Total"
  await expect(p.locator('.bar')).toHaveClass(/away/, { timeout: 10_000 });
  await expect(p.locator('.pn')).toHaveText([String(k + 1)]);
  await expect(p.locator('.where')).not.toBeVisible();
  await p.touchscreen.tap(box.x + box.width * 0.5, y);
  await expect(p.locator('.bar')).not.toHaveClass(/away/);
  const N = await p.evaluate(() => (window as any).__vol.reader.strip.N);
  await expect(p.locator('.where')).toHaveText(`${k + 1} of ${N}`);
  // finding in the book from the menu at the foot (a phone has no / to press)
  await p.getByRole('button', { name: 'More' }).tap();
  await p.getByRole('menuitem', { name: 'Find in the book' }).tap();
  await expect(p.getByRole('textbox', { name: 'Find in book' })).toBeFocused();
  await p.locator('.find').getByRole('button', { name: /End the search/ }).tap();
  await expect(p.locator('.find')).toHaveCount(0);
  await expect(p.locator('.bar')).not.toHaveClass(/away/);
  await expect(p.locator('.pn')).not.toBeVisible();
  expect(await cur(p)).toBe(k);
  await p.touchscreen.tap(box.x + box.width * 0.5, y);
  await expect(p.locator('.bar')).toHaveClass(/away/);
  // a swipe to the left: the next page
  await p.evaluate(({ x, y }) => {
    const st = document.querySelector('.stage')!;
    const ev = (type: string, cx: number) => st.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y, bubbles: true, buttons: type === 'pointerup' ? 0 : 1 }));
    ev('pointerdown', x + 300);
    for (let i = 1; i <= 10; i++) ev('pointermove', x + 300 - i * 22);
    ev('pointerup', x + 80);
  }, { x: box.x, y });
  await settled(p);
  expect(await cur(p)).toBe(k + 1);
  // no key hints on a touch screen
  await p.evaluate(() => { (window as any).__vol.ui.sheet = 'settings'; });
  await expect(p.locator('kbd').first()).toBeHidden();
});

test('a phone: back closes the contents, then the book; the bar comes back from its band; nothing pans', async ({ page: p }) => {
  await open(p);
  // (hints, where there are any, are off under automation: on, as a reader has them; none
  // comes as the book is reopened below)
  await p.evaluate(() => (window as any).__vol.setHints?.(true));
  // the page cannot be moved sideways
  expect(await p.evaluate(() => { window.scrollTo(300, 0); return [window.scrollX, document.documentElement.scrollWidth <= innerWidth]; })).toEqual([0, true]);
  // the bar, away: a tap in its band brings it
  await expect(p.locator('.bar')).toHaveClass(/away/, { timeout: 10_000 });
  const bar = (await p.locator('.bar').boundingBox())!;
  await p.touchscreen.tap(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await expect(p.locator('.bar')).not.toHaveClass(/away/);
  // the contents (the whole width), from the menu at the foot, then back
  await p.getByRole('button', { name: 'More' }).tap();
  await p.getByRole('menuitem', { name: 'Contents' }).tap();
  await expect(p.locator('.contents')).toBeVisible();
  expect((await p.locator('.contents').boundingBox())!.width).toBeCloseTo(p.viewportSize()!.width, 0);
  await p.goBack();
  await expect(p.locator('.contents')).toHaveCount(0);
  await expect(p.locator('.reader')).toBeVisible();
  // back again: the library
  await p.goBack();
  await expect(p.locator('.shelf')).toBeVisible();
  await expect(p.locator('.reader')).toBeHidden();
  // reopened: no hint, no key shown (a hint came 0.9 s in: nothing is waited for but time)
  await p.locator('.book[data-id]').first().tap();
  await expect(p.locator('.reader')).toBeVisible();
  await p.waitForTimeout(2500);
  await expect(p.locator('.toast.show')).toHaveCount(0);
  await expect(p.locator('kbd').first()).toBeHidden();
});

test('a phone: settings are a sheet from the bottom edge; help shows gestures; a tap beside the sheet only closes it', async ({ page: p }) => {
  await open(p);
  const vw = p.viewportSize()!;
  await p.evaluate(() => { (window as any).__vol.ui.sheet = 'settings'; });
  const panel = p.locator('.panel');
  await expect(panel).toBeVisible();
  // (where it rests, once it has slid in)
  await panel.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))));
  const r = (await panel.boundingBox())!;
  expect(r.x).toBe(0); expect(Math.round(r.width)).toBe(vw.width);
  expect(Math.round(r.y + r.height)).toBe(vw.height);
  // nothing a phone cannot use: the view and the columns
  await expect(panel.getByRole('radiogroup', { name: 'Columns' })).toHaveCount(0);
  // a tap on the page beside it closes it, and does not turn the page
  const k = await cur(p);
  await p.touchscreen.tap(vw.width * 0.92, 60);
  await expect(panel).toHaveCount(0);
  // (a turn would have begun within the tap)
  expect([await cur(p), await p.evaluate(() => (window as any).__vol.reader.motion.moving)]).toEqual([k, false]);
  // help, on a touch screen: the gestures
  await p.evaluate(() => { (window as any).__vol.ui.sheet = 'settings'; });
  await panel.getByRole('button', { name: 'Gestures' }).tap();
  await expect(p.locator('.sheet h2')).toHaveText('Gestures');
  await expect(p.locator('.sheet')).toContainText('Tap an edge');
});

test('a phone: the colour around the page follows it; nothing scrolls the frame; the menu keeps clear of the screen edges', async ({ page: p }) => {
  await p.goto('/');
  await p.evaluate(() => localStorage.clear());
  await p.goto('/');
  await p.locator('.book[data-id]').first().waitFor();
  const edge = () => p.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content'));
  const library = await edge();
  expect(library).toMatch(/^#[0-9a-f]{6}$/);
  await p.locator('.book[data-id]').first().tap();
  await p.waitForFunction(() => (window as any).__vol.reader.reading);
  // the book's paper, as the reader paints it
  const paper = await p.evaluate(() => { const c = document.createElement('canvas').getContext('2d')!; c.fillStyle = getComputedStyle(document.querySelector('.reader')!).backgroundColor; c.fillRect(0, 0, 1, 1); return '#' + [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)].map(v => v.toString(16).padStart(2, '0')).join(''); });
  await expect.poll(edge).toBe(paper);
  expect(paper).not.toBe(library);
  // Safari's (WebKit's) own: a box it can find at the top, else an installed app's top is
  // blurred, the bar with it (its height is the status bar's band, none here)
  if (p.context().browser()?.browserType().name() === 'webkit') {
    const top = () => p.evaluate(() => {
      const el = document.querySelector('.edge-strip.top')!, s = getComputedStyle(el);
      const c = document.createElement('canvas').getContext('2d')!; c.fillStyle = s.backgroundColor; c.fillRect(0, 0, 1, 1);
      return { seen: s.visibility, position: s.position, wide: el.getBoundingClientRect().width / innerWidth >= 0.9, z: +s.zIndex,
        colour: '#' + [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)].map(v => v.toString(16).padStart(2, '0')).join('') };
    });
    const bar = +await p.locator('.bar').evaluate(e => getComputedStyle(e).zIndex);
    await expect.poll(top).toMatchObject({ seen: 'visible', position: 'fixed', wide: true, colour: paper });
    expect((await top()).z).toBeGreaterThan(bar);
  }
  // the page itself never zooms
  expect(await p.evaluate(() => getComputedStyle(document.documentElement).touchAction)).toBe('pan-x pan-y');
  // controls at the screen's foot take focus without scrolling anything
  await p.evaluate(() => { (window as any).__vol.ui.sheet = 'settings'; });
  await p.locator('.panel .row.nav').first().tap();
  await p.locator('.panel .back').first().tap();
  await p.locator('.panel .row.nav').nth(1).tap();
  expect(await p.evaluate(() => [document.querySelector('.app')!.scrollTop, document.querySelector('.app')!.scrollLeft, visualViewport!.scale])).toEqual([0, 0, 1]);
  await p.evaluate(() => { (window as any).__vol.ui.sheet = null; });
  // the selection's menu, for a selection in a corner: on the screen, clear of its sides,
  // over no text (in a band of the reader's own)
  const vw = p.viewportSize()!;
  const text = await p.evaluate(() => { const r = (window as any).__vol.reader; return [r.M.y0, r.M.y0 + r.M.colH]; });
  for (const [x, y] of [[vw.width - 10, 20], [10, vw.height - 70]]) {
    await p.evaluate(([x, y]) => { (window as any).__vol.ui.chip = null; (window as any).__vol.ui.chip = { x, y, b: y + 20, finger: true, sel: { a: [3, 2, 0], z: [3, 2, 20] }, ann: null }; }, [x, y]);
    await expect(p.locator('.chip-pop')).toBeVisible();
    const r = (await p.locator('.chip-pop').boundingBox())!;
    expect(r.x).toBeGreaterThanOrEqual(10);
    expect(r.x + r.width).toBeLessThanOrEqual(vw.width - 10);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y + r.height).toBeLessThanOrEqual(vw.height);
    expect(r.y + r.height <= text[0] || r.y >= text[1]).toBe(true);
  }
});
