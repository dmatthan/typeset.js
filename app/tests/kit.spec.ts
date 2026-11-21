import { devices, type Page } from '@playwright/test';
import { test, expect } from './base';
import { layout, still } from './audit';

/* The kit: the reader alone, put in a folder of an ordinary site
 * (served here by Python's http.server, nothing of ours), placed on its pages by
 * kit/volumen.js. The pages are the repository's examples/. */

test('a chapter on a blog: only that chapter, the page told where the reader is, a way on at the end', async ({ page: p }) => {
  await p.goto('/');
  const f = p.frameLocator('volumen-book iframe');
  await expect(f.getByRole('slider', { name: 'Place in the book' })).toHaveAttribute('aria-valuetext', /^Page \d+/, { timeout: 30000 });
  // only Book III: its own title page, then its text
  await p.locator('volumen-book').click({ position: { x: 300, y: 300 } });
  await p.keyboard.press('Space');
  await expect(f.getByRole('slider', { name: 'Place in the book' })).toHaveAttribute('aria-valuetext', /Book III/, { timeout: 10000 });
  // reading on to the end: the page hears where the reader is, then the end
  for (let i = 0; i < 40 && !(await p.evaluate(() => (window as any).heard.some((h: any) => h[0] === 'end'))); i++) { await p.keyboard.press('Space'); await p.waitForTimeout(250); }
  const heard = await p.evaluate(() => (window as any).heard);
  expect(heard.some((h: any) => h[0] === 'progress' && h[1] > 0)).toBe(true);
  expect(heard.at(-1)).toEqual(['end']);
  // the end card: the author's way on, opening in the page itself
  const on = f.getByRole('link', { name: 'Buy the book' });
  await expect(on).toBeVisible();
  await expect(on).toHaveAttribute('href', /\/shop$/);
  await expect(on).toHaveAttribute('target', '_top');
  // nothing of the site taken over: no service worker anywhere
  expect(await p.evaluate(() => navigator.serviceWorker.getRegistrations().then(r => r.length))).toBe(0);
  // and nothing kept unless asked: the frame's storage is empty
  expect(await f.locator('body').evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('volumen.')).length)).toBe(0);
});

test('the reader runs under its own policy on the host\'s origin: nothing from elsewhere but books', async ({ page: p }) => {
  await p.goto('/');
  const f = p.frameLocator('volumen-book iframe');
  await expect(f.getByRole('slider', { name: 'Place in the book' })).toHaveAttribute('aria-valuetext', /^Page \d+/, { timeout: 30000 });
  const policy = await f.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).not.toContain('frame-ancestors');
  // a picture from another site is refused, as anything a book might try to load
  const refused = await f.locator('body').evaluate(() => new Promise<string>(res => {
    document.addEventListener('securitypolicyviolation', e => res(e.violatedDirective), { once: true });
    const img = document.createElement('img');
    img.src = 'https://example.org/beacon.png';
    document.body.append(img);
    setTimeout(() => res('loaded'), 3000);
  }));
  expect(refused).toBe('img-src');
});

test('a library on a page: a shelf from a list, each book opened in place', async ({ page: p }) => {
  await p.goto('/library/');
  const shelf = p.locator('volumen-library');
  await expect(shelf.getByRole('button', { name: /Meditations/ })).toBeVisible();
  await expect(shelf.getByRole('button')).toHaveCount(2);
  // the list names no covers: Meditations shows its EPUB's own (this server sends files
  // whole), the other, which has none, its title
  await expect(shelf.locator('.c.own')).toHaveCount(1);
  await expect(shelf.locator('.c').nth(1)).toHaveText('Tables and Figures');
  await shelf.getByRole('button', { name: /Tables and Figures/ }).click();
  await expect(p.frameLocator('volumen-library volumen-book iframe').getByRole('slider', { name: 'Place in the book' })).toHaveAttribute('aria-valuetext', /^Page \d+/, { timeout: 30000 });
  await shelf.getByRole('button', { name: '← All books' }).click();
  await expect(shelf.getByRole('button', { name: /Meditations/ })).toBeVisible();
});

