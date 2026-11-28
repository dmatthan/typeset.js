import { type Page } from '@playwright/test';
import { access } from './audit';
import { test, expect, SAMPLE, openFile, firstCol, settled } from './fixtures';
import { inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

// The interaction rules that are the point of the reader (reader/input.ts), against the app.
const cur = (p: Page) => p.evaluate(() => (window as any).__typeset.reader.cur as number);
/** Where the reader is, as the status line under the text names it (its page left out). */
/** Where the reader is, as a screen reader hears it: "Page 12 of 324, III · …". */
const place = (p: Page) =>
  p
    .getByRole('slider', { name: 'Place in the book' })
    .getAttribute('aria-valuetext')
    .then(v => v ?? '');
/** The chapter the reader is in. */
const runhead = async (p: Page) => (await place(p)).replace(/^Page \d+ of \d+, /, '');
const anchor = (p: Page) =>
  p.evaluate(() => {
    const r = (window as any).__typeset.reader;
    return JSON.stringify(r.strip.anchorAt(r.cur));
  });
/** A key that moves the sheet, pressed, and the sheet landed where it went. */
const turn = async (p: Page, key: string) => {
  const from = await cur(p);
  await p.keyboard.press(key);
  await expect.poll(() => cur(p)).not.toBe(from);
  await settled(p);
};
/** Set again for a window `w` wide: measured, the whole book laid out, landed. */
const laidAt = async (p: Page, w: number) => {
  await p.waitForFunction(w => (window as any).__typeset.reader.M?.W === w, w);
  await p.evaluate(() => (window as any).__typeset.reader.whole);
  await settled(p);
};
/** Set again at another size than `fs`: measured, the whole book laid out, landed. */
const fsChanged = async (p: Page, fs: number) => {
  await p.waitForFunction(fs => (window as any).__typeset.reader.M.fs !== fs, fs);
  await p.evaluate(() => (window as any).__typeset.reader.whole);
  await settled(p);
};

async function openSample(p: Page) {
  await p.goto('/');
  await p.evaluate(() => localStorage.clear());
  await p.goto('/');
  await p.locator('.book[data-id]').first().click();
  // reading begins before the whole book is laid out; tests want all of it
  await p.waitForFunction(() => {
    const r = (window as any).__typeset.reader;
    return r.strip && r.strip.layouts.size === r.book.sections.length;
  });
}

/** Moves to the first text column of chapter I through the contents, as a reader would. */
async function toChapterOne(p: Page) {
  await p.keyboard.press('m');
  await expect(p.locator('.contents')).toBeVisible();
  await p.locator('.contents .row', { hasText: /^Chapter I ·/ }).click();
  await expect(p.locator('.contents')).toHaveCount(0);
  await expect.poll(() => runhead(p)).toMatch(/^I · /);
  await settled(p);
}

test("the stock palette (what a theme file, a new theme or a page's paper takes from the default) and the highlights are the app's own", async ({
  page: p,
}) => {
  await p.goto('/');
  const diff = await p.evaluate(async () => {
    // (the module as the dev server serves it to the page)
    const at = '/src/reader/themes.svelte.ts';
    const { STOCK, HIGHLIGHTS } = await import(/* @vite-ignore */ at);
    // (as painted: a browser may keep oklch() as it was written)
    const cx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgb = (c: string) => {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = c;
      cx.fillRect(0, 0, 1, 1);
      return `rgb(${[...cx.getImageData(0, 0, 1, 1).data].slice(0, 3).join(', ')})`;
    };
    const out: string[] = [];
    for (const mode of ['light', 'dark'] as const) {
      document.documentElement.setAttribute('data-theme', mode);
      const root = getComputedStyle(document.documentElement);
      for (const k of ['paper', 'ink', 'accent'] as const) {
        const tok = root
          .getPropertyValue('--' + k)
          .trim()
          .replace(/var\(--(\w+)\)/g, (_, v) => root.getPropertyValue('--' + v).trim());
        const [a, b] = [rgb(tok), rgb((STOCK as any)[mode][k])];
        const [x, y] = [a, b].map(v =>
          v
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number),
        );
        if (x.some((v, i) => Math.abs(v - y[i]) > 1.5)) out.push(`${mode} ${k}: ${a} (tokens) against ${b} (STOCK)`);
      }
      // the highlights, colour and how much of it (a theme's own are worked out from these)
      const rgba = (c: string) => {
        cx.clearRect(0, 0, 1, 1);
        cx.fillStyle = c;
        cx.fillRect(0, 0, 1, 1);
        return [...cx.getImageData(0, 0, 1, 1).data];
      };
      (HIGHLIGHTS as any)[mode].forEach(([L, C, H, al]: number[], i: number) => {
        const [x, y] = [rgba(root.getPropertyValue(`--hl${i + 1}`).trim()), rgba(`oklch(${L} ${C} ${H} / ${al})`)];
        if (x.some((v, j) => Math.abs(v - y[j]) > 2))
          out.push(`${mode} --hl${i + 1}: ${x} (tokens) against ${y} (HIGHLIGHTS)`);
      });
    }
    return out;
  });
  expect(diff).toEqual([]);
});

