import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

// No accessibility violations (axe-core: WCAG 2.1 A and AA, and best practice) on each
// surface: the library, the reader, its settings, the map and its notebook, help.
test('every surface passes an accessibility audit', async ({ page: p, browserName }) => {
  test.skip(browserName !== 'chromium', 'one engine is enough for the audit');
  const found: string[] = [];
  const audit = async (where: string) => {
    await p.waitForTimeout(400);
    const r = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
    for (const v of r.violations) found.push(`${where}: ${v.id} (${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')})`);
  };
  await p.goto('/');
  await p.evaluate(() => localStorage.clear());
  await p.goto('/');
  await p.locator('.book[data-id]').first().waitFor();
  await audit('library');
  await p.locator('.book[data-id]').first().click();
  await p.waitForFunction(() => (window as any).__vol.reader.reading);
  await p.evaluate(() => (window as any).__vol.reader.jump(12));
  await p.mouse.move(600, 10);
  await audit('reader');
  await p.keyboard.press('s'); await audit('settings'); await p.keyboard.press('Escape');
  await p.keyboard.press('m'); await expect(p.locator('.map.ui-in')).toBeVisible(); await audit('map');
  await p.getByRole('button', { name: 'Notebook' }).click(); await audit('notebook');
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(600);
  await p.keyboard.press('?'); await audit('help');
  expect(found).toEqual([]);
});