test('a shelf reads an EPUB\'s cover by ranges, not the whole book, where the host allows', async ({ page: p }) => {
  const whole: string[] = [];
  await p.route('**/books/meditations.epub', async r => {
    const res = await r.fetch({ headers: {} });
    const body = await res.body();
    const range = /bytes=(\d+)-(\d+)/.exec(r.request().headers()['range'] ?? '');
    if (r.request().method() === 'HEAD') return r.fulfill({ status: 200, headers: { 'content-length': String(body.length), 'accept-ranges': 'bytes' }, body: '' });
    if (!range) { whole.push(r.request().url()); return r.fulfill({ status: 200, body }); }
    const [a, z] = [+range[1], Math.min(+range[2], body.length - 1)];
    return r.fulfill({ status: 206, headers: { 'content-range': `bytes ${a}-${z}/${body.length}` }, body: body.subarray(a, z + 1) });
  });
  await p.goto('/library/');
  const shelf = p.locator('volumen-library');
  await expect(shelf.locator('.c.own')).toHaveCount(1);
  expect(whole).toEqual([]);
});

/** A page of this site (or of another, at `origin`, with the kit from KIT) with `body` on
 *  it and the kit's element script; what its book says is collected in `heard`. */
// (the pages as they come: an embed's storage is what the test of it checks; base.ts)
test.use({ motion: null });

// a phone, as Playwright has one (its own engine aside)
const { defaultBrowserType: _, ...phone } = devices['iPhone 13'];