test("the reader's menus and sheets take each theme's paper, softened, and its quieter inks read on them", async ({
  page: p,
}) => {
  await openSample(p);
  const out = await p.evaluate(async () => {
    const at = '/src/reader/themes.svelte.ts';
    const { BUILTIN } = await import(/* @vite-ignore */ at);
    const v = (window as any).__typeset,
      look = document.querySelector('.look')!;
    const cx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const probe = document.createElement('div');
    look.append(probe);
    const rgb = (prop: 'color' | 'backgroundColor', val: string) => {
      probe.style[prop] = val;
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = getComputedStyle(probe)[prop];
      cx.fillRect(0, 0, 1, 1);
      return [...cx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const lum = (c: number[]) => {
      const [r, g, b] = c.map(x => {
        x /= 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const found: string[] = [],
      seen: string[] = [];
    for (const t of BUILTIN)
      for (const mode of ['light', 'dark']) {
        v.settings.theme = t.id;
        v.settings.appearance = mode;
        v.reader.appearance.themeChanged();
        const paper = rgb('backgroundColor', 'var(--paper)');
        // the text over each highlight, laid on the paper as the page lays it, reads
        for (const h of ['--hl1', '--hl2', '--hl3', '--hl4']) {
          probe.style.backgroundColor = `var(${h})`;
          cx.fillStyle = `rgb(${paper.join(',')})`;
          cx.fillRect(0, 0, 1, 1);
          cx.fillStyle = getComputedStyle(probe).backgroundColor;
          cx.fillRect(0, 0, 1, 1);
          const over = [...cx.getImageData(0, 0, 1, 1).data].slice(0, 3),
            k = ratio(rgb('color', 'var(--ink)'), over);
          if (k < 4.5) found.push(`${t.id} ${mode}: --ink on ${h} ${k.toFixed(2)}:1`);
        }
        for (const bg of ['--paper', '--surface', '--sheet', '--ground']) {
          const ground = rgb('backgroundColor', `var(${bg})`);
          // (its own: near the paper, not the app's)
          seen.push(
            `${t.id} ${mode} ${bg} ${ground.map((x, i) => Math.abs(x - paper[i])).reduce((m, x) => Math.max(m, x), 0)}`,
          );
          for (const ink of ['--ink', '--ink-2', '--ink-3']) {
            const k = ratio(rgb('color', `var(${ink})`), ground);
            if (k < 4.5) found.push(`${t.id} ${mode}: ${ink} on ${bg} ${k.toFixed(2)}:1`);
          }
        }
      }
    probe.remove();
    return { found, far: seen.filter(s => +s.split(' ').pop()! > 24) };
  });
  expect(out.found).toEqual([]);
  // every surface within a step of its paper: the theme's, softened
  expect(out.far).toEqual([]);
});

test("however small the box (a sidebar on someone's blog), the text keeps margins and ends inside it", async ({
  page: p,
}) => {
  await p.goto('/');
  const bad = await p.evaluate(async () => {
    const at = '/src/reader/geometry.ts';
    const { metrics } = await import(/* @vite-ignore */ at);
    const out: string[] = [];
    for (const [W, H] of [
      [200, 600],
      [236, 600],
      [320, 120],
      [800, 120],
      [800, 160],
      [800, 200],
      [180, 140],
    ]) {
      const M = metrics(W, H);
      if (M.x0 < 12 || M.x0 + M.focusW > W - 12) out.push(`${W}×${H}: the text from ${M.x0} to ${M.x0 + M.focusW}`);
      if (M.rows < 1 || M.y0 + M.colH > H) out.push(`${W}×${H}: ${M.rows} rows ending at ${M.y0 + M.colH}`);
    }
    return out;
  });
  expect(bad).toEqual([]);
});

test('library, open: reading begins at once, and again where it was left', async ({ page: p }) => {
  await openSample(p);
  await expect(p.locator('.col')).not.toHaveCount(0);
  await expect(p.locator('.sheet')).toHaveCount(0);
  expect(await runhead(p)).toContain('Thursday');
  await toChapterOne(p);
  const k = await cur(p);
  await p.keyboard.press('q');
  await expect(p.locator('.shelf')).toBeVisible();
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => (window as any).__typeset.reader.reading);
  await expect(p.locator('.sheet')).toHaveCount(0);
  expect(await cur(p)).toBe(k);
  expect(await runhead(p)).toMatch(/^I · /);
});

test('a chapter chosen in the contents: they go away and the reader travels there; [ and ] step by chapter', async ({
  page: p,
}) => {
  await openSample(p);
  await p.keyboard.press('m');
  await expect(p.locator('.contents')).toBeVisible();
  await p.locator('.contents .row').nth(4).click();
  await expect(p.locator('.contents')).toHaveCount(0);
  await expect.poll(() => runhead(p)).toMatch(/^III · /);
  await settled(p);
  // the chapter the reader is in, marked when they open again
  await p.keyboard.press('m');
  await expect(p.locator('.contents .row[aria-current="true"]')).toContainText('III');
  await p.keyboard.press('Escape');
  // a page of the book, counted over the whole of it
  await expect.poll(() => place(p)).toMatch(/^Page \d+ of \d+, III · /);
  await p.keyboard.press(']');
  await expect.poll(() => runhead(p)).toMatch(/^IV · /);
  await settled(p);
  await p.keyboard.press('[');
  await expect.poll(() => runhead(p)).toMatch(/^III · /);
  // Esc, or a press beside them, puts the contents away
  await p.keyboard.press('m');
  await expect(p.locator('.contents')).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(p.locator('.contents')).toHaveCount(0);
});

test('less motion is the default: a key turns the page at once, and Aa says so', async ({ browser }, info) => {
  // (a context of its own: the tests' pages follow the system's motion, base.ts)
  const ctx = await browser.newContext({ baseURL: info.project.use.baseURL });
  const p = await ctx.newPage();
  await p.goto('/');
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => {
    const r = (window as any).__typeset.reader;
    return r?.reading && r.strip && r.strip.layouts.size === r.book.sections.length;
  });
  await p.evaluate(() => (window as any).__typeset.reader.jump(6));
  const k = await p.evaluate(() => (window as any).__typeset.reader.cur);
  const turned = await p.evaluate(
    () =>
      new Promise<[number, boolean]>(done => {
        const r = (window as any).__typeset.reader;
        dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
        // (at once: the next frame finds it there, nothing moving)
        requestAnimationFrame(() => done([r.cur, r.motion.moving]));
      }),
  );
  expect(turned).toEqual([k + 1, false]);
  // (on Style, one step into Aa)
  await p.keyboard.press('s');
  await p.keyboard.press('c');
  await expect(p.getByRole('switch', { name: 'Less motion' })).toHaveAttribute('aria-checked', 'true');
  await ctx.close();
});

test('the controls: Back, the title in the middle, a bookmark; the rest in one menu at the foot, by key too', async ({
  page: p,
}) => {
  await openSample(p);
  await toChapterOne(p);
  // (read on from where the contents took it: the way back there is gone)
  await p.keyboard.press('ArrowRight');
  await expect(p.locator('.bar .return')).toHaveCount(0);
  await p.mouse.move(640, 10);
  const bar = p.locator('.bar');
  await expect(bar).not.toHaveClass(/away/);
  // the top: the way back and the bookmark, nothing else; the title in the middle of the window
  await expect(bar.getByRole('button')).toHaveCount(2);
  // (the way out as everywhere a book is above where it came from: × Close, the same icon)
  const close = bar.getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeVisible();
  expect(await close.locator('path').getAttribute('d')).toBe('M6.5 6.5l11 11M17.5 6.5l-11 11');
  await expect(bar.getByRole('button', { name: 'Bookmark this page' })).toBeVisible();
  const mid = await p.locator('.runhead').evaluate(e => {
    const r = e.getBoundingClientRect();
    return r.left + r.width / 2 - innerWidth / 2;
  });
  expect(Math.abs(mid)).toBeLessThan(2);
  // the foot: the line, and the menu's button at its end
  await p.mouse.move(640, 790);
  const more = p.getByRole('button', { name: 'More' });
  await expect(more).toBeVisible();
  await more.click();
  const menu = p.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Contents',
    'Bookmarks',
    'Find in the book',
    'Type and appearance',
    'Keys and gestures',
  ]);
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Notes beside the text' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  // the keys: the first item has focus; arrows go through them, Escape closes it and back to the button
  await expect(menu.getByRole('menuitem', { name: 'Contents' })).toBeFocused();
  await p.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Bookmarks' })).toBeFocused();
  await p.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  // what it opens: type and appearance, rising from where the menu was
  await more.click();
  await menu.getByRole('menuitem', { name: 'Type and appearance' }).click();
  const panel = p.getByRole('dialog', { name: 'Type and appearance' });
  await expect(panel).toBeVisible();
  await expect(menu).toHaveCount(0);
  const [pb, mb] = await Promise.all([panel.boundingBox(), more.boundingBox()]);
  expect(pb!.y + pb!.height).toBeLessThanOrEqual(mb!.y);
  expect(pb!.x + pb!.width).toBeGreaterThan(mb!.x);
  await p.keyboard.press('Escape');
  // Escape put it away however soon it is pressed (before its first item has focus too)
  await p.mouse.move(640, 790);
  // (the next task after the press: a key cannot come sooner, and focus moves a frame later)
  await p.evaluate(async () => {
    (document.querySelector('.more button[aria-haspopup]') as HTMLElement).click();
    await new Promise(r => setTimeout(r, 0));
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await expect(menu).toHaveCount(0);
  // a press anywhere else puts the menu away
  await p.mouse.move(640, 790);
  await more.click();
  await expect(menu).toBeVisible();
  await p.mouse.click(400, 400);
  await expect(menu).toHaveCount(0);
});

test("bookmarks: B or the bar marks the page, a ribbon shows it, the contents list them; they go with one's notes, not to a writer", async ({
  page: p,
}) => {
  await openSample(p);
  await toChapterOne(p);
  const bm = p.locator('.bar').getByRole('button', { name: 'Bookmark this page' });
  const ribbon = p.locator('.ribbon');
  await expect(ribbon).toHaveCount(0);
  await p.keyboard.press('b');
  await expect(ribbon).toHaveCount(1);
  await expect(bm).toHaveAttribute('aria-pressed', 'true');
  const first = await cur(p);
  // the ribbon is for reading: with the bar up (Type and appearance holds it), its button says it
  await p.mouse.move(640, 400);
  await expect(p.locator('.bar')).toHaveClass(/away/, { timeout: 10_000 });
  await expect(ribbon).not.toHaveClass(/hid/);
  await p.keyboard.press('s');
  await expect(p.locator('.bar')).not.toHaveClass(/away/);
  await expect(ribbon).toHaveClass(/hid/);
  await p.keyboard.press('Escape');
  // another page: not marked; the bar's button marks it
  await p.evaluate(() => {
    const r = (window as any).__typeset.reader;
    r.jump(r.cur + 20);
  });
  await settled(p);
  await expect(ribbon).toHaveCount(0);
  await p.mouse.move(640, 10);
  await expect(bm).toHaveAttribute('aria-pressed', 'false');
  await bm.click();
  await expect(ribbon).toHaveCount(1);
  // kept, and listed in the contents, in the book's order, each with its page
  expect(
    await p.evaluate(() => {
      const v = (window as any).__typeset;
      return v.kv.get('bm.' + v.reader.book.id, []).length;
    }),
  ).toBe(2);
  await p.keyboard.press('m');
  await p.getByRole('tab', { name: 'Bookmarks' }).click();
  const items = p.locator('.bms .bmk');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText(String(first + 1));
  // (its opening to a whole word)
  await expect(items.first().locator('.q')).toHaveText(/\w…$/);
  await items.first().locator('.go').click();
  await expect.poll(() => cur(p)).toBe(first);
  await expect(ribbon).toHaveCount(1);
  // B on a marked page takes the mark away
  await p.keyboard.press('b');
  await expect(ribbon).toHaveCount(0);
  await p.keyboard.press('m');
  await p.getByRole('tab', { name: 'Bookmarks' }).click();
  await expect(items).toHaveCount(1);
  await items.first().getByRole('button', { name: 'Remove bookmark' }).click();
  await expect(items).toHaveCount(0);
  await expect(p.locator('.bms')).toContainText('No bookmarks');
  await p.keyboard.press('Escape');
  // with one's notes: out in the file, and back from it
  await p.keyboard.press('b');
  const file = await p.evaluate(() => JSON.stringify((window as any).__typeset.reader.myNotes()));
  expect(JSON.parse(file).notes.filter((n: any) => n.kind === 'bookmark')).toHaveLength(1);
  await p.keyboard.press('b');
  await expect(ribbon).toHaveCount(0);
  await p.evaluate(t => (window as any).__typeset.reader.receiveNotes([t]), file);
  await expect(ribbon).toHaveCount(1);
  // another reader's file: their bookmarks are theirs, never shown to the writer
  const theirs = JSON.parse(file);
  theirs.from = { id: 'someone-else', name: 'Ada' };
  await p.evaluate(t => (window as any).__typeset.reader.receiveNotes([t]), JSON.stringify(theirs));
  expect(await p.evaluate(() => (window as any).__typeset.reader.fb.gathered().length)).toBe(0);
});

test('set again (a size, a face, the window): the page as it was until the new one is set, then both at once; nothing held over it meanwhile', async ({
  page: p,
}) => {
  // (a window where the first pass's page count is not the book's)
  await p.setViewportSize({ width: 1000, height: 640 });
  await openSample(p);
  // (in a chapter whose pages the first pass guesses wrongly at this size)
  await p.evaluate(() => (window as any).__typeset.reader.jump(14));
  await settled(p);
  await p.mouse.move(500, 300);
  // every frame: the page shown whole (each line within its column, the columns apart);
  // the page as it was drawn as it was (a size, a face, spacing come with the page set for
  // them, never before it); a copy fading over the page only once the new one is under it
  // (never over one still being set: it would hide the page, and what is done to it, for
  // the wait); while the window changes size, the page in its middle (read once the reader
  // has heard of the size: resize observers run in the order they were made)
  const watch = () =>
    p.evaluate(() => {
      const w = window as any;
      w.bad = [];
      w.watching = true;
      w.held = 0;
      w.settling = 0;
      const stage = document.querySelector<HTMLElement>('.stage')!,
        r = w.__typeset.reader;
      const VARS = ['--f-text', '--fs', '--lh', '--colW', '--ls', '--ws', '--wb', '--fvs'];
      const vars = () => {
        const s = getComputedStyle(stage);
        return VARS.map(v => s.getPropertyValue(v)).join('|');
      };
      const was = vars(),
        old = new WeakSet(stage.querySelectorAll(':scope > .track .col'));
      const inView = () =>
        [...stage.querySelectorAll<HTMLElement>(':scope > .track .col')].filter(
          c => +c.dataset.k! >= r.cur && +c.dataset.k! < r.cur + r.M.N,
        );
      const check = () => {
        if (!w.watching) return;
        const cols = inView(),
          rs = cols.map(c => c.getBoundingClientRect());
        for (let i = 0; i < rs.length; i++)
          for (let j = i + 1; j < rs.length; j++)
            if (Math.min(rs[i].right, rs[j].right) - Math.max(rs[i].left, rs[j].left) > 1)
              w.bad.push('columns over each other');
        cols.forEach((c, i) => {
          for (const ln of c.querySelectorAll('.ln:not(.brk)')) {
            const g = document.createRange();
            g.selectNodeContents(ln);
            const b = g.getBoundingClientRect();
            if (b.width && b.right > rs[i].right + 3) {
              w.bad.push(`a line past its column by ${Math.round(b.right - rs[i].right)}`);
              break;
            }
          }
        });
        if (cols.some(c => old.has(c)) && vars() !== was) w.bad.push('the page as it was, drawn with the new style');
        if (document.querySelector('.hold')) {
          w.held++;
          if (cols.some(c => old.has(c))) w.bad.push('a copy over a page not yet set');
        }
        if (w.__typeset.ui.settling) w.settling++;
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
      new ResizeObserver(() => {
        if (!w.watching) return;
        const cs = inView().map(c => c.getBoundingClientRect()),
          st = stage.getBoundingClientRect();
        if (!cs.length) return;
        const mid = (Math.min(...cs.map(c => c.left)) + Math.max(...cs.map(c => c.right))) / 2;
        if (Math.abs(mid - (st.left + st.width / 2)) > 2)
          w.bad.push(`off the middle of the window by ${Math.round(mid - (st.left + st.width / 2))}`);
      }).observe(stage);
    });
  const seen = () =>
    p.evaluate(() => {
      const w = window as any;
      w.watching = false;
      return { bad: [...new Set(w.bad)], held: w.held, settling: w.settling };
    });

  // a size: the page's number, the old then the last (the whole book's layout as slow as a
  // phone's, so that the first pass's estimate would show)
  await p.evaluate(() => {
    const core = (window as any).__typeset.reader.core,
      layout = core.layout.bind(core);
    core.layout = (id: string, secs: number[], params: unknown) =>
      secs.length
        ? layout(id, secs, params)
        : new Promise(r => setTimeout(r, 500)).then(() => layout(id, secs, params));
  });
  await expect(p.locator('.bar')).toHaveClass(/away/, { timeout: 10_000 });
  const was = await p.locator('.pn').allTextContents();
  await watch();
  await p.evaluate(() => {
    const w = window as any;
    w.numbers = new Set();
    const look = () => {
      for (const n of document.querySelectorAll<HTMLElement>('.pn'))
        if (+getComputedStyle(n).opacity > 0.05) w.numbers.add(n.textContent);
      if (w.watching) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await p.evaluate(() => {
    const w = window as any;
    w.__typeset.settings.step = 6;
    return w.__typeset.reader.settingsChanged('layout');
  });
  await laidOut(p);
  await expect(p.locator('.hold')).toHaveCount(0);
  const shown: string[] = await p.evaluate(() => [...(window as any).numbers]),
    last = await p.locator('.pn').allTextContents();
  expect(
    shown.filter(n => !was.includes(n) && !last.includes(n)),
    `${was} then ${last}`,
  ).toEqual([]);
  expect((await seen()).bad).toEqual([]);

  // a face, as the panel changes it (the setting at once, the text set again 60 ms later)
  await watch();
  await p.evaluate(async () => {
    const w = window as any;
    w.__typeset.settings.theme = 'slate';
    await new Promise(r => setTimeout(r, 60));
    return w.__typeset.reader.settingsChanged('layout');
  });
  await laidOut(p);
  await expect(p.locator('.hold')).toHaveCount(0);
  expect((await seen()).bad).toEqual([]);

  // the window made narrower in steps: the page kept in its middle, set again once it rests
  await watch();
  for (const w of [900, 820, 760]) {
    await p.setViewportSize({ width: w, height: 640 });
    await p.waitForTimeout(40);
  }
  // set again once it rests: the page within the window (the columns in view: those built
  // ahead lie under the paper beside them)
  const inside = () =>
    p.evaluate(() => {
      const r = (window as any).__typeset.reader;
      return [...document.querySelectorAll<HTMLElement>('.stage > .track .col')]
        .filter(c => +c.dataset.k! >= r.cur && +c.dataset.k! < r.cur + r.M.N)
        .map(c => c.getBoundingClientRect())
        .every(b => b.left >= 0 && b.right <= innerWidth);
    });
  await expect.poll(inside).toBe(true);
  await laidOut(p);
  await expect(p.locator('.hold')).toHaveCount(0);
  expect((await seen()).bad).toEqual([]);

  // a few pixels' change of height that sets nothing again (a phone's bars): nothing at all
  await watch();
  await p.setViewportSize({ width: 760, height: 636 });
  await p.waitForTimeout(400);
  const still = await seen();
  expect(still).toEqual({ bad: [], held: 0, settling: 0 });
});

test('set again, the line being read travels to its new place as the old page fades into the new', async ({
  page: p,
}) => {
  await openSample(p);
  await toChapterOne(p);
  // where the reader is: the line at the head of the page
  const at = await p.evaluate(() => {
    const r = (window as any).__typeset.reader,
      a = r.strip.anchorAt(r.cur),
      h = r.strip.keyIndex.get(a.key);
    return { off: a.off, sec: h[0], b: h[1] };
  });
  // the fade, caught at its last frame and kept there
  await p.evaluate(() => {
    const w = window as any;
    w.caught = false;
    const look = () => {
      const as = [...document.querySelectorAll('.hold, .held')].flatMap(e => e.getAnimations());
      if (as.length) {
        for (const a of as) {
          a.pause();
          a.currentTime = Number(a.effect!.getTiming().duration);
        }
        w.caught = true;
        return;
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await p.evaluate(() => {
    const w = window as any;
    w.__typeset.settings.step = 7;
    return w.__typeset.reader.settingsChanged('layout');
  });
  await expect.poll(() => p.evaluate(() => (window as any).caught)).toBe(true);
  const [held, live] = await p.evaluate(at => {
    const r = (window as any).__typeset.reader;
    // the copy's: the first line of the page it shows; the page's: the line with those words now
    const first = document.querySelector('.held .col .ln:not(.brk)')!.getBoundingClientRect();
    const lines = [...document.querySelectorAll<HTMLElement>('.stage > .track .col')]
      .filter(c => {
        const k = +c.dataset.k!;
        return k >= r.cur && k < r.cur + r.M.N && r.strip.itemAt(k)?.sec === at.sec;
      })
      .flatMap(c => [...c.querySelectorAll<HTMLElement>(`.ln[data-b="${at.b}"]`)])
      .filter(l => +l.dataset.s! <= at.off);
    const ln = lines.sort((a, z) => +z.dataset.s! - +a.dataset.s!)[0].getBoundingClientRect();
    return [
      [first.left, first.top],
      [ln.left, ln.top],
    ];
  }, at);
  expect(Math.abs(held[0] - live[0]), `${held} ${live}`).toBeLessThanOrEqual(2);
  expect(Math.abs(held[1] - live[1]), `${held} ${live}`).toBeLessThanOrEqual(2);
});

test('the page number alone while reading; with the bar, a hairline and N of Total, all in the margin below the text', async ({
  page: p,
}) => {
  await openSample(p);
  await toChapterOne(p);
  await p.mouse.move(640, 400);
  const bar = p.locator('.bar');
  await expect(bar).toHaveClass(/away/);
  const k = await cur(p);
  // reading: each column's number under it, nothing else
  const nums = p.locator('.pn');
  await expect(nums).toHaveText([String(k + 1), String(k + 2)]);
  const geo = await p.evaluate(() => {
    const r = (window as any).__typeset.reader,
      M = r.M;
    const cols = [
      ...document.querySelectorAll<HTMLElement>(`.col[data-k="${r.cur}"], .col[data-k="${r.cur + 1}"]`),
    ].map(c => c.getBoundingClientRect());
    const text = Math.max(
      ...[...document.querySelectorAll(`.col[data-k="${r.cur}"] .ln, .col[data-k="${r.cur + 1}"] .ln`)].map(
        l => l.getBoundingClientRect().bottom,
      ),
    );
    return {
      cols: cols.map(c => c.left + c.width / 2),
      nums: [...document.querySelectorAll('.pn')].map(n => {
        const b = n.getBoundingClientRect();
        return b.left + b.width / 2;
      }),
      text,
      H: innerHeight,
      colW: M.colW,
    };
  });
  geo.nums.forEach((x, i) => expect(Math.abs(x - geo.cols[i])).toBeLessThan(2));
  const line = p.getByRole('slider', { name: 'Place in the book' }),
    where = p.locator('.where');
  await expect(where).not.toBeVisible();
  expect(await line.evaluate(e => getComputedStyle(e).opacity)).toBe('0');
  // a page turned: still only the numbers
  await p.keyboard.press('ArrowRight');
  await settled(p);
  await expect(nums).toHaveText([String(k + 2), String(k + 3)]);
  await expect(where).not.toBeVisible();
  // the bar: the hairline where the numbers were, "N of Total" just below it, both between
  // the text's last line and the window's foot
  await p.mouse.move(640, 10);
  await expect(bar).not.toHaveClass(/away/);
  const N = await p.evaluate(() => (window as any).__typeset.reader.strip.N);
  await expect(where).toHaveText(`${k + 2}–${k + 3} of ${N}`);
  await expect(nums.first()).not.toBeVisible();
  await expect.poll(() => line.evaluate(e => getComputedStyle(e).opacity)).toBe('1');
  const [lb, wb] = [(await line.boundingBox())!, (await where.boundingBox())!];
  const track = lb.y + lb.height / 2;
  expect(track).toBeGreaterThan(geo.text);
  expect(wb.y).toBeGreaterThan(track);
  expect(wb.y + wb.height).toBeLessThanOrEqual(geo.H);
  // the pointer near the foot shows them too (where a mouse goes to drag the line)
  await p.mouse.move(640, 400);
  await expect(bar).toHaveClass(/away/);
  await p.mouse.move(640, geo.H - 20);
  await expect(where).toBeVisible();
});

test('a long way through the progress line: dragged, it names the page; let go, the reader goes there', async ({
  page: p,
}) => {
  await openSample(p);
  const line = p.getByRole('slider', { name: 'Place in the book' });
  const N = await p.evaluate(() => (window as any).__typeset.reader.strip.N);
  await line.fill(String(Math.floor(N / 2)));
  await expect.poll(() => cur(p)).toBeGreaterThan(N / 2 - 3);
  await expect.poll(() => place(p)).toMatch(new RegExp(`^Page ${Math.floor(N / 2) + 1} of ${N}, `));
});

test('after a trip the way back is offered, by the bar or ⌫, until one reads on', async ({ page: p }) => {
  await openSample(p);
  await p.evaluate(() => (window as any).__typeset.reader.jump(60));
  await settled(p);
  await toChapterOne(p);
  await expect.poll(() => cur(p)).toBeLessThan(18);
  const k = await cur(p);
  await p.mouse.move(640, 20);
  await expect(p.locator('.bar').getByRole('button', { name: 'Back to page 61' })).toBeVisible();
  await p.locator('.stage').focus();
  await p.keyboard.press('Backspace');
  await expect.poll(() => cur(p)).toBe(60);
  await expect(p.locator('.bar .return')).toHaveCount(0);
  // a trip, then a page read on: the way back goes, and ⌫ does nothing
  await toChapterOne(p);
  await expect.poll(() => cur(p)).toBe(k);
  await p.keyboard.press('ArrowRight');
  await expect.poll(() => cur(p)).toBe(k + 1);
  await expect(p.locator('.bar .return')).toHaveCount(0);
  await p.keyboard.press('Backspace');
  await p.waitForTimeout(300);
  expect(await cur(p)).toBe(k + 1);
});

test('a trackpad: a swipe turns one page, however long it and its momentum run; a new swipe turns the next', async ({
  page: p,
}) => {
  await openSample(p);
  await p.evaluate(() => (window as any).__typeset.reader.jump(20));
  const rest = async () => {
    await p.waitForTimeout(80);
    await settled(p);
    await p.waitForTimeout(300);
    return cur(p);
  };
  // wheel events as a trackpad sends them, 16 ms apart (`legacy`: the engine's wheelDelta
  // along with them, as Safari's and Chrome's on a Mac have it, three times the delta)
  const swipe = (deltas: number[], legacy = false) =>
    p.evaluate(
      async ([deltas, legacy]) => {
        const st = (window as any).__typeset.reader.stage as HTMLElement;
        for (const d of deltas) {
          const e = new WheelEvent('wheel', { deltaY: d, deltaMode: 0, bubbles: true, cancelable: true });
          if (legacy) Object.defineProperty(e, 'wheelDeltaY', { value: -3 * d });
          st.dispatchEvent(e);
          await new Promise(r => setTimeout(r, 16));
        }
      },
      [deltas, legacy] as [number[], boolean],
    );
  // momentum as it comes: falling slowly, a value often twice, for a second and more (a
  // flick's runs to thousands of pixels: several columns, followed one to one)
  const tail = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => Math.max(1, +(from * 0.97 ** Math.floor(i / 2)).toFixed(1)));
  const k0 = await cur(p);
  // a Mac's swipe and a second of its momentum: one page
  await swipe([1.5, 4.2, 9.8, 18.4, 27.1, 33.6, ...tail(31, 60)], true);
  expect(await rest()).toBe(k0 + 1);
  // a laptop's, in whole steps of 20 px and more (Chrome on Linux): one page, not one an event
  await swipe([3, 8, 15, 24, 33, 41, 47, 50, ...tail(50, 70).map(Math.round)]);
  expect(await rest()).toBe(k0 + 2);
  // the fingers pushing again in the momentum of the last: the next page
  await swipe([2, 7, 16, 28, 36, ...tail(34, 14), 4, 11, 24, 37, 41, ...tail(38, 30)], true);
  expect(await rest()).toBe(k0 + 4);
  // back the other way
  await swipe([-2, -9, -21, -34, -30, ...tail(-26, 20)], true);
  expect(await rest()).toBe(k0 + 3);
  // a brush: nothing
  await swipe([1.2, 2.1, 1.4]);
  expect(await rest()).toBe(k0 + 3);
  // one that begins as a wheel's notch would (a whole 120): its next events say otherwise
  await swipe([120, 96, 140, 131, ...tail(120, 50).map(Math.round)]);
  expect(await rest()).toBe(k0 + 4);
});

test('past either end a drag meets a band: the sheet goes a little way and no further, and follows the hand back', async ({
  page: p,
}) => {
  await openSample(p);
  const r = await p.evaluate(() => {
    const rd = (window as any).__typeset.reader,
      m = rd.motion,
      ends = [m.host.min(), m.host.max()];
    const out: { most: number; back: number }[] = [];
    for (const [end, d] of [
      [ends[1], 1],
      [ends[0], -1],
    ]) {
      rd.jump(end);
      m.directStart();
      let most = 0;
      for (let i = 0; i < 40; i++) {
        m.directBy(d);
        most = Math.max(most, Math.abs(m.p - end));
      }
      for (let i = 0; i < 40; i++) m.directBy(-d);
      out.push({ most, back: Math.abs(m.p - end) });
      m.directEnd();
    }
    return out;
  });
  for (const { most, back } of r) {
    expect(most).toBeGreaterThan(0.3);
    expect(most).toBeLessThanOrEqual(0.6);
    expect(back).toBeLessThan(1e-6);
  }
});

test('a mouse wheel notch is one turn', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  const k0 = await cur(p);
  await p.mouse.move(640, 400);
  await p.mouse.wheel(0, 100);
  await expect.poll(() => cur(p)).toBe(k0 + 1);
  await settled(p);
  expect(await cur(p)).toBe(k0 + 1);
});

test('a drag moves the sheet one to one and settles on the column nearest where it let go', async ({ page: p }) => {
  // (a mouse takes the sheet from beside the text; in the text it selects)
  await openSample(p);
  await toChapterOne(p);
  const k0 = await cur(p);
  const P = await p.evaluate(() => (window as any).__typeset.reader.M.P);
  const drag = async (cols: number) => {
    await p.mouse.move(1260, 500);
    await p.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await p.mouse.move(1260 - (i * P * cols) / 10, 500);
      await p.waitForTimeout(16);
    }
    const mid = await p.evaluate(() => (window as any).__typeset.reader.motion.p);
    await p.waitForTimeout(120); // the hand pauses, then lets go
    await p.mouse.up();
    await settled(p);
    return mid;
  };
  expect((await drag(0.3)) - k0).toBeCloseTo(0.3, 1);
  expect(await cur(p)).toBe(k0); // 0.3 of the way: stays
  expect((await drag(0.7)) - k0).toBeCloseTo(0.7, 1);
  expect(await cur(p)).toBe(k0 + 1); // 0.7 of the way: the next column
});

test('with less motion, a tap moves at once and a drag let go finishes briefly rather than snapping', async ({
  page: p,
}) => {
  await openSample(p);
  await toChapterOne(p);
  await p.evaluate(() => {
    (window as any).__typeset.settings.motion = 'reduce';
  });
  const k0 = await cur(p);
  // a key: at once, no frames between
  await p.keyboard.press('ArrowRight');
  expect(await p.evaluate(() => (window as any).__typeset.reader.motion.p)).toBe(k0 + 1);
  // a drag of 0.7 let go: carried to the next column over a few frames, not in one
  const P = await p.evaluate(() => (window as any).__typeset.reader.M.P);
  await p.mouse.move(1260, 500);
  await p.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await p.mouse.move(1260 - (i * P * 0.7) / 10, 500);
    await p.waitForTimeout(16);
  }
  // every frame's position from just before the hand lets go
  await p.evaluate(() => {
    const m = (window as any).__typeset.reader.motion,
      out: number[] = [];
    (window as any).trail = out;
    const f = () => {
      out.push(m.p);
      if (out.length < 40) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  await p.mouse.up();
  await settled(p);
  const trail: number[] = await p.evaluate(() => (window as any).trail);
  expect(await cur(p)).toBe(k0 + 2);
  // in between: positions short of the end (not a single jump)
  const between = trail.filter(x => x > k0 + 1.72 && x < k0 + 1.99);
  expect(between.length).toBeGreaterThan(1);
  // (and quickly: the settle is a few frames, not a turn's length)
  expect(trail.length).toBeLessThan(15);
});

test('a gesture during a turn waits; key repeat is ignored', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  const k0 = await cur(p);
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('ArrowRight');
  // one turn, then at most one waiting gesture
  await expect.poll(() => cur(p)).toBe(k0 + 2);
  await settled(p);
  expect(await cur(p)).toBe(k0 + 2);
  // a repeated keydown (a key held by the system's own repeat) asks nothing of the motion
  const [before, after, moving] = await p.evaluate(() => {
    const m = (window as any).__typeset.reader.motion,
      t = m.target;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true }));
    return [t, m.target, m.moving];
  });
  expect([after, moving]).toEqual([before, false]);
});

test('holding a key glides and settles on a whole column', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  const k0 = await cur(p);
  await p.keyboard.down('ArrowRight');
  await p.waitForTimeout(1800);
  await p.keyboard.up('ArrowRight');
  await settled(p);
  const k1 = await cur(p);
  expect(k1 - k0).toBeGreaterThanOrEqual(2);
  const pos = await p.evaluate(() => (window as any).__typeset.reader.motion.p);
  expect(pos).toBe(k1);
});

test('a highlight over lines set close (the tightest spacing) is a band to each line, none over the next: never a darker stripe where two overlap', async ({
  page: p,
}) => {
  await openSample(p);
  await p.evaluate(() => {
    const v = (window as any).__typeset;
    v.setOption(v.themeById('book'), 'lineSpacing', 1);
    v.reader.settingsChanged('layout');
  });
  await p.waitForFunction(() => {
    const M = (window as any).__typeset.reader.M;
    return M.lh === Math.round(M.fs);
  });
  await laidOut(p);
  await toChapterOne(p);
  await p.keyboard.press('v');
  await p.keyboard.press('h');
  await p.keyboard.press('Escape');
  const k = await cur(p);
  await expect(p.locator(`.col[data-k="${k}"] mark.hl`).nth(2)).toBeVisible();
  // each line's band (drawn behind it) shorter than the lines are apart, by a visible gap
  const bands = await p.evaluate(
    k =>
      [...document.querySelectorAll(`.col[data-k="${k}"] mark.hl`)].map(m =>
        parseFloat(getComputedStyle(m, '::before').height),
      ),
    k,
  );
  const lh = await p.evaluate(() => (window as any).__typeset.reader.M.lh as number);
  expect(bands.length).toBeGreaterThan(2);
  for (const h of bands) expect(h).toBeLessThanOrEqual(lh - 1.5);
});

test('a double click selects the word under it; V then H highlights a paragraph', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  const k = await cur(p);
  const box = await p.locator(`.col[data-k="${k}"] .ln[data-b]`).nth(8).boundingBox();
  await p.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(p.locator('.chip-pop')).toBeVisible();
  const word = await p.evaluate(() => {
    const r = (window as any).__typeset.reader,
      c = (window as any).__typeset.ui.chip;
    return r.marking.selText(c.sel);
  });
  expect(word).toMatch(/^[\p{L}’'-]+[.,;:!?”’)]*$/u); // one whole word (with its closing punctuation)
  await p.keyboard.press('Escape');
  await p.keyboard.press('v');
  await p.keyboard.press('h');
  await p.keyboard.press('Escape');
  await expect.poll(() => p.evaluate(() => (window as any).__typeset.reader.ann.list.length)).toBe(1);
  await expect(p.locator(`.col[data-k="${k}"] mark.hl`).first()).toBeVisible();
});

test('resize and type size keep the sentence', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  await p.keyboard.press('ArrowRight');
  await settled(p);
  const a = JSON.parse(await anchor(p));
  await p.setViewportSize({ width: 900, height: 700 });
  await laidAt(p, 900);
  const b = JSON.parse(await anchor(p));
  expect(b.key).toBe(a.key);
  const fs = await p.evaluate(() => (window as any).__typeset.reader.M.fs);
  await p.keyboard.press('s');
  await p.keyboard.press('=');
  await p.keyboard.press('=');
  await p.keyboard.press('Escape');
  await fsChanged(p, fs);
  const c = JSON.parse(await anchor(p));
  expect(c.key).toBe(a.key);
});

test("Help with a keyboard draws every key, in a window made narrow too (a window's width is not a touch screen)", async ({
  page: p,
}) => {
  await openSample(p);
  await p.setViewportSize({ width: 600, height: 800 });
  await p.keyboard.press('?');
  await expect(p.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
  const hidden = await p
    .locator('.sheet kbd')
    .evaluateAll(ks => ks.filter(k => !k.getBoundingClientRect().width).map(k => k.textContent));
  expect(hidden).toEqual([]);
});

test('dark paper, help, reset', async ({ page: p }) => {
  await openSample(p);
  await p.keyboard.press('s');
  await p.keyboard.press('p');
  await p.keyboard.press('p');
  await expect(p.locator('html')).toHaveAttribute('data-theme', 'dark');
  await p.keyboard.press('p');
  await expect(p.locator('html')).not.toHaveAttribute('data-theme', 'dark');
  await p.keyboard.press('Escape');
  await p.keyboard.press('?');
  await expect(p.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
  // each row its keys, drawn as keys, and a few words: nothing to read through
  const rows = await p.locator('.sheet .row').evaluateAll(rs =>
    rs.map(r => ({
      keys: [...r.querySelectorAll('.keys > *')].every(k => k.matches('kbd, .or, .to')),
      caps: r.querySelectorAll('.keys kbd').length,
      words: (r.querySelector('.what')?.textContent ?? '').trim().split(/\s+/).length,
    })),
  );
  expect(rows.length).toBeGreaterThan(20);
  expect(rows.filter(r => !r.keys || !r.caps || r.words > 5)).toEqual([]);
  await expect(p.locator('.sheet p')).toHaveCount(0);
});

test('plain-text import', async ({ page: p }) => {
  await p.goto('/');
  const txt =
    'Title: A Small Test\nAuthor: Nobody\n\nCHAPTER I\n\nThe First\n\n' +
    Array(30).fill('It was a "quiet" day -- the kind that _rarely_ comes. '.repeat(6)).join('\n\n') +
    '\n\nCHAPTER II\n\nThe Second\n\n' +
    Array(25).fill('Another paragraph of plain words for testing. '.repeat(5)).join('\n\n');
  await p.setInputFiles('input[type=file]', {
    name: 'small-test.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(txt),
  });
  await expect(p.locator('.book .t', { hasText: 'A Small Test' })).toBeVisible();
  await p.locator('.book', { hasText: 'A Small Test' }).focus();
  await p.keyboard.press('x');
  await p.keyboard.press('y');
  await expect(p.locator('.book .t', { hasText: 'A Small Test' })).toHaveCount(0);
});

test('a paragraph written right to left is set from the right edge', async ({ page: p }) => {
  await p.goto('/');
  const he = 'בראשית ברא אלהים את השמים ואת הארץ. והארץ היתה תהו ובהו וחשך על פני תהום ורוח אלהים מרחפת על פני המים. ';
  const txt =
    'Title: Bereshit\nAuthor: Nobody\n\nCHAPTER I\n\n' +
    Array(12).fill(he.repeat(4)).join('\n\n') +
    '\n\n' +
    'A paragraph in English among them, set as before. '.repeat(6);
  await p.setInputFiles('input[type=file]', { name: 'bereshit.txt', mimeType: 'text/plain', buffer: Buffer.from(txt) });
  await p.locator('.book', { hasText: 'Bereshit' }).click();
  await p.waitForFunction(() => {
    const r = (window as any).__typeset.reader;
    return r.strip && r.strip.layouts.size === r.book.sections.length;
  });
  const r = await p.evaluate(() => {
    const rd = (window as any).__typeset.reader;
    const out = { rtl: 0, ltr: 0, over: 0, misplaced: [] as string[] };
    for (let k = 0; k < rd.strip.N; k++) {
      rd.jump(k);
      for (const ln of document.querySelectorAll<HTMLElement>(`.col[data-k="${k}"] .ln:not(.brk)`)) {
        if ((window as any).__typeset.residual(ln) > 0.5) out.over++;
        const rtl = ln.classList.contains('rtl');
        if (rtl) out.rtl++;
        else out.ltr++;
        if (rtl !== /[\u0590-\u05FF]/.test(ln.textContent!)) out.misplaced.push(ln.textContent!.slice(0, 20));
        // its words end at the box's right edge (the indent, if any, on that side)
        if (rtl) {
          const box = ln.getBoundingClientRect(),
            range = document.createRange();
          range.selectNodeContents(ln);
          if (Math.abs(range.getBoundingClientRect().right - box.right) > 1)
            out.misplaced.push('not at the right: ' + ln.textContent!.slice(0, 20));
        }
      }
    }
    return out;
  });
  expect(r.rtl).toBeGreaterThan(30);
  expect(r.ltr).toBeGreaterThan(0);
  expect(r.misplaced).toEqual([]);
  expect(r.over).toBe(0);
});

test('a screen reader hears the page in view as a document, not as lines', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  await turn(p, 'ArrowRight');
  const r = await p.evaluate(() => {
    const rd = (window as any).__typeset.reader,
      said = document.querySelector('.spoken')!;
    const words = (t: string) => t.replace(/-$/, '').replace(/\s+/g, ' ').trim();
    // the lines in view, each found in what is said (a hyphenated word whole)
    const inView: string[] = [],
      beside: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.col')) {
      const k = +el.dataset.k!,
        lines = [...el.querySelectorAll<HTMLElement>('.ln:not(.brk)')]
          .map(l => words(l.textContent!))
          .filter(t => t.length > 30);
      (k >= rd.cur && k < rd.cur + rd.M.N ? inView : beside).push(...lines);
    }
    const text = said.textContent!.replace(/\s+/g, ' ');
    return {
      paragraphs: said.querySelectorAll('p').length,
      missing: inView.filter(l => !text.includes(l.split(' ').slice(1, -1).join(' '))),
      besideSaid: beside.filter(l => text.includes(l)).length,
      textHidden: [...document.querySelectorAll('.col:not(.leafcol)')].every(
        c => c.getAttribute('aria-hidden') === 'true',
      ),
      inView: inView.length,
    };
  });
  expect(r.inView).toBeGreaterThan(20);
  expect(r.paragraphs).toBeGreaterThan(0);
  expect(r.missing).toEqual([]);
  expect(r.besideSaid).toBe(0);
  expect(r.textHidden).toBe(true);
  await expect(p.locator('.stage')).toMatchAriaSnapshot(`- region:\n  - paragraph`);
});

test('high contrast: what is chosen is ringed, the filled background gone', async ({ page: p, browserName }) => {
  test.skip(browserName !== 'chromium', 'forced colours are emulated in Chromium');
  await p.emulateMedia({ forcedColors: 'active' });
  await openSample(p);
  await p.keyboard.press('s');
  const ring = await p
    .locator('.th[role=radio][aria-checked=true]')
    .first()
    .evaluate(e => getComputedStyle(e).outlineStyle);
  expect(ring).toBe('solid');
});

test('every line fits its box (Thursday)', async ({ page: p }) => {
  await openSample(p);
  const r = await p.evaluate(() => {
    const rd = (window as any).__typeset.reader;
    let over = 0,
      lines = 0;
    for (let k = 0; k < rd.strip.N; k++) {
      rd.jump(k);
      for (const ln of document.querySelectorAll(`.col[data-k="${k}"] .ln:not(.brk)`)) {
        lines++;
        if ((window as any).__typeset.residual(ln) > 0.5) over++;
      }
    }
    return { lines, over };
  });
  expect(r.lines).toBeGreaterThan(5000);
  expect(r.over).toBe(0);
});

test('Space turns the whole set in view; an arrow moves one column', async ({ page: p }) => {
  await p.setViewportSize({ width: 1600, height: 900 });
  await openSample(p);
  await toChapterOne(p);
  expect(await p.evaluate(() => (window as any).__typeset.reader.M.N)).toBe(2);
  const k0 = await cur(p);
  await turn(p, 'Space');
  expect(await cur(p)).toBe(k0 + 2);
  await turn(p, 'ArrowRight');
  expect(await cur(p)).toBe(k0 + 3);
  await turn(p, 'Shift+Space');
  expect(await cur(p)).toBe(k0 + 1);
});

test('C cycles the columns in view', async ({ page: p }) => {
  await p.setViewportSize({ width: 1600, height: 900 });
  await openSample(p);
  await p.keyboard.press('c'); // auto → one
  await expect.poll(() => p.evaluate(() => (window as any).__typeset.reader.M.N)).toBe(1);
  await p.keyboard.press('c'); // one → two
  await expect.poll(() => p.evaluate(() => (window as any).__typeset.reader.M.N)).toBe(2);
});

test('in a book sent by link, the chip offers reactions for its writer; 5 to 8 give one, again takes it off', async ({
  page: p,
}) => {
  await openSample(p);
  // without a link: no reactions
  await toChapterOne(p);
  const k = await cur(p);
  const hold = async (n: number) => {
    const box = (await p.locator(`.col[data-k="${k}"] .ln[data-b]`).nth(n).boundingBox())!;
    const y = box.y + box.height / 2;
    await p.mouse.move(box.x + 20, y);
    await p.mouse.down();
    await p.mouse.move(box.x + 200, y, { steps: 6 });
    await p.mouse.up();
    await expect(p.locator('.chip-pop')).toBeVisible();
  };
  await hold(3);
  await expect(p.locator('.chip-pop .reacts')).toHaveCount(0);
  await p.keyboard.press('Escape');
  // as if it came by link
  await p.evaluate(() => {
    const v = (window as any).__typeset;
    v.kv.set('joined.' + v.reader.book.id, { id: 'x', key: 'y' });
  });
  await hold(5);
  await expect(p.locator('.chip-pop .reacts').getByRole('button')).toHaveCount(4);
  // (said who they are for: the writer who sent the book)
  await expect(p.locator('.chip-pop .reacts')).toContainText('For the writer');
  await p.keyboard.press('6');
  await expect(p.locator('.toast')).toContainText('Confused here');
  expect(await p.evaluate(() => (window as any).__typeset.reader.ann.list.map((a: any) => a.react))).toEqual([
    'confused',
  ]);
  // its highlight's chip shows it chosen; the same key again takes it off
  await p.locator(`.col[data-k="${k}"] mark.hl`).first().click();
  await expect(p.locator('.chip-pop .reacts [aria-pressed="true"]')).toHaveText(/Confused/);
  await p.keyboard.press('6');
  expect(await p.evaluate(() => (window as any).__typeset.reader.ann.list.map((a: any) => a.react ?? null))).toEqual([
    null,
  ]);
});

test('a mouse selects as in any document: the menu above, 2 highlights it, across columns too', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  const k = await cur(p);
  // a drag along a line, at once (no hold): the browser's own selection, and the sheet stays
  const ln = p.locator(`.col[data-k="${k}"] .ln[data-b]`).nth(4);
  const box = (await ln.boundingBox())!;
  const y = box.y + box.height / 2;
  await p.mouse.move(box.x + 4, y);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width * 0.6, y, { steps: 8 });
  await p.mouse.up();
  expect(await cur(p)).toBe(k);
  const chosen = await p.evaluate(() => getSelection()!.toString());
  expect(chosen.length).toBeGreaterThan(10);
  await expect(p.locator('.chip-pop')).toBeVisible();
  // (copying a selection is the system's; the menu does not offer it)
  expect(await p.locator('.chip-pop').getByRole('button', { name: 'Copy' }).count()).toBe(0);
  await p.keyboard.press('2');
  await expect(p.locator('.chip-pop')).toHaveCount(0);
  const ann = await p.evaluate(() =>
    (window as any).__typeset.reader.ann.list.map((a: any) => ({ quote: a.quote, color: a.color })),
  );
  // (a highlight takes whole words: a word cut short at either end is taken whole)
  expect(ann).toHaveLength(1);
  expect(ann[0].color).toBe(2);
  expect(ann[0].quote).toContain(chosen.trim());
  expect(await p.evaluate(() => getSelection()!.isCollapsed)).toBe(true);
  // a highlight's own menu copies it with the book's reference
  await p.locator(`.col[data-k="${k}"] mark.hl`).first().click();
  await expect(p.locator('.chip-pop').getByRole('button', { name: 'Copy' })).toBeVisible();
  await p.keyboard.press('Escape');
  // the page moving takes the menu and the selection with it
  await p.mouse.move(box.x + 4, y);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width * 0.5, y, { steps: 6 });
  await p.mouse.up();
  await expect(p.locator('.chip-pop')).toBeVisible();
  await p.mouse.wheel(0, 100);
  await expect(p.locator('.chip-pop')).toHaveCount(0);
  expect(await p.evaluate(() => getSelection()!.isCollapsed)).toBe(true);
  await settled(p);
  await p.keyboard.press('ArrowLeft');
  await settled(p);
  expect(await cur(p)).toBe(k);
  // from the foot of one column to the head of the next: the text between, in order, even
  // when the earlier column was built after the later one (arriving there backwards)
  await p.evaluate(k => (window as any).__typeset.reader.jump(k + 8), k);
  await settled(p);
  for (let i = 0; i < 8; i++) {
    await p.keyboard.press('ArrowLeft');
    await settled(p);
  }
  expect(await cur(p)).toBe(k);
  const [last, first] = [
    p.locator(`.col[data-k="${k}"] .ln[data-b]`).last(),
    p.locator(`.col[data-k="${k + 1}"] .ln[data-b]`).first(),
  ];
  const [a, z] = [(await last.boundingBox())!, (await first.boundingBox())!];
  await p.mouse.move(a.x + a.width * 0.5, a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(z.x + z.width * 0.4, z.y + z.height / 2, { steps: 10 });
  await p.mouse.up();
  const across = await p.evaluate(() => getSelection()!.toString());
  const [tail, head] = await Promise.all([last.textContent(), first.textContent()]);
  const i = across.indexOf(tail!.trim().slice(-6)),
    j = across.indexOf(head!.trim().slice(0, 6));
  expect(i, across).toBeGreaterThanOrEqual(0);
  expect(j, across).toBeGreaterThan(i);
  await expect(p.locator('.chip-pop')).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(p.locator('.chip-pop')).toHaveCount(0);
});

test('a drag selects; 2 highlights it, whole words; N adds a note; the notebook lists and filters it', async ({
  page: p,
}) => {
  await openSample(p);
  await toChapterOne(p);
  // a drag along a line in the focus column, from inside a word to inside another
  const k = await cur(p);
  const box = await p.locator(`.col[data-k="${k}"] .ln[data-b]`).nth(3).boundingBox();
  const y = box!.y + box!.height / 2;
  await p.mouse.move(box!.x + 20, y);
  await p.mouse.down();
  await p.mouse.move(box!.x + 260, y, { steps: 8 });
  await p.mouse.up();
  await expect(p.locator('.chip-pop')).toBeVisible();
  await p.keyboard.press('2');
  // the highlight takes the words the drag began and ended in, whole
  const quote = await p.evaluate(() => (window as any).__typeset.reader.ann.list[0].quote as string);
  expect(quote).toMatch(/^[\p{L}“‘]/u);
  expect(quote).toMatch(/[\p{L}’”.,;:!?]$/u);
  expect(quote.length).toBeGreaterThan(8);
  await expect(p.locator(`.col[data-k="${k}"] mark.hl.h2`).first()).toBeVisible();
  // tap the highlight: its chip; N: a note
  await p.locator(`.col[data-k="${k}"] mark.hl`).first().click();
  await expect(p.locator('.chip-pop')).toBeVisible();
  await p.keyboard.press('n');
  await p.keyboard.type('Gregory is all paradox.');
  await p.keyboard.press('Control+Enter');
  await expect(p.locator(`.col[data-k="${k}"] mark.hl.nt`)).toHaveCount(1);
  // the paragraph picker highlights from the keyboard; a whole-paragraph highlight absorbs
  // the one inside it and keeps its note
  await p.keyboard.press('v');
  await p.keyboard.press('h');
  await p.keyboard.press('Escape');
  const all = await p.evaluate(() =>
    (window as any).__typeset.reader.ann.list.map((a: any) => ({ len: a.e - a.s, note: a.note })),
  );
  expect(all.length).toBe(1);
  expect(all[0].len).toBeGreaterThan(500);
  expect(all[0].note).toBe('Gregory is all paradox.');
  // the highlights, beside the contents
  await p.keyboard.press('m');
  await expect(p.locator('.contents')).toBeVisible();
  await p.getByRole('tab', { name: 'Highlights' }).click();
  await expect(p.locator('.contents .item.ann')).toHaveCount(1);
  const filter = p.getByLabel('Filter the highlights');
  await filter.fill('no such words');
  await expect(p.locator('.contents .item.ann')).toHaveCount(0);
  await filter.fill('paradox');
  await expect(p.locator('.contents .item.ann')).toHaveCount(1);
  await expect(p.locator('.contents .item .note')).toHaveText('Gregory is all paradox.');
});

test('only the spread shows; the bar hides and returns without moving the text', async ({ page: p }) => {
  await p.setViewportSize({ width: 1600, height: 900 });
  await openSample(p);
  await toChapterOne(p);
  const g = await p.evaluate(() => {
    const M = (window as any).__typeset.reader.M;
    return { N: M.N, x0: M.x0, right: M.W - M.x0 - M.focusW, G: M.G };
  });
  expect(g.N).toBe(2);
  expect(Math.abs(g.x0 - g.right)).toBeLessThan(2); // balanced margins
  // the paper at the sides covers everything outside the spread
  const curtain = await p.locator('.curtain.l').boundingBox();
  expect(curtain!.width).toBeCloseTo(g.x0 - g.G / 2, 0);
  // the bar steps aside while reading, comes back at the top, and never moves the text
  await p.mouse.move(800, 500);
  await expect(p.locator('.bar')).toHaveClass(/away/, { timeout: 10_000 });
  const before = await p.locator('.col .ln').first().boundingBox();
  await p.mouse.move(800, 20);
  await expect(p.locator('.bar')).not.toHaveClass(/away/);
  const after = await p.locator('.col .ln').first().boundingBox();
  expect(after!.y).toBe(before!.y);
  expect(after!.x).toBe(before!.x);
});

/** Lays the book out again with the current settings and counts lines that overflow. */
async function fitAll(p: Page) {
  return p.evaluate(async () => {
    const v = (window as any).__typeset,
      rd = v.reader;
    await rd.settingsChanged('layout');
    while (rd.strip.layouts.size !== rd.book.sections.length) await new Promise(r => setTimeout(r, 30));
    await new Promise(r => setTimeout(r, 60));
    v.resetFitStats();
    let over = 0,
      lines = 0,
      worst = 0;
    for (let k = 0; k < rd.strip.N; k++) {
      rd.jump(k);
      for (const ln of document.querySelectorAll(`.col[data-k="${k}"] .ln:not(.brk)`)) {
        lines++;
        const d = v.residual(ln);
        if (d > 0.5) {
          over++;
          worst = Math.max(worst, d);
        }
      }
    }
    // over: what a reader would see past the margin (must be none); corrected: lines the
    // press's model got wrong and the page brought back (its quality)
    return {
      lines,
      over,
      worst,
      corrected: v.fitStats.fixed,
      squeezed: v.fitStats.squeezed,
      font: getComputedStyle(document.querySelector('.ln')!).fontFamily,
    };
  });
}

for (const id of ['book', 'slate', 'linen', 'clear', 'warm', 'open']) {
  test(`every line fits in the ${id} theme`, async ({ page: p }) => {
    await openSample(p);
    await p.evaluate(t => {
      (window as any).__typeset.settings.theme = t;
    }, id);
    const r = await fitAll(p);
    expect(r.lines).toBeGreaterThan(4000);
    expect(r.over, JSON.stringify(r)).toBe(0);
    // the model itself is near perfect on its own fonts
    expect(r.corrected, JSON.stringify(r)).toBeLessThanOrEqual(r.lines / 1000);
  });
}

test("each theme its own size, a step of the reader's carried to every theme, and a face chosen in a theme keeps its size", async ({
  page: p,
}) => {
  await openSample(p);
  const sizeIn = async (theme: string) => {
    await p.evaluate(async t => {
      const v = (window as any).__typeset;
      v.settings.theme = t;
      await v.reader.settingsChanged('layout');
    }, theme);
    await expect
      .poll(() =>
        p.evaluate(() => {
          const r = (window as any).__typeset.reader;
          return r.M.fs === r.measure(undefined, r.appearance.wanted()).fs;
        }),
      )
      .toBe(true);
    return p.evaluate(() => (window as any).__typeset.reader.M.fs);
  };
  // (a desktop: each theme's phone size three steps up)
  const all = async () => {
    const o: Record<string, number> = {};
    for (const t of ['book', 'slate', 'linen', 'clear', 'warm', 'open']) o[t] = await sizeIn(t);
    return o;
  };
  expect(await all()).toEqual({ book: 16, slate: 20, linen: 20, clear: 20, warm: 19, open: 18 });
  // one step larger in Book, by the panel's key: every theme a step larger
  await sizeIn('book');
  await p.keyboard.press('s');
  await p.keyboard.press('=');
  await expect.poll(() => p.evaluate(() => (window as any).__typeset.reader.M.fs)).toBe(17);
  await p.keyboard.press('Escape');
  expect(await all()).toEqual({ book: 17, slate: 21, linen: 21, clear: 21, warm: 20, open: 19 });
  // Book in Linen's face: Book's size still
  await sizeIn('book');
  await p.evaluate(async () => {
    const v = (window as any).__typeset;
    v.setOption(v.themeById('book'), 'face', 'Charis');
    await v.reader.settingsChanged('layout');
  });
  await expect.poll(() => p.evaluate(() => (window as any).__typeset.reader.appearance.look.chain[0])).toBe('Charis');
  expect(await p.evaluate(() => (window as any).__typeset.reader.M.fs)).toBe(17);
});

test("a selection of a space alone (a justified line's wide one) is no text: no menu for it", async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  await p.keyboard.press('ArrowRight');
  await settled(p);
  // a space between two words of a full line, dragged across from edge to edge
  const at = await p.evaluate(() => {
    const r = (window as any).__typeset.reader;
    for (const ln of document.querySelectorAll<HTMLElement>(`.col[data-k="${r.cur}"] .ln[data-b]`)) {
      const t = [...ln.childNodes].find(n => n.nodeType === 3 && / \S/.test(n.textContent!)) as Text | undefined;
      if (!t) continue;
      const i = t.data.indexOf(' ', 2),
        range = document.createRange();
      range.setStart(t, i);
      range.setEnd(t, i + 1);
      const b = range.getBoundingClientRect();
      if (b.width > 3) return { l: b.left + 0.5, r: b.right - 0.5, y: b.top + b.height / 2 };
    }
    return null;
  });
  expect(at).not.toBeNull();
  await p.mouse.move(at!.l, at!.y);
  await p.mouse.down();
  await p.mouse.move(at!.r, at!.y, { steps: 4 });
  await p.mouse.up();
  expect(await p.evaluate(() => getSelection()!.toString())).toMatch(/^\s+$/);
  await p.waitForTimeout(400);
  await expect(p.locator('.chip-pop')).toHaveCount(0);
});

test('a contents row under the pointer, or read, keeps its quieter words readable (4.5:1 on its tint)', async ({
  page: p,
}) => {
  await openSample(p);
  // (a chapter read: its title in the quieter ink)
  await toChapterOne(p);
  await p.evaluate(() => (window as any).__typeset.reader.go(20));
  await p.keyboard.press('m');
  await expect(p.locator('.contents')).toBeVisible();
  const rows = p.locator('.contents .row', { has: p.locator('.p') });
  for (const i of [1, 3]) {
    await rows.nth(i).hover();
    await expect
      .poll(() => rows.nth(i).evaluate(r => getComputedStyle(r).backgroundColor))
      .not.toBe('rgba(0, 0, 0, 0)');
    expect(await access(p), `row ${i} under the pointer`).toEqual([]);
  }
});

test("a chapter opens with its head as the book wrote it, in the text's face, and the text begins on the row the press counted under it", async ({
  page: p,
}) => {
  await openSample(p);
  await toChapterOne(p);
  const head = await p.evaluate(() => {
    const r = (window as any).__typeset.reader,
      k = r.cur,
      col = document.querySelector<HTMLElement>(`.col[data-k="${k}"]`)!;
    const h = col.querySelector<HTMLElement>('.chead')!,
      lines = [...h.querySelectorAll<HTMLElement>('.hline')];
    const text = (col.querySelector('.ln[data-b]') as HTMLElement).getBoundingClientRect();
    const sl = r.strip.layouts.get(r.strip.itemAt(k).sec);
    const ui = getComputedStyle(document.documentElement).getPropertyValue('--f-ui');
    return {
      lines: lines.map(l => l.innerText.trim()),
      faces: [...new Set(lines.map(l => getComputedStyle(l).fontFamily))].map(f => f === ui.trim()),
      weights: [...new Set(lines.map(l => getComputedStyle(l).fontWeight))],
      inColumn: lines.every(l => {
        const b = l.getBoundingClientRect(),
          c = col.getBoundingClientRect();
        return b.left >= c.left - 1 && b.right <= c.right + 1;
      }),
      under: Math.max(...lines.map(l => l.getBoundingClientRect().bottom)) <= text.top + 1,
      textRow: Math.round((text.top - col.getBoundingClientRect().top) / r.M.lh),
      headRows: sl.headRows,
      label: h.querySelectorAll('.label').length,
    };
  });
  expect(head.lines).toEqual(['CHAPTER I.\nTHE TWO POETS OF SAFFRON PARK']);
  expect(head.faces).toEqual([false]);
  expect(head.weights).toEqual(['400']);
  expect(head).toMatchObject({ inColumn: true, under: true, label: 0 });
  expect(head.textRow).toBe(head.headRows);
  // and the first paragraph as the book sets it: indented an em, opening as written
  const first = await p.evaluate(() => {
    const r = (window as any).__typeset.reader,
      ln = document.querySelector<HTMLElement>(`.col[data-k="${r.cur}"] .ln[data-b]`)!;
    return { indent: Math.round(parseFloat(ln.style.left) * 10) / 10, em: r.M.fs, caps: !!ln.querySelector('.sc') };
  });
  expect(first).toEqual({ indent: first.em, em: first.em, caps: false });
});

test("Style's sliders show their values, each a change from the theme's design, the design in the middle", async ({
  page: p,
}) => {
  await openSample(p);
  await p.keyboard.press('s');
  await p.getByRole('button', { name: /^Style/ }).click();
  const sliders = await p.locator('.panel .row.sl').evaluateAll(rows =>
    rows.map(r => {
      const i = r.querySelector('input')!,
        v = r.querySelector('.val');
      return {
        label: r.querySelector('.lbl')!.textContent!.trim(),
        shown: v?.textContent?.trim() ?? null,
        mid: (+i.min + +i.max) / 2 === +i.value,
      };
    }),
  );
  // what a reader reads at a glance; the spacings and margins at 0, the middle
  expect(sliders).toEqual([
    { label: 'Line spacing', shown: '1.30', mid: false },
    { label: 'Letters', shown: '0%', mid: true },
    { label: 'Words', shown: '0%', mid: true },
    { label: 'Margins', shown: '0%', mid: true },
  ]);
});

test("margins: a page's a tenth of its width, each of the reader's steps (−10 to +10) narrows the line wherever the book is read", async ({
  page: p,
}) => {
  await openSample(p);
  const at = async (m: number) => {
    await p.evaluate(async m => {
      const v = (window as any).__typeset;
      v.setOption(v.themeById(v.settings.theme), 'margins', m);
      await v.reader.settingsChanged('layout');
    }, m);
    // (the page as the geometry has it: a layout for the window's new size may land after)
    await expect
      .poll(() =>
        p.evaluate(() => {
          const r = (window as any).__typeset.reader;
          return r.M.colW === r.measure(undefined, r.appearance.wanted()).colW;
        }),
      )
      .toBe(true);
    return p.evaluate(() => {
      const M = (window as any).__typeset.reader.M;
      return { colW: M.colW, x0: M.x0 };
    });
  };
  for (const [w, h] of [
    [390, 844],
    [900, 800],
    [1600, 900],
  ]) {
    await p.setViewportSize({ width: w, height: h });
    const lines = [];
    for (const m of [-10, -5, -1, 0, 1, 5, 10]) lines.push((await at(m)).colW);
    // every step narrows it, however wide the window (its line capped or not)
    for (let i = 1; i < lines.length; i++) expect(lines[i], `${w} wide: ${lines}`).toBeLessThan(lines[i - 1]);
  }
  // a phone, as Apple Books has it (measured: 13, 26, 40, 57, 75 pt a side on 402): a tenth of
  // its width, 8% of that a step, never under 30% of it
  await p.setViewportSize({ width: 402, height: 874 });
  const margins = [];
  for (const m of [-10, -5, 0, 5, 10]) margins.push((await at(m)).x0);
  expect(margins).toEqual([12, 24, 40, 56, 72]);
});
test('a page turned from a marked one shows no ribbon of its own, and B there marks it alone', async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  const ribbon = p.locator('.ribbon');
  await p.keyboard.press('b');
  await expect(ribbon).toHaveCount(1);
  // a turn as a reader makes it, a column at a time, until the marked page is out of view
  const cols = await p.evaluate(() => (window as any).__typeset.reader.M.N);
  for (let i = 0; i < cols; i++) await p.keyboard.press('ArrowRight');
  await settled(p);
  await expect(ribbon).toHaveCount(0);
  await p.keyboard.press('b');
  await expect(ribbon).toHaveCount(1);
  expect(await p.evaluate(() => (window as any).__typeset.reader.bookmarks.list.length)).toBe(2);
});

test('a bookmark is on the page it was made on (text or a picture) and goes when taken off; the title page offers none', async ({
  page: p,
}) => {
  await openSample(p);
  const got = [],
    want = [];
  for (let k = 0; k < 8; k++) {
    await p.evaluate(k => (window as any).__typeset.reader.go(k), k);
    await expect.poll(() => p.evaluate(() => (window as any).__typeset.reader.cur)).toBe(k);
    await settled(p);
    const r = await p.evaluate(() => {
      const rd = (window as any).__typeset.reader;
      rd.bookmarks.toggle();
      const on = rd.bookmarks.list.map((b: any) => rd.strip.resolve({ key: b.key, off: b.off }));
      const shown = rd.bookmarks.inView().length;
      rd.bookmarks.toggle();
      return { on, shown, left: rd.bookmarks.list.length };
    });
    got.push({ page: k + 1, ...r });
    want.push(k === 0 ? { page: 1, on: [], shown: 0, left: 0 } : { page: k + 1, on: [k], shown: 1, left: 0 });
  }
  expect(got).toEqual(want);
  // (no button for it, on the title page)
  await p.evaluate(() => (window as any).__typeset.reader.go(0));
  await expect.poll(() => p.evaluate(() => (window as any).__typeset.reader.cur)).toBe(0);
  await p.mouse.move(640, 20);
  await expect(p.locator('.bar').getByRole('button', { name: 'Bookmark this page' })).toHaveCount(0);
});

test("Book sets a book in its own leading, as Apple's Original does; the other themes keep theirs, a reader's own change wins, and a book that says none has Book's", async ({
  page: p,
}) => {
  test.setTimeout(120000);
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  await p.setInputFiles('input[type=file]', '../bench/fixtures/original.epub');
  await p.locator('.book[data-id]', { hasText: 'The Gate' }).click({ timeout: 60000 });
  await laidOut(p);
  // (the line's height as the geometry sets it, against the text's size)
  const at = (ls: number) =>
    p.waitForFunction(ls => {
      const M = (window as any).__typeset.reader.M;
      return M && M.lh === Math.round(M.fs * ls);
    }, ls);
  // (as the panel does: a change, then the text set again)
  const use = (fn: string) =>
    p.evaluate(fn => {
      const v = (window as any).__typeset,
        b = v.themeById('book');
      new Function('v', 'b', fn)(v, b);
      v.reader.settingsChanged('layout');
    }, fn);
  await at(1.5);
  await use("v.settings.theme = 'linen'");
  await at(1.55);
  await use("v.settings.theme = 'book'");
  await at(1.5);
  // the reader's own, over the book's; reset, the book's again
  await use("v.setOption(b, 'lineSpacing', 1.3)");
  await at(1.3);
  await use('v.resetOptions(b)');
  await at(1.5);
  // a book that sets no leading of its own: Book's
  await p.goto('/');
  await p.locator('.book[data-id]', { hasText: 'Thursday' }).click();
  await laidOut(p);
  await at(1.3);
});

test('a change made while the rest of the book is still being set goes first: the rest is asked of the engine a few chapters at a time, and a superseded change asks no more', async ({
  page: p,
}) => {
  await openSample(p);
  // every layout asked of the engine: its size, and how many chapters (none: all of them)
  await p.evaluate(() => {
    const r = (window as any).__typeset.reader,
      core = r.core,
      layout = core.layout.bind(core);
    (window as any).__asked = [];
    core.layout = (id: string, secs: number[], prm: { size: number }) => {
      (window as any).__asked.push([prm.size, secs.length]);
      return layout(id, secs, prm);
    };
  });
  const step = () =>
    p.evaluate(() => {
      const v = (window as any).__typeset;
      v.settings.step += 1;
      v.reader.settingsChanged('layout');
    });
  const asked = () => p.evaluate(() => (window as any).__asked as [number, number][]);
  // a step; once the engine is setting the rest of the book for it, another
  await step();
  await p.waitForFunction(() => (window as any).__asked.length >= 2);
  const first = (await asked())[0][0];
  await step();
  await p.evaluate(() => (window as any).__typeset.reader.whole);
  const all = await asked(),
    second = all.find(([s]) => s !== first)![0];
  const n = (await p.evaluate(() => (window as any).__typeset.reader.book.sections.length)) as number;
  // never the whole book at once
  expect(all.filter(([, k]) => k === 0 || k >= n)).toEqual([]);
  // the first change asks nothing once the second has begun
  const from = all.findIndex(([s]) => s === second);
  expect(all.slice(from).filter(([s]) => s === first)).toEqual([]);
  // and the second's book is whole
  expect(
    await p.evaluate(() => {
      const r = (window as any).__typeset.reader;
      return r.strip.layouts.size === r.book.sections.length && r.M.fs;
    }),
  ).toBe(second);
});

test("what waits for the whole book set (a page's goto, a test) is answered when a newer change sets it, not left waiting", async ({
  page: p,
}) => {
  await openSample(p);
  const answered = await p.evaluate(async () => {
    const v = (window as any).__typeset,
      r = v.reader;
    v.settings.step += 1;
    r.settingsChanged('layout');
    const waiting = r.whole;
    await new Promise(res => setTimeout(res, 30));
    v.settings.step += 1;
    r.settingsChanged('layout');
    return Promise.race([waiting.then(() => true), new Promise(res => setTimeout(() => res(false), 15000))]);
  });
  expect(answered).toBe(true);
});

test("Aa's theme cards show their faces together, once all have come, not one by one as each arrives", async ({
  page: p,
}) => {
  let release!: () => void;
  const held = new Promise<void>(r => (release = r));
  await p.route('**/fonts/Fraunces*', async r => {
    await held;
    await r.continue();
  });
  await openSample(p);
  await p.keyboard.press('s');
  const cards = p.locator('.themes .th .aa');
  await expect(cards).toHaveCount(6);
  // (each card's "Aa" as drawn: its colour's opacity)
  const shown = () =>
    cards.evaluateAll(els =>
      els.map(e => {
        const c = getComputedStyle(e).color;
        const a = c.match(/[\d.]+(?=\))/);
        return c.startsWith('rgba') || c.includes('/') ? parseFloat(a![0]) : 1;
      }),
    );
  // one face still on its way: none of them yet
  expect((await shown()).every(a => a === 0)).toBe(true);
  release();
  await expect.poll(async () => (await shown()).every(a => a === 1)).toBe(true);
});

