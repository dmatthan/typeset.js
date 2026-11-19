import { type Page } from '@playwright/test';
import { test, expect } from './base';

/* The kit: the reader alone, put in a folder of an ordinary site
 * (served here by Python's http.server, nothing of ours), placed on its pages by
 * kit/volumen.js. The pages are the repository's examples/. */

test('a chapter on a blog: only that chapter, the page told where the reader is, a way on at the end', async ({ page: p }) => {
  await p.goto('/');
  const f = p.frameLocator('volumen-book iframe');
  await expect(f.locator('.where')).toBeVisible({ timeout: 30000 });
  // only Book III: its own title page, then its text
  await p.locator('volumen-book').click({ position: { x: 300, y: 300 } });
  await p.keyboard.press('Space');
  await expect(f.locator('.where')).toHaveText(/Book III/, { timeout: 10000 });
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
  await expect(f.locator('.where')).toBeVisible({ timeout: 30000 });
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
  await expect(p.frameLocator('volumen-library volumen-book iframe').locator('.where')).toBeVisible({ timeout: 30000 });
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
async function hostPage(p: Page, body: string, origin = '') {
  const kit = origin ? `${KIT}/volumen/volumen.js` : '/volumen/volumen.js';
  const url = origin ? `${origin}/` : '/t/page.html';
  await p.route(origin ? url : '**' + url, r => r.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8">
    <script type="module" src="${kit}"></script>${body}
    <script>window.heard = []; for (const t of ['ready', 'progress', 'end', 'error']) addEventListener('volumen-' + t, e => heard.push([t, e.detail]));</script>` }));
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
const ready = (p: Page) => expect.poll(() => heardOf(p, 'ready'), { timeout: 30000 }).toHaveLength(1);

test('the page hears the reader open and moves it: to a chapter, to a place, into a theme of its own', async ({ page: p }) => {
  await hostPage(p, '<volumen-book id="b" src="/books/meditations.epub" style="height: 600px"></volumen-book>');
  await ready(p);
  expect((await heardOf(p, 'ready'))[0].chapters).toBeGreaterThan(3);
  const f = p.frameLocator('volumen-book iframe');
  await p.evaluate(() => (document.getElementById('b') as any).goTo({ chapter: 3 }));
  await expect(f.locator('.where')).toHaveText(/Book III/, { timeout: 10000 });
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
  await expect(f.locator('.where')).toBeVisible();
  await expect(f.locator('.bar button')).toHaveCount(0);

  await hostPage(p, '<volumen-book src="/books/meditations.epub" off="contents settings find" style="height: 600px"></volumen-book>');
  await ready(p);
  await expect(f.getByRole('button', { name: /^Contents$|Type and appearance/ })).toHaveCount(0);
  await p.locator('volumen-book').click({ position: { x: 300, y: 300 } });
  for (const k of ['m', 's', '/']) await p.keyboard.press(k);
  await p.waitForTimeout(400);
  await expect(f.locator('.contents')).toHaveCount(0);
  await expect(f.locator('[role=dialog], [role=search]')).toHaveCount(0);
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
  await expect(p.frameLocator('volumen-book iframe').locator('.where')).toHaveText(/Book III/, { timeout: 10000 });
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
  await expect(other.locator('.where')).toBeVisible({ timeout: 30000 });
  const before = await other.locator('.where').textContent();
  await p.evaluate(() => (document.getElementById('other') as HTMLIFrameElement).contentWindow!.postMessage({ volumen: 1, type: 'goto', chapter: 3 }, '*'));
  await p.waitForTimeout(1500);
  await expect(other.locator('.where')).toHaveText(before!);
});
