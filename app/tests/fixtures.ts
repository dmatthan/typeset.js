import { type Page } from '@playwright/test';
import { test as base, expect } from './base';

/** The tests read a book whose text they know (The Man Who Was Thursday, the sample
 *  before Meditations): served in place of the sample in every page they open. */
export const SAMPLE = new URL('../../bench/fixtures/thursday.epub', import.meta.url).pathname;
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route('**/sample.epub', r => r.fulfill({ path: SAMPLE, contentType: 'application/epub+zip' }));
    await use(context);
  },
});
export { expect };

/** A book from the fixtures opened (added to the library first when it is not there),
 *  laid out whole. */
export async function openFile(p: Page, file: string, title: string) {
  await p.goto('/');
  await p.waitForSelector('.book[data-id]');
  const book = p.locator('.book[data-id]', { hasText: title }).first();
  if (!(await book.count())) await p.setInputFiles('input[type=file]', file);
  await book.waitFor({ timeout: 90000 });
  await book.click();
  await p.waitForFunction(() => {
    const r = (window as any).__typeset.reader;
    return r.strip && r.strip.layouts.size === r.book.sections.length;
  });
}
/** The first column from the fourth on that shows `sel` (a note's marker, a picture). */
export const firstCol = (p: Page, sel: string) =>
  p.evaluate(sel => {
    const r = (window as any).__typeset.reader,
      s = r.strip;
    for (let k = 3; k < s.N; k++) {
      r.jump(k);
      if (document.querySelector(`.col[data-k="${k}"] ${sel}`)) return k;
    }
    return -1;
  }, sel);
/** Landed: nothing moving, and the sheet on a whole column (a test waits for this, never
 *  for a time). */
export const settled = (p: Page) =>
  p.waitForFunction(() => {
    const m = (window as any).__typeset.reader.motion;
    return !m.moving && Number.isInteger(m.p);
  });
