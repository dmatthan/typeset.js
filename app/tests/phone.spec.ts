import { devices, type Page } from '@playwright/test';
import { test, expect, openFile, firstCol } from './fixtures';

// A phone: one column as a spread, and the touch conventions (the outer fifth of the page
// turns it, the middle shows the bar); key hints hidden.
// (the project's engine: Chromium, or WebKit as on an iPhone; Firefox cannot be a phone)
const { defaultBrowserType: _, ...phone } = devices['iPhone 13'];
test.use(phone);

const cur = (p: Page) => p.evaluate(() => (window as any).__vol.reader.cur as number);
const settled = (p: Page) => p.waitForFunction(() => !(window as any).__vol.reader.motion.moving);

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

test('a phone: the selection is the system\'s, and stays; the menu stands clear of the system\'s own', async ({ page: p }) => {
  await open(p);
  const k = await cur(p);
  // a few words mid-page: the system's menu goes above them, ours below, clear of the
  // handle that hangs under the selection's end; no Copy (the system has its own)
  const mid = await select(p, 8);
  const menu = p.locator('.chip-pop');
  await expect(menu).toBeVisible();
  expect(await menu.getByRole('button', { name: 'Copy' }).count()).toBe(0);
  let m = await box(p);
  expect(m.top).toBeGreaterThanOrEqual(mid.bottom + 20);
  // it stays selected while the menu shows
  expect(await p.evaluate(() => getSelection()!.toString())).toBe(mid.text);
  // the top line: below it if the system's has room above, else past the system's below
  const top = await select(p, 0);
  if (top.top >= 74) await expect.poll(async () => (await box(p)).top).toBeGreaterThanOrEqual(top.bottom + 20);
  else await expect.poll(async () => (await box(p)).top).toBeGreaterThanOrEqual(top.bottom + 60);
  // the last line: the system's above it, and no room below for ours: above the system's
  const last = await select(p, 'last');
  await expect.poll(async () => (await box(p)).bottom).toBeLessThanOrEqual(last.top - 60);
  m = await box(p);
  expect(m.top).toBeGreaterThanOrEqual(0);
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
  await p.evaluate(() => (window as any).__vol.setHints(true));
  // the gestures are told once, as reading begins (here: reopened below)
  // the page cannot be moved sideways
  expect(await p.evaluate(() => { window.scrollTo(300, 0); return [window.scrollX, document.documentElement.scrollWidth <= innerWidth]; })).toEqual([0, true]);
  // the bar, away: a tap in its band brings it
  await p.waitForTimeout(2200);
  await expect(p.locator('.bar')).toHaveClass(/away/);
  const bar = (await p.locator('.bar').boundingBox())!;
  await p.touchscreen.tap(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await expect(p.locator('.bar')).not.toHaveClass(/away/);
  // the contents (the whole width), then back
  await p.locator('.bar').getByRole('button', { name: 'Contents' }).tap();
  await expect(p.locator('.contents')).toBeVisible();
  expect((await p.locator('.contents').boundingBox())!.width).toBeCloseTo(p.viewportSize()!.width, 0);
  await p.goBack();
  await expect(p.locator('.contents')).toHaveCount(0);
  await expect(p.locator('.reader')).toBeVisible();
  // back again: the library
  await p.goBack();
  await expect(p.locator('.shelf')).toBeVisible();
  await expect(p.locator('.reader')).toBeHidden();
  // reopened: the touch hint, no key hint
  await p.locator('.book[data-id]').first().tap();
  await expect(p.locator('.toast')).toContainText('Tap near the edges', { timeout: 5000 });
  await expect(p.locator('kbd').first()).toBeHidden();
});

test('a phone: settings are a sheet from the bottom edge; help shows gestures; a tap beside the sheet only closes it', async ({ page: p }) => {
  await open(p);
  const vw = p.viewportSize()!;
  await p.evaluate(() => { (window as any).__vol.ui.sheet = 'settings'; });
  const panel = p.locator('.panel');
  await expect(panel).toBeVisible(); await p.waitForTimeout(400);
  const r = (await panel.boundingBox())!;
  expect(r.x).toBe(0); expect(Math.round(r.width)).toBe(vw.width);
  expect(Math.round(r.y + r.height)).toBe(vw.height);
  // nothing a phone cannot use: the view and the columns
  await expect(panel.getByRole('radiogroup', { name: 'Columns' })).toHaveCount(0);
  // a tap on the page beside it closes it, and does not turn the page
  const k = await cur(p);
  await p.touchscreen.tap(vw.width * 0.92, 60);
  await expect(panel).toHaveCount(0);
  await p.waitForTimeout(400);
  expect(await cur(p)).toBe(k);
  // help, on a touch screen: the gestures
  await p.evaluate(() => { (window as any).__vol.ui.sheet = 'settings'; });
  await panel.getByRole('button', { name: 'Gestures' }).tap();
  await expect(p.locator('.sheet h2')).toHaveText('Gestures');
  await expect(p.locator('.sheet')).toContainText('Tap near an edge');
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
  // the selection's menu, for a selection in a corner: on the screen, clear of its edges
  // (where a browser's own bars may be)
  const vw = p.viewportSize()!;
  for (const [x, y] of [[vw.width - 10, 20], [10, vw.height - 70]]) {
    await p.evaluate(([x, y]) => { (window as any).__vol.ui.chip = null; (window as any).__vol.ui.chip = { x, y, b: y + 20, native: true, sel: { a: [3, 2, 0], z: [3, 2, 20] }, ann: null }; }, [x, y]);
    await expect(p.locator('.chip-pop')).toBeVisible();
    const r = (await p.locator('.chip-pop').boundingBox())!;
    expect(r.x).toBeGreaterThanOrEqual(10);
    expect(r.x + r.width).toBeLessThanOrEqual(vw.width - 10);
    expect(r.y).toBeGreaterThanOrEqual(10);
    expect(r.y + r.height).toBeLessThanOrEqual(vw.height - 10);
  }
});
