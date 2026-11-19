import { test as pw, expect } from '@playwright/test';

/** Every test's page, slowed when asked: `CPU=4` runs it at a quarter of this machine's
 *  speed (Chromium's CPU throttling), as slow as CI's runners and phones are, so whatever
 *  depends on timing fails here rather than after a push. Pages a test opens in contexts of
 *  its own are not slowed. */
const CPU = Number(process.env.CPU) || 0;

export const test = pw.extend({
  page: async ({ page, browserName }, use) => {
    if (CPU > 1 && browserName === 'chromium') await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: CPU });
    await use(page);
  },
});
export { expect };
