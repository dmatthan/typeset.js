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
