import { type BrowserContext, type Page } from '@playwright/test';
import { test, expect } from './base';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/* The sharing service (service/), run locally by wrangler dev on the production build:
 * a writer invited, signed in with a passkey (Chromium's virtual authenticator), a book
 * shared through it, read by a reader with nothing, whose notes come back to the writer.
 * Turnstile runs with its test keys (they pass; the service takes them only here). */

const persist = new URL('../../service/.wrangler/test', import.meta.url).pathname;
const invite = (name: string) => execFileSync('../scripts/service.sh', ['--local', 'invite', name], { env: { ...process.env, SERVICE_PERSIST: persist } }).toString().trim();

/** Escape leaves a text field first, then closes the sheet. */
async function closeSheet(p: Page) {
  await expect(async () => {
    if (await p.locator('[role=dialog]').count()) await p.keyboard.press('Escape');
    await expect(p.locator('[role=dialog]')).toHaveCount(0, { timeout: 400 });
  }).toPass({ timeout: 5000 });
}

/** Holds on the n-th line of prose in the first column in view, drags over a few words,
 *  and highlights them (2). */
async function highlight(r: Page, n: number) {
  const handle = await r.waitForFunction(n => {
    const found = [];
    for (const l of document.querySelectorAll('.ln[data-b]')) {
      const b = l.getBoundingClientRect(), mid = b.left + b.width / 2;
      // (above the toasts)
      if (mid > 60 && mid < innerWidth / 2 && b.top > 100 && b.bottom < 620 && (l.textContent ?? '').length > 40 && !l.querySelector('mark')) found.push({ x: b.left, y: b.top, height: b.height });
    }
    return found[n * 3] ?? null;
  }, n, { timeout: 15000 });
  const box = await handle.jsonValue() as { x: number; y: number; height: number };
  const y = box.y + box.height / 2;
  await r.mouse.move(box.x + 20, y); await r.mouse.down();
  await r.waitForTimeout(380);
  for (let i = 1; i <= 6; i++) { await r.mouse.move(box.x + 20 + i * 30, y); await r.waitForTimeout(16); }
  await r.mouse.up();
  await expect(r.locator('.chip-pop')).toBeVisible();
  await r.keyboard.press('2');
}

/** Each test browser its own address, so their per-minute limits are their own (locally
 *  the service reads the header; on Cloudflare, Cloudflare sets it). */
async function ownAddress(ctx: BrowserContext) {
  const ip = `10.${Math.random() * 250 | 0}.${Math.random() * 250 | 0}.${Math.random() * 250 | 0}`;
  await ctx.route('http://localhost:8788/api/**', r => r.continue({ headers: { ...r.request().headers(), 'cf-connecting-ip': ip } }));
}

async function passkeys(ctx: BrowserContext, p: Page, prf = false) {
  await ownAddress(ctx);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: prf } });
  return cdp;
}