test('the keyboard stays in Aa and in a dialog: Tab past the last control comes to the first, Shift+Tab before the first to the last', async ({
  page: p,
}) => {
  await openSample(p);
  // (within a container: its controls as Tab reaches them, and where the focus is among them)
  const wraps = async (sel: string) => {
    const edge = (end: 'first' | 'last') =>
      p.evaluate(
        ([sel, end]) => {
          const f = [
            ...document
              .querySelector(sel)!
              .querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([type=radio]), input[type=radio]:checked, [tabindex="0"]',
              ),
          ];
          (end === 'first' ? f[0] : f[f.length - 1]).focus();
          return f.length;
        },
        [sel, end] as const,
      );
    const at = () =>
      p.evaluate(sel => {
        const f = [
          ...document
            .querySelector(sel)!
            .querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([type=radio]), input[type=radio]:checked, [tabindex="0"]',
            ),
        ];
        return f.indexOf(document.activeElement as HTMLElement);
      }, sel);
    const n = await edge('last');
    await p.keyboard.press('Tab');
    expect(await at()).toBe(0);
    await edge('first');
    await p.keyboard.press('Shift+Tab');
    expect(await at()).toBe(n - 1);
  };
  await p.keyboard.press('s');
  await expect(p.locator('.panel')).toBeVisible();
  await wraps('.panel');
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await p.keyboard.press('?');
  await expect(p.locator('.sheet')).toBeVisible();
  await wraps('.sheet');
});

