// Screenshots of the reader for review: node bench/shots.mjs outdir   (dev server on :5193)
import { chromium } from '../app/node_modules/playwright/index.mjs';
const out = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
await p.goto('http://localhost:5193/');
await p.evaluate(() => localStorage.clear());
await p.goto('http://localhost:5193/');
await p.click('.book[data-id]');
await p.waitForFunction(() => window.__typeset?.reader?.reading);
await p.waitForFunction(() => {
  const r = window.__typeset.reader;
  return r.strip && r.strip.layouts.size === r.book.sections.length;
});
await p.evaluate(() => {
  const r = window.__typeset.reader;
  let k = Math.floor(r.strip.N * 0.31);
  while (r.strip.itemAt(k)?.type !== 'sect') k++;
  r.jump(k);
});
const shots = (process.argv[3] || 'panel').split(',');
for (const mode of ['light', 'dark']) {
  await p.evaluate(m => {
    window.__typeset.settings.appearance = m;
    window.__typeset.settings.theme = 'warm';
  }, mode);
  await p.evaluate(() => window.__typeset.reader.settingsChanged('layout'));
  await p.waitForTimeout(1200);
  if (shots.includes('panel')) {
    await p.keyboard.press('s');
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${out}/panel-${mode}.png` });
    await p.keyboard.press('c');
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${out}/panel-custom-${mode}.png` });
    await p.keyboard.press('Escape');
    await p.keyboard.press('Escape');
  }
  if (shots.includes('find')) {
    await p.keyboard.press('Control+f');
    await p.keyboard.type('the president');
    await p.waitForTimeout(500);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${out}/find-${mode}.png` });
    await p.keyboard.press('Escape');
  }
}
await b.close();
