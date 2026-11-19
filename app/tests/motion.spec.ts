import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';

// Motion survives a page that gets few frames (Low Power Mode, a hot phone, a busy
// page): a move known when it starts is the compositor's to draw, so it goes on while
// the page's own thread does nothing at all. What the screen shows is read from
// Chromium's screencast, which the compositor feeds (a screenshot waits for the page).
test.skip(({ browserName }) => browserName !== 'chromium', 'the screencast is Chromium\'s');

async function openBook(p: Page) {
  await p.goto('/');
  await p.evaluate(() => localStorage.clear());
  await p.goto('/');
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => { const r = (window as any).__vol.reader; return r.strip && r.strip.layouts.size === r.book.sections.length && !r.motion.moving; });
  await p.waitForTimeout(800);
}

/** Starts something in the page (`start`, run there), then keeps the page's thread busy
 *  for `ms`; returns how many different frames the screen showed meanwhile. */
async function framesWhileBusy(p: Page, start: string, ms = 450) {
  const cdp = await p.context().newCDPSession(p);
  const frames: [number, string][] = [];
  cdp.on('Page.screencastFrame', f => {
    frames.push([f.metadata.timestamp ?? 0, createHash('md5').update(f.data).digest('hex')]);
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 30, everyNthFrame: 1 });
  await p.waitForTimeout(250);
  const [a, z] = await p.evaluate(([code, ms]) => new Promise<[number, number]>(done => {
    new Function('r', code as string)((window as any).__vol.reader);
    // once the move is under way (two frames: the compositor has it), the thread is busy
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const a = Date.now() / 1000, end = performance.now() + (ms as number);
      while (performance.now() < end);
      done([a, Date.now() / 1000]);
    }));
  }), [start, ms] as const);
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  return new Set(frames.filter(([t]) => t > a + 0.03 && t < z - 0.03).map(f => f[1])).size;
}

test('a turn goes on across the screen while the page is busy', async ({ page: p }) => {
  await openBook(p);
  expect(await framesWhileBusy(p, 'r.motion.tap(1, 1)')).toBeGreaterThanOrEqual(8);
  await p.waitForFunction(() => !(window as any).__vol.reader.motion.moving);
  expect(await p.evaluate(() => (window as any).__vol.reader.cur)).toBe(await p.evaluate(() => Math.round((window as any).__vol.reader.motion.p)));
});

test('a held key\'s glide goes on while the page is busy, and lands on a column when let go', async ({ page: p }) => {
  await openBook(p);
  const from = await p.evaluate(() => (window as any).__vol.reader.cur);
  await p.keyboard.down('ArrowRight');
  await p.waitForTimeout(700);
  expect(await p.evaluate(() => (window as any).__vol.reader.motion.mode)).toBe('cruise');
  expect(await framesWhileBusy(p, '')).toBeGreaterThanOrEqual(8);
  await p.keyboard.up('ArrowRight');
  await p.waitForFunction(() => !(window as any).__vol.reader.motion.moving);
  const at = await p.evaluate(() => { const r = (window as any).__vol.reader; return { cur: r.cur, p: r.motion.p }; });
  expect(at.p).toBe(at.cur);
  expect(at.cur).toBeGreaterThan(from + 1);
});

test('at rest the next turn\'s columns are built ahead: a turn builds none as it moves', async ({ page: p }) => {
  await openBook(p);
  for (const d of [1, -1, 1]) {
    await p.waitForTimeout(600);
    const made = await p.evaluate(dir => new Promise<number>(done => {
      const r = (window as any).__vol.reader;
      let n = 0;
      const seen = new MutationObserver(m => { for (const x of m) n += x.addedNodes.length; });
      seen.observe(r.surface.track, { childList: true });
      r.step(dir);
      const wait = () => (r.motion.moving ? requestAnimationFrame(wait) : (seen.disconnect(), done(n)));
      requestAnimationFrame(wait);
    }), d);
    expect(made).toBe(0);
  }
});