test('a writer invited shares a book through the service; a reader reads it and sends notes; they reach the writer', async ({ browser }) => {
  test.setTimeout(150_000);
  const wctx = await browser.newContext();
  const w = await wctx.newPage();
  // the app's Content Security Policy (assets/_headers) stops nothing the app does
  const blocked: string[] = [];
  const watch = (p: Page) => p.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) blocked.push(m.text()); });
  watch(w);
  await passkeys(wctx, w);
  // the invitation: its link, a name, a passkey; the code gone from the address
  const inviteLink = invite('Dana');
  await w.goto(inviteLink.replace(/^https?:\/\/[^/]+/, ''));
  await expect(w.getByRole('dialog', { name: 'Accept the invitation to share books' })).toBeVisible();
  expect(await w.evaluate(() => location.hash)).toBe('');
  await w.getByLabel('Your name, as your readers will know you').fill('Dana Writer');
  await w.getByRole('button', { name: /Make my passkey/ }).click();
  await expect(w.locator('.toast')).toContainText('Welcome, Dana Writer', { timeout: 30000 });
  // the same invitation, again: used
  const used = await w.request.post('/api/auth/register/begin', { headers: { 'x-volumen': '1' }, data: { invite: inviteLink.split('#invite=')[1], turnstile: 'XXXX.DUMMY.TOKEN.XXXX' } });
  expect(used.status()).toBe(403);

  // a book of theirs, shared
  await w.locator('.book[data-id]').first().waitFor();
  await w.setInputFiles('input[type=file]', '../bench/fixtures/tables.epub');
  const book = w.locator('.book[data-id]', { hasText: 'Tables and Figures' });
  await book.click({ button: 'right' });
  await w.getByRole('button', { name: 'Share as a link…' }).click();
  await expect(w.getByText('Signed in as Dana Writer')).toBeVisible();
  await w.getByRole('button', { name: 'Make the link' }).click();
  const link = await w.getByLabel('The link').inputValue();
  expect(link).toMatch(/^http:\/\/localhost:8788\/read#b=[\w-]{22}&k=[\w-]{43}$/);
  const id = /#b=([\w-]+)/.exec(link)![1];
  // what the service holds is sealed: none of the book's words
  const held = await w.request.get(`/api/books/${id}`);
  expect(held.ok()).toBe(true);
  const sealed = Buffer.from(await held.body());
  expect(sealed.subarray(0, 5).toString()).toBe('VOLS2');
  expect(sealed.includes(Buffer.from('Wide tables'))).toBe(false);
  await closeSheet(w);

  // the reader: another browser, nothing in it, no account
  const rctx = await browser.newContext();
  await ownAddress(rctx);
  const r = await rctx.newPage();
  watch(r);
  await r.goto(link.replace('http://localhost:8788', ''));
  // the first time: who sent it, and how notes are made and sent; Enter, and reading
  const welcome = r.getByRole('dialog', { name: 'A book sent to you' });
  await expect(welcome).toContainText('Sent to you by Dana Writer', { timeout: 20000 });
  await expect(welcome).toContainText('Send my notes');
  await r.keyboard.press('Enter');
  await expect(welcome).toHaveCount(0);
  await expect(r.getByRole('slider', { name: 'Place in the book' })).toHaveAttribute('aria-valuetext', /^Page \d+/, { timeout: 20000 });
  expect(await r.evaluate(() => location.hash)).toBe('');
  // a few words held and dragged over, highlighted; then sent from the notebook
  await r.keyboard.press('ArrowRight');
  await r.waitForTimeout(900);
  await highlight(r, 0);
  await expect(r.locator('mark.hl').first()).toBeVisible();
  await r.keyboard.press('m');
  await r.getByRole('tab', { name: 'Highlights' }).click();
  await r.getByRole('button', { name: 'Send my notes…' }).click();
  await r.getByPlaceholder('Your name').fill('Ann Reader');
  await r.getByRole('button', { name: /Send to the writer/ }).click();
  await expect(r.locator('.toast')).toContainText('Sent.', { timeout: 30000 });
  // after that, new notes go by themselves as the reader leaves the book (with the
  // service's pass: no check), and unchanged ones are not sent again
  const puts: string[] = [];
  r.on('request', q => { if (q.method() === 'PUT') puts.push(q.url()); });
  await r.keyboard.press('Escape');
  await expect(r.locator('.contents')).toHaveCount(0);
  await r.waitForTimeout(1200);
  await highlight(r, 1);
  await expect(r.locator('mark.hl')).toHaveCount(2);
  await r.keyboard.press('q');
  await expect.poll(() => puts.length, { timeout: 10000 }).toBe(1);
  await r.locator('.book[data-id]', { hasText: 'Tables and Figures' }).click();
  await expect(r.getByRole('slider', { name: 'Place in the book' })).toHaveAttribute('aria-valuetext', /^Page \d+/);
  await r.keyboard.press('q');
  await r.waitForTimeout(1500);
  expect(puts.length).toBe(1);

  // the reader's token is the link's: without it, nothing is taken
  const forged = await r.request.put(`/api/books/${id}/notes/${'0'.repeat(32)}`, { headers: { 'x-volumen': '1', authorization: `Post ${'A'.repeat(43)}`, 'x-turnstile': 'XXXX.DUMMY.TOKEN.XXXX', 'content-type': 'application/octet-stream' }, data: Buffer.from('VOLN1' + 'x'.repeat(64)) });
  expect(forged.status()).toBe(403);
  // the writer's routes are the writer's
  expect((await r.request.get('/api/inbox')).status()).toBe(401);
  expect((await r.request.get(`/api/shares/${id}/notes/${'0'.repeat(32)}`)).status()).toBe(401);

  // back at the writer: the notes, from the book's sheet
  await book.click({ button: 'right' });
  await w.getByRole('button', { name: 'Share as a link…' }).click();
  await expect(w.getByText('Notes from 1 reader.')).toBeVisible();
  await w.getByRole('button', { name: 'Check for notes' }).click();
  await expect(w.locator('.toast')).toContainText('Ann Reader: 2 notes');
  await closeSheet(w);
  await expect(book).toContainText('notes from 1 reader');

  // only sealed books are kept, and not too large ones
  const plain = await w.request.post('/api/shares', { headers: { 'x-volumen': '1', 'x-post': 'a'.repeat(64), 'content-type': 'application/octet-stream' }, data: readFileSync('../bench/fixtures/tables.epub') });
  expect(plain.status()).toBe(400);
  const huge = await w.request.post('/api/shares', { headers: { 'x-volumen': '1', 'x-post': 'a'.repeat(64), 'content-type': 'application/octet-stream' }, data: Buffer.concat([Buffer.from('VOLS2'), Buffer.alloc(17 * 1048576)]) });
  expect(huge.status()).toBe(413);
  // nor from another site
  const csrf = await w.request.post('/api/shares', { headers: { 'x-volumen': '1', origin: 'https://evil.example', 'x-post': 'a'.repeat(64) }, data: Buffer.from('VOLS2xx') });
  expect(csrf.status()).toBe(403);

  // signing out, and in again with the passkey
  await book.click({ button: 'right' });
  await w.getByRole('button', { name: 'Share as a link…' }).click();
  await w.getByRole('button', { name: 'Sign out' }).click();
  await expect(w.getByRole('button', { name: 'Sign in with my passkey' })).toBeVisible();
  expect((await w.request.get('/api/inbox')).status()).toBe(401);
  await w.getByRole('button', { name: 'Sign in with my passkey' }).click();
  await expect(w.getByText('Signed in as Dana Writer')).toBeVisible({ timeout: 20000 });

  // withdrawn: the link no longer opens the book
  await w.getByRole('button', { name: 'Withdraw the link…' }).click();
  await w.getByRole('button', { name: 'Withdraw: press again' }).click();
  await expect(w.locator('.toast')).toContainText('Withdrawn');
  expect((await r.request.get(`/api/books/${id}`)).status()).toBe(404);
  expect(blocked).toEqual([]);
  // the daily sweep runs
  expect((await r.request.get('/cdn-cgi/local/scheduled')).ok()).toBe(true);
  await rctx.close();
  await wctx.close();
});