test("the book's last page: Finis, its title, its words counted, and nothing more", async ({ page: p }) => {
  await openSample(p);
  await p.evaluate(() => {
    const r = (window as any).__typeset.reader;
    r.jump(r.strip.N - 1);
  });
  await settled(p);
  const end = p.locator('.leaf.colophon');
  await expect(end).toBeVisible();
  const words = await p.evaluate(() => (window as any).__typeset.reader.book.words as number);
  expect(await end.locator('p').allInnerTexts()).toEqual([
    'Finis',
    'The Man Who Was Thursday',
    `${words.toLocaleString('en-GB')} words`,
  ]);
});

test("a book's own head is set where the book sets it: a small press's at the column's start, a Gutenberg book's centred", async ({
  page: p,
}) => {
  test.setTimeout(120000);
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  await p.setInputFiles('input[type=file]', '../bench/fixtures/original.epub');
  await p.locator('.book[data-id]', { hasText: 'The Gate' }).click({ timeout: 60000 });
  await p.waitForFunction(() => {
    const r = (window as any).__typeset.reader;
    return r.book?.title === 'The Gate' && r.strip && r.strip.layouts.size === r.book.sections.length;
  });
  await laidOut(p);
  // (the first column with a head of the book's own, and where its line sits in the column)
  const at = async () => {
    for (let k = 0; k < 6; k++) {
      await p.evaluate(k => (window as any).__typeset.reader.jump(k), k);
      await settled(p);
      const x = await p.evaluate(k => {
        const c = document.querySelector(`.col[data-k="${k}"]`),
          l = c?.querySelector('.chead.own .hline');
        if (!c || !l) return null;
        const cr = c.querySelector('.chead')!.getBoundingClientRect(),
          r = l.getBoundingClientRect();
        return [r.left - cr.left, cr.right - r.right].map(Math.round);
      }, k);
      if (x) return x;
    }
    return null;
  };
  const [before, after] = (await at())!;
  expect(before).toBeLessThanOrEqual(1);
  expect(after).toBeGreaterThan(40);
  // the credit under it set ragged, as the book sets it, in a justified text; then its
  // rule, a third of the column at its start
  const k0 = await cur(p);
  expect(
    await p.evaluate(k => {
      const c = document.querySelector(`.col[data-k="${k}"]`)!,
        r = c.querySelector('.trule');
      if (!r) return null;
      const cw = c.querySelector('.chead')!.getBoundingClientRect(),
        rr = r.getBoundingClientRect();
      return [Math.round(rr.left - cw.left), Math.round((rr.width / cw.width) * 10) / 10];
    }, k0),
  ).toEqual([0, 0.3]);
  expect(
    await p.evaluate(k => {
      const ls = [...document.querySelectorAll(`.col[data-k="${k}"] .ln`)];
      const credit = ls.find(l => l.textContent!.startsWith('Set for'));
      return [credit?.classList.contains('j'), ls.some(l => l.classList.contains('j'))];
    }, k0),
  ).toEqual([false, true]);
  await p.goto('/');
  await p.locator('.book[data-id]', { hasText: 'Thursday' }).click();
  await p.waitForFunction(() => {
    const r = (window as any).__typeset.reader;
    return /Thursday/.test(r.book?.title ?? '') && r.strip && r.strip.layouts.size === r.book.sections.length;
  });
  await laidOut(p);
  await toChapterOne(p);
  const k = await cur(p);
  const [l, r] = await p.evaluate(k => {
    const c = document.querySelector(`.col[data-k="${k}"] .chead`)!,
      h = c.querySelector('.hline')!;
    const cr = c.getBoundingClientRect(),
      hr = h.getBoundingClientRect();
    return [hr.left - cr.left, cr.right - hr.right];
  }, k);
  expect(Math.abs(l - r)).toBeLessThan(2);
});

test('customised spacing, bold text and margins still fit, and reset', async ({ page: p }) => {
  await openSample(p);
  for (const id of ['warm', 'open']) {
    await p.evaluate(t => {
      const v = (window as any).__typeset,
        th = v.themeById(t);
      v.settings.theme = t;
      v.setOption(th, 'charSpacing', 3);
      v.setOption(th, 'wordSpacing', 8);
      v.setOption(th, 'boldText', !th.options.boldText);
      v.setOption(th, 'lineSpacing', 1.8);
      v.setOption(th, 'margins', 2);
      v.setOption(th, 'justify', true);
    }, id);
    const r = await fitAll(p);
    expect(r.over, `${id} ${JSON.stringify(r)}`).toBe(0);
    const ls = await p.evaluate(() => getComputedStyle(document.querySelector('.ln')!).letterSpacing);
    expect(parseFloat(ls)).toBeGreaterThan(0.3);
  }
  await p.keyboard.press('s');
  await p.keyboard.press('c');
  await p.keyboard.press('0');
  await expect
    .poll(() => p.evaluate(() => Object.keys((window as any).__typeset.themes.opts.focus || {}).length))
    .toBe(0);
});

