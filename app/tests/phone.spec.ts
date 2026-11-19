import { devices, type Page } from '@playwright/test';
import { test, expect } from './fixtures';

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
  // the middle: the bar's controls come, and go again
  await p.waitForTimeout(2200);
  await expect(p.locator('.bar')).toHaveClass(/away/);
  await p.touchscreen.tap(box.x + box.width * 0.5, y);
  await expect(p.locator('.bar')).not.toHaveClass(/away/);
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

test('a phone: the colour around the page follows it; nothing scrolls the frame; the selection bar stays on the screen', async ({ page: p }) => {
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
  // the selection's controls: a bar along the foot of the screen, inside it
  await p.evaluate(() => { const st = (window as any).__vol.reader.stage.getBoundingClientRect(); (window as any).__vol.ui.chip = { x: st.width - 10, y: 20, sel: { a: [3, 2, 0], z: [3, 2, 20] }, ann: null }; });
  const vw = p.viewportSize()!;
  const r = (await p.locator('.chip-pop').boundingBox())!;
  expect(r.x).toBeGreaterThanOrEqual(0);
  expect(r.x + r.width).toBeLessThanOrEqual(vw.width);
  expect(r.y + r.height).toBeGreaterThan(vw.height - 80);
  expect(r.y + r.height).toBeLessThanOrEqual(vw.height);
});