async function hostPage(p: Page, body: string, origin = '') {
  const kit = origin ? `${KIT}/volumen/volumen.js` : '/volumen/volumen.js';
  const url = origin ? `${origin}/` : '/t/page.html';
  // (a page as authors make them: sized for the device it is read on)
  await p.route(origin ? url : '**' + url, r => r.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <script type="module" src="${kit}"></script>${body}
    <script>window.heard = []; for (const t of ['ready', 'progress', 'end', 'error', 'back', 'full']) addEventListener('volumen-' + t, e => heard.push([t, e.detail]));</script>` }));
  await p.goto(url);
}
/** The kit's site as two sites on the web see it: a public address (a page on one may not
 *  frame a local address), its files from this test's server. */
const KIT = 'http://kit.test';
async function kitSite(p: Page) {
  await p.context().route(`${KIT}/**`, async r => {
    const res = await r.fetch({ url: r.request().url().replace(KIT, 'http://127.0.0.1:8791') });
    // (the element script crosses sites as a module: only with leave)
    await r.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } });
  });
}
const heardOf = (p: Page, type: string) => p.evaluate(t => (window as any).heard.filter((h: any) => h[0] === t).map((h: any) => h[1]), type);
/** The reader's bar brought up as a reader would: the pointer to its band, or (a finger)
 *  a tap in the middle of the page while it is away (a tap while it shows puts it away). */
async function barUp(p: Page, touch = false) {
  const f = p.frameLocator('volumen-book iframe'), bar = f.locator('.bar');
  const box = (await p.locator('volumen-book').boundingBox())!;
  if (!touch) { await p.mouse.move(box.x + box.width / 2, box.y + 10); await expect(bar).not.toHaveClass(/away/); return; }
  await expect(async () => {
    if (/away/.test((await bar.getAttribute('class')) ?? '')) await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(bar).not.toHaveClass(/away/, { timeout: 1000 });
  }).toPass();
}
/** An item of the reader's menu (⋯ at the end of its foot), the controls brought up first.
 *  (A finger taps where a thing is drawn: Playwright's own tap scrolls the page first, by
 *  its own reckoning, which no finger does.) */
async function fromMenu(p: Page, name: string, touch = false) {
  const f = p.frameLocator('volumen-book iframe');
  await barUp(p, touch);
  const more = f.getByRole('button', { name: 'More' }), it = f.getByRole('menuitem', { name });
  const tap = async (l: typeof more) => { await expect(l).toBeVisible(); const b = (await l.boundingBox())!; await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
  if (touch) { await tap(more); await tap(it); } else { await more.click(); await it.click(); }
}
/** The full-screen button at the foot (as a finger taps it, where it is drawn). */
async function fullButton(p: Page, name: string, touch = false) {
  const f = p.frameLocator('volumen-book iframe');
  await barUp(p, touch);
  const b = f.getByRole('button', { name });
  await expect(b).toBeVisible();
  if (!touch) { await b.click(); return; }
  const r = (await b.boundingBox())!;
  await p.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
}
const ready = (p: Page) => expect.poll(() => heardOf(p, 'ready'), { timeout: 30000 }).toHaveLength(1);

test('the page hears the reader open and moves it: to a chapter, to a place, into a theme of its own', async ({ page: p }) => {
  await hostPage(p, '<volumen-book id="b" src="/books/meditations.epub" style="height: 600px"></volumen-book>');
  await ready(p);
  expect((await heardOf(p, 'ready'))[0].chapters).toBeGreaterThan(3);
  const f = p.frameLocator('volumen-book iframe');
  await p.evaluate(() => (document.getElementById('b') as any).goTo({ chapter: 3 }));
  await expect(f.getByRole('slider', { name: 'Place in the book' })).toHaveAttribute('aria-valuetext', /Book III/, { timeout: 10000 });
  await p.evaluate(() => (document.getElementById('b') as any).goTo({ at: 1 }));
  await expect.poll(() => heardOf(p, 'progress').then(a => a.at(-1)?.at), { timeout: 10000 }).toBe(1);
  // a theme the page made, as Volumen exports one: checked as any theme file is
  await p.evaluate(() => (document.getElementById('b') as any).setTheme({ format: 'volumen-theme/1', name: 'Shop', light: { paper: '#f4ecd8', ink: '#2b2118' }, dark: { paper: '#1d1a16', ink: '#e8dcc4' } }));
  await expect.poll(() => f.locator('.reader').evaluate(el => getComputedStyle(el).getPropertyValue('--paper').trim())).toMatch(/^#f4ecd8|#1d1a16$/);
});

test('a page shows as much of the reader as it wants, and turns off what it does not offer', async ({ page: p }) => {
  await hostPage(p, '<volumen-book src="/books/meditations.epub" ui="none" style="height: 600px"></volumen-book>');
  await ready(p);
  const f = p.frameLocator('volumen-book iframe');
  await expect(f.locator('.col .ln').first()).toBeVisible();
  await expect(f.locator('.bar')).toHaveCount(0);

  await hostPage(p, '<volumen-book src="/books/meditations.epub" ui="minimal" style="height: 600px"></volumen-book>');
  await ready(p);
  await expect(f.getByRole('slider', { name: 'Place in the book' })).toHaveAttribute('aria-valuetext', /^Page \d+/);
  await expect(f.locator('.bar button')).toHaveCount(0);

  await hostPage(p, '<volumen-book src="/books/meditations.epub" off="contents settings find" style="height: 600px"></volumen-book>');
  await ready(p);
  await expect(f.getByRole('button', { name: /^Contents$|Type and appearance|Find in the book/ })).toHaveCount(0);
  await p.locator('volumen-book').click({ position: { x: 300, y: 300 } });
  for (const k of ['m', 's', '/']) await p.keyboard.press(k);
  // (what they would open would show within two frames)
  await f.locator('body').evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(f.locator('.contents')).toHaveCount(0);
  await expect(f.locator('[role=dialog], [role=search]')).toHaveCount(0);
});

/** A colour as its three channels, from a hex or what a page computes (rgb()). */
const channels = (c: string) => (c.startsWith('#') ? c.slice(1).match(/../g)!.map(h => parseInt(h, 16)) : c.match(/\d+/g)!.slice(0, 3).map(Number));
const near = (a: string, b: string) => channels(a).every((v, i) => Math.abs(v - channels(b)[i]) <= 3);

test('on an author\'s page: the page\'s own paper, Back only when asked for, full screen; nothing of Volumen\'s own', async ({ page: p }) => {
  // inline, as most pages have it: the page is the way back, and the reader carries no brand
  await hostPage(p, '<div style="background: #f3ece0; padding: 20px"><volumen-book src="/books/meditations.epub" paper="page" style="height: 600px"></volumen-book></div>');
  await ready(p);
  const f = p.frameLocator('volumen-book iframe');
  await expect(f.locator('.col .ln').first()).toBeVisible();
  await expect(f.locator('a[href*="volumen.page"]')).toHaveCount(0);
  await expect(f.getByRole('link', { name: 'Back' })).toHaveCount(0);
  await expect(f.getByRole('button', { name: 'Back' })).toHaveCount(0);
  // nor the app's sharing: a highlight's exports, but no "Send my notes" (it would open nothing)
  await p.locator('volumen-book').click({ position: { x: 300, y: 300 } });
  for (const k of ['ArrowRight', 'ArrowRight', 'v', 'h', 'Escape']) await p.keyboard.press(k);
  await p.keyboard.press('m');
  await f.getByRole('tab', { name: 'Highlights' }).click();
  await expect(f.getByRole('button', { name: 'Copy as Markdown' })).toBeVisible();
  await expect(f.getByRole('button', { name: /Send my notes/ })).toHaveCount(0);
  await p.keyboard.press('Escape');
  // the paper the book sits on is the page's own, behind the element (read light on it)
  const paper = () => f.locator('.reader').evaluate(el => getComputedStyle(el).getPropertyValue('--paper').trim());
  await expect.poll(async () => near(await paper(), '#f3ece0')).toBe(true);
  expect(await f.locator('.reader').evaluate(el => el.classList.contains('dark-paper'))).toBe(false);
  // a dark page's: the book reads dark on it, its ink light enough to read
  await hostPage(p, '<volumen-book src="/books/meditations.epub" paper="#1e1c19" style="height: 600px"></volumen-book>');
  await ready(p);
  await expect.poll(async () => near(await paper(), '#1e1c19')).toBe(true);
  expect(await f.locator('.reader').evaluate(el => el.classList.contains('dark-paper'))).toBe(true);
  // full screen, the browser's own (in its menu)
  await fullButton(p, 'Read full screen');
  await expect.poll(() => f.locator('html').evaluate(() => !!document.fullscreenElement)).toBe(true);
  await fullButton(p, 'Leave full screen');
  await expect.poll(() => f.locator('html').evaluate(() => !!document.fullscreenElement)).toBe(false);
  // Back to an address the page names: a link out of the frame, in the page's own window
  await hostPage(p, '<volumen-book src="/books/meditations.epub" back="/shelf" style="height: 600px"></volumen-book>');
  await ready(p);
  await expect(f.getByRole('link', { name: 'Back' })).toHaveAttribute('href', /\/shelf$/);
  await expect(f.getByRole('link', { name: 'Back' })).toHaveAttribute('target', '_top');
  // Back where the reader came from: the page is told, and may go its own way ...
  await hostPage(p, '<volumen-book src="/books/meditations.epub" back style="height: 600px"></volumen-book><script>addEventListener("volumen-back", e => e.preventDefault())</script>');
  await ready(p);
  await f.getByRole('button', { name: 'Back' }).click();
  await expect.poll(() => heardOf(p, 'back')).toHaveLength(1);
  expect(p.url()).toMatch(/\/t\/page\.html$/);
  // ... or, left to the kit, it goes back in the page's history
  await p.goto('/');
  await hostPage(p, '<volumen-book src="/books/meditations.epub" back style="height: 600px"></volumen-book>');
  await ready(p);
  await f.getByRole('button', { name: 'Back' }).click();
  await expect(p).toHaveURL(/:8791\/$/);
});

test('on an author\'s page, quiet arrows at its sides turn it for a mouse; not in full screen, nor with less of the reader', async ({ page: p }) => {
  await hostPage(p, '<volumen-book src="/books/meditations.epub" style="height: 560px; width: 640px"></volumen-book>');
  await ready(p);
  const f = p.frameLocator('volumen-book iframe');
  const prev = f.getByRole('button', { name: 'Previous page' }), next = f.getByRole('button', { name: 'Next page' });
  const at = () => f.getByRole('slider', { name: 'Place in the book' }).getAttribute('aria-valuetext');
  await expect(next).toBeVisible();
  await expect(prev).toBeDisabled();
  // in the margins, clear of the text however narrow the box (the margins make room)
  const sides = await f.locator('.reader').evaluate(el => { const s = getComputedStyle(el); return [parseFloat(s.getPropertyValue('--fl')), parseFloat(s.getPropertyValue('--fr'))]; });
  const [pb, nb] = await Promise.all([prev, next].map(b => b.evaluate(el => el.getBoundingClientRect().toJSON())));
  expect(pb.right).toBeLessThanOrEqual(sides[0]);
  expect(nb.left).toBeGreaterThanOrEqual(sides[1]);
  // a page at a time, either way, as an arrow key turns it
  const first = await at();
  await next.click();
  await expect.poll(at).toMatch(/^Page 2 of/);
  await expect(prev).toBeEnabled();
  await prev.click();
  await expect.poll(at).toBe(first);
  // at the end, the way on is dim
  await p.evaluate(() => (document.querySelector('volumen-book') as any).goTo({ at: 1 }));
  await expect(next).toBeDisabled();
  await expect(prev).toBeEnabled();
  // full screen is the reader as it is meant to be: none
  if (await f.locator('html').evaluate(() => document.fullscreenEnabled)) {
    await fullButton(p, 'Read full screen');
    await expect(next).toHaveCount(0);
    await fullButton(p, 'Leave full screen');
    await expect(next).toBeVisible();
  }
  // a box narrower than a desktop's spread has them too, while the text keeps a measure the
  // layout would take; one narrower still keeps its measure instead
  for (const [w, shown] of [[560, 1], [440, 0]] as const) {
    await hostPage(p, `<volumen-book src="/books/meditations.epub" style="height: 560px; width: ${w}px"></volumen-book>`);
    await ready(p);
    await expect(f.locator('.col .ln').first()).toBeVisible();
    await expect(f.getByRole('button', { name: 'Next page' })).toHaveCount(shown);
  }
  // nor where the page asked for less of the reader
  for (const ui of ['minimal', 'none']) {
    await hostPage(p, `<volumen-book src="/books/meditations.epub" ui="${ui}" style="height: 560px"></volumen-book>`);
    await ready(p);
    await expect(f.locator('.col .ln').first()).toBeVisible();
    await expect(f.getByRole('button', { name: 'Next page' })).toHaveCount(0);
  }
});

test('the reader opened as a page of its own: Back goes where the reader came from', async ({ page: p }) => {
  await p.goto('/');
  await p.goto('/volumen/embed.html#src=' + encodeURIComponent('http://127.0.0.1:8791/books/meditations.epub'));
  const back = p.getByRole('button', { name: 'Back' });
  await expect(back).toBeVisible({ timeout: 30000 });
  await back.click();
  await expect(p).toHaveURL(/:8791\/$/);
  // the same with `back` asked for and no page around it to ask: its own history
  await p.goto('/volumen/embed.html#back=history&src=' + encodeURIComponent('http://127.0.0.1:8791/books/meditations.epub'));
  await expect(back).toBeVisible({ timeout: 30000 });
  await back.click();
  await expect(p).toHaveURL(/:8791\/$/);
});

test('Help lists the keys of what the page offers, and only those', async ({ page: p }) => {
  await hostPage(p, '<volumen-book src="/books/meditations.epub" off="contents settings find highlights" style="height: 600px"></volumen-book>');
  await ready(p);
  const f = p.frameLocator('volumen-book iframe');
  await p.locator('volumen-book').click({ position: { x: 300, y: 300 } });
  await p.keyboard.press('?');
  const help = f.getByRole('dialog');
  await expect(help).toBeVisible();
  await expect(help).toContainText('Next or previous column');
  for (const gone of ['Contents', 'Find in the book', 'Columns', 'Highlight', 'Select a paragraph', 'Notes beside the text']) await expect(help).not.toContainText(gone);
  // and the keys themselves do nothing (C changes the columns, a setting)
  await p.keyboard.press('Escape');
  const cols = () => f.locator('.col').evaluateAll(c => c.length);
  const before = await cols();
  await p.keyboard.press('c');
  await expect(f.locator('.toast.show')).toHaveCount(0);
  expect(await cols()).toBe(before);
});

test('a book that cannot be read is said so, to the reader and the page', async ({ page: p }) => {
  await hostPage(p, '<volumen-book src="/books/missing.epub" style="height: 400px"></volumen-book>');
  await expect.poll(() => heardOf(p, 'error'), { timeout: 30000 }).toHaveLength(1);
  expect((await heardOf(p, 'error'))[0].message).toMatch(/answered 404/);
  await expect(p.frameLocator('volumen-book iframe').locator('.embed-wait')).toHaveText(/answered 404/);
});

test('across sites: the page hears its reader, and a reader obeys only the page it was told of', async ({ page: p }) => {
  await kitSite(p);
  await hostPage(p, `<volumen-book id="b" src="${KIT}/books/meditations.epub" style="height: 600px"></volumen-book>`, 'http://host.test');
  await ready(p);
  await p.evaluate(() => (document.getElementById('b') as any).goTo({ chapter: 3 }));
  await expect(p.frameLocator('volumen-book iframe').getByRole('slider', { name: 'Place in the book' })).toHaveAttribute('aria-valuetext', /Book III/, { timeout: 10000 });
  // a frame that names another page: it says nothing to this one, and takes no orders from it
  const said = await p.evaluate(kit => new Promise<number>(res => {
    let n = 0;
    const f = document.createElement('iframe');
    addEventListener('message', e => { if (e.source === f.contentWindow) n++; });
    f.id = 'other';
    f.style.cssText = 'width: 900px; height: 600px';
    f.src = `${kit}/volumen/embed.html#` + new URLSearchParams({ src: `${kit}/books/meditations.epub`, host: 'https://elsewhere.example' });
    document.body.append(f);
    setTimeout(() => res(n), 8000);
  }), KIT);
  expect(said).toBe(0);
  const other = p.frameLocator('#other');
  await expect(other.getByRole('slider', { name: 'Place in the book' })).toHaveAttribute('aria-valuetext', /^Page \d+/, { timeout: 30000 });
  const before = await other.getByRole('slider', { name: 'Place in the book' }).getAttribute('aria-valuetext');
  await p.evaluate(() => (document.getElementById('other') as HTMLIFrameElement).contentWindow!.postMessage({ volumen: 1, type: 'goto', chapter: 3 }, '*'));
  // (an ignored command leaves nothing to wait for: the time one heard takes to move it)
  await p.waitForTimeout(1500);
  await expect(other.getByRole('slider', { name: 'Place in the book' })).toHaveAttribute('aria-valuetext', before!);
});

test('in a box narrower than its menu (a sidebar), the selection\'s menu stays inside it', async ({ page: p }) => {
  await hostPage(p, '<volumen-book src="/books/meditations.epub" style="width: 170px; height: 520px"></volumen-book>');
  await ready(p);
  const fr = p.frames().find(f => f.url().includes('embed.html'))!;
  const f = p.frameLocator('volumen-book iframe');
  await expect(f.locator('.col .ln').first()).toBeVisible();
  // a few words selected, as the system would
  await fr.evaluate(() => {
    const ln = [...document.querySelectorAll<HTMLElement>('.col .ln[data-b]')].find(l => (l.textContent ?? '').split(/\s+/).length > 3)!;
    const t = [...ln.childNodes].find(n => n.nodeType === 3 && /\S+\s+\S+/.test(n.textContent!)) as Text;
    const w = [...t.data.matchAll(/\S+/g)];
    getSelection()!.setBaseAndExtent(t, w[0].index!, t, w[1].index! + w[1][0].length);
  });
  await expect(f.locator('.chip-pop')).toBeVisible();
  await still(fr);
  expect(await layout(fr, ['.chip-pop'], false)).toEqual([]);
});

test.describe('a phone, whose frames have no full screen', () => {
  test.use(phone);
  test('Read full screen fills the page\'s window with the book, and Leave gives the page back as it was', async ({ page: p }) => {
    // (as an iPhone: no full screen for a frame)
    await p.addInitScript(() => Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false }));
    await hostPage(p, '<p style="height: 300px; margin: 0">Before.</p><volumen-book src="/books/meditations.epub" style="height: 460px"></volumen-book><p style="height: 1400px">After.</p>');
    await ready(p);
    const f = p.frameLocator('volumen-book iframe'), book = p.locator('volumen-book'), frame = p.locator('volumen-book iframe');
    await p.evaluate(() => scrollTo(0, 120));
    const was = (await book.boundingBox())!;
    const vp = p.viewportSize()!;
    await fullButton(p, 'Read full screen', true);
    await expect.poll(async () => { const b = (await frame.boundingBox())!; return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }).toEqual([0, 0, vp.width, vp.height]);
    // the page behind as it was (nothing reflowed, nothing scrolled)
    expect(await p.evaluate(() => scrollY)).toBe(120);
    expect(Math.round((await book.boundingBox())!.y)).toBe(Math.round(was.y));
    await expect.poll(() => heardOf(p, 'full')).toEqual([{ on: true }]);
    // the page behind stays put
    expect(await p.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
    // the reader laid out for the whole window, as the app is
    await expect.poll(() => f.locator('html').evaluate(() => innerHeight)).toBe(vp.height);
    await fullButton(p, 'Leave full screen', true);
    await expect.poll(async () => Math.round((await frame.boundingBox())!.y)).toBe(Math.round(was.y));
    expect(await p.evaluate(() => [getComputedStyle(document.documentElement).overflow, scrollY])).toEqual(['visible', 120]);
    await expect.poll(() => heardOf(p, 'full')).toEqual([{ on: true }, { on: false }]);
  });
});

test('a book opened from the page\'s own button: the reader over the whole window, Back (or the browser\'s) gives the page back as it was', async ({ page: p }) => {
  await hostPage(p, '<p style="height: 300px; margin: 0">Before.</p><volumen-open src="/books/meditations.epub" chapters="3"><button id="go">Read chapter three</button></volumen-open><p style="height: 1400px">After.</p>');
  await p.evaluate(() => scrollTo(0, 120));
  const vp = p.viewportSize()!, book = p.locator('volumen-book'), f = p.frameLocator('volumen-book iframe');
  await expect(book).toHaveCount(0);
  await p.locator('#go').click();
  // over the whole window, the page held still behind it
  await ready(p);
  await expect.poll(async () => { const b = (await book.boundingBox())!; return [b.x, b.y, b.width, b.height].map(Math.round); }).toEqual([0, 0, vp.width, vp.height]);
  expect(await p.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
  // the reader's Back: the page as it was, the button that opened the book focused
  await f.getByRole('button', { name: 'Back' }).click();
  await expect(book).toHaveCount(0);
  expect(await p.evaluate(() => [scrollY, getComputedStyle(document.documentElement).overflow, document.activeElement?.id])).toEqual([120, 'visible', 'go']);
  expect(p.url()).toMatch(/\/t\/page\.html$/);
  // the browser's back (a phone's back gesture) closes it too, and goes no further
  await p.locator('#go').click();
  await expect.poll(() => heardOf(p, 'ready')).toHaveLength(2);
  await expect(book).toHaveCount(1);
  await p.goBack();
  await expect(book).toHaveCount(0);
  expect(p.url()).toMatch(/\/t\/page\.html$/);
});

test('a book\'s cover that opens it (the element with nothing in it), and open() for a page\'s own code', async ({ page: p }) => {
  await hostPage(p, '<volumen-open src="/books/meditations.epub" title="Meditations"></volumen-open>');
  const cover = p.getByRole('button', { name: 'Read Meditations' });
  await expect(cover).toBeVisible();
  // the EPUB's own cover, read from the file
  await expect.poll(() => cover.evaluate(b => getComputedStyle(b.querySelector('.c')!).backgroundImage)).toMatch(/^url\(/);
  await cover.click();
  await ready(p);
  await expect(p.locator('volumen-book')).toHaveCount(1);
  await p.goBack();
  await expect(p.locator('volumen-book')).toHaveCount(0);
  // the same from a page's script: a handle to close it by
  await p.evaluate(async () => { const { open } = await import('/volumen/volumen.js' as string); (window as any).h = open({ src: '/books/meditations.epub', chapters: '3' }); });
  await expect(p.locator('volumen-book')).toHaveCount(1);
  await expect.poll(() => heardOf(p, 'ready')).toHaveLength(2);
  await p.evaluate(() => (window as any).h.close());
  await expect(p.locator('volumen-book')).toHaveCount(0);
});

// The embed's own views, held to the layout's rules (tests/audit.ts) as the app's are
// (tests/views.spec.ts): on a desktop and a phone, on a page that asks for a way back.
for (const [size, use] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', phone]] as const) test.describe(`an embed (${size})`, () => {
  test.use(use);
  test(`holds its shape: reading, its bar, Aa, Help (${size})`, async ({ page: p }) => {
    const touch = size === 'phone';
    await hostPage(p, '<volumen-book src="/books/meditations.epub" back="/shelf" paper="page" style="height: 100vh"></volumen-book>');
    await ready(p);
    const fr = p.frames().find(f => f.url().includes('embed.html'))!;
    const f = p.frameLocator('volumen-book iframe');
    const found: string[] = [];
    const check = async (where: string, roots: string[]) => { await still(fr); for (const x of await layout(fr, roots, touch)) found.push(`${where}: ${x}`); };
    await expect(f.locator('.bar')).toHaveClass(/away/, { timeout: 10_000 });
    // (a finger taps the page's outer fifth to turn it: no arrows on a phone)
    await expect(f.getByRole('button', { name: 'Next page' })).toHaveCount(touch ? 0 : 1);
    await check('reading', ['.bar', '.progress', '.arrow']);
    const box = (await p.locator('volumen-book').boundingBox())!;
    if (touch) await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    else await p.mouse.move(box.x + box.width / 2, box.y + 10);
    await expect(f.locator('.bar')).not.toHaveClass(/away/);
    await check('bar', ['.bar', '.progress', '.more', '.full']);
    // in a box with an edge of its own, each control in a corner as far from both of its
    // edges (within 2 px), and full screen at the foot's start, mirroring the menu
    const corners = await fr.evaluate(() => {
      const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const bm = r('.bar .side.right .ibtn'), more = r('.more .ibtn'), full = r('.full .ibtn');
      return { bm: [innerWidth - bm.right, bm.top], more: [innerWidth - more.right, innerHeight - more.bottom], full: [full.left, innerHeight - full.bottom] };
    });
    for (const [side, end] of Object.values(corners)) expect(Math.abs(side - end), JSON.stringify(corners)).toBeLessThanOrEqual(2);
    expect(Math.abs(corners.full[0] - corners.more[0]), JSON.stringify(corners)).toBeLessThanOrEqual(1);
    expect(Math.abs(corners.full[1] - corners.more[1]), JSON.stringify(corners)).toBeLessThanOrEqual(1);
    expect(corners.bm[0]).toBeGreaterThanOrEqual(12);
    // (not in the menu as well)
    const more = f.getByRole('button', { name: 'More' });
    if (touch) await more.tap(); else await more.click();
    await expect(f.getByRole('menu')).toBeVisible();
    await expect(f.getByRole('menuitem', { name: /full screen/ })).toHaveCount(0);
    await p.keyboard.press('Escape');
    await expect(f.getByRole('menu')).toHaveCount(0);
    // the menu at the foot, then what it opens
    if (touch) await more.tap(); else await more.click();
    await expect(f.getByRole('menu')).toBeVisible();
    await check('menu', ['.menu']);
    await p.keyboard.press('Escape');
    await fromMenu(p, 'Type and appearance', touch);
    await expect(f.locator('.panel')).toBeVisible();
    await check('aa', ['.panel']);
    await p.keyboard.press('Escape');
    await p.keyboard.press('?');
    await expect(f.getByRole('dialog')).toBeVisible();
    await check('help', ['.sheet']);
    expect(found).toEqual([]);
  });
});