test("making a theme asks a name, a face and a paper; the rest is ours: the face's weights, ink and accent read on the paper, a night of its own", async ({
  page: p,
}) => {
  await openSample(p);
  await p.keyboard.press('s');
  await p.keyboard.press('n');
  const sheet = p.getByRole('dialog', { name: 'New theme' });
  await expect(sheet).toBeVisible();
  // nothing a reader need decide: no weights, no spacing (those are Style's, for every theme)
  for (const gone of ['Weight', 'Bold weight', 'Line spacing', 'Margins', 'Serif', 'Ink', 'Accent'])
    await expect(sheet.getByText(gone, { exact: true })).toHaveCount(0);
  await sheet.getByRole('textbox', { name: 'Theme name' }).fill('Harvest');
  await sheet.getByRole('radio', { name: 'Fraunces' }).click();
  await sheet.getByLabel('Paper').fill('#f3e6cf');
  await p.getByRole('button', { name: 'Save theme' }).click();
  await expect(p.locator('.th[aria-checked="true"] .nm')).toHaveText('Harvest');
  const t = await p.evaluate(() => {
    const v = (window as any).__typeset,
      t = v.themes.user.find((x: any) => x.name === 'Harvest'),
      fr = v.themeById('warm');
    const lum = (h: string) => {
      const c = [1, 3, 5]
        .map(i => parseInt(h.slice(i, i + 2), 16) / 255)
        .map(x => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    return {
      family: t.type.family,
      weights: [t.type.weight, t.type.bold],
      faces: [fr.type.weight, fr.type.bold],
      paper: t.light.paper,
      ink: ratio(t.light.paper, t.light.ink),
      accent: ratio(t.light.paper, t.light.accent),
      night: lum(t.dark.paper),
      nightInk: ratio(t.dark.paper, t.dark.ink),
    };
  });
  expect(t.family).toBe('Fraunces');
  expect(t.weights).toEqual(t.faces);
  expect(t.paper).toBe('#f3e6cf');
  expect(t.ink).toBeGreaterThanOrEqual(7);
  expect(t.accent).toBeGreaterThanOrEqual(3.2);
  expect(t.night).toBeLessThan(0.05);
  expect(t.nightInk).toBeGreaterThanOrEqual(7);
});

test('a pasted theme imports, saves and is chosen', async ({ page: p }) => {
  await openSample(p);
  await p.keyboard.press('s');
  await p.keyboard.press('n');
  await p.getByRole('button', { name: /From a file or an AI/ }).click();
  const theme = {
    format: 'typeset-theme/1',
    name: 'Harbour',
    font: { family: 'Charis', fallback: 'serif', weight: 400, boldWeight: 700 },
    layout: { lineSpacing: 1.6, justify: true },
    light: { paper: '#eef2f4', ink: '#8a8f93', accent: '#2f6f8f' },
    dark: { paper: '#1b2328', ink: '#d3dde3', accent: '#7fb6d1' },
  };
  await p.getByLabel('Theme to import').fill('```json\n' + JSON.stringify(theme) + '\n```');
  await p.getByRole('button', { name: 'Use this theme' }).click();
  // the light ink was too faint: it is repaired and the repair is said
  await expect(p.locator('.notes')).toContainText('too faint');
  await p.getByRole('button', { name: 'Save theme' }).click();
  await expect(p.locator('.th[aria-checked="true"] .nm')).toHaveText('Harbour');
  await expect
    .poll(() => p.evaluate(() => getComputedStyle(document.querySelector('.ln')!).fontFamily))
    .toContain('Charis');
});

test('type and appearance: the themes, Match device, and Style one step in, all by key too', async ({ page: p }) => {
  await openSample(p);
  await p.keyboard.press('s');
  const panel = p.getByRole('dialog', { name: 'Type and appearance' });
  await expect(panel).toBeVisible();
  // fits in the window without scrolling
  expect(await panel.evaluate(el => el.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  await expect(panel.locator('.th')).toHaveCount(6);
  await p.keyboard.press('t');
  await expect(panel.locator('.th[aria-checked="true"] .nm')).toHaveText('Slate');
  // the device's appearance, or one chosen
  await expect(panel.getByRole('switch', { name: 'Match device' })).toHaveAttribute('aria-checked', 'true');
  await panel.getByRole('switch', { name: 'Match device' }).click();
  await expect(panel.getByRole('radiogroup', { name: 'Appearance' })).toBeVisible();
  await panel.getByRole('switch', { name: 'Match device' }).click();
  // Style: another face for this theme; Reset gives back its own
  await p.keyboard.press('c');
  await expect(panel.getByRole('heading', { name: 'Style' })).toBeVisible();
  await panel.getByRole('radio', { name: /^Charis/ }).click();
  await expect
    .poll(() => p.evaluate(() => getComputedStyle(document.querySelector('.ln')!).fontFamily))
    .toContain('Charis');
  await p.keyboard.press('y');
  await expect(panel.getByRole('switch', { name: /Hyphenate/ })).toHaveAttribute('aria-checked', 'false');
  await panel.getByRole('button', { name: 'Reset' }).click();
  await expect
    .poll(() => p.evaluate(() => getComputedStyle(document.querySelector('.ln')!).fontFamily))
    .toContain('Newsreader');
  await expect(panel.getByRole('switch', { name: /Hyphenate/ })).toHaveAttribute('aria-checked', 'true');
  await p.keyboard.press('Escape');
  await expect(panel.locator('.th')).toHaveCount(6);
  await p.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  // a click on the page closes it too
  await p.keyboard.press('s');
  await p.mouse.click(400, 500);
  await expect(panel).toHaveCount(0);
});

test('the wheel: every notch counts, partial notches add up, a short push does not fall back', async ({ page: p }) => {
  await openSample(p);
  await p.evaluate(() => (window as any).__typeset.reader.jump(20));
  // (times here are the input's own: a quiet spell is what ends a wheel gesture and lets the
  // next be read, `QUIET` in wheel.ts; the gaps between spins make them separate gestures,
  // as a hand's would)
  const rest = async () => {
    await p.waitForTimeout(80);
    await settled(p);
    await p.waitForTimeout(250);
    return cur(p);
  };
  // wheel events as a webview delivers them, spaced in time
  const wheel = (deltas: number[], gap: number) =>
    p.evaluate(
      async ([deltas, gap]) => {
        const st = (window as any).__typeset.reader.stage as HTMLElement;
        for (const d of deltas) {
          st.dispatchEvent(new WheelEvent('wheel', { deltaY: d, deltaMode: 0, bubbles: true, cancelable: true }));
          await new Promise(r => setTimeout(r, gap));
        }
      },
      [deltas, gap] as [number[], number],
    );
  const k0 = await cur(p);
  await wheel([100], 0); // a classic notch
  expect(await rest()).toBe(k0 + 1);
  await wheel(Array(12).fill(100), 30); // a spin: every notch counts
  expect(await rest()).toBe(k0 + 13);
  await p.waitForTimeout(500);
  await wheel(Array(8).fill(12.5), 40); // eighth-notch steps, turned slowly
  expect(await rest()).toBe(k0 + 14);
  await p.waitForTimeout(500);
  await wheel([3.1, 7.4, 14.9, 22.3, 25.8, 21.6, 15.2, 9.3, 4.1], 16); // a trackpad push of a fifth of a column
  expect(await rest()).toBe(k0 + 15);
  await p.waitForTimeout(500);
  await wheel([1.2, 2.1, 1.4], 16); // a brush does nothing
  expect(await rest()).toBe(k0 + 15);
  await p.waitForTimeout(500);
  await wheel([-153], 0); // WebKitGTK's notch, backwards
  expect(await rest()).toBe(k0 + 14);
});

test('find in book: count, marks, Enter travels, the list, Esc clears', async ({ page: p }) => {
  await openSample(p);
  await p.keyboard.press('Control+f');
  const field = p.locator('.find input');
  await expect(field).toBeFocused();
  await field.fill('gregory');
  await expect(p.locator('.find .count')).toHaveText(/^1 of \d{2,}$/);
  // the list is grouped by chapter, the match in bold
  await expect(p.locator('.find .hit b').first()).toHaveText(/Gregory/);
  const k0 = await cur(p);
  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter');
  await settled(p);
  await expect(p.locator('.find .count')).toHaveText(/^3 of/);
  await expect(p.locator('.ln mark.h6')).toHaveCount(1);
  expect(await cur(p)).toBeGreaterThan(k0);
  // folding: curly quotes and case
  await field.fill("syme's");
  await expect(p.locator('.find .count')).toHaveText(/of \d+/);
  await p.keyboard.press('Escape');
  await expect(p.locator('.find')).toHaveCount(0);
  await expect(p.locator('.ln mark.h5, .ln mark.h6')).toHaveCount(0);
});

test("a book's sheet in the library: the book, its collections, its actions as one list, Done", async ({ page: p }) => {
  await p.goto('/');
  await p.evaluate(() => localStorage.clear());
  await p.goto('/');
  await p.locator('.book[data-id]').first().waitFor();
  await p.locator('.more').first().click();
  const sheet = p.locator('.sheet');
  await expect(sheet.getByRole('heading', { level: 2 })).toHaveText('The Man Who Was Thursday');
  await expect(sheet.getByRole('group', { name: 'Collections' })).toBeVisible();
  // its actions: one list, each a row with its glyph, removing last; Done alone at the foot
  const acts = sheet.getByRole('group', { name: 'Actions' }).getByRole('button');
  await expect(acts.first()).toHaveText('Share as a link…');
  await expect(acts.last()).toHaveText('Remove from library…');
  expect(await acts.evaluateAll(bs => bs.every(b => !!b.querySelector('svg')))).toBe(true);
  await expect(sheet.locator('.acts button')).toHaveText(['Done']);
});

test("the library notebook lists every book's entries, filters, and opens a book at one", async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  // forward a few columns and highlight a paragraph there
  for (let i = 0; i < 4; i++) {
    await p.keyboard.press('ArrowRight');
    await settled(p);
  }
  await p.keyboard.press('v');
  await p.keyboard.press('h');
  await p.keyboard.press('Escape');
  await expect.poll(() => p.evaluate(() => (window as any).__typeset.reader.ann.list.length)).toBe(1);
  const want = await p.evaluate(() => {
    const r = (window as any).__typeset.reader,
      a = r.ann.list[0];
    return { key: a.key, quote: a.quote as string, col: r.strip.resolve({ key: a.key, off: a.s }) };
  });
  // read on, so the place the book keeps is not the entry's
  for (let i = 0; i < 5; i++) {
    await p.keyboard.press('ArrowRight');
    await settled(p);
  }
  expect(await cur(p)).not.toBe(want.col);
  await p.keyboard.press('q');
  await expect(p.locator('.shelf')).toBeVisible();
  await p.keyboard.press('n');
  const item = p.locator('.nb-item');
  await expect(item).toHaveCount(1);
  await expect(p.locator('.nb-book h2')).toContainText('Thursday');
  // the filter folds case and quotes, and every word must match
  const word = want.quote
    .split(/\s+/)
    .find(w => w.length > 5)!
    .replace(/[^\p{L}]/gu, '');
  await p.locator('.nb-filter').fill(word.toUpperCase());
  await expect(item).toHaveCount(1);
  await p.locator('.nb-filter').fill(word + ' zzzqqq');
  await expect(item).toHaveCount(0);
  await p.locator('.nb-filter').fill(word);
  await p.keyboard.press('Enter');
  // straight into the book at the entry
  await expect(p.locator('.reader')).toBeVisible();
  await p.waitForFunction(() => {
    const r = (window as any).__typeset.reader;
    return r.strip && !r.opening;
  });
  await expect(p.locator('.sheet')).toHaveCount(0);
  expect(await cur(p)).toBe(want.col);
  await expect(p.locator(`.col[data-k="${want.col}"] mark.hl`).first()).toBeVisible();
});

test("a highlight's menu covers none of the highlight, whichever of its lines is clicked", async ({ page: p }) => {
  await openSample(p);
  await toChapterOne(p);
  const id = await p.evaluate(() => {
    const r = (window as any).__typeset.reader;
    const lns = [...document.querySelectorAll<HTMLElement>(`.col[data-k="${r.cur}"] .ln[data-b]`)];
    const ln = lns[Math.floor(lns.length / 2)],
      sec = r.strip.itemAt(r.cur).sec,
      b = r.book.sections[sec].blocks[+ln.dataset.b!],
      s0 = +ln.dataset.s!;
    const a = r.ann.add(b.key, s0, Math.min(b.t.length, s0 + 160), 2, '');
    r.marking.refreshSection(sec);
    return a.id ?? a;
  });
  const marks = p.locator(`.col mark[data-a="${id}"]`);
  expect(await marks.count()).toBeGreaterThanOrEqual(3);
  for (const i of [0, 1, (await marks.count()) - 1]) {
    await marks.nth(i).click();
    const pop = p.locator('.chip-pop');
    await expect(pop).toBeVisible();
    const m = (await pop.boundingBox())!;
    const over = await marks.evaluateAll(
      (els, m) =>
        els.filter(e => {
          const r = e.getBoundingClientRect();
          return r.left < m.x + m.width && r.right > m.x && r.top < m.y + m.height && r.bottom > m.y;
        }).length,
      m,
    );
    expect(over, `the menu over the highlight, clicked on its line ${i}`).toBe(0);
    await p.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
  }
});

test('notes beside their lines: a dot in the gutter, ; shows them all, hover shows one, a move puts them away', async ({
  page: p,
}) => {
  // a window with no room for the notes' rail: the cards lie over the text
  await p.setViewportSize({ width: 960, height: 820 });
  await openSample(p);
  await toChapterOne(p);
  await p.keyboard.press('ArrowRight');
  await settled(p);
  // two noted highlights in the column in view
  await p.evaluate(() => {
    const r = (window as any).__typeset.reader;
    const lines = [...document.querySelectorAll<HTMLElement>(`.col[data-k="${r.cur}"] .ln[data-b]`)];
    const sec = r.strip.itemAt(r.cur).sec,
      blocks = r.book.sections[sec].blocks;
    for (const [i, note] of [
      [2, 'First thought.'],
      [10, 'A second, longer thought about the passage.'],
    ] as const) {
      const ln = lines[i],
        b = blocks[+ln.dataset.b!],
        s0 = +ln.dataset.s!;
      r.ann.add(b.key, s0, Math.min(b.t.length, s0 + 30), 1, note);
    }
    r.marking.refreshSection(sec);
  });
  const k = await cur(p);
  const dots = p.locator(`.col[data-k="${k}"] .nd`);
  await expect(dots).toHaveCount(2);
  // in the gutter: past the column's edge, never over its text
  const geo = await p.evaluate(k => {
    const col = document.querySelector(`.col[data-k="${k}"]`)!.getBoundingClientRect();
    return {
      right: col.right,
      dots: [...document.querySelectorAll(`.col[data-k="${k}"] .nd`)].map(d => d.getBoundingClientRect().left),
    };
  }, k);
  expect(geo.dots.every(x => x > geo.right)).toBe(true);
  // ; pins both, each over its column below its highlight, inside the window; a move puts
  // them away
  await p.keyboard.press(';');
  const cards = p.locator('.sn');
  await expect(cards).toHaveCount(2);
  const W = await p.evaluate(() => innerWidth);
  for (const b of await cards.evaluateAll(els =>
    els.map(e => e.getBoundingClientRect()).map(r => ({ left: r.left, right: r.right })),
  ))
    expect(b.left >= 0 && b.right <= W).toBe(true);
  const [a, z] = await cards.evaluateAll(els =>
    els.map(e => e.getBoundingClientRect()).map(r => ({ top: r.top, bottom: r.bottom })),
  );
  expect(z.top).toBeGreaterThanOrEqual(a.bottom);
  await p.keyboard.press('ArrowRight');
  await expect(cards).toHaveCount(0);
  await p.keyboard.press('ArrowLeft');
  await settled(p);
  // hovering a dot shows its note alone; a press on the card edits it
  await dots.first().hover();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('First thought.');
  const before = await cur(p);
  await cards.first().click();
  await expect(p.locator('.sheet')).toBeVisible();
  expect(await cur(p)).toBe(before);
});

/** The whole book laid out again (a setting, the rail) and at rest. */
const laidOut = async (p: Page) => {
  await p.evaluate(() => (window as any).__typeset.reader.whole);
  await settled(p);
};

/** Two noted highlights near the head of the column in view. */
async function twoNotes(p: Page) {
  await p.evaluate(() => {
    const r = (window as any).__typeset.reader;
    const lines = [...document.querySelectorAll<HTMLElement>(`.col[data-k="${r.cur}"] .ln[data-b]`)];
    const sec = r.strip.itemAt(r.cur).sec,
      blocks = r.book.sections[sec].blocks;
    for (const [i, note] of [
      [2, 'First thought.'],
      [6, 'A second, longer thought about the passage.'],
    ] as const) {
      const ln = lines[i],
        b = blocks[+ln.dataset.b!],
        s0 = +ln.dataset.s!;
      r.ann.add(b.key, s0, Math.min(b.t.length, s0 + 30), 1, note);
    }
    r.marking.refreshSection(sec);
  });
}

test('the notes rail: ; sets the text in one column with every note in view beside its line, kept until put away', async ({
  page: p,
}) => {
  await openSample(p);
  await toChapterOne(p);
  expect(await p.evaluate(() => (window as any).__typeset.ui.cols)).toBe(2);
  await p.keyboard.press(';');
  await expect.poll(() => p.evaluate(() => (window as any).__typeset.ui.cols)).toBe(1);
  await laidOut(p);
  await expect(p.locator('.rail')).toBeVisible();
  const cards = p.locator('.sn');
  await expect(cards).toHaveCount(0);
  await twoNotes(p);
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('First thought.');
  await expect(cards.nth(1)).toContainText('A second, longer thought');
  // each in the rail, past the text, level with its line (or below the card above it)
  const level = () =>
    p.evaluate(() => {
      const r = (window as any).__typeset.reader;
      const el = document.querySelector(`.col[data-k="${r.cur}"]`)!,
        col = el.getBoundingClientRect();
      const inView = el.querySelectorAll('.nd').length;
      let below = -Infinity;
      return {
        inView,
        cards: [...document.querySelectorAll<HTMLElement>('.sn')].map(c => {
          const card = c.getBoundingClientRect(),
            dot = document
              .querySelector(`.col[data-k="${r.cur}"] .nd[data-a="${CSS.escape(c.dataset.a!)}"]`)
              ?.getBoundingClientRect();
          const ok =
            !!dot &&
            card.left > col.right + r.M.lh &&
            (Math.abs(card.top - (dot.top + dot.height / 2 - r.M.lh / 2)) < 2 || card.top >= below);
          below = card.bottom;
          return ok;
        }),
      };
    });
  expect(await level()).toEqual({ inView: 2, cards: [true, true] });
  // set again at another size, on the same page (the chapter's first): every note then in
  // view has its card, level with its line
  const k = await cur(p);
  await p.evaluate(() => {
    const w = window as any;
    w.__typeset.settings.step = 2;
    return w.__typeset.reader.settingsChanged('layout');
  });
  await laidOut(p);
  expect(await cur(p)).toBe(k);
  await expect
    .poll(async () => {
      const l = await level();
      return l.cards.length === l.inView && l.cards.every(Boolean);
    })
    .toBe(true);
  // one's own note is edited in its card
  await cards.nth(0).locator('.txt').click();
  const field = cards.nth(0).locator('textarea');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('First thought.');
  await field.press('End');
  await field.pressSequentially(' Then a second.');
  await field.press('Control+Enter');
  await expect(field).toHaveCount(0);
  expect(await p.evaluate(() => (window as any).__typeset.reader.ann.list.map((a: any) => a.note))).toContain(
    'First thought. Then a second.',
  );
  // kept: another visit opens with it, and ; puts it away again, the spread back
  expect(await p.evaluate(() => (window as any).__typeset.kv.get('rail'))).toBe(true);
  await p.keyboard.press(';');
  await expect.poll(() => p.evaluate(() => (window as any).__typeset.ui.cols)).toBe(2);
  await laidOut(p);
  await expect(p.locator('.rail')).toHaveCount(0);
  await expect(cards).toHaveCount(0);
  expect(await p.evaluate(() => (window as any).__typeset.kv.get('rail'))).toBe(false);
});

test("with the rail, the bar keeps over it, its buttons seen and pressed; the rail's foot goes to the book's other notes and puts it away", async ({
  page: p,
}) => {
  await openSample(p);
  await toChapterOne(p);
  // (read on from where the contents took it: the bar as it is while reading, no way back)
  await p.keyboard.press('ArrowRight');
  await expect(p.locator('.bar .return')).toHaveCount(0);
  // notes far apart: one here, one some chapters on
  await twoNotes(p);
  await p.evaluate(() => {
    const r = (window as any).__typeset.reader,
      sec = r.strip.itemAt(r.cur).sec + 3,
      b = r.book.sections[sec].blocks.find((x: any) => x.t.length > 80);
    r.ann.add(b.key, 0, 40, 2, 'Further on.');
    r.marking.refreshSection(sec);
  });
  await p.keyboard.press(';');
  await laidOut(p);
  const bar = p.locator('.bar');
  await p.mouse.move(700, 10);
  await expect(bar).not.toHaveClass(/away/);
  // every button in the bar is what a press there meets, the rail under it
  const hits = await p.locator('.bar button, .bar a').evaluateAll(els =>
    els.map(el => {
      const b = el.getBoundingClientRect();
      return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest('button, a') === el;
    }),
  );
  expect(hits.length).toBe(2);
  expect(hits.every(Boolean)).toBe(true);
  // (the rail lets presses through, so a hit alone does not show it is seen: the rail
  // begins under the bar, and no card goes under it)
  const barBottom = (await bar.boundingBox())!.y + 52;
  expect((await p.locator('.rail').boundingBox())!.y).toBeGreaterThanOrEqual(barBottom - 1);
  for (const c of await p.locator('.sn').all()) expect((await c.boundingBox())!.y).toBeGreaterThanOrEqual(barBottom);
  // the rail's foot: how many notes the book has, and the way to the others
  const foot = p.locator('.rail-foot');
  await expect(foot).toContainText('3 notes');
  const prev = foot.getByRole('button', { name: 'Previous note' }),
    next = foot.getByRole('button', { name: 'Next note' });
  await expect(prev).toBeDisabled();
  await next.click();
  await expect(p.locator('.sn', { hasText: 'Further on.' })).toBeVisible();
  await settled(p);
  await expect(next).toBeDisabled();
  await prev.click();
  await expect(p.locator('.sn', { hasText: 'A second, longer thought' })).toBeVisible();
  // a press in the rail is the rail's: on a card (to edit it) or its paper, the page stays
  const k = await p.evaluate(() => (window as any).__typeset.reader.noteCols()[0]);
  await expect.poll(() => cur(p)).toBe(k);
  await settled(p);
  await p.locator('.sn', { hasText: 'A second, longer thought' }).locator('.txt').click();
  await expect(p.locator('.sn.open textarea')).toBeFocused();
  await p.keyboard.press('Escape');
  const rail = (await p.locator('.rail').boundingBox())!;
  await p.mouse.click(rail.x + rail.width / 2, rail.y + rail.height - 120);
  await settled(p);
  expect(await cur(p)).toBe(k);
  // a page with none says so
  await p.evaluate(() => {
    const r = (window as any).__typeset.reader;
    r.jump(r.cur + 2);
  });
  await expect(p.locator('.sn')).toHaveCount(0);
  await expect(p.locator('.rail-empty')).toBeVisible();
  // put away from its own foot, or from the menu, where Notes is ticked while it shows
  await foot.getByRole('button', { name: 'Close the notes' }).click();
  await expect(p.locator('.rail')).toHaveCount(0);
  await p.keyboard.press(';');
  await expect(p.locator('.rail')).toBeVisible();
  await p.mouse.move(640, 790);
  await p.getByRole('button', { name: 'More' }).click();
  const notes = p.getByRole('menuitemcheckbox', { name: 'Notes beside the text' });
  await expect(notes).toHaveAttribute('aria-checked', 'true');
  await notes.click();
  await expect(p.locator('.rail')).toHaveCount(0);
});

test('a note is written beside its passage where the rail shows: N in the menu, Save or Cancel', async ({
  page: p,
}) => {
  await openSample(p);
  await toChapterOne(p);
  await p.keyboard.press(';');
  await expect.poll(() => p.evaluate(() => (window as any).__typeset.ui.cols)).toBe(1);
  await laidOut(p);
  const k = await cur(p);
  const pick = async (i: number, from = 0, to = 0.5) => {
    const box = (await p.locator(`.col[data-k="${k}"] .ln[data-b]`).nth(i).boundingBox())!;
    await p.mouse.move(box.x + 4 + box.width * from, box.y + box.height / 2);
    await p.mouse.down();
    await p.mouse.move(box.x + box.width * to, box.y + box.height / 2, { steps: 6 });
    await p.mouse.up();
    await expect(p.locator('.chip-pop')).toBeVisible();
    await p.keyboard.press('n');
  };
  await pick(3);
  // no sheet: a card in the rail, its field ready
  await expect(p.locator('.sheet')).toHaveCount(0);
  const field = p.locator('.sn.open textarea');
  await expect(field).toBeFocused();
  await field.pressSequentially('Written in place.');
  await p.locator('.sn.open').getByRole('button', { name: 'Save' }).click();
  await expect(p.locator('.sn.open')).toHaveCount(0);
  await expect(p.locator('.sn')).toContainText('Written in place.');
  await expect(p.locator(`.col[data-k="${k}"] .nd`)).toHaveCount(1);
  // Escape leaves the highlight without a note, and no card for it
  await pick(9);
  await expect(p.locator('.sn.open textarea')).toBeFocused();
  await p.keyboard.press('Escape');
  await expect(p.locator('.sn.open')).toHaveCount(0);
  await expect(p.locator('.sn')).toHaveCount(1);
  expect(await p.evaluate(() => (window as any).__typeset.reader.ann.list.map((a: any) => a.note).sort())).toEqual([
    '',
    'Written in place.',
  ]);
  // another on the same line as a note: the card being written is level with its line,
  // the other makes room above it
  await pick(3, 0.6, 0.95);
  await expect(p.locator('.sn.open textarea')).toBeFocused();
  const [open, other, line] = await p.evaluate(() => {
    const r = (window as any).__typeset.reader,
      id = (window as any).__typeset.ui.composing as string;
    const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const m = box(`mark[data-a="${CSS.escape(id)}"]`);
    return [box('.sn.open'), box('.sn:not(.open)'), m.top + m.height / 2 - r.M.lh / 2];
  });
  expect(Math.abs(open.top - line)).toBeLessThan(2);
  expect(other.bottom).toBeLessThanOrEqual(open.top);
  await p.keyboard.press('Escape');
});

test('collections: shelves that fill themselves, a named collection, A to file a book, [ ] to switch', async ({
  page: p,
}) => {
  await p.goto('/');
  await p.evaluate(() => localStorage.clear());
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  const tabs = p.locator('.shelves [role=tab]');
  await expect(tabs).toHaveText(['All', 'Reading', 'Finished', 'Not started']);
  // the sample has never been opened
  await tabs.filter({ hasText: 'Not started' }).click();
  await expect(p.locator('.slot .book')).toHaveCount(1);
  await tabs.filter({ hasText: 'Reading' }).click();
  await expect(p.locator('.slot .book')).toHaveCount(0);
  await expect(p.locator('.none')).toBeVisible();
  // file it in a new collection from its sheet
  await tabs.filter({ hasText: 'All' }).click();
  await p.locator('.slot .book').first().focus();
  await p.keyboard.press('a');
  const sheet = p.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('New collection').fill('Essays');
  await p.keyboard.press('Enter');
  await expect(sheet.locator('.col-row')).toHaveCount(1);
  await expect(sheet.locator('.col-row input')).toBeChecked();
  // 1 takes it out again, and puts it back
  await sheet.getByRole('button', { name: /Done/ }).focus();
  await p.keyboard.press('1');
  await expect(sheet.locator('.col-row input')).not.toBeChecked();
  await p.keyboard.press('1');
  await expect(sheet.locator('.col-row input')).toBeChecked();
  await p.keyboard.press('Escape');
  await expect(tabs).toHaveText(['All', 'Reading', 'Finished', 'Not started', 'Essays']);
  // ] steps through the shelves to it; it holds the book; it is remembered
  await p.locator('.slot .book').first().focus();
  for (let i = 0; i < 4; i++) await p.keyboard.press(']');
  await expect(tabs.filter({ hasText: 'Essays' })).toHaveAttribute('aria-selected', 'true');
  await expect(p.locator('.slot .book')).toHaveCount(1);
  await p.reload();
  await expect(p.locator('.shelves [aria-selected=true]')).toHaveText('Essays');
  // renamed, then deleted: the book stays in the library
  await p.getByRole('button', { name: 'Rename or delete…' }).click();
  await p.getByRole('dialog').getByLabel('Name').fill('Long essays');
  await p.keyboard.press('Enter');
  await expect(tabs.last()).toHaveText('Long essays');
  await p.getByRole('button', { name: 'Rename or delete…' }).click();
  await p.getByRole('button', { name: 'Delete the collection' }).click();
  await expect(tabs).toHaveCount(4);
  await expect(p.locator('.shelves [aria-selected=true]')).toHaveText('All');
  await expect(p.locator('.slot .book')).toHaveCount(1);
});

test('library search: titles and authors at once, the text of every book beneath, a match opens there', async ({
  page: p,
}) => {
  test.setTimeout(120000);
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  if (!(await p.locator('.book[data-id]', { hasText: 'Art of War' }).count()))
    await p.setInputFiles('input[type=file]', '../bench/fixtures/artofwar.epub');
  await p.locator('.book[data-id]', { hasText: 'Art of War' }).waitFor({ timeout: 60000 });
  await p.keyboard.press('/');
  const field = p.getByLabel('Search the library');
  await expect(field).toBeFocused();
  // an author: the grid narrows to that book
  await field.fill('sun tzu');
  await expect(p.locator('.slot .book')).toHaveCount(1);
  await expect(p.locator('.slot .book')).toContainText('Art of War');
  // words in the text only: no title matches, the matches below, Thursday's first
  await field.fill('saffron park');
  await expect(p.locator('.slot .book')).toHaveCount(0);
  const bk = p.locator('.res .bk');
  await expect(bk.first().locator('h3')).toContainText('Thursday', { timeout: 15000 });
  // (the count as it reads: the rendered text, its source's line breaks collapsed)
  await expect.poll(() => p.locator('.res .sum').innerText()).toMatch(/\d+ match(es)? in \d+ book/);
  await expect(bk.first().locator('.hit b').first()).toHaveText(/saffron park/i);
  // down to the first match, Enter: the book opens there with the search going on
  await p.keyboard.press('ArrowDown');
  await expect(bk.first().locator('.hit').first()).toBeFocused();
  await p.keyboard.press('Enter');
  await expect(p.locator('.reader')).toBeVisible();
  await expect(p.locator('.find .count')).toHaveText(/^1 of \d+$/, { timeout: 10000 });
  await expect(p.locator('.ln mark.h6')).toHaveCount(1);
  await expect(p.locator('.sheet')).toHaveCount(0);
});

test('nothing teaches: no hint comes, whatever the reader does (the interface speaks for itself)', async ({
  page: p,
}) => {
  await openSample(p);
  await toChapterOne(p);
  // (hints, where there are any, are off under automation: on, as a reader has them)
  await p.evaluate(() => (window as any).__typeset.setHints?.(true));
  // turning by clicking beside the text, many times; a mark made; the book opened again
  const box = (await p.locator('.stage').boundingBox())!;
  for (let i = 0; i < 6; i++) {
    await p.mouse.click(box.x + box.width - 40, box.y + box.height / 2);
    await settled(p);
  }
  await p.keyboard.press('v');
  await p.keyboard.press('m');
  await p.keyboard.press('Escape');
  await expect(p.locator('.toast.show')).toHaveCount(0);
  expect(await p.evaluate(() => localStorage.getItem('typeset.hints'))).toBeNull();
});

test('notes find their words again when the text has moved; notes whose words are gone are kept out of sight', async ({
  page: p,
}) => {
  await openSample(p);
  await toChapterOne(p);
  await p.keyboard.press('ArrowRight');
  await settled(p);
  await p.keyboard.press('v');
  await p.keyboard.press('h');
  await p.keyboard.press('Escape');
  await expect.poll(() => p.evaluate(() => (window as any).__typeset.reader.ann.list.length)).toBe(1);
  const before = await p.evaluate(() => {
    const a = (window as any).__typeset.reader.ann.list[0];
    return { key: a.key, s: a.s, e: a.e, id: (window as any).__typeset.reader.book.id };
  });
  // as a later draft would have it: the note's key is another paragraph's, its offsets
  // are off; and a second note whose words are nowhere in this book
  await p.evaluate(b => {
    const r = (window as any).__typeset.reader,
      blocks = r.book.sections.flatMap((s: any) => s.blocks);
    const other = blocks.find((x: any) => x.key !== b.key && x.t.length > 200).key;
    const list = r.ann.list.map((a: any) => ({ ...a, key: other, s: a.s + 7, e: a.e + 7 }));
    list.push({
      ...list[0],
      id: 'gone',
      quote: 'words that were never in this book at all',
      prefix: 'nothing ',
      suffix: ' nowhere',
      s: 0,
      e: 10,
      note: 'lost',
    });
    r.ann.list = list;
    r.ann.save();
    r.close();
  }, before);
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => {
    const r = (window as any).__typeset.reader;
    return r.strip && r.strip.layouts.size === r.book.sections.length;
  });
  const after = await p.evaluate(() =>
    (window as any).__typeset.reader.ann.list.map((a: any) => ({
      id: a.id,
      key: a.key,
      s: a.s,
      e: a.e,
      lost: !!a.lost,
    })),
  );
  expect(after.find((a: any) => a.id !== 'gone')).toMatchObject({
    key: before.key,
    s: before.s,
    e: before.e,
    lost: false,
  });
  expect(after.find((a: any) => a.id === 'gone')).toMatchObject({ lost: true });
  // the lost one is neither in the notebook nor drawn
  const nb = await p.evaluate(() => (window as any).__typeset.reader.marking.notebook().map((e: any) => e.id));
  expect(nb).not.toContain('gone');
  await expect(p.locator('mark.hl[data-a="gone"]')).toHaveCount(0);
});

test('a reader sends notes, the writer sees them in place: underlined, dotted, gathered by passage', async ({
  page: p,
}) => {
  // the reader: a note on a passage, a marked paragraph, sent as a file
  await openSample(p);
  await toChapterOne(p);
  await p.keyboard.press('ArrowRight');
  await settled(p);
  await p.evaluate(() => {
    const r = (window as any).__typeset.reader,
      lines = [...document.querySelectorAll<HTMLElement>(`.col[data-k="${r.cur}"] .ln[data-b]`)];
    const sec = r.strip.itemAt(r.cur).sec,
      blocks = r.book.sections[sec].blocks;
    const ln = lines[3],
      b = blocks[+ln.dataset.b!],
      s0 = +ln.dataset.s!;
    const a = r.ann.add(b.key, s0, s0 + 30, 2, 'This slowed me down — too much at once.');
    r.ann.update(a.id, { react: 'slow' });
    // (another paragraph on the page, whatever the size sets on it: two passages)
    const other = lines.findLast(l => l.dataset.b !== ln.dataset.b)!;
    r.marking.toggleMark(blocks[+other.dataset.b!].key);
    r.marking.refreshSection(sec);
  });
  await p.keyboard.press('m');
  await expect(p.locator('.contents')).toBeVisible();
  await p.getByRole('tab', { name: 'Highlights' }).click();
  await p.getByRole('button', { name: 'Send my notes…' }).click();
  const sheet = p.getByRole('dialog', { name: 'Send my notes' });
  await expect(sheet).toContainText('1 highlight, 1 with a note, 1 marked paragraph, how far you have read');
  await sheet.getByPlaceholder('Your name').fill('Anna');
  const [dl] = await Promise.all([
    p.waitForEvent('download'),
    sheet.getByRole('button', { name: /Save the file/ }).click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/notes from Anna\.vnotes$/);
  const text = await (await dl.createReadStream()).toArray().then(c => Buffer.concat(c).toString());
  expect(JSON.parse(text)).toMatchObject({
    format: 'typeset-notes/1',
    from: { name: 'Anna' },
    progress: { done: false, where: expect.stringMatching(/^Chapter I/) },
  });
  // (early in the book: by its text, under a hundredth of the way)
  expect(JSON.parse(text).progress.furthest).toBeGreaterThanOrEqual(0);
  expect(JSON.parse(text).notes.find((n: any) => n.note).react).toBe('slow');
  // the writer: another browser, the same book, no notes of their own (and another person:
  // everything stored is cleared, the store's memory too)
  await p.evaluate(() => {
    const kv = (window as any).__typeset.kv;
    for (const k of kv.keys('')) kv.del(k);
    localStorage.clear();
    indexedDB.deleteDatabase('typeset');
  });
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  await p.setInputFiles('input[type=file]', {
    name: 'Thursday — notes from Anna.vnotes',
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  });
  await expect(p.locator('.toast')).toContainText('Notes from Anna');
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => {
    const r = (window as any).__typeset.reader;
    return r.strip && r.strip.layouts.size === r.book.sections.length && r.fb?.size === 1;
  });
  // in place: her underline and her note's dot, where she put them
  const where = JSON.parse(text).notes.find((n: any) => n.note);
  const col = await p.evaluate(w => (window as any).__typeset.reader.strip.resolve({ key: w.key, off: w.s }), where);
  await p.evaluate(k => (window as any).__typeset.reader.jump(k), col);
  await settled(p);
  await expect(p.locator(`.col[data-k="${col}"] .fb`).first()).toBeVisible();
  await expect(p.locator(`.col[data-k="${col}"] .nd.fd`)).toHaveCount(1);
  await expect(p.locator('.fmb').first()).toBeAttached();
  await p.locator(`.col[data-k="${col}"] .nd.fd`).hover();
  await expect(p.locator('.sn.theirs')).toContainText('Anna');
  await expect(p.locator('.sn.theirs')).toContainText('This slowed me down');
  // gathered on the highlights' Readers’ side; hiding her takes her notes off the page
  await p.mouse.move(5, 5);
  await p.keyboard.press('m');
  await expect(p.locator('.contents')).toBeVisible();
  // the contents say where the feedback is: her two notes, in one chapter
  await expect(p.locator('.contents .fb')).toHaveText(['2']);
  await p.getByRole('tab', { name: 'Highlights' }).click();
  await p.getByRole('button', { name: /^Readers/ }).click();
  await expect(p.locator('.fbl .grp')).toHaveCount(2);
  await expect(p.locator('.fbl .grp').first()).toContainText('Anna');
  await p.locator('.fbl .chip').click();
  await expect(p.locator('.fbl .grp')).toHaveCount(0);
  await p.locator('.fbl .chip').click();
  // how far she read, beside her name
  await expect(p.locator('.fbl .far').first()).toContainText(/Anna has read \d+%, and is at Chapter I/);
  // her reaction, on her passage and counted
  await expect(p.locator('.fbl .t.re').first()).toHaveText('Slow here');
  await expect(p.locator('.fbl .far').nth(1)).toHaveText('Slow here 1');
  // a second reader on one of her passages: most readers first puts it first
  const second = JSON.parse(text);
  second.from = { id: 'tomas', name: 'Tomas' };
  second.progress = { at: 1, furthest: 1, where: 'Finis', done: true };
  second.notes = [second.notes.find((n: any) => n.note)];
  expect(await p.evaluate(t => (window as any).__typeset.reader.receiveNotes(t), JSON.stringify(second))).toMatch(
    /^Notes from Tomas: 1 placed/,
  );
  await p.getByRole('button', { name: 'Most readers first' }).click();
  await expect(p.locator('.fbl .pas').first()).toContainText('2 readers');
  await expect(p.locator('.fbl .far').first()).toContainText('Tomas finished it');
  // one dealt with: Done, and Open only leaves the other
  await p.locator('.fbl .pas').first().getByRole('button', { name: 'Done' }).click();
  await p.getByRole('button', { name: 'Open only' }).click();
  await expect(p.locator('.fbl .grp')).toHaveCount(1);
  await p.getByRole('button', { name: 'Open only' }).click();
  await expect(p.locator('.fbl .pas.settled')).toHaveCount(1);
  // an open passage pressed (her marked paragraph): the reader goes there, the mark beside
  // it (a settled passage is off the page: its own test)
  await p.locator('.fbl .pas:not(.settled) .grp').first().click();
  await expect(p.locator('.contents')).toHaveCount(0);
  await expect(p.locator('.col .fb, .col .fmb').first()).toBeVisible();
});

test('a Word manuscript opens as a book: its title, chapters and footnotes', async ({ page: p }) => {
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  await p.setInputFiles('input[type=file]', '../bench/fixtures/manuscript.docx');
  const book = p.locator('.book[data-id]', { hasText: 'The Lantern Keeper' });
  await book.waitFor({ timeout: 30000 });
  await book.click();
  await p.waitForFunction(() => {
    const r = (window as any).__typeset.reader;
    return r.strip && r.strip.layouts.size === r.book.sections.length;
  });
  const s = await p.evaluate(() => {
    const b = (window as any).__typeset.reader.book;
    return { title: b.title, author: b.author, chapters: b.sections.map((x: any) => x.label), notes: b.notes.length };
  });
  expect(s).toEqual({
    title: 'The Lantern Keeper',
    author: 'Ada Morrow',
    chapters: ['Chapter One', 'Chapter Two'],
    notes: 2,
  });
  await p.evaluate(() => (window as any).__typeset.reader.jump((window as any).__typeset.reader.strip.secStart[0]));
  await expect(p.locator('.col .ln a.nr').first()).toBeVisible();
});

test('a note marker opens its note; G goes to where it is printed', async ({ page: p }) => {
  test.setTimeout(120000);
  await openFile(p, '../bench/fixtures/artofwar.epub', 'Art of War');
  const k = await firstCol(p, 'a.nr');
  expect(k).toBeGreaterThan(0);
  await settled(p);
  await p.locator(`.col[data-k="${k}"] a.nr`).first().click();
  const card = p.getByRole('dialog', { name: /^Note / });
  await expect(card).toContainText('Published at Paris in 1782.');
  const before = await cur(p);
  // a press on the card's text is the card's: the page beneath does not turn (a turn would
  // have begun within the click)
  await card.locator('.body').click();
  expect([await cur(p), await p.evaluate(() => (window as any).__typeset.reader.motion.moving)]).toEqual([
    before,
    false,
  ]);
  await expect(card).toHaveCount(1);
  await p.keyboard.press('g');
  await expect(card).toHaveCount(0);
  await expect.poll(() => cur(p)).toBeGreaterThan(before + 20); // the endnotes are at the back
  await settled(p);
});

test('a long note scrolls under the wheel; the page beneath stays, and a turn puts it away', async ({ page: p }) => {
  test.setTimeout(120000);
  await openFile(p, '../bench/fixtures/artofwar.epub', 'Art of War');
  // the book's longest note, opened from its marker
  const i = await p.evaluate(() => {
    const ns = (window as any).__typeset.reader.book.notes as { t: string }[];
    return ns.reduce((m, n, j) => (n.t.length > ns[m].t.length ? j : m), 0);
  });
  const k = await firstCol(p, `a.nr[data-n="${i}"]`);
  expect(k).toBeGreaterThan(0);
  await settled(p);
  await p.locator(`.col[data-k="${k}"] a.nr[data-n="${i}"]`).first().click();
  const body = p.getByRole('dialog', { name: /^Note / }).locator('.body');
  await expect(body).toBeVisible();
  const before = await cur(p);
  expect(await body.evaluate(b => b.scrollHeight > b.clientHeight + 20)).toBe(true);
  // the wheel over the note: the note scrolls, the book does not turn
  const bb = (await body.boundingBox())!;
  await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await p.mouse.wheel(0, 120);
  await expect.poll(() => body.evaluate(b => b.scrollTop)).toBeGreaterThan(0);
  // to its end and past it: still the note's (nothing passes on to the page)
  for (let n = 0; n < 12; n++) await p.mouse.wheel(0, 240);
  await expect.poll(() => body.evaluate(b => Math.ceil(b.scrollTop + b.clientHeight) >= b.scrollHeight)).toBe(true);
  await settled(p);
  expect(await cur(p)).toBe(before);
  expect(await p.evaluate(() => (window as any).__typeset.reader.motion.p)).toBe(before);
  // a turn takes the note away with its marker
  await p.keyboard.press('ArrowRight');
  await expect(p.getByRole('dialog', { name: /^Note / })).toHaveCount(0);
});

test('an image opens large and goes back; the keyboard can open it too', async ({ page: p }) => {
  test.setTimeout(120000);
  await openFile(p, '../bench/fixtures/beagle.epub', 'Beagle');
  const k = await firstCol(p, 'figure.img');
  expect(k).toBeGreaterThan(0);
  await settled(p);
  const img = p.locator(`.col[data-k="${k}"] figure.img img`).first();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  await p.locator(`.col[data-k="${k}"] figure.img`).first().click();
  const lb = p.locator('.lb');
  await expect(lb).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(lb).toHaveCount(0);
  // V picks paragraphs; O opens the picked image
  await p.keyboard.press('v');
  for (let i = 0; i < 30 && !(await p.locator('.col .img.pick').count()); i++) await p.keyboard.press('j');
  await p.keyboard.press('o');
  await expect(lb).toBeVisible();
  await p.keyboard.press('Escape');
});

test('a fault in the engine: a plain message, and the engine starts again', async ({ page: p }) => {
  await openSample(p);
  const out = await p.evaluate(async () => {
    const R = (window as any).__typeset.reader,
      core = R.core,
      id = R.book.id;
    // a layout already asked for when the fault comes is answered by the new engine
    const late = core.layout(id, [0], R.appearance.params(R.M)).then(
      () => 'ok',
      (e: Error) => e.message,
    );
    const fault = await core.faultForTest().then(
      () => 'no fault',
      (e: Error) => e.message,
    );
    const after = await core.layout(id, [1], R.appearance.params(R.M)).then(
      () => 'ok',
      (e: Error) => e.message,
    );
    return { fault, late: await late, after, title: (await core.open(id)).title };
  });
  expect(out.fault).toMatch(/^The reader hit a bug of its own \(a fault made on purpose, lib\.rs:\d+\)\.$/);
  expect(out).toMatchObject({ late: 'ok', after: 'ok', title: 'The Man Who Was Thursday' });
  // and the reader still turns
  const k = await cur(p);
  await p.keyboard.press('ArrowRight');
  await settled(p);
  expect(await cur(p)).toBe(k + 1);
});

test('a file that is not a book: the library says what it is, and still opens books', async ({ page: p }) => {
  await p.goto('/');
  await p.locator('.book[data-id]').first().waitFor();
  await p.setInputFiles('input[type=file]', {
    name: 'IMG_0412.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]),
  });
  await expect(p.locator('.toast')).toHaveText('Couldn’t open IMG_0412.jpg: it is an image, not a book.');
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => {
    const r = (window as any).__typeset.reader;
    return r.strip && r.strip.layouts.size === r.book.sections.length;
  });
});

test('notes exported as Markdown read cleanly and go back on the book exactly; a reader’s become feedback', async ({
  page: p,
}) => {
  await openSample(p);
  const made = await p.evaluate(() => {
    const r = (window as any).__typeset.reader;
    const bl = r.book.sections[3].blocks.filter((b: any) => b.t.length > 200);
    r.ann.add(bl[0].key, 10, 120, 2, 'A note here');
    r.ann.add(bl[2].key, 0, 200, 1, '');
    r.ann.add(bl[4].key, 30, 90, 4, '# not a heading\n\n> nor a quote');
    r.marking.toggleMark(r.book.sections[4].blocks[3].key);
    const m = (window as any).__typeset.contents;
    const md = m.markdown(r.marking.notebook().map((e: any) => ({ ...e, k: r.strip.resolve(e.at) })));
    const ann = r.ann.list
      .map((a: any) => ({ key: a.key, s: a.s, e: a.e, color: a.color, note: a.note }))
      .sort((a: any, b: any) => a.key.localeCompare(b.key) || a.s - b.s);
    return {
      md,
      ann,
      marks: [...r.marks],
      id: r.book.id,
      me: (window as any).__typeset.kv.get('me', null).id as string,
    };
  });
  // read as Markdown: chapter headings without separators, the notes as written
  expect(made.md).toContain('\n## Chapter II: The Secret of Gabriel Syme\n');
  expect(made.md).not.toMatch(/^##.*·/m);
  expect(made.md).toContain('\nA note here\n');
  expect(made.md).toContain('\n\\# not a heading\n\n\\> nor a quote\n');
  expect(made.md.match(/<!-- at \{/g)).toHaveLength(4);
  // the book with no notes: the file puts them back where they were
  await p.keyboard.press('q');
  await p.evaluate(id => {
    for (const k of ['ann.', 'marks.', 'nb.']) (window as any).__typeset.kv.del(k + id);
  }, made.id);
  await p.reload();
  await p.setInputFiles('input[type=file]', {
    name: 'Thursday — notes.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(made.md),
  });
  await expect(p.locator('.toast')).toHaveText('4 of your notes put back on “The Man Who Was Thursday”.');
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => (window as any).__typeset.reader.reading);
  const back = await p.evaluate(() => {
    const r = (window as any).__typeset.reader;
    return {
      ann: r.ann.list
        .map((a: any) => ({ key: a.key, s: a.s, e: a.e, color: a.color, note: a.note }))
        .sort((a: any, b: any) => a.key.localeCompare(b.key) || a.s - b.s),
      marks: [...r.marks],
    };
  });
  expect(back).toEqual({ ann: made.ann, marks: made.marks });
  // the same file from someone else: their feedback, not one's own notes
  await p.keyboard.press('q');
  await p.setInputFiles('input[type=file]', {
    name: 'Anna — notes.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(made.md.replace(made.me, 'someone-else').replace(/"name":"[^"]*"/, '"name":"Anna"')),
  });
  await expect(p.locator('.toast')).toContainText('Notes from Anna on “The Man Who Was Thursday”: 4 notes.');
  // a dozen readers at once (a writer's folder of their files): one import, said once
  const theirs = (i: number, sent: number) => ({
    name: `Reader ${i}.md`,
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      made.md
        .replace(made.me, `reader-${i}`)
        .replace(/"name":"[^"]*"/, `"name":"Reader ${i}"`)
        .replace(/"sent":\d+/, `"sent":${sent}`),
    ),
  });
  await p.setInputFiles('input[type=file]', [
    ...Array.from({ length: 12 }, (_, i) => theirs(i, 2e12)),
    { name: 'shopping.json', mimeType: 'application/json', buffer: Buffer.from('{"eggs":12}') },
  ]);
  await expect(p.locator('.toast')).toHaveText(
    /^Notes from 12 readers on “The Man Who Was Thursday”: 48 notes\. Open the book to see them beside the text\. 1 file was not notes \(shopping\.json\)\.$/,
  );
  // a reader's older file, after their newer: nothing changes
  await p.setInputFiles('input[type=file]', [theirs(3, 1e12)]);
  await expect(p.locator('.toast')).toHaveText('These notes are here already.');
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => (window as any).__typeset.reader.fb?.size === 13);
});

