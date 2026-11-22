import { test as pw, expect } from '@playwright/test';

/** Every test's page, slowed when asked: `CPU=4` runs it at a quarter of this machine's
 *  speed (Chromium's CPU throttling), as slow as CI's runners and phones are, so whatever
 *  depends on timing fails here rather than after a push. Pages a test opens in contexts of
 *  its own are not slowed. */
const CPU = Number(process.env.CPU) || 0;

/** The tests watch the reader's motion (turns that slide, glides, landings): the app's
 *  default is less of it, so their pages follow the system's instead, unless a test has
 *  set it (a page of a context a test makes itself has the app's own default). `motion:
 *  null` leaves a page's storage as it comes (the package's: an embed keeps nothing there
 *  unless asked, and a test checks it). */
export const test = pw.extend<{ motion: 'system' | null }>({
  motion: ['system', { option: true }],
  page: async ({ page, browserName, motion }, use) => {
    if (CPU > 1 && browserName === 'chromium') await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: CPU });
    if (motion) await page.addInitScript(() => {
      try { const k = 'typeset.settings', s = JSON.parse(localStorage.getItem(k) || '{}'); if (!('motion' in s)) localStorage.setItem(k, JSON.stringify({ ...s, motion: 'system' })); } catch { /* storage unavailable */ }
    });
    await use(page);
  },
});
export { expect };