test('a writer’s shares follow their passkey to another device (its PRF secret seals their vault)', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext();
  const w = await ctx.newPage();
  await passkeys(ctx, w, true);
  const sent: string[] = [];
  w.on('request', q => { sent.push(`${q.method()} ${new URL(q.url()).pathname} ${q.postData() ?? ''}`); });
  await w.goto(invite('Vera').replace(/^https?:\/\/[^/]+/, ''));
  await w.getByLabel('Your name, as your readers will know you').fill('Vera Writer');
  await w.getByRole('button', { name: /Make my passkey/ }).click();
  await expect(w.locator('.toast')).toContainText('Welcome, Vera Writer', { timeout: 30000 });
  // the passkey's secret never goes to the service
  expect(sent.filter(r => /"prf"/.test(r))).toEqual([]);
  await w.locator('.book[data-id]').first().waitFor();
  await w.setInputFiles('input[type=file]', '../bench/fixtures/tables.epub');
  const book = w.locator('.book[data-id]', { hasText: 'Tables and Figures' });
  await book.click({ button: 'right' });
  await w.getByRole('button', { name: 'Share as a link…' }).click();
  await w.getByRole('button', { name: 'Make the link' }).click();
  const link = await w.getByLabel('The link').inputValue();
  await expect.poll(() => sent.filter(r => r.startsWith('PUT /api/vault')).length).toBe(1);
  // another device: the same (synced) passkey, nothing else
  await ctx.clearCookies();
  await w.evaluate(async () => { localStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase('volumen'); q.onsuccess = q.onerror = q.onblocked = r; }); });
  await w.goto('/read');
  await expect(w.locator('.book[data-id]')).toHaveCount(1);
  await w.locator('.book[data-id]').first().click({ button: 'right' });
  await w.getByRole('button', { name: 'Share as a link…' }).click();
  await w.getByRole('button', { name: 'Sign in with my passkey' }).click();
  await expect(w.locator('.toast')).toContainText('1 shared book from your other devices added', { timeout: 30000 });
  await closeSheet(w);
  await expect(book).toBeVisible();
  await book.click({ button: 'right' });
  await w.getByRole('button', { name: 'Share as a link…' }).click();
  expect(await w.getByLabel('The link').inputValue()).toBe(link);
  expect(sent.filter(r => /"prf"/.test(r))).toEqual([]);
  // (Share was chosen in the book's sheet: Escape still closes the share sheet, though
  // the book's sheet gave focus back to the book as it closed, after this one opened)
  await closeSheet(w);

  // removed from the library, a shared book's link is withdrawn with it: it stops
  // opening, and the vault no longer brings the book back
  const id = /#b=([\w-]+)/.exec(link)![1];
  await book.click({ button: 'right' });
  await w.getByRole('button', { name: /^Remove book/ }).click();
  const sheet = w.getByRole('dialog', { name: 'Remove a book' });
  await expect(sheet).toContainText('Its link stops working');
  await sheet.getByRole('button', { name: /^Remove/ }).click();
  await expect(w.locator('.toast')).toHaveText('Removed from the library.');
  expect((await w.request.get(`/api/books/${id}`)).status()).toBe(404);
  await w.reload();
  await w.locator('.book[data-id]').first().waitFor();
  await expect(book).toHaveCount(0);
  await ctx.close();
});