test('copying works where the page has no clipboard access (a phone over plain http)', async ({
  page: p,
  browserName,
}) => {
  await p.addInitScript(() => Object.defineProperty(window, 'isSecureContext', { value: false }));
  await openSample(p);
  await p.evaluate(() => {
    const r = (window as any).__typeset.reader;
    const b = r.book.sections[3].blocks.find((x: any) => x.t.length > 200);
    r.ann.add(b.key, 0, 60, 1, 'Kept');
  });
  await p.keyboard.press('m');
  await expect(p.locator('.contents')).toBeVisible();
  await p.getByRole('tab', { name: 'Highlights' }).click();
  await p.getByRole('button', { name: 'Copy as Markdown' }).click();
  await expect(p.locator('.toast')).toHaveText('Copied');
  if (browserName === 'chromium') {
    await p.context().grantPermissions(['clipboard-read']);
    expect(await p.evaluate(() => navigator.clipboard.readText())).toContain('\nKept\n');
  }
});

test('a large cover is kept as a thumbnail the shelf can show; covers share one frame', async ({ page: p }) => {
  await p.goto('/');
  await p.locator('.book[data-id]').first().waitFor();
  const id = await p.locator('.book[data-id]').first().getAttribute('data-id');
  // (the library's own work on the sample's cover done first: it writes it back smaller)
  await expect(p.locator('.cover.img img').first()).toBeVisible();
  // (that write is the library's own, in the background, and nothing shows it done: a time)
  await p.waitForTimeout(800);
  // a 1600 × 2400 cover, as some publishers ship them
  await p.evaluate(async id => {
    const c = document.createElement('canvas');
    c.width = 1600;
    c.height = 2400;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `hsl(${i * 7} 60% 50%)`;
      g.fillRect((i * 97) % 1600, (i * 131) % 2400, 120, 90);
    }
    const b = await new Promise<Blob>(r => c.toBlob(x => r(x!), 'image/jpeg', 0.95));
    await (window as any).__typeset.reader.core.setCover(id, await b.arrayBuffer());
  }, id);
  await p.reload();
  await expect(p.locator('.cover.img img').first()).toBeVisible();
  await expect
    .poll(async () =>
      p.evaluate(async id => {
        const buf = await (window as any).__typeset.reader.core.cover(id);
        const bmp = await createImageBitmap(new Blob([buf]));
        return [bmp.width, bmp.height];
      }, id),
    )
    .toEqual([480, 720]);
  // every cover the same frame, a generated one with a long title among them
  await p.setInputFiles('input[type=file]', {
    name: 'long.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      'Title: The Extraordinarily Long and Winding Title of a Book Nobody Could Ever Fit on One Cover Whatever Its Size\nAuthor: Someone With a Rather Long Name Indeed\n\n' +
        'Words of a book. '.repeat(400),
    ),
  });
  await expect(p.locator('.book[data-id]')).toHaveCount(2);
  const sizes = await p.locator('.book .cover').evaluateAll(els =>
    els.map(e => {
      const r = e.getBoundingClientRect();
      return [Math.round(r.width), Math.round(r.height)];
    }),
  );
  expect(new Set(sizes.map(s => s.join('x'))).size).toBe(1);
});

