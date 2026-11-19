import { test, expect } from '@playwright/test';

// The production build, as volumen.page serves it: the app at /read, the site's page at /.

test('the page at / is plain, sends links meant for the app on to it, and installs the app', async ({ page: p }) => {
  const errors: string[] = [];
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto('/');
  await expect(p.getByRole('heading', { level: 1 })).toContainText('book reader with shareable comments');
  await expect(p.locator('.mark i')).toHaveText('[voˈlu.men]');
  // no app on the page: its code is not loaded
  expect(await p.evaluate(() => [...document.scripts].map(s => new URL(s.src, location.href).pathname))).toEqual(['/site.js']);
  // installing names this device, on the button above too, with its mark
  await expect(p.locator('#here-h')).toHaveText('On this Linux computer');
  await expect(p.locator('#install-btn')).toHaveText('Install on Linux');
  await expect(p.locator('#install-btn svg use')).toHaveAttribute('href', '#os-linux');
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
  await p.waitForTimeout(1500);
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