test('a book embedded in another site\'s page: read in place, nothing else of the app, only /embed may be framed', async ({ browser, request }) => {
  // (a page this test serves counts as public, and Chrome asks before a public page
  // reaches localhost: the permission a person would give)
  const ctx = await browser.newContext({ permissions: ['local-network-access'] });
  const book = new URL('../../bench/fixtures/tables.epub', import.meta.url).pathname;
  // (a site that refuses other sites' reads cannot be staged here: Playwright's answers
  // pass the browser's CORS check; a request that fails stands in for it)
  await ctx.route('https://books.example/**', r => r.request().url().endsWith('/closed.epub')
    ? r.abort()
    : r.fulfill({ path: book, headers: { 'Access-Control-Allow-Origin': '*', ETag: '"v1"' } }));
  const frame = (src: string) => `<!doctype html><title>A blog</title><h1>A blog</h1><iframe title="Sample" style="width:900px;height:640px;border:0" src="http://localhost:8788/embed#src=${src}"></iframe>`;
  await ctx.route('http://127.0.0.1:8799/**', r => r.fulfill({ contentType: 'text/html', body: frame(r.request().url().includes('closed') ? 'https://books.example/closed.epub' : 'https://books.example/tables.epub') }));
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8799/post'); // (another origin: a public one may not frame localhost)
  const f = p.frameLocator('iframe');
  await expect(f.getByRole('slider', { name: 'Place in the book' })).toHaveAttribute('aria-valuetext', /^Page \d+/, { timeout: 30000 });
  // no library, nothing to go back to: a way to Volumen itself instead
  await expect(f.getByRole('button', { name: /Back to the library/ })).toHaveCount(0);
  await expect(f.getByRole('link', { name: /Volumen/ })).toHaveAttribute('href', 'https://volumen.page');
  // reading moves nothing in the host page's history
  const before = await p.evaluate(() => history.length);
  await f.locator('.stage, [role=region]').first().click({ position: { x: 450, y: 300 } }).catch(() => {});
  await p.keyboard.press('m'); await p.waitForTimeout(400); await p.keyboard.press('Escape');
  await p.keyboard.press('q');
  await expect(f.getByRole('slider', { name: 'Place in the book' })).toHaveAttribute('aria-valuetext', /^Page \d+/);
  expect(await p.evaluate(() => history.length)).toBe(before);
  // a book that cannot be read from here: said plainly
  await p.goto('http://127.0.0.1:8799/closed');
  await expect(p.frameLocator('iframe').locator('.embed-wait')).toContainText('allow other sites to read it', { timeout: 20000 });
  // only /embed may be framed
  const embed = await request.get('/embed');
  expect(embed.headers()['x-frame-options']).toBeUndefined();
  expect(embed.headers()['content-security-policy']).toContain('frame-ancestors *');
  const page = await request.get('/read');
  expect(page.headers()['x-frame-options']).toBe('DENY');
  expect(page.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  await ctx.close();
});

test('a new draft to the same link: the writer sends it, the reader is offered it and keeps their notes', async ({ browser }) => {
  test.setTimeout(150_000);
  const v1 = readFileSync(new URL('../../bench/fixtures/manuscript.md', import.meta.url), 'utf8');
  const v2 = v1.replace('She wrote that down in the back of her schoolbook, under the sums.', 'She kept the line in her head instead, where no one would mark it.');
  const wctx = await browser.newContext();
  const w = await wctx.newPage();
  await passkeys(wctx, w);
  await w.goto(invite('Wren').replace(/^https?:\/\/[^/]+/, ''));
  await w.getByLabel('Your name, as your readers will know you').fill('Wren');
  await w.getByRole('button', { name: /Make my passkey/ }).click();
  await expect(w.locator('.toast')).toContainText('Welcome, Wren', { timeout: 30000 });
  await w.setInputFiles('input[type=file]', { name: 'manuscript.md', mimeType: 'text/markdown', buffer: Buffer.from(v1) });
  await expect(w.locator('.toast')).toContainText('Added');
  await w.locator('.book[data-id]', { hasText: 'The Lantern Keeper' }).click({ button: 'right' });
  await w.getByRole('button', { name: 'Share as a link…' }).click();
  await w.getByRole('button', { name: 'Make the link' }).click();
  const link = await w.getByLabel('The link').inputValue();
  await closeSheet(w);

  // the reader: the first draft, a highlight
  const rctx = await browser.newContext();
  await ownAddress(rctx);
  const r = await rctx.newPage();
  await r.goto(link.replace('http://localhost:8788', ''));
  await r.getByRole('dialog', { name: 'A book sent to you' }).waitFor({ timeout: 20000 });
  await r.keyboard.press('Enter');
  await expect(r.getByRole('slider', { name: 'Place in the book' })).toHaveAttribute('aria-valuetext', /^Page \d+/);
  await r.keyboard.press('ArrowRight');
  await r.waitForTimeout(900);
  await highlight(r, 0);
  await expect(r.locator('mark.hl')).toHaveCount(1);
  const quote = await r.locator('mark.hl').first().textContent();

  // the writer revises: the new file takes the share; the link still carries the first
  await w.setInputFiles('input[type=file]', { name: 'manuscript v2.md', mimeType: 'text/markdown', buffer: Buffer.from(v2) });
  await w.getByRole('dialog', { name: 'A new draft' }).getByRole('button', { name: 'Carry over, and remove the earlier draft' }).click();
  await expect(w.locator('.toast')).toContainText('the share link');
  await w.locator('.book[data-id]', { hasText: 'The Lantern Keeper' }).click({ button: 'right' });
  await w.getByRole('button', { name: 'Share as a link…' }).click();
  await expect(w.getByText('This link still carries an earlier draft')).toBeVisible();
  await w.getByRole('button', { name: 'Send this draft to your readers' }).click();
  await expect(w.locator('.toast')).toContainText('your readers get this draft (draft 2)');
  expect(await w.getByLabel('The link').inputValue()).toBe(link);

  // the reader opens the book again: offered the new draft, their highlight carried
  await r.keyboard.press('q');
  await r.locator('.book[data-id]', { hasText: 'The Lantern Keeper' }).click();
  const offer = r.getByRole('dialog', { name: 'A new draft' });
  await expect(offer).toBeVisible({ timeout: 20000 });
  await offer.getByRole('button', { name: 'Read the new draft' }).click();
  await expect(r.locator('.toast')).toContainText('1 note of yours carried over');
  await expect(r.getByRole('slider', { name: 'Place in the book' })).toHaveAttribute('aria-valuetext', /^Page \d+/);
  await r.keyboard.press('q');
  await expect(r.locator('.book[data-id]', { hasText: 'The Lantern Keeper' })).toHaveCount(1);
  await r.locator('.book[data-id]', { hasText: 'The Lantern Keeper' }).click();
  await expect(r.locator('mark.hl').first()).toHaveText(quote!);
  await expect(r.getByRole('dialog')).toHaveCount(0);
  await rctx.close(); await wctx.close();
});