test('the engine starts when needed and ends when no book is open; the library needs it not', async ({ page: p }) => {
  await openSample(p);
  expect(await p.evaluate(() => (window as any).__typeset.reader.core.running())).toBe(true);
  await p.keyboard.press('q');
  await expect(p.locator('.shelf')).toBeVisible();
  // (the real wait is minutes) and what is asked meanwhile does not keep it: a search,
  // the offline cache's question every 30 s
  await p.evaluate(async () => {
    const c = (window as any).__typeset.reader.core;
    c.idle(600);
    await c.fetched();
    await c.searchLibrary('syme');
  });
  expect(await p.evaluate(() => (window as any).__typeset.reader.core.running())).toBe(true);
  await expect
    .poll(() => p.evaluate(() => (window as any).__typeset.reader.core.running()), { timeout: 4000 })
    .toBe(false);
  // the library, its covers, a book added: all without the engine of reading
  await p.reload();
  await p.locator('.book[data-id]').first().waitFor();
  // (after the reader's first measurements, which start it)
  await expect
    .poll(() =>
      p.evaluate(() => {
        const c = (window as any).__typeset.reader.core;
        c.idle(0);
        return new Promise(r => setTimeout(() => r(c.running()), 100));
      }),
    )
    .toBe(false);
  await expect(p.locator('.book[data-id]')).toHaveCount(1);
  await p.setInputFiles('input[type=file]', {
    name: 'small.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Title: Small\n\n' + 'Words of a book. '.repeat(300)),
  });
  await expect(p.locator('.book[data-id]')).toHaveCount(2);
  // and a book opens as before, the engine started again
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => {
    const r = (window as any).__typeset.reader;
    return r.reading && r.strip && r.strip.layouts.size === r.book.sections.length;
  });
  await expect(p.locator('.col .ln').first()).toBeVisible();
});

test('rich blocks: a genealogy, a figure and a formula drawn as the publisher made them, measured once', async ({
  page: p,
}) => {
  await p.goto('/');
  await p.locator('.book[data-id]').first().waitFor();
  await p.setInputFiles('input[type=file]', '../bench/fixtures/rich.epub');
  const book = p.locator('.book[data-id]', { hasText: 'Houses and Figures' });
  await book.click();
  await p.waitForFunction(() => {
    const r = (window as any).__typeset.reader;
    return r.reading && r.strip && r.strip.layouts.size === r.book.sections.length;
  });
  const sizes = await p.evaluate(() => (window as any).__typeset.reader.book.images.map((i: any) => [i[0], i[1]]));
  expect(sizes.length).toBe(3);
  for (const [w, h] of sizes) {
    expect(w).toBeGreaterThan(20);
    expect(h).toBeGreaterThan(20);
  }
  // the genealogy, drawn in its column
  await p.evaluate(() => {
    const r = (window as any).__typeset.reader;
    r.jump(r.strip.secStart[0]);
  });
  const img = p.locator('figure.img.rich img').first();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(300);
  // kept with the book: opened again, nothing to measure
  await p.keyboard.press('q');
  const id = await book.getAttribute('data-id');
  expect(
    await p.evaluate(
      async id => (await (window as any).__typeset.reader.core.open(id)).images.map((i: any) => [i[0], i[1]]),
      id,
    ),
  ).toEqual(sizes);
  // on dark paper, the ink turns light
  await book.click();
  await p.waitForFunction(() => (window as any).__typeset.reader.reading);
  await p.evaluate(() => {
    const v = (window as any).__typeset;
    v.settings.appearance = 'dark';
    v.reader.appearance.themeChanged();
    const r = v.reader;
    r.jump(r.strip.secStart[0]);
  });
  await expect
    .poll(() =>
      p
        .locator('figure.img.rich img')
        .first()
        .evaluate(i => getComputedStyle(i).filter),
    )
    .toContain('invert');
});

test('a link out of the book asks first, naming the address, then opens in a new tab; from a tap or the keyboard; only to the web and mail', async ({
  page: p,
}) => {
  await p.goto('/');
  await p.locator('.book[data-id]').first().waitFor();
  const md =
    '---\ntitle: Linked\n---\n\n# One\n\nSee [the archive](https://example.org/archive) for the rest of the story, which goes on for some time.\n';
  await p.setInputFiles('input[type=file]', { name: 'linked.md', mimeType: 'text/markdown', buffer: Buffer.from(md) });
  await p.locator('.book[data-id]', { hasText: 'Linked' }).click();
  await p.waitForFunction(() => {
    const r = (window as any).__typeset.reader;
    return r.reading && r.strip && r.strip.layouts.size === r.book.sections.length;
  });
  await p.evaluate(() => {
    const r = (window as any).__typeset.reader;
    r.jump(r.strip.secStart[0]);
  });
  const link = p.locator('.col a.ur').first();
  await expect(link).toHaveText('the archive');
  const popups: string[] = [];
  p.on('popup', t => popups.push(t.url()));
  // a press on it leaves nothing yet: it asks, naming where it goes
  await link.click();
  const ask = p.getByRole('dialog', { name: 'Open this link' });
  await expect(ask).toBeVisible();
  await expect(ask).toContainText('https://example.org/archive');
  // cancelled, or put away: still in the book
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(ask).toHaveCount(0);
  await link.click();
  await expect(ask).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(ask).toHaveCount(0);
  expect(popups).toEqual([]);
  // opened: a new tab, nothing of this page going with it
  await link.click();
  const [tab] = await Promise.all([p.waitForEvent('popup'), ask.getByRole('button', { name: 'Open' }).click()]);
  expect(tab.url()).toBe('https://example.org/archive');
  expect(await tab.evaluate(() => window.opener)).toBeNull();
  await tab.close();
  await expect(ask).toHaveCount(0);
  // the keyboard: V picks the paragraph, O asks for what it holds, Enter opens it
  await p.locator('.stage').focus();
  await p.keyboard.press('v');
  await p.keyboard.press('o');
  await expect(ask).toBeVisible();
  const [again] = await Promise.all([p.waitForEvent('popup'), p.keyboard.press('Enter')]);
  expect(again.url()).toBe('https://example.org/archive');
  await again.close();
  // and an address that is neither is refused, said plainly
  expect(
    await p.evaluate(() => (window as any).__typeset.reader.references.openLink('javascript:alert(1)')),
  ).toBeUndefined();
  await expect(p.locator('.toast')).toContainText('This link can’t be opened');
  await expect(ask).toHaveCount(0);
});

test('rich blocks are measured where nothing runs or fetches, never in the page', async ({ page: p }) => {
  await p.goto('/');
  let fetched = 0;
  await p.route('**/beacon*', r => {
    fetched++;
    return r.fulfill({ status: 404, body: '' });
  });
  // markup as a book saved by an earlier importer may hold it: a handler, a picture to fetch
  const r = await p.evaluate(async () => {
    // (the dev server's module, as the app loads it)
    const path = '/src/reader/rich.ts';
    const { measureRich }: typeof import('../src/reader/rich') = await import(/* @vite-ignore */ path);
    const w = window as any;
    w.ran = 0;
    // what reached the page itself (the app's own work adds and removes its probes meanwhile)
    const added: string[] = [];
    new MutationObserver(ms =>
      ms.forEach(m =>
        m.addedNodes.forEach(n => {
          if (n.nodeName === 'IFRAME' || n.textContent?.includes('Edward III')) added.push(n.nodeName);
        }),
      ),
    ).observe(document.body, { childList: true, subtree: true });
    const [size] = await measureRich([
      '<div style="background: url(/beacon1)">Edward III<img src="/beacon2" onerror="parent.ran = 1; window.ran = 1"/></div>',
    ]);
    await new Promise(r => setTimeout(r, 300));
    return { size, ran: w.ran, added, left: document.querySelectorAll('iframe').length };
  });
  expect(r.ran).toBe(0);
  expect(fetched).toBe(0);
  expect(r.size.w).toBeGreaterThan(40);
  // only its frame touched the page, and it is gone
  expect(r.added).toEqual(['IFRAME']);
  expect(r.left).toBe(0);
});

test("a reader's note resolved: it leaves the page and the rail, kept settled among the readers' notes, and comes back reopened", async ({
  page: p,
}) => {
  await openSample(p);
  // a reader's note on a paragraph of chapter one, sent yesterday
  const at = await p.evaluate(async () => {
    const r = (window as any).__typeset.reader,
      b = r.book.sections[3].blocks.find((x: any) => x.t.length > 200);
    const day = 864e5,
      f = {
        format: 'typeset-notes/1',
        book: { id: r.book.id, title: r.book.title, author: '' },
        from: { id: 'anna', name: 'Anna' },
        sent: Date.now() - day,
        notes: [
          {
            id: 'a',
            kind: 'highlight',
            key: b.key,
            s: 10,
            e: 60,
            quote: b.t.slice(10, 60),
            prefix: b.t.slice(0, 10),
            suffix: b.t.slice(60, 92),
            note: 'Is this needed?',
            created: Date.now() - day,
            updated: Date.now() - day,
          },
        ],
      };
    await r.receiveNotes(JSON.stringify(f));
    return b.key as string;
  });
  // (its column, found again whenever the text is set again)
  const toNote = async () => {
    await p.evaluate(key => {
      const r = (window as any).__typeset.reader;
      r.jump(r.strip.resolve({ key, off: 10 }));
    }, at);
    await settled(p);
  };
  await toNote();
  await expect(p.locator('.col .fb').first()).toBeVisible();
  // the rail: her card, with when she wrote it, and Resolve
  await p.keyboard.press(';');
  await laidOut(p);
  await toNote();
  const card = p.locator('.sn.theirs');
  await expect(card).toContainText('Is this needed?');
  await expect(card).toContainText('Yesterday');
  await card.getByRole('button', { name: 'Resolve' }).click();
  // (said where it went)
  await expect(p.locator('.toast.show')).toContainText('Resolved');
  // off the page: no underline, no dot, no card
  await expect(card).toHaveCount(0);
  await expect(p.locator('.col .fb')).toHaveCount(0);
  await expect(p.locator('.col .nd.fd')).toHaveCount(0);
  // among the readers' notes, settled; reopened, it is back on the page
  await p.keyboard.press('m');
  await p.getByRole('tab', { name: 'Highlights' }).click();
  await p.getByRole('button', { name: /^Readers’/ }).click();
  const done = p.locator('.contents').getByRole('button', { name: 'Done' });
  await expect(done).toHaveAttribute('aria-pressed', 'true');
  await done.click();
  await p.keyboard.press('Escape');
  await expect(p.locator('.col .fb').first()).toBeVisible();
});

test('a notes file that is damaged or hostile is refused with a reason, or shown as text, never run', async ({
  page: p,
}) => {
  await openSample(p);
  const said = (text: string) => p.evaluate(t => (window as any).__typeset.reader.receiveNotes(t), text);
  // damaged: cut short, not a notes file, from a newer version, incomplete
  expect(await said('{"format":"typeset-notes/1","book":{"id":')).toBe('This is not a notes file.');
  expect(await said('{"hello":"world"}')).toBe('This is not a notes file.');
  expect(await said('{"format":"typeset-notes/9","book":{"id":"x"}}')).toBe(
    'These notes come from a newer version of the app.',
  );
  expect(await said('{"format":"typeset-notes/1","book":{"id":"x"}}')).toBe('This notes file is incomplete.');
  // hostile: markup in a reader's name and note, notes with impossible values among good ones
  const f = await p.evaluate(() => {
    const r = (window as any).__typeset.reader,
      b = r.book.sections[3].blocks.find((x: any) => x.t.length > 120);
    return {
      format: 'typeset-notes/1',
      book: { id: r.book.id, title: r.book.title, author: '' },
      from: { id: 'other', name: '<img src=x onerror="window.__pwned=1">Eve' },
      sent: 1,
      notes: [
        {
          id: 'a',
          kind: 'highlight',
          key: b.key,
          s: 0,
          e: 30,
          quote: b.t.slice(0, 30),
          prefix: '',
          suffix: b.t.slice(30, 62),
          note: '<script>window.__pwned=2</script><b onmouseover="window.__pwned=3">bold?</b>',
          created: 1,
          updated: 1,
        },
        { id: 'b', kind: 'highlight', key: b.key, s: 'zero', e: 30, quote: 'x', created: 1, updated: 1 },
        { id: 'c', kind: 'nonsense', key: b.key, s: 0, e: 3, quote: 'abc', created: 1, updated: 1 },
        null,
      ],
    };
  });
  expect(await said(JSON.stringify(f))).toMatch(/^Notes from <img src=x onerror="window.__pwned=1">Eve: 1 placed/);
  // shown: her note beside its line, as text
  await p.evaluate(() => {
    const r = (window as any).__typeset.reader;
    r.jump(r.strip.resolve({ key: r.book.sections[3].blocks.find((x: any) => x.t.length > 120).key, off: 0 }));
  });
  await settled(p);
  await p.keyboard.press(';');
  await expect(p.locator('.sn.theirs').first()).toContainText('<script>window.__pwned=2</script>');
  expect(await p.evaluate(() => (window as any).__pwned)).toBeUndefined();
  expect(await p.locator('.sn img, .sn script, .sn b').count()).toBe(0);
});

test('one’s own notes edited on another device: the newer edit is kept', async ({ page: p }) => {
  await openSample(p);
  const md = await p.evaluate(() => {
    const r = (window as any).__typeset.reader,
      b = r.book.sections[3].blocks.find((x: any) => x.t.length > 120);
    r.ann.add(b.key, 0, 40, 1, 'First thought.');
    return (window as any).__typeset.contents.markdown(
      r.marking.notebook().map((e: any) => ({ ...e, k: r.strip.resolve(e.at) })),
    );
  });
  // elsewhere, later: the note rewritten, its colour changed
  const later = md
    .replace('First thought.', 'Second thought, better.')
    .replace(/"color":1/, '"color":3')
    .replace(/"updated":\d+/, `"updated":${Date.now() + 60000}`);
  expect(await p.evaluate(t => (window as any).__typeset.reader.receiveNotes(t), later)).toMatch(
    /^1 of your notes put back/,
  );
  expect(await p.evaluate(() => (window as any).__typeset.reader.ann.list.map((a: any) => [a.note, a.color]))).toEqual([
    ['Second thought, better.', 3],
  ]);
  // and an older copy changes nothing
  expect(await p.evaluate(t => (window as any).__typeset.reader.receiveNotes(t), md)).toMatch(/are all here already/);
  expect(await p.evaluate(() => (window as any).__typeset.reader.ann.list[0].note)).toBe('Second thought, better.');
});

test('notes Markdown damaged any which way gives a message, never an error', async ({ page: p }) => {
  await openSample(p);
  const out = await p.evaluate(async () => {
    const r = (window as any).__typeset.reader,
      b = r.book.sections[3].blocks.filter((x: any) => x.t.length > 120);
    r.ann.add(b[0].key, 0, 40, 1, 'A note\n\n# with a heading-like line');
    r.ann.add(b[1].key, 10, 60, 2, '');
    r.marking.toggleMark(b[2].key);
    const md: string = (window as any).__typeset.contents.markdown(
      r.marking.notebook().map((e: any) => ({ ...e, k: r.strip.resolve(e.at) })),
    );
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) >>> 0) % n;
    const results: string[] = [];
    for (let i = 0; i < 150; i++) {
      let lines = md.split('\n');
      const how = i % 5;
      if (how === 0) lines = lines.slice(0, rnd(lines.length));
      else if (how === 1) lines.splice(rnd(lines.length), 1 + rnd(3));
      else if (how === 2) {
        const a = rnd(lines.length),
          z = rnd(lines.length);
        [lines[a], lines[z]] = [lines[z], lines[a]];
      } else if (how === 3) {
        const k = rnd(lines.length);
        lines[k] = lines[k].slice(0, rnd(lines[k].length + 1));
      } else {
        const k = rnd(lines.length);
        lines[k] = lines[k].replace(/[{}":,]/g, () => '#@!'[rnd(3)]);
      }
      try {
        const said = await r.receiveNotes(lines.join('\n'));
        results.push(typeof said === 'string' ? 'ok' : 'not a message');
      } catch (e) {
        results.push('threw: ' + (e as Error).message);
      }
    }
    return results;
  });
  expect(out.filter(x => x !== 'ok')).toEqual([]);
});

test('a book read by an earlier importer is read again from its kept file; place, marks and notes stay', async ({
  page: p,
}) => {
  const { IMPORTER_VERSION } = await import('../src/core/types');
  await openSample(p);
  await toChapterOne(p);
  const before = await p.evaluate(() => {
    const r = (window as any).__typeset.reader,
      b = r.book.sections[3].blocks.filter((x: any) => x.t.length > 120);
    r.ann.add(b[0].key, 0, 40, 2, 'Kept across readings.');
    r.marking.toggleMark(b[1].key);
    r.flush();
    return { id: r.book.id, pos: (window as any).__typeset.kv.get('pos.' + r.book.id, null), marks: [...r.marks] };
  });
  await p.keyboard.press('q');
  // the engine's own version is the app's
  const entry = await p.evaluate(async () => (await (window as any).__typeset.reader.core.library())[0]);
  expect(entry).toMatchObject({ importer: IMPORTER_VERSION, source: true });
  // made to look read by an earlier importer
  await p.evaluate(async () => {
    const req = indexedDB.open('typeset');
    const d: IDBDatabase = await new Promise(r => {
      req.onsuccess = () => r(req.result);
    });
    const t = d.transaction('meta', 'readwrite'),
      s = t.objectStore('meta');
    const g = s.get('library');
    await new Promise(r => {
      g.onsuccess = r;
    });
    s.put(
      g.result.map((e: any) => ({ ...e, importer: 1 })),
      'library',
    );
    await new Promise(r => {
      t.oncomplete = r;
    });
  });
  await p.reload();
  await expect(p.locator('.toast')).toContainText('read again', { timeout: 15000 });
  const after = await p.evaluate(async id => {
    const v = (window as any).__typeset;
    return {
      importer: (await v.reader.core.library())[0].importer,
      pos: v.kv.get('pos.' + id, null),
      marks: v.kv.get('marks.' + id, []),
      digest: v.kv.get('nb.' + id, null)?.items?.length,
    };
  }, before.id);
  expect(after).toEqual({ importer: IMPORTER_VERSION, pos: before.pos, marks: before.marks, digest: 2 });
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => (window as any).__typeset.reader.reading);
  expect(await p.evaluate(() => (window as any).__typeset.reader.ann.list.map((a: any) => a.note))).toEqual([
    'Kept across readings.',
  ]);
});

test('hyphenation whose patterns failed to come is tried again: the next layout hyphenates', async ({ page: p }) => {
  let failed = 0;
  await p.route('**/hyph/*.bin', r => (failed++ ? r.continue() : r.fulfill({ status: 503, body: 'down' })));
  await openSample(p);
  await toChapterOne(p);
  expect(failed).toBeGreaterThan(0);
  // laid out again (another size): this time the patterns come, and words are broken
  await p.evaluate(() => {
    const w = window as any;
    w.__typeset.settings.step = 6;
    return w.__typeset.reader.settingsChanged('layout');
  });
  await expect
    .poll(() => p.evaluate(() => document.querySelectorAll('.col .ln.hy').length), { timeout: 15000 })
    .toBeGreaterThan(0);
});

test('a notes file that would put markup on the page is drawn as text: its ids escaped, its colours kept to the four', async ({
  page: p,
}) => {
  await openSample(p);
  await toChapterOne(p);
  await p.evaluate(async () => {
    const r = (window as any).__typeset.reader,
      f = r.myNotes();
    const lns = [...document.querySelectorAll<HTMLElement>(`.col[data-k="${r.cur}"] .ln[data-b]`)];
    const sec = r.strip.itemAt(r.cur).sec,
      b = r.book.sections[sec].blocks[+lns[3].dataset.b!],
      s0 = +lns[3].dataset.s!;
    // one's own notes, as a crafted file would have them
    f.notes = [
      {
        id: 'x"><img src=x onerror="window.__pwned=1">',
        kind: 'highlight',
        key: b.key,
        s: s0,
        e: s0 + 20,
        quote: b.t.slice(s0, s0 + 20),
        prefix: '',
        suffix: '',
        color: '5" onmouseover="window.__pwned=2',
        note: 'n',
        created: 1,
        updated: 1,
      },
    ];
    await r.receiveNotes([JSON.stringify(f)]);
  });
  await expect(p.locator('.col mark.hl').first()).toBeVisible();
  expect(
    await p.evaluate(() => [
      (window as any).__pwned ?? 0,
      document.querySelectorAll('.track img[src="x"], .track [onmouseover]').length,
    ]),
  ).toEqual([0, 0]);
  expect(await p.locator('.col mark.hl').first().getAttribute('class')).toMatch(/^hl h[1-4]\b/);
});

