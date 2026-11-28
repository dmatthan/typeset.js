// Changing the type size: from the change to the sentence set again on screen (the
// budget: under 100 ms). node bench/resize.mjs [chromium|webkit] [book.epub]  (dev server on :5193)
import { chromium, webkit } from '../app/node_modules/playwright/index.mjs';
import path from 'node:path';
const eng = process.argv[2] === 'webkit' ? webkit : chromium;
const b = await eng.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:5193/');
await p.evaluate(() => localStorage.clear());
await p.goto('http://localhost:5193/');
await p.locator('.book[data-id]').first().waitFor();
if (process.argv[3]) {
  await p.setInputFiles('input[type=file]', path.resolve(process.argv[3]));
  await p.waitForFunction(() => document.querySelectorAll('.book[data-id]').length >= 2, null, { timeout: 60000 });
}
await p.locator('.book[data-id]').first().click();
await p.waitForFunction(() => {
  const r = window.__typeset.reader;
  return r.reading && r.strip && r.strip.layouts.size === r.book.sections.length;
});
await p.evaluate(() => {
  const r = window.__typeset.reader;
  r.jump(Math.floor(r.strip.N * 0.4));
});
await p.waitForTimeout(800);
const out = [];
// one step at a time, as the size control moves
for (const size of [21, 22, 21, 20, 19, 20]) {
  out.push(
    await p.evaluate(async size => {
      const v = window.__typeset,
        r = v.reader;
      const t0 = performance.now();
      v.settings.size = size;
      await r.settingsChanged('layout');
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      const at = n => Math.round((performance.getEntriesByName(n).at(-1)?.startTime ?? t0) - t0);
      return `${Math.round(performance.now() - t0)} (fonts ${at('open:fonts')}, calibrated ${at('open:calibrated')}, laid out ${at('open:first-layout')}, shown ${at('open:shown')})`;
    }, size),
  );
  await p.waitForTimeout(1500);
}
console.log(
  eng.name(),
  path.basename(process.argv[3] || 'thursday'),
  'size change to text on screen, ms:\n  ' + out.join('\n  '),
);
await b.close();
