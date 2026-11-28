// Accessibility audit (axe-core) of each surface: the library, the reader, its bar, the
// settings, the contents and highlights, help, a sheet.  node bench/a11y.mjs  (dev server on :5193)
import { chromium } from '../app/node_modules/playwright/index.mjs';
import { AxeBuilder } from '../app/node_modules/@axe-core/playwright/dist/index.mjs';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1300, height: 820 } })).newPage();
const seen = new Map();
async function audit(where) {
  await p.waitForTimeout(500);
  const r = await new AxeBuilder({ page: p })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  for (const v of r.violations) {
    const k = v.id;
    if (!seen.has(k)) seen.set(k, { impact: v.impact, help: v.help, where: new Set(), nodes: [] });
    const s = seen.get(k);
    s.where.add(where);
    for (const n of v.nodes.slice(0, 3))
      if (s.nodes.length < 4)
        s.nodes.push(n.target.join(' ') + ' :: ' + n.failureSummary.split('\n').slice(1, 2).join(' ').slice(0, 140));
  }
}
await p.goto('http://localhost:5193/');
await p.evaluate(() => localStorage.clear());
await p.goto('http://localhost:5193/');
await p.locator('.book[data-id]').first().waitFor();
await audit('library');
await p.locator('.book[data-id]').first().click();
await p.waitForFunction(() => window.__typeset.reader.reading);
await p.evaluate(() => window.__typeset.reader.jump(12));
await p.mouse.move(600, 10);
await audit('reader');
await p.keyboard.press('s');
await audit('settings');
await p.keyboard.press('Escape');
await p.keyboard.press('m');
await p.waitForTimeout(400);
await audit('contents');
await p.getByRole('tab', { name: 'Highlights' }).click();
await audit('highlights');
await p.keyboard.press('Escape');
await p.keyboard.press('Escape');
await p.waitForTimeout(800);
await p.keyboard.press('?');
await audit('help');
await b.close();
for (const [id, s] of seen)
  console.log(`${s.impact} ${id}: ${s.help} [${[...s.where].join(', ')}]\n   ${s.nodes.join('\n   ')}`);
if (!seen.size) console.log('no violations');