test('notes as W3C Web Annotations: exported, read back exactly; another tool’s placed by their words', async ({
  page: p,
}) => {
  await openSample(p);
  const made = await p.evaluate(() => {
    const r = (window as any).__typeset.reader,
      b = r.book.sections[3].blocks.filter((x: any) => x.t.length > 120);
    r.ann.add(b[0].key, 0, 40, 2, 'Worth keeping.');
    r.ann.add(b[1].key, 10, 70, 4, '');
    return {
      ann: r.ann.list.map((a: any) => [a.key, a.s, a.e, a.color, a.note]),
      quote: b[2].t.slice(20, 80),
      prefix: b[2].t.slice(0, 20),
      suffix: b[2].t.slice(80, 112),
    };
  });
  await p.keyboard.press('m');
  await expect(p.locator('.contents')).toBeVisible();
  await p.getByRole('tab', { name: 'Highlights' }).click();
  const [dl] = await Promise.all([
    p.waitForEvent('download'),
    p.getByRole('button', { name: 'As annotations…' }).click(),
  ]);
  const text = await (await dl.createReadStream()).toArray().then(c => Buffer.concat(c).toString());
  const json = JSON.parse(text);
  expect(json).toMatchObject({
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    type: 'AnnotationCollection',
    total: 2,
  });
  expect(json.first.items[0].target.selector[0].type).toBe('TextQuoteSelector');
  await p.keyboard.press('Escape');
  // the notes gone, then taken back from the file: every one where it was
  await p.evaluate(() => {
    const r = (window as any).__typeset.reader;
    for (const a of [...r.ann.list]) r.marking.unhighlight(a.id);
  });
  expect(await p.evaluate(t => (window as any).__typeset.reader.receiveNotes(t), text)).toMatch(
    /^2 of your notes put back/,
  );
  expect(
    await p.evaluate(() =>
      (window as any).__typeset.reader.ann.list.map((a: any) => [a.key, a.s, a.e, a.color, a.note]),
    ),
  ).toEqual(made.ann);
  // another tool's annotation: only the words and what is around them
  const theirs = JSON.stringify([
    {
      '@context': 'http://www.w3.org/ns/anno.jsonld',
      type: 'Annotation',
      creator: { name: 'Hypothesis user' },
      body: [{ type: 'TextualBody', value: 'Interesting.' }],
      target: {
        source: 'https://example.org/book',
        selector: [{ type: 'TextQuoteSelector', exact: made.quote, prefix: made.prefix, suffix: made.suffix }],
      },
    },
  ]);
  expect(await p.evaluate(t => (window as any).__typeset.reader.receiveNotes(t), theirs)).toMatch(
    /^Notes from Hypothesis user: 1 placed/,
  );
});

test('a book shared as a link: sealed by the writer, opened by a reader who has nothing, refused with a wrong key', async ({
  page: p,
  browser,
}) => {
  await p.goto('/');
  await p.locator('.book[data-id]').first().waitFor();
  // the writer: a book of theirs, its sheet, Share as a link, the sealed file saved
  await p.setInputFiles('input[type=file]', '../bench/fixtures/tables.epub');
  const book = p.locator('.book[data-id]', { hasText: 'Tables and Figures' });
  await book.click({ button: 'right' });
  await p.getByRole('button', { name: 'Share as a link…' }).click();
  const [dl] = await Promise.all([
    p.waitForEvent('download'),
    p.getByRole('button', { name: 'Save the sealed book…' }).click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/\.vbook$/);
  const sealed = await (await dl.createReadStream()).toArray().then(c => Buffer.concat(c));
  expect(sealed.subarray(0, 4).toString()).toBe('TSB1');
  expect(sealed.includes(Buffer.from('Wide tables'))).toBe(false);
  await p.getByLabel(/Put it where your readers can fetch it/).fill('https://books.example.org/thursday.vbook');
  const link = await p.getByLabel('The link').inputValue();
  expect(link).toMatch(/#open=https%3A%2F%2Fbooks\.example\.org%2Fthursday\.vbook&k=[\w-]{43}$/);
  // the reader: another browser, nothing in it
  const ctx = await browser.newContext();
  await ctx.route('https://books.example.org/**', r =>
    r.fulfill({ body: sealed, headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
  const q = await ctx.newPage();
  await q.goto(link.replace(/^https?:\/\/[^/]+/, 'http://localhost:5193'));
  await q.waitForFunction(
    () => {
      const r = (window as any).__typeset?.reader;
      return r?.reading && r.book?.title === 'Tables and Figures';
    },
    null,
    { timeout: 20000 },
  );
  expect(await q.evaluate(() => location.hash)).toBe('');
  // welcomed once: no name was given, so no sender named
  await expect(q.getByRole('dialog', { name: 'A book sent to you' })).toContainText('Sent to you');
  await q.keyboard.press('Enter');
  await expect(q.getByRole('dialog')).toHaveCount(0);
  // a key not its own
  await q.goto(
    link
      .replace(/^https?:\/\/[^/]+/, 'http://localhost:5193')
      .replace(/k=.$/, m => 'k=' + (m.endsWith('A') ? 'B' : 'A'))
      .replace(/k=[\w-]+$/, k => k.slice(0, -2) + (k.endsWith('AA') ? 'BB' : 'AA')),
  );
  await expect(q.locator('.toast')).toContainText('does not open the book', { timeout: 10000 });
  await ctx.close();
});

test('the whole library backed up and restored into a browser with nothing in it', async ({ page: p, browser }) => {
  await openSample(p);
  await p.evaluate(() => {
    const v = (window as any).__typeset,
      r = v.reader,
      b = r.book.sections[3].blocks.find((x: any) => x.t.length > 120);
    r.ann.add(b.key, 0, 40, 3, 'Backed up with the book.');
    v.settings.step = 6;
    v.kv.set('settings', { step: 6 });
    v.kv.set('me', { id: 'reader-one', name: 'Ann' });
    v.kv.set('vault.key', 'this-device');
  });
  await p.keyboard.press('q');
  await p.setInputFiles('input[type=file]', '../bench/fixtures/tables.epub');
  await expect(p.locator('.book[data-id]')).toHaveCount(2);
  const me = await p.evaluate(() => (window as any).__typeset.kv.get('me', null).id);
  const [dl] = await Promise.all([
    p.waitForEvent('download'),
    p.getByRole('button', { name: 'Back up the library…' }).click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/^Volumen library .*\.vbackup$/);
  let file = await (await dl.createReadStream()).toArray().then(c => Buffer.concat(c));
  // what belongs to this device's sign-in is not in it; and one that says otherwise is not believed
  expect(file.subarray(0, 5).toString()).toBe('TSBK1');
  const len = file.readUInt32BE(5),
    m = JSON.parse(file.subarray(9, 9 + len).toString());
  expect(m.state['vault.key']).toBeUndefined();
  m.state['vault.key'] = 'theirs';
  const head = Buffer.from(JSON.stringify(m)),
    n = Buffer.alloc(4);
  n.writeUInt32BE(head.length);
  file = Buffer.concat([file.subarray(0, 5), n, head, file.subarray(9 + len)]);
  // another browser, nothing in it but the sample
  const ctx = await browser.newContext();
  await ctx.route('**/sample.epub', r => r.fulfill({ path: SAMPLE, contentType: 'application/epub+zip' }));
  const q = await ctx.newPage();
  await q.goto('/');
  await q.locator('.book[data-id]').first().waitFor();
  await q.evaluate(() => (window as any).__typeset.kv.set('vault.key', 'mine'));
  // (restored, the app starts again: the page's next load)
  const reloaded = q.waitForEvent('load', { timeout: 30_000 });
  await q.setInputFiles('input[type=file]', {
    name: 'Volumen library.vbackup',
    mimeType: 'application/octet-stream',
    buffer: file,
  });
  await expect(q.locator('.toast')).toContainText('Restored: 1 book added');
  await reloaded;
  await expect(q.locator('.book[data-id]')).toHaveCount(2);
  const back = await q.evaluate(() => {
    const kv = (window as any).__typeset.kv;
    const k = kv.keys('ann.')[0];
    return {
      me: kv.get('me', null)?.id,
      step: kv.get('settings', {}).step,
      note: k && kv.get(k, [])[0]?.note,
      vault: kv.get('vault.key', null),
    };
  });
  expect(back).toEqual({ me, step: 6, note: 'Backed up with the book.', vault: 'mine' });
  await ctx.close();
});

/** A file out of a zip (a Word document's parts), without a zip library. */
function unzipPart(zip: Buffer, name: string): string | null {
  for (let i = 0; i + 30 < zip.length; ) {
    if (zip.readUInt32LE(i) !== 0x04034b50) break;
    const method = zip.readUInt16LE(i + 8),
      size = zip.readUInt32LE(i + 18),
      nlen = zip.readUInt16LE(i + 26),
      xlen = zip.readUInt16LE(i + 28);
    const n = zip.subarray(i + 30, i + 30 + nlen).toString();
    const data = zip.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + size);
    if (n === name) return (method === 8 ? inflateRawSync(data) : data).toString();
    i += 30 + nlen + xlen + size;
  }
  return null;
}

test("readers' feedback goes out to the writer's own files: Word comments, CriticMarkup, a report, a spreadsheet", async ({
  page: p,
}) => {
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  const out: Record<string, { name: string; text: string; bytes: Buffer }> = {};
  for (const kind of ['docx', 'md']) {
    // the writer's book (the Word one, then the Markdown one: each newest, so first), and
    // two readers' notes on it
    await p.setInputFiles('input[type=file]', `../bench/fixtures/manuscript.${kind}`);
    await expect(p.locator('.toast')).toContainText('Added');
    // (the same title with feedback already: offered as a new draft; these are two books)
    if (kind === 'md')
      await p.getByRole('dialog', { name: 'A new draft' }).getByRole('button', { name: 'Keep them apart' }).click();
    await p.locator('.book[data-id]', { hasText: 'The Lantern Keeper' }).first().click();
    await p.waitForFunction(() => (window as any).__typeset.reader.reading);
    const files = await p.evaluate(() => {
      const r = (window as any).__typeset.reader,
        b = r.book.sections[0].blocks.filter((x: any) => x.k === 0);
      const note = (who: string, blk: any, from: number, len: number, said: string) => ({
        format: 'typeset-notes/1',
        book: { id: r.book.id, title: r.book.title, author: '' },
        from: { id: who.toLowerCase(), name: who },
        sent: Date.now(),
        notes: [
          {
            id: who + '1',
            kind: 'highlight',
            key: blk.key,
            s: from,
            e: from + len,
            quote: blk.t.slice(from, from + len),
            prefix: blk.t.slice(Math.max(0, from - 32), from),
            suffix: blk.t.slice(from + len, from + len + 32),
            note: said,
            created: 1,
            updated: 1,
          },
        ],
      });
      return [note('Ann', b[0], 4, 30, 'The number matters here'), note('Tomas', b[1], 0, 20, 'A strong start')].map(
        f => JSON.stringify(f),
      );
    });
    expect(await p.evaluate(t => (window as any).__typeset.reader.receiveNotes(t), files)).toMatch(
      /^Notes from 2 readers: 2 placed/,
    );
    await p.keyboard.press('m');
    await expect(p.locator('.contents')).toBeVisible();
    await p.getByRole('tab', { name: 'Highlights' }).click();
    await p.getByRole('button', { name: /^Readers/ }).click();
    await p.getByRole('button', { name: 'Export…' }).click();
    const sheet = p.getByRole('dialog', { name: 'Export feedback' });
    await expect(sheet).toContainText('2 readers, 2 notes');
    const take = async (label: RegExp, key: string) => {
      const [dl] = await Promise.all([p.waitForEvent('download'), sheet.getByRole('button', { name: label }).click()]);
      const bytes = await (await dl.createReadStream()).toArray().then(c => Buffer.concat(c));
      out[key] = { name: dl.suggestedFilename(), text: bytes.toString(), bytes };
      if (await sheet.isVisible().catch(() => false)) return;
      await p.getByRole('button', { name: 'Export…' }).click();
    };
    await take(new RegExp(`^Into manuscript\\.${kind}`), kind);
    if (kind === 'docx') {
      await take(/^A report/, 'report');
      await take(/^A spreadsheet/, 'csv');
    }
    await p.evaluate(() => {
      const v = (window as any).__typeset;
      v.ui.sheet = null;
      v.contents.close();
      v.reader.close();
    });
    await expect(p.locator('.book[data-id]').first()).toBeVisible();
  }
  // Word: the readers' comments in the writer's file, on their words
  expect(out.docx.name).toBe('manuscript — with feedback.docx');
  const comments = unzipPart(out.docx.bytes, 'word/comments.xml')!;
  expect(comments).toContain('w:author="Ann"');
  expect(comments).toContain('A strong start');
  expect(unzipPart(out.docx.bytes, 'word/document.xml')!.match(/<w:commentRangeStart /g)).toHaveLength(2);
  // Markdown: CriticMarkup on the words
  expect(out.md.name).toBe('manuscript — with feedback.md');
  expect(out.md.text).toMatch(/\{==[^=]+==\}\{>>Ann: The number matters here<<\}/);
  expect(out.md.text).toMatch(/\{>>Tomas: A strong start<<\}/);
  // the report and the spreadsheet
  expect(out.report.text).toMatch(/^# Feedback on The Lantern Keeper\n/);
  expect(out.report.text).toContain('- **Tomas:** A strong start');
  expect(out.csv.text.split('\r\n')[0]).toBe('﻿Chapter,Passage,Reader,Note,Status,Place');
  expect(out.csv.text).toContain(',Ann,The number matters here,Open,');
});

test("a new draft of a book takes its notes, readers' feedback and decisions with it", async ({ page: p }) => {
  const v1 = readFileSync('../bench/fixtures/manuscript.md', 'utf8');
  // the writer revises: a sentence rewritten, a paragraph added
  const v2 = v1
    .replace(
      'She wrote that down in the back of her schoolbook, under the sums.',
      'She kept the line in her head instead, where no one would mark it.',
    )
    .replace('By morning the harbour board', 'The gulls were quiet that night.\n\nBy morning the harbour board');
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  await p.setInputFiles('input[type=file]', {
    name: 'manuscript.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(v1),
  });
  await expect(p.locator('.toast')).toContainText('Added');
  await p.locator('.book[data-id]', { hasText: 'The Lantern Keeper' }).first().click();
  await p.waitForFunction(() => (window as any).__typeset.reader.reading);
  // a note of the writer's own, and a reader's two: on words that stay, and on words that go
  await p.evaluate(async () => {
    const r = (window as any).__typeset.reader,
      bs = r.book.sections[0].blocks;
    const lantern = bs.find((b: any) => b.t.startsWith('The lantern')),
      sums = bs.find((b: any) => b.t.startsWith('She wrote'));
    r.ann.add(lantern.key, 4, 11, 1, 'Mine');
    const n = (b: any, s: number, e: number, said: string, id: string) => ({
      id,
      kind: 'highlight',
      key: b.key,
      s,
      e,
      quote: b.t.slice(s, e),
      prefix: b.t.slice(Math.max(0, s - 32), s),
      suffix: b.t.slice(e, e + 32),
      note: said,
      created: 1,
      updated: 1,
    });
    await r.receiveNotes(
      JSON.stringify({
        format: 'typeset-notes/1',
        book: { id: r.book.id, title: r.book.title, author: '' },
        from: { id: 'ann', name: 'Ann' },
        sent: 5,
        notes: [n(lantern, 4, 30, 'Keep this', 'a1'), n(sums, 33, 66, 'Lovely', 'a2')],
      }),
    );
  });
  await p.keyboard.press('q');
  // the revised file: offered as the new draft
  await p.setInputFiles('input[type=file]', {
    name: 'manuscript v2.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(v2),
  });
  const sheet = p.getByRole('dialog', { name: 'A new draft' });
  await expect(sheet).toContainText('notes from 1 reader, 1 note of yours');
  await sheet.getByRole('button', { name: 'Carry over, and remove the earlier draft' }).click();
  await expect(p.locator('.toast')).toHaveText(
    'Carried over to the new draft: 1 reader’s note from 1 reader (1 not found in this draft, kept), 1 note of yours.',
  );
  await expect(p.locator('.book[data-id]', { hasText: 'The Lantern Keeper' })).toHaveCount(1);
  // in the new draft: the reader's note on its words, the writer's own too
  await p.locator('.book[data-id]', { hasText: 'The Lantern Keeper' }).click();
  await p.waitForFunction(() => {
    const r = (window as any).__typeset.reader;
    return r.reading && r.fb?.size === 1;
  });
  const got = await p.evaluate(() => {
    const r = (window as any).__typeset.reader;
    return { fb: r.fb.list()[0], mine: r.ann.list.map((a: any) => [a.quote, a.note]) };
  });
  expect(got.fb).toMatchObject({ name: 'Ann', count: 1, lost: 1 });
  expect(got.mine).toEqual([['lantern', 'Mine']]);
});

test('notes for another book of the library, taken while reading, are kept for that book', async ({ page: p }) => {
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  await p.setInputFiles('input[type=file]', {
    name: 'manuscript.md',
    mimeType: 'text/markdown',
    buffer: readFileSync('../bench/fixtures/manuscript.md'),
  });
  await expect(p.locator('.toast')).toContainText('Added');
  const other = (await p.locator('.book[data-id]', { hasText: 'The Lantern Keeper' }).first().getAttribute('data-id'))!;
  await p.locator(`.book[data-id]:not([data-id="${other}"])`).first().click();
  await p.waitForFunction(() => (window as any).__typeset.reader.reading);
  const said = await p.evaluate(async id => {
    const r = (window as any).__typeset.reader;
    return r.receiveNotes(
      JSON.stringify({
        format: 'typeset-notes/1',
        book: { id, title: 'The Lantern Keeper', author: '' },
        from: { id: 'ann', name: 'Ann' },
        sent: 5,
        notes: [
          {
            id: 'a1',
            kind: 'highlight',
            key: 'x',
            s: 0,
            e: 4,
            quote: 'abcd',
            prefix: '',
            suffix: '',
            note: 'Hm',
            created: 1,
            updated: 1,
          },
        ],
      }),
    );
  }, other);
  expect(said).toBe('Notes from Ann on “The Lantern Keeper”: 1 note. Open the book to see them beside the text.');
  expect(await p.evaluate(id => Object.keys((window as any).__typeset.kv.get('fb.' + id, {})), other)).toEqual(['ann']);
  // the open book has none of them
  expect(await p.evaluate(() => (window as any).__typeset.reader.fb.size)).toBe(0);
});

test("a book removed takes everything kept about it: place, highlights, notes, readers' feedback, collections", async ({
  page: p,
}) => {
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  await p.setInputFiles('input[type=file]', {
    name: 'manuscript.md',
    mimeType: 'text/markdown',
    buffer: readFileSync('../bench/fixtures/manuscript.md'),
  });
  await expect(p.locator('.toast')).toContainText('Added');
  const book = p.locator('.book[data-id]', { hasText: 'The Lantern Keeper' }).first();
  const id = (await book.getAttribute('data-id'))!;
  // in a collection of the reader's (read as the app starts)
  await p.evaluate(
    i => localStorage.setItem('typeset.collections', JSON.stringify([{ id: 'c1', name: 'Drafts', books: [i] }])),
    id,
  );
  await p.reload();
  await book.click();
  await p.waitForFunction(() => (window as any).__typeset.reader.reading);
  await p.evaluate(async () => {
    const r = (window as any).__typeset.reader,
      b = r.book.sections[0].blocks.find((x: any) => x.t.length > 40);
    r.ann.add(b.key, 0, 12, 1, 'Mine');
    r.marking.toggleMark(b.key);
    await r.receiveNotes(
      JSON.stringify({
        format: 'typeset-notes/1',
        book: { id: r.book.id, title: r.book.title, author: '' },
        from: { id: 'ann', name: 'Ann' },
        sent: 5,
        notes: [
          {
            id: 'a1',
            kind: 'highlight',
            key: b.key,
            s: 0,
            e: 12,
            quote: b.t.slice(0, 12),
            prefix: '',
            suffix: b.t.slice(12, 44),
            note: 'Hm',
            created: 1,
            updated: 1,
          },
        ],
      }),
    );
  });
  await p.keyboard.press('q');
  const kept = () =>
    p.evaluate(i => {
      const kv = (window as any).__typeset.kv;
      return [
        ...kv.keys('').filter((k: string) => k.endsWith('.' + i)),
        ...(JSON.stringify(kv.get('collections', [])).includes(i) ? ['collections'] : []),
      ].sort();
    }, id);
  expect(await kept()).toEqual(expect.arrayContaining(['ann.' + id, 'fb.' + id, 'marks.' + id, 'collections']));
  await p.locator(`.book[data-id="${id}"]`).focus();
  await p.keyboard.press('x');
  await p
    .getByRole('dialog', { name: 'Remove a book' })
    .getByRole('button', { name: /^Remove/ })
    .click();
  await expect(p.locator('.toast')).toHaveText('Removed from the library.');
  expect(await kept()).toEqual([]);
});

test('a sample of some chapters saved as an EPUB holds only those, and reads back', async ({ page: p }) => {
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  await p.setInputFiles('input[type=file]', '../bench/fixtures/manuscript.docx');
  await expect(p.locator('.toast')).toContainText('Added');
  await p.locator('.book[data-id]', { hasText: 'The Lantern Keeper' }).click({ button: 'right' });
  await p.getByRole('button', { name: 'Save as EPUB…' }).click();
  const sheet = p.getByRole('dialog', { name: 'Save as EPUB' });
  await expect(sheet.getByRole('button', { name: 'Save the book' })).toBeVisible();
  await sheet.getByLabel('to').fill('1');
  const [dl] = await Promise.all([
    p.waitForEvent('download'),
    sheet.getByRole('button', { name: 'Save the sample' }).click(),
  ]);
  expect(dl.suggestedFilename()).toBe('The Lantern Keeper — chapter 1.epub');
  const epub = await (await dl.createReadStream()).toArray().then(c => Buffer.concat(c));
  expect(epub.subarray(30, 38).toString()).toBe('mimetype');
  // read back: one chapter, the first
  await p.evaluate(() => {
    for (const k of (window as any).__typeset.kv.keys('ann.')) (window as any).__typeset.kv.del(k);
  });
  await p.setInputFiles('input[type=file]', { name: 'sample.epub', mimeType: 'application/epub+zip', buffer: epub });
  await expect(p.locator('.toast')).toContainText('Added');
  const book = p.locator('.book[data-id]', { hasText: 'The Lantern Keeper' }).first();
  await book.click();
  await p.waitForFunction(() => (window as any).__typeset.reader.reading);
  expect(await p.evaluate(() => (window as any).__typeset.reader.book.sections.map((s: any) => s.label))).toEqual([
    'Chapter One',
  ]);
});

test('adding a book asks the browser to keep the library for good', async ({ page: p }) => {
  await p.addInitScript(() => {
    (window as any).asked = 0;
    Object.defineProperty(navigator, 'storage', {
      value: {
        persisted: async () => false,
        persist: async () => {
          (window as any).asked++;
          return true;
        },
        estimate: async () => ({}),
      },
    });
  });
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  expect(await p.evaluate(() => (window as any).asked)).toBe(0); // not on opening: only once there is something of one's own
  await p.setInputFiles('input[type=file]', '../bench/fixtures/tables.epub');
  await expect(p.locator('.toast')).toContainText('Added');
  await expect.poll(() => p.evaluate(() => (window as any).asked)).toBe(1);
});
