import { devices, type Page } from '@playwright/test';
import { test, expect, openFile, firstCol } from './fixtures';
import { layout, access, still } from './audit';

// Every view, at every size it may be met at: a wide screen to a small phone held either
// way, light and dark. Each must hold to the layout's rules (tests/audit.ts) and, at three
// of the sizes, pass an accessibility audit. SHOTS=dir keeps a picture of each view, to
// look at: what the rules cannot see.
const SHOTS = process.env.SHOTS;
const device = (n: string) => { const { defaultBrowserType: _, ...d } = devices[n]; return d; };
// (`books`: the views of a book's notes and pictures too, at sizes that span the shapes)
const SIZES = [
  { size: 'wide', use: { viewport: { width: 1440, height: 900 } }, axe: true, books: false },
  { size: 'desktop', use: { viewport: { width: 1280, height: 800 } }, axe: false, books: true },
  { size: 'laptop', use: { viewport: { width: 1024, height: 640 } }, axe: false, books: false },
  { size: 'window', use: { viewport: { width: 700, height: 520 } }, axe: false, books: true },
  { size: 'dark', use: { viewport: { width: 1280, height: 800 }, colorScheme: 'dark' as const }, axe: true, books: false },
  { size: 'tablet', use: device('iPad Mini'), axe: false, books: false },
  { size: 'phone', use: device('iPhone 13'), axe: true, books: true },
  { size: 'phone-sideways', use: device('iPhone 13 landscape'), axe: false, books: true },
  { size: 'small-phone', use: device('iPhone SE'), axe: false, books: true },
];

/** A word in the column in view selected as the hand would: a double click, or (a touch
 *  screen's selection being the system's own) the selection the system would make. */
async function selectWord(p: Page, touch: boolean, line = 4) {
  const k = await p.evaluate(() => (window as any).__vol.reader.cur);
  const lns = p.locator(`.col[data-k="${k}"] .ln[data-b]`);
  const n = Math.min(line, (await lns.count()) - 1);
  if (!touch) {
    const b = (await lns.nth(n).boundingBox())!;
    await p.mouse.dblclick(b.x + b.width * 0.4, b.y + b.height / 2);
  } else await lns.nth(n).evaluate(ln => {
    const t = [...ln.childNodes].find(c => c.nodeType === 3 && /\S+\s+\S+/.test(c.textContent!)) as Text;
    const w = [...t.data.matchAll(/\S+/g)];
    getSelection()!.setBaseAndExtent(t, w[0].index!, t, w[1].index! + w[1][0].length);
  });
  await expect(p.locator('.chip-pop')).toBeVisible();
}

