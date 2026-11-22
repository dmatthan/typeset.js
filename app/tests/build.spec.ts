import { test, expect } from './base';

// The production build, as volumen.page serves it: the app at /read, the site's page at /.

test('the page at / is plain, shows the reader embedded, sends links meant for the app on to it, and installs the app', async ({ page: p }) => {
  const errors: string[] = [];
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto('/');
  await expect(p.getByRole('heading', { level: 1 })).toHaveText('Web e-reader that you can deploy anywhere');
  await expect(p.locator('.mark i')).toHaveText('[voˈlu.men]');
  // the page's own script and the elements; the app itself runs only in the book's frame
  expect(await p.evaluate(() => [...document.scripts].map(s => new URL(s.src, location.href).pathname))).toEqual(['/site.js', '/typeset.js']);
  // the book on the page is the reader itself, from this site, opened on a page that
  // begins with a paragraph at its top (a change to the engine that moves it fails here)
  const book = p.frameLocator('.demo typeset-book iframe');
  await expect(book.getByRole('slider', { name: 'Place in the book' })).toHaveAttribute('aria-valuetext', /Book IV\b/, { timeout: 30000 });
  await expect.poll(() => book.locator('body').evaluate(() => {
    const W = innerWidth, col = [...document.querySelectorAll('.col')].find(c => { const b = c.getBoundingClientRect(); return b.left >= 0 && b.right <= W + 1; });
    const first = col && [...col.querySelectorAll<HTMLElement>('.ln')].find(l => l.textContent!.trim());
    return first ? [first.textContent!.trim().slice(0, 13), first.dataset.s, Math.round(first.getBoundingClientRect().top - col!.getBoundingClientRect().top)] : null;
  })).toEqual(['Love the art,', '0', 0]);
  // installing names this device, with its mark, and its desktop app first
  await expect(p.locator('#here-h')).toHaveText('On this Linux computer');
  await expect(p.locator('#downloads .btn').first()).toHaveText('Linux');
  await p.getByRole('link', { name: 'Privacy' }).first().click();
  await expect(p.getByRole('heading', { level: 1 })).toHaveText('Privacy');
  await p.getByRole('link', { name: 'The library' }).click();
  await expect(p).toHaveURL(/\/read$/);
  await p.locator('.book[data-id]').first().waitFor();
  // a link meant for the app, arriving at /: on to /read, the fragment kept
  await p.goto('/#invite=abcdefghijklmnopqrstuvwx');
  await expect(p).toHaveURL(/\/read$/);
  await expect(p.getByRole('dialog', { name: 'Accept the invitation to share books' })).toBeVisible();
  // and one arriving while the page is open (only the fragment changes)
  await p.goto('/');
  await p.evaluate(() => { location.hash = '#invite=abcdefghijklmnopqrstuvwx'; });
  await expect(p).toHaveURL(/\/read$/);
  expect(errors).toEqual([]);
});

test('after one visit the app opens and a book reads with no network', async ({ page: p, context }) => {
  await p.goto('/read');
  await p.waitForSelector('.book[data-id]');
  // open the sample once, so its faces and patterns are fetched (and kept)
  await p.locator('.book[data-id]').first().click();
  // (a production build has no test hooks: the page itself says when it is ready)
  await expect(p.locator('.col .ln').first()).toBeVisible({ timeout: 15000 });
  await p.keyboard.press('ArrowRight');
  // (all it fetches as it reads, fetched: the worker keeps what passes through it)
  await p.waitForLoadState('networkidle');
  await p.evaluate(() => navigator.serviceWorker.ready);
  // a reload lets the worker take over, then the network goes away
  await p.reload();
  await p.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await p.reload();
  await p.waitForSelector('.book[data-id]', { timeout: 15000 });
  await p.locator('.book[data-id]').first().click();
  await expect(p.locator('.col .ln').first()).toBeVisible({ timeout: 15000 });
  await p.keyboard.press('ArrowRight');
  await expect(p.locator('.col .ln').first()).toBeVisible();
  await context.setOffline(false);
});