for (const { size, use, axe, books } of SIZES) test.describe(size, () => {
  test.use(use);
  const touch = !!(use as { hasTouch?: boolean }).hasTouch;

  test(`every view holds its shape (${size})`, async ({ page: p, browserName }) => {
    test.skip(browserName !== 'chromium', 'the layout is checked in one engine; the others run the interactions');
    test.setTimeout(240_000);
    const found: string[] = [];
    const check = async (where: string, roots: string[], clear = '') => {
      await still(p);
      for (const f of await layout(p, roots, touch, clear)) found.push(`${where}: ${f}`);
      if (axe) for (const f of await access(p)) found.push(`${where}: axe ${f}`);
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/${size}-${where}.png` });
    };
    const esc = async (gone: string) => { await p.keyboard.press('Escape'); await expect(p.locator(gone)).toHaveCount(0); };

    // the library, a book's sheet, every book's notebook, a search
    await p.goto('/');
    await p.evaluate(() => localStorage.clear());
    await p.goto('/');
    await p.locator('.book[data-id]').first().waitFor();
    await check('library', ['.shelf']);
    await p.locator('.more').first().click();
    await expect(p.locator('.sheet')).toBeVisible();
    await check('book-sheet', ['.sheet']);
    await esc('.sheet');
    await p.keyboard.press('n');
    await check('library-notebook', ['.shelf']);
    await p.keyboard.press('n');
    await p.getByRole('searchbox', { name: 'Search the library' }).fill('Syme');
    await expect(p.locator('.shelf')).toContainText(/Syme/);
    await check('library-search', ['.shelf']);
    await p.getByRole('searchbox', { name: 'Search the library' }).fill('');

    // the book: at rest, then the bar
    await p.locator('.book[data-id]').first().click();
    await p.waitForFunction(() => { const r = (window as any).__vol.reader; return r?.reading && r.strip && r.strip.layouts.size === r.book.sections.length; });
    // a full page of text (past the title and the chapter's opening), whatever the size
    await p.evaluate(() => {
      const r = (window as any).__vol.reader;
      for (let k = 12; k < r.strip.N; k++) { r.jump(k); if (document.querySelectorAll(`.col[data-k="${k}"] .ln[data-b]`).length >= 8) return; }
    });
    // reading, once the bar has gone (the head and the page's number have no paper of their
    // own: they keep off the book's lines)
    const lines = '.col .ln';
    if (!touch) await p.mouse.move(640 * ((use as any).viewport?.width ?? 1280) / 1280, 300);
    await expect(p.locator('.bar')).toHaveClass(/away/, { timeout: 10_000 });
    await check('reader', ['.bar', '.progress', '.stage'], lines);
    const st = (await p.locator('.stage').boundingBox())!;
    // (a finger's tap in the middle shows the bar once it has gone after the opening)
    if (touch) { await expect(p.locator('.bar')).toHaveClass(/away/, { timeout: 10_000 }); await p.touchscreen.tap(st.x + st.width / 2, st.y + st.height / 2); }
    else await p.mouse.move(st.x + st.width / 2, 20);
    await expect(p.locator('.bar')).not.toHaveClass(/away/);
    await check('bar', ['.bar', '.progress', '.more'], lines);
    // the menu at the end of the foot
    const more = p.getByRole('button', { name: 'More' });
    if (touch) await more.tap(); else await more.click();
    await expect(p.getByRole('menu')).toBeVisible();
    await check('more', ['.menu']);
    await p.keyboard.press('Escape');
    await expect(p.getByRole('menu')).toHaveCount(0);
    // a bookmark on this page, for the contents' list
    await p.keyboard.press('b');

    // a selection's menu; a note written (in a sheet: the rail is not on yet)
    await selectWord(p, touch);
    await check('menu', ['.chip-pop']);
    // (the colours, Note and Copy in one row, however narrow the phone)
    const rows = await p.locator('.chip-pop > .dot, .chip-pop > .act').evaluateAll(els => new Set(els.map(e => Math.round(e.getBoundingClientRect().top))).size);
    expect(rows, 'the menu in one row').toBe(1);
    await p.keyboard.press('n');
    await expect(p.locator('.sheet')).toBeVisible();
    await check('note-sheet', ['.sheet']);
    await p.getByRole('textbox', { name: 'Your note' }).fill('A first thought about this, long enough to wrap onto a second line in a card.');
    await p.getByRole('button', { name: 'Done' }).click();
    await expect(p.locator('.sheet')).toHaveCount(0);
    // the highlight's own menu: its colours and its actions in one row, on any phone but the
    // narrowest (a 320 one wraps)
    const mark = p.locator('.col mark.hl[data-a]').first();
    if (touch) await mark.tap(); else await mark.click();
    await expect(p.getByRole('button', { name: 'Remove highlight' })).toBeVisible();
    await check('highlight-menu', ['.chip-pop']);
    const W = await p.evaluate(() => innerWidth);
    if (W >= 360) expect(await p.locator('.chip-pop > button').evaluateAll(els => new Set(els.map(e => Math.round(e.getBoundingClientRect().top))).size), 'the highlight\'s menu in one row').toBe(1);
    await p.keyboard.press('Escape');
    await expect(p.locator('.chip-pop')).toHaveCount(0);
    await p.evaluate(() => {
      const r = (window as any).__vol.reader;
      const lns = document.querySelectorAll<HTMLElement>(`.col[data-k="${r.cur}"] .ln[data-b]`), ln = lns[Math.min(9, lns.length - 1)];
      const sec = r.strip.itemAt(r.cur).sec, b = r.book.sections[sec].blocks[+ln.dataset.b!], s0 = +ln.dataset.s!;
      r.ann.add(b.key, s0, Math.min(b.t.length, s0 + 40), 3, 'A second.');
      r.marking.refreshSection(sec);
    });

    // the notes: the rail where there is room, else over the text
    // (set again for the rail, the page where the first note is)
    await p.keyboard.press(';');
    await p.evaluate(async () => { const r = (window as any).__vol.reader; await r.whole; const a = r.ann.list[0]; r.jump(r.strip.resolve({ key: a.key, off: a.s })); });
    const railed = await p.evaluate(() => (window as any).__vol.ui.railed);
    // (no rail: the move to the note put the notes away; ; shows those in view now)
    if (!railed) await p.keyboard.press(';');
    await expect(p.locator('.sn').first()).toBeVisible();
    await check(railed ? 'rail' : 'notes', ['.sns', '.rail']);
    if (railed) {
      await selectWord(p, touch, 14);
      await p.keyboard.press('n');
      await expect(p.locator('.sn.open textarea')).toBeFocused();
      await check('rail-writing', ['.sns']);
      await p.keyboard.press('Escape');
      await p.keyboard.press(';');
      await p.evaluate(() => (window as any).__vol.reader.whole);
    } else await p.keyboard.press('Escape');
    await expect(p.locator('.sn')).toHaveCount(0);

    // the contents and the highlights
    await p.keyboard.press('m');
    await expect(p.locator('.contents')).toBeVisible();
    await check('contents', ['.contents']);
    await p.getByRole('tab', { name: 'Bookmarks' }).click();
    await check('bookmarks', ['.contents']);
    await p.getByRole('tab', { name: 'Highlights' }).click();
    await check('highlights', ['.contents']);
    await esc('.contents');

    // type and appearance, its Style page, a theme being made
    await p.keyboard.press('s');
    await expect(p.locator('.panel')).toBeVisible();
    await check('settings', ['.panel']);
    await p.locator('.panel .row.nav', { hasText: 'Style' }).click();
    await check('style', ['.panel']);
    await p.getByRole('button', { name: 'New theme from this' }).click();
    await expect(p.locator('.sheet')).toBeVisible();
    await check('theme-editor', ['.sheet']);
    await esc('.sheet');
    await p.evaluate(() => { (window as any).__vol.ui.sheet = null; });

    // help, find, sending one's notes
    await p.keyboard.press('?');
    await expect(p.locator('.sheet')).toBeVisible();
    await check('help', ['.sheet']);
    await esc('.sheet');
    await p.keyboard.press('/');
    await p.keyboard.type('Syme'); await p.keyboard.press('Enter');
    await expect(p.locator('.find')).toBeVisible();
    await check('find', ['.find']);
    await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
    await p.evaluate(() => { (window as any).__vol.ui.sheet = 'send'; });
    await expect(p.locator('.sheet')).toBeVisible();
    await check('send', ['.sheet']);

    expect(found).toEqual([]);
  });

  test(`a book's notes and pictures hold their shape (${size})`, async ({ page: p, browserName }) => {
    test.skip(browserName !== 'chromium' || !books, 'the layout is checked in one engine, at a few sizes');
    test.setTimeout(240_000);
    const found: string[] = [];
    const check = async (where: string, roots: string[]) => {
      await still(p);
      for (const f of await layout(p, roots, touch)) found.push(`${where}: ${f}`);
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/${size}-${where}.png` });
    };
    // a note at its marker: the book's longest, so that it scrolls
    await openFile(p, '../bench/fixtures/artofwar.epub', 'Art of War');
    const i = await p.evaluate(() => { const ns = (window as any).__vol.reader.book.notes as { t: string }[]; return ns.reduce((m, n, j) => (n.t.length > ns[m].t.length ? j : m), 0); });
    const k = await firstCol(p, `a.nr[data-n="${i}"]`);
    await still(p);
    const nr = p.locator(`.col[data-k="${k}"] a.nr[data-n="${i}"]`).first();
    if (touch) await nr.tap(); else await nr.click();
    await expect(p.getByRole('dialog', { name: /^Note / })).toBeVisible();
    await check('footnote', ['.bn']);
    await p.keyboard.press('Escape');
    // a picture, large
    await openFile(p, '../bench/fixtures/beagle.epub', 'Beagle');
    const f = await firstCol(p, 'figure.img');
    await still(p);
    const img = p.locator(`.col[data-k="${f}"] figure.img img`).first();
    if (touch) await img.tap(); else await img.click();
    await expect(p.locator('.lb.shown')).toBeVisible();
    await check('image', ['.lb']);
    expect(found).toEqual([]);
  });
});
